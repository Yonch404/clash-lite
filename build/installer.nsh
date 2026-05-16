!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh

!ifdef BUILD_UNINSTALLER

Var DeleteUserDataCheckbox
Var DeleteUserData
Var ClashLiteInstallDir
Var ClashLiteInstallParentDir
Var ClashLiteInstallParentName
Var ClashLiteCleanupScript

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
  StrCpy $ClashLiteCleanupScript "$TEMP\clash-lite-uninstall-cleanup.cmd"

  ClearErrors
  FileOpen $0 "$ClashLiteCleanupScript" w
  ${If} ${Errors}
    Return
  ${EndIf}

  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'setlocal$\r$\n'
  FileWrite $0 'cd /d "%TEMP%"$\r$\n'
  FileWrite $0 'timeout /T 2 /NOBREAK >NUL$\r$\n'
  FileWrite $0 'for /L %%i in (1,1,300) do ($\r$\n'
  FileWrite $0 '  rmdir /S /Q "$ClashLiteInstallDir" 2>NUL$\r$\n'
  ${If} $ClashLiteInstallParentName == "${APP_FILENAME}"
  ${OrIf} $ClashLiteInstallParentName == "${PRODUCT_FILENAME}"
  ${OrIf} $ClashLiteInstallParentName == "Clash Lite"
  ${OrIf} $ClashLiteInstallParentName == "clash-lite"
    FileWrite $0 '  rmdir "$ClashLiteInstallParentDir" 2>NUL$\r$\n'
  ${EndIf}
  FileWrite $0 '  if not exist "$ClashLiteInstallDir" goto cleanup_parent$\r$\n'
  FileWrite $0 '  timeout /T 1 /NOBREAK >NUL$\r$\n'
  FileWrite $0 ')$\r$\n'
  FileWrite $0 ':cleanup_parent$\r$\n'
  ${If} $ClashLiteInstallParentName == "${APP_FILENAME}"
  ${OrIf} $ClashLiteInstallParentName == "${PRODUCT_FILENAME}"
  ${OrIf} $ClashLiteInstallParentName == "Clash Lite"
  ${OrIf} $ClashLiteInstallParentName == "clash-lite"
    FileWrite $0 'rmdir "$ClashLiteInstallParentDir" 2>NUL$\r$\n'
  ${EndIf}
  FileWrite $0 'del /F /Q "%~f0" >NUL 2>NUL$\r$\n'
  FileClose $0

  ExecShell "open" "$SYSDIR\cmd.exe" '/D /Q /C call "$ClashLiteCleanupScript"' SW_HIDE
FunctionEnd

Function un.onGUIEnd
  ${IfNot} ${isUpdated}
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
    RMDir "$INSTDIR"
    Call un.ClashLiteScheduleInstallDirCleanup
  ${EndIf}
FunctionEnd

!macro customRemoveFiles
  ${If} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${If} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      Push ""
      Call un.restoreFiles
      Pop $R0

      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${EndIf}
  ${EndIf}

  SetOutPath $TEMP
  RMDir /r "$INSTDIR"
  RMDir "$INSTDIR"

  ${If} ${Silent}
    ${IfNot} ${isUpdated}
      Call un.ClashLiteScheduleInstallDirCleanup
    ${EndIf}
  ${EndIf}
!macroend

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
