import { TitleBarOverlayOptions } from 'electron'

function checkIpcError<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'invokeError' in response) {
    throw (response as { invokeError: unknown }).invokeError
  }
  return response as T
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await window.electron.ipcRenderer.invoke(channel, ...args)
  return checkIpcError<T>(response)
}

// IPC API 类型定义
interface IpcApi {
  // Mihomo API
  mihomoVersion: () => Promise<IMihomoVersion>
  mihomoCloseConnection: (id: string) => Promise<void>
  mihomoCloseAllConnections: () => Promise<void>
  mihomoProxies: () => Promise<IMihomoProxies>
  mihomoGroupSummaries: () => Promise<IMihomoMixedGroupSummary[]>
  mihomoGroupDetail: (group: string, force?: boolean) => Promise<IMihomoMixedGroup>
  mihomoGroupsSnapshot: (groups?: string[], force?: boolean) => Promise<IMihomoGroupsSnapshot>
  mihomoProxyProviders: () => Promise<IMihomoProxyProviders>
  mihomoChangeProxy: (group: string, proxy: string) => Promise<IMihomoProxy>
  mihomoUpgrade: () => Promise<void>
  mihomoProxyDelay: (proxy: string, url?: string) => Promise<IMihomoDelay>
  mihomoGroupDelay: (group: string, url?: string) => Promise<IMihomoGroupDelay>
  patchMihomoConfig: (patch: Partial<IMihomoConfig>) => Promise<void>
  subscribeMihomoLogs: () => Promise<void>
  unsubscribeMihomoLogs: () => Promise<void>
  subscribeMihomoConnections: () => Promise<void>
  unsubscribeMihomoConnections: () => Promise<void>
  // AutoRun
  checkAutoRun: () => Promise<boolean>
  enableAutoRun: () => Promise<void>
  disableAutoRun: () => Promise<void>
  // Config
  getAppConfig: (force?: boolean) => Promise<IAppConfig>
  patchAppConfig: (patch: Partial<IAppConfig>) => Promise<void>
  getControledMihomoConfig: (force?: boolean) => Promise<Partial<IMihomoConfig>>
  patchControledMihomoConfig: (patch: Partial<IMihomoConfig>) => Promise<void>
  resetAppConfig: () => Promise<void>
  // Profile
  getProfileConfig: (force?: boolean) => Promise<IProfileConfig>
  setProfileConfig: (config: IProfileConfig) => Promise<void>
  getCurrentProfileItem: () => Promise<IProfileItem>
  getProfileItem: (id: string | undefined) => Promise<IProfileItem>
  getProfileStr: (id: string) => Promise<string>
  setProfileStr: (id: string, str: string) => Promise<void>
  addProfileItem: (item: Partial<IProfileItem>) => Promise<void>
  removeProfileItem: (id: string) => Promise<void>
  updateProfileItem: (item: IProfileItem) => Promise<void>
  changeCurrentProfile: (id: string) => Promise<void>
  addProfileUpdater: (item: IProfileItem) => Promise<void>
  removeProfileUpdater: (id: string) => Promise<void>
  hasUsableCurrentProfile: () => Promise<boolean>
  // File
  getRuntimeConfig: () => Promise<IMihomoConfig>
  getRuntimeConfigStr: () => Promise<string>
  getFilePath: (ext: string[], title?: string, filterName?: string) => Promise<string[] | undefined>
  readTextFile: (filePath: string) => Promise<string>
  readImageFileDataURL: (filePath: string) => Promise<string>
  openFile: (type: 'profile', id: string) => Promise<void>
  // Core
  restartCore: () => Promise<void>
  mihomoHotReloadConfig: () => Promise<void>
  startMonitor: () => Promise<void>
  quitWithoutCore: () => Promise<void>
  // System
  triggerSysProxy: (enable: boolean) => Promise<void>
  openUWPTool: () => Promise<void>
  setupFirewall: () => Promise<void>
  getInterfaces: () => Promise<Record<string, NetworkInterfaceInfo[]>>
  setNativeTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  copyEnv: (type: 'bash' | 'cmd' | 'powershell' | 'fish' | 'nushell') => Promise<void>
  // Update
  checkUpdate: () => Promise<IAppVersion | undefined>
  downloadAndInstallUpdate: (version: string) => Promise<void>
  getVersion: () => Promise<string>
  platform: () => Promise<NodeJS.Platform>
  // Backup
  exportLocalBackup: () => Promise<boolean>
  importLocalBackup: () => Promise<boolean>
  // Theme
  updateTrayIcon: () => Promise<void>
  // Window
  showMainWindow: () => Promise<void>
  closeMainWindow: () => Promise<void>
  triggerMainWindow: () => Promise<void>
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>
  isAlwaysOnTop: () => Promise<boolean>
  openDevTools: () => Promise<void>
  createHeapSnapshot: () => Promise<void>
  // Misc
  fetchIPInfo: (url: string) => Promise<unknown>
  measureLatency: (url: string) => Promise<number | null>
  getImageDataURL: (url: string) => Promise<string>
  relaunchApp: () => Promise<void>
  quitApp: () => Promise<void>
}

// 使用 Proxy 自动生成 IPC 调用
const ipc = new Proxy({} as IpcApi, {
  get:
    <K extends keyof IpcApi>(_: IpcApi, channel: K) =>
    (...args: Parameters<IpcApi[K]>) =>
      invoke(channel, ...args)
})

// 导出所有 IPC 方法
export const {
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
  resetAppConfig,
  // Profile
  getProfileConfig,
  setProfileConfig,
  getCurrentProfileItem,
  getProfileItem,
  getProfileStr,
  setProfileStr,
  addProfileItem,
  removeProfileItem,
  updateProfileItem,
  changeCurrentProfile,
  addProfileUpdater,
  removeProfileUpdater,
  hasUsableCurrentProfile,
  // File
  getRuntimeConfig,
  getRuntimeConfigStr,
  getFilePath,
  readTextFile,
  readImageFileDataURL,
  openFile,
  // Core
  restartCore,
  mihomoHotReloadConfig,
  startMonitor,
  quitWithoutCore,
  // System
  triggerSysProxy,
  openUWPTool,
  setupFirewall,
  getInterfaces,
  setNativeTheme,
  copyEnv,
  // Update
  checkUpdate,
  downloadAndInstallUpdate,
  getVersion,
  // Backup
  exportLocalBackup,
  importLocalBackup,
  // Theme
  updateTrayIcon,
  // Window
  showMainWindow,
  closeMainWindow,
  triggerMainWindow,
  setAlwaysOnTop,
  isAlwaysOnTop,
  openDevTools,
  createHeapSnapshot,
  // Misc
  fetchIPInfo,
  measureLatency,
  getImageDataURL,
  relaunchApp,
  quitApp
} = ipc

// platform 需要重命名导出
export const getPlatform = ipc.platform

// 需要特殊处理的函数

// applyTheme: 防抖处理，避免频繁调用
let applyThemeRunning = false
let pendingTheme: string | null = null

export async function applyTheme(theme: string): Promise<void> {
  if (applyThemeRunning) {
    pendingTheme = theme
    return
  }
  applyThemeRunning = true
  try {
    await invoke<void>('applyTheme', theme)
  } finally {
    applyThemeRunning = false
    if (pendingTheme !== null) {
      const nextTheme = pendingTheme
      pendingTheme = null
      await applyTheme(nextTheme)
    }
  }
}

// setTitleBarOverlay: 需要静默处理不支持的平台
export async function setTitleBarOverlay(overlay: TitleBarOverlayOptions): Promise<void> {
  try {
    await invoke<void>('setTitleBarOverlay', overlay)
  } catch {
    // Not supported on this platform
  }
}
