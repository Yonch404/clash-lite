import { copyFile, mkdir, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getControledMihomoConfig, getProfileConfig, getProfile, getAppConfig } from '../config'
import { hasUsableMihomoProfile } from '../config/profileAvailability'
import { mihomoProfileWorkDir, mihomoWorkConfigPath, mihomoWorkDir } from '../utils/dirs'
import { stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import {
  getPendingSubscriptionDirectTargets,
  getSubscriptionDirectTarget,
  subscriptionDirectTargetKey,
  type SubscriptionDirectTarget
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

function getSubscriptionDirectTargets(profileConfig: IProfileConfig): SubscriptionDirectTarget[] {
  const targets = new Map<string, SubscriptionDirectTarget>()

  for (const item of profileConfig.items || []) {
    if (item.type !== 'remote' || item.useProxy || !item.url) continue

    const target = getSubscriptionDirectTarget(item.url)
    if (target) {
      targets.set(subscriptionDirectTargetKey(target), target)
    }
  }

  for (const target of getPendingSubscriptionDirectTargets()) {
    targets.set(subscriptionDirectTargetKey(target), target)
  }

  return Array.from(targets.values())
}

function getSubscriptionDirectRule(target: SubscriptionDirectTarget): string {
  if (target.type === 'domain') {
    return `DOMAIN,${target.value},DIRECT`
  }

  if (target.family === 6) {
    return `IP-CIDR6,${target.value}/128,DIRECT,no-resolve`
  }

  return `IP-CIDR,${target.value}/32,DIRECT,no-resolve`
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
  const targets = getSubscriptionDirectTargets(profileConfig)
  if (targets.length === 0) return

  const directRules = targets.map(getSubscriptionDirectRule)
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
