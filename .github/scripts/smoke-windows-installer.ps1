$ErrorActionPreference = "Stop"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$bundleDirectory = Join-Path $repositoryRoot "desktop/src-tauri/target/release/bundle/nsis"
$installer = Get-ChildItem -LiteralPath $bundleDirectory -Filter "*-setup.exe" -File |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "No NSIS installer was found in $bundleDirectory"
}

Write-Host "Installing $($installer.Name)"
$installation = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -PassThru -Wait
if ($installation.ExitCode -ne 0) {
  throw "The installer exited with code $($installation.ExitCode)"
}

$installationDirectory = Join-Path $env:LOCALAPPDATA "WAP Plus CRM"
$applicationPath = Join-Path $installationDirectory "wap-plus-crm.exe"
$sidecarPath = Join-Path $installationDirectory "wap-plus-baileys.exe"

if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
  throw "The installed application was not found at $applicationPath"
}
if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
  throw "The installed Baileys sidecar was not found at $sidecarPath"
}

$application = $null
try {
  $application = Get-Process -Name "wap-plus-crm" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $application) {
    Write-Host "Launching the installed application"
    $application = Start-Process -FilePath $applicationPath -PassThru
  }
  Start-Sleep -Seconds 15
  $application.Refresh()

  if ($application.HasExited) {
    throw "The installed application exited during startup with code $($application.ExitCode)"
  }

  Write-Host "Installer smoke test passed"
}
finally {
  if ($application -and -not $application.HasExited) {
    Stop-Process -Id $application.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Name "wap-plus-baileys" -Force -ErrorAction SilentlyContinue
}
