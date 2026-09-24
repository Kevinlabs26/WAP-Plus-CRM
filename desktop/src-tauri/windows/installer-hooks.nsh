!macro NSIS_HOOK_PREINSTALL
  ; Stop leftover app and sidecar processes before NSIS replaces their files.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM wap-plus-crm.exe'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM wap-plus-baileys.exe'
  Sleep 500
!macroend
