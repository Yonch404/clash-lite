import { getAppConfig } from '../config'
import { triggerSysProxy } from '../sys/sysproxy'

export async function syncConfiguredSysProxy(): Promise<void> {
  const { sysProxy } = await getAppConfig()
  await triggerSysProxy(sysProxy.enable)
}
