export const defaultConfig: IAppConfig = {
  silentStart: false,
  appTheme: 'system',
  useWindowFrame: false,
  maxLogDays: 3,
  maxLogFileSize: 10,
  proxyCols: 'auto',
  connectionDirection: 'asc',
  connectionOrderBy: 'time',
  proxyDisplayMode: 'simple',
  autoCheckUpdate: true,
  subscriptionTimeout: 30000,
  networkLatencyTargets: [],
  disableHardwareAcceleration: false,
  sysProxy: { enable: true, mode: 'manual' },
  triggerMainWindowBehavior: 'show'
}

export const defaultControledMihomoConfig: Partial<IMihomoConfig> = {
  mode: 'rule',
  'mixed-port': 7890,
  'log-level': 'warning',
  tun: {
    enable: true
  }
}

export const defaultProfileConfig: IProfileConfig = {
  items: []
}

export const defaultProfile: Partial<IMihomoConfig> = {
  proxies: [],
  'proxy-groups': [],
  rules: []
}
