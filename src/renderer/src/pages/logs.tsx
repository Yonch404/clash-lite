import BasePage from '@renderer/components/base/base-page'
import LogItem from '@renderer/components/logs/log-item'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Divider, Input } from '@heroui/react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { IoLocationSharp } from 'react-icons/io5'
import { CgTrash } from 'react-icons/cg'
import { useTranslation } from 'react-i18next'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { subscribeMihomoLogs, unsubscribeMihomoLogs } from '@renderer/utils/ipc'

const LOGS_FILTER_KEY = 'logs-filter'
const LOGS_CACHE_KEY = '__clashLiteLogsCache__'
const LOGS_LISTENER_KEY = '__clashLiteLogsListenerAttached__'

interface LogsCache {
  log: IMihomoLogInfo[]
  trigger: (() => void) | null
}

function getLogsCache(): LogsCache {
  const globalStore = globalThis as Record<string, unknown>
  const existing = globalStore[LOGS_CACHE_KEY] as LogsCache | undefined
  if (existing) return existing

  const created: LogsCache = {
    log: [],
    trigger: null
  }
  globalStore[LOGS_CACHE_KEY] = created
  return created
}

const cachedLogs = getLogsCache()

function emitLogUpdate(): void {
  cachedLogs.trigger?.()
}

function pushLog(log: IMihomoLogInfo): void {
  cachedLogs.log.push({ ...log, time: new Date().toLocaleString() })
  if (cachedLogs.log.length > 500) {
    cachedLogs.log.shift()
  }
  emitLogUpdate()
}

function cleanLogs(): void {
  cachedLogs.log = []
  emitLogUpdate()
}

function ensureLogListener(): void {
  const globalStore = globalThis as Record<string, unknown>
  if (globalStore[LOGS_LISTENER_KEY]) return

  window.electron.ipcRenderer.on('mihomoLogs', (_e, ...args) => {
    pushLog(args[0] as IMihomoLogInfo)
  })
  globalStore[LOGS_LISTENER_KEY] = true
}

ensureLogListener()

const Logs: React.FC = () => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<IMihomoLogInfo[]>(cachedLogs.log)
  const [filter, setFilter] = useState(() => {
    return localStorage.getItem(LOGS_FILTER_KEY) || ''
  })
  const [trace, setTrace] = useState(true)

  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const filteredLogs = useMemo(() => {
    if (filter === '') return logs
    return logs.filter((log) => {
      return includesIgnoreCase(log.payload, filter) || includesIgnoreCase(log.type, filter)
    })
  }, [logs, filter])

  useEffect(() => {
    localStorage.setItem(LOGS_FILTER_KEY, filter)
  }, [filter])

  useEffect(() => {
    const old = cachedLogs.trigger
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flushLogs = (): void => {
      flushTimer = null
      setLogs([...cachedLogs.log])
    }

    const scheduleFlush = (): void => {
      if (flushTimer) return
      flushTimer = setTimeout(flushLogs, 100)
    }

    cachedLogs.trigger = scheduleFlush

    subscribeMihomoLogs().catch(() => {})

    return (): void => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      unsubscribeMihomoLogs().catch(() => {})
      cachedLogs.trigger = old
    }
  }, [])

  return (
    <BasePage title={t('logs.title')}>
      <div className="sticky top-0 z-40">
        <div className="w-full flex p-2">
          <Input
            size="sm"
            value={filter}
            placeholder={t('logs.filter')}
            isClearable
            onValueChange={setFilter}
          />
          <Button
            size="sm"
            isIconOnly
            className="ml-2"
            color={trace ? 'primary' : 'default'}
            variant={trace ? 'solid' : 'bordered'}
            title={t('logs.autoScroll')}
            onPress={() => {
              setTrace((prev) => !prev)
            }}
          >
            <IoLocationSharp className="text-lg" />
          </Button>
          <Button
            size="sm"
            isIconOnly
            title={t('logs.clear')}
            className="ml-2"
            variant="light"
            color="danger"
            onPress={() => {
              cleanLogs()
            }}
          >
            <CgTrash className="text-lg" />
          </Button>
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-px">
        <Virtuoso
          ref={virtuosoRef}
          data={filteredLogs}
          initialTopMostItemIndex={filteredLogs.length - 1}
          followOutput={trace}
          itemContent={(i, log) => (
            <LogItem index={i} time={log.time} type={log.type} payload={log.payload} />
          )}
        />
      </div>
    </BasePage>
  )
}

export default Logs
