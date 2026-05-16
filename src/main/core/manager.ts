import { ChildProcess, execFile, spawn } from 'child_process'
import { readFile, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import { existsSync } from 'fs'
import chokidar, { FSWatcher } from 'chokidar'
import { app, ipcMain } from 'electron'
import { mainWindow } from '../window'
import { getAppConfig, getControledMihomoConfig, hasUsableCurrentProfile } from '../config'
import {
  dataDir,
  coreLogPath,
  mihomoCoreDir,
  mihomoCorePath,
  mihomoProfileWorkDir,
  mihomoTestDir,
  mihomoWorkConfigPath,
  mihomoWorkDir
} from '../utils/dirs'
import { startMonitor } from '../resolve/trafficMonitor'
import { ensureRuntimeFiles, safeShowErrorBox } from '../utils/init'
import i18next from '../../shared/i18n'
import { managerLogger } from '../utils/logger'
import { createCappedLogWritableStream } from '../utils/logFile'
import {
  startMihomoTraffic,
  startMihomoMemory,
  stopMihomoConnections,
  stopMihomoTraffic,
  stopMihomoLogs,
  stopMihomoMemory,
  startSubscribedMihomoStreams,
  getAxios
} from './mihomoApi'
import { generateProfile } from './factory'
import {
  ensureTunCorePrivilege,
  getSessionAdminStatus,
  setStopCoreBeforeAdminRestart
} from './permissions'
import { cleanupSocketFile, waitForCoreReady } from './process'
import {
  getWindowsControllerEndpoint,
  startWindowsElevatedCore,
  stopWindowsElevatedCore,
  type WindowsCoreHelperRequest
} from './windowsElevated'
import {
  getLinuxControllerEndpoint,
  shouldUseLinuxElevatedCoreHelper,
  startLinuxElevatedCore,
  stopLinuxElevatedCore,
  type LinuxCoreHelperRequest
} from './linuxElevated'

// 重新导出权限相关函数
export {
  initAdminStatus,
  getSessionAdminStatus,
  checkAdminPrivileges,
  checkHighPrivilegeCore,
  checkTunCorePrivilege,
  ensureTunCorePrivilege,
  restartAsAdmin,
  showErrorDialog
} from './permissions'

export { getDefaultDevice } from './dns'

const execFilePromise = promisify(execFile)
const unixCtlParam = '-ext-ctl-unix'

// 核心进程状态
let child: ChildProcess | null = null
let retry = 10
let isRestarting = false
let coreLaunchMode: 'local' | 'windows-elevated-task' | 'linux-elevated-helper' | null = null

// 文件监听器
let coreWatcher: FSWatcher | null = null

function hasCoreProcess(): boolean {
  return Boolean(child && !child.killed && child.exitCode === null && child.signalCode === null)
}

// 初始化核心文件监听
export function initCoreWatcher(): void {
  if (coreWatcher) return

  coreWatcher = chokidar.watch(path.join(mihomoCoreDir(), 'meta-update'), {})
  coreWatcher.on('unlinkDir', async () => {
    // 等待核心自我更新完成，避免与核心自动重启产生竞态
    await new Promise((resolve) => setTimeout(resolve, 3000))
    try {
      const [mihomoConfig, profileUsable] = await Promise.all([
        getControledMihomoConfig(),
        hasUsableCurrentProfile()
      ])
      if (
        process.platform === 'linux' &&
        profileUsable &&
        (mihomoConfig.tun?.enable ?? true) &&
        !shouldUseLinuxElevatedCoreHelper()
      ) {
        await ensureTunCorePrivilege({ prompt: true })
      }
      await stopCore(true)
      await startCore()
    } catch (e) {
      safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
    }
  })

  // 监听 restartCore 事件（用于 DNS 状态恢复等场景，避免循环依赖）
  ipcMain.removeAllListeners('restartCore')
  ipcMain.on('restartCore', async () => {
    await restartCore()
    mainWindow?.webContents.send('appConfigUpdated')
  })
}

// 清理核心文件监听
export function cleanupCoreWatcher(): void {
  if (coreWatcher) {
    coreWatcher.close()
    coreWatcher = null
  }
}

// 动态生成 IPC 路径
export const getMihomoIpcPath = (): string => {
  if (process.platform === 'win32') {
    const isAdmin = getSessionAdminStatus()
    const sessionId = process.env.SESSIONNAME || process.env.USERNAME || 'default'
    const processId = process.pid

    return isAdmin
      ? `\\\\.\\pipe\\ClashLite\\mihomo-admin-${sessionId}-${processId}`
      : `\\\\.\\pipe\\ClashLite\\mihomo-user-${sessionId}-${processId}`
  }

  const uid = process.getuid?.() || 'unknown'
  const processId = process.pid
  return `/tmp/clash-lite-${uid}-${processId}.sock`
}

// 核心配置接口
interface CoreConfig {
  corePath: string
  workDir: string
  configPath: string
  controllerParam: string
  controllerAddress: string
  controllerSecret?: string
  tunEnabled: boolean
  autoSetDNS: boolean
  cpuPriority: string
  detached: boolean
  useWindowsElevatedTask: boolean
  useLinuxElevatedHelper: boolean
}

// 准备核心配置
async function prepareCore(detached: boolean, skipStop = false): Promise<CoreConfig> {
  await ensureRuntimeFiles()

  const [appConfig, mihomoConfig, profileUsable] = await Promise.all([
    getAppConfig(),
    getControledMihomoConfig(),
    hasUsableCurrentProfile()
  ])

  const { diffWorkDir = false, mihomoCpuPriority = 'PRIORITY_NORMAL' } = appConfig
  const core = 'mihomo'

  const { tun } = mihomoConfig
  const tunEnabled = profileUsable && (tun?.enable ?? true)
  const useWindowsElevatedTask =
    process.platform === 'win32' && tunEnabled && !getSessionAdminStatus()
  const useLinuxElevatedHelper =
    process.platform === 'linux' && tunEnabled && shouldUseLinuxElevatedCoreHelper()

  if (process.platform === 'linux' && tunEnabled && !useLinuxElevatedHelper) {
    const hasTunPrivilege = await ensureTunCorePrivilege({ prompt: true })
    if (!hasTunPrivilege) {
      throw new Error(i18next.t('tun.error.linuxTunPermissionDenied'))
    }
  }

  // 清理旧进程
  const pidPaths = [path.join(dataDir(), 'core.pid')]
  for (const pidPath of pidPaths) {
    if (existsSync(pidPath)) {
      const pid = parseInt(await readFile(pidPath, 'utf-8'), 10)
      try {
        if (!Number.isNaN(pid) && pid !== process.pid) {
          process.kill(pid, 'SIGINT')
        }
      } catch {
        // ignore
      } finally {
        await rm(pidPath, { force: true })
      }
    }
  }

  // generateProfile 返回实际使用的 current
  const current = await generateProfile()
  await checkProfile(current, core, diffWorkDir)
  if (!skipStop && hasCoreProcess()) {
    await stopCore()
  }
  if (process.platform !== 'win32') {
    await cleanupSocketFile()
  }

  const windowsController =
    process.platform === 'win32' ? await getWindowsControllerEndpoint() : undefined
  const linuxController = useLinuxElevatedHelper ? await getLinuxControllerEndpoint() : undefined
  const controllerParam = windowsController || linuxController ? '-ext-ctl' : unixCtlParam
  const controllerAddress = windowsController
    ? `${windowsController.host}:${windowsController.port}`
    : linuxController
      ? `${linuxController.host}:${linuxController.port}`
      : getMihomoIpcPath()
  const workDir = diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir()
  const configPath = diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work')

  managerLogger.info(`Using controller: ${controllerAddress}`)

  return {
    corePath: mihomoCorePath(core),
    workDir,
    configPath,
    controllerParam,
    controllerAddress,
    controllerSecret: windowsController?.secret || linuxController?.secret,
    tunEnabled,
    autoSetDNS: false,
    cpuPriority: mihomoCpuPriority,
    detached,
    useWindowsElevatedTask,
    useLinuxElevatedHelper
  }
}

// 启动核心进程
function spawnCoreProcess(config: CoreConfig): ChildProcess {
  const {
    corePath,
    workDir,
    controllerParam,
    controllerAddress,
    controllerSecret,
    cpuPriority,
    detached
  } = config

  const args = ['-d', workDir, controllerParam, controllerAddress]
  if (controllerSecret) {
    args.push('-secret', controllerSecret)
  }

  const proc = spawn(corePath, args, {
    detached,
    stdio: detached ? 'ignore' : undefined
  })

  if (process.platform === 'win32' && proc.pid) {
    os.setPriority(
      proc.pid,
      os.constants.priority[cpuPriority as keyof typeof os.constants.priority]
    )
  }

  if (!detached) {
    const stdout = createCappedLogWritableStream(coreLogPath())
    const stderr = createCappedLogWritableStream(coreLogPath())
    proc.stdout?.pipe(stdout)
    proc.stderr?.pipe(stderr)
  }

  return proc
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function getTunInet4Addresses(tun: Partial<IMihomoTunConfig>): string[] {
  const value = (tun as { 'inet4-address'?: unknown })['inet4-address']

  if (Array.isArray(value)) {
    return value
      .filter((address): address is string => typeof address === 'string')
      .map((address) => address.split('/')[0])
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return [value.split('/')[0]].filter(Boolean)
  }

  return []
}

function getTunDevice(tun: Partial<IMihomoTunConfig>): string {
  return tun.device || 'Mihomo'
}

async function hasWindowsTunNetworkState(tun: Partial<IMihomoTunConfig>): Promise<boolean> {
  const address = getTunInet4Addresses(tun)[0]
  const device = getTunDevice(tun)
  const shouldHaveRoute = tun['auto-route'] === true
  if (!address) return false

  try {
    const { stdout } = await execFilePromise(
      'netsh.exe',
      ['interface', 'ipv4', 'show', 'addresses', `name=${device}`],
      { encoding: 'utf8', windowsHide: true }
    )
    if (!String(stdout).includes(address)) return false
  } catch (error) {
    managerLogger.warn('Failed to query Windows TUN address with netsh:', error)
    return false
  }

  if (!shouldHaveRoute) return true

  try {
    const { stdout } = await execFilePromise('route.exe', ['print'], {
      encoding: 'utf8',
      windowsHide: true
    })
    return String(stdout)
      .split(/\r?\n/u)
      .some((line) => {
        const ips = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu) || []
        return ips.length >= 4 && ips[ips.length - 1] === address
      })
  } catch (error) {
    managerLogger.warn('Failed to query Windows TUN route table:', error)
    return false
  }
}

async function execLinuxIp(args: string[]): Promise<string> {
  const candidates = ['ip', '/usr/sbin/ip', '/sbin/ip', '/usr/bin/ip', '/bin/ip']
  let lastError: unknown

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFilePromise(candidate, args, {
        encoding: 'utf8',
        windowsHide: true
      })
      return String(stdout)
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  throw lastError
}

function hasLinuxTunAddress(output: string, addresses: string[]): boolean {
  if (addresses.length === 0) {
    return /\binet\s+(?:\d{1,3}\.){3}\d{1,3}\//u.test(output)
  }

  return addresses.some(
    (address) => output.includes(` ${address}/`) || output.includes(` ${address} `)
  )
}

function isLinuxTunRouteLine(line: string, device: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  if (/^(broadcast|local|blackhole|unreachable|prohibit|throw)\b/u.test(trimmed)) {
    return false
  }

  if (trimmed.includes(' proto kernel ') && trimmed.includes(' scope link ')) {
    return false
  }

  return new RegExp(`\\bdev\\s+${escapeRegExp(device)}(?:\\s|$)`, 'u').test(trimmed)
}

function getLinuxTunRouteTables(routeOutput: string, device: string): string[] {
  return routeOutput
    .split(/\r?\n/u)
    .filter((line) => isLinuxTunRouteLine(line, device))
    .map((line) => line.match(/\btable\s+(\S+)/u)?.[1] || 'main')
}

function hasLinuxTunRouteRule(ruleOutput: string, table: string): boolean {
  return new RegExp(`\\blookup\\s+${escapeRegExp(table)}(?:\\s|$)`, 'u').test(ruleOutput)
}

async function hasLinuxTunNetworkState(tun: Partial<IMihomoTunConfig>): Promise<boolean> {
  const addresses = getTunInet4Addresses(tun)
  const device = getTunDevice(tun)
  const shouldHaveRoute = tun['auto-route'] === true

  try {
    const addressOutput = await execLinuxIp(['-o', '-4', 'addr', 'show', 'dev', device])
    if (!hasLinuxTunAddress(addressOutput, addresses)) return false
  } catch (error) {
    managerLogger.warn('Failed to query Linux TUN address with ip:', error)
    return false
  }

  if (!shouldHaveRoute) return true

  try {
    const routeOutput = await execLinuxIp(['-4', 'route', 'show', 'table', 'all'])
    const routeTables = getLinuxTunRouteTables(routeOutput, device)
    if (routeTables.length === 0) return false

    const customRouteTables = routeTables.filter(
      (table) => !['default', 'local', 'main'].includes(table)
    )
    if (customRouteTables.length === 0) return true

    const ruleOutput = await execLinuxIp(['-4', 'rule', 'show'])
    return customRouteTables.some((table) => hasLinuxTunRouteRule(ruleOutput, table))
  } catch (error) {
    managerLogger.warn('Failed to query Linux route table with ip:', error)
    return false
  }
}

async function isWindowsTunReady(): Promise<boolean> {
  try {
    const instance = await getAxios()
    const config = (await instance.get('/configs')) as Partial<IMihomoConfig>
    const tun = config.tun
    if (!tun?.enable) return false

    return await hasWindowsTunNetworkState(tun)
  } catch (error) {
    managerLogger.warn('Failed to query Windows TUN runtime status:', error)
    return false
  }
}

async function isLinuxTunReady(): Promise<boolean> {
  try {
    const instance = await getAxios()
    const config = (await instance.get('/configs')) as Partial<IMihomoConfig>
    const tun = config.tun
    if (!tun?.enable) return false

    return await hasLinuxTunNetworkState(tun)
  } catch (error) {
    managerLogger.warn('Failed to query Linux TUN runtime status:', error)
    return false
  }
}

async function waitForWindowsTunReady(maxRetries = 10): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await isWindowsTunReady()) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

async function waitForLinuxTunReady(maxRetries = 10): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await isLinuxTunReady()) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

async function forceReloadRuntimeConfig(configPath: string): Promise<void> {
  const instance = await getAxios()
  await instance.put('/configs?force=true', { path: configPath })
}

async function ensureWindowsTunReady(config: CoreConfig): Promise<void> {
  if (process.platform !== 'win32' || !config.tunEnabled) return

  if (await waitForWindowsTunReady()) return

  managerLogger.warn(
    'Windows TUN did not become ready after core API startup, forcing runtime config reload'
  )

  try {
    await forceReloadRuntimeConfig(config.configPath)
  } catch (error) {
    managerLogger.warn('Failed to force reload runtime config for Windows TUN:', error)
  }

  if (await waitForWindowsTunReady(15)) return

  throw new Error(i18next.t('tun.error.tunPermissionDenied'))
}

async function ensureLinuxTunReady(config: CoreConfig): Promise<void> {
  if (process.platform !== 'linux' || !config.tunEnabled) return

  if (await waitForLinuxTunReady()) return

  managerLogger.warn(
    'Linux TUN did not become ready after core API startup, forcing runtime config reload'
  )

  try {
    await forceReloadRuntimeConfig(config.configPath)
  } catch (error) {
    managerLogger.warn('Failed to force reload runtime config for Linux TUN:', error)
  }

  if (await waitForLinuxTunReady(15)) return

  throw new Error(i18next.t('tun.error.linuxTunPermissionDenied'))
}

async function startMihomoRuntimeServices(config: CoreConfig): Promise<void> {
  await waitForCoreReady({ maxRetries: 100, retryIntervalMs: 100, throwOnFailure: true })
  await getAxios(true)
  await ensureWindowsTunReady(config)
  await ensureLinuxTunReady(config)
  await startMihomoTraffic()
  await startMihomoMemory()
  await startSubscribedMihomoStreams()
  retry = 10
}

function createTimedProviderReadyPromise(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      mainWindow?.webContents.send('groupsUpdated')
      resolve()
    }, 2000)
  })
}

// 设置核心进程事件监听
function setupCoreListeners(
  proc: ChildProcess,
  config: CoreConfig,
  resolve: (value: Promise<void>[]) => void,
  reject: (reason: unknown) => void
): void {
  let startupSettled = false
  let skipAutoRestart = false
  let startupTask: Promise<void> | null = null

  const resolveStartup = (value: Promise<void>[]): void => {
    if (startupSettled) return
    startupSettled = true
    resolve(value)
  }

  const rejectStartup = (reason: unknown, preventAutoRestart = false): void => {
    if (preventAutoRestart) {
      skipAutoRestart = true
    }
    if (startupSettled) return
    startupSettled = true
    reject(reason)
  }

  const createProviderReadyPromise = (): Promise<void> => {
    return new Promise((innerResolve) => {
      let settled = false

      function cleanup(): void {
        clearTimeout(timeoutId)
        proc.stdout?.off('data', onOutput)
        proc.stderr?.off('data', onOutput)
      }
      function finish(): void {
        if (settled) return
        settled = true
        cleanup()
        mainWindow?.webContents.send('groupsUpdated')
        innerResolve()
      }
      function onOutput(innerData: Buffer): void {
        if (
          innerData.toString().toLowerCase().includes('start initial compatible provider default')
        ) {
          finish()
        }
      }

      const timeoutId = setTimeout(finish, 2000)
      proc.stdout?.on('data', onOutput)
      proc.stderr?.on('data', onOutput)
    })
  }

  const startRuntimeServices = (): void => {
    if (startupTask) return

    startupTask = (async () => {
      await startMihomoRuntimeServices(config)
      resolveStartup([createProviderReadyPromise()])
    })()

    startupTask.catch((error) => {
      rejectStartup(error)
    })
  }

  const handleCoreOutput = async (data: Buffer): Promise<void> => {
    const str = data.toString()

    // TUN 权限错误
    if (str.includes('configure tun interface: operation not permitted')) {
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      rejectStartup(
        process.platform === 'linux'
          ? i18next.t('tun.error.linuxTunPermissionDenied')
          : i18next.t('tun.error.tunPermissionDenied'),
        true
      )
      return
    }

    // 控制器监听错误
    const isControllerError =
      (process.platform !== 'win32' && str.includes('External controller unix listen error')) ||
      (process.platform === 'win32' && str.includes('External controller listen error'))

    if (isControllerError) {
      managerLogger.error('External controller listen error detected:', str)

      if (process.platform === 'win32') {
        managerLogger.info('Attempting Windows pipe cleanup and retry...')
        try {
          await stopWindowsElevatedCore()
          await new Promise((r) => setTimeout(r, 2000))
        } catch (cleanupError) {
          managerLogger.error('Windows elevated core cleanup failed:', cleanupError)
        }
      }

      rejectStartup(i18next.t('mihomo.error.externalControllerListenError'), true)
      return
    }

    // API 就绪
    const isApiReady =
      (process.platform !== 'win32' && str.includes('RESTful API unix listening at')) ||
      (process.platform === 'win32' && str.includes('RESTful API pipe listening at'))

    if (isApiReady) {
      startRuntimeServices()
    }
  }

  proc.on('close', async (code, signal) => {
    managerLogger.info(`Core closed, code: ${code}, signal: ${signal}`)

    if (child === proc) {
      child = null
    }

    if (skipAutoRestart) {
      return
    }

    if (isRestarting) {
      managerLogger.info('Core closed during restart, skipping auto-restart')
      return
    }

    if (!startupSettled) {
      rejectStartup(
        `${i18next.t('mihomo.error.coreStartFailed')}: ${code ?? signal ?? 'unknown'}`,
        true
      )
      return
    }

    if (retry) {
      managerLogger.info('Try Restart Core')
      retry--
      await restartCore()
    } else {
      await stopCore()
    }
  })

  proc.stdout?.on('data', handleCoreOutput)
  proc.stderr?.on('data', handleCoreOutput)
  startRuntimeServices()
}

// 启动核心
export async function startCore(detached = false, skipStop = false): Promise<Promise<void>[]> {
  const config = await prepareCore(detached, skipStop)

  if (config.useWindowsElevatedTask) {
    const [controllerHost, controllerPort] = config.controllerAddress.split(':')
    const request: WindowsCoreHelperRequest = {
      corePath: config.corePath,
      workDir: config.workDir,
      controllerHost,
      controllerPort: Number(controllerPort),
      secret: config.controllerSecret || '',
      logPath: coreLogPath(),
      cpuPriority: config.cpuPriority,
      createdAt: Date.now()
    }

    await startWindowsElevatedCore(request)
    coreLaunchMode = 'windows-elevated-task'
    child = null
    await startMihomoRuntimeServices(config)
    return [createTimedProviderReadyPromise()]
  }

  if (config.useLinuxElevatedHelper) {
    const [controllerHost, controllerPort] = config.controllerAddress.split(':')
    const request: LinuxCoreHelperRequest = {
      workDir: config.workDir,
      controllerHost,
      controllerPort: Number(controllerPort),
      secret: config.controllerSecret || '',
      logPath: coreLogPath(),
      createdAt: Date.now()
    }

    await startLinuxElevatedCore(request)
    coreLaunchMode = 'linux-elevated-helper'
    child = null
    await startMihomoRuntimeServices(config)
    return [createTimedProviderReadyPromise()]
  }

  if (process.platform === 'win32') {
    await stopWindowsElevatedCore()
  }

  const proc = spawnCoreProcess(config)
  child = proc
  coreLaunchMode = 'local'

  if (detached) {
    managerLogger.info(
      `Core process detached successfully on ${process.platform}, PID: ${proc.pid}`
    )
    proc.unref()
    return [new Promise(() => {})]
  }

  return new Promise<Promise<void>[]>((resolve, reject) => {
    setupCoreListeners(proc, config, resolve, reject)
  })
}

// 停止核心
export async function stopCore(force = false): Promise<void> {
  void force

  if (coreLaunchMode === 'windows-elevated-task') {
    await stopWindowsElevatedCore()
  } else if (coreLaunchMode === 'linux-elevated-helper') {
    await stopLinuxElevatedCore()
  } else if (child) {
    child.removeAllListeners()
    child.kill('SIGINT')
    child = null
  }
  coreLaunchMode = null

  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()

  try {
    await getAxios(true)
  } catch (error) {
    managerLogger.warn('Failed to refresh axios instance:', error)
  }

  if (process.platform !== 'win32') {
    await cleanupSocketFile()
  }
}

setStopCoreBeforeAdminRestart(stopCore)

// 重启核心
export async function restartCore(): Promise<void> {
  if (isRestarting) {
    managerLogger.info('Core restart already in progress, skipping duplicate request')
    return
  }

  isRestarting = true
  let retryCount = 0
  const maxRetries = 3

  try {
    // 先显式停止核心，确保状态干净
    await stopCore()

    // 尝试启动核心，失败时重试
    while (retryCount < maxRetries) {
      try {
        // skipStop=true 因为我们已经在上面停止了核心
        await startCore(false, true)
        return // 成功启动，退出函数
      } catch (e) {
        retryCount++
        managerLogger.error(`restart core failed (attempt ${retryCount}/${maxRetries})`, e)

        if (retryCount >= maxRetries) {
          throw e
        }

        // 重试前等待一段时间
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount))
        // 确保清理干净再重试
        await stopCore()
        await cleanupSocketFile()
      }
    }
  } finally {
    isRestarting = false
  }
}

// 保持核心运行
export async function keepCoreAlive(): Promise<void> {
  try {
    await startCore(true)
    if (child?.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
    }
  } catch (e) {
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }
}

// 退出但保持核心运行
export async function quitWithoutCore(): Promise<void> {
  managerLogger.info(`Starting lightweight mode on platform: ${process.platform}`)

  try {
    await startCore(true)
    if (child?.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
      managerLogger.info(`Core started in lightweight mode with PID: ${child.pid}`)
    }
  } catch (e) {
    managerLogger.error('Failed to start core in lightweight mode:', e)
    safeShowErrorBox('mihomo.error.coreStartFailed', `${e}`)
  }

  await startMonitor(true)
  managerLogger.info('Exiting main process, core will continue running in background')
  app.exit()
}

// 检查配置文件
async function checkProfile(
  current: string | undefined,
  core: string = 'mihomo',
  diffWorkDir: boolean = false
): Promise<void> {
  const corePath = mihomoCorePath(core)

  try {
    await execFilePromise(corePath, [
      '-t',
      '-f',
      diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
      '-d',
      mihomoTestDir()
    ])
  } catch (error) {
    managerLogger.error('Profile check failed', error)

    if (error instanceof Error && 'stdout' in error) {
      const { stdout, stderr } = error as { stdout: string; stderr?: string }
      managerLogger.info('Profile check stdout', stdout)
      managerLogger.info('Profile check stderr', stderr)

      const errorLines = stdout
        .split('\n')
        .filter((line) => line.includes('level=error') || line.includes('error'))
        .map((line) => {
          if (line.includes('level=error')) {
            return line.split('level=error')[1]?.trim() || line
          }
          return line.trim()
        })
        .filter((line) => line.length > 0)

      if (errorLines.length === 0) {
        const allLines = stdout.split('\n').filter((line) => line.trim().length > 0)
        throw new Error(`${i18next.t('mihomo.error.profileCheckFailed')}:\n${allLines.join('\n')}`)
      } else {
        throw new Error(
          `${i18next.t('mihomo.error.profileCheckFailed')}:\n${errorLines.join('\n')}`
        )
      }
    } else {
      throw new Error(`${i18next.t('mihomo.error.profileCheckFailed')}: ${error}`)
    }
  }
}
