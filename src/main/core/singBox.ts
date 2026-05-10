import { ChildProcess, execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readdir, rm, writeFile, copyFile, chmod } from 'fs/promises'
import path from 'path'
import { promisify, stripVTControlCharacters } from 'util'
import AdmZip from 'adm-zip'
import * as chromeRequest from '../utils/chromeRequest'
import { mainWindow } from '../window'
import { createLogger } from '../utils/logger'
import { createCappedLogWritableStream } from '../utils/logFile'
import {
  dataDir,
  coreLogPath,
  singBoxCorePath,
  singBoxPidPath,
  singBoxWorkConfigPath,
  singBoxWorkDir
} from '../utils/dirs'
import { getRuntimeSingBoxConfigStr } from './factory'

const execFilePromise = promisify(execFile)
const singBoxLogger = createLogger('SingBox')

const SING_BOX_RELEASE_API = 'https://api.github.com/repos/SagerNet/sing-box/releases/latest'

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubReleaseAsset[]
}

let child: ChildProcess | null = null
let retry = 10
let isRestarting = false
let skipAutoRestart = false
let currentConfigHash = ''

function hasCoreProcess(): boolean {
  return Boolean(child && !child.killed && child.exitCode === null && child.signalCode === null)
}

function compareVersions(a: string, b: string): number {
  const parsePart = (part: string): number => {
    const num = parseInt(part.split('-')[0] || '0', 10)
    return Number.isNaN(num) ? 0 : num
  }

  const v1 = a.replace(/^v/, '').split('.').map(parsePart)
  const v2 = b.replace(/^v/, '').split('.').map(parsePart)

  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const num1 = v1[i] || 0
    const num2 = v2[i] || 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }

  return 0
}

function normalizeCoreVersion(stdout: string): string {
  const match = stdout.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)
  return match?.[0] ?? stdout.trim()
}

function getAssetName(version: string): string {
  const platformArch = `${process.platform}-${process.arch}`

  switch (platformArch) {
    case 'win32-x64':
      return `sing-box-${version}-windows-amd64.zip`
    case 'win32-arm64':
      return `sing-box-${version}-windows-arm64.zip`
    case 'darwin-x64':
      return `sing-box-${version}-darwin-amd64.tar.gz`
    case 'darwin-arm64':
      return `sing-box-${version}-darwin-arm64.tar.gz`
    case 'linux-x64':
      return `sing-box-${version}-linux-amd64.tar.gz`
    case 'linux-arm64':
      return `sing-box-${version}-linux-arm64.tar.gz`
    default:
      throw new Error(`Unsupported platform for sing-box: ${platformArch}`)
  }
}

async function cleanupSingBoxArtifacts(targetDir: string): Promise<void> {
  const files = await readdir(targetDir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    files.map(async (entry) => {
      const shouldRemove = entry.name.startsWith('sing-box') || entry.name.startsWith('libcronet')
      if (!shouldRemove) return
      const targetPath = path.join(targetDir, entry.name)
      await rm(targetPath, { recursive: true, force: true })
    })
  )
}

async function copyArchiveFiles(sourceDir: string, targetDir: string): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(sourceDir, entry.name)
      if (entry.isDirectory()) {
        await copyArchiveFiles(sourcePath, targetDir)
        return
      }
      if (!entry.isFile()) return

      const targetPath = path.join(targetDir, entry.name)
      await copyFile(sourcePath, targetPath)
      if (entry.name === 'sing-box' || entry.name === 'sing-box.exe') {
        await chmod(targetPath, 0o755)
      }
    })
  )
}

async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  if (archivePath.endsWith('.zip')) {
    const zip = new AdmZip(archivePath)
    zip.extractAllTo(targetDir, true)
    return
  }

  const { stdout, stderr } = await execFilePromise('tar', ['-xzf', archivePath, '-C', targetDir])
  void stdout
  void stderr
}

function publishLogLine(line: string): void {
  const trimmed = stripVTControlCharacters(line).trim()
  if (!trimmed) return

  const match = trimmed.match(
    /^(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|PANIC)\[[^\]]*\]\s*(.*)$/i
  )
  const level = match?.[1]?.toLowerCase() ?? 'info'
  const payload = (match?.[2] || trimmed).trim()

  const type: LogLevel =
    level === 'warning'
      ? 'warning'
      : level === 'warn'
        ? 'warning'
        : level === 'error' || level === 'fatal' || level === 'panic'
          ? 'error'
          : level === 'debug' || level === 'trace'
            ? 'debug'
            : 'info'

  mainWindow?.webContents.send('mihomoLogs', {
    type,
    payload,
    time: new Date().toLocaleString(),
    source: 'sing-box'
  } as IMihomoLogInfo)
}

function createLineProcessor(): (chunk: Buffer) => void {
  let buffer = ''

  return (chunk: Buffer) => {
    buffer += chunk.toString('utf-8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      publishLogLine(line)
    }
  }
}

async function getLatestRelease(): Promise<GitHubRelease> {
  const response = await chromeRequest.get<GitHubRelease>(SING_BOX_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Clash Lite'
    },
    responseType: 'json'
  })
  return response.data
}

async function installArchive(assetName: string, archiveData: Buffer): Promise<void> {
  const cacheDir = path.join(dataDir(), 'sing-box-update')
  const archivePath = path.join(cacheDir, assetName)
  const extractedDir = path.join(cacheDir, 'extract')
  const targetDir = path.dirname(singBoxCorePath())

  await rm(cacheDir, { recursive: true, force: true })
  await mkdir(cacheDir, { recursive: true })
  await mkdir(targetDir, { recursive: true })

  try {
    await writeFile(archivePath, archiveData)
    await extractArchive(archivePath, extractedDir)

    await cleanupSingBoxArtifacts(targetDir)
    await copyArchiveFiles(extractedDir, targetDir)
  } finally {
    await rm(cacheDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function startSingBoxProcess(detached: boolean): Promise<void> {
  const configPath = singBoxWorkConfigPath()
  const corePath = singBoxCorePath()

  if (!existsSync(corePath)) {
    throw new Error('sing-box core not found')
  }
  if (!existsSync(configPath)) {
    await stopSingBoxCore()
    return
  }

  try {
    await execFilePromise(corePath, ['check', '-D', singBoxWorkDir(), '-c', configPath])
  } catch (error) {
    const output =
      error instanceof Error && 'stderr' in error
        ? String(
            (error as { stderr?: string; stdout?: string }).stderr ||
              (error as { stdout?: string }).stdout ||
              error.message
          )
        : String(error)
    throw new Error(`sing-box config check failed: ${output}`)
  }

  const nextConfig = await getRuntimeSingBoxConfigStr()
  const nextHash = createHash('sha256').update(nextConfig).digest('hex')
  if (hasCoreProcess() && nextHash === currentConfigHash && detached === false) {
    return
  }

  await stopSingBoxCore()
  currentConfigHash = nextHash

  const proc = spawn(corePath, ['-D', singBoxWorkDir(), '-c', configPath, 'run'], {
    detached,
    stdio: detached ? 'ignore' : undefined
  })

  child = proc
  skipAutoRestart = false
  retry = 10

  if (detached) {
    if (proc.pid) {
      await writeFile(singBoxPidPath(), String(proc.pid))
    }
    proc.unref()
    return
  }

  const stdoutLogger = createCappedLogWritableStream(coreLogPath())
  const stderrLogger = createCappedLogWritableStream(coreLogPath())
  const stdoutLine = createLineProcessor()
  const stderrLine = createLineProcessor()

  proc.stdout?.pipe(stdoutLogger)
  proc.stderr?.pipe(stderrLogger)
  proc.stdout?.on('data', stdoutLine)
  proc.stderr?.on('data', stderrLine)

  return new Promise((resolve, reject) => {
    let startupSettled = false
    const startupTimer = setTimeout(() => {
      if (startupSettled) return
      startupSettled = true
      resolve()
    }, 1500)

    const resolveStartup = (): void => {
      if (startupSettled) return
      startupSettled = true
      clearTimeout(startupTimer)
      resolve()
    }

    const rejectStartup = (reason: unknown): void => {
      if (startupSettled) return
      startupSettled = true
      clearTimeout(startupTimer)
      reject(reason)
    }

    proc.on('error', rejectStartup)
    proc.on('close', async (code, signal) => {
      if (child === proc) {
        child = null
      }

      clearTimeout(startupTimer)

      if (!startupSettled) {
        rejectStartup(new Error(`sing-box start failed: ${code ?? signal ?? 'unknown'}`))
        return
      }

      if (skipAutoRestart) return
      if (isRestarting) return

      if (retry) {
        retry--
        await restartSingBoxCore()
      } else {
        await stopSingBoxCore()
      }
    })

    proc.stdout?.once('data', resolveStartup)
    proc.stderr?.once('data', resolveStartup)
  })
}

export async function syncSingBoxCore(detached = false): Promise<void> {
  const config = await getRuntimeSingBoxConfigStr()
  if (!config) {
    await stopSingBoxCore()
    return
  }

  const nextHash = createHash('sha256').update(config).digest('hex')
  if (hasCoreProcess() && nextHash === currentConfigHash && detached === false) {
    return
  }

  await startSingBoxProcess(detached)
}

export async function stopSingBoxCore(): Promise<void> {
  skipAutoRestart = true
  retry = 0

  if (child) {
    child.removeAllListeners()
    child.kill('SIGINT')
    child = null
  }

  try {
    await rm(singBoxPidPath(), { force: true })
  } catch {
    // ignore
  }
}

export async function restartSingBoxCore(): Promise<void> {
  if (isRestarting) return

  isRestarting = true
  let retryCount = 0
  const maxRetries = 3

  try {
    await stopSingBoxCore()
    while (retryCount < maxRetries) {
      try {
        await startSingBoxProcess(false)
        return
      } catch (error) {
        retryCount++
        singBoxLogger.error(`restart sing-box failed (attempt ${retryCount}/${maxRetries})`, error)
        if (retryCount >= maxRetries) {
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount))
        await stopSingBoxCore()
      }
    }
  } finally {
    isRestarting = false
  }
}

export async function keepSingBoxAlive(): Promise<void> {
  await startSingBoxProcess(true)
  if (child?.pid) {
    await writeFile(singBoxPidPath(), String(child.pid))
  }
}

export async function singBoxVersion(): Promise<ISingBoxVersion> {
  try {
    const stdout = await execFilePromise(singBoxCorePath(), ['version'])
    return { version: normalizeCoreVersion(stdout.stdout || stdout.stderr || '') }
  } catch {
    return { version: '' }
  }
}

export async function singBoxUpgrade(): Promise<void> {
  const release = await getLatestRelease()
  const version = release.tag_name.replace(/^v/, '')
  const assetName = getAssetName(version)
  const asset = release.assets.find((item) => item.name === assetName)
  if (!asset) {
    throw new Error(`sing-box asset not found: ${assetName}`)
  }

  const current = await singBoxVersion()
  if (current.version && compareVersions(version, current.version) <= 0) {
    throw new Error('already using latest version')
  }

  await stopSingBoxCore()
  const response = await chromeRequest.get(asset.browser_download_url, {
    responseType: 'arraybuffer',
    headers: {
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'Clash Lite'
    },
    timeout: 0
  })

  await installArchive(assetName, Buffer.from(response.data as ArrayBuffer))
}

export async function hasSingBoxConfigured(): Promise<boolean> {
  const config = await getRuntimeSingBoxConfigStr()
  return Boolean(config)
}
