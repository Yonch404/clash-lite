import net from 'net'

export type SubscriptionDirectTarget =
  | { type: 'domain'; value: string }
  | { type: 'ip'; value: string; family: 4 | 6 }

interface PendingSubscriptionDirectTarget {
  target: SubscriptionDirectTarget
  count: number
}

const pendingDirectTargets = new Map<string, PendingSubscriptionDirectTarget>()

function normalizeUrlHostname(url: string): string | undefined {
  const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/u, '')
  if (!hostname) return undefined

  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }

  return hostname
}

export function subscriptionDirectTargetKey(target: SubscriptionDirectTarget): string {
  return `${target.type}:${target.value}`
}

export function getSubscriptionDirectTarget(url: string): SubscriptionDirectTarget | undefined {
  try {
    const hostname = normalizeUrlHostname(url)
    if (!hostname) return undefined

    const ipFamily = net.isIP(hostname)
    if (ipFamily === 4 || ipFamily === 6) {
      return { type: 'ip', value: hostname, family: ipFamily }
    }

    return { type: 'domain', value: hostname }
  } catch {
    return undefined
  }
}

export function getSubscriptionHostname(url: string): string | undefined {
  const target = getSubscriptionDirectTarget(url)
  return target?.type === 'domain' ? target.value : undefined
}

export function rememberPendingSubscriptionDirectTarget(
  url: string
): { target: SubscriptionDirectTarget; isNew: boolean } | undefined {
  const target = getSubscriptionDirectTarget(url)
  if (!target) return undefined

  const key = subscriptionDirectTargetKey(target)
  const existing = pendingDirectTargets.get(key)
  if (existing) {
    existing.count += 1
    return { target: existing.target, isNew: false }
  }

  pendingDirectTargets.set(key, { target, count: 1 })
  return { target, isNew: true }
}

export function forgetPendingSubscriptionDirectTarget(url: string): boolean {
  const target = getSubscriptionDirectTarget(url)
  if (!target) return false

  const key = subscriptionDirectTargetKey(target)
  const existing = pendingDirectTargets.get(key)
  if (!existing) return false

  if (existing.count > 1) {
    existing.count -= 1
    return false
  }

  pendingDirectTargets.delete(key)
  return true
}

export function getPendingSubscriptionDirectTargets(): SubscriptionDirectTarget[] {
  return Array.from(pendingDirectTargets.values(), ({ target }) => target)
}
