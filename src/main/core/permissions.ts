import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import path from 'path'
import { app, dialog } from 'electron'
import { mihomoCorePath, mihomoCoreDir } from '../utils/dirs'
import { managerLogger } from '../utils/logger'
import i18next from '../../shared/i18n'
import { checkAdminPrivileges } from './admin'

const execPromise = promisify(exec)

// 内核名称白名单
const ALLOWED_CORES = ['mihomo'] as const
type AllowedCore = (typeof ALLOWED_CORES)[number]
type StopCoreBeforeAdminRestart = (force?: boolean) => Promise<void>

let stopCoreBeforeAdminRestart: StopCoreBeforeAdminRestart | null = null

export function setStopCoreBeforeAdminRestart(stopCore: StopCoreBeforeAdminRestart): void {
  stopCoreBeforeAdminRestart = stopCore
}

export function isValidCoreName(core: string): core is AllowedCore {
  return ALLOWED_CORES.includes(core as AllowedCore)
}

export function validateCorePath(corePath: string): void {
  if (corePath.includes('..')) {
    throw new Error('Invalid core path: directory traversal detected')
  }

  const dangerousChars = /[;&|`$(){}[\]<>'"\\]/
  if (dangerousChars.test(path.basename(corePath))) {
    throw new Error('Invalid core path: contains dangerous characters')
  }

  const normalizedPath = path.normalize(path.resolve(corePath))
  const expectedDir = path.normalize(path.resolve(mihomoCoreDir()))

  if (!normalizedPath.startsWith(expectedDir + path.sep) && normalizedPath !== expectedDir) {
    throw new Error('Invalid core path: not in expected directory')
  }
}

// 会话管理员状态缓存
let sessionAdminStatus: boolean | null = null

export async function initAdminStatus(): Promise<void> {
  if (process.platform === 'win32' && sessionAdminStatus === null) {
    sessionAdminStatus = await checkAdminPrivileges().catch(() => false)
  }
}

export function getSessionAdminStatus(): boolean {
  if (process.platform !== 'win32') {
    return true
  }
  return sessionAdminStatus ?? false
}

export { checkAdminPrivileges } from './admin'

export async function checkHighPrivilegeCore(): Promise<boolean> {
  try {
    const corePath = mihomoCorePath('mihomo')

    managerLogger.info(`Checking high privilege core: ${corePath}`)

    if (process.platform === 'win32') {
      if (!existsSync(corePath)) {
        managerLogger.info('Core file does not exist')
        return false
      }

      const hasHighPrivilegeProcess = await checkHighPrivilegeMihomoProcess()
      if (hasHighPrivilegeProcess) {
        managerLogger.info('Found high privilege mihomo process running')
        return true
      }

      const isAdmin = await checkAdminPrivileges()
      managerLogger.info(`Current process admin privileges: ${isAdmin}`)
      return isAdmin
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      managerLogger.info('Non-Windows platform, skipping high privilege core check')
      return false
    }
  } catch (error) {
    managerLogger.error('Failed to check high privilege core', error)
    return false
  }

  return false
}

async function checkHighPrivilegeMihomoProcess(): Promise<boolean> {
  const mihomoExecutables = process.platform === 'win32' ? ['mihomo.exe'] : ['mihomo']

  try {
    if (process.platform === 'win32') {
      for (const executable of mihomoExecutables) {
        try {
          const { stdout } = await execPromise(
            `chcp 65001 >nul 2>&1 && tasklist /FI "IMAGENAME eq ${executable}" /FO CSV`,
            { encoding: 'utf8' }
          )
          const lines = stdout.split('\n').filter((line) => line.includes(executable))

          if (lines.length > 0) {
            managerLogger.info(`Found ${lines.length} ${executable} processes running`)

            for (const line of lines) {
              const parts = line.split(',')
              if (parts.length >= 2) {
                const pid = parts[1].replace(/"/g, '').trim()
                try {
                  const { stdout: processInfo } = await execPromise(
                    `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process -Id ${pid} | Select-Object Name,Id,Path,CommandLine | ConvertTo-Json"`,
                    { encoding: 'utf8' }
                  )
                  const processJson = JSON.parse(processInfo)
                  managerLogger.info(`Process ${pid} info: ${processInfo.substring(0, 200)}`)

                  if (processJson.Name.includes('mihomo') && processJson.Path === null) {
                    return true
                  }
                } catch {
                  managerLogger.info(`Cannot get info for process ${pid}, might be high privilege`)
                }
              }
            }
          }
        } catch (error) {
          managerLogger.error(`Failed to check ${executable} processes`, error)
        }
      }
    } else {
      let foundProcesses = false

      for (const executable of mihomoExecutables) {
        try {
          const { stdout } = await execPromise(`ps aux | grep ${executable} | grep -v grep`)
          const lines = stdout
            .split('\n')
            .filter((line) => line.trim() && line.includes(executable))

          if (lines.length > 0) {
            foundProcesses = true
            managerLogger.info(`Found ${lines.length} ${executable} processes running`)

            for (const line of lines) {
              const parts = line.trim().split(/\s+/)
              if (parts.length >= 1) {
                const user = parts[0]
                managerLogger.info(`${executable} process running as user: ${user}`)

                if (user === 'root') {
                  return true
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (!foundProcesses) {
        managerLogger.info('No mihomo processes found running')
      }
    }
  } catch (error) {
    managerLogger.error('Failed to check high privilege mihomo process', error)
  }

  return false
}

export async function restartAsAdmin(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('This function is only available on Windows')
  }

  // 先停止 Core，避免新旧进程冲突
  try {
    managerLogger.info('Stopping core before admin restart...')
    await stopCoreBeforeAdminRestart?.(true)
    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch (error) {
    managerLogger.warn('Failed to stop core before restart:', error)
  }

  const exePath = process.execPath
  const args = process.argv.slice(1).filter((arg) => arg !== '--admin-restart-for-tun')
  const restartArgs = args

  const escapedExePath = exePath.replace(/'/g, "''")
  const argsString = restartArgs.map((arg) => arg.replace(/'/g, "''")).join("', '")

  // 使用 Start-Sleep 延迟启动，确保旧进程完全退出后再启动新进程
  const command =
    restartArgs.length > 0
      ? `powershell -NoProfile -Command "Start-Sleep -Milliseconds 1000; Start-Process -FilePath '${escapedExePath}' -ArgumentList '${argsString}' -Verb RunAs"`
      : `powershell -NoProfile -Command "Start-Sleep -Milliseconds 1000; Start-Process -FilePath '${escapedExePath}' -Verb RunAs"`

  managerLogger.info('Restarting as administrator with command', command)

  // 先启动 PowerShell（它会等待 1 秒），然后立即退出当前进程
  exec(command, { windowsHide: true }, (error) => {
    if (error) {
      managerLogger.error('Failed to start PowerShell for admin restart', error)
    }
  })
  managerLogger.info('PowerShell command started, quitting app immediately')
  app.exit(0)
}

export async function showErrorDialog(title: string, message: string): Promise<void> {
  const okText = i18next.t('common.confirm') || '确认'

  dialog.showMessageBoxSync({
    type: 'error',
    title,
    message,
    buttons: [okText],
    defaultId: 0
  })
}
