$NpmArgs = $args
if (!$NpmArgs.Count) { $NpmArgs = @('--version') }
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot '.nvmrc') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid project Node version in .nvmrc' }
$runtime = Join-Path $projectRoot ".audit-cache/node-v$version-win-x64"
$node = Join-Path $runtime 'node.exe'
if (!(Test-Path -LiteralPath $node)) {
    throw "Install the official Node $version Windows x64 portable package in $runtime, or use a version manager with .nvmrc."
}
if ((& $node --version) -ne "v$version") { throw 'Project Node runtime does not match .nvmrc' }
$portablePerlRoot = Join-Path $projectRoot '.audit-cache\strawberry-perl-5.42.3.1'
$perlCandidates = @((Join-Path $portablePerlRoot 'perl\bin\perl.exe'))
$perlCandidates += @(Get-Command perl -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
$perlCandidates += @(
    (Join-Path $env:ProgramFiles 'Strawberry\perl\bin\perl.exe'),
    'C:\Strawberry\perl\bin\perl.exe'
)
$perlReady = $false
foreach ($candidate in ($perlCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)) {
    $candidateBin = Split-Path -Parent $candidate
    $candidateRoot = Split-Path -Parent (Split-Path -Parent $candidateBin)
    $previousPath = $env:PATH
    $previousLocale = $env:LC_ALL
    $previousLang = $env:LANG
    $env:PATH = "$(Join-Path $candidateRoot 'perl\site\bin');$candidateBin;$(Join-Path $candidateRoot 'c\bin');$previousPath"
    $env:LC_ALL = 'C'
    $env:LANG = 'C'
    try {
        & $candidate -MLocale::Maketext::Simple -e 1 2>$null
        if ($LASTEXITCODE -eq 0) {
            $perlPath = $candidate
            $perlReady = $true
            break
        }
    } finally {
        $env:PATH = $previousPath
        $env:LC_ALL = $previousLocale
        $env:LANG = $previousLang
    }
}
if (!$perlReady) {
    throw 'Tauri builds SQLCipher with vendored OpenSSL and needs a complete Perl installation. Git for Windows includes a reduced Perl; install Strawberry Perl, then rerun this command.'
}
$perlDir = Split-Path -Parent $perlPath
$perlRoot = Split-Path -Parent (Split-Path -Parent $perlDir)
$perlPathEntries = @((Join-Path $perlRoot 'perl\site\bin'), $perlDir, (Join-Path $perlRoot 'c\bin'))
$isTauriDev = ($NpmArgs -contains 'tauri') -and ($NpmArgs -contains 'dev')
$previousPath = $env:PATH
$previousWebViewData = $env:WEBVIEW2_USER_DATA_FOLDER
Push-Location -LiteralPath $projectRoot
try {
    # Keep WebView2 dev data separate from the installed app's potentially busy profile.
    if ($isTauriDev) { $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $projectRoot '.audit-cache\webview2-dev' }
    # Scope project Node and the OpenSSL build prerequisite to this command and its children.
    $env:PATH = "$runtime;$($perlPathEntries -join ';');$previousPath"
    & $node (Join-Path $runtime 'node_modules/npm/bin/npm-cli.js') @NpmArgs
    $result = $LASTEXITCODE
} finally {
    $env:PATH = $previousPath
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousWebViewData
    Pop-Location
}
exit $result
