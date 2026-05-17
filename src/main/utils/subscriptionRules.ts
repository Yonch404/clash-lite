import net from 'net'

const pendingDirectHosts = new Set<string>()

export function getSubscriptionHostname(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/u, '')
    if (!hostname || net.isIP(hostname)) return undefined
    return hostname
  } catch {
    return undefined
  }
}

export function rememberPendingSubscriptionDirectHost(url: string): boolean {
  const hostname = getSubscriptionHostname(url)
  if (!hostname || pendingDirectHosts.has(hostname)) return false
  pendingDirectHosts.add(hostname)
  return true
}

export function getPendingSubscriptionDirectHosts(): string[] {
  return Array.from(pendingDirectHosts)
}
