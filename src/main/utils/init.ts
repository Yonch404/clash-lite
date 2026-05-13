import { mkdir, writeFile, rm, readdir, cp, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { app, dialog } from 'electron'
import { startPacServer } from '../resolve/server'
import { triggerSysProxy } from '../sys/sysproxy'
import { getAppConfig } from '../config'
import i18next, { resources } from '../../shared/i18n'
import { stringify } from './yaml'
import {
  defaultConfig,
  defaultControledMihomoConfig,
  defaultProfile,
  defaultProfileConfig
} from './template'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  logDir,
  mihomoTestDir,
  mihomoWorkDir,
  profileConfigPath,
  profilePath,
  profilesDir,
  resourcesFilesDir,
  themesDir
} from './dirs'
import { initLogger } from './logger'

let isInitBasicCompleted = false
let isRuntimeFilesCompleted = false
let initBasicPromise: Promise<void> | null = null
let runtimeFilesPromise: Promise<void> | null = null

export function safeShowErrorBox(titleKey: string, message: string): void {
  let title: string
  try {
    title = i18next.t(titleKey)
    if (!title || title === titleKey) throw new Error('Translation not ready')
  } catch {
    const isZh = app.getLocale().startsWith('zh')
    const lang = isZh ? resources['zh-CN'].translation : resources['en-US'].translation
    title = lang[titleKey] || (isZh ? '错误' : 'Error')
  }
  dialog.showErrorBox(title, message)
}

async function fixDataDirPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  const dataDirPath = dataDir()
  if (!existsSync(dataDirPath)) return

  try {
    const stats = await stat(dataDirPath)
    const currentUid = process.getuid?.() || 0

    if (stats.uid === 0 && currentUid !== 0) {
      const execPromise = promisify(exec)
      const username = process.env.USER || process.env.LOGNAME
      if (username) {
        await execPromise(`chown -R "${username}:staff" "${dataDirPath}"`)
        await execPromise(`chmod -R u+rwX "${dataDirPath}"`)
      }
    }
  } catch {
    // ignore
  }
}

async function isSourceNewer(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
    return sourceStats.mtime > targetStats.mtime
  } catch {
    return true
  }
}

async function initDirs(): Promise<void> {
  await fixDataDirPermissions()

  const dirsToCreate = [
    dataDir(),
    themesDir(),
    profilesDir(),
    mihomoWorkDir(),
    logDir(),
    mihomoTestDir()
  ]

  await Promise.all(
    dirsToCreate.map(async (dir) => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    })
  )
}

async function initConfig(): Promise<void> {
  const configs = [
    { path: appConfigPath(), content: defaultConfig, name: 'app config' },
    { path: profileConfigPath(), content: defaultProfileConfig, name: 'profile config' },
    { path: profilePath('default'), content: defaultProfile, name: 'default profile' },
    {
      path: controledMihomoConfigPath(),
      content: defaultControledMihomoConfig,
      name: 'mihomo config'
    }
  ]

  await Promise.all(
    configs.map(async (config) => {
      if (!existsSync(config.path)) {
        await writeFile(config.path, stringify(config.content))
      }
    })
  )
}

async function killOldMihomoProcesses(): Promise<void> {
  if (process.platform !== 'win32') return

  try {
    const execFilePromise = promisify(execFile)
    const coreNames = new Set(['mihomo.exe'])
    const { stdout } = await execFilePromise('tasklist', ['/FO', 'CSV', '/NH'])

    const pids = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.includes('INFO:'))
      .map((line) => {
        const [, imageName, pid] = line.match(/^"([^"]+)","(\d+)"/) || []
        if (!imageName || !coreNames.has(imageName.toLowerCase())) return NaN
        return parseInt(pid, 10)
      })
      .filter((pid) => !isNaN(pid) && pid !== process.pid)

    if (pids.length === 0) return

    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
        await initLogger.info(`Terminated old core process ${pid}`)
      } catch {
        // 进程可能退出
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  } catch {
    // 忽略错误
  }
}

async function initFiles(): Promise<void> {
  await killOldMihomoProcesses()

  const copyFile = async (file: string, targetDirs: string[]): Promise<void> => {
    const sourcePath = path.join(resourcesFilesDir(), file)
    if (!existsSync(sourcePath)) return

    const targets = targetDirs.map((dir) => path.join(dir, file))

    await Promise.all(
      targets.map(async (targetPath) => {
        const shouldCopy = !existsSync(targetPath) || (await isSourceNewer(sourcePath, targetPath))
        if (!shouldCopy) return

        try {
          await cp(sourcePath, targetPath, { recursive: true, force: true })
        } catch (error: unknown) {
          const code = (error as NodeJS.ErrnoException).code
          // 文件被占用或权限问题，如果目标已存在则跳过
          if (
            (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') &&
            existsSync(targetPath)
          ) {
            await initLogger.warn(`Skipping ${file}: file is in use or permission denied`)
            return
          }
          throw error
        }
      })
    )
  }

  const files = [
    {
      name: 'country.mmdb',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'geoip.metadb',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'geoip.dat',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'geosite.dat',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    },
    {
      name: 'ASN.mmdb',
      targetDirs: [mihomoWorkDir(), mihomoTestDir()]
    }
  ]

  const criticalFiles = ['country.mmdb', 'geoip.dat', 'geosite.dat']

  const results = await Promise.allSettled(
    files.map(({ name, targetDirs }) => copyFile(name, targetDirs))
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const file = files[i].name
      await initLogger.error(`Failed to copy ${file}`, result.reason)
      if (criticalFiles.includes(file)) {
        throw new Error(`Failed to copy critical file ${file}: ${result.reason}`)
      }
    }
  }
}

async function cleanup(): Promise<void> {
  const [dataFiles, logFiles] = await Promise.all([readdir(dataDir()), readdir(logDir())])

  // 清理更新缓存
  const cacheExtensions = ['.exe', '.dmg', '.zip', '.7z', '.tar.gz', '.tgz']
  const cacheCleanup = dataFiles
    .filter((file) => cacheExtensions.some((ext) => file.endsWith(ext)))
    .map((file) => rm(path.join(dataDir(), file)).catch(() => {}))

  // 清理过期日志
  const { maxLogDays = 7 } = await getAppConfig()
  const maxAge = maxLogDays * 24 * 60 * 60 * 1000
  const datePattern = /\d{4}-\d{2}-\d{2}/

  const logCleanup = logFiles
    .filter((log) => {
      const match = log.match(datePattern)
      if (!match) return false
      const date = new Date(match[0])
      return !isNaN(date.getTime()) && Date.now() - date.getTime() > maxAge
    })
    .map((log) => rm(path.join(logDir(), log)).catch(() => {}))

  await Promise.all([...cacheCleanup, ...logCleanup])
}

function initDeeplink(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('clash', process.execPath, [path.resolve(process.argv[1])])
      app.setAsDefaultProtocolClient('mihomo', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('clash')
    app.setAsDefaultProtocolClient('mihomo')
  }
}

export async function initBasic(): Promise<void> {
  if (isInitBasicCompleted) return
  if (initBasicPromise) return initBasicPromise

  initBasicPromise = (async () => {
    await initDirs()
    await initConfig()

    isInitBasicCompleted = true
  })()

  try {
    await initBasicPromise
  } finally {
    initBasicPromise = null
  }
}

export async function ensureRuntimeFiles(): Promise<void> {
  if (isRuntimeFilesCompleted) return
  if (runtimeFilesPromise) return runtimeFilesPromise

  runtimeFilesPromise = (async () => {
    await initBasic()
    await initFiles()
    await cleanup()
    isRuntimeFilesCompleted = true
  })()

  try {
    await runtimeFilesPromise
  } finally {
    runtimeFilesPromise = null
  }
}

export async function init(): Promise<void> {
  const { sysProxy } = await getAppConfig()

  const initTasks: Promise<void>[] = [
    (async (): Promise<void> => {
      await ensureRuntimeFiles()
    })()
  ]

  initTasks.push(
    (async (): Promise<void> => {
      try {
        if (sysProxy.enable) {
          await startPacServer()
        }
        await triggerSysProxy(sysProxy.enable)
      } catch {
        // ignore
      }
    })()
  )

  await Promise.all(initTasks)
  initDeeplink()
}
