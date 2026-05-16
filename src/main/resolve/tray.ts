import { app, clipboard, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { t } from 'i18next'
import {
  changeCurrentProfile,
  getAppConfig,
  getControledMihomoConfig,
  hasUsableCurrentProfile,
  getProfileConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import windowsTrayIcon from '../../../build/app-icon.ico?asset'
import linuxTrayIcon from '../../../resources/tray-icon-linux.png?asset'
import macTrayIcon from '../../../resources/tray-icon@2x.png?asset'
import { patchMihomoConfig } from '../core/mihomoApi'
import { mainWindow, showMainWindow, triggerMainWindow } from '../window'
import { dataDir, logDir, mihomoCoreDir, mihomoWorkDir } from '../utils/dirs'
import { triggerSysProxy } from '../sys/sysproxy'
import { syncConfiguredSysProxy } from '../runtime/networkGuard'
import { quitWithoutCore } from '../core/manager'

export let tray: Tray | null = null
type TrayImage = Electron.NativeImage | string
let trayMenu: Menu | null = null

function bindTrayMenuUpdater(): void {
  ipcMain.removeListener('updateTrayMenu', handleUpdateTrayMenu)
  ipcMain.on('updateTrayMenu', handleUpdateTrayMenu)
}

function handleUpdateTrayMenu(): void {
  void updateTrayMenu()
}

export const buildContextMenu = async (): Promise<Menu> => {
  const { mode } = await getControledMihomoConfig()
  const { sysProxy, envType = process.platform === 'win32' ? ['powershell'] : ['bash'] } =
    await getAppConfig()
  const { current, items = [] } = await getProfileConfig()

  const contextMenu = [
    {
      id: 'show',
      label: t('tray.showWindow'),
      type: 'normal',
      click: (): void => {
        showMainWindow()
      }
    },
    {
      id: 'rule',
      label: t('tray.ruleMode'),
      type: 'radio',
      checked: mode === 'rule',
      click: async (): Promise<void> => {
        await patchControledMihomoConfig({ mode: 'rule' })
        await patchMihomoConfig({ mode: 'rule' })
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        mainWindow?.webContents.send('groupsUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      }
    },
    {
      id: 'global',
      label: t('tray.globalMode'),
      type: 'radio',
      checked: mode === 'global',
      click: async (): Promise<void> => {
        await patchControledMihomoConfig({ mode: 'global' })
        await patchMihomoConfig({ mode: 'global' })
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        mainWindow?.webContents.send('groupsUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      }
    },
    {
      id: 'direct',
      label: t('tray.directMode'),
      type: 'radio',
      checked: mode === 'direct',
      click: async (): Promise<void> => {
        await patchControledMihomoConfig({ mode: 'direct' })
        await patchMihomoConfig({ mode: 'direct' })
        mainWindow?.webContents.send('controledMihomoConfigUpdated')
        mainWindow?.webContents.send('groupsUpdated')
        ipcMain.emit('updateTrayMenu')
        await updateTrayIcon()
      }
    },
    { type: 'separator' },
    {
      type: 'checkbox',
      label: t('tray.systemProxy'),
      checked: sysProxy.enable,
      click: async (item): Promise<void> => {
        const enable = item.checked
        try {
          await triggerSysProxy(enable)
          await patchAppConfig({ sysProxy: { enable } })
          mainWindow?.webContents.send('appConfigUpdated')
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
          await updateTrayIcon()
        }
      }
    },
    {
      type: 'submenu',
      label: t('tray.profiles'),
      submenu: items.map((item) => {
        return {
          type: 'radio',
          label: item.name,
          checked: item.id === current,
          click: async (): Promise<void> => {
            if (item.id === current) return
            await changeCurrentProfile(item.id)
            await syncConfiguredSysProxy()
            mainWindow?.webContents.send('profileConfigUpdated')
            ipcMain.emit('updateTrayMenu')
            await updateTrayIcon()
          }
        }
      })
    },
    { type: 'separator' },
    {
      type: 'submenu',
      label: t('tray.openDirectories.title'),
      submenu: [
        {
          type: 'normal',
          label: t('tray.openDirectories.appDir'),
          click: (): Promise<string> => shell.openPath(dataDir())
        },
        {
          type: 'normal',
          label: t('tray.openDirectories.workDir'),
          click: (): Promise<string> => shell.openPath(mihomoWorkDir())
        },
        {
          type: 'normal',
          label: t('tray.openDirectories.coreDir'),
          click: (): Promise<string> => shell.openPath(mihomoCoreDir())
        },
        {
          type: 'normal',
          label: t('tray.openDirectories.logDir'),
          click: (): Promise<string> => shell.openPath(logDir())
        }
      ]
    },
    envType.length > 1
      ? {
          type: 'submenu',
          label: t('tray.copyEnv'),
          submenu: envType.map((type) => {
            return {
              id: type,
              label: type,
              type: 'normal',
              click: async (): Promise<void> => {
                await copyEnv(type)
              }
            }
          })
        }
      : {
          id: 'copyenv',
          label: t('tray.copyEnv'),
          type: 'normal',
          click: async (): Promise<void> => {
            await copyEnv(envType[0])
          }
        },
    { type: 'separator' },
    {
      id: 'quitWithoutCore',
      label: t('actions.lightMode.button'),
      type: 'normal',
      click: quitWithoutCore
    },
    {
      id: 'restart',
      label: t('actions.restartApp'),
      type: 'normal',
      click: (): void => {
        app.relaunch()
        app.quit()
      }
    },
    {
      id: 'quit',
      label: t('actions.quit.button'),
      type: 'normal',
      accelerator: 'CommandOrControl+Q',
      click: (): void => app.quit()
    }
  ] as Electron.MenuItemConstructorOptions[]
  return Menu.buildFromTemplate(contextMenu)
}

export async function createTray(): Promise<void> {
  const { useDockIcon = true } = await getAppConfig()
  tray = new Tray(createTrayImage())
  await updateTrayMenu()
  bindTrayMenuUpdater()
  await updateTrayToolTip()
  tray?.setIgnoreDoubleClickEvents(true)

  await updateTrayIcon()

  if (process.platform === 'darwin') {
    if (!useDockIcon) {
      hideDockIcon()
    }
    // macOS 默认行为：左键显示窗口，右键显示菜单
    tray?.addListener('click', async () => {
      triggerMainWindow()
    })
  }
  if (process.platform === 'win32') {
    tray?.addListener('click', async () => {
      triggerMainWindow()
    })
  }
  if (process.platform === 'linux') {
    tray?.addListener('click', async () => {
      triggerMainWindow()
    })
  }
}

function createTrayImage(): TrayImage {
  if (process.platform === 'win32') {
    return windowsTrayIcon
  }

  const iconPath = process.platform === 'darwin' ? macTrayIcon : linuxTrayIcon
  return nativeImage.createFromPath(iconPath)
}

async function updateTrayMenu(): Promise<void> {
  if (!tray) return

  const menu = await buildContextMenu()
  trayMenu = menu
  tray.setContextMenu(trayMenu)
}

export async function copyEnv(
  type: 'bash' | 'cmd' | 'powershell' | 'fish' | 'nushell'
): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const { sysProxy } = await getAppConfig()
  const { host } = sysProxy
  const proxyUrl = `http://${host || '127.0.0.1'}:${mixedPort}`

  switch (type) {
    case 'bash': {
      clipboard.writeText(
        `export https_proxy=${proxyUrl} http_proxy=${proxyUrl} all_proxy=${proxyUrl}`
      )
      break
    }
    case 'cmd': {
      clipboard.writeText(`set http_proxy=${proxyUrl}\r\nset https_proxy=${proxyUrl}`)
      break
    }
    case 'powershell': {
      clipboard.writeText(`$env:HTTP_PROXY="${proxyUrl}"; $env:HTTPS_PROXY="${proxyUrl}"`)
      break
    }
    case 'fish': {
      clipboard.writeText(
        `set -x http_proxy ${proxyUrl}; set -x https_proxy ${proxyUrl}; set -x all_proxy ${proxyUrl}`
      )
      break
    }
    case 'nushell': {
      clipboard.writeText(
        `$env.HTTP_PROXY = "${proxyUrl}"; $env.HTTPS_PROXY = "${proxyUrl}"; $env.ALL_PROXY = "${proxyUrl}"`
      )
      break
    }
  }
}

export async function showDockIcon(): Promise<void> {
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    await app.dock.show()
  }
}

export async function hideDockIcon(): Promise<void> {
  if (process.platform === 'darwin' && app.dock && app.dock.isVisible()) {
    app.dock.hide()
  }
}

async function updateTrayToolTip(): Promise<void> {
  if (!tray) return

  const [mihomoConfig, appConfig, profileUsable] = await Promise.all([
    getControledMihomoConfig(),
    getAppConfig(),
    hasUsableCurrentProfile()
  ])
  const { mode } = mihomoConfig
  const sysProxy = profileUsable && appConfig.sysProxy.enable
  const tunStatus = profileUsable && (mihomoConfig.tun?.enable ?? true)

  const modeLabel =
    mode === 'global'
      ? t('tray.globalMode')
      : mode === 'direct'
        ? t('tray.directMode')
        : t('tray.ruleMode')
  const status = [
    `${t('tray.tooltip.mode')}: ${modeLabel}`,
    `${t('tray.systemProxy')}: ${sysProxy ? t('tray.tooltip.enabled') : t('tray.tooltip.disabled')}`,
    `${t('tray.tun')}: ${tunStatus ? t('tray.tooltip.enabled') : t('tray.tooltip.disabled')}`
  ]

  tray.setToolTip(['Clash Lite', ...status].join('\n'))
}

export async function updateTrayIcon(): Promise<void> {
  if (!tray) return

  try {
    tray.setImage(createTrayImage())
    await updateTrayToolTip()
  } catch {
    // Failed to update tray icon
  }
}
