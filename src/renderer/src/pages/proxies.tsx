import { Avatar, Button, Card, CardBody, Chip } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoGroupDetail,
  mihomoGroupsSnapshot,
  mihomoProxyDelay
} from '@renderer/utils/ipc'
import { CgDetailsLess, CgDetailsMore } from 'react-icons/cg'
import { FaLocationCrosshairs } from 'react-icons/fa6'
import { MdDoubleArrow, MdOutlineSpeed } from 'react-icons/md'
import {
  forwardRef,
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties
} from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import type { Components, ContextProp, ScrollerProps } from 'react-virtuoso'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import { IoIosArrowBack } from 'react-icons/io'
import { useGroups } from '@renderer/hooks/use-groups'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useTranslation } from 'react-i18next'

const GROUP_EXPAND_STATE_KEY = 'proxy_group_expand_state'
const EMPTY_GROUPS: IMihomoMixedGroupSummary[] = []
const PROXY_GROUP_ROW_HEIGHT = 64
const PROXY_ITEM_ROW_HEIGHT = 80
const DETAIL_PREFETCH_COUNT = 2
const ACTIVE_REFRESH_INTERVAL = 5000
const proxyGroupIconCache = new Map<string, string>()
const pendingProxyGroupIconRequests = new Set<string>()

interface ProxiesVirtuosoContext {
  hideScrollbar: boolean
}

type BooleanMap = Record<string, boolean>
type StringMap = Record<string, string>

interface ProxyGroupHeaderProps {
  group: IMihomoMixedGroupSummary
  iconSrc?: string
  isOpen: boolean
  isDelaying: boolean
  currentProxyName: string
  proxyDisplayMode: 'simple' | 'full'
  locateTitle: string
  delayTestTitle: string
  onToggle: (groupName: string) => void
  onWarmUp: (groupName: string) => void
  onLocate: (groupName: string) => void
  onGroupDelay: (groupName: string) => void
}

interface ProxyRowProps {
  proxies: (IMihomoProxy | IMihomoGroup)[]
  groupName: string
  groupTestUrl?: string
  selectedProxyName: string
  proxyDisplayMode: 'simple' | 'full'
  proxyCols: IAppConfig['proxyCols']
  proxyGridStyle?: CSSProperties
  delayingProxyKeys: ReadonlySet<string>
  onProxyDelay: (group: string, proxy: string, url?: string) => Promise<IMihomoDelay>
  onSelect: (group: string, proxy: string) => void
}

interface ProxyListLayout {
  rows: ProxyListRow[]
  groupRowOffsets: number[]
  totalProxyRows: number
}

type ProxyListRow =
  | {
      type: 'group'
      key: string
      groupIndex: number
    }
  | {
      type: 'proxy-row'
      key: string
      groupIndex: number
      proxies: (IMihomoProxy | IMihomoGroup)[]
      selectedProxyName: string
    }

const ProxiesScroller = forwardRef<
  HTMLDivElement,
  ScrollerProps & ContextProp<ProxiesVirtuosoContext>
>(({ style, context, ...props }, ref) => {
  const scrollerStyle = {
    ...style,
    overflowY: context.hideScrollbar ? 'hidden' : style?.overflowY
  } as CSSProperties

  return <div {...props} ref={ref} style={scrollerStyle} />
})

ProxiesScroller.displayName = 'ProxiesScroller'

const virtuosoComponents: Components<ProxyListRow, ProxiesVirtuosoContext> = {
  Footer: () => <div className="h-2" />,
  Scroller: ProxiesScroller
}

function readGroupExpandState(): BooleanMap {
  try {
    const savedState = localStorage.getItem(GROUP_EXPAND_STATE_KEY)
    if (!savedState) return {}

    const parsed = JSON.parse(savedState)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([name, open]) => [
          name,
          Boolean(open)
        ])
      )
    }
  } catch (error) {
    console.error('Failed to load group expand state:', error)
  }

  return {}
}

function saveGroupExpandState(groups: IMihomoMixedGroupSummary[], isOpen: BooleanMap): void {
  if (groups.length === 0) return

  try {
    localStorage.setItem(
      GROUP_EXPAND_STATE_KEY,
      JSON.stringify(
        Object.fromEntries(groups.map((group) => [group.name, Boolean(isOpen[group.name])]))
      )
    )
  } catch (error) {
    console.error('Failed to save group expand state:', error)
  }
}

function getProxyGroupIconSrc(
  icon: string | undefined,
  iconSources: StringMap
): string | undefined {
  if (!icon) return undefined
  if (icon.startsWith('<svg')) return `data:image/svg+xml;utf8,${icon}`
  return iconSources[icon] || icon
}

function isGroupDetailFresh(detail: IMihomoMixedGroup, summary: IMihomoMixedGroupSummary): boolean {
  return (
    detail.type === summary.type &&
    detail.testUrl === summary.testUrl &&
    detail.all.length === summary.allCount
  )
}

function canKeepGroupDetail(detail: IMihomoMixedGroup, summary: IMihomoMixedGroupSummary): boolean {
  return (
    detail.name === summary.name &&
    detail.type === summary.type &&
    detail.testUrl === summary.testUrl
  )
}

function lastHistoryValue(history: IMihomoHistory[]): IMihomoHistory | undefined {
  return history[history.length - 1]
}

function hasSameVisibleDelay(previous: IMihomoHistory[], next: IMihomoHistory[]): boolean {
  const previousLatest = lastHistoryValue(previous)
  const nextLatest = lastHistoryValue(next)

  if (!previousLatest || !nextLatest) return previousLatest === nextLatest

  return previousLatest.delay === nextLatest.delay
}

function getProxyFlag(proxy: IMihomoProxy | IMihomoGroup, key: keyof IMihomoProxy): boolean {
  return Boolean((proxy as IMihomoProxy)[key])
}

function hasSameProxyDisplayData(
  previous: IMihomoProxy | IMihomoGroup,
  next: IMihomoProxy | IMihomoGroup
): boolean {
  return (
    previous.name === next.name &&
    previous.type === next.type &&
    previous.alive === next.alive &&
    previous.tfo === next.tfo &&
    previous.udp === next.udp &&
    previous.xudp === next.xudp &&
    getProxyFlag(previous, 'mptcp') === getProxyFlag(next, 'mptcp') &&
    getProxyFlag(previous, 'smux') === getProxyFlag(next, 'smux') &&
    hasSameVisibleDelay(previous.history, next.history)
  )
}

function hasSameProxyArray(
  previous: (IMihomoProxy | IMihomoGroup)[],
  next: (IMihomoProxy | IMihomoGroup)[]
): boolean {
  if (previous.length !== next.length) return false
  return previous.every((proxy, index) => hasSameProxyDisplayData(proxy, next[index]))
}

function mergeProxyList(
  previous: (IMihomoProxy | IMihomoGroup)[],
  next: (IMihomoProxy | IMihomoGroup)[]
): (IMihomoProxy | IMihomoGroup)[] {
  const previousByName = new Map(previous.map((proxy) => [proxy.name, proxy]))
  let changed = previous.length !== next.length

  const merged = next.map((proxy, index) => {
    const previousProxy = previousByName.get(proxy.name)

    if (previousProxy && hasSameProxyDisplayData(previousProxy, proxy)) {
      if (previousProxy !== previous[index]) {
        changed = true
      }
      return previousProxy
    }

    changed = true
    return proxy
  })

  return changed ? merged : previous
}

function hasSameGroupShell(previous: IMihomoMixedGroup, next: IMihomoMixedGroup): boolean {
  return (
    previous.alive === next.alive &&
    previous.expectedStatus === next.expectedStatus &&
    previous.hidden === next.hidden &&
    previous.icon === next.icon &&
    previous.name === next.name &&
    previous.now === next.now &&
    previous.testUrl === next.testUrl &&
    previous.tfo === next.tfo &&
    previous.type === next.type &&
    previous.udp === next.udp &&
    previous.xudp === next.xudp &&
    hasSameVisibleDelay(previous.history, next.history)
  )
}

function mergeGroupDetail(
  previous: IMihomoMixedGroup | undefined,
  next: IMihomoMixedGroup
): IMihomoMixedGroup {
  if (!previous) return next

  const all = mergeProxyList(previous.all, next.all)
  if (all === previous.all && hasSameGroupShell(previous, next)) {
    return previous
  }

  return { ...next, all }
}

function updateGroupProxyDelay(
  detail: IMihomoMixedGroup,
  proxyName: string,
  delay: number
): IMihomoMixedGroup {
  let changed = false
  const historyEntry = { time: new Date().toISOString(), delay }
  const all = detail.all.map((proxy) => {
    if (proxy.name !== proxyName) return proxy

    changed = true
    return {
      ...proxy,
      history: [...proxy.history, historyEntry]
    }
  })

  return changed ? { ...detail, all } : detail
}

function proxyDelayKey(groupName: string, proxyName: string): string {
  return `${groupName}\x1f${proxyName}`
}

function hasSameProxyDelayState(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
  groupName: string,
  proxies: (IMihomoProxy | IMihomoGroup)[]
): boolean {
  if (previous === next) return true
  return proxies.every((proxy) => {
    const key = proxyDelayKey(groupName, proxy.name)
    return previous.has(key) === next.has(key)
  })
}

function applySummaryToGroupDetail(
  detail: IMihomoMixedGroup,
  summary: IMihomoMixedGroupSummary
): IMihomoMixedGroup {
  const { allCount: _allCount, ...summaryFields } = summary
  const next = { ...detail, ...summaryFields, all: detail.all }
  return hasSameGroupShell(detail, next) ? detail : next
}

function areArraysEqual<T>(previous: T[], next: T[]): boolean {
  if (previous.length !== next.length) return false
  return previous.every((value, index) => value === next[index])
}

function useStableProxyListLayout(layout: ProxyListLayout): ProxyListLayout {
  const previousRef = useRef<ProxyListLayout | null>(null)

  return useMemo(() => {
    const previous = previousRef.current

    if (
      previous &&
      previous.totalProxyRows === layout.totalProxyRows &&
      areArraysEqual(
        previous.rows.map((row) => row.key),
        layout.rows.map((row) => row.key)
      ) &&
      areArraysEqual(previous.groupRowOffsets, layout.groupRowOffsets)
    ) {
      const previousRowsByKey = new Map(previous.rows.map((row) => [row.key, row]))
      const rows = layout.rows.map((row) => {
        const previousRow = previousRowsByKey.get(row.key)
        if (!previousRow || previousRow.type !== row.type) return row

        if (row.type === 'group' && previousRow.type === 'group') {
          return previousRow.groupIndex === row.groupIndex ? previousRow : row
        }

        if (row.type === 'proxy-row' && previousRow.type === 'proxy-row') {
          const sameRow =
            previousRow.groupIndex === row.groupIndex &&
            hasSameProxyArray(previousRow.proxies, row.proxies) &&
            previousRow.selectedProxyName === row.selectedProxyName
          return sameRow ? previousRow : row
        }

        return row
      })
      const stableLayout = {
        ...layout,
        rows,
        groupRowOffsets: previous.groupRowOffsets
      }
      previousRef.current = stableLayout
      return stableLayout
    }

    previousRef.current = layout
    return layout
  }, [layout])
}

function scheduleIdleTask(callback: () => void): () => void {
  const requestIdleCallback = window.requestIdleCallback
  const cancelIdleCallback = window.cancelIdleCallback

  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    const handle = requestIdleCallback(callback, { timeout: 1500 })
    return () => cancelIdleCallback(handle)
  }

  const handle = globalThis.setTimeout(callback, 300)
  return () => globalThis.clearTimeout(handle)
}

const ProxyGroupHeader = memo(function ProxyGroupHeader(props: ProxyGroupHeaderProps) {
  const {
    group,
    iconSrc,
    isOpen,
    isDelaying,
    currentProxyName,
    proxyDisplayMode,
    locateTitle,
    delayTestTitle,
    onToggle,
    onWarmUp,
    onLocate,
    onGroupDelay
  } = props

  return (
    <div className="w-full pt-2 px-2">
      <Card
        as="div"
        isPressable
        disableRipple
        fullWidth
        className="proxy-group-pressable-card"
        onFocus={() => onWarmUp(group.name)}
        onPointerEnter={() => onWarmUp(group.name)}
        onPress={() => onToggle(group.name)}
      >
        <CardBody className="w-full">
          <div className="flex justify-between">
            <div className="flex text-ellipsis overflow-hidden whitespace-nowrap">
              {iconSrc ? (
                <Avatar className="bg-transparent mr-2" size="sm" radius="sm" src={iconSrc} />
              ) : null}
              <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                <div title={group.name} className="inline flag-emoji h-8 text-md leading-8">
                  {group.name}
                </div>
                {proxyDisplayMode === 'full' && (
                  <div title={group.type} className="inline ml-2 text-sm text-foreground-500">
                    {group.type}
                  </div>
                )}
                {proxyDisplayMode === 'full' && (
                  <div className="inline flag-emoji ml-2 text-sm text-foreground-500">
                    {currentProxyName}
                  </div>
                )}
              </div>
            </div>
            <div className="flex">
              {proxyDisplayMode === 'full' && (
                <Chip size="sm" className="my-1 mr-2">
                  {group.allCount}
                </Chip>
              )}
              <Button
                title={locateTitle}
                variant="light"
                size="sm"
                isIconOnly
                onPress={() => onLocate(group.name)}
              >
                <FaLocationCrosshairs className="text-lg text-foreground-500" />
              </Button>
              <Button
                title={delayTestTitle}
                variant="light"
                isLoading={isDelaying}
                size="sm"
                isIconOnly
                onPress={() => onGroupDelay(group.name)}
              >
                <MdOutlineSpeed className="text-lg text-foreground-500" />
              </Button>
              <IoIosArrowBack
                className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 ${isOpen ? '-rotate-90' : ''}`}
              />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
})

function getRowSelectedProxyName(
  proxies: (IMihomoProxy | IMihomoGroup)[],
  currentProxyName: string
): string {
  for (const proxy of proxies) {
    if (proxy?.name === currentProxyName) return currentProxyName
  }

  return ''
}

const ProxyRow = memo(
  function ProxyRow(props: ProxyRowProps) {
    const {
      proxies,
      groupName,
      groupTestUrl,
      selectedProxyName,
      proxyDisplayMode,
      proxyCols,
      proxyGridStyle,
      delayingProxyKeys,
      onProxyDelay,
      onSelect
    } = props

    return (
      <div
        style={proxyGridStyle}
        className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} gap-2 pt-2 mx-2`}
      >
        {proxies.map((proxy) => {
          return (
            <ProxyItem
              key={proxy.name}
              onProxyDelay={onProxyDelay}
              onSelect={onSelect}
              proxy={proxy}
              group={{ name: groupName, testUrl: groupTestUrl }}
              proxyDisplayMode={proxyDisplayMode}
              selected={proxy.name === selectedProxyName}
              isDelayTesting={delayingProxyKeys.has(proxyDelayKey(groupName, proxy.name))}
            />
          )
        })}
      </div>
    )
  },
  (prevProps, nextProps) => {
    if (
      prevProps.groupName !== nextProps.groupName ||
      prevProps.groupTestUrl !== nextProps.groupTestUrl ||
      prevProps.proxyDisplayMode !== nextProps.proxyDisplayMode ||
      prevProps.proxyCols !== nextProps.proxyCols ||
      prevProps.proxyGridStyle !== nextProps.proxyGridStyle ||
      prevProps.onProxyDelay !== nextProps.onProxyDelay ||
      prevProps.onSelect !== nextProps.onSelect ||
      prevProps.selectedProxyName !== nextProps.selectedProxyName
    ) {
      return false
    }

    return (
      hasSameProxyArray(prevProps.proxies, nextProps.proxies) &&
      hasSameProxyDelayState(
        prevProps.delayingProxyKeys,
        nextProps.delayingProxyKeys,
        prevProps.groupName,
        prevProps.proxies
      )
    )
  }
)

ProxyRow.displayName = 'ProxyRow'

// 自定义 hook 用于管理展开状态
const useProxyState = (
  groups: IMihomoMixedGroupSummary[]
): {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  isOpen: BooleanMap
  setIsOpen: React.Dispatch<React.SetStateAction<BooleanMap>>
} => {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const groupNamesKey = useMemo(() => groups.map((group) => group.name).join('\n'), [groups])
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  // 初始化展开状态
  const [isOpen, setIsOpen] = useState<BooleanMap>(() => readGroupExpandState())

  // 保存展开状态
  useEffect(() => {
    saveGroupExpandState(groupsRef.current, isOpen)
  }, [groupNamesKey, isOpen])

  return {
    virtuosoRef,
    isOpen,
    setIsOpen
  }
}

const Proxies: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups, mutate, updateGroups } = useGroups()
  const proxyGroups = groups ?? EMPTY_GROUPS
  const groupsReady = groups !== undefined
  const groupNamesKey = useMemo(
    () => proxyGroups.map((group) => group.name).join('\n'),
    [proxyGroups]
  )
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    proxyDisplayMode = 'simple',
    proxyCols = 'auto',
    delayTestConcurrency = 50
  } = appConfig || {}
  const proxyGridStyle = useMemo<CSSProperties | undefined>(() => {
    if (proxyCols === 'auto') return undefined
    return { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
  }, [proxyCols])

  const [cols, setCols] = useState(1)
  const { virtuosoRef, isOpen, setIsOpen } = useProxyState(proxyGroups)
  const isOpenRef = useRef(isOpen)
  const [delaying, setDelaying] = useState<BooleanMap>({})
  const [delayingProxyKeys, setDelayingProxyKeys] = useState<Set<string>>(() => new Set())
  const [iconSources, setIconSources] = useState<StringMap>({})
  const [groupDetails, setGroupDetails] = useState<Record<string, IMihomoMixedGroup | undefined>>(
    {}
  )
  const groupDetailsRef = useRef(groupDetails)
  const proxyGroupsRef = useRef(proxyGroups)
  const groupDetailRequestsRef = useRef(new Map<string, Promise<IMihomoMixedGroup>>())
  const groupDetailRequestVersionsRef = useRef(new Map<string, number>())
  const groupDetailRequestVersionRef = useRef(0)
  const groupDetailGenerationRef = useRef(0)
  const staleGroupDetailsRef = useRef(new Set<string>())
  const activeRefreshRunningRef = useRef(false)
  const pendingProxyDelaysRef = useRef(new Map<string, Map<string, number>>())
  const proxyDelayFlushTimerRef = useRef<number | null>(null)
  const [groupDetailRefreshTick, setGroupDetailRefreshTick] = useState(0)

  useEffect(() => {
    groupDetailsRef.current = groupDetails
  }, [groupDetails])

  useEffect(() => {
    proxyGroupsRef.current = proxyGroups
  }, [proxyGroups])

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const flushPendingProxyDelays = useCallback((): void => {
    if (proxyDelayFlushTimerRef.current !== null) {
      window.clearTimeout(proxyDelayFlushTimerRef.current)
      proxyDelayFlushTimerRef.current = null
    }

    const pendingDelays = pendingProxyDelaysRef.current
    if (pendingDelays.size === 0) return

    pendingProxyDelaysRef.current = new Map()
    setGroupDetails((prev) => {
      let next = prev

      for (const [groupName, proxyDelays] of pendingDelays) {
        const detail = next[groupName]
        if (!detail) continue

        let nextDetail = detail
        for (const [proxyName, delay] of proxyDelays) {
          nextDetail = updateGroupProxyDelay(nextDetail, proxyName, delay)
        }

        if (nextDetail !== detail) {
          if (next === prev) {
            next = { ...prev }
          }
          next[groupName] = nextDetail
        }
      }

      return next
    })
  }, [])

  const queueProxyDelay = useCallback(
    (groupName: string, proxyName: string, delay: number): void => {
      let groupDelays = pendingProxyDelaysRef.current.get(groupName)
      if (!groupDelays) {
        groupDelays = new Map()
        pendingProxyDelaysRef.current.set(groupName, groupDelays)
      }
      groupDelays.set(proxyName, delay)

      if (proxyDelayFlushTimerRef.current !== null) return
      proxyDelayFlushTimerRef.current = window.setTimeout(flushPendingProxyDelays, 50)
    },
    [flushPendingProxyDelays]
  )

  const setProxyDelaying = useCallback(
    (groupName: string, proxyName: string, isDelaying: boolean): void => {
      const key = proxyDelayKey(groupName, proxyName)
      setDelayingProxyKeys((prev) => {
        if (prev.has(key) === isDelaying) return prev

        const next = new Set(prev)
        if (isDelaying) {
          next.add(key)
        } else {
          next.delete(key)
        }
        return next
      })
    },
    []
  )

  const setGroupProxiesDelaying = useCallback(
    (groupName: string, proxyNames: string[], isDelaying: boolean): void => {
      if (proxyNames.length === 0) return

      setDelayingProxyKeys((prev) => {
        let changed = false
        const next = new Set(prev)

        for (const proxyName of proxyNames) {
          const key = proxyDelayKey(groupName, proxyName)
          if (isDelaying) {
            if (!next.has(key)) {
              next.add(key)
              changed = true
            }
          } else if (next.delete(key)) {
            changed = true
          }
        }

        return changed ? next : prev
      })
    },
    []
  )

  useEffect(() => {
    return (): void => {
      if (proxyDelayFlushTimerRef.current !== null) {
        window.clearTimeout(proxyDelayFlushTimerRef.current)
        proxyDelayFlushTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const groupSummaries = new Map(proxyGroups.map((group) => [group.name, group]))
    for (const groupName of Array.from(staleGroupDetailsRef.current)) {
      if (!groupSummaries.has(groupName)) {
        staleGroupDetailsRef.current.delete(groupName)
      }
    }

    setGroupDetails((prev) => {
      let changed = false
      const next: Record<string, IMihomoMixedGroup | undefined> = {}

      for (const [groupName, detail] of Object.entries(prev)) {
        const summary = groupSummaries.get(groupName)
        if (summary && detail && canKeepGroupDetail(detail, summary)) {
          const syncedDetail = applySummaryToGroupDetail(detail, summary)
          next[groupName] = syncedDetail
          if (syncedDetail !== detail) {
            changed = true
          }
        } else {
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [proxyGroups])

  const ensureGroupDetail = useCallback(
    async (groupName: string, force = false): Promise<IMihomoMixedGroup> => {
      const cachedDetail = groupDetailsRef.current[groupName]
      const shouldForce = force || staleGroupDetailsRef.current.has(groupName)
      if (cachedDetail && !shouldForce) return cachedDetail

      const pendingRequest = groupDetailRequestsRef.current.get(groupName)
      if (pendingRequest && !shouldForce) return pendingRequest

      const request = mihomoGroupDetail(groupName, shouldForce)
      groupDetailRequestsRef.current.set(groupName, request)
      const requestVersion = groupDetailRequestVersionRef.current + 1
      groupDetailRequestVersionRef.current = requestVersion
      groupDetailRequestVersionsRef.current.set(groupName, requestVersion)
      const generation = groupDetailGenerationRef.current

      try {
        const detail = await request
        const isLatestRequest =
          groupDetailRequestVersionsRef.current.get(groupName) === requestVersion
        if (isLatestRequest && generation === groupDetailGenerationRef.current) {
          staleGroupDetailsRef.current.delete(groupName)
          startTransition(() => {
            setGroupDetails((prev) => {
              if (
                generation !== groupDetailGenerationRef.current ||
                groupDetailRequestVersionsRef.current.get(groupName) !== requestVersion
              ) {
                return prev
              }

              const previousDetail = prev[groupName]
              const mergedDetail = mergeGroupDetail(previousDetail, detail)

              if (previousDetail === mergedDetail) {
                return prev
              }

              return { ...prev, [groupName]: mergedDetail }
            })
          })
        }
        return detail
      } finally {
        if (groupDetailRequestsRef.current.get(groupName) === request) {
          groupDetailRequestsRef.current.delete(groupName)
        }
      }
    },
    []
  )

  const warmUpGroupDetail = useCallback(
    (groupName: string): void => {
      if (groupDetailsRef.current[groupName] || groupDetailRequestsRef.current.has(groupName)) {
        return
      }

      void ensureGroupDetail(groupName)
    },
    [ensureGroupDetail]
  )

  useEffect(() => {
    const handler = (): void => {
      groupDetailGenerationRef.current++
      groupDetailRequestsRef.current.clear()
      groupDetailRequestVersionsRef.current.clear()
      staleGroupDetailsRef.current = new Set(Object.keys(groupDetailsRef.current))
      setGroupDetailRefreshTick((tick) => tick + 1)
    }

    window.electron.ipcRenderer.on('groupsUpdated', handler)
    return (): void => {
      window.electron.ipcRenderer.removeListener('groupsUpdated', handler)
    }
  }, [])

  const refreshActiveGroups = useCallback(async (): Promise<void> => {
    if (activeRefreshRunningRef.current || mode === 'direct') return

    const currentGroups = proxyGroupsRef.current
    if (currentGroups.length === 0) return

    activeRefreshRunningRef.current = true
    const openGroupNames = currentGroups
      .filter((group) => Boolean(isOpenRef.current[group.name]))
      .map((group) => group.name)
    const generation = groupDetailGenerationRef.current
    const detailRequestVersions = new Map<string, number>()

    for (const groupName of openGroupNames) {
      const requestVersion = groupDetailRequestVersionRef.current + 1
      groupDetailRequestVersionRef.current = requestVersion
      groupDetailRequestVersionsRef.current.set(groupName, requestVersion)
      groupDetailRequestsRef.current.delete(groupName)
      detailRequestVersions.set(groupName, requestVersion)
    }

    try {
      const snapshot = await mihomoGroupsSnapshot(openGroupNames, true)
      if (generation !== groupDetailGenerationRef.current) return

      updateGroups(snapshot.summaries)

      const detailEntries = Object.entries(snapshot.details)
      const detailNames = new Set(detailEntries.map(([groupName]) => groupName))
      for (const groupName of Object.keys(groupDetailsRef.current)) {
        if (!detailNames.has(groupName)) {
          staleGroupDetailsRef.current.add(groupName)
        }
      }

      if (detailEntries.length === 0) return

      startTransition(() => {
        setGroupDetails((prev) => {
          if (generation !== groupDetailGenerationRef.current) return prev

          let changed = false
          const next = { ...prev }

          for (const [groupName, detail] of detailEntries) {
            if (
              groupDetailRequestVersionsRef.current.get(groupName) !==
              detailRequestVersions.get(groupName)
            ) {
              continue
            }

            staleGroupDetailsRef.current.delete(groupName)
            const previousDetail = prev[groupName]
            const mergedDetail = mergeGroupDetail(previousDetail, detail)
            if (previousDetail !== mergedDetail) {
              next[groupName] = mergedDetail
              changed = true
            }
          }

          return changed ? next : prev
        })
      })
    } catch (error) {
      console.error('Failed to refresh proxy groups:', error)
    } finally {
      activeRefreshRunningRef.current = false
    }
  }, [mode, updateGroups])

  useEffect(() => {
    if (mode === 'direct') return

    const refreshIfVisible = (): void => {
      if (document.visibilityState === 'hidden') return
      void refreshActiveGroups()
    }

    refreshIfVisible()
    const interval = window.setInterval(refreshIfVisible, ACTIVE_REFRESH_INTERVAL)
    document.addEventListener('visibilitychange', refreshIfVisible)

    return (): void => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [mode, refreshActiveGroups])

  useEffect(() => {
    if (!groupsReady || proxyGroups.length === 0) return

    return scheduleIdleTask(() => {
      proxyGroups.slice(0, DETAIL_PREFETCH_COUNT).forEach((group) => {
        warmUpGroupDetail(group.name)
      })
    })
  }, [groupNamesKey, groupsReady, proxyGroups, warmUpGroupDetail])

  useEffect(() => {
    const nextIconSources: StringMap = {}
    const iconsToFetch: string[] = []
    const seenIcons = new Set<string>()

    for (const group of proxyGroups) {
      const icon = group.icon
      if (!icon || !icon.startsWith('http') || seenIcons.has(icon)) continue

      seenIcons.add(icon)
      const cachedIcon = proxyGroupIconCache.get(icon)
      if (cachedIcon) {
        nextIconSources[icon] = cachedIcon
        continue
      }

      const storedIcon = localStorage.getItem(icon)
      if (storedIcon) {
        proxyGroupIconCache.set(icon, storedIcon)
        nextIconSources[icon] = storedIcon
        continue
      }

      if (!pendingProxyGroupIconRequests.has(icon)) {
        iconsToFetch.push(icon)
        pendingProxyGroupIconRequests.add(icon)
      }
    }

    if (Object.keys(nextIconSources).length > 0) {
      setIconSources((prev) => {
        let changed = false
        const next = { ...prev }
        for (const [icon, src] of Object.entries(nextIconSources)) {
          if (next[icon] !== src) {
            next[icon] = src
            changed = true
          }
        }
        return changed ? next : prev
      })
    }

    for (const icon of iconsToFetch) {
      getImageDataURL(icon)
        .then((dataURL) => {
          proxyGroupIconCache.set(icon, dataURL)
          localStorage.setItem(icon, dataURL)
          setIconSources((prev) => {
            if (prev[icon] === dataURL) return prev
            return { ...prev, [icon]: dataURL }
          })
        })
        .catch(() => {})
        .finally(() => {
          pendingProxyGroupIconRequests.delete(icon)
        })
    }
  }, [proxyGroups])

  const proxyListLayout = useMemo<ProxyListLayout>(() => {
    const rows: ProxyListRow[] = []
    const groupRowOffsets: number[] = []
    let totalProxyRows = 0

    proxyGroups.forEach((group, groupIndex) => {
      rows.push({
        type: 'group',
        key: `group:${group.name}`,
        groupIndex
      })
      groupRowOffsets.push(rows.length)

      const groupDetail = groupDetails[group.name]
      if (isOpen[group.name] && groupDetail) {
        const count = Math.ceil(groupDetail.all.length / cols)
        for (let rowIndex = 0; rowIndex < count; rowIndex++) {
          const rowStart = rowIndex * cols
          const currentProxyName = groupDetail.now ?? group.now
          const rowProxies = groupDetail.all.slice(rowStart, rowStart + cols)
          rows.push({
            type: 'proxy-row',
            key: `proxy-row:${group.name}:${rowIndex}`,
            groupIndex,
            proxies: rowProxies,
            selectedProxyName: getRowSelectedProxyName(rowProxies, currentProxyName)
          })
        }
        totalProxyRows += count
      }
    })
    return { rows, groupRowOffsets, totalProxyRows }
  }, [proxyGroups, groupDetails, isOpen, cols])
  const { rows, groupRowOffsets, totalProxyRows } = useStableProxyListLayout(proxyListLayout)
  const groupIndexByName = useMemo(() => {
    return new Map(proxyGroups.map((group, index) => [group.name, index]))
  }, [proxyGroups])

  useEffect(() => {
    for (const group of proxyGroups) {
      if (!isOpen[group.name]) continue

      const detail = groupDetails[group.name]
      const needsRefresh =
        !detail ||
        staleGroupDetailsRef.current.has(group.name) ||
        !isGroupDetailFresh(detail, group)

      if (needsRefresh) {
        void ensureGroupDetail(group.name, Boolean(detail)).catch((error) => {
          console.error('Failed to refresh proxy group detail:', error)
        })
      }
    }
  }, [ensureGroupDetail, groupDetailRefreshTick, groupDetails, isOpen, proxyGroups])

  const hasProxyRows = totalProxyRows > 0
  const [virtuosoMeasured, setVirtuosoMeasured] = useState(false)
  const hideVirtuosoScrollbar = !hasProxyRows && !virtuosoMeasured
  const virtuosoContext = useMemo(
    () => ({ hideScrollbar: hideVirtuosoScrollbar }),
    [hideVirtuosoScrollbar]
  )

  useEffect(() => {
    if (!hasProxyRows) {
      setVirtuosoMeasured(false)
    }
  }, [groupNamesKey, hasProxyRows])

  const onVirtuosoItemsRendered = useCallback(() => {
    if (hasProxyRows || virtuosoMeasured) return

    requestAnimationFrame(() => {
      setVirtuosoMeasured(true)
    })
  }, [hasProxyRows, virtuosoMeasured])

  const computeProxyItemKey = useCallback((_index: number, row: ProxyListRow): string => {
    return row.key
  }, [])

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      setGroupDetails((prev) => {
        const detail = prev[group]
        if (!detail || detail.now === proxy) return prev

        return {
          ...prev,
          [group]: {
            ...detail,
            now: proxy
          }
        }
      })

      await mihomoCloseAllConnections()
      void ensureGroupDetail(group, true).catch((error) => {
        console.error('Failed to refresh proxy group detail:', error)
      })
    },
    [ensureGroupDetail]
  )

  const onProxyDelay = useCallback(
    async (group: string, proxy: string, url?: string): Promise<IMihomoDelay> => {
      const result = await mihomoProxyDelay(proxy, url)
      if (typeof result.delay === 'number') {
        setGroupDetails((prev) => {
          const detail = prev[group]
          if (!detail) return prev

          const nextDetail = updateGroupProxyDelay(detail, proxy, result.delay as number)
          if (nextDetail === detail) return prev

          return { ...prev, [group]: nextDetail }
        })
      }
      await ensureGroupDetail(group, true)
      return result
    },
    [ensureGroupDetail]
  )

  const onToggleGroup = useCallback(
    (groupName: string): void => {
      const nextOpen = !isOpenRef.current[groupName]
      if (nextOpen) {
        void ensureGroupDetail(groupName)
      }
      setIsOpen((prev) => ({ ...prev, [groupName]: nextOpen }))
    },
    [ensureGroupDetail, setIsOpen]
  )

  const openGroup = useCallback(
    (groupName: string): void => {
      void ensureGroupDetail(groupName)
      setIsOpen((prev) => {
        if (prev[groupName]) return prev
        return { ...prev, [groupName]: true }
      })
    },
    [ensureGroupDetail, setIsOpen]
  )

  const onLocateGroupProxy = useCallback(
    async (groupName: string): Promise<void> => {
      const index = groupIndexByName.get(groupName)
      if (index === undefined) return

      openGroup(groupName)
      const detail = await ensureGroupDetail(groupName)
      const proxyIndex = detail.all.findIndex((proxy) => proxy.name === detail.now)
      if (proxyIndex < 0) return

      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: groupRowOffsets[index] + Math.floor(proxyIndex / cols),
          align: 'start'
        })
      })
    },
    [cols, ensureGroupDetail, groupIndexByName, groupRowOffsets, openGroup, virtuosoRef]
  )

  const onGroupDelay = useCallback(
    async (groupName: string): Promise<void> => {
      const index = groupIndexByName.get(groupName)
      if (index === undefined) return

      setDelaying((prev) => ({ ...prev, [groupName]: true }))
      let testingProxyNames: string[] = []

      try {
        openGroup(groupName)
        const detail = await ensureGroupDetail(groupName)
        const proxies = detail.all.filter(Boolean)
        testingProxyNames = proxies.map((proxy) => proxy.name)
        setGroupProxiesDelaying(groupName, testingProxyNames, true)

        // 限制并发数量
        const result: Promise<void>[] = []
        const runningList: Promise<void>[] = []
        for (const proxy of proxies) {
          const promise = Promise.resolve().then(async () => {
            try {
              const delay = await mihomoProxyDelay(proxy.name, proxyGroups[index].testUrl)
              if (typeof delay.delay === 'number') {
                queueProxyDelay(groupName, proxy.name, delay.delay)
              }
            } catch {
              // ignore
            } finally {
              setProxyDelaying(groupName, proxy.name, false)
            }
          })
          result.push(promise)
          const running = promise.then(() => {
            runningList.splice(runningList.indexOf(running), 1)
          })
          runningList.push(running)
          if (runningList.length >= (delayTestConcurrency || 50)) {
            await Promise.race(runningList)
          }
        }
        await Promise.all(result)
        flushPendingProxyDelays()
        await ensureGroupDetail(groupName, true)
        mutate()
      } finally {
        setGroupProxiesDelaying(groupName, testingProxyNames, false)
        setDelaying((prev) => ({ ...prev, [groupName]: false }))
      }
    },
    [
      delayTestConcurrency,
      ensureGroupDetail,
      flushPendingProxyDelays,
      groupIndexByName,
      mutate,
      openGroup,
      proxyGroups,
      queueProxyDelay,
      setGroupProxiesDelaying,
      setProxyDelaying
    ]
  )

  const calcCols = useCallback((): number => {
    if (proxyCols !== 'auto') {
      return parseInt(proxyCols)
    }
    if (window.matchMedia('(min-width: 1536px)').matches) return 5
    if (window.matchMedia('(min-width: 1280px)').matches) return 4
    if (window.matchMedia('(min-width: 1024px)').matches) return 3
    return 2
  }, [proxyCols])

  useEffect(() => {
    const handleResize = (): void => {
      setCols(calcCols())
    }

    handleResize() // 初始化
    window.addEventListener('resize', handleResize)

    return (): void => {
      window.removeEventListener('resize', handleResize)
    }
  }, [calcCols])

  const renderRowContent = useCallback(
    (_index: number, row: ProxyListRow) => {
      const group = proxyGroups[row.groupIndex]
      if (!group) return <div className="h-px" aria-hidden="true" />

      if (row.type === 'group') {
        return (
          <ProxyGroupHeader
            group={group}
            iconSrc={getProxyGroupIconSrc(group.icon, iconSources)}
            isOpen={Boolean(isOpen[group.name])}
            isDelaying={Boolean(delaying[group.name])}
            currentProxyName={groupDetails[group.name]?.now ?? group.now}
            proxyDisplayMode={proxyDisplayMode}
            locateTitle={t('proxies.locate')}
            delayTestTitle={t('proxies.delay.test')}
            onToggle={onToggleGroup}
            onWarmUp={warmUpGroupDetail}
            onLocate={onLocateGroupProxy}
            onGroupDelay={onGroupDelay}
          />
        )
      }

      if (row.proxies.length === 0) {
        return <div className="h-px" aria-hidden="true" />
      }

      return (
        <ProxyRow
          proxies={row.proxies}
          groupName={group.name}
          groupTestUrl={group.testUrl}
          selectedProxyName={row.selectedProxyName}
          proxyDisplayMode={proxyDisplayMode}
          proxyCols={proxyCols}
          proxyGridStyle={proxyGridStyle}
          delayingProxyKeys={delayingProxyKeys}
          onProxyDelay={onProxyDelay}
          onSelect={onChangeProxy}
        />
      )
    },
    [
      proxyGroups,
      iconSources,
      isOpen,
      delaying,
      delayingProxyKeys,
      groupDetails,
      proxyDisplayMode,
      t,
      onToggleGroup,
      warmUpGroupDetail,
      onLocateGroupProxy,
      onGroupDelay,
      proxyCols,
      proxyGridStyle,
      onProxyDelay,
      onChangeProxy
    ]
  )

  return (
    <BasePage
      title={t('proxies.title')}
      header={
        <>
          <Button
            size="sm"
            isIconOnly
            variant="light"
            className="app-nodrag"
            onPress={() => {
              patchAppConfig({
                proxyDisplayMode: proxyDisplayMode === 'simple' ? 'full' : 'simple'
              })
            }}
          >
            {proxyDisplayMode === 'full' ? (
              <CgDetailsMore className="text-lg" title={t('proxies.mode.full')} />
            ) : (
              <CgDetailsLess className="text-lg" title={t('proxies.mode.simple')} />
            )}
          </Button>
        </>
      }
    >
      {mode === 'direct' ? (
        <div className="h-full w-full flex justify-center items-center">
          <div className="flex flex-col items-center">
            <MdDoubleArrow className="text-foreground-500 text-[100px]" />
            <h2 className="text-foreground-500 text-[20px]">{t('proxies.mode.direct')}</h2>
          </div>
        </div>
      ) : !groupsReady ? (
        <div className="h-[calc(100vh-50px)]" />
      ) : (
        <div className="h-[calc(100vh-50px)]">
          <Virtuoso
            ref={virtuosoRef}
            data={rows}
            defaultItemHeight={hasProxyRows ? PROXY_ITEM_ROW_HEIGHT : PROXY_GROUP_ROW_HEIGHT}
            increaseViewportBy={{ top: 150, bottom: 150 }}
            overscan={200}
            components={virtuosoComponents}
            context={virtuosoContext}
            itemsRendered={onVirtuosoItemsRendered}
            computeItemKey={computeProxyItemKey}
            itemContent={renderRowContent}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Proxies
