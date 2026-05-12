export const defaultConfig: IAppConfig = {
  core: 'mihomo',
  silentStart: false,
  appTheme: 'system',
  useWindowFrame: false,
  proxyInTray: true,
  showCurrentProxyInTray: false,
  trayProxyGroupStyle: 'default',
  maxLogDays: 3,
  maxLogFileSize: 10,
  proxyCols: 'auto',
  connectionDirection: 'asc',
  connectionOrderBy: 'time',
  proxyDisplayMode: 'simple',
  autoCheckUpdate: true,
  subscriptionTimeout: 30000,
  networkLatencyTargets: [],
  floatingWindowCompatMode: true,
  disableHardwareAcceleration: false,
  sysProxy: { enable: true, mode: 'manual' },
  triggerMainWindowBehavior: 'show',
  showMixedPort: 7890,
  enableMixedPort: true,
  showSocksPort: 7891,
  enableSocksPort: true,
  showHttpPort: 7892,
  enableHttpPort: true,
  showRedirPort: 0,
  enableRedirPort: false,
  showTproxyPort: 0,
  enableTproxyPort: false,
  testProfileOnStart: true
}

export const defaultControledMihomoConfig: Partial<IMihomoConfig> = {
  'external-controller': '',
  ipv6: true,
  mode: 'rule',
  'mixed-port': 7890,
  'socks-port': 7891,
  port: 7892,
  'redir-port': 0,
  'tproxy-port': 0,
  'allow-lan': false,
  'unified-delay': true,
  'tcp-concurrent': false,
  'log-level': 'warning',
  'find-process-mode': 'strict',
  'bind-address': '*',
  'lan-allowed-ips': ['0.0.0.0/0', '::/0'],
  'lan-disallowed-ips': [],
  authentication: [],
  'skip-auth-prefixes': ['127.0.0.1/32', '::1/128'],
  tun: {
    enable: true
  },
  profile: {
    'store-selected': true,
    'store-fake-ip': true
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
