import BasePage from '@renderer/components/base/base-page'
import { mihomoCloseAllConnections, mihomoCloseConnection, getAppName } from '@renderer/utils/ipc'
import { Key, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Divider,
  Input,
  Select,
  SelectItem,
  Tab,
  Tabs,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem
} from '@heroui/react'
import { calcTraffic } from '@renderer/utils/calc'
import ConnectionItem from '@renderer/components/connections/connection-item'
import ConnectionTable from '@renderer/components/connections/connection-table'
import { Virtuoso } from 'react-virtuoso'
import dayjs from '@renderer/utils/dayjs'
import ConnectionDetailModal from '@renderer/components/connections/connection-detail-modal'
import { CgClose, CgTrash } from 'react-icons/cg'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { HiSortAscending, HiSortDescending } from 'react-icons/hi'
import { MdViewList, MdTableChart } from 'react-icons/md'
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useTranslation } from 'react-i18next'
import { IoMdPause, IoMdPlay } from 'react-icons/io'

let cachedConnections: IMihomoConnectionDetail[] = []
const MAX_QUEUE_SIZE = 100

const Connections: React.FC = () => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const { appConfig, patchAppConfig } = useAppConfig()
  const appConfigValues: Partial<IAppConfig> = appConfig ?? {}
  const {
    connectionDirection = 'asc',
    connectionOrderBy = 'time',
    connectionViewMode = 'list',
    connectionTableColumns = [
      'status',
      'establishTime',
      'type',
      'host',
      'process',
      'rule',
      'proxyChain',
      'remoteDestination',
      'uploadSpeed',
      'downloadSpeed',
      'upload',
      'download'
    ],
    connectionTableColumnWidths,
    connectionTableSortColumn,
    connectionTableSortDirection,
    displayAppName = true
  } = appConfigValues
  const [connectionsInfo, setConnectionsInfo] = useState<IMihomoConnectionsInfo>()
  const [allConnections, setAllConnections] = useState<IMihomoConnectionDetail[]>(cachedConnections)
  const [activeConnections, setActiveConnections] = useState<IMihomoConnectionDetail[]>([])
  const [closedConnections, setClosedConnections] = useState<IMihomoConnectionDetail[]>([])
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [selected, setSelected] = useState<IMihomoConnectionDetail>()
  const [tab, setTab] = useState('active')
  const [isPaused, setIsPaused] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'table'>(connectionViewMode)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(connectionTableColumns))

  const [appNameCache, setAppNameCache] = useState<Record<string, string>>({})

  const activeConnectionsRef = useRef(activeConnections)
  const allConnectionsRef = useRef(allConnections)

  const appNameRequestQueue = useRef(new Set<string>())
  const processingAppNames = useRef(new Set<string>())
  const processAppNameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    activeConnectionsRef.current = activeConnections
    allConnectionsRef.current = allConnections
  }, [activeConnections, allConnections])

  const selectedConnection = useMemo(() => {
    if (!selected) return undefined
    return (
      activeConnections.find((c) => c.id === selected.id) ||
      closedConnections.find((c) => c.id === selected.id) ||
      selected
    )
  }, [selected, activeConnections, closedConnections])

  const handleColumnWidthChange = useCallback(
    async (widths: Record<string, number>) => {
      await patchAppConfig({ connectionTableColumnWidths: widths })
    },
    [patchAppConfig]
  )

  const handleSortChange = useCallback(
    async (column: string | null, direction: 'asc' | 'desc') => {
      await patchAppConfig({
        connectionTableSortColumn: column || undefined,
        connectionTableSortDirection: direction
      })
    },
    [patchAppConfig]
  )

  const filteredConnections = useMemo(() => {
    const connections = tab === 'active' ? activeConnections : closedConnections

    const filtered =
      filter === ''
        ? connections
        : connections.filter((connection) => {
            const raw = JSON.stringify(connection)
            return includesIgnoreCase(raw, filter)
          })

    if (viewMode === 'list' && connectionOrderBy) {
      return [...filtered].sort((a, b) => {
        let comparison = 0
        switch (connectionOrderBy) {
          case 'time':
            comparison = dayjs(a.start).unix() - dayjs(b.start).unix()
            break
          case 'upload':
            comparison = a.upload - b.upload
            break
          case 'download':
            comparison = a.download - b.download
            break
          case 'uploadSpeed':
            comparison = (a.uploadSpeed || 0) - (b.uploadSpeed || 0)
            break
          case 'downloadSpeed':
            comparison = (a.downloadSpeed || 0) - (b.downloadSpeed || 0)
            break
        }
        return connectionDirection === 'asc' ? comparison : -comparison
      })
    }

    return filtered
  }, [
    activeConnections,
    closedConnections,
    tab,
    filter,
    connectionDirection,
    connectionOrderBy,
    viewMode
  ])

  const closeAllConnections = useCallback((): void => {
    tab === 'active' ? mihomoCloseAllConnections() : trashAllClosedConnection()
  }, [tab])

  const closeConnection = useCallback(
    (id: string): void => {
      tab === 'active' ? mihomoCloseConnection(id) : trashClosedConnection(id)
    },
    [tab]
  )

  const trashAllClosedConnection = (): void => {
    setClosedConnections((closedConns) => {
      const trashIds = new Set(closedConns.map((conn) => conn.id))
      setAllConnections((allConns) => {
        const filtered = allConns.filter((conn) => !trashIds.has(conn.id))
        cachedConnections = filtered
        return filtered
      })
      return []
    })
  }

  const trashClosedConnection = (id: string): void => {
    setAllConnections((allConns) => {
      const filtered = allConns.filter((conn) => conn.id !== id)
      cachedConnections = filtered
      return filtered
    })
    setClosedConnections((closedConns) => closedConns.filter((conn) => conn.id !== id))
  }

  const processAppNameQueue = useCallback(async () => {
    if (processingAppNames.current.size >= 3 || appNameRequestQueue.current.size === 0) return

    const pathsToProcess = Array.from(appNameRequestQueue.current).slice(0, 3)
    pathsToProcess.forEach((path) => appNameRequestQueue.current.delete(path))

    const promises = pathsToProcess.map(async (path) => {
      if (processingAppNames.current.has(path)) return
      processingAppNames.current.add(path)

      try {
        const appName = await getAppName(path)
        if (appName) {
          setAppNameCache((prev) => ({ ...prev, [path]: appName }))
        }
      } catch {
        // ignore
      } finally {
        processingAppNames.current.delete(path)
      }
    })

    await Promise.all(promises)

    if (appNameRequestQueue.current.size > 0) {
      processAppNameTimer.current = setTimeout(processAppNameQueue, 100)
    }
  }, [])

  useEffect(() => {
    if (!displayAppName) return

    const visiblePaths = new Set<string>()
    const otherPaths = new Set<string>()

    const visibleConnections = filteredConnections.slice(0, 20)
    visibleConnections.forEach((c) => {
      const path = c.metadata.processPath || ''
      if (path) visiblePaths.add(path)
    })

    const collectPaths = (connections: IMihomoConnectionDetail[]) => {
      for (const c of connections) {
        const path = c.metadata.processPath || ''
        if (path && !visiblePaths.has(path)) {
          otherPaths.add(path)
        }
      }
    }

    collectPaths(activeConnections)
    collectPaths(closedConnections)

    const loadAppName = (path: string): void => {
      if (appNameCache[path] || processingAppNames.current.has(path)) return
      if (appNameRequestQueue.current.size >= MAX_QUEUE_SIZE) return
      appNameRequestQueue.current.add(path)
    }

    visiblePaths.forEach((path) => {
      loadAppName(path)
    })

    if (otherPaths.size > 0) {
      const loadOtherPaths = () => {
        otherPaths.forEach((path) => {
          loadAppName(path)
        })
      }

      setTimeout(loadOtherPaths, 100)
    }

    if (processAppNameTimer.current) clearTimeout(processAppNameTimer.current)

    processAppNameTimer.current = setTimeout(processAppNameQueue, 10)

    return (): void => {
      if (processAppNameTimer.current) clearTimeout(processAppNameTimer.current)
    }
  }, [
    activeConnections,
    closedConnections,
    appNameCache,
    processAppNameQueue,
    displayAppName,
    filteredConnections
  ])

  useEffect(() => {
    const handler = (_e: unknown, ...args: unknown[]): void => {
      const info = args[0] as IMihomoConnectionsInfo
      setConnectionsInfo(info)

      if (!info.connections) return
      // O(n+m) merge using Map instead of O(n²) unionWith
      const allConnsMap = new Map(allConnectionsRef.current.map((c) => [c.id, c]))
      activeConnectionsRef.current.forEach((c) => allConnsMap.set(c.id, c))
      const allConns = Array.from(allConnsMap.values())

      const prevConnMap = new Map(activeConnectionsRef.current.map((c) => [c.id, c]))
      const activeConns = info.connections.map((conn) => {
        const preConn = prevConnMap.get(conn.id)
        return {
          ...conn,
          isActive: true,
          downloadSpeed: preConn ? conn.download - preConn.download : 0,
          uploadSpeed: preConn ? conn.upload - preConn.upload : 0
        }
      })
      // O(n+m) difference using Set instead of O(n²) differenceWith
      const activeIdSet = new Set(activeConns.map((c) => c.id))
      const closedConns = allConns
        .filter((c) => !activeIdSet.has(c.id))
        .map((conn) => ({
          ...conn,
          isActive: false,
          downloadSpeed: 0,
          uploadSpeed: 0
        }))

      const sliced = allConns.slice(-(activeConns.length + 200))
      setActiveConnections(activeConns)
      setClosedConnections(closedConns)
      setAllConnections(sliced)
      cachedConnections = sliced
    }

    if (!isPaused) {
      window.electron.ipcRenderer.on('mihomoConnections', handler)
    }

    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('mihomoConnections')
    }
  }, [isPaused])
  const togglePause = useCallback(() => {
    setIsPaused((prev) => !prev)
  }, [])

  const renderConnectionItem = useCallback(
    (i: number, connection: IMihomoConnectionDetail) => {
      const displayName =
        displayAppName && connection.metadata.processPath
          ? appNameCache[connection.metadata.processPath]
          : undefined

      return (
        <ConnectionItem
          setSelected={setSelected}
          setIsDetailModalOpen={setIsDetailModalOpen}
          selected={selected}
          displayName={displayName}
          close={closeConnection}
          index={i}
          key={connection.id}
          info={connection}
        />
      )
    },
    [selected, closeConnection, appNameCache, displayAppName]
  )

  return (
    <BasePage
      title={t('connections.title')}
      header={
        <div className="flex">
          <div className="flex items-center">
            <span className="mx-1 text-gray-400">
              ↑ {calcTraffic(connectionsInfo?.uploadTotal ?? 0)}{' '}
            </span>
            <span className="mx-1 text-gray-400">
              ↓ {calcTraffic(connectionsInfo?.downloadTotal ?? 0)}{' '}
            </span>
          </div>
          <Badge
            className="app-nodrag pointer-events-none mt-2"
            color="primary"
            variant="flat"
            showOutline={false}
            content={filteredConnections.length}
          >
            <Button
              className="app-nodrag ml-1"
              title={
                viewMode === 'list'
                  ? t('connections.table.switchToTable')
                  : t('connections.table.switchToList')
              }
              isIconOnly
              size="sm"
              variant="light"
              onPress={async () => {
                const newMode = viewMode === 'list' ? 'table' : 'list'
                setViewMode(newMode)
                await patchAppConfig({ connectionViewMode: newMode })
              }}
            >
              {viewMode === 'list' ? (
                <MdTableChart className="text-lg" />
              ) : (
                <MdViewList className="text-lg" />
              )}
            </Button>
            <Button
              className="app-nodrag ml-1"
              title={isPaused ? t('connections.resume') : t('connections.pause')}
              isIconOnly
              size="sm"
              variant="light"
              onPress={togglePause}
            >
              {isPaused ? <IoMdPlay className="text-lg" /> : <IoMdPause className="text-lg" />}
            </Button>
            <Button
              className="app-nodrag ml-1"
              title={t('connections.closeAll')}
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => {
                if (filter === '') {
                  closeAllConnections()
                } else {
                  filteredConnections.forEach((conn) => {
                    closeConnection(conn.id)
                  })
                }
              }}
            >
              {tab === 'active' ? <CgClose className="text-lg" /> : <CgTrash className="text-lg" />}
            </Button>
          </Badge>
        </div>
      }
    >
      {isDetailModalOpen && selectedConnection && (
        <ConnectionDetailModal
          onClose={() => setIsDetailModalOpen(false)}
          connection={selectedConnection}
        />
      )}
      <div className="overflow-x-auto sticky top-0 z-40">
        <div className="flex p-2 gap-2">
          <Tabs
            size="sm"
            color={tab === 'active' ? 'primary' : 'danger'}
            selectedKey={tab}
            variant="underlined"
            className="w-fit h-8"
            onSelectionChange={(key: Key) => {
              setTab(key as string)
            }}
          >
            <Tab
              key="active"
              title={
                <Badge
                  color={tab === 'active' ? 'primary' : 'default'}
                  size="sm"
                  shape="circle"
                  variant="flat"
                  content={activeConnections.length}
                  showOutline={false}
                >
                  <span className="p-1">{t('connections.active')}</span>
                </Badge>
              }
            />
            <Tab
              key="closed"
              title={
                <Badge
                  color={tab === 'closed' ? 'danger' : 'default'}
                  size="sm"
                  shape="circle"
                  variant="flat"
                  content={closedConnections.length}
                  showOutline={false}
                >
                  <span className="p-1">{t('connections.closed')}</span>
                </Badge>
              }
            />
          </Tabs>
          <Input
            variant="flat"
            size="sm"
            value={filter}
            placeholder={t('connections.filter')}
            isClearable
            onValueChange={setFilter}
          />

          {viewMode === 'table' && (
            <Dropdown disableAnimation>
              <DropdownTrigger>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<HiOutlineAdjustmentsHorizontal className="text-2xl" />}
                >
                  {t('connections.table.columns')}
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label="Column visibility"
                closeOnSelect={false}
                selectionMode="multiple"
                selectedKeys={visibleColumns}
                onSelectionChange={async (keys) => {
                  const newColumns = Array.from(keys) as string[]
                  setVisibleColumns(new Set(newColumns))
                  await patchAppConfig({ connectionTableColumns: newColumns })
                }}
              >
                <DropdownItem key="status">{t('connections.detail.status')}</DropdownItem>
                <DropdownItem key="establishTime">
                  {t('connections.detail.establishTime')}
                </DropdownItem>
                <DropdownItem key="type">{t('connections.detail.connectionType')}</DropdownItem>
                <DropdownItem key="host">{t('connections.detail.host')}</DropdownItem>
                <DropdownItem key="sniffHost">{t('connections.detail.sniffHost')}</DropdownItem>
                <DropdownItem key="process">{t('connections.detail.processName')}</DropdownItem>
                <DropdownItem key="processPath">{t('connections.detail.processPath')}</DropdownItem>
                <DropdownItem key="rule">{t('connections.detail.rule')}</DropdownItem>
                <DropdownItem key="proxyChain">{t('connections.detail.proxyChain')}</DropdownItem>
                <DropdownItem key="sourceIP">{t('connections.detail.sourceIP')}</DropdownItem>
                <DropdownItem key="sourcePort">{t('connections.detail.sourcePort')}</DropdownItem>
                <DropdownItem key="destinationPort">
                  {t('connections.detail.destinationPort')}
                </DropdownItem>
                <DropdownItem key="inboundIP">{t('connections.detail.inboundIP')}</DropdownItem>
                <DropdownItem key="inboundPort">{t('connections.detail.inboundPort')}</DropdownItem>
                <DropdownItem key="uploadSpeed">{t('connections.uploadSpeed')}</DropdownItem>
                <DropdownItem key="downloadSpeed">{t('connections.downloadSpeed')}</DropdownItem>
                <DropdownItem key="upload">{t('connections.uploadAmount')}</DropdownItem>
                <DropdownItem key="download">{t('connections.downloadAmount')}</DropdownItem>
                <DropdownItem key="dscp">{t('connections.detail.dscp')}</DropdownItem>
                <DropdownItem key="remoteDestination">
                  {t('connections.detail.remoteDestination')}
                </DropdownItem>
                <DropdownItem key="dnsMode">{t('connections.detail.dnsMode')}</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          )}

          {viewMode === 'list' && (
            <>
              <Select
                classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
                disableAnimation
                size="sm"
                className="w-45 min-w-32.75"
                aria-label={t('connections.orderBy')}
                selectedKeys={[connectionOrderBy]}
                disallowEmptySelection={true}
                onSelectionChange={async (v) => {
                  await patchAppConfig({
                    connectionOrderBy: v.currentKey as
                      | 'time'
                      | 'upload'
                      | 'download'
                      | 'uploadSpeed'
                      | 'downloadSpeed'
                  })
                }}
              >
                <SelectItem key="time">{t('connections.time')}</SelectItem>
                <SelectItem key="upload">{t('connections.uploadAmount')}</SelectItem>
                <SelectItem key="download">{t('connections.downloadAmount')}</SelectItem>
                <SelectItem key="uploadSpeed">{t('connections.uploadSpeed')}</SelectItem>
                <SelectItem key="downloadSpeed">{t('connections.downloadSpeed')}</SelectItem>
              </Select>
              <Button
                size="sm"
                isIconOnly
                className="bg-content2"
                onPress={() => {
                  patchAppConfig({
                    connectionDirection: connectionDirection === 'asc' ? 'desc' : 'asc'
                  })
                }}
              >
                {connectionDirection === 'asc' ? (
                  <HiSortAscending className="text-lg" />
                ) : (
                  <HiSortDescending className="text-lg" />
                )}
              </Button>
            </>
          )}
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-px">
        {viewMode === 'list' ? (
          <Virtuoso data={filteredConnections} itemContent={renderConnectionItem} />
        ) : (
          <ConnectionTable
            connections={filteredConnections}
            setSelected={setSelected}
            setIsDetailModalOpen={setIsDetailModalOpen}
            close={closeConnection}
            visibleColumns={visibleColumns}
            initialColumnWidths={connectionTableColumnWidths}
            initialSortColumn={connectionTableSortColumn}
            initialSortDirection={connectionTableSortDirection}
            onColumnWidthChange={handleColumnWidthChange}
            onSortChange={handleSortChange}
          />
        )}
      </div>
    </BasePage>
  )
}

export default Connections
