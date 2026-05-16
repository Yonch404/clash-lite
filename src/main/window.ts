import { readFile, mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/app-icon.png?asset'
import { getAppConfig } from './config'
import { quitWithoutCore, stopCore } from './core/manager'
import { triggerSysProxy } from './sys/sysproxy'
import { hideDockIcon, showDockIcon } from './resolve/tray'

export let mainWindow: BrowserWindow | null = null
let quitTimeout: NodeJS.Timeout | null = null

const DEFAULT_WINDOW_WIDTH = 800
const DEFAULT_WINDOW_HEIGHT = 600
const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 600
const MIN_STORED_WINDOW_WIDTH = 720
const MIN_STORED_WINDOW_HEIGHT = 520
const WINDOW_STATE_FILE = 'window-state.json'
const SAVE_WINDOW_STATE_DELAY = 150

interface StoredWindowState {
  width: number
  height: number
  x?: number
  y?: number
  displayBounds?: Electron.Rectangle
  isMaximized?: boolean
  isFullScreen?: boolean
}

interface WindowStateController {
  applyState: () => void
  startTracking: () => void
  scheduleSave: (reason: WindowStateSaveReason) => void
  flush: () => Promise<void>
}

type WindowStateSaveReason = 'bounds' | 'position' | 'state'

export async function createWindow(): Promise<void> {
  const {
    useWindowFrame = false,
    silentStart = false,
    autoQuitWithoutCore = false,
    autoQuitWithoutCoreDelay = 60
  } = await getAppConfig()
  const mainWindowState = await readWindowState()
  const restoreState = getRestoreWindowState(mainWindowState)

  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    width: restoreState.width,
    height: restoreState.height,
    show: false,
    frame: useWindowFrame,
    fullscreenable: false,
    titleBarStyle: useWindowFrame ? 'default' : 'hidden',
    titleBarOverlay: useWindowFrame
      ? false
      : {
          height: 49
        },
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      spellcheck: false,
      sandbox: false,
      devTools: true
    }
  })

  restoreWindowBounds(mainWindow, restoreState)
  const windowStateController = createWindowStateController(mainWindow, mainWindowState)
  windowStateController.applyState()

  setupWindowEvents(mainWindow, windowStateController, {
    silentStart,
    autoQuitWithoutCore,
    autoQuitWithoutCoreDelay
  })

  if (is.dev) {
    mainWindow.webContents.openDevTools()
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

interface WindowConfig {
  silentStart: boolean
  autoQuitWithoutCore: boolean
  autoQuitWithoutCoreDelay: number
}

interface RestoreWindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
  isFullScreen?: boolean
}

function setupWindowEvents(
  window: BrowserWindow,
  windowState: WindowStateController,
  config: WindowConfig
): void {
  const { silentStart, autoQuitWithoutCore, autoQuitWithoutCoreDelay } = config

  window.on('ready-to-show', () => {
    if (autoQuitWithoutCore && !window.isVisible()) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay)
    }

    // 开发模式下始终显示窗口
    if (!silentStart || is.dev) {
      clearQuitTimeout()
      window.show()
      window.focusOnWebView()
    }
  })

  window.webContents.on('did-fail-load', () => {
    window.webContents.reload()
  })

  window.on('show', () => {
    showDockIcon()
    setTimeout(() => {
      windowState.startTracking()
    }, SAVE_WINDOW_STATE_DELAY)
  })

  window.on('close', async (event) => {
    event.preventDefault()
    await windowState.flush()
    window.hide()

    const {
      autoQuitWithoutCore = false,
      autoQuitWithoutCoreDelay = 60,
      useDockIcon = true
    } = await getAppConfig()

    if (!useDockIcon) {
      hideDockIcon()
    }

    if (autoQuitWithoutCore) {
      scheduleQuitWithoutCore(autoQuitWithoutCoreDelay)
    }
  })

  window.on('resized', () => {
    windowState.scheduleSave('bounds')
  })

  window.on('unmaximize', () => {
    windowState.scheduleSave('state')
  })

  window.on('maximize', () => {
    windowState.scheduleSave('state')
  })

  window.on('enter-full-screen', () => {
    windowState.scheduleSave('state')
  })

  window.on('leave-full-screen', () => {
    windowState.scheduleSave('state')
  })

  window.on('move', () => {
    windowState.scheduleSave('position')
  })

  window.on('session-end', async () => {
    await triggerSysProxy(false)
    await stopCore()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

function windowStatePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeDimension(value: unknown, min: number, fallback: number): number {
  if (!isFiniteNumber(value) || value <= 0) return fallback
  return Math.max(min, Math.round(value))
}

function normalizeCoordinate(value: unknown): number | undefined {
  return isFiniteNumber(value) ? Math.round(value) : undefined
}

function windowWithinBounds(
  windowBounds: Electron.Rectangle,
  displayBounds: Electron.Rectangle
): boolean {
  return (
    windowBounds.x >= displayBounds.x &&
    windowBounds.y >= displayBounds.y &&
    windowBounds.x + windowBounds.width <= displayBounds.x + displayBounds.width &&
    windowBounds.y + windowBounds.height <= displayBounds.y + displayBounds.height
  )
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function clampWindowIntoDisplay(state: StoredWindowState): StoredWindowState {
  if (!isFiniteNumber(state.x) || !isFiniteNumber(state.y)) return state

  const bounds = {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height
  }
  const display = screen.getDisplayMatching(bounds)
  const restoreWidth = state.width
  const restoreHeight = state.height
  const displayBounds = display.bounds
  const restoreBounds = {
    ...bounds,
    width: restoreWidth,
    height: restoreHeight
  }
  const visible = windowWithinBounds(restoreBounds, displayBounds)

  if (visible) return state

  return {
    ...state,
    x: clamp(state.x, displayBounds.x, displayBounds.x + displayBounds.width - restoreWidth),
    y: clamp(state.y, displayBounds.y, displayBounds.y + displayBounds.height - restoreHeight),
    displayBounds
  }
}

function normalizeWindowState(value: unknown): StoredWindowState {
  const state = typeof value === 'object' && value ? (value as Partial<StoredWindowState>) : {}

  return clampWindowIntoDisplay({
    width: normalizeDimension(state.width, MIN_STORED_WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH),
    height: normalizeDimension(state.height, MIN_STORED_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT),
    x: normalizeCoordinate(state.x),
    y: normalizeCoordinate(state.y),
    displayBounds: state.displayBounds,
    isMaximized: state.isMaximized === true,
    isFullScreen: state.isFullScreen === true
  })
}

async function readWindowState(): Promise<StoredWindowState> {
  try {
    const data = await readFile(windowStatePath(), 'utf-8')
    return normalizeWindowState(JSON.parse(data))
  } catch {
    return normalizeWindowState(undefined)
  }
}

async function writeWindowState(state: StoredWindowState): Promise<void> {
  const filePath = windowStatePath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state), 'utf-8')
}

function getRestoreWindowState(state: StoredWindowState): RestoreWindowState {
  return {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    isMaximized: state.isMaximized,
    isFullScreen: state.isFullScreen
  }
}

function restoreWindowBounds(window: BrowserWindow, state: RestoreWindowState): void {
  if (!isFiniteNumber(state.x) || !isFiniteNumber(state.y)) return

  window.setBounds({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height
  })
}

function getStoredBounds(
  bounds: Electron.Rectangle
): Pick<StoredWindowState, 'height' | 'width' | 'x' | 'y'> {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(MIN_STORED_WINDOW_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_STORED_WINDOW_HEIGHT, Math.round(bounds.height))
  }
}

function getStoredPosition(bounds: Electron.Rectangle): Pick<StoredWindowState, 'x' | 'y'> {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y)
  }
}

function captureWindowState(
  window: BrowserWindow,
  previousState: StoredWindowState,
  reason: WindowStateSaveReason
): StoredWindowState {
  const currentBounds = window.getBounds()
  const displayBounds = screen.getDisplayMatching(currentBounds).bounds
  const nextState: StoredWindowState = {
    ...previousState,
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
    displayBounds
  }

  if (!window.isMinimized() && !window.isFullScreen()) {
    const bounds = window.isMaximized() ? window.getNormalBounds() : currentBounds
    if (reason === 'bounds') {
      Object.assign(nextState, getStoredBounds(bounds))
    } else if (reason === 'position') {
      Object.assign(nextState, getStoredPosition(bounds))
    }
  }

  return nextState
}

function createWindowStateController(
  window: BrowserWindow,
  initialState: StoredWindowState
): WindowStateController {
  let state: StoredWindowState = initialState
  let saveTimer: NodeJS.Timeout | null = null
  let isTrackingUserChanges = false
  let pendingSaveReason: WindowStateSaveReason | null = null

  const saveNow = async (): Promise<void> => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }

    if (!pendingSaveReason) return

    state = captureWindowState(window, state, pendingSaveReason)
    pendingSaveReason = null
    await writeWindowState(state).catch(() => {})
  }

  return {
    applyState: (): void => {
      if (state.isMaximized) {
        window.maximize()
      }
      if (state.isFullScreen) {
        window.setFullScreen(true)
      }
    },
    startTracking: (): void => {
      isTrackingUserChanges = true
    },
    scheduleSave: (reason): void => {
      if (!isTrackingUserChanges || !window.isVisible()) return
      pendingSaveReason = pendingSaveReason === 'bounds' ? 'bounds' : reason
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        void saveNow()
      }, SAVE_WINDOW_STATE_DELAY)
    },
    flush: saveNow
  }
}

function scheduleQuitWithoutCore(delaySeconds: number): void {
  clearQuitTimeout()
  quitTimeout = setTimeout(async () => {
    await quitWithoutCore()
  }, delaySeconds * 1000)
}

export function clearQuitTimeout(): void {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
    quitTimeout = null
  }
}

export function triggerMainWindow(force?: boolean): void {
  if (!mainWindow) return

  getAppConfig()
    .then(({ triggerMainWindowBehavior = 'toggle' }) => {
      if (force === true || triggerMainWindowBehavior === 'toggle') {
        if (mainWindow?.isVisible()) {
          closeMainWindow()
        } else {
          showMainWindow()
        }
      } else {
        showMainWindow()
      }
    })
    .catch(showMainWindow)
}

export function showMainWindow(): void {
  if (mainWindow) {
    clearQuitTimeout()
    mainWindow.show()
    mainWindow.focusOnWebView()
  }
}

export function closeMainWindow(): void {
  mainWindow?.close()
}
