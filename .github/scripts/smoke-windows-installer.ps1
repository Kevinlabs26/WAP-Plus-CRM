$ErrorActionPreference = "Stop"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$bundleDirectory = Join-Path $repositoryRoot "desktop/src-tauri/target/release/bundle/nsis"
$config = Get-Content (Join-Path $repositoryRoot "desktop/src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
$installerName = "$($config.productName)_$($config.version)_x64-setup.exe"
$installer = Get-Item -LiteralPath (Join-Path $bundleDirectory $installerName) -ErrorAction SilentlyContinue

if (-not $installer) {
  throw "The expected installer $installerName was not found in $bundleDirectory"
}

if (Get-Process -Name "wap-plus-crm", "wap-plus-baileys" -ErrorAction SilentlyContinue) {
  throw "Run the installer smoke test on a clean Windows session without WAP Plus CRM running"
}

$dataDirectory = Join-Path ([Environment]::GetFolderPath("ApplicationData")) $config.identifier
if (Test-Path -LiteralPath $dataDirectory) {
  throw "Run the installer smoke test on a clean Windows user profile without existing CRM data"
}

Write-Host "Installing $($installer.Name)"
$installation = Start-Process -FilePath $installer.FullName -ArgumentList "/S" -WindowStyle Hidden -PassThru -Wait
if ($installation.ExitCode -ne 0) {
  throw "The installer exited with code $($installation.ExitCode)"
}

$installationDirectory = Join-Path $env:LOCALAPPDATA $config.productName
$applicationPath = Join-Path $installationDirectory "wap-plus-crm.exe"
$sidecarPath = Join-Path $installationDirectory "wap-plus-baileys.exe"

if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
  throw "The installed application was not found at $applicationPath"
}
if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
  throw "The installed Baileys sidecar was not found at $sidecarPath"
}

$application = $null
$databasePath = Join-Path $dataDirectory "wap-plus.db"
$stdoutPath = Join-Path $env:RUNNER_TEMP "wap-plus-startup.stdout.log"
$stderrPath = Join-Path $env:RUNNER_TEMP "wap-plus-startup.stderr.log"
try {
  Write-Host "Launching the installed application"
  $application = Start-Process -FilePath $applicationPath -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    Start-Sleep -Seconds 1
    $application.Refresh()
    if ($application.HasExited) {
      throw "The installed application exited during startup with code $($application.ExitCode)"
    }
  } while (-not (Test-Path -LiteralPath $databasePath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline)

  Start-Sleep -Seconds 3
  $application.Refresh()
  if ($application.HasExited) {
    throw "The installed application exited during startup with code $($application.ExitCode)"
  }

  if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
    throw "The installed application did not initialize its database at $databasePath"
  }

  Write-Host "Installer smoke test passed"
}
catch {
  foreach ($log in @($stdoutPath, $stderrPath)) {
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 60 | Write-Host }
  }
  throw
}
finally {
  if ($application -and -not $application.HasExited) {
    Stop-Process -Id $application.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-Process -Name "wap-plus-baileys" -Force -ErrorAction SilentlyContinue
}
