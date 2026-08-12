!macro customInit
!macroend

!macro customInstall
  ; Kill the running Books process before installation to prevent file locking
  nsExec::ExecToLog 'taskkill /f /im "Books.exe"'
  ; Wait for the OS to release file handles after process termination
  Sleep 3000
!macroend

!macro customUnInstall
  ; Books deliberately preserves the existing library data on uninstall.
  ; This avoids accidental removal while the migration still uses the legacy
  ; application-data directory for compatibility.
!macroend
