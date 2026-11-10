[CmdletBinding()]
param(
    [ValidateRange(1, 1440)][int]$Minutes = 60,
    [ValidateRange(5, 60)][int]$IntervalSeconds = 60,
    [string]$OutputPath = ''
)
$ErrorActionPreference = 'Stop'
if (-not $OutputPath) {
    $metricDirectory = Join-Path $PSScriptRoot '..\desktop\diagnostics'
    $OutputPath = Join-Path $metricDirectory ('desktop-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
}
$metricPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $metricPath) { throw 'Choose a new output file; existing observations are preserved.' }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($metricPath)) | Out-Null
$appDataPath = Join-Path $env:APPDATA 'com.wapplus.crm'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$watch = [Diagnostics.Stopwatch]::StartNew()
$lastDiskAt = -1000
$disk = $null
$samples = 0
$canReadTree = $true
do {
    $final = $watch.Elapsed.TotalMinutes -ge $Minutes
    $processRows = @()
    if ($canReadTree) {
        try { $processRows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name) }
        catch { $canReadTree = $false; Write-Warning 'Process tree access unavailable; measuring main CRM processes only.' }
    }
    $tracked = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($row in $processRows) { if ($row.Name -eq 'wap-plus-crm.exe') { [void]$tracked.Add([int]$row.ProcessId) } }
    do {
        $added = $false
        foreach ($row in $processRows) {
            if ($tracked.Contains([int]$row.ParentProcessId) -and $tracked.Add([int]$row.ProcessId)) { $added = $true }
        }
    } while ($added)
    $processes = if ($canReadTree) { @($tracked | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }) } else { @(Get-Process -Name 'wap-plus-crm' -ErrorAction SilentlyContinue) }
    if (-not $disk -or $watch.Elapsed.TotalSeconds - $lastDiskAt -ge 300 -or $final) {
        $diskErrors = @()
        $size = if (Test-Path -LiteralPath $appDataPath) {
            Get-ChildItem -LiteralPath $appDataPath -File -Recurse -ErrorAction SilentlyContinue -ErrorVariable diskErrors | Measure-Object -Property Length -Sum
        } else { $null }
        $disk = @{ bytes = [long]$size.Sum; files = [long]$size.Count; scanErrors = $diskErrors.Count }
        $lastDiskAt = $watch.Elapsed.TotalSeconds
    }
    $sample = [ordered]@{
        atUtc = [DateTime]::UtcNow.ToString('o')
        elapsedSeconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
        processCount = $processes.Count
        processScope = $(if ($canReadTree) { 'process-tree' } else { 'main-process-only' })
        processIds = @($processes | ForEach-Object { $_.Id })
        privateBytes = [long](($processes | Measure-Object -Property PrivateMemorySize64 -Sum).Sum)
        workingSetBytes = [long](($processes | Measure-Object -Property WorkingSet64 -Sum).Sum)
        cpuSeconds = [math]::Round((($processes | Measure-Object -Property CPU -Sum).Sum), 2)
        dataBytes = $disk.bytes
        dataFiles = $disk.files
        diskScanErrors = $disk.scanErrors
        diskSampleAgeSeconds = [math]::Round($watch.Elapsed.TotalSeconds - $lastDiskAt, 1)
    }
    if ($sample.privateBytes -lt 0 -or $sample.dataBytes -lt 0) { throw 'Invalid measurement; observation stopped.' }
    [IO.File]::AppendAllText($metricPath, (($sample | ConvertTo-Json -Depth 4 -Compress) + [Environment]::NewLine), $utf8)
    $samples++
    if (-not $final) { Start-Sleep -Seconds ([math]::Min($IntervalSeconds, [math]::Max(1, [int]($Minutes * 60 - $watch.Elapsed.TotalSeconds)))) }
} while (-not $final)
Write-Output ("Recorded {0} samples: {1}" -f $samples, $metricPath)
