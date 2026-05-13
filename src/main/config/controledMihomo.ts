import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { controledMihomoConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { generateProfile } from '../core/factory'
import { patchMihomoConfig, restartMihomoLogs } from '../core/mihomoApi'
import { defaultControledMihomoConfig } from '../utils/template'
import { deepMerge } from '../utils/merge'
import { createLogger } from '../utils/logger'

const controledMihomoLogger = createLogger('ControledMihomo')

let controledMihomoConfig: Partial<IMihomoConfig> // mihomo.yaml
let controledMihomoWriteQueue: Promise<void> = Promise.resolve()

const CONTROLLED_CONFIG_KEYS: (keyof IMihomoConfig)[] = ['mode', 'mixed-port', 'log-level', 'tun']

function cloneDefaultControledMihomoConfig(): Partial<IMihomoConfig> {
  return JSON.parse(JSON.stringify(defaultControledMihomoConfig)) as Partial<IMihomoConfig>
}

function pickControledMihomoConfig(config: Partial<IMihomoConfig>): Partial<IMihomoConfig> {
  const picked: Partial<IMihomoConfig> = {}

  for (const key of CONTROLLED_CONFIG_KEYS) {
    if (config[key] !== undefined) {
      picked[key] = config[key] as never
    }
  }

  if (picked.tun) {
    picked.tun = { enable: picked.tun.enable ?? true } as IMihomoTunConfig
  }

  return picked
}

function normalizeControledMihomoConfig(config: Partial<IMihomoConfig>): Partial<IMihomoConfig> {
  const normalized = pickControledMihomoConfig(config)

  if (typeof normalized['mixed-port'] !== 'number' || Number.isNaN(normalized['mixed-port'])) {
    normalized['mixed-port'] = defaultControledMihomoConfig['mixed-port']
  }

  if (!['rule', 'global', 'direct'].includes(normalized.mode || '')) {
    normalized.mode = defaultControledMihomoConfig.mode
  }

  if (!['silent', 'error', 'warning', 'info', 'debug'].includes(normalized['log-level'] || '')) {
    normalized['log-level'] = defaultControledMihomoConfig['log-level']
  }

  normalized.tun = {
    enable: normalized.tun?.enable ?? true
  } as IMihomoTunConfig

  return normalized
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

    const mergedConfig = deepMerge(cloneDefaultControledMihomoConfig(), controledMihomoConfig)
    const normalizedConfig = normalizeControledMihomoConfig(mergedConfig)

    if (JSON.stringify(normalizedConfig) !== JSON.stringify(mergedConfig)) {
      controledMihomoConfig = normalizedConfig
      try {
        await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')
      } catch (error) {
        controledMihomoLogger.error('Failed to update mihomo.yaml file', error)
      }
    } else {
      controledMihomoConfig = normalizedConfig
    }
  }
  if (typeof controledMihomoConfig !== 'object')
    controledMihomoConfig = cloneDefaultControledMihomoConfig()
  return controledMihomoConfig
}

export async function patchControledMihomoConfig(patch: Partial<IMihomoConfig>): Promise<void> {
  controledMihomoWriteQueue = controledMihomoWriteQueue.then(async () => {
    patch = pickControledMihomoConfig(patch)

    if (
      'mixed-port' in patch &&
      (typeof patch['mixed-port'] !== 'number' || Number.isNaN(patch['mixed-port']))
    ) {
      delete patch['mixed-port']
    }

    const currentConfig = controledMihomoConfig ?? (await getControledMihomoConfig())
    controledMihomoConfig = normalizeControledMihomoConfig(deepMerge(currentConfig, patch))

    await generateProfile()
    await writeFile(controledMihomoConfigPath(), stringify(controledMihomoConfig), 'utf-8')

    // 优先对运行中内核进行热更新，避免无意义重启
    try {
      if (Object.keys(patch).length > 0) {
        await patchMihomoConfig(patch)
      }
      if ('log-level' in patch) {
        await restartMihomoLogs()
      }
    } catch (error) {
      controledMihomoLogger.warn(
        'Hot patch /configs failed, changes will apply on next restart',
        error
      )
    }
  })
  await controledMihomoWriteQueue
}
