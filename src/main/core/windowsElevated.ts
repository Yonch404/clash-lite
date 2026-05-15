import { ChildProcess, execFile, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { app, dialog } from 'electron'
import i18next from 'i18next'
import {
  dataDir,
  exePath,
  windowsControllerSecretPath,
  windowsCoreHelperPidPath,
  windowsCoreHelperRequestPath
} from '../utils/dirs'
import { createCappedLogWritableStream } from '../utils/logFile'
import { managerLogger } from '../utils/logger'
import { checkAdminPrivileges } from './admin'

const execFilePromise = promisify(execFile)

const WINDOWS_CORE_TASK_NAME = 'ClashLiteCore'
const WINDOWS_CONTROLLER_HOST = '127.0.0.1'
const WINDOWS_CONTROLLER_PORT = 19090
const CORE_HELPER_ARG = '--clash-lite-core-helper'
const ADMIN_RESTART_ARG = '--admin-restart-for-tun'

export interface WindowsCoreHelperRequest {
  corePath: string
  workDir: string
  controllerHost: string
  controllerPort: number
  secret: string
  logPath: string
  cpuPriority: string
  createdAt: number
}

export interface WindowsControllerEndpoint {
  host: string
  port: number
  secret: string
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

function getPowerShellCandidates(): string[] {
  const candidates: string[] = []
  const systemRoot = process.env.SystemRoot || process.env.WINDIR

  if (systemRoot) {
    candidates.push(
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    )
  }

  candidates.push('powershell.exe', 'pwsh.exe')
  return candidates
}

function quoteWindowsArgument(value: string): string {
  if (!/[\s"]/u.test(value)) return value

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, '$&$&')}"`
}

function getTaskWorkingDirectory(): string {
  return process.defaultApp ? app.getAppPath() : path.dirname(exePath())
}

function isSamePath(left: string, right: string): boolean {
  try {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  } catch {
    return false
  }
}

function hasExplicitElectronAppArgument(args: string[]): boolean {
  if (!process.defaultApp) return true

  const appPath = app.getAppPath()
  return args.some((arg) => {
    if (!arg || arg.startsWith('-')) return false
    return isSamePath(arg, appPath)
  })
}

function getHelperTaskArguments(): string {
  const args = process.argv
    .slice(1)
    .filter((arg) => arg !== CORE_HELPER_ARG && arg !== ADMIN_RESTART_ARG)

  if (process.defaultApp && !hasExplicitElectronAppArgument(args)) {
    args.unshift(app.getAppPath())
  }

  args.push(CORE_HELPER_ARG)
  return args.map(quoteWindowsArgument).join(' ')
}

function getTaskXml(): string {
  const helperArguments = getHelperTaskArguments()
  const workingDirectory = getTaskWorkingDirectory()

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs the Clash Lite Mihomo core with elevated privileges for TUN mode.</Description>
  </RegistrationInfo>
  <Triggers />
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>StopExisting</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>3</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(exePath())}</Command>
      <Arguments>${escapeXml(helperArguments)}</Arguments>
      <WorkingDirectory>${escapeXml(workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`
}

export function isWindowsCoreHelperProcess(): boolean {
  return process.platform === 'win32' && process.argv.includes(CORE_HELPER_ARG)
}

export function getWindowsControllerAddress(): string {
  return `${WINDOWS_CONTROLLER_HOST}:${WINDOWS_CONTROLLER_PORT}`
}

export async function getWindowsControllerSecret(): Promise<string> {
  const secretPath = windowsControllerSecretPath()

  try {
    if (existsSync(secretPath)) {
      const secret = (await readFile(secretPath, 'utf8')).trim()
      if (secret) return secret
    }
  } catch (error) {
    managerLogger.warn('Failed to read Windows controller secret, regenerating', error)
  }

  const secret = randomBytes(32).toString('hex')
  await mkdir(path.dirname(secretPath), { recursive: true })
  await writeFile(secretPath, secret, 'utf8')
  return secret
}

export async function getWindowsControllerEndpoint(): Promise<WindowsControllerEndpoint> {
  return {
    host: WINDOWS_CONTROLLER_HOST,
    port: WINDOWS_CONTROLLER_PORT,
    secret: await getWindowsControllerSecret()
  }
}

async function queryTaskXml(): Promise<string | null> {
  try {
    const { stdout } = await execFilePromise(
      'schtasks.exe',
      ['/query', '/tn', WINDOWS_CORE_TASK_NAME, '/xml'],
      { encoding: 'utf8', windowsHide: true }
    )
    return stdout
  } catch {
    return null
  }
}

async function isTaskCurrent(): Promise<boolean> {
  const taskXml = await queryTaskXml()
  if (!taskXml) return false

  return (
    taskXml.includes(`<Command>${escapeXml(exePath())}</Command>`) &&
    taskXml.includes(`<Arguments>${escapeXml(getHelperTaskArguments())}</Arguments>`) &&
    taskXml.includes(`<WorkingDirectory>${escapeXml(getTaskWorkingDirectory())}</WorkingDirectory>`)
  )
}

async function createTaskElevated(taskFilePath: string): Promise<void> {
  const argumentList = `/create /tn "${WINDOWS_CORE_TASK_NAME}" /xml "${taskFilePath}" /f`
  const command =
    `$arguments = '${escapePowerShellSingleQuoted(argumentList)}'; ` +
    `Start-Process -FilePath "$env:SystemRoot\\System32\\schtasks.exe" ` +
    `-ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait`

  let lastError: unknown = null

  for (const powershellPath of getPowerShellCandidates()) {
    if (path.isAbsolute(powershellPath) && !existsSync(powershellPath)) continue

    try {
      await execFilePromise(
        powershellPath,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        {
          windowsHide: true
        }
      )
      return
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  managerLogger.warn('PowerShell is unavailable, trying direct scheduled task creation', lastError)
  await execFilePromise(
    'schtasks.exe',
    ['/create', '/tn', WINDOWS_CORE_TASK_NAME, '/xml', taskFilePath, '/f'],
    {
      windowsHide: true
    }
  )
}

async function installTask(): Promise<void> {
  await mkdir(dataDir(), { recursive: true })
  const taskFilePath = path.join(dataDir(), 'windows-core-task.xml')
  await writeFile(taskFilePath, Buffer.from(`\ufeff${getTaskXml()}`, 'utf16le'))

  const isAdmin = await checkAdminPrivileges()
  if (isAdmin) {
    await execFilePromise(
      'schtasks.exe',
      ['/create', '/tn', WINDOWS_CORE_TASK_NAME, '/xml', taskFilePath, '/f'],
      {
        windowsHide: true
      }
    )
    return
  }

  const choice = dialog.showMessageBoxSync({
    type: 'info',
    title: i18next.t('tun.permissions.serviceTitle'),
    message: i18next.t('tun.permissions.serviceMessage'),
    buttons: [i18next.t('common.confirm'), i18next.t('common.cancel')],
    defaultId: 0,
    cancelId: 1
  })

  if (choice !== 0) {
    throw new Error(i18next.t('tun.permissions.failed'))
  }

  await createTaskElevated(taskFilePath)
}

export async function ensureWindowsElevatedCoreTask(): Promise<void> {
  if (process.platform !== 'win32') return
  if (await isTaskCurrent()) return

  await installTask()

  if (!(await isTaskCurrent())) {
    throw new Error(i18next.t('tun.permissions.failed'))
  }
}

export async function writeWindowsCoreHelperRequest(
  request: WindowsCoreHelperRequest
): Promise<void> {
  await mkdir(dataDir(), { recursive: true })
  await writeFile(windowsCoreHelperRequestPath(), JSON.stringify(request, null, 2), 'utf8')
}

export async function startWindowsElevatedCore(request: WindowsCoreHelperRequest): Promise<void> {
  await ensureWindowsElevatedCoreTask()
  await stopWindowsElevatedCore()
  await new Promise((resolve) => setTimeout(resolve, 500))
  await writeWindowsCoreHelperRequest(request)

  await managerLogger.info(
    `Starting Windows elevated core task ${WINDOWS_CORE_TASK_NAME} with helper args: ${getHelperTaskArguments()}, cwd: ${getTaskWorkingDirectory()}`
  )

  await execFilePromise('schtasks.exe', ['/run', '/tn', WINDOWS_CORE_TASK_NAME], {
    windowsHide: true
  })
}

export async function stopWindowsElevatedCore(): Promise<void> {
  if (process.platform !== 'win32') return

  await execFilePromise('schtasks.exe', ['/end', '/tn', WINDOWS_CORE_TASK_NAME], {
    windowsHide: true
  }).catch(() => {
    // The task may be absent or already stopped.
  })

  try {
    if (existsSync(windowsCoreHelperPidPath())) {
      const pid = Number((await readFile(windowsCoreHelperPidPath(), 'utf8')).trim())
      if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
        await execFilePromise('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true
        }).catch(() => {
          // Non-admin callers may not be allowed to kill an elevated task process directly.
        })
      }
    }
  } catch (error) {
    managerLogger.warn('Failed to stop Windows elevated core helper by pid', error)
  } finally {
    await rm(windowsCoreHelperPidPath(), { force: true }).catch(() => {})
  }
}

async function readHelperRequest(): Promise<WindowsCoreHelperRequest> {
  const data = await readFile(windowsCoreHelperRequestPath(), 'utf8')
  return JSON.parse(data) as WindowsCoreHelperRequest
}

function stopChildProcess(child: ChildProcess | null): void {
  if (!child || child.killed) return

  try {
    child.kill('SIGINT')
  } catch {
    try {
      child.kill()
    } catch {
      // ignore
    }
  }
}

export async function runWindowsCoreHelper(): Promise<void> {
  await managerLogger.info('Windows core helper started')
  const request = await readHelperRequest()
  await writeFile(windowsCoreHelperPidPath(), String(process.pid), 'utf8')

  const args = [
    '-d',
    request.workDir,
    '-ext-ctl',
    `${request.controllerHost}:${request.controllerPort}`,
    '-secret',
    request.secret
  ]

  const child = spawn(request.corePath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  await managerLogger.info(
    `Windows core helper spawned mihomo PID ${child.pid ?? 'unknown'} on ${request.controllerHost}:${request.controllerPort}`
  )

  if (child.pid) {
    try {
      os.setPriority(
        child.pid,
        os.constants.priority[request.cpuPriority as keyof typeof os.constants.priority]
      )
    } catch (error) {
      managerLogger.warn('Failed to set elevated core priority', error)
    }
  }

  const stdout = createCappedLogWritableStream(request.logPath)
  const stderr = createCappedLogWritableStream(request.logPath)
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)

  const shutdown = (): void => {
    stopChildProcess(child)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.once('exit', shutdown)
  app.once('before-quit', shutdown)

  child.once('exit', async (code) => {
    await rm(windowsCoreHelperPidPath(), { force: true }).catch(() => {})
    app.exit(code ?? 0)
  })
}
