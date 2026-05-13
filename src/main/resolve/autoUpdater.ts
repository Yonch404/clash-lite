import { copyFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { app, shell } from 'electron'
import i18next from 'i18next'
import { mainWindow } from '../window'
import { appLogger } from '../utils/logger'
import { dataDir, exeDir, exePath, isPortable, resourcesFilesDir } from '../utils/dirs'
import { getControledMihomoConfig } from '../config'
import { checkAdminPrivileges } from '../core/manager'
import { parse } from '../utils/yaml'
import * as chromeRequest from '../utils/chromeRequest'

const UPDATE_REPO = 'Yonch404/clash-lite'
const LATEST_YML_URL = `https://github.com/${UPDATE_REPO}/releases/latest/download/latest.yml`
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
const UPDATE_REQUEST_TIMEOUT = 15000

type UpdateProxy = Exclude<chromeRequest.RequestOptions['proxy'], false | undefined>

interface GithubRelease {
  tag_name?: string
  name?: string
  body?: string
}

export async function checkUpdate(): Promise<IAppVersion | undefined> {
  const latest = await fetchLatestVersionInfo()
  const currentVersion = app.getVersion()
  if (compareVersions(latest.version, currentVersion) > 0) {
    return latest
  } else {
    return undefined
  }
}

async function fetchLatestVersionInfo(): Promise<IAppVersion> {
  try {
    return await fetchLatestFromYml()
  } catch (error) {
    await appLogger.warn('Failed to fetch latest.yml, falling back to GitHub release API', error)
    return await fetchLatestFromReleaseApi()
  }
}

async function fetchLatestFromYml(): Promise<IAppVersion> {
  const res = await getUpdateResource<string>(LATEST_YML_URL, {
    headers: getUpdateHeaders('application/octet-stream, text/plain, */*'),
    responseType: 'text',
    timeout: UPDATE_REQUEST_TIMEOUT
  })

  const latest = parse(String(res.data)) as Partial<IAppVersion> | null
  if (!latest || typeof latest.version !== 'string') {
    throw new Error('Invalid latest.yml: missing version')
  }

  return {
    version: latest.version,
    changelog: typeof latest.changelog === 'string' ? latest.changelog : ''
  }
}

async function fetchLatestFromReleaseApi(): Promise<IAppVersion> {
  const res = await getUpdateResource<GithubRelease>(LATEST_RELEASE_API_URL, {
    headers: getUpdateHeaders('application/vnd.github+json'),
    responseType: 'json',
    timeout: UPDATE_REQUEST_TIMEOUT
  })

  const latest = res.data
  const version = latest.tag_name || latest.name
  if (!version) {
    throw new Error('Invalid GitHub release response: missing version')
  }

  return {
    version: version.replace(/^v/, ''),
    changelog: latest.body || ''
  }
}

async function getUpdateResource<T>(
  url: string,
  options: Omit<chromeRequest.RequestOptions, 'method' | 'body' | 'proxy'>
): Promise<chromeRequest.Response<T>> {
  const proxies = await getUpdateRequestProxies()
  let lastError: unknown

  for (const proxy of proxies) {
    try {
      const res = await chromeRequest.get<T>(url, { ...options, proxy })
      ensureSuccessStatus(res)
      return res
    } catch (error) {
      lastError = error
      await appLogger.warn(
        `Update request failed via ${proxy ? 'local proxy' : 'direct connection'}`,
        error
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function getUpdateRequestProxies(): Promise<(UpdateProxy | false)[]> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const port = Number(mixedPort)
  if (!Number.isFinite(port) || port <= 0) {
    return [false]
  }
  return [{ protocol: 'http', host: '127.0.0.1', port }, false]
}

function getUpdateHeaders(accept: string): Record<string, string> {
  return {
    Accept: accept,
    'Accept-Encoding': 'identity',
    'User-Agent': `clash-lite/v${app.getVersion()}`
  }
}

function ensureSuccessStatus(res: chromeRequest.Response<unknown>): void {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Update request failed: status ${res.status}`)
  }
}

// 1:新 -1:旧 0:相同
function compareVersions(a: string, b: string): number {
  const parsePart = (part: string) => {
    const numPart = part.split('-')[0]
    const num = parseInt(numPart, 10)
    return isNaN(num) ? 0 : num
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

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  const githubBase = `https://github.com/${UPDATE_REPO}/releases/download/v${version}/`
  const fileMap = {
    'win32-x64': `clash-lite-windows-${version}-x64-setup.exe`,
    'win32-arm64': `clash-lite-windows-${version}-arm64-setup.exe`
  }
  let file = fileMap[`${process.platform}-${process.arch}`]
  if (!file) {
    throw new Error(i18next.t('common.error.autoUpdateNotSupported'))
  }
  if (isPortable()) {
    file = file.replace('-setup.exe', '-portable.7z')
  }
  try {
    if (!existsSync(path.join(dataDir(), file))) {
      const sha256Res = await getUpdateResource<string>(`${githubBase}${file}.sha256`, {
        headers: getUpdateHeaders('text/plain, */*'),
        responseType: 'text'
      })
      const expectedHash = (sha256Res.data as string).trim().split(/\s+/)[0]
      const res = await getUpdateResource<Buffer>(`${githubBase}${file}`, {
        responseType: 'arraybuffer',
        timeout: 0,
        headers: getUpdateHeaders('application/octet-stream, */*'),
        onProgress: (loaded: number, total: number) => {
          mainWindow?.webContents.send('updateDownloadProgress', {
            status: 'downloading',
            percent: Math.round((loaded / total) * 100)
          })
        }
      })
      mainWindow?.webContents.send('updateDownloadProgress', { status: 'verifying' })
      const fileBuffer = Buffer.from(res.data)
      const actualHash = createHash('sha256').update(fileBuffer).digest('hex')
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(`File integrity check failed: expected ${expectedHash}, got ${actualHash}`)
      }
      await writeFile(path.join(dataDir(), file), fileBuffer)
    }
    if (file.endsWith('.exe')) {
      try {
        const installerPath = path.join(dataDir(), file)
        const isAdmin = await checkAdminPrivileges()

        if (isAdmin) {
          await appLogger.info('Running installer with existing admin privileges')
          spawn(installerPath, ['/S', '--force-run'], {
            detached: true,
            stdio: 'ignore'
          }).unref()
        } else {
          // 提升权限安装
          const escapedPath = installerPath.replace(/'/g, "''")
          const args = ['/S', '--force-run']
          const argsString = args.map((arg) => arg.replace(/'/g, "''")).join("', '")

          const command = `powershell  -NoProfile -Command "Start-Process -FilePath '${escapedPath}' -ArgumentList '${argsString}' -Verb RunAs -WindowStyle Hidden"`

          await appLogger.info('Starting installer with elevated privileges')

          const execPromise = promisify(exec)
          await execPromise(command, { windowsHide: true })

          await appLogger.info('Installer started successfully with elevation')
        }
      } catch (installerError) {
        await appLogger.error('Failed to start installer, trying fallback', installerError)

        // Fallback: 尝试使用 shell.openPath 打开安装包
        try {
          await shell.openPath(path.join(dataDir(), file))
          await appLogger.info('Opened installer with shell.openPath as fallback')
        } catch (fallbackError) {
          await appLogger.error('Fallback method also failed', fallbackError)
          const installerErrorMessage =
            installerError instanceof Error ? installerError.message : String(installerError)
          const fallbackErrorMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          throw new Error(
            `Failed to execute installer: ${installerErrorMessage}. Fallback also failed: ${fallbackErrorMessage}`
          )
        }
      }
    }
    if (file.endsWith('.7z')) {
      await copyFile(path.join(resourcesFilesDir(), '7za.exe'), path.join(dataDir(), '7za.exe'))
      spawn(
        'cmd',
        [
          '/C',
          `"timeout /t 2 /nobreak >nul && "${path.join(dataDir(), '7za.exe')}" x -o"${exeDir()}" -y "${path.join(dataDir(), file)}" & start "" "${exePath()}""`
        ],
        {
          shell: true,
          detached: true
        }
      ).unref()
      app.quit()
    }
  } catch (e) {
    rm(path.join(dataDir(), file))
    throw e
  }
}
