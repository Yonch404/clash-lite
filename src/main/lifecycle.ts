import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import { existsSync } from 'fs'
import { app, powerMonitor } from 'electron'
import { stopCore, cleanupCoreWatcher } from './core/manager'
import { triggerSysProxy, disableSysProxySync } from './sys/sysproxy'
import { exePath } from './utils/dirs'
import { abortPendingRequests } from './utils/chromeRequest'
import { createLogger } from './utils/logger'

const lifecycleLogger = createLogger('lifecycle')
const shutdownNetworkErrorCodes = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ECANCELED',
  'ERR_STREAM_PREMATURE_CLOSE'
])

function isShutdownNetworkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code && shutdownNetworkErrorCodes.has(code)) return true

  const message = error instanceof Error ? error.message : String(error)
  return /(?:read )?ECONNRESET|socket hang up|premature close/i.test(message)
}

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
${process.argv.join(' ')} & disown
exit
`
  spawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore'
  })
}

export async function fixUserDataPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) return

  try {
    const stats = await stat(userDataPath)
    const currentUid = process.getuid?.() || 0

    if (stats.uid === 0 && currentUid !== 0) {
      const execPromise = promisify(exec)
      const username = process.env.USER || process.env.LOGNAME
      if (username) {
        await execPromise(`chown -R "${username}:staff" "${userDataPath}"`)
        await execPromise(`chmod -R u+rwX "${userDataPath}"`)
      }
    }
  } catch {
    // ignore
  }
}

export function setupPlatformSpecifics(): void {
  if (process.platform === 'linux') {
    app.relaunch = customRelaunch
  }

  // https://github.com/electron/electron/issues/43278
  // https://github.com/electron/electron/issues/36698
  const electronMajor = parseInt(process.versions.electron.split('.')[0], 10) || 0
  if (process.platform === 'win32' && !exePath().startsWith('C') && electronMajor < 38) {
    app.commandLine.appendSwitch('in-process-gpu')
  }
}

export function setupAppLifecycle(): void {
  let sysProxyDisabled = false
  let isQuitting = false
  let shutdownErrorHandlersInstalled = false

  const handleShutdownUncaughtException = (error: Error): void => {
    if (isShutdownNetworkError(error)) {
      void lifecycleLogger.debug('Ignored network reset during shutdown', error)
      return
    }

    process.removeListener('uncaughtException', handleShutdownUncaughtException)
    process.removeListener('unhandledRejection', handleShutdownUnhandledRejection)
    throw error
  }

  const handleShutdownUnhandledRejection = (reason: unknown): void => {
    if (isShutdownNetworkError(reason)) {
      void lifecycleLogger.debug('Ignored rejected network request during shutdown', reason)
      return
    }

    process.removeListener('uncaughtException', handleShutdownUncaughtException)
    process.removeListener('unhandledRejection', handleShutdownUnhandledRejection)
    throw reason instanceof Error ? reason : new Error(String(reason))
  }

  const installShutdownErrorHandlers = (): void => {
    if (shutdownErrorHandlersInstalled) return

    shutdownErrorHandlersInstalled = true
    process.on('uncaughtException', handleShutdownUncaughtException)
    process.on('unhandledRejection', handleShutdownUnhandledRejection)
  }

  const withTimeout = async (promise: Promise<void>, timeout: number): Promise<void> => {
    let timeoutId: NodeJS.Timeout | null = null

    try {
      await Promise.race([
        promise,
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, timeout)
        })
      ])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  const cleanupBeforeExit = async (): Promise<void> => {
    if (isQuitting) return
    isQuitting = true
    installShutdownErrorHandlers()

    cleanupCoreWatcher()
    abortPendingRequests()

    if (process.platform !== 'darwin') {
      disableSysProxySync()
      sysProxyDisabled = true
    }

    await withTimeout(
      Promise.allSettled([
        triggerSysProxy(false).then(() => {
          sysProxyDisabled = true
        }),
        stopCore()
      ]).then(() => {}),
      3000
    )
  }

  app.on('before-quit', async (e) => {
    e.preventDefault()
    await cleanupBeforeExit()
    app.exit()
  })

  powerMonitor.on('shutdown', async () => {
    await cleanupBeforeExit()
    app.exit()
  })

  app.on('will-quit', () => {
    if (!sysProxyDisabled) {
      disableSysProxySync()
    }
  })
}

export function getSystemLanguage(): 'zh-CN' | 'en-US' {
  const locale = app.getLocale()
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}
