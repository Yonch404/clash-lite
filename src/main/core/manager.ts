import { ChildProcess, execFile, spawn } from 'child_process'
import { readFile, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import { existsSync } from 'fs'
import chokidar, { FSWatcher } from 'chokidar'
import { app, ipcMain } from 'electron'
import { mainWindow } from '../window'
import { getAppConfig, getControledMihomoConfig } from '../config'
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
  startMihomoConnections,
  startMihomoLogs,
  startMihomoMemory,
  stopMihomoConnections,
  stopMihomoTraffic,
  stopMihomoLogs,
  stopMihomoMemory,
  patchMihomoConfig,
  getAxios
} from './mihomoApi'
import { generateProfile } from './factory'
import {
  checkTunCorePrivilege,
  getSessionAdminStatus,
  setStopCoreBeforeAdminRestart
} from './permissions'
import {
  cleanupSocketFile,
  cleanupWindowsNamedPipes,
  validateWindowsPipeAccess,
  waitForCoreReady
} from './process'

// 重新导出权限相关函数
export {
  initAdminStatus,
  getSessionAdminStatus,
  checkAdminPrivileges,
  checkHighPrivilegeCore,
  checkTunCorePrivilege,
  restartAsAdmin,
  showErrorDialog
} from './permissions'

export { getDefaultDevice } from './dns'

const execFilePromise = promisify(execFile)
const ctlParam = process.platform === 'win32' ? '-ext-ctl-pipe' : '-ext-ctl-unix'

// 核心进程状态
let child: ChildProcess | null = null
let retry = 10
let isRestarting = false

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
  ipcPath: string
  logLevel: LogLevel
  tunEnabled: boolean
  autoSetDNS: boolean
  cpuPriority: string
  detached: boolean
}

// 准备核心配置
async function prepareCore(detached: boolean, skipStop = false): Promise<CoreConfig> {
  await ensureRuntimeFiles()

  const [appConfig, mihomoConfig] = await Promise.all([getAppConfig(), getControledMihomoConfig()])

  const { diffWorkDir = false, mihomoCpuPriority = 'PRIORITY_NORMAL' } = appConfig
  const core = 'mihomo'

  const { 'log-level': logLevel = 'info' as LogLevel, tun } = mihomoConfig
  if (process.platform === 'win32' && (tun?.enable ?? true) && !getSessionAdminStatus()) {
    throw new Error(i18next.t('tun.error.tunPermissionDenied'))
  }
  if (process.platform === 'linux' && (tun?.enable ?? true)) {
    const hasTunPrivilege = await checkTunCorePrivilege()
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
  await cleanupSocketFile()

  // 获取动态 IPC 路径
  const ipcPath = getMihomoIpcPath()
  managerLogger.info(`Using IPC path: ${ipcPath}`)

  if (process.platform === 'win32') {
    await validateWindowsPipeAccess(ipcPath)
  }

  return {
    corePath: mihomoCorePath(core),
    workDir: diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(),
    ipcPath,
    logLevel,
    tunEnabled: tun?.enable ?? true,
    autoSetDNS: false,
    cpuPriority: mihomoCpuPriority,
    detached
  }
}

// 启动核心进程
function spawnCoreProcess(config: CoreConfig): ChildProcess {
  const { corePath, workDir, ipcPath, cpuPriority, detached } = config

  const proc = spawn(corePath, ['-d', workDir, ctlParam, ipcPath], {
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

// 设置核心进程事件监听
function setupCoreListeners(
  proc: ChildProcess,
  logLevel: LogLevel,
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
      await waitForCoreReady({ maxRetries: 100, retryIntervalMs: 100, throwOnFailure: true })
      await getAxios(true)
      try {
        await patchMihomoConfig({ 'log-level': logLevel })
      } catch (error) {
        managerLogger.warn('Failed to patch log level after core startup:', error)
      }
      await startMihomoTraffic()
      await startMihomoConnections()
      await startMihomoLogs()
      await startMihomoMemory()
      retry = 10
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
      rejectStartup(i18next.t('tun.error.tunPermissionDenied'), true)
      return
    }

    // 控制器监听错误
    const isControllerError =
      (process.platform !== 'win32' && str.includes('External controller unix listen error')) ||
      (process.platform === 'win32' && str.includes('External controller pipe listen error'))

    if (isControllerError) {
      managerLogger.error('External controller listen error detected:', str)

      if (process.platform === 'win32') {
        managerLogger.info('Attempting Windows pipe cleanup and retry...')
        try {
          await cleanupWindowsNamedPipes()
          await new Promise((r) => setTimeout(r, 2000))
        } catch (cleanupError) {
          managerLogger.error('Pipe cleanup failed:', cleanupError)
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

  const proc = spawnCoreProcess(config)
  child = proc

  if (detached) {
    managerLogger.info(
      `Core process detached successfully on ${process.platform}, PID: ${proc.pid}`
    )
    proc.unref()
    return [new Promise(() => {})]
  }

  return new Promise<Promise<void>[]>((resolve, reject) => {
    setupCoreListeners(proc, config.logLevel, resolve, reject)
  })
}

// 停止核心
export async function stopCore(force = false): Promise<void> {
  void force

  if (child) {
    child.removeAllListeners()
    child.kill('SIGINT')
    child = null
  }

  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()

  try {
    await getAxios(true)
  } catch (error) {
    managerLogger.warn('Failed to refresh axios instance:', error)
  }

  await cleanupSocketFile()
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
