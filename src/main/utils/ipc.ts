import path from 'path'
import v8 from 'v8'
import { app, ipcMain } from 'electron'
import i18next from 'i18next'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoCloseConnection,
  mihomoGroupDelay,
  mihomoGroupDetail,
  mihomoGroupsSnapshot,
  mihomoGroupSummaries,
  mihomoProxies,
  mihomoProxyDelay,
  mihomoProxyProviders,
  mihomoUpgrade,
  mihomoHotReloadConfig,
  mihomoVersion,
  patchMihomoConfig,
  subscribeMihomoConnections,
  subscribeMihomoLogs,
  unsubscribeMihomoConnections,
  unsubscribeMihomoLogs
} from '../core/mihomoApi'
import { checkAutoRun, disableAutoRun, enableAutoRun } from '../sys/autoRun'
import {
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  getProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  addProfileItem,
  removeProfileItem,
  changeCurrentProfile,
  getProfileStr,
  setProfileStr,
  updateProfileItem,
  setProfileConfig,
  hasUsableCurrentProfile
} from '../config'
import { quitWithoutCore, restartCore } from '../core/manager'
import { triggerSysProxy } from '../sys/sysproxy'
import { syncConfiguredSysProxy } from '../runtime/networkGuard'
import { checkUpdate, downloadAndInstallUpdate } from '../resolve/autoUpdater'
import {
  getFilePath,
  openFile,
  openUWPTool,
  readImageFileDataURL,
  readTextFile,
  resetAppConfig,
  setNativeTheme,
  setupFirewall
} from '../sys/misc'
import { getRuntimeConfig, getRuntimeConfigStr } from '../core/factory'
import { exportLocalBackup, importLocalBackup } from '../resolve/backup'
import { getInterfaces } from '../sys/interface'
import { copyEnv, updateTrayIcon } from '../resolve/tray'
import { closeMainWindow, mainWindow, showMainWindow, triggerMainWindow } from '../window'
import { applyTheme } from '../resolve/theme'
import { startMonitor } from '../resolve/trafficMonitor'
import { addProfileUpdater, removeProfileUpdater } from '../core/profileUpdater'
import { getImageDataURL } from './image'
import { get as httpGet, measureNetworkLatency } from './chromeRequest'
import { logDir } from './dirs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFn = (...args: any[]) => Promise<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncFn = (...args: any[]) => any

function wrapAsync<T extends AsyncFn>(
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T> | { invokeError: unknown }> {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (e && typeof e === 'object' && 'message' in e) {
        return { invokeError: e.message }
      }
      return { invokeError: typeof e === 'string' ? e : 'Unknown Error' }
    }
  }
}

function registerHandlers(handlers: Record<string, AsyncFn | SyncFn>, async = true): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    if (async) {
      ipcMain.handle(channel, (_e, ...args) => wrapAsync(handler as AsyncFn)(...args))
    } else {
      ipcMain.handle(channel, (_e, ...args) => (handler as SyncFn)(...args))
    }
  }
}

async function fetchIPInfo(url: string): Promise<unknown> {
  const res = await httpGet<unknown>(url, { timeout: 10000, responseType: 'json' })
  return res.data
}

async function measureLatency(url: string): Promise<number | null> {
  return measureNetworkLatency(url, { timeout: 5000, samples: 2, warmup: true })
}

async function changeLanguage(lng: string): Promise<void> {
  await i18next.changeLanguage(lng)
  ipcMain.emit('updateTrayMenu')
}

async function setTitleBarOverlay(overlay: Electron.TitleBarOverlayOptions): Promise<void> {
  if (mainWindow && typeof mainWindow.setTitleBarOverlay === 'function') {
    mainWindow.setTitleBarOverlay(overlay)
  }
}

async function addProfileItemWithNetworkRestore(item: Partial<IProfileItem>): Promise<void> {
  const hadUsableProfile = await hasUsableCurrentProfile()
  await addProfileItem(item)

  if (hadUsableProfile) return
  await syncConfiguredSysProxy()
  mainWindow?.webContents.send('profileConfigUpdated')
}

async function changeCurrentProfileWithNetworkSync(id: string): Promise<void> {
  await changeCurrentProfile(id)
  await syncConfiguredSysProxy()
  mainWindow?.webContents.send('profileConfigUpdated')
}

async function removeProfileItemWithNetworkSync(id: string): Promise<void> {
  await removeProfileItem(id)
  await syncConfiguredSysProxy()
  mainWindow?.webContents.send('profileConfigUpdated')
}

async function setProfileStrWithNetworkSync(id: string, str: string): Promise<void> {
  await setProfileStr(id, str)
  await syncConfiguredSysProxy()
  mainWindow?.webContents.send('profileConfigUpdated')
}

async function importLocalBackupWithNetworkSync(): Promise<boolean> {
  const imported = await importLocalBackup()
  if (imported) {
    await syncConfiguredSysProxy()
    mainWindow?.webContents.send('profileConfigUpdated')
  }
  return imported
}

const asyncHandlers: Record<string, AsyncFn> = {
  // Mihomo API
  mihomoVersion,
  mihomoCloseConnection,
  mihomoCloseAllConnections,
  mihomoProxies,
  mihomoGroupSummaries,
  mihomoGroupDetail,
  mihomoGroupsSnapshot,
  mihomoProxyProviders,
  mihomoChangeProxy,
  mihomoUpgrade,
  mihomoProxyDelay,
  mihomoGroupDelay,
  patchMihomoConfig,
  subscribeMihomoLogs,
  unsubscribeMihomoLogs,
  subscribeMihomoConnections,
  unsubscribeMihomoConnections,
  // AutoRun
  checkAutoRun,
  enableAutoRun,
  disableAutoRun,
  // Config
  getAppConfig,
  patchAppConfig,
  getControledMihomoConfig,
  patchControledMihomoConfig,
  // Profile
  getProfileConfig,
  setProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  getProfileStr,
  setProfileStr: setProfileStrWithNetworkSync,
  addProfileItem: addProfileItemWithNetworkRestore,
  removeProfileItem: removeProfileItemWithNetworkSync,
  updateProfileItem,
  changeCurrentProfile: changeCurrentProfileWithNetworkSync,
  addProfileUpdater,
  removeProfileUpdater,
  hasUsableCurrentProfile,
  // File
  getRuntimeConfig,
  getRuntimeConfigStr,
  readTextFile,
  // Core
  restartCore,
  mihomoHotReloadConfig,
  startMonitor,
  quitWithoutCore,
  // System
  triggerSysProxy,
  openUWPTool,
  setupFirewall,
  copyEnv,
  // Update
  checkUpdate,
  downloadAndInstallUpdate,
  // Backup
  exportLocalBackup,
  importLocalBackup: importLocalBackupWithNetworkSync,
  // Theme
  applyTheme,
  updateTrayIcon,
  // Misc
  fetchIPInfo,
  measureLatency,
  getImageDataURL,
  readImageFileDataURL,
  changeLanguage,
  setTitleBarOverlay
}

const syncHandlers: Record<string, SyncFn> = {
  resetAppConfig,
  getFilePath,
  openFile,
  getInterfaces,
  setNativeTheme,
  getVersion: () => app.getVersion(),
  platform: () => process.platform,
  showMainWindow,
  closeMainWindow,
  triggerMainWindow,
  setAlwaysOnTop: (alwaysOnTop: boolean) => mainWindow?.setAlwaysOnTop(alwaysOnTop),
  isAlwaysOnTop: () => mainWindow?.isAlwaysOnTop(),
  openDevTools: () => mainWindow?.webContents.openDevTools(),
  createHeapSnapshot: () => v8.writeHeapSnapshot(path.join(logDir(), `${Date.now()}.heapsnapshot`)),
  relaunchApp: () => {
    app.relaunch()
    app.quit()
  },
  quitApp: () => app.quit()
}

export function registerIpcMainHandlers(): void {
  registerHandlers(asyncHandlers, true)
  registerHandlers(syncHandlers, false)
}
