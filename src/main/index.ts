import { execFileSync, execSync } from 'child_process'
import { electronApp } from '@electron-toolkit/utils'
import { app } from 'electron'
import { initI18n } from '../shared/i18n'
import { registerIpcMainHandlers } from './utils/ipc'
import { getAppConfig, patchAppConfig } from './config'
import { startCore, initAdminStatus, initCoreWatcher } from './core/manager'
import { isWindowsCoreHelperProcess, runWindowsCoreHelper } from './core/windowsElevated'
import { createTray } from './resolve/tray'
import { init, initBasic, safeShowErrorBox } from './utils/init'
import { initProfileUpdater } from './core/profileUpdater'
import { startMonitor } from './resolve/trafficMonitor'
import { createLogger } from './utils/logger'
import {
  createWindow,
  mainWindow,
  showMainWindow,
  triggerMainWindow,
  closeMainWindow
} from './window'
import { handleDeepLink } from './deeplink'
import {
  fixUserDataPermissions,
  setupPlatformSpecifics,
  setupAppLifecycle,
  getSystemLanguage
} from './lifecycle'

function getWindowsPowerShellMajorVersion(): number | null {
  const registryKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\3\\PowerShellEngine',
    'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\PowerShellEngine'
  ]

  for (const key of registryKeys) {
    try {
      const stdout = execFileSync('reg', ['query', key, '/v', 'PowerShellVersion'], {
        encoding: 'utf8',
        timeout: 1000
      })
      const version = stdout.match(/PowerShellVersion\s+REG_\w+\s+([^\s]+)/)?.[1]
      const major = version ? parseInt(version.split('.')[0], 10) : NaN
      if (!isNaN(major)) return major
    } catch {
      // try next registry key
    }
  }

  return null
}

if (process.platform === 'win32') {
  try {
    const major = getWindowsPowerShellMajorVersion()
    if (major !== null && major < 5) {
      const isZh = Intl.DateTimeFormat().resolvedOptions().locale?.startsWith('zh')
      const title = isZh ? '需要更新 PowerShell' : 'PowerShell Update Required'
      const message = isZh
        ? `检测到您的 PowerShell 版本为 ${major}.x，部分功能需要 PowerShell 5.1 才能正常运行。\\n\\n请访问 Microsoft 官网下载并安装 Windows Management Framework 5.1。`
        : `Detected PowerShell version ${major}.x. Some features require PowerShell 5.1.\\n\\nPlease install Windows Management Framework 5.1 from the Microsoft website.`
      execSync(
        `mshta "javascript:var sh=new ActiveXObject('WScript.Shell');sh.Popup('${message}',0,'${title}',48);close()"`,
        { timeout: 60000 }
      )
      process.exit(0)
    }
  } catch {
    // ignore
  }
}

const mainLogger = createLogger('Main')

export { mainWindow, showMainWindow, triggerMainWindow, closeMainWindow }

if (isWindowsCoreHelperProcess()) {
  app
    .whenReady()
    .then(runWindowsCoreHelper)
    .catch((error) => {
      mainLogger.error('Failed to run Windows core helper', error)
      app.exit(1)
    })
} else {
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    app.quit()
  }

  async function initApp(): Promise<void> {
    await fixUserDataPermissions()
  }

  initApp().catch((e) => {
    safeShowErrorBox('common.error.initFailed', `${e}`)
    app.quit()
  })

  setupPlatformSpecifics()

  async function initHardwareAcceleration(): Promise<void> {
    try {
      await initBasic()
      const { disableHardwareAcceleration = false } = await getAppConfig()
      if (disableHardwareAcceleration) {
        app.disableHardwareAcceleration()
      }
    } catch (e) {
      mainLogger.warn('Failed to read hardware acceleration config', e)
    }
  }

  initHardwareAcceleration()
  setupAppLifecycle()

  app.on('second-instance', async (_event, commandline) => {
    showMainWindow()
    const url = commandline.pop()
    if (url) {
      await handleDeepLink(url)
    }
  })

  app.on('open-url', async (_event, url) => {
    showMainWindow()
    await handleDeepLink(url)
  })

  const initPromise = (async () => {
    await initBasic()
    await initAdminStatus()

    try {
      const appConfig = await getAppConfig()
      if (!appConfig.language) {
        const systemLanguage = getSystemLanguage()
        await patchAppConfig({ language: systemLanguage })
        appConfig.language = systemLanguage
      }
      await initI18n({ lng: appConfig.language })
      return appConfig
    } catch (e) {
      safeShowErrorBox('common.error.initFailed', `${e}`)
      app.quit()
      throw e
    }
  })()

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('lite.clash.app')

    await initPromise

    registerIpcMainHandlers()

    const createWindowPromise = createWindow()
    const runtimeInitPromise = init().catch((error) => {
      mainLogger.error('Failed to initialize background services', error)
    })

    let coreStarted = false
    const coreStartPromise = (async (): Promise<void> => {
      try {
        initCoreWatcher()
        const startPromises = await startCore()
        if (startPromises.length > 0) {
          startPromises[0].then(async () => {
            await initProfileUpdater()
          })
        }
        coreStarted = true
      } catch (e) {
        safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
      }
    })()

    const monitorPromise = (async (): Promise<void> => {
      try {
        await startMonitor()
      } catch {
        // ignore
      }
    })()

    await createWindowPromise

    const uiTasks: Promise<void>[] = []

    uiTasks.push(createTray())

    await Promise.all(uiTasks)
    void runtimeInitPromise
    await Promise.all([coreStartPromise, monitorPromise])

    if (coreStarted) {
      mainWindow?.webContents.send('core-started')
    }

    app.on('activate', () => {
      showMainWindow()
    })
  })
}
