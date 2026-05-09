import { access, readFile, rm, writeFile } from 'fs/promises'
import { constants, existsSync } from 'fs'
import { execFile } from 'child_process'
import { isAbsolute, relative, resolve } from 'path'
import { promisify } from 'util'
import { app } from 'electron'
import i18next from 'i18next'
import * as chromeRequest from '../utils/chromeRequest'
import { parse, stringify } from '../utils/yaml'
import { defaultProfile } from '../utils/template'
import { mihomoHotReloadConfig } from '../core/mihomoApi'
import { restartCore } from '../core/manager'
import { generateProfile } from '../core/factory'
import { addProfileUpdater, removeProfileUpdater } from '../core/profileUpdater'
import {
  mihomoProfileWorkDir,
  mihomoWorkDir,
  profileConfigPath,
  profilePath
} from '../utils/dirs'
import { createLogger } from '../utils/logger'
import { getAppConfig } from './app'
import { getControledMihomoConfig } from './controledMihomo'

const profileLogger = createLogger('Profile')
const execFilePromise = promisify(execFile)

let profileConfig: IProfileConfig
let profileConfigWriteQueue: Promise<void> = Promise.resolve()
let changeProfileQueue: Promise<void> = Promise.resolve()
// 并发去重
const inflightRemoteFetches = new Map<string, Promise<IProfileItem>>()

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EACCES' || code === 'EPERM'
}

function assertInsideWorkDir(targetPath: string): void {
  const relativePath = relative(resolve(mihomoWorkDir()), resolve(targetPath))
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Refusing to delete outside work directory: ${targetPath}`)
  }
}

async function canRemoveProfileWorkDir(workDir: string): Promise<boolean> {
  try {
    await Promise.all([
      access(mihomoWorkDir(), constants.W_OK | constants.X_OK),
      access(workDir, constants.R_OK | constants.W_OK | constants.X_OK)
    ])
    return true
  } catch {
    return false
  }
}

async function removeProfileWorkDirWithPkexec(workDir: string): Promise<void> {
  assertInsideWorkDir(workDir)
  await execFilePromise('pkexec', ['rm', '-rf', '--', workDir])
}

async function removeProfileWorkDir(id: string): Promise<void> {
  const workDir = mihomoProfileWorkDir(id)
  if (!existsSync(workDir)) return
  assertInsideWorkDir(workDir)

  if (process.platform === 'linux' && !(await canRemoveProfileWorkDir(workDir))) {
    await removeProfileWorkDirWithPkexec(workDir)
    return
  }

  try {
    await rm(workDir, { recursive: true, force: true })
  } catch (error) {
    if (process.platform !== 'linux' || !isPermissionError(error)) {
      throw error
    }

    await removeProfileWorkDirWithPkexec(workDir)
  }
}

export async function getProfileConfig(force = false): Promise<IProfileConfig> {
  if (force || !profileConfig) {
    const data = await readFile(profileConfigPath(), 'utf-8')
    profileConfig = parse(data) || { items: [] }
  }
  if (typeof profileConfig !== 'object') profileConfig = { items: [] }
  if (!Array.isArray(profileConfig.items)) profileConfig.items = []
  return JSON.parse(JSON.stringify(profileConfig))
}

export async function setProfileConfig(config: IProfileConfig): Promise<void> {
  profileConfigWriteQueue = profileConfigWriteQueue.then(async () => {
    profileConfig = config
    await writeFile(profileConfigPath(), stringify(config), 'utf-8')
  })
  await profileConfigWriteQueue
}

export async function updateProfileConfig(
  updater: (config: IProfileConfig) => IProfileConfig | Promise<IProfileConfig>
): Promise<IProfileConfig> {
  let result: IProfileConfig | undefined
  profileConfigWriteQueue = profileConfigWriteQueue.then(async () => {
    const data = await readFile(profileConfigPath(), 'utf-8')
    profileConfig = parse(data) || { items: [] }
    if (typeof profileConfig !== 'object') profileConfig = { items: [] }
    if (!Array.isArray(profileConfig.items)) profileConfig.items = []
    profileConfig = await updater(JSON.parse(JSON.stringify(profileConfig)))
    result = profileConfig
    await writeFile(profileConfigPath(), stringify(profileConfig), 'utf-8')
  })
  await profileConfigWriteQueue
  return JSON.parse(JSON.stringify(result ?? profileConfig))
}

export async function getProfileItem(id: string | undefined): Promise<IProfileItem | undefined> {
  const { items } = await getProfileConfig()
  if (!id || id === 'default')
    return { id: 'default', type: 'local', name: i18next.t('profiles.emptyProfile') }
  return items.find((item) => item.id === id)
}

export async function changeCurrentProfile(id: string): Promise<void> {
  // 使用队列确保 profile 切换串行执行，避免竞态条件
  let taskError: unknown = null
  changeProfileQueue = changeProfileQueue
    .catch(() => {})
    .then(async () => {
      const { current } = await getProfileConfig()
      if (current === id) return

      try {
        await updateProfileConfig((config) => {
          config.current = id
          return config
        })
        await restartCore()
      } catch (e) {
        // 回滚配置
        await updateProfileConfig((config) => {
          config.current = current
          return config
        })
        taskError = e
      }
    })
  await changeProfileQueue
  if (taskError) {
    throw taskError
  }
}

export async function updateProfileItem(item: IProfileItem): Promise<void> {
  await updateProfileConfig((config) => {
    const index = config.items.findIndex((i) => i.id === item.id)
    if (index === -1) {
      throw new Error('Profile not found')
    }
    config.items[index] = item
    return config
  })
}

export async function addProfileItem(item: Partial<IProfileItem>): Promise<void> {
  const newItem = await createProfile(item)
  let shouldChangeCurrent = false
  let newProfileIsCurrentAfterUpdate = false
  await updateProfileConfig((config) => {
    const existingIndex = config.items.findIndex((i) => i.id === newItem.id)
    if (existingIndex !== -1) {
      config.items[existingIndex] = newItem
    } else {
      config.items.push(newItem)
    }
    if (!config.current) {
      shouldChangeCurrent = true
      newProfileIsCurrentAfterUpdate = true
    }
    return config
  })

  // If the new profile will become the current profile, ensure generateProfile is called
  // to prepare working directory before restarting core
  if (newProfileIsCurrentAfterUpdate) {
    const { diffWorkDir } = await getAppConfig()
    if (diffWorkDir) {
      try {
        await generateProfile()
      } catch (error) {
        profileLogger.warn('Failed to generate profile for new subscription', error)
      }
    }
  }

  if (shouldChangeCurrent) {
    await changeCurrentProfile(newItem.id)
  }
  await addProfileUpdater(newItem)
}

export async function removeProfileItem(id: string): Promise<void> {
  await removeProfileUpdater(id)

  let shouldRestart = false
  await updateProfileConfig((config) => {
    config.items = config.items?.filter((item) => item.id !== id)
    if (config.current === id) {
      shouldRestart = true
      config.current = config.items.length > 0 ? config.items[0].id : undefined
    }
    return config
  })

  if (existsSync(profilePath(id))) {
    await rm(profilePath(id))
  }
  if (shouldRestart) {
    await restartCore()
  }
  await removeProfileWorkDir(id)
}

export async function getCurrentProfileItem(): Promise<IProfileItem> {
  const { current } = await getProfileConfig()
  return (
    (await getProfileItem(current)) || {
      id: 'default',
      type: 'local',
      name: i18next.t('profiles.emptyProfile')
    }
  )
}

interface FetchOptions {
  url: string
  useProxy: boolean
  mixedPort: number
  userAgent: string
  authToken?: string
  timeout: number
}

interface FetchResult {
  data: string
  headers: Record<string, string>
}

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_PROFILE_INTERVAL_MINUTES = Math.floor(MAX_TIMER_DELAY_MS / (60 * 1000))

async function fetchAndValidateSubscription(options: FetchOptions): Promise<FetchResult> {
  const { url, useProxy, mixedPort, userAgent, authToken, timeout } = options

  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept-Encoding': 'identity'
  }
  if (authToken) headers['Authorization'] = authToken

  const res = await chromeRequest.get(url, {
    headers,
    responseType: 'text',
    timeout,
    proxy: useProxy ? { protocol: 'http', host: '127.0.0.1', port: mixedPort } : false
  })

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Subscription failed: Request status code ${res.status}`)
  }

  const data = String(res.data)
  const parsed = parse(data) as Record<string, unknown> | null
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Subscription failed: Profile is not a valid YAML')
  }
  if (!parsed['proxies'] && !parsed['proxy-providers']) {
    throw new Error('Subscription failed: Profile missing proxies or providers')
  }

  return { data, headers: res.headers }
}

export async function createProfile(item: Partial<IProfileItem>): Promise<IProfileItem> {
  const id = item.id || new Date().getTime().toString(16)
  const type = item.type || 'local'
  const newItem: IProfileItem = {
    id,
    name: item.name || (type === 'remote' ? 'Remote File' : 'Local File'),
    type,
    url: item.url,
    interval: item.interval || 0,
    useProxy: item.useProxy || false,
    allowFixedInterval: item.allowFixedInterval || false,
    autoUpdate: item.autoUpdate ?? type === 'remote',
    authToken: item.authToken,
    userAgent: item.userAgent,
    updated: new Date().getTime(),
    updateTimeout: item.updateTimeout
  }

  // Local
  if (newItem.type === 'local') {
    await setProfileStr(id, item.file || '')
    return newItem
  }

  // Remote
  if (!item.url) throw new Error('Empty URL')

  const profileUrl = item.url
  const dedupKey = `${id}::${profileUrl}`
  const existing = inflightRemoteFetches.get(dedupKey)
  if (existing) return existing

  const promise = (async (): Promise<IProfileItem> => {
    const { userAgent, subscriptionTimeout = 30000 } = await getAppConfig()
    const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
    const userItemTimeoutMs =
      typeof newItem.updateTimeout === 'number' && newItem.updateTimeout > 0
        ? newItem.updateTimeout * 1000
        : subscriptionTimeout

    const baseOptions: Omit<FetchOptions, 'useProxy' | 'timeout'> = {
      url: profileUrl,
      mixedPort,
      userAgent: item.userAgent || userAgent || `clash-lite/v${app.getVersion()} (clash.meta)`,
      authToken: item.authToken
    }

    const fetchSub = (useProxy: boolean, timeout: number): Promise<FetchResult> =>
      fetchAndValidateSubscription({ ...baseOptions, useProxy, timeout })

    let result: FetchResult
    if (newItem.useProxy) {
      result = await fetchSub(Boolean(newItem.useProxy), userItemTimeoutMs)
    } else {
      try {
        result = await fetchSub(false, userItemTimeoutMs)
      } catch (directError) {
        try {
          // smart fallback
          result = await fetchSub(true, subscriptionTimeout)
        } catch {
          throw directError
        }
      }
    }

    const { data, headers } = result

    if (headers['content-disposition'] && newItem.name === 'Remote File') {
      newItem.name = parseFilename(headers['content-disposition'])
    }
    if (headers['profile-web-page-url']) {
      newItem.home = headers['profile-web-page-url']
    }
    if (headers['profile-update-interval'] && !item.allowFixedInterval) {
      const hours = Number(headers['profile-update-interval'])
      if (Number.isFinite(hours) && hours > 0) {
        newItem.interval = Math.min(Math.ceil(hours * 60), MAX_PROFILE_INTERVAL_MINUTES)
      }
    }
    if (headers['subscription-userinfo']) {
      newItem.extra = parseSubinfo(headers['subscription-userinfo'])
    }

    await setProfileStr(id, data)
    return newItem
  })()

  inflightRemoteFetches.set(dedupKey, promise)
  try {
    return await promise
  } finally {
    inflightRemoteFetches.delete(dedupKey)
  }
}

export async function getProfileStr(id: string | undefined): Promise<string> {
  if (existsSync(profilePath(id || 'default'))) {
    return await readFile(profilePath(id || 'default'), 'utf-8')
  } else {
    return stringify(defaultProfile)
  }
}

export async function setProfileStr(id: string, content: string): Promise<void> {
  // 读取最新的配置
  const { current } = await getProfileConfig(true)
  await writeFile(profilePath(id), content, 'utf-8')
  if (current === id) {
    try {
      await mihomoHotReloadConfig()
      profileLogger.info('Config reloaded successfully')
    } catch (error) {
      profileLogger.error('Failed to reload config', error)
      try {
        profileLogger.info('Falling back to restart core')
        await restartCore()
        profileLogger.info('Core restarted successfully')
      } catch (restartError) {
        profileLogger.error('Failed to restart core', restartError)
        throw restartError
      }
    }
  }
}

export async function getProfile(id: string | undefined): Promise<IMihomoConfig> {
  const profile = await getProfileStr(id)

  // 检测是否为 HTML 内容（订阅返回错误页面）
  const trimmed = profile.trim()
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML') ||
    /<style[^>]*>/i.test(trimmed.slice(0, 500))
  ) {
    throw new Error(
      `Profile "${id}" contains HTML instead of YAML. The subscription may have returned an error page. Please re-import or update the subscription.`
    )
  }

  try {
    let result = parse(profile)
    if (typeof result !== 'object') result = {}
    return result as IMihomoConfig
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to parse profile "${id}": ${msg}`)
  }
}

// attachment;filename=xxx.yaml; filename*=UTF-8''%xx%xx%xx
function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    const parts = str.split(/filename\*=.*''/)
    if (parts[1]) {
      return decodeURIComponent(parts[1])
    }
  }
  const parts = str.split('filename=')
  if (parts[1]) {
    return parts[1].replace(/^["']|["']$/g, '')
  }
  return 'Remote File'
}

// subscription-userinfo: upload=1234; download=2234; total=1024000; expire=2218532293
function parseSubinfo(str: string): ISubscriptionUserInfo {
  const parts = str.split(/\s*;\s*/)
  const obj = {} as ISubscriptionUserInfo
  parts.forEach((part) => {
    const [key, value] = part.split('=')
    obj[key] = parseInt(value)
  })
  return obj
}

