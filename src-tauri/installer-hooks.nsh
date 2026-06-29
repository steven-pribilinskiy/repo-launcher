; Desktop-shortcut policy: create on the FIRST install, never re-create on updates
; (so a deleted icon doesn't keep coming back). The Tauri template creates
; "$DESKTOP\${PRODUCTNAME}.lnk" on every silent install; we keep it the first time
; and remove it on later installs, tracked by a registry marker that the Tauri
; uninstaller doesn't touch. Keeping (not delete+recreate) on first install also
; avoids a create→delete flicker that left OneDrive desktops with a "sync pending"
; ghost. Recreate any time from Settings → "Create desktop shortcut".
!define RL_STATE_KEY "Software\repo-launcher-state"

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "${RL_STATE_KEY}" "Installed"
  ${If} $0 == ""
    ; First install — keep the icon the template just created.
    WriteRegStr HKCU "${RL_STATE_KEY}" "Installed" "1"
  ${Else}
    ; Update — remove the icon the template re-created so it doesn't reappear.
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend
