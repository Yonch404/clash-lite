import { copyFile, mkdir, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getControledMihomoConfig, getProfileConfig, getProfile, getAppConfig } from '../config'
import { hasUsableMihomoProfile } from '../config/profileAvailability'
import { mihomoProfileWorkDir, mihomoWorkConfigPath, mihomoWorkDir } from '../utils/dirs'
import { stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import {
  getPendingSubscriptionDirectHosts,
  getSubscriptionHostname
} from '../utils/subscriptionRules'

const CONTROLLED_CONFIG_KEYS: (keyof IMihomoConfig)[] = ['mode', 'mixed-port', 'log-level', 'tun']

let runtimeConfigStr: string = ''
let runtimeConfig: IMihomoConfig = {} as IMihomoConfig

function pickRuntimeControlledConfig(config: Partial<IMihomoConfig>): Partial<IMihomoConfig> {
  const picked: Partial<IMihomoConfig> = {}

  for (const key of CONTROLLED_CONFIG_KEYS) {
    if (config[key] !== undefined) {
      picked[key] = config[key] as never
    }
  }

  return picked
}

function getSubscriptionHostnames(profileConfig: IProfileConfig): string[] {
  const hostnames = new Set<string>()

  for (const item of profileConfig.items || []) {
    if (item.type !== 'remote' || item.useProxy || !item.url) continue

    const hostname = getSubscriptionHostname(item.url)
    if (hostname) {
      hostnames.add(hostname)
    }
  }

  return Array.from(new Set([...hostnames, ...getPendingSubscriptionDirectHosts()]))
}

function mergeUniqueStrings(current: string[] | undefined, additions: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of [...(current || []), ...additions]) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}

function injectSubscriptionDirectRules(
  profile: IMihomoConfig,
  profileConfig: IProfileConfig
): void {
  const hostnames = getSubscriptionHostnames(profileConfig)
  if (hostnames.length === 0) return

  const directRules = hostnames.map((hostname) => `DOMAIN,${hostname},DIRECT`)
  const currentRules = Array.isArray(profile.rules) ? (profile.rules as string[]) : []
  profile.rules = mergeUniqueStrings(directRules, currentRules) as never
}

export async function generateProfile(): Promise<string | undefined> {
  // 读取最新的配置
  const profileConfig = await getProfileConfig(true)
  const { current } = profileConfig
  const { diffWorkDir = false } = await getAppConfig()
  const baseProfile = await getProfile(current)
  const profileUsable = hasUsableMihomoProfile(baseProfile)
  const controlledConfig = pickRuntimeControlledConfig(await getControledMihomoConfig())
  const profile = deepMerge(baseProfile, controlledConfig)

  profile.tun = {
    ...(baseProfile.tun || {}),
    enable: profileUsable && (controlledConfig.tun?.enable ?? true)
  } as IMihomoTunConfig

  injectSubscriptionDirectRules(profile, profileConfig)

  if (!['silent', 'error', 'warning', 'info', 'debug'].includes(profile['log-level'])) {
    profile['log-level'] = 'warning'
  }
  runtimeConfig = profile
  runtimeConfigStr = stringify(profile)
  if (diffWorkDir) {
    await prepareProfileWorkDir(current)
  }
  await writeFile(
    diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
    runtimeConfigStr
  )
  return current
}

async function prepareProfileWorkDir(current: string | undefined): Promise<void> {
  if (!existsSync(mihomoProfileWorkDir(current))) {
    await mkdir(mihomoProfileWorkDir(current), { recursive: true })
  }

  const isSourceNewer = async (sourcePath: string, targetPath: string): Promise<boolean> => {
    try {
      const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
      return sourceStats.mtime > targetStats.mtime
    } catch {
      return true
    }
  }

  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoProfileWorkDir(current), file)
    const sourcePath = path.join(mihomoWorkDir(), file)
    if (!existsSync(sourcePath)) return
    // 复制条件：目标不存在 或 源文件更新
    const shouldCopy = !existsSync(targetPath) || (await isSourceNewer(sourcePath, targetPath))
    if (shouldCopy) {
      await copyFile(sourcePath, targetPath)
    }
  }
  await Promise.all([
    copy('country.mmdb'),
    copy('geoip.metadb'),
    copy('geoip.dat'),
    copy('geosite.dat'),
    copy('ASN.mmdb')
  ])
}

export async function getRuntimeConfigStr(): Promise<string> {
  return runtimeConfigStr
}

export async function getRuntimeConfig(): Promise<IMihomoConfig> {
  return runtimeConfig
}
