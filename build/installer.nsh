!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh

!ifdef BUILD_UNINSTALLER

Var DeleteUserDataCheckbox
Var DeleteUserData
Var ClashLiteInstallDir
Var ClashLiteInstallParentDir
Var ClashLiteInstallParentName

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

Function un.ClashLiteScheduleInstallDirCleanup
  StrCpy $ClashLiteInstallDir "$INSTDIR"
  ${GetParent} "$ClashLiteInstallDir" $ClashLiteInstallParentDir
  ${GetFileName} "$ClashLiteInstallParentDir" $ClashLiteInstallParentName
  SetOutPath "$TEMP"

  ${If} $ClashLiteInstallParentName == "${APP_FILENAME}"
  ${OrIf} $ClashLiteInstallParentName == "${PRODUCT_FILENAME}"
  ${OrIf} $ClashLiteInstallParentName == "Clash Lite"
  ${OrIf} $ClashLiteInstallParentName == "clash-lite"
    ExecShell "open" "$SYSDIR\cmd.exe" '/D /C "timeout /T 2 /NOBREAK >NUL & for /L %i in (1,1,20) do @if exist "$ClashLiteInstallDir" (rmdir /S /Q "$ClashLiteInstallDir" 2>NUL & timeout /T 1 /NOBREAK >NUL) & rmdir "$ClashLiteInstallParentDir" 2>NUL"' SW_HIDE
  ${Else}
    ExecShell "open" "$SYSDIR\cmd.exe" '/D /C "timeout /T 2 /NOBREAK >NUL & for /L %i in (1,1,20) do @if exist "$ClashLiteInstallDir" (rmdir /S /Q "$ClashLiteInstallDir" 2>NUL & timeout /T 1 /NOBREAK >NUL)"' SW_HIDE
  ${EndIf}
FunctionEnd

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Call un.ClashLiteScheduleInstallDirCleanup
  ${EndIf}

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
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}

    RMDir /r "$APPDATA\clash-lite"
    RMDir /r "$LOCALAPPDATA\clash-lite"
    RMDir /r "$APPDATA\Clash Lite"
    RMDir /r "$LOCALAPPDATA\Clash Lite"
    RMDir /r "$LOCALAPPDATA\clash-lite-updater"

    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend

!endif
