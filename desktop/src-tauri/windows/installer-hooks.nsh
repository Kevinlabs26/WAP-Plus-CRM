!macro NSIS_HOOK_PREINSTALL
  ; Stop leftover app and sidecar processes before NSIS replaces their files.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM wap-plus-baileys.exe'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM wap-plus-crm.exe'
  Sleep 1500
  ; Retry in case the updater launched NSIS before Windows released the old exe.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM wap-plus-crm.exe'
  Sleep 1000
!macroend
