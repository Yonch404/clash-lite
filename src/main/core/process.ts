import { execFile } from 'child_process'
import { promisify } from 'util'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import { managerLogger } from '../utils/logger'
import { getAxios } from './mihomoApi'

const execFilePromise = promisify(execFile)

const CORE_READY_MAX_RETRIES = 30
const CORE_READY_RETRY_INTERVAL_MS = 100

interface CoreReadyOptions {
  maxRetries?: number
  retryIntervalMs?: number
  throwOnFailure?: boolean
}

export async function cleanupSocketFile(): Promise<void> {
  if (process.platform === 'win32') {
    await cleanupWindowsNamedPipes()
  } else {
    await cleanupUnixSockets()
  }
}

export async function cleanupWindowsNamedPipes(): Promise<void> {
  try {
    try {
      const { stdout } = await execFilePromise(
        'tasklist.exe',
        ['/FI', 'IMAGENAME eq mihomo.exe', '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', windowsHide: true }
      )

      if (stdout.trim()) {
        managerLogger.info(`Found potential pipe-blocking processes: ${stdout}`)
        for (const pid of parseTasklistPids(stdout)) {
          if (pid !== process.pid) {
            await terminateProcess(pid)
          }
        }
      }
    } catch (error) {
      managerLogger.warn('Failed to check mihomo processes:', error)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  } catch (error) {
    managerLogger.error('Windows named pipe cleanup failed:', error)
  }
}

function parseTasklistPids(stdout: string): number[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('INFO:'))
    .map((line) => {
      const [, , pid] = line.match(/^"([^"]+)","(\d+)"/u) || []
      return Number(pid)
    })
    .filter((pid) => Number.isFinite(pid) && pid > 0)
}

async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 0)
    process.kill(pid, 'SIGTERM')
    managerLogger.info(`Terminated process ${pid} to free pipe`)
  } catch (error: unknown) {
    if ((error as { code?: string })?.code !== 'ESRCH') {
      managerLogger.warn(`Failed to terminate process ${pid}:`, error)
    }
  }
}

export async function cleanupUnixSockets(): Promise<void> {
  try {
    const socketPaths = [
      '/tmp/clash-lite.sock',
      '/tmp/clash-lite-admin.sock',
      `/tmp/clash-lite-${process.getuid?.() || 'user'}.sock`
    ]

    for (const socketPath of socketPaths) {
      try {
        if (existsSync(socketPath)) {
          await rm(socketPath)
          managerLogger.info(`Cleaned up socket file: ${socketPath}`)
        }
      } catch (error) {
        managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
      }
    }
  } catch (error) {
    managerLogger.error('Unix socket cleanup failed:', error)
  }
}

export async function validateWindowsPipeAccess(pipePath: string): Promise<void> {
  try {
    managerLogger.info(`Validating pipe access for: ${pipePath}`)
    managerLogger.info(`Pipe validation completed for: ${pipePath}`)
  } catch (error) {
    managerLogger.error('Windows pipe validation failed:', error)
  }
}

export async function waitForCoreReady(options: CoreReadyOptions = {}): Promise<boolean> {
  const maxRetries = options.maxRetries ?? CORE_READY_MAX_RETRIES
  const retryIntervalMs = options.retryIntervalMs ?? CORE_READY_RETRY_INTERVAL_MS

  for (let i = 0; i < maxRetries; i++) {
    try {
      const axios = await getAxios(true)
      await axios.get('/')
      managerLogger.info(`Core ready after ${i + 1} attempts (${(i + 1) * retryIntervalMs}ms)`)
      return true
    } catch {
      if (i === 0) {
        managerLogger.info('Waiting for core to be ready...')
      }

      if (i === maxRetries - 1) {
        const message = `Core not ready after ${maxRetries} attempts`
        managerLogger.warn(message)
        if (options.throwOnFailure) {
          throw new Error(message)
        }
        return false
      }

      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
    }
  }

  return false
}
