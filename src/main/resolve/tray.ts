import { app, clipboard, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { t } from 'i18next'
import {
  changeCurrentProfile,
  getAppConfig,
  getControledMihomoConfig,
  getProfileConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import appIcon from '../../../resources/app-icon.png?asset'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoGroupDelay,
  mihomoGroups,
  patchMihomoConfig
} from '../core/mihomoApi'
import { mainWindow, showMainWindow, triggerMainWindow } from '../window'
import { dataDir, logDir, mihomoCoreDir, mihomoWorkDir } from '../utils/dirs'
import { triggerSysProxy } from '../sys/sysproxy'
import { quitWithoutCore } from '../core/manager'
import { trayLogger } from '../utils/logger'
import { floatingWindow, triggerFloatingWindow } from './floatingWindow'

export let tray: Tray | null = null
const trayIconSize = 16

export const buildContextMenu = async (): Promise<Menu> => {
  // 添加调试日志
  await trayLogger.debug('Current translation for tray.showWindow', t('tray.showWindow'))
  await trayLogger.debug(
    'Current translation for tray.hideFloatingWindow',
    t('tray.hideFloatingWindow')
  )
  await trayLogger.debug(
    'Current translation for tray.showFloatingWindow',
    t('tray.showFloatingWindow')
  )

  const { mode } = await getControledMihomoConfig()
  const {
    sysProxy,
    envType = process.platform === 'win32' ? ['powershell'] : ['bash'],
    proxyInTray = true,
    showCurrentProxyInTray = false,
    trayProxyGroupStyle = 'default'
  } = await getAppConfig()
  let groupsMenu: Electron.MenuItemConstructorOptions[] = []
  if (proxyInTray && process.platform !== 'linux') {
    try {
      const groups = await mihomoGroups()
      const groupItems: Electron.MenuItemConstructorOptions[] = groups.map((group) => {
        const groupLabel = showCurrentProxyInTray ? `${group.name} | ${group.now}` : group.name

        return {
          id: group.name,
          label: groupLabel,
          type: 'submenu' as const,
          submenu: [
            {
              id: `${group.name}-delay-test`,
              label: t('tray.delayTest'),
              type: 'normal' as const,
              click: async (): Promise<void> => {
                try {
                  await mihomoGroupDelay(group.name, group.testUrl)
                  mainWindow?.webContents.send('groupsUpdated')
                } catch (error) {
                  await trayLogger.error(`Failed to test proxy group delay: ${group.name}`, error)
                }
              }
            },
            { type: 'separator' as const },
            ...group.all.map((proxy) => {
              const delay = proxy.history.length
                ? proxy.history[proxy.history.length - 1].delay
                : -1
              let displayDelay = `(${delay}ms)`
              if (delay === -1) {
                displayDelay = ''
              }
              if (delay === 0) {
                displayDelay = '(Timeout)'
              }
              return {
                id: proxy.name,
                label: `${proxy.name}   ${displayDelay}`,
                type: 'radio' as const,
                checked: proxy.name === group.now,
                click: async (): Promise<void> => {
                  await mihomoChangeProxy(group.name, proxy.name)
                  await mihomoCloseAllConnections()
                }
              }
            })
          ]
        }
      })

      if (trayProxyGroupStyle === 'submenu') {
        groupsMenu = [
          { type: 'separator' },
          {
            id: 'proxy-groups',
            label: t('tray.proxyGroups'),
            type: 'submenu',
            submenu: groupItems
          }
        ]
      } else {
        groupsMenu = groupItems
        groupsMenu.unshift({ type: 'separator' })
      }
    } catch {
      // ignore
      // 避免出错时无法创建托盘菜单
    }
  }
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
      id: 'show-floating',
      label: floatingWindow?.isVisible()
        ? t('tray.hideFloatingWindow')
        : t('tray.showFloatingWindow'),
      type: 'normal',
      click: async (): Promise<void> => {
        await triggerFloatingWindow()
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
          floatingWindow?.webContents.send('appConfigUpdated')
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
          await updateTrayIcon()
        }
      }
    },
    ...groupsMenu,
    { type: 'separator' },
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
  if (process.platform === 'linux') {
    const menu = await buildContextMenu()
    tray.setContextMenu(menu)
  }
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
    tray?.addListener('right-click', async () => {
      await updateTrayMenu()
    })
  }
  if (process.platform === 'win32') {
    tray?.addListener('click', async () => {
      triggerMainWindow()
    })
    tray?.addListener('right-click', async () => {
      await updateTrayMenu()
    })
  }
  if (process.platform === 'linux') {
    tray?.addListener('click', async () => {
      triggerMainWindow()
    })
    // 移除旧监听器防止累积
    ipcMain.removeAllListeners('updateTrayMenu')
    ipcMain.on('updateTrayMenu', async () => {
      await updateTrayMenu()
    })
  }
}

function createTrayImage(): Electron.NativeImage {
  return nativeImage.createFromPath(appIcon).resize({ height: trayIconSize })
}

async function updateTrayMenu(): Promise<void> {
  const menu = await buildContextMenu()
  tray?.popUpContextMenu(menu) // 弹出菜单
  if (process.platform === 'linux') {
    tray?.setContextMenu(menu)
  }
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

export async function showTrayIcon(): Promise<void> {
  if (!tray) {
    await createTray()
  }
}

export async function closeTrayIcon(): Promise<void> {
  if (tray) {
    tray.destroy()
  }
  tray = null
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

  const [mihomoConfig, appConfig] = await Promise.all([getControledMihomoConfig(), getAppConfig()])
  const { mode } = mihomoConfig
  const sysProxy = appConfig.sysProxy.enable
  const tunStatus = mihomoConfig.tun?.enable ?? true

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
