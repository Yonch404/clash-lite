import { copyFile, mkdir, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getControledMihomoConfig, getProfileConfig, getProfile, getAppConfig } from '../config'
import { mihomoProfileWorkDir, mihomoWorkConfigPath, mihomoWorkDir } from '../utils/dirs'
import { stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'

const CONTROLLED_CONFIG_KEYS: (keyof IMihomoConfig)[] = [
  'external-controller',
  'ipv6',
  'mode',
  'mixed-port',
  'socks-port',
  'port',
  'redir-port',
  'tproxy-port',
  'allow-lan',
  'unified-delay',
  'tcp-concurrent',
  'log-level',
  'find-process-mode',
  'bind-address',
  'lan-allowed-ips',
  'lan-disallowed-ips',
  'authentication',
  'skip-auth-prefixes',
  'tun',
  'profile'
]

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

export async function generateProfile(): Promise<string | undefined> {
  // 读取最新的配置
  const { current } = await getProfileConfig(true)
  const { diffWorkDir = false } = await getAppConfig()
  const baseProfile = await getProfile(current)
  const controlledConfig = pickRuntimeControlledConfig(await getControledMihomoConfig())
  const profile = deepMerge(baseProfile, controlledConfig)

  profile.tun = {
    ...(baseProfile.tun || {}),
    enable: controlledConfig.tun?.enable ?? true
  } as IMihomoTunConfig

  if (!['silent', 'error', 'warning', 'info', 'debug'].includes(profile['log-level'])) {
    profile['log-level'] = 'warning'
  }
  // 删除空的局域网允许列表，避免局域网访问异常
  if (!profile['lan-allowed-ips']?.length) {
    delete profile['lan-allowed-ips']
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
