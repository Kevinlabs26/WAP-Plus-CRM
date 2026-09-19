!macro NSIS_HOOK_PREINSTALL
  ; Older app versions can leave the Baileys sidecar running while the
  ; updater starts NSIS. Stop it immediately before files are replaced.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM wap-plus-baileys.exe'
  Sleep 500
!macroend
