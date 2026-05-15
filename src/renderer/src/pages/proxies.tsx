import { Avatar, Button, Card, CardBody, Chip } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoProxyDelay
} from '@renderer/utils/ipc'
import { CgDetailsLess, CgDetailsMore } from 'react-icons/cg'
import { FaLocationCrosshairs } from 'react-icons/fa6'
import { MdDoubleArrow, MdOutlineSpeed } from 'react-icons/md'
import {
  forwardRef,
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
const EMPTY_GROUPS: IMihomoMixedGroup[] = []
const PROXY_GROUP_ROW_HEIGHT = 64
const PROXY_ITEM_ROW_HEIGHT = 80
const EMPTY_PROXY_ITEM_ROW_HEIGHT = 1

interface ProxiesVirtuosoContext {
  hideScrollbar: boolean
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

function readGroupExpandState(groups: IMihomoMixedGroup[]): boolean[] {
  if (groups.length === 0) return []

  try {
    const savedState = localStorage.getItem(GROUP_EXPAND_STATE_KEY)
    if (!savedState) return Array(groups.length).fill(false)

    const parsed = JSON.parse(savedState)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const savedMap = parsed as Record<string, boolean>
      return groups.map((group) => Boolean(savedMap[group.name]))
    }
  } catch (error) {
    console.error('Failed to load group expand state:', error)
  }

  return Array(groups.length).fill(false)
}

function saveGroupExpandState(groups: IMihomoMixedGroup[], isOpen: boolean[]): void {
  if (groups.length === 0 || groups.length !== isOpen.length) return

  try {
    localStorage.setItem(
      GROUP_EXPAND_STATE_KEY,
      JSON.stringify(
        Object.fromEntries(groups.map((group, index) => [group.name, Boolean(isOpen[index])]))
      )
    )
  } catch (error) {
    console.error('Failed to save group expand state:', error)
  }
}

// 自定义 hook 用于管理展开状态
const useProxyState = (
  groups: IMihomoMixedGroup[]
): {
  virtuosoRef: React.RefObject<GroupedVirtuosoHandle | null>
  isOpen: boolean[]
  setIsOpen: React.Dispatch<React.SetStateAction<boolean[]>>
} => {
  const virtuosoRef = useRef<GroupedVirtuosoHandle | null>(null)
  const groupNamesKey = useMemo(() => groups.map((group) => group.name).join('\n'), [groups])
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  // 初始化展开状态
  const [isOpen, setIsOpen] = useState<boolean[]>(() => readGroupExpandState(groups))

  // 同步展开状态与当前代理组名称，避免不同订阅的展开状态按下标错套
  useEffect(() => {
    setIsOpen(readGroupExpandState(groupsRef.current))
  }, [groupNamesKey])

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

  const [cols, setCols] = useState(1)
  const { virtuosoRef, isOpen, setIsOpen } = useProxyState(proxyGroups)
  const [delaying, setDelaying] = useState(Array(groupCount).fill(false))
  const [searchValue, setSearchValue] = useState(Array(groupCount).fill(''))

  // searchValue 初始化
  useEffect(() => {
    setSearchValue(Array(groupCount).fill(''))
    setDelaying(Array(groupCount).fill(false))
  }, [groupCount, groupNamesKey])

  // 代理列表保持内核返回的原始顺序
  const sortProxies = useCallback((proxies: (IMihomoProxy | IMihomoGroup)[]) => {
    return proxies
  }, [])

  const { groupCounts, allProxies } = useMemo(() => {
    const groupCounts: number[] = []
    const allProxies: (IMihomoProxy | IMihomoGroup)[][] = []

    proxyGroups.forEach((group, index) => {
      if (isOpen[index]) {
        const filtered = group.all.filter((proxy) => {
          if (!proxy) return false
          if (!includesIgnoreCase(proxy.name, searchValue[index])) {
            return false
          }
          return true
        })
        const sorted = sortProxies(filtered)
        const count = Math.ceil(sorted.length / cols)
        groupCounts.push(count)
        allProxies.push(sorted)
      } else {
        groupCounts.push(0)
        allProxies.push([])
      }
    })
    return { groupCounts, allProxies }
  }, [proxyGroups, isOpen, cols, searchValue, sortProxies])

  const initialItemCount = useMemo(() => {
    if (groupCount === 0) return 0

    // In GroupedVirtuoso, initialItemCount counts item rows, not group headers.
    // Cap it by the actual row count so the first pass does not create
    // transient empty rows that briefly show a scrollbar and then disappear.
    const totalProxyRows = groupCounts.reduce((total, count) => total + count, 0)
    return totalProxyRows > 0 ? Math.min(groupCount, totalProxyRows) : 1
  }, [groupCount, groupCounts])
  const hasProxyRows = useMemo(() => groupCounts.some((count) => count > 0), [groupCounts])
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
      let offset = 0

      for (let groupIndex = 0; groupIndex < proxyGroups.length; groupIndex++) {
        const group = proxyGroups[groupIndex]
        const rowCount = groupCounts[groupIndex] ?? 0

        if (flatIndex === offset) {
          return `group:${group.name}`
        }

        const rowIndex = flatIndex - offset - 1
        if (rowIndex >= 0 && rowIndex < rowCount) {
          return `proxy-row:${group.name}:${rowIndex}`
        }

        offset += rowCount + 1
      }

      return `unknown:${flatIndex}`
    },
    [groupCounts, proxyGroups]
  )

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      await mihomoCloseAllConnections()
      mutate()
    },
    [mutate]
  )

  const onProxyDelay = useCallback(async (proxy: string, url?: string): Promise<IMihomoDelay> => {
    return await mihomoProxyDelay(proxy, url)
  }, [])

  const onGroupDelay = useCallback(
    async (index: number): Promise<void> => {
      if (allProxies[index].length === 0) {
        setIsOpen((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
      }
      setDelaying((prev) => {
        const newDelaying = [...prev]
        newDelaying[index] = true
        return newDelaying
      })

      try {
        // 限制并发数量
        const result: Promise<void>[] = []
        const runningList: Promise<void>[] = []
        for (const proxy of allProxies[index]) {
          const promise = Promise.resolve().then(async () => {
            try {
              await mihomoProxyDelay(proxy.name, proxyGroups[index].testUrl)
            } catch {
              // ignore
            } finally {
              mutate()
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
      } finally {
        setDelaying((prev) => {
          const newDelaying = [...prev]
          newDelaying[index] = false
          return newDelaying
        })
      }
    },
    [allProxies, proxyGroups, delayTestConcurrency, mutate, setIsOpen]
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
      if (
        proxyGroups[index]?.icon &&
        proxyGroups[index].icon.startsWith('http') &&
        !localStorage.getItem(proxyGroups[index].icon)
      ) {
        getImageDataURL(proxyGroups[index].icon)
          .then((dataURL) => {
            localStorage.setItem(proxyGroups[index].icon, dataURL)
            mutate()
          })
          .catch(() => {})
      }
      return proxyGroups[index] ? (
        <div className="w-full pt-2 px-2">
          <Card
            as="div"
            isPressable
            disableRipple
            fullWidth
            onPress={() => {
              setIsOpen((prev) => {
                const newOpen = [...prev]
                newOpen[index] = !prev[index]
                return newOpen
              })
            }}
          >
            <CardBody className="w-full">
              <div className="flex justify-between">
                <div className="flex text-ellipsis overflow-hidden whitespace-nowrap">
                  {proxyGroups[index].icon ? (
                    <Avatar
                      className="bg-transparent mr-2"
                      size="sm"
                      radius="sm"
                      src={
                        proxyGroups[index].icon.startsWith('<svg')
                          ? `data:image/svg+xml;utf8,${proxyGroups[index].icon}`
                          : localStorage.getItem(proxyGroups[index].icon) || proxyGroups[index].icon
                      }
                    />
                  ) : null}
                  <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                    <div
                      title={proxyGroups[index].name}
                      className="inline flag-emoji h-8 text-md leading-8"
                    >
                      {proxyGroups[index].name}
                    </div>
                    {proxyDisplayMode === 'full' && (
                      <div
                        title={proxyGroups[index].type}
                        className="inline ml-2 text-sm text-foreground-500"
                      >
                        {proxyGroups[index].type}
                      </div>
                    )}
                    {proxyDisplayMode === 'full' && (
                      <div className="inline flag-emoji ml-2 text-sm text-foreground-500">
                        {proxyGroups[index].now}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex">
                  {proxyDisplayMode === 'full' && (
                    <Chip size="sm" className="my-1 mr-2">
                      {proxyGroups[index].all.length}
                    </Chip>
                  )}
                  <CollapseInput
                    title={t('proxies.search.placeholder')}
                    value={searchValue[index]}
                    onValueChange={(v) => {
                      setSearchValue((prev) => {
                        const newSearchValue = [...prev]
                        newSearchValue[index] = v
                        return newSearchValue
                      })
                    }}
                  />
                  <Button
                    title={t('proxies.locate')}
                    variant="light"
                    size="sm"
                    isIconOnly
                    onPress={() => {
                      if (!isOpen[index]) {
                        setIsOpen((prev) => {
                          const newOpen = [...prev]
                          newOpen[index] = true
                          return newOpen
                        })
                      }
                      let i = 0
                      for (let j = 0; j < index; j++) {
                        i += groupCounts[j]
                      }
                      i += Math.floor(
                        allProxies[index].findIndex(
                          (proxy) => proxy.name === proxyGroups[index].now
                        ) / cols
                      )
                      virtuosoRef.current?.scrollToIndex({
                        index: Math.floor(i),
                        align: 'start'
                      })
                    }}
                  >
                    <FaLocationCrosshairs className="text-lg text-foreground-500" />
                  </Button>
                  <Button
                    title={t('proxies.delay.test')}
                    variant="light"
                    isLoading={delaying[index]}
                    size="sm"
                    isIconOnly
                    onPress={() => {
                      onGroupDelay(index)
                    }}
                  >
                    <MdOutlineSpeed className="text-lg text-foreground-500" />
                  </Button>
                  <IoIosArrowBack
                    className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 ${isOpen[index] ? '-rotate-90' : ''}`}
                  />
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      proxyGroups,
      groupCounts,
      isOpen,
      proxyDisplayMode,
      t,
      searchValue,
      delaying,
      mutate,
      setIsOpen,
      allProxies,
      cols,
      virtuosoRef,
      onGroupDelay
    ]
  )

  const renderItemContent = useCallback(
    (index: number, groupIndex: number) => {
      let innerIndex = index
      groupCounts.slice(0, groupIndex).forEach((count) => {
        innerIndex -= count
      })
      const group = proxyGroups[groupIndex]
      const proxies = allProxies[groupIndex]
      const rowStart = innerIndex * cols
      const hasVisibleProxy = Array.from({ length: cols }).some((_, i) =>
        Boolean(proxies?.[rowStart + i])
      )

      if (!group || !proxies) {
        return <div>Never See This</div>
      }

      if (!hasVisibleProxy) {
        return <div className="h-px" aria-hidden="true" />
      }

      return (
        <div
          style={
            proxyCols !== 'auto'
              ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
              : {}
          }
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
                selected={proxy.name === group.now}
                isGroupTesting={delaying[groupIndex]}
              />
            )
          })}
        </div>
      )
    },
    [
      groupCounts,
      allProxies,
      proxyCols,
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
      ) : !groupsReady ||
        isOpen.length !== groupCount ||
        searchValue.length !== groupCount ||
        delaying.length !== groupCount ? (
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
