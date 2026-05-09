import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { controledMihomoConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { generateProfile } from '../core/factory'
import { patchMihomoConfig } from '../core/mihomoApi'
import { defaultControledMihomoConfig } from '../utils/template'
import { deepMerge } from '../utils/merge'
import { createLogger } from '../utils/logger'

const controledMihomoLogger = createLogger('ControledMihomo')

let controledMihomoConfig: Partial<IMihomoConfig> // mihomo.yaml
let controledMihomoWriteQueue: Promise<void> = Promise.resolve()

function cloneDefaultControledMihomoConfig(): Partial<IMihomoConfig> {
  return JSON.parse(JSON.stringify(defaultControledMihomoConfig)) as Partial<IMihomoConfig>
}

function sanitizePatch(patch: Partial<IMihomoConfig>): Partial<IMihomoConfig> {
  const sanitized = { ...patch }

  delete sanitized.dns
  delete sanitized.hosts
  delete sanitized.sniffer
  delete sanitized['geo-auto-update']
  delete sanitized['geo-update-interval']
  delete sanitized['geodata-mode']
  delete sanitized['geox-url']

  if (sanitized.tun) {
    sanitized.tun = { enable: sanitized.tun.enable ?? true } as IMihomoTunConfig
  }

  return sanitized
}

export async function getControledMihomoConfig(force = false): Promise<Partial<IMihomoConfig>> {
  if (force || !controledMihomoConfig) {
    if (existsSync(controledMihomoConfigPath())) {
      const data = await readFile(controledMihomoConfigPath(), 'utf-8')
      controledMihomoConfig = parse(data) || cloneDefaultControledMihomoConfig()
    } else {
      controledMihomoConfig = cloneDefaultControledMihomoConfig()
      try {
        await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')
      } catch (error) {
        controledMihomoLogger.error('Failed to create mihomo.yaml file', error)
      }
    }

    // 确保配置包含所有必要的默认字段，处理升级场景
    controledMihomoConfig = deepMerge(cloneDefaultControledMihomoConfig(), controledMihomoConfig)

    // 清理端口字段中的 NaN 值，恢复为默认值
    const portFields = ['mixed-port', 'socks-port', 'port', 'redir-port', 'tproxy-port'] as const
    for (const field of portFields) {
      if (
        typeof controledMihomoConfig[field] !== 'number' ||
        Number.isNaN(controledMihomoConfig[field])
      ) {
        controledMihomoConfig[field] = defaultControledMihomoConfig[field]
      }
    }

    const sanitizedConfig = sanitizePatch(controledMihomoConfig)
    sanitizedConfig.tun = {
      enable: sanitizedConfig.tun?.enable ?? true
    } as IMihomoTunConfig

    if (JSON.stringify(sanitizedConfig) !== JSON.stringify(controledMihomoConfig)) {
      controledMihomoConfig = sanitizedConfig
      try {
        await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')
      } catch (error) {
        controledMihomoLogger.error('Failed to sanitize mihomo.yaml file', error)
      }
    } else {
      controledMihomoConfig = sanitizedConfig
    }
  }
  if (typeof controledMihomoConfig !== 'object')
    controledMihomoConfig = cloneDefaultControledMihomoConfig()
  return controledMihomoConfig
}

export async function patchControledMihomoConfig(patch: Partial<IMihomoConfig>): Promise<void> {
  controledMihomoWriteQueue = controledMihomoWriteQueue.then(async () => {
    patch = sanitizePatch(patch)

    // 过滤端口字段中的 NaN 值，防止写入无效配置
    const portFields = ['mixed-port', 'socks-port', 'port', 'redir-port', 'tproxy-port'] as const
    for (const field of portFields) {
      if (field in patch && (typeof patch[field] !== 'number' || Number.isNaN(patch[field]))) {
        delete patch[field]
      }
    }

    controledMihomoConfig = deepMerge(controledMihomoConfig, patch)
    controledMihomoConfig.tun = {
      enable: controledMihomoConfig.tun?.enable ?? true
    } as IMihomoTunConfig
    delete controledMihomoConfig.dns
    delete controledMihomoConfig.hosts
    delete controledMihomoConfig.sniffer
    delete controledMihomoConfig['geo-auto-update']
    delete controledMihomoConfig['geo-update-interval']
    delete controledMihomoConfig['geodata-mode']
    delete controledMihomoConfig['geox-url']

    await generateProfile()
    await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')

    // 优先对运行中内核进行热更新，避免无意义重启
    try {
      await patchMihomoConfig(sanitizePatch(patch))
    } catch (error) {
      controledMihomoLogger.warn(
        'Hot patch /configs failed, changes will apply on next restart',
        error
      )
    }
  })
  await controledMihomoWriteQueue
}
