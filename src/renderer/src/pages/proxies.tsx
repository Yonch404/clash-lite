import { Avatar, Button, Card, CardBody, Chip } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoGroupDetail,
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
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso'
import type { Components, ContextProp, ScrollerProps } from 'react-virtuoso'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import { IoIosArrowBack } from 'react-icons/io'
import { useGroups } from '@renderer/hooks/use-groups'
import CollapseInput from '@renderer/components/base/collapse-input'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useTranslation } from 'react-i18next'

const GROUP_EXPAND_STATE_KEY = 'proxy_group_expand_state'
const EMPTY_GROUPS: IMihomoMixedGroupSummary[] = []
const PROXY_GROUP_ROW_HEIGHT = 64
const PROXY_ITEM_ROW_HEIGHT = 80
const EMPTY_PROXY_ITEM_ROW_HEIGHT = 1
const DETAIL_PREFETCH_COUNT = 2
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
  searchValue: string
  proxyDisplayMode: 'simple' | 'full'
  searchPlaceholder: string
  locateTitle: string
  delayTestTitle: string
  onToggle: (groupName: string) => void
  onWarmUp: (groupName: string) => void
  onSearchChange: (groupName: string, value: string) => void
  onLocate: (groupName: string) => void
  onGroupDelay: (groupName: string) => void
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

const virtuosoComponents: Components<unknown, ProxiesVirtuosoContext> = {
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
    detail.now === summary.now &&
    detail.type === summary.type &&
    detail.testUrl === summary.testUrl &&
    detail.all.length === summary.allCount
  )
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
    searchValue,
    proxyDisplayMode,
    searchPlaceholder,
    locateTitle,
    delayTestTitle,
    onToggle,
    onWarmUp,
    onSearchChange,
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
              <CollapseInput
                title={searchPlaceholder}
                value={searchValue}
                onValueChange={(value) => onSearchChange(group.name, value)}
              />
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

// 自定义 hook 用于管理展开状态
const useProxyState = (
  groups: IMihomoMixedGroupSummary[]
): {
  virtuosoRef: React.RefObject<GroupedVirtuosoHandle | null>
  isOpen: BooleanMap
  setIsOpen: React.Dispatch<React.SetStateAction<BooleanMap>>
} => {
  const virtuosoRef = useRef<GroupedVirtuosoHandle | null>(null)
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
  const { groups, mutate } = useGroups()
  const proxyGroups = groups ?? EMPTY_GROUPS
  const groupsReady = groups !== undefined
  const groupCount = proxyGroups.length
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
  const [searchValue, setSearchValue] = useState<StringMap>({})
  const searchValueRef = useRef(searchValue)
  const [iconSources, setIconSources] = useState<StringMap>({})
  const [groupDetails, setGroupDetails] = useState<Record<string, IMihomoMixedGroup | undefined>>(
    {}
  )
  const groupDetailsRef = useRef(groupDetails)
  const groupDetailRequestsRef = useRef(new Map<string, Promise<IMihomoMixedGroup>>())
  const groupDetailRequestVersionsRef = useRef(new Map<string, number>())
  const groupDetailRequestVersionRef = useRef(0)
  const groupDetailGenerationRef = useRef(0)

  useEffect(() => {
    groupDetailsRef.current = groupDetails
  }, [groupDetails])

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  useEffect(() => {
    searchValueRef.current = searchValue
  }, [searchValue])

  useEffect(() => {
    const groupSummaries = new Map(proxyGroups.map((group) => [group.name, group]))
    setGroupDetails((prev) => {
      let changed = false
      const next: Record<string, IMihomoMixedGroup | undefined> = {}

      for (const [groupName, detail] of Object.entries(prev)) {
        const summary = groupSummaries.get(groupName)
        if (summary && detail && isGroupDetailFresh(detail, summary)) {
          next[groupName] = detail
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
      if (cachedDetail && !force) return cachedDetail

      const pendingRequest = groupDetailRequestsRef.current.get(groupName)
      if (pendingRequest && !force) return pendingRequest

      const request = mihomoGroupDetail(groupName, force)
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
          startTransition(() => {
            setGroupDetails((prev) => {
              if (
                generation !== groupDetailGenerationRef.current ||
                groupDetailRequestVersionsRef.current.get(groupName) !== requestVersion
              ) {
                return prev
              }

              return { ...prev, [groupName]: detail }
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
      setGroupDetails({})
    }

    window.electron.ipcRenderer.on('groupsUpdated', handler)
    return (): void => {
      window.electron.ipcRenderer.removeListener('groupsUpdated', handler)
    }
  }, [])

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

  const { groupCounts, allProxies, groupRowOffsets, flatItemKeys, totalProxyRows } = useMemo(() => {
    const groupCounts: number[] = []
    const allProxies: (IMihomoProxy | IMihomoGroup)[][] = []
    const groupRowOffsets: number[] = []
    const flatItemKeys: string[] = []
    let totalProxyRows = 0

    proxyGroups.forEach((group) => {
      groupRowOffsets.push(totalProxyRows)
      flatItemKeys.push(`group:${group.name}`)

      const groupDetail = groupDetails[group.name]
      if (isOpen[group.name] && groupDetail) {
        const filterValue = searchValue[group.name] ?? ''
        const filtered = filterValue
          ? groupDetail.all.filter((proxy) => includesIgnoreCase(proxy.name, filterValue))
          : groupDetail.all
        const count = Math.ceil(filtered.length / cols)
        groupCounts.push(count)
        allProxies.push(filtered)
        for (let rowIndex = 0; rowIndex < count; rowIndex++) {
          flatItemKeys.push(`proxy-row:${group.name}:${rowIndex}`)
        }
        totalProxyRows += count
      } else {
        groupCounts.push(0)
        allProxies.push([])
      }
    })
    return { groupCounts, allProxies, groupRowOffsets, flatItemKeys, totalProxyRows }
  }, [proxyGroups, groupDetails, isOpen, cols, searchValue])
  const groupIndexByName = useMemo(() => {
    return new Map(proxyGroups.map((group, index) => [group.name, index]))
  }, [proxyGroups])

  useEffect(() => {
    for (const group of proxyGroups) {
      if (isOpen[group.name] && !groupDetails[group.name]) {
        void ensureGroupDetail(group.name)
      }
    }
  }, [ensureGroupDetail, groupDetails, isOpen, proxyGroups])

  const initialItemCount = useMemo(() => {
    if (groupCount === 0) return 0

    // In GroupedVirtuoso, initialItemCount counts item rows, not group headers.
    // Cap it by the actual row count so the first pass does not create
    // transient empty rows that briefly show a scrollbar and then disappear.
    return totalProxyRows > 0 ? Math.min(groupCount, totalProxyRows) : 1
  }, [groupCount, totalProxyRows])
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

  const computeProxyItemKey = useCallback(
    (flatIndex: number): string => {
      return flatItemKeys[flatIndex] || `unknown:${flatIndex}`
    },
    [flatItemKeys]
  )

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      await mihomoCloseAllConnections()
      await ensureGroupDetail(group, true)
      mutate()
    },
    [ensureGroupDetail, mutate]
  )

  const onProxyDelay = useCallback(async (proxy: string, url?: string): Promise<IMihomoDelay> => {
    return await mihomoProxyDelay(proxy, url)
  }, [])

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

  const onSearchGroup = useCallback((groupName: string, value: string): void => {
    setSearchValue((prev) => {
      if ((prev[groupName] ?? '') === value) return prev
      return { ...prev, [groupName]: value }
    })
  }, [])

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
      const filterValue = searchValueRef.current[groupName] ?? ''
      const proxies = filterValue
        ? detail.all.filter((proxy) => includesIgnoreCase(proxy.name, filterValue))
        : detail.all
      const proxyIndex = proxies.findIndex((proxy) => proxy.name === detail.now)
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

      try {
        openGroup(groupName)
        const detail = await ensureGroupDetail(groupName)
        const proxies = detail.all.filter(Boolean)

        // 限制并发数量
        const result: Promise<void>[] = []
        const runningList: Promise<void>[] = []
        for (const proxy of proxies) {
          const promise = Promise.resolve().then(async () => {
            try {
              await mihomoProxyDelay(proxy.name, proxyGroups[index].testUrl)
            } catch {
              // ignore
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
        await ensureGroupDetail(groupName, true)
        mutate()
      } finally {
        setDelaying((prev) => ({ ...prev, [groupName]: false }))
      }
    },
    [delayTestConcurrency, ensureGroupDetail, groupIndexByName, mutate, openGroup, proxyGroups]
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

  const renderGroupContent = useCallback(
    (index: number) => {
      const group = proxyGroups[index]
      if (!group) return <div>Never See This</div>

      return (
        <ProxyGroupHeader
          group={group}
          iconSrc={getProxyGroupIconSrc(group.icon, iconSources)}
          isOpen={Boolean(isOpen[group.name])}
          isDelaying={Boolean(delaying[group.name])}
          currentProxyName={groupDetails[group.name]?.now ?? group.now}
          searchValue={searchValue[group.name] ?? ''}
          proxyDisplayMode={proxyDisplayMode}
          searchPlaceholder={t('proxies.search.placeholder')}
          locateTitle={t('proxies.locate')}
          delayTestTitle={t('proxies.delay.test')}
          onToggle={onToggleGroup}
          onWarmUp={warmUpGroupDetail}
          onSearchChange={onSearchGroup}
          onLocate={onLocateGroupProxy}
          onGroupDelay={onGroupDelay}
        />
      )
    },
    [
      proxyGroups,
      iconSources,
      isOpen,
      delaying,
      groupDetails,
      searchValue,
      proxyDisplayMode,
      t,
      onToggleGroup,
      warmUpGroupDetail,
      onSearchGroup,
      onLocateGroupProxy,
      onGroupDelay
    ]
  )

  const renderItemContent = useCallback(
    (index: number, groupIndex: number) => {
      const innerIndex = index - (groupRowOffsets[groupIndex] ?? 0)
      const group = proxyGroups[groupIndex]
      const proxies = allProxies[groupIndex]
      const rowStart = innerIndex * cols
      const currentProxyName = group ? (groupDetails[group.name]?.now ?? group.now) : ''

      if (!group || !proxies) {
        return <div>Never See This</div>
      }

      if (!proxies[rowStart]) {
        return <div className="h-px" aria-hidden="true" />
      }

      return (
        <div
          style={proxyGridStyle}
          className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} gap-2 pt-2 mx-2`}
        >
          {Array.from({ length: cols }).map((_, i) => {
            const proxy = proxies[rowStart + i]
            if (!proxy) return null
            return (
              <ProxyItem
                key={proxy.name}
                mutateProxies={mutate}
                onProxyDelay={onProxyDelay}
                onSelect={onChangeProxy}
                proxy={proxy}
                group={group}
                proxyDisplayMode={proxyDisplayMode}
                selected={proxy.name === currentProxyName}
                isGroupTesting={Boolean(delaying[group.name])}
              />
            )
          })}
        </div>
      )
    },
    [
      groupRowOffsets,
      allProxies,
      groupDetails,
      proxyCols,
      proxyGridStyle,
      cols,
      proxyGroups,
      proxyDisplayMode,
      delaying,
      mutate,
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
          <GroupedVirtuoso
            ref={virtuosoRef}
            groupCounts={groupCounts}
            defaultItemHeight={hasProxyRows ? PROXY_ITEM_ROW_HEIGHT : EMPTY_PROXY_ITEM_ROW_HEIGHT}
            fixedGroupHeight={PROXY_GROUP_ROW_HEIGHT}
            initialItemCount={initialItemCount}
            increaseViewportBy={{ top: 150, bottom: 150 }}
            overscan={200}
            components={virtuosoComponents}
            context={virtuosoContext}
            itemsRendered={onVirtuosoItemsRendered}
            computeItemKey={computeProxyItemKey}
            groupContent={renderGroupContent}
            itemContent={renderItemContent}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Proxies
