import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import WebSocket from 'ws'
import i18next from '../../shared/i18n'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { mainWindow } from '../window'
import { tray } from '../resolve/tray'
import { calcTraffic } from '../utils/calc'
import { createLogger } from '../utils/logger'
import { mihomoWorkConfigPath } from '../utils/dirs'
import { generateProfile, getRuntimeConfig } from './factory'
import { getMihomoIpcPath } from './manager'
import { getWindowsControllerEndpoint } from './windowsElevated'
import { ensureTunCorePrivilege } from './permissions'

const mihomoApiLogger = createLogger('MihomoApi')

let axiosIns: AxiosInstance | null = null
let currentEndpointKey: string = ''
let mihomoTrafficWs: WebSocket | null = null
let trafficRetry = 10
let mihomoMemoryWs: WebSocket | null = null
let memoryRetry = 10
let mihomoLogsWs: WebSocket | null = null
let logsRetry = 10
let mihomoConnectionsWs: WebSocket | null = null
let connectionsRetry = 10
let logsSubscribed = false
let connectionsSubscribed = false
let logsStartToken = 0
let connectionsStartToken = 0

const MAX_RETRY = 10

interface MihomoApiConnection {
  key: string
  displayKey: string
  axiosConfig: AxiosRequestConfig
  getWsUrl: (path: string) => string
  wsOptions?: WebSocket.ClientOptions
}

async function getMihomoApiConnection(): Promise<MihomoApiConnection> {
  if (process.platform === 'win32') {
    const endpoint = await getWindowsControllerEndpoint()
    const authHeaders = {
      Authorization: `Bearer ${endpoint.secret}`
    }
    const baseURL = `http://${endpoint.host}:${endpoint.port}`

    return {
      key: `tcp:${baseURL}:${endpoint.secret}`,
      displayKey: `tcp:${baseURL}`,
      axiosConfig: {
        baseURL,
        timeout: 15000,
        headers: authHeaders
      },
      getWsUrl: (path) => `ws://${endpoint.host}:${endpoint.port}${path}`,
      wsOptions: {
        headers: authHeaders
      }
    }
  }

  const socketPath = getMihomoIpcPath()

  return {
    key: `socket:${socketPath}`,
    displayKey: `socket:${socketPath}`,
    axiosConfig: {
      baseURL: 'http://localhost',
      socketPath,
      timeout: 15000
    },
    getWsUrl: (path) => `ws+unix:${socketPath}:${path}`
  }
}

function isWebSocketActive(ws: WebSocket | null): boolean {
  return ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING
}

function safelyDisposeWebSocket(ws: WebSocket | null): void {
  if (!ws) return

  ws.removeAllListeners()
  ws.on('error', () => {
    // Swallow late errors from sockets that are being disposed.
  })

  try {
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.once('open', () => {
        try {
          ws.close()
        } catch {
          // ignore
        }
      })
      return
    }

    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
      ws.close()
    }
  } catch (error) {
    mihomoApiLogger.debug('Ignored WebSocket dispose error', error)
  }
}

export const getAxios = async (force: boolean = false): Promise<AxiosInstance> => {
  const connection = await getMihomoApiConnection()

  if (axiosIns && !force && currentEndpointKey === connection.key) {
    return axiosIns
  }

  invalidateVisibleMihomoGroupsDataCache()
  currentEndpointKey = connection.key
  mihomoApiLogger.info(`Creating axios instance with endpoint: ${connection.displayKey}`)

  axiosIns = axios.create(connection.axiosConfig)

  axiosIns.interceptors.response.use(
    (response) => {
      return response.data
    },
    (error) => {
      if (error.code === 'ENOENT') {
        mihomoApiLogger.debug(`Pipe not ready: ${error.config?.socketPath}`)
      } else {
        mihomoApiLogger.error(
          `Axios error with endpoint ${connection.displayKey}: ${error.message}`
        )
      }

      if (error.response && error.response.data) {
        return Promise.reject(error.response.data)
      }
      return Promise.reject(error)
    }
  )
  return axiosIns
}

export async function mihomoVersion(): Promise<IMihomoVersion> {
  const instance = await getAxios()
  return await instance.get('/version')
}

export const patchMihomoConfig = async (patch: Partial<IMihomoConfig>): Promise<void> => {
  invalidateVisibleMihomoGroupsDataCache()
  const instance = await getAxios()
  return await instance.patch('/configs', patch)
}

export const mihomoCloseConnection = async (id: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.delete(`/connections/${encodeURIComponent(id)}`)
}

export const mihomoCloseAllConnections = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.delete('/connections')
}

export const mihomoProxies = async (): Promise<IMihomoProxies> => {
  const instance = await getAxios()
  const proxies = (await instance.get('/proxies')) as IMihomoProxies
  if (!proxies.proxies['GLOBAL']) {
    throw new Error('GLOBAL proxy not found')
  }
  return proxies
}

interface MihomoRuntimeGroup {
  name: string
  url?: string
}

interface VisibleMihomoGroupsData {
  entries: { group: IMihomoGroup; testUrl?: string }[]
  proxies: IMihomoProxies | null
}

let visibleMihomoGroupsDataRequest: Promise<VisibleMihomoGroupsData> | null = null
let visibleMihomoGroupsDataCacheVersion = 0

function invalidateVisibleMihomoGroupsDataCache(): void {
  visibleMihomoGroupsDataCacheVersion++
  visibleMihomoGroupsDataRequest = null
}

function getVisibleGroupEntries(
  proxies: IMihomoProxies,
  runtimeGroups: MihomoRuntimeGroup[] | undefined,
  mode: OutboundMode
): { group: IMihomoGroup; testUrl?: string }[] {
  const groups: { group: IMihomoGroup; testUrl?: string }[] = []

  runtimeGroups?.forEach(({ name, url }) => {
    const group = proxies.proxies[name]
    if (group && 'all' in group && !group.hidden) {
      groups.push({ group, testUrl: url })
    }
  })

  if (!groups.find(({ group }) => group.name === 'GLOBAL')) {
    const global = proxies.proxies['GLOBAL']
    if (global && 'all' in global && !global.hidden) {
      groups.push({ group: global })
    }
  }

  if (mode === 'global') {
    const globalIndex = groups.findIndex(({ group }) => group.name === 'GLOBAL')
    if (globalIndex > 0) {
      groups.unshift(groups.splice(globalIndex, 1)[0])
    }
  }

  return groups
}

async function loadVisibleMihomoGroupsData(): Promise<VisibleMihomoGroupsData> {
  const { mode = 'rule' } = await getControledMihomoConfig()
  if (mode === 'direct') return { entries: [], proxies: null }

  const proxies = await mihomoProxies()
  const runtime = await getRuntimeConfig()
  return { entries: getVisibleGroupEntries(proxies, runtime?.['proxy-groups'], mode), proxies }
}

async function loadVisibleMihomoGroupsDataDeduped(): Promise<VisibleMihomoGroupsData> {
  if (visibleMihomoGroupsDataRequest) return visibleMihomoGroupsDataRequest

  const version = visibleMihomoGroupsDataCacheVersion
  const request = loadVisibleMihomoGroupsData().then((data) => {
    if (version !== visibleMihomoGroupsDataCacheVersion) {
      return loadVisibleMihomoGroupsDataDeduped()
    }
    return data
  })
  visibleMihomoGroupsDataRequest = request

  try {
    return await request
  } finally {
    if (visibleMihomoGroupsDataRequest === request) {
      visibleMihomoGroupsDataRequest = null
    }
  }
}

async function getVisibleMihomoGroupsData(force = false): Promise<VisibleMihomoGroupsData> {
  if (force) {
    invalidateVisibleMihomoGroupsDataCache()
  }

  return await loadVisibleMihomoGroupsDataDeduped()
}

function toGroupSummary({
  group,
  testUrl
}: {
  group: IMihomoGroup
  testUrl?: string
}): IMihomoMixedGroupSummary {
  const { all, ...summary } = group
  return {
    ...summary,
    testUrl,
    allCount: all?.length ?? 0
  }
}

function toMixedGroup(
  entry: { group: IMihomoGroup; testUrl?: string },
  proxies: IMihomoProxies
): IMihomoMixedGroup {
  const all = (entry.group.all || []).map((name) => proxies.proxies[name]).filter(Boolean)
  return { ...entry.group, testUrl: entry.testUrl, all }
}

export const mihomoGroupSummaries = async (): Promise<IMihomoMixedGroupSummary[]> => {
  const { entries } = await getVisibleMihomoGroupsData()
  return entries.map(toGroupSummary)
}

export const mihomoGroupsSnapshot = async (
  groupNames: string[] = [],
  force = false
): Promise<IMihomoGroupsSnapshot> => {
  const { entries, proxies } = await getVisibleMihomoGroupsData(force)
  const names = new Set(groupNames)
  const details: Record<string, IMihomoMixedGroup> = {}

  if (proxies && names.size > 0) {
    for (const entry of entries) {
      if (names.has(entry.group.name)) {
        details[entry.group.name] = toMixedGroup(entry, proxies)
      }
    }
  }

  return {
    summaries: entries.map(toGroupSummary),
    details
  }
}

export const mihomoGroupDetail = async (
  groupName: string,
  force = false
): Promise<IMihomoMixedGroup> => {
  const { entries, proxies } = await getVisibleMihomoGroupsData(force)
  const entry = entries.find(({ group }) => group.name === groupName)

  if (!entry || !proxies) {
    throw new Error(`Proxy group not found: ${groupName}`)
  }

  return toMixedGroup(entry, proxies)
}

export const mihomoProxyProviders = async (): Promise<IMihomoProxyProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/proxies')
}

export const mihomoChangeProxy = async (group: string, proxy: string): Promise<IMihomoProxy> => {
  const instance = await getAxios()
  return await instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy })
}

export const mihomoProxyDelay = async (proxy: string, url?: string): Promise<IMihomoDelay> => {
  const appConfig = await getAppConfig()
  const { delayTestUrl, delayTestTimeout } = appConfig
  const instance = await getAxios()
  return await instance.get(`/proxies/${encodeURIComponent(proxy)}/delay`, {
    params: {
      url: delayTestUrl || url || 'https://www.gstatic.com/generate_204',
      timeout: delayTestTimeout || 5000
    }
  })
}

export const mihomoGroupDelay = async (group: string, url?: string): Promise<IMihomoGroupDelay> => {
  const appConfig = await getAppConfig()
  const { delayTestUrl, delayTestTimeout } = appConfig
  const instance = await getAxios()
  return await instance.get(`/group/${encodeURIComponent(group)}/delay`, {
    params: {
      url: delayTestUrl || url || 'https://www.gstatic.com/generate_204',
      timeout: delayTestTimeout || 5000
    }
  })
}

export const mihomoUpgrade = async (): Promise<void> => {
  const instance = await getAxios()
  await instance.post('/upgrade', undefined, { timeout: 90000 })

  const { tun } = await getControledMihomoConfig()
  if (process.platform === 'linux' && (tun?.enable ?? true)) {
    const hasPrivilege = await ensureTunCorePrivilege({ prompt: true })
    if (!hasPrivilege) {
      throw new Error(i18next.t('tun.permissions.reauthorizeCancelled'))
    }
  }
}

export const mihomoHotReloadConfig = async (): Promise<void> => {
  invalidateVisibleMihomoGroupsDataCache()
  mihomoApiLogger.info('mihomoHotReloadConfig called')
  const current = await generateProfile()
  const { diffWorkDir = false } = await getAppConfig()
  const configPath = diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work')
  mihomoApiLogger.info(`hot reload config path: ${configPath}`)
  const instance = await getAxios()
  await instance.put('/configs?force=true', { path: configPath })
  mihomoApiLogger.info('hot reload config completed')
}

export const startMihomoTraffic = async (): Promise<void> => {
  trafficRetry = MAX_RETRY
  await mihomoTraffic()
}

export const stopMihomoTraffic = (): void => {
  trafficRetry = 0

  if (mihomoTrafficWs) {
    mihomoTrafficWs.removeAllListeners()
    if (mihomoTrafficWs.readyState === WebSocket.OPEN) {
      mihomoTrafficWs.close()
    }
    mihomoTrafficWs = null
  }
}

const mihomoTraffic = async (): Promise<void> => {
  const connection = await getMihomoApiConnection()
  const wsUrl = connection.getWsUrl('/traffic')

  mihomoApiLogger.info(`Creating traffic WebSocket with URL: ${wsUrl}`)
  mihomoTrafficWs = new WebSocket(wsUrl, connection.wsOptions)

  mihomoTrafficWs.onmessage = async (e): Promise<void> => {
    const data = e.data as string
    const json = JSON.parse(data) as IMihomoTrafficInfo
    trafficRetry = MAX_RETRY
    try {
      mainWindow?.webContents.send('mihomoTraffic', json)
      if (process.platform !== 'linux') {
        tray?.setToolTip(
          '↑' +
            `${calcTraffic(json.up)}/s`.padStart(9) +
            '\n↓' +
            `${calcTraffic(json.down)}/s`.padStart(9)
        )
      }
    } catch {
      // ignore
    }
  }

  mihomoTrafficWs.onclose = (): void => {
    if (trafficRetry) {
      trafficRetry--
      setTimeout(mihomoTraffic, 1000)
    }
  }

  mihomoTrafficWs.onerror = (error): void => {
    mihomoApiLogger.error('Traffic WebSocket error', error)
    if (mihomoTrafficWs) {
      mihomoTrafficWs.close()
      mihomoTrafficWs = null
    }
  }
}

export const startMihomoMemory = async (): Promise<void> => {
  memoryRetry = MAX_RETRY
  await mihomoMemory()
}

export const stopMihomoMemory = (): void => {
  memoryRetry = 0

  if (mihomoMemoryWs) {
    mihomoMemoryWs.removeAllListeners()
    if (mihomoMemoryWs.readyState === WebSocket.OPEN) {
      mihomoMemoryWs.close()
    }
    mihomoMemoryWs = null
  }
}

const mihomoMemory = async (): Promise<void> => {
  const connection = await getMihomoApiConnection()
  const wsUrl = connection.getWsUrl('/memory')
  mihomoMemoryWs = new WebSocket(wsUrl, connection.wsOptions)

  mihomoMemoryWs.onmessage = (e): void => {
    const data = e.data as string
    memoryRetry = MAX_RETRY
    try {
      mainWindow?.webContents.send('mihomoMemory', JSON.parse(data) as IMihomoMemoryInfo)
    } catch {
      // ignore
    }
  }

  mihomoMemoryWs.onclose = (): void => {
    if (memoryRetry) {
      memoryRetry--
      setTimeout(mihomoMemory, 1000)
    }
  }

  mihomoMemoryWs.onerror = (): void => {
    if (mihomoMemoryWs) {
      mihomoMemoryWs.close()
      mihomoMemoryWs = null
    }
  }
}

export const startMihomoLogs = async (): Promise<void> => {
  if (isWebSocketActive(mihomoLogsWs)) return
  logsRetry = MAX_RETRY
  logsStartToken++
  await mihomoLogs()
}

export const restartMihomoLogs = async (): Promise<void> => {
  if (!logsSubscribed && !isWebSocketActive(mihomoLogsWs)) return
  stopMihomoLogs()
  if (logsSubscribed) {
    await startMihomoLogs()
  }
}

export const subscribeMihomoLogs = async (): Promise<void> => {
  logsSubscribed = true
  await startMihomoLogs()
}

export const unsubscribeMihomoLogs = async (): Promise<void> => {
  logsSubscribed = false
  stopMihomoLogs()
}

export const stopMihomoLogs = (): void => {
  logsRetry = 0
  logsStartToken++

  if (mihomoLogsWs) {
    safelyDisposeWebSocket(mihomoLogsWs)
    mihomoLogsWs = null
  }
}

const mihomoLogs = async (): Promise<void> => {
  const startToken = logsStartToken
  const { 'log-level': logLevel = 'warning' } = await getControledMihomoConfig()
  if (startToken !== logsStartToken || !logsSubscribed) return

  const connection = await getMihomoApiConnection()
  const wsUrl = connection.getWsUrl(`/logs?level=${logLevel}`)
  if (mihomoLogsWs && !isWebSocketActive(mihomoLogsWs)) {
    safelyDisposeWebSocket(mihomoLogsWs)
    mihomoLogsWs = null
  }
  const ws = new WebSocket(wsUrl, connection.wsOptions)

  if (startToken !== logsStartToken || !logsSubscribed) {
    safelyDisposeWebSocket(ws)
    return
  }

  mihomoLogsWs = ws
  let retryScheduled = false

  const scheduleRetry = (): void => {
    if (retryScheduled || !logsRetry || !logsSubscribed || startToken !== logsStartToken) return

    retryScheduled = true
    logsRetry--
    setTimeout(() => {
      if (!mihomoLogsWs && logsSubscribed && startToken === logsStartToken) {
        void mihomoLogs()
      }
    }, 1000)
  }

  ws.onmessage = (e): void => {
    if (mihomoLogsWs !== ws || startToken !== logsStartToken || !logsSubscribed) return

    const data = e.data as string
    logsRetry = MAX_RETRY
    try {
      mainWindow?.webContents.send('mihomoLogs', JSON.parse(data) as IMihomoLogInfo)
    } catch {
      // ignore
    }
  }

  ws.onclose = (): void => {
    if (mihomoLogsWs === ws) {
      mihomoLogsWs = null
    }
    scheduleRetry()
  }

  ws.onerror = (): void => {
    if (mihomoLogsWs === ws) {
      mihomoLogsWs = null
    }
    scheduleRetry()
  }
}

export const startMihomoConnections = async (): Promise<void> => {
  if (isWebSocketActive(mihomoConnectionsWs)) return
  connectionsRetry = MAX_RETRY
  connectionsStartToken++
  await mihomoConnections()
}

export const subscribeMihomoConnections = async (): Promise<void> => {
  connectionsSubscribed = true
  await startMihomoConnections()
}

export const unsubscribeMihomoConnections = async (): Promise<void> => {
  connectionsSubscribed = false
  stopMihomoConnections()
}

export const startSubscribedMihomoStreams = async (): Promise<void> => {
  if (logsSubscribed) {
    await startMihomoLogs()
  }
  if (connectionsSubscribed) {
    await startMihomoConnections()
  }
}

export const stopMihomoConnections = (): void => {
  connectionsRetry = 0
  connectionsStartToken++

  if (mihomoConnectionsWs) {
    safelyDisposeWebSocket(mihomoConnectionsWs)
    mihomoConnectionsWs = null
  }
}

const mihomoConnections = async (): Promise<void> => {
  const startToken = connectionsStartToken
  const connection = await getMihomoApiConnection()
  const wsUrl = connection.getWsUrl('/connections')
  if (mihomoConnectionsWs && !isWebSocketActive(mihomoConnectionsWs)) {
    safelyDisposeWebSocket(mihomoConnectionsWs)
    mihomoConnectionsWs = null
  }
  const ws = new WebSocket(wsUrl, connection.wsOptions)

  if (startToken !== connectionsStartToken || !connectionsSubscribed) {
    safelyDisposeWebSocket(ws)
    return
  }

  mihomoConnectionsWs = ws
  let retryScheduled = false

  const scheduleRetry = (): void => {
    if (
      retryScheduled ||
      !connectionsRetry ||
      !connectionsSubscribed ||
      startToken !== connectionsStartToken
    ) {
      return
    }

    retryScheduled = true
    connectionsRetry--
    setTimeout(() => {
      if (!mihomoConnectionsWs && connectionsSubscribed && startToken === connectionsStartToken) {
        void mihomoConnections()
      }
    }, 1000)
  }

  ws.onmessage = (e): void => {
    if (
      mihomoConnectionsWs !== ws ||
      startToken !== connectionsStartToken ||
      !connectionsSubscribed
    ) {
      return
    }

    const data = e.data as string
    connectionsRetry = MAX_RETRY
    try {
      mainWindow?.webContents.send('mihomoConnections', JSON.parse(data) as IMihomoConnectionsInfo)
    } catch {
      // ignore
    }
  }

  ws.onclose = (): void => {
    if (mihomoConnectionsWs === ws) {
      mihomoConnectionsWs = null
    }
    scheduleRetry()
  }

  ws.onerror = (): void => {
    if (mihomoConnectionsWs === ws) {
      mihomoConnectionsWs = null
    }
    scheduleRetry()
  }
}

export async function SysProxyStatus(): Promise<boolean> {
  const appConfig = await getAppConfig()
  return appConfig.sysProxy.enable
}

export const TunStatus = async (): Promise<boolean> => {
  const config = await getControledMihomoConfig()
  return config?.tun?.enable === true
}
