import * as http from 'http'
import * as https from 'https'
import * as net from 'net'
import * as tls from 'tls'
import * as zlib from 'zlib'
import { performance } from 'perf_hooks'
import { promisify } from 'util'
import { URL } from 'url'
import { getChromeCaBundle } from './certificate'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
  headers?: Record<string, string>
  body?: string | Buffer
  proxy?:
    | {
        protocol: 'http' | 'https' | 'socks5'
        host: string
        port: number
      }
    | false
  timeout?: number
  responseType?: 'text' | 'json' | 'arraybuffer'
  followRedirect?: boolean
  maxRedirects?: number
  onProgress?: (loaded: number, total: number) => void
}

export interface Response<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
}

interface RawResponse {
  data: Buffer
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
}

interface LatencyResponse {
  status: number
  headers: Record<string, string>
  latency: number
  url: string
}

type HttpProxyOptions = {
  protocol: 'http'
  host: string
  port: number
}

const gunzip = promisify(zlib.gunzip)
const inflate = promisify(zlib.inflate)
const brotliDecompress = promisify(zlib.brotliDecompress)
const activeRequests = new Set<http.ClientRequest>()
const activeSockets = new Set<net.Socket>()
const latencyHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 })
const latencyHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4 })
const latencyWarmupAt = new Map<string, number>()
const LATENCY_WARMUP_TTL_MS = 2 * 60 * 1000

export interface LatencyMeasureOptions {
  timeout?: number
  samples?: number
  warmup?: boolean
  proxy?: RequestOptions['proxy']
  followRedirect?: boolean
  maxRedirects?: number
}

function trackRequest(req: http.ClientRequest): void {
  if (activeRequests.has(req)) return

  activeRequests.add(req)
  req.once('close', () => {
    activeRequests.delete(req)
  })
  req.once('socket', (socket) => {
    trackSocket(socket)
  })
}

function trackSocket(socket: net.Socket): void {
  if (activeSockets.has(socket)) return

  activeSockets.add(socket)

  const onSocketError = (): void => {
    // Active requests still reject through their own handlers; this keeps late shutdown resets contained.
  }
  const onSocketClose = (): void => {
    activeSockets.delete(socket)
    socket.off('error', onSocketError)
  }

  socket.on('error', onSocketError)
  socket.once('close', onSocketClose)
}

export function abortPendingRequests(): void {
  for (const req of Array.from(activeRequests)) {
    req.destroy()
  }
  for (const socket of Array.from(activeSockets)) {
    socket.destroy()
  }

  activeRequests.clear()
  activeSockets.clear()
  latencyHttpAgent.destroy()
  latencyHttpsAgent.destroy()
}

/**
 * Make HTTP requests through Node's TLS stack with Clash Lite's bundled Chrome CA bundle.
 * HTTPS requests pass `ca` explicitly, so Node does not fall back to system roots.
 */
export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<Response<T>> {
  return requestWithRedirects<T>(url, options, 0)
}

export async function measureNetworkLatency(
  url: string,
  options: LatencyMeasureOptions = {}
): Promise<number | null> {
  const {
    timeout = 5000,
    samples = 2,
    warmup = true,
    followRedirect = true,
    maxRedirects = 3,
    proxy
  } = options
  const normalizedSamples = Math.max(1, Math.min(Math.floor(samples), 5))

  try {
    if (warmup && shouldWarmupLatencyTarget(url)) {
      try {
        await latencyRequestWithRedirects(url, { timeout, proxy, followRedirect, maxRedirects }, 0)
        latencyWarmupAt.set(url, Date.now())
      } catch {
        // The measured samples below decide the visible result.
      }
    }

    const results: number[] = []
    for (let i = 0; i < normalizedSamples; i += 1) {
      const result = await latencyRequestWithRedirects(
        url,
        { timeout, proxy, followRedirect, maxRedirects },
        0
      )
      results.push(result.latency)
    }

    if (results.length === 0) return null
    latencyWarmupAt.set(url, Date.now())
    results.sort((a, b) => a - b)
    return results[Math.floor((results.length - 1) / 2)]
  } catch {
    return null
  }
}

function shouldWarmupLatencyTarget(url: string): boolean {
  const warmupAt = latencyWarmupAt.get(url)
  return !warmupAt || Date.now() - warmupAt > LATENCY_WARMUP_TTL_MS
}

async function latencyRequestWithRedirects(
  url: string,
  options: Required<Pick<LatencyMeasureOptions, 'timeout' | 'followRedirect' | 'maxRedirects'>> &
    Pick<LatencyMeasureOptions, 'proxy'>,
  redirectCount: number
): Promise<LatencyResponse> {
  const result = await performLatencyRequest(url, options)
  const location = result.headers.location

  if (options.followRedirect && isRedirect(result.status) && location) {
    if (redirectCount >= options.maxRedirects) {
      throw new Error(`Too many redirects (>${options.maxRedirects})`)
    }

    return latencyRequestWithRedirects(
      new URL(location, url).toString(),
      options,
      redirectCount + 1
    )
  }

  return result
}

async function requestWithRedirects<T>(
  url: string,
  options: RequestOptions,
  redirectCount: number
): Promise<Response<T>> {
  const {
    responseType = 'text',
    followRedirect = true,
    maxRedirects = 20,
    method = 'GET'
  } = options
  const raw = await performRequest(url, { ...options, method })
  const location = raw.headers.location

  if (followRedirect && isRedirect(raw.status) && location) {
    if (redirectCount >= maxRedirects) {
      throw new Error(`Too many redirects (>${maxRedirects})`)
    }

    const redirectUrl = new URL(location, url).toString()
    const redirectOptions = getRedirectOptions(options, raw.status)
    return requestWithRedirects<T>(redirectUrl, redirectOptions, redirectCount + 1)
  }

  return {
    data: parseResponseData<T>(raw.data, responseType),
    status: raw.status,
    statusText: raw.statusText,
    headers: raw.headers,
    url: raw.url
  }
}

function getRedirectOptions(options: RequestOptions, status: number): RequestOptions {
  const method = options.method ?? 'GET'
  if ((status === 301 || status === 302 || status === 303) && method !== 'GET') {
    const headers = removeEntityHeaders(options.headers ?? {})
    return { ...options, method: 'GET', body: undefined, headers }
  }
  return options
}

function removeEntityHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => {
      const normalized = key.toLowerCase()
      return normalized !== 'content-length' && normalized !== 'content-type'
    })
  )
}

async function performRequest(url: string, options: RequiredMethodOptions): Promise<RawResponse> {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`Unsupported request protocol: ${target.protocol}`)
  }

  const proxy = normalizeProxy(options.proxy)
  if (target.protocol === 'https:') {
    const ca = await getChromeCaBundle()
    if (proxy) {
      return performHttpsViaHttpProxy(target, options, proxy, ca)
    }
    return performDirectHttps(target, options, ca)
  }

  if (proxy) {
    return performHttpViaHttpProxy(target, options, proxy)
  }
  return performDirectHttp(target, options)
}

type RequiredMethodOptions = RequestOptions & { method: NonNullable<RequestOptions['method']> }
type RequiredLatencyOptions = Required<Pick<LatencyMeasureOptions, 'timeout'>> &
  Pick<LatencyMeasureOptions, 'proxy'>

function normalizeProxy(proxy: RequestOptions['proxy']): HttpProxyOptions | undefined {
  if (!proxy) return undefined
  if (proxy.protocol !== 'http') {
    throw new Error(`Unsupported proxy protocol for custom certificate store: ${proxy.protocol}`)
  }
  return { protocol: 'http', host: proxy.host, port: proxy.port }
}

async function performLatencyRequest(
  url: string,
  options: RequiredLatencyOptions
): Promise<LatencyResponse> {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`Unsupported request protocol: ${target.protocol}`)
  }

  const proxy = normalizeProxy(options.proxy)
  if (target.protocol === 'https:') {
    const ca = await getChromeCaBundle()
    if (proxy) {
      return performLatencyHttpsViaHttpProxy(target, options, proxy, ca)
    }
    return performDirectHttpsLatency(target, options, ca)
  }

  if (proxy) {
    return performLatencyHttpViaHttpProxy(target, options, proxy)
  }
  return performDirectHttpLatency(target, options)
}

function performDirectHttp(target: URL, options: RequiredMethodOptions): Promise<RawResponse> {
  const requestOptions: http.RequestOptions = {
    protocol: 'http:',
    hostname: target.hostname,
    port: getPort(target),
    method: options.method,
    path: getRequestPath(target),
    headers: buildRequestHeaders(target, options.headers)
  }

  return sendRequest(target.toString(), options, (onResponse) =>
    http.request(requestOptions, onResponse)
  )
}

function performDirectHttpLatency(
  target: URL,
  options: RequiredLatencyOptions
): Promise<LatencyResponse> {
  const requestOptions: http.RequestOptions = {
    protocol: 'http:',
    hostname: target.hostname,
    port: getPort(target),
    method: 'HEAD',
    path: getRequestPath(target),
    headers: buildRequestHeaders(target),
    agent: latencyHttpAgent
  }

  return sendLatencyRequest(target.toString(), options, (onResponse) =>
    http.request(requestOptions, onResponse)
  )
}

function performDirectHttps(
  target: URL,
  options: RequiredMethodOptions,
  ca: Buffer
): Promise<RawResponse> {
  const requestOptions: https.RequestOptions = {
    protocol: 'https:',
    hostname: target.hostname,
    port: getPort(target),
    method: options.method,
    path: getRequestPath(target),
    headers: buildRequestHeaders(target, options.headers),
    ca,
    rejectUnauthorized: true,
    servername: getServername(target)
  }

  return sendRequest(target.toString(), options, (onResponse) =>
    https.request(requestOptions, onResponse)
  )
}

function performDirectHttpsLatency(
  target: URL,
  options: RequiredLatencyOptions,
  ca: Buffer
): Promise<LatencyResponse> {
  const requestOptions: https.RequestOptions = {
    protocol: 'https:',
    hostname: target.hostname,
    port: getPort(target),
    method: 'HEAD',
    path: getRequestPath(target),
    headers: buildRequestHeaders(target),
    ca,
    rejectUnauthorized: true,
    servername: getServername(target),
    agent: latencyHttpsAgent
  }

  return sendLatencyRequest(target.toString(), options, (onResponse) =>
    https.request(requestOptions, onResponse)
  )
}

function performHttpViaHttpProxy(
  target: URL,
  options: RequiredMethodOptions,
  proxy: HttpProxyOptions
): Promise<RawResponse> {
  const requestOptions: http.RequestOptions = {
    protocol: 'http:',
    hostname: proxy.host,
    port: proxy.port,
    method: options.method,
    path: target.toString(),
    headers: buildRequestHeaders(target, options.headers)
  }

  return sendRequest(target.toString(), options, (onResponse) =>
    http.request(requestOptions, onResponse)
  )
}

function performLatencyHttpViaHttpProxy(
  target: URL,
  options: RequiredLatencyOptions,
  proxy: HttpProxyOptions
): Promise<LatencyResponse> {
  const requestOptions: http.RequestOptions = {
    protocol: 'http:',
    hostname: proxy.host,
    port: proxy.port,
    method: 'HEAD',
    path: target.toString(),
    headers: buildRequestHeaders(target),
    agent: latencyHttpAgent
  }

  return sendLatencyRequest(target.toString(), options, (onResponse) =>
    http.request(requestOptions, onResponse)
  )
}

async function performHttpsViaHttpProxy(
  target: URL,
  options: RequiredMethodOptions,
  proxy: HttpProxyOptions,
  ca: Buffer
): Promise<RawResponse> {
  const socket = await createProxyTlsSocket(target, proxy, ca, options.timeout ?? 30000)
  const requestOptions: https.RequestOptions = {
    protocol: 'https:',
    hostname: target.hostname,
    port: getPort(target),
    method: options.method,
    path: getRequestPath(target),
    headers: buildRequestHeaders(target, options.headers),
    agent: false,
    createConnection: () => socket
  }

  try {
    return await sendRequest(target.toString(), options, (onResponse) =>
      https.request(requestOptions, onResponse)
    )
  } catch (error) {
    socket.destroy()
    throw error
  }
}

async function performLatencyHttpsViaHttpProxy(
  target: URL,
  options: RequiredLatencyOptions,
  proxy: HttpProxyOptions,
  ca: Buffer
): Promise<LatencyResponse> {
  const socket = await createProxyTlsSocket(target, proxy, ca, options.timeout)
  const requestOptions: https.RequestOptions = {
    protocol: 'https:',
    hostname: target.hostname,
    port: getPort(target),
    method: 'HEAD',
    path: getRequestPath(target),
    headers: buildRequestHeaders(target),
    agent: false,
    createConnection: () => socket
  }

  try {
    return await sendLatencyRequest(target.toString(), options, (onResponse) =>
      https.request(requestOptions, onResponse)
    )
  } catch (error) {
    socket.destroy()
    throw error
  }
}

function createProxyTlsSocket(
  target: URL,
  proxy: HttpProxyOptions,
  ca: Buffer,
  timeout: number
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    let settled = false
    let rawSocket: net.Socket | undefined
    let tlsSocket: tls.TLSSocket | undefined
    let timeoutId: NodeJS.Timeout | undefined

    const connectHost = formatHostPort(target)
    const connectReq = http.request({
      hostname: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: connectHost,
      headers: { Host: connectHost }
    })
    trackRequest(connectReq)

    const cleanup = (): void => {
      if (timeoutId) clearTimeout(timeoutId)
      activeRequests.delete(connectReq)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      connectReq.destroy()
      tlsSocket?.destroy()
      rawSocket?.destroy()
      reject(error)
    }
    const succeed = (socket: tls.TLSSocket): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(socket)
    }

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        fail(new Error(`Request timeout after ${timeout}ms`))
      }, timeout)
    }

    connectReq.once('connect', (res, socket, head) => {
      rawSocket = socket
      if (res.statusCode !== 200) {
        fail(new Error(`Proxy CONNECT failed with status ${res.statusCode ?? 0}`))
        return
      }

      if (head.length > 0) {
        socket.unshift(head)
      }

      tlsSocket = tls.connect({
        socket,
        servername: getServername(target),
        ca,
        rejectUnauthorized: true
      })
      trackSocket(tlsSocket)

      const onSecureConnect = (): void => {
        tlsSocket?.off('error', onTlsError)
        if (!tlsSocket) {
          fail(new Error('TLS socket was not created'))
          return
        }
        succeed(tlsSocket)
      }
      const onTlsError = (error: Error): void => fail(error)

      tlsSocket.once('secureConnect', onSecureConnect)
      tlsSocket.once('error', onTlsError)
    })
    connectReq.once('error', (error) => fail(error))
    connectReq.end()
  })
}

function sendRequest(
  url: string,
  options: RequiredMethodOptions,
  createRequest: (onResponse: (res: http.IncomingMessage) => void) => http.ClientRequest
): Promise<RawResponse> {
  const timeout = options.timeout ?? 30000
  return new Promise((resolve, reject) => {
    let settled = false
    let req: http.ClientRequest | undefined
    let timeoutId: NodeJS.Timeout | undefined

    const cleanup = (): void => {
      if (timeoutId) clearTimeout(timeoutId)
      if (req) activeRequests.delete(req)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      req?.destroy()
      reject(error)
    }
    const succeed = (response: RawResponse): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }

    try {
      req = createRequest((res) => {
        collectResponse(res, options.onProgress)
          .then((data) => {
            succeed({
              data,
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              headers: normalizeResponseHeaders(res.headers),
              url
            })
          })
          .catch((error: unknown) => {
            fail(error instanceof Error ? error : new Error(String(error)))
          })
      })
      trackRequest(req)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        fail(new Error(`Request timeout after ${timeout}ms`))
      }, timeout)
    }

    req.once('error', (error) => fail(error))

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function sendLatencyRequest(
  url: string,
  options: RequiredLatencyOptions,
  createRequest: (onResponse: (res: http.IncomingMessage) => void) => http.ClientRequest
): Promise<LatencyResponse> {
  const startedAt = performance.now()
  const timeout = options.timeout

  return new Promise((resolve, reject) => {
    let settled = false
    let req: http.ClientRequest | undefined
    let timeoutId: NodeJS.Timeout | undefined

    const cleanup = (): void => {
      if (timeoutId) clearTimeout(timeoutId)
      if (req) activeRequests.delete(req)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      req?.destroy()
      reject(error)
    }
    const succeed = (res: http.IncomingMessage): void => {
      if (settled) return
      settled = true
      cleanup()
      res.resume()
      resolve({
        status: res.statusCode ?? 0,
        headers: normalizeResponseHeaders(res.headers),
        latency: Math.max(0, Math.round(performance.now() - startedAt)),
        url
      })
    }

    try {
      req = createRequest(succeed)
      trackRequest(req)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        fail(new Error(`Request timeout after ${timeout}ms`))
      }, timeout)
    }

    req.once('error', (error) => fail(error))
    req.end()
  })
}

function collectResponse(
  res: http.IncomingMessage,
  onProgress?: (loaded: number, total: number) => void
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const totalSize = Number.parseInt(String(res.headers['content-length'] ?? '0'), 10)
    let loadedSize = 0

    res.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      loadedSize += chunk.length
      if (onProgress && totalSize > 0) {
        onProgress(loadedSize, totalSize)
      }
    })
    res.once('end', () => {
      const headers = normalizeResponseHeaders(res.headers)
      decompressResponse(Buffer.concat(chunks), headers).then(resolve).catch(reject)
    })
    res.once('error', reject)
  })
}

async function decompressResponse(
  buffer: Buffer,
  headers: Record<string, string>
): Promise<Buffer> {
  const encoding = headers['content-encoding']?.toLowerCase().trim()
  if (!encoding || encoding === 'identity') {
    return buffer
  }

  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return gunzip(buffer)
    case 'deflate':
      return inflate(buffer)
    case 'br':
      return brotliDecompress(buffer)
    default:
      return buffer
  }
}

function parseResponseData<T>(buffer: Buffer, responseType: RequestOptions['responseType']): T {
  switch (responseType) {
    case 'json':
      return JSON.parse(buffer.toString('utf-8')) as T
    case 'arraybuffer':
      return buffer as T
    case 'text':
    default:
      return buffer.toString('utf-8') as T
  }
}

function normalizeResponseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key.toLowerCase()] = value
    } else if (Array.isArray(value)) {
      result[key.toLowerCase()] = value.join(', ')
    }
  }
  return result
}

function buildRequestHeaders(
  target: URL,
  headers: Record<string, string> = {}
): Record<string, string> {
  if (hasHeader(headers, 'host')) {
    return headers
  }
  return { ...headers, Host: formatHostHeader(target) }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized)
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function getRequestPath(target: URL): string {
  return `${target.pathname || '/'}${target.search}`
}

function getPort(target: URL): number {
  if (target.port) {
    return Number.parseInt(target.port, 10)
  }
  return target.protocol === 'https:' ? 443 : 80
}

function getServername(target: URL): string | undefined {
  return net.isIP(target.hostname) ? undefined : target.hostname
}

function formatHostHeader(target: URL): string {
  const defaultPort = target.protocol === 'https:' ? 443 : 80
  const hostname = formatHostname(target.hostname)
  const port = getPort(target)
  return port === defaultPort ? hostname : `${hostname}:${port}`
}

function formatHostPort(target: URL): string {
  return `${formatHostname(target.hostname)}:${getPort(target)}`
}

function formatHostname(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
}

/**
 * Convenience method for GET requests
 */
export const get = <T = unknown>(
  url: string,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => request<T>(url, { ...options, method: 'GET' })

/**
 * Convenience method for POST requests
 */
export const post = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'POST', body, headers })
}

/**
 * Convenience method for PUT requests
 */
export const put = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'PUT', body, headers })
}

/**
 * Convenience method for DELETE requests
 */
export const del = <T = unknown>(
  url: string,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => request<T>(url, { ...options, method: 'DELETE' })

/**
 * Convenience method for PATCH requests
 */
export const patch = <T = unknown>(
  url: string,
  data: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<Response<T>> => {
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  const headers = options?.headers || {}
  if (typeof data !== 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  return request<T>(url, { ...options, method: 'PATCH', body, headers })
}
