function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function hasNonEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  )
}

export function hasUsableMihomoProfile(
  profile: Partial<IMihomoConfig> | null | undefined
): boolean {
  if (!profile || typeof profile !== 'object') return false

  const proxies = (profile as { proxies?: unknown }).proxies
  const proxyProviders = (profile as { 'proxy-providers'?: unknown })['proxy-providers']

  return (
    hasNonEmptyArray(proxies) ||
    hasNonEmptyArray(proxyProviders) ||
    hasNonEmptyObject(proxyProviders)
  )
}
