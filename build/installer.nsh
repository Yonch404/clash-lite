!include LogicLib.nsh
!include nsDialogs.nsh

Var DeleteUserDataCheckbox
Var DeleteUserData

!macro customUnWelcomePage
  PageEx un.custom
    PageCallbacks un.ClashLiteUninstallOptionsPageCreate un.ClashLiteUninstallOptionsPageLeave
  PageExEnd
!macroend

Function un.ClashLiteUninstallOptionsPageCreate
  nsDialogs::Create 1018
  Pop $0

  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Uninstall Clash Lite."
  Pop $0

  ${NSD_CreateCheckbox} 0 34u 100% 14u "Also delete subscriptions, settings, logs, cache, and runtime files"
  Pop $DeleteUserDataCheckbox
  ${NSD_Uncheck} $DeleteUserDataCheckbox

  nsDialogs::Show
FunctionEnd

Function un.ClashLiteUninstallOptionsPageLeave
  ${NSD_GetState} $DeleteUserDataCheckbox $DeleteUserData
FunctionEnd

!macro customUnInstall
  DetailPrint "Stopping Clash Lite elevated core task..."
  nsExec::ExecToLog 'schtasks.exe /end /tn "ClashLiteCore"'
  Pop $0
  nsExec::ExecToLog 'schtasks.exe /delete /tn "ClashLiteCore" /f'
  Pop $0

  DetailPrint "Removing Clash Lite auto-start entries..."
  nsExec::ExecToLog 'schtasks.exe /delete /tn "clash-lite" /f'
  Pop $0
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "clash-lite"

  ${If} $DeleteUserData == ${BST_CHECKED}
    DetailPrint "Removing Clash Lite user data..."
    RMDir /r "$APPDATA\clash-lite"
    RMDir /r "$LOCALAPPDATA\clash-lite"
    RMDir /r "$APPDATA\Clash Lite"
    RMDir /r "$LOCALAPPDATA\Clash Lite"
  ${EndIf}
!macroend
