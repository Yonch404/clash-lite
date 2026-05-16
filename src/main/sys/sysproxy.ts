import { triggerAutoProxy, triggerManualProxy } from 'sysproxy-rs'
import { net } from 'electron'
import { getAppConfig, getControledMihomoConfig, hasUsableCurrentProfile } from '../config'
import { pacPort, startPacServer, stopPacServer } from '../resolve/server'
import { proxyLogger } from '../utils/logger'

let triggerSysProxyTimer: NodeJS.Timeout | null = null

const defaultBypass: string[] = (() => {
  switch (process.platform) {
    case 'linux':
      return ['localhost', '127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '::1']
    case 'darwin':
      return [
        '127.0.0.1',
        '192.168.0.0/16',
        '10.0.0.0/8',
        '172.16.0.0/12',
        'localhost',
        '*.local',
        '*.crashlytics.com',
        '<local>'
      ]
    case 'win32':
      return [
        'localhost',
        '127.*',
        '192.168.*',
        '10.*',
        '172.16.*',
        '172.17.*',
        '172.18.*',
        '172.19.*',
        '172.20.*',
        '172.21.*',
        '172.22.*',
        '172.23.*',
        '172.24.*',
        '172.25.*',
        '172.26.*',
        '172.27.*',
        '172.28.*',
        '172.29.*',
        '172.30.*',
        '172.31.*',
        '<local>'
      ]
    default:
      return ['localhost', '127.0.0.1', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '::1']
  }
})()

export async function triggerSysProxy(enable: boolean): Promise<void> {
  const canEnable = enable && (await hasUsableCurrentProfile())
  if (net.isOnline()) {
    if (canEnable) {
      await disableSysProxy()
      await enableSysProxy()
    } else {
      await disableSysProxy()
    }
  } else {
    if (triggerSysProxyTimer) clearTimeout(triggerSysProxyTimer)
    triggerSysProxyTimer = setTimeout(() => triggerSysProxy(enable), 5000)
  }
}

async function enableSysProxy(): Promise<void> {
  await startPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode, host, bypass = defaultBypass } = sysProxy
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  const proxyHost = host || '127.0.0.1'

  try {
    if (mode === 'auto') {
      triggerAutoProxy(true, `http://${proxyHost}:${pacPort}/pac`)
    } else {
      triggerManualProxy(true, proxyHost, port, bypass.join(','))
    }
  } catch (error) {
    await proxyLogger.error('Failed to enable system proxy', error)
    throw error
  }
}

async function disableSysProxy(): Promise<void> {
  await stopPacServer()

  try {
    triggerAutoProxy(false, '')
    triggerManualProxy(false, '', 0, '')
  } catch (error) {
    await proxyLogger.error('Failed to disable system proxy', error)
    throw error
  }
}

export function disableSysProxySync(): void {
  try {
    triggerAutoProxy(false, '')
    triggerManualProxy(false, '', 0, '')
  } catch {
    // ignore errors during sync disable
  }
}
