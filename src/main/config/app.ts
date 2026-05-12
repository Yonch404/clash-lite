import { readdir, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { appConfigPath, logDir } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig } from '../utils/template'
import { normalizeMaxLogFileSizeMB, setGlobalMaxLogFileSizeMB } from '../utils/logFile'

let appConfig: IAppConfig // config.yaml
let appConfigWriteQueue: Promise<void> = Promise.resolve()

function cloneDefaultConfig(): IAppConfig {
  return JSON.parse(JSON.stringify(defaultConfig)) as IAppConfig
}

function normalizeMaxLogDays(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return defaultConfig.maxLogDays
  return Math.max(1, Math.floor(num))
}

async function cleanupExpiredLogs(maxLogDays: number): Promise<void> {
  const logFiles = await readdir(logDir()).catch(() => [])
  const maxAge = maxLogDays * 24 * 60 * 60 * 1000
  const datePattern = /\d{4}-\d{2}-\d{2}/

  await Promise.all(
    logFiles
      .filter((log) => {
        const match = log.match(datePattern)
        if (!match) return false
        const date = new Date(match[0])
        return !isNaN(date.getTime()) && Date.now() - date.getTime() > maxAge
      })
      .map((log) => rm(path.join(logDir(), log)).catch(() => {}))
  )
}

export async function getAppConfig(force = false): Promise<IAppConfig> {
  if (force || !appConfig) {
    appConfigWriteQueue = appConfigWriteQueue.then(async () => {
      const data = await readFile(appConfigPath(), 'utf-8')
      const parsedConfig = parse(data)
      const mergedConfig = deepMerge(cloneDefaultConfig(), parsedConfig || {})
      mergedConfig.maxLogDays = normalizeMaxLogDays(mergedConfig.maxLogDays)
      mergedConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      if (JSON.stringify(mergedConfig) !== JSON.stringify(parsedConfig)) {
        await writeFile(appConfigPath(), stringify(mergedConfig))
      }
      setGlobalMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      appConfig = mergedConfig
    })
    await appConfigWriteQueue
  }
  if (typeof appConfig !== 'object') appConfig = defaultConfig
  return appConfig
}

export async function patchAppConfig(patch: Partial<IAppConfig>): Promise<void> {
  appConfigWriteQueue = appConfigWriteQueue.then(async () => {
    appConfig = deepMerge(appConfig, patch)
    appConfig.maxLogDays = normalizeMaxLogDays(appConfig.maxLogDays)
    appConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(appConfig.maxLogFileSize)
    setGlobalMaxLogFileSizeMB(appConfig.maxLogFileSize)
    await writeFile(appConfigPath(), stringify(appConfig))
    if (patch.maxLogDays !== undefined) {
      await cleanupExpiredLogs(appConfig.maxLogDays)
    }
  })
  await appConfigWriteQueue
}
