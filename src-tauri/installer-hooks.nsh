; The app owns the desktop shortcut — it's created on a genuine first launch and
; via the General-settings button, never by the installer. So we strip the icon
; the Tauri template creates on every (silent) install: that's what made a deleted
; icon keep reappearing after each update. POSTINSTALL runs after the template's
; silent shortcut creation, so deleting here neutralizes it. A kept icon is also
; cleared on update; recreate it from Settings if wanted.
!macro NSIS_HOOK_POSTINSTALL
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend
