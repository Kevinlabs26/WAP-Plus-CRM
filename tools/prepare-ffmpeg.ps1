$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$binaryDir = Join-Path $projectRoot 'desktop/src-tauri/binaries'
$archivePath = Join-Path $projectRoot '.audit-cache/ffmpeg-9.0.2.zip'
$binaryPath = Join-Path $binaryDir 'ffmpeg-x86_64-pc-windows-msvc.exe'
$archiveHash = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$binaryHash = '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec'
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
New-Item -ItemType Directory -Force -Path $binaryDir, (Split-Path $archivePath -Parent) | Out-Null
if ((Test-Path -LiteralPath $binaryPath) -and
    (Get-Sha256 $binaryPath) -eq $binaryHash -and
    (Test-Path -LiteralPath (Join-Path $binaryDir 'ffmpeg-LICENSE.txt'))) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/FFMPEG-NOTICE.txt') -Destination (Join-Path $binaryDir 'ffmpeg-NOTICE.txt')
    Write-Output 'Project FFmpeg 9.0.2 verified'
    exit 0
}
if (!(Test-Path -LiteralPath $archivePath) -or
    (Get-Sha256 $archivePath) -ne $archiveHash) {
    $request = [Net.WebRequest]::Create('https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip')
    $request.Timeout = 60000
    $request.ReadWriteTimeout = 60000
    $response = $request.GetResponse()
    try {
        if ($response.ContentLength -gt 134217728) { throw 'FFmpeg download exceeds 128 MiB' }
        $downloadInput = $response.GetResponseStream()
        $downloadOutput = [IO.File]::Create($archivePath)
        try {
            $buffer = New-Object byte[] 65536
            $received = 0L
            $watch = [Diagnostics.Stopwatch]::StartNew()
            while (($count = $downloadInput.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $received += $count
                if ($received -gt 134217728 -or $watch.Elapsed.TotalSeconds -gt 120) { throw 'FFmpeg download limit exceeded' }
                $downloadOutput.Write($buffer, 0, $count)
            }
        } finally { $downloadOutput.Dispose(); $downloadInput.Dispose() }
    } finally { $response.Dispose() }
}
if ((Get-Sha256 $archivePath) -ne $archiveHash) {
    throw 'FFmpeg archive SHA256 mismatch; refusing extraction'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($item in @(
        @('bin/ffmpeg.exe', $binaryPath),
        @('LICENSE', (Join-Path $binaryDir 'ffmpeg-LICENSE.txt'))
    )) {
        $entry = $archive.GetEntry("ffmpeg-9.0.2-essentials_build/$($item[0])")
        if ($null -eq $entry) { throw 'Expected FFmpeg archive entry missing' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $item[1], $true)
    }
} finally { $archive.Dispose() }
if ((Get-Sha256 $binaryPath) -ne $binaryHash) {
    throw 'FFmpeg executable SHA256 mismatch; refusing build'
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/FFMPEG-NOTICE.txt') -Destination (Join-Path $binaryDir 'ffmpeg-NOTICE.txt')
Write-Output 'Project FFmpeg 9.0.2 prepared and verified'
