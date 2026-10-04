import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("installer smoke rejects stale packages and running sessions and starts a fresh process", { skip: process.platform !== "win32" }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "wap-installer-smoke-"));
  try {
    const script = join(temporary, "check.ps1");
    const source = String.raw`
$ErrorActionPreference = 'Stop'
$scriptPath = $args[0]
function Resolve-Path { param($Path) $Path }
function Get-Content { param($Path,[switch]$Raw) '{"productName":"WAP Plus CRM","version":"0.1.33","identifier":"com.wapplus.crm"}' }
function Get-Item { param($LiteralPath,$ErrorAction) if ($LiteralPath -notlike '*WAP Plus CRM_0.1.33_x64-setup.exe') { throw 'Wrong installer version' }; if ($global:missing) { return }; [pscustomobject]@{Name='WAP Plus CRM_0.1.33_x64-setup.exe'; FullName=$LiteralPath} }
function Get-Process { param($Name,$ErrorAction) if ($global:running) { [pscustomobject]@{Id=999} } }
function Test-Path { param($LiteralPath,$PathType) if ($LiteralPath -like "*com.wapplus.crm") { return $global:hasData }; if ($LiteralPath -like "*wap-plus.db") { return -not $global:startupFailure }; $true }
function Start-Process { param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,[switch]$Wait) if ($WindowStyle -ne 'Hidden') { throw 'Visible launch' }; $global:launches++; if ($Wait) { [pscustomobject]@{ExitCode=0} } else { $p=[pscustomobject]@{Id=123;HasExited=$false}; Add-Member -InputObject $p -MemberType ScriptMethod -Name Refresh -Value {}; $p } }
function Start-Sleep { param($Seconds) }
function Stop-Process { param($Id,$Name,[switch]$Force,$ErrorAction) }
$env:LOCALAPPDATA = $args[1]
foreach ($case in @('missing','running','data','startup','success')) {
  $global:missing = $case -eq 'missing'; $global:running = $case -eq 'running'; $global:hasData = $case -eq 'data'; $global:startupFailure = $case -eq 'startup'; $global:launches = 0
  $caught = $null
  try { & $scriptPath } catch { $caught = $_.Exception.Message }
  if ($case -eq 'missing' -and ($caught -notlike '*expected installer*' -or $global:launches)) { throw 'Missing current installer was accepted' }
  if ($case -eq 'running' -and ($caught -notlike '*clean Windows session*' -or $global:launches)) { throw 'Running CRM was not protected' }
  if ($case -eq 'data' -and ($caught -notlike '*clean Windows user profile*' -or $global:launches)) { throw 'Existing CRM data was not protected' }
  if ($case -eq 'startup' -and $caught -notlike '*did not initialize its database*') { throw 'Uninitialized application was accepted' }
  if ($case -eq 'success' -and ($caught -or $global:launches -ne 2)) { throw "Fresh process check failed: $caught" }
}
'5 installer smoke regression checks passed'
`;
    await writeFile(script, source);
    const powershell = join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const smoke = fileURLToPath(new URL("../../.github/scripts/smoke-windows-installer.ps1", import.meta.url));
    const result = await promisify(execFile)(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, smoke, temporary], { windowsHide: true, timeout: 15000 });
    assert.match(result.stdout, /5 installer smoke regression checks passed/);
  } finally {
    assert.ok(temporary.startsWith(join(tmpdir(), "wap-installer-smoke-")));
    await rm(temporary, { recursive: true, force: true });
  }
});
