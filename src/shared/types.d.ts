type OutboundMode = 'rule' | 'global' | 'direct'
type LogLevel = 'info' | 'debug' | 'warning' | 'error' | 'silent'
type SysProxyMode = 'auto' | 'manual'
type AppTheme = 'system' | 'light' | 'dark'
type MihomoGroupType = 'Selector' | 'URLTest' | 'Fallback' | 'LoadBalance' | 'Relay'
type Priority =
  | 'PRIORITY_LOW'
  | 'PRIORITY_BELOW_NORMAL'
  | 'PRIORITY_NORMAL'
  | 'PRIORITY_ABOVE_NORMAL'
  | 'PRIORITY_HIGH'
  | 'PRIORITY_HIGHEST'
type MihomoProxyType =
  | 'Direct'
  | 'Reject'
  | 'RejectDrop'
  | 'Pass'
  | 'Dns'
  | 'Compatible'
  | 'Socks5'
  | 'Http'
  | 'Ssh'
  | 'Shadowsocks'
  | 'ShadowsocksR'
  | 'Snell'
  | 'Vmess'
  | 'Vless'
  | 'Trojan'
  | 'Hysteria'
  | 'Hysteria2'
  | 'Tuic'
  | 'WireGuard'
  | 'Mieru'
  | 'AnyTLS'
  | 'Sudoku'
  | 'Masque'
  | 'TrustTunnel'
type TunStack = 'gvisor' | 'mixed' | 'system'
type DnsMode = 'normal' | 'fake-ip' | 'redir-host' | 'hosts'
type FilterMode = 'blacklist' | 'whitelist' | 'rule'
type NetworkInterfaceInfo = os.NetworkInterfaceInfo

interface IAppVersion {
  version: string
  changelog: string
}

interface IMihomoVersion {
  version: string
  meta: boolean
}

interface IMihomoTrafficInfo {
  up: number
  down: number
}

interface IMihomoMemoryInfo {
  inuse: number
  oslimit: number
}

interface IMihomoLogInfo {
  type: LogLevel
  payload: string
  time?: string
}

interface IMihomoConnectionsInfo {
  downloadTotal: number
  uploadTotal: number
  connections?: IMihomoConnectionDetail[]
  memory: number
}

interface IMihomoConnectionDetail {
  id: string
  isActive: boolean
  metadata: {
    network: 'tcp' | 'udp'
    type: string
    sourceIP: string
    sourceGeoIP: string[]
    sourceIPASN: string
    destinationIP: string
    destinationGeoIP: string[]
    destinationIPASN: string
    sourcePort: string
    destinationPort: string
    inboundIP: string
    inboundPort: string
    inboundName: string
    inboundUser: string
    host: string
    dnsMode: string
    uid: number
    process: string
    processPath: string
    specialProxy: string
    specialRules: string
    remoteDestination: string
    dscp: number
    sniffHost: string
  }
  uploadSpeed?: number
  downloadSpeed?: number
  upload: number
  download: number
  start: string
  chains: string[]
  providerChains: string[]
  rule: string
  rulePayload: string
}

interface IMihomoHistory {
  time: string
  delay: number
}

type IMihomoGroupDelay = Record<string, number>

interface IMihomoDelay {
  delay?: number
  message?: string
}

interface IMihomoProxy {
  alive: boolean
  extra: Record<string, { alive: boolean; history: IMihomoHistory[] }>
  history: IMihomoHistory[]
  id: string
  name: string
  tfo: boolean
  type: MihomoProxyType
  udp: boolean
  uot: boolean
  xudp: boolean
  mptcp: boolean
  smux: boolean
  interface?: string
  'routing-mark'?: number
  'provider-name'?: string
  'dialer-proxy'?: string
}

interface IMihomoGroup {
  alive: boolean
  all: string[]
  extra: Record<string, { alive: boolean; history: IMihomoHistory[] }>
  testUrl?: string
  expectedStatus?: string
  hidden: boolean
  history: IMihomoHistory[]
  icon: string
  name: string
  now: string
  tfo: boolean
  type: MihomoGroupType
  udp: boolean
  xudp: boolean
}

interface IMihomoProxies {
  proxies: Record<string, IMihomoProxy | IMihomoGroup>
}

interface IMihomoMixedGroup extends IMihomoGroup {
  all: (IMihomoProxy | IMihomoGroup)[]
}

type IMihomoMixedGroupSummary = Omit<IMihomoGroup, 'all'> & {
  allCount: number
}

interface IMihomoProxyProviders {
  providers: Record<string, IMihomoProxyProvider>
}

interface ISubscriptionUserInfoUpper {
  Upload: number
  Download: number
  Total: number
  Expire: number
}

interface IMihomoProxyProvider {
  name: string
  type: string
  proxies?: IMihomoProxy[]
  subscriptionInfo?: ISubscriptionUserInfoUpper
  expectedStatus: string
  testUrl?: string
  updatedAt?: string
  vehicleType: string
}

interface ISysProxyConfig {
  enable: boolean
  host?: string
  mode?: SysProxyMode
  bypass?: string[]
  pacScript?: string
}

interface INetworkLatencyTarget {
  name: string
  url: string
}

interface IAppConfig {
  proxyDisplayMode: 'simple' | 'full'
  profileDisplayDate?: 'expire' | 'update'
  envType?: ('bash' | 'cmd' | 'powershell' | 'fish' | 'nushell')[]
  proxyCols: 'auto' | '1' | '2' | '3' | '4'
  connectionDirection: 'asc' | 'desc'
  connectionOrderBy: 'time' | 'upload' | 'download' | 'uploadSpeed' | 'downloadSpeed'
  connectionViewMode?: 'list' | 'table'
  connectionTableColumns?: string[]
  connectionTableColumnWidths?: Record<string, number>
  connectionTableSortColumn?: string
  connectionTableSortDirection?: 'asc' | 'desc'
  disableHardwareAcceleration?: boolean
  autoQuitWithoutCore?: boolean
  autoQuitWithoutCoreDelay?: number
  mihomoCpuPriority?: Priority
  diffWorkDir?: boolean
  useWindowFrame: boolean
  appTheme: AppTheme
  autoCheckUpdate: boolean
  silentStart: boolean
  sysProxy: ISysProxyConfig
  maxLogDays: number
  maxLogFileSize: number
  userAgent?: string
  delayTestConcurrency?: number
  delayTestUrl?: string
  delayTestTimeout?: number
  networkLatencyTargets?: INetworkLatencyTarget[]
  subscriptionTimeout?: number
  useDockIcon?: boolean
  showTraffic?: boolean
  disableAnimations?: boolean
  language?: 'zh-CN' | 'zh-TW' | 'en-US' | 'ru-RU' | 'fa-IR'
  triggerMainWindowBehavior?: 'show' | 'toggle'
}

interface IMihomoTunConfig {
  enable?: boolean
  stack?: TunStack
  'auto-route'?: boolean
  'auto-redirect'?: boolean
  'auto-detect-interface'?: boolean
  'dns-hijack'?: string[]
  device?: string
  mtu?: number
  'strict-route'?: boolean
  gso?: boolean
  'gso-max-size'?: number
  'udp-timeout'?: number
  'iproute2-table-index'?: number
  'iproute2-rule-index'?: number
  'endpoint-independent-nat'?: boolean
  'route-address-set'?: string[]
  'route-exclude-address-set'?: string[]
  'route-address'?: string[]
  'route-exclude-address'?: string[]
  'include-interface'?: string[]
  'exclude-interface'?: string[]
  'include-uid'?: number[]
  'include-uid-range'?: string[]
  'exclude-uid'?: number[]
  'exclude-uid-range'?: string[]
  'include-android-user'?: string[]
  'include-package'?: string[]
  'exclude-package'?: string[]
}
interface IMihomoDNSConfig {
  enable?: boolean
  listen?: string
  ipv6?: boolean
  'ipv6-timeout'?: number
  'prefer-h3'?: boolean
  'enhanced-mode'?: DnsMode
  'fake-ip-range'?: string
  'fake-ip-filter'?: string[]
  'fake-ip-filter-mode'?: FilterMode
  'use-hosts'?: boolean
  'use-system-hosts'?: boolean
  'respect-rules'?: boolean
  'default-nameserver'?: string[]
  nameserver?: string[]
  fallback?: string[]
  'fallback-filter'?: { [key: string]: boolean | string | string[] }
  'proxy-server-nameserver'?: string[]
  'direct-nameserver'?: string[]
  'direct-nameserver-follow-policy'?: boolean
  'nameserver-policy'?: { [key: string]: string | string[] }
  'cache-algorithm'?: string
}

interface IMihomoSnifferConfig {
  enable?: boolean
  'parse-pure-ip'?: boolean
  'override-destination'?: boolean
  'force-dns-mapping'?: boolean
  'force-domain'?: string[]
  'skip-domain'?: string[]
  'skip-dst-address'?: string[]
  'skip-src-address'?: string[]
  sniff?: {
    HTTP?: {
      ports: (number | string)[]
      'override-destination'?: boolean
    }
    TLS?: {
      ports: (number | string)[]
    }
    QUIC?: {
      ports: (number | string)[]
    }
  }
}

interface IMihomoConfig {
  mode: OutboundMode
  'mixed-port': number
  'log-level': LogLevel
  proxies?: []
  'proxy-groups'?: []
  rules?: []
  hosts?: { [key: string]: string | string[] }
  'geodata-mode'?: boolean
  'geo-auto-update'?: boolean
  'geo-update-interval'?: number
  'geox-url'?: {
    geoip?: string
    geosite?: string
    mmdb?: string
    asn?: string
  }
  tun: IMihomoTunConfig
  dns: IMihomoDNSConfig
  sniffer: IMihomoSnifferConfig
}

interface IProfileConfig {
  current?: string
  items: IProfileItem[]
}

interface ISubscriptionUserInfo {
  upload: number
  download: number
  total: number
  expire: number
}

interface IProfileItem {
  id: string
  type: 'remote' | 'local'
  name: string
  url?: string // remote
  file?: string // local
  interval?: number | string
  home?: string
  updated?: number
  useProxy?: boolean
  extra?: ISubscriptionUserInfo
  allowFixedInterval?: boolean
  autoUpdate?: boolean
  authToken?: string
  userAgent?: string
  updateTimeout?: number
}
