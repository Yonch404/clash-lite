import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import WebSocket from 'ws'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { mainWindow } from '../window'
import { tray } from '../resolve/tray'
import { calcTraffic } from '../utils/calc'
import { createLogger } from '../utils/logger'
import { mihomoWorkConfigPath } from '../utils/dirs'
import { generateProfile, getRuntimeConfig } from './factory'
import { getMihomoIpcPath } from './manager'
import { getWindowsControllerEndpoint } from './windowsElevated'

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

export const mihomoGroups = async (): Promise<IMihomoMixedGroup[]> => {
  const { mode = 'rule' } = await getControledMihomoConfig()
  if (mode === 'direct') return []
  const proxies = await mihomoProxies()
  const runtime = await getRuntimeConfig()
  const groups: IMihomoMixedGroup[] = []
  runtime?.['proxy-groups']?.forEach((group: { name: string; url?: string }) => {
    const { name, url } = group
    if (proxies.proxies[name] && 'all' in proxies.proxies[name] && !proxies.proxies[name].hidden) {
      const newGroup = proxies.proxies[name]
      newGroup.testUrl = url
      const newAll = (newGroup.all || []).map((name) => proxies.proxies[name])
      groups.push({ ...newGroup, all: newAll })
    }
  })
  if (!groups.find((group) => group.name === 'GLOBAL')) {
    const newGlobal = proxies.proxies['GLOBAL'] as IMihomoGroup
    if (!newGlobal.hidden) {
      const newAll = (newGlobal.all || []).map((name) => proxies.proxies[name])
      groups.push({ ...newGlobal, all: newAll })
    }
  }
  if (mode === 'global') {
    const global = groups.findIndex((group) => group.name === 'GLOBAL')
    groups.unshift(groups.splice(global, 1)[0])
  }
  return groups
}

export const mihomoProxyProviders = async (): Promise<IMihomoProxyProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/proxies')
}

export const mihomoChangeProxy = async (group: string, proxy: string): Promise<IMihomoProxy> => {
  const instance = await getAxios()
  return await instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy })
}

export const mihomoUnfixedProxy = async (group: string): Promise<IMihomoProxy> => {
  const instance = await getAxios()
  return await instance.delete(`/proxies/${encodeURIComponent(group)}`)
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
  return await instance.post('/upgrade', undefined, { timeout: 90000 })
}

export const mihomoHotReloadConfig = async (): Promise<void> => {
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
