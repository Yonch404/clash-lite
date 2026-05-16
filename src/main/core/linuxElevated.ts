import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import { app, dialog } from 'electron'
import i18next from 'i18next'
import { coreLogPath, dataDir, linuxControllerSecretPath, mihomoWorkDir } from '../utils/dirs'
import { managerLogger } from '../utils/logger'

const execFilePromise = promisify(execFile)

const LINUX_CORE_HELPER_SERVICE = 'clash-lite-core-helper.service'
const LINUX_CONTROLLER_HOST = '127.0.0.1'
const LINUX_CONTROLLER_BASE_PORT = 19090
const LINUX_HELPER_RUNTIME_DIR = '/run/clash-lite-core'
const LINUX_HELPER_REQUEST_DIR = path.join(LINUX_HELPER_RUNTIME_DIR, 'requests')
const LINUX_HELPER_RESPONSE_DIR = path.join(LINUX_HELPER_RUNTIME_DIR, 'responses')

export interface LinuxCoreHelperRequest {
  workDir: string
  controllerHost: string
  controllerPort: number
  secret: string
  logPath: string
  createdAt: number
}

export interface LinuxControllerEndpoint {
  host: string
  port: number
  secret: string
}

interface LinuxHelperCommand {
  command: 'ping' | 'start' | 'stop'
  workDir?: string
  logPath?: string
  controllerHost?: string
  controllerPort?: number
  secret?: string
}

interface LinuxHelperResponse {
  status: 'ok' | 'error'
  message: string
  pid?: number
}

function isLinuxPackagedApp(): boolean {
  return process.platform === 'linux' && app.isPackaged
}

export function shouldUseLinuxElevatedCoreHelper(): boolean {
  return isLinuxPackagedApp()
}

function getUid(): number {
  return process.getuid?.() ?? 0
}

function getLinuxControllerPort(): number {
  return LINUX_CONTROLLER_BASE_PORT + (getUid() % 1000)
}

export async function getLinuxControllerSecret(): Promise<string> {
  const secretPath = linuxControllerSecretPath()

  try {
    if (existsSync(secretPath)) {
      const secret = (await readFile(secretPath, 'utf8')).trim()
      if (secret) return secret
    }
  } catch (error) {
    managerLogger.warn('Failed to read Linux controller secret, regenerating', error)
  }

  const secret = randomBytes(32).toString('hex')
  await mkdir(path.dirname(secretPath), { recursive: true })
  await writeFile(secretPath, secret, 'utf8')
  return secret
}

export async function getLinuxControllerEndpoint(): Promise<LinuxControllerEndpoint> {
  return {
    host: LINUX_CONTROLLER_HOST,
    port: getLinuxControllerPort(),
    secret: await getLinuxControllerSecret()
  }
}

function encodeField(value: string | number | undefined): string {
  if (value === undefined) return ''
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function createRequestId(): string {
  return `${getUid()}-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function parseResponse(content: string): LinuxHelperResponse {
  const entries = new Map<string, string>()
  for (const line of content.split(/\r?\n/u)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    entries.set(line.slice(0, index), line.slice(index + 1))
  }

  const status = entries.get('STATUS') === 'ok' ? 'ok' : 'error'
  const pidValue = Number(entries.get('PID') || 0)
  return {
    status,
    message: entries.get('MESSAGE') || '',
    pid: Number.isFinite(pidValue) && pidValue > 0 ? pidValue : undefined
  }
}

async function waitForResponse(
  responsePath: string,
  timeoutMs = 10000
): Promise<LinuxHelperResponse> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = parseResponse(await readFile(responsePath, 'utf8'))
      await rm(responsePath, { force: true }).catch(() => {})
      return response
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    await wait(100)
  }

  throw new Error(i18next.t('tun.permissions.serviceUnavailable'))
}

async function writeHelperRequest(command: LinuxHelperCommand): Promise<LinuxHelperResponse> {
  const requestId = createRequestId()
  const uid = getUid()
  const requestPath = path.join(LINUX_HELPER_REQUEST_DIR, `${requestId}.env`)
  const tempPath = path.join(LINUX_HELPER_REQUEST_DIR, `${requestId}.tmp`)
  const responsePath = path.join(LINUX_HELPER_RESPONSE_DIR, String(uid), `${requestId}.status`)
  const userDataDir = dataDir()

  const payload = [
    'CLASH_LITE_HELPER_REQUEST=1',
    `REQUEST_ID=${requestId}`,
    `COMMAND=${command.command}`,
    `USER_DATA_DIR_B64=${encodeField(userDataDir)}`,
    `WORK_DIR_B64=${encodeField(command.workDir || mihomoWorkDir())}`,
    `LOG_PATH_B64=${encodeField(command.logPath || coreLogPath())}`,
    `CONTROLLER_HOST=${command.controllerHost || LINUX_CONTROLLER_HOST}`,
    `CONTROLLER_PORT=${command.controllerPort || getLinuxControllerPort()}`,
    `SECRET_B64=${encodeField(command.secret || '')}`
  ].join('\n')

  await writeFile(tempPath, `${payload}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(tempPath, requestPath)

  return await waitForResponse(responsePath)
}

async function isHelperServiceActive(): Promise<boolean> {
  try {
    await execFilePromise('systemctl', ['is-active', '--quiet', LINUX_CORE_HELPER_SERVICE], {
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

async function startHelperServiceWithPkexec(): Promise<void> {
  const command =
    `systemctl enable ${LINUX_CORE_HELPER_SERVICE} >/dev/null 2>&1 && ` +
    `systemctl restart ${LINUX_CORE_HELPER_SERVICE}`
  await execFilePromise('pkexec', ['sh', '-c', command], { windowsHide: true })
}

function shouldPromptLinuxHelperServiceRepair(): boolean {
  const choice = dialog.showMessageBoxSync({
    type: 'info',
    title: i18next.t('tun.permissions.serviceTitle'),
    message: i18next.t('tun.permissions.linuxServiceMessage'),
    buttons: [i18next.t('common.confirm'), i18next.t('common.cancel')],
    defaultId: 0,
    cancelId: 1
  })

  return choice === 0
}

async function pingHelper(): Promise<boolean> {
  try {
    const response = await writeHelperRequest({ command: 'ping' })
    return response.status === 'ok'
  } catch {
    return false
  }
}

export async function ensureLinuxCoreHelperService(): Promise<void> {
  if (!shouldUseLinuxElevatedCoreHelper()) return

  if ((await isHelperServiceActive()) && (await pingHelper())) {
    return
  }

  if (!shouldPromptLinuxHelperServiceRepair()) {
    throw new Error(i18next.t('tun.permissions.failed'))
  }

  try {
    await startHelperServiceWithPkexec()
  } catch (error) {
    managerLogger.error('Failed to start Linux core helper service', error)
    throw new Error(i18next.t('tun.permissions.failed'))
  }

  for (let i = 0; i < 30; i++) {
    if (await pingHelper()) {
      return
    }
    await wait(100)
  }

  throw new Error(i18next.t('tun.permissions.serviceUnavailable'))
}

export async function startLinuxElevatedCore(request: LinuxCoreHelperRequest): Promise<void> {
  await ensureLinuxCoreHelperService()
  const response = await writeHelperRequest({
    command: 'start',
    workDir: request.workDir,
    logPath: request.logPath,
    controllerHost: request.controllerHost,
    controllerPort: request.controllerPort,
    secret: request.secret
  })

  if (response.status !== 'ok') {
    throw new Error(response.message || i18next.t('tun.error.linuxTunPermissionDenied'))
  }

  managerLogger.info(
    `Linux helper started mihomo PID ${response.pid ?? 'unknown'} on ${request.controllerHost}:${request.controllerPort}`
  )
}

export async function stopLinuxElevatedCore(): Promise<void> {
  if (process.platform !== 'linux') return

  try {
    if (!(await isHelperServiceActive())) return
    const response = await writeHelperRequest({ command: 'stop' })
    if (response.status !== 'ok') {
      managerLogger.warn('Linux helper failed to stop mihomo:', response.message)
    }
  } catch (error) {
    managerLogger.warn('Failed to stop Linux elevated core helper', error)
  }
}
