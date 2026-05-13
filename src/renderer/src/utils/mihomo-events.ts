type IpcEventHandler<T> = (data: T) => void

type IpcChannel = 'mihomoConnections'

type SharedSubscriptions = Partial<
  Record<IpcChannel, (handler: IpcEventHandler<unknown>) => () => void>
>

const sharedSubscriptionsKey = '__clashLiteMihomoSubscriptions__'

const globalStore = globalThis as Record<string, unknown>
const sharedSubscriptions =
  (globalStore[sharedSubscriptionsKey] as SharedSubscriptions | undefined) || {}

globalStore[sharedSubscriptionsKey] = sharedSubscriptions

function createSharedIpcSubscription<T>(
  channel: IpcChannel
): (handler: IpcEventHandler<T>) => () => void {
  const existing = sharedSubscriptions[channel]
  if (existing) {
    return existing as (handler: IpcEventHandler<T>) => () => void
  }

  const handlers = new Set<IpcEventHandler<T>>()

  const ipcHandler = (_e: unknown, ...args: unknown[]): void => {
    const data = args[0] as T
    handlers.forEach((handler) => handler(data))
  }

  let attached = false

  const subscribe = (handler: IpcEventHandler<T>): (() => void) => {
    handlers.add(handler)

    if (!attached) {
      window.electron.ipcRenderer.on(channel, ipcHandler)
      attached = true
    }

    return (): void => {
      handlers.delete(handler)

      if (attached && handlers.size === 0) {
        window.electron.ipcRenderer.removeListener(channel, ipcHandler)
        attached = false
      }
    }
  }

  sharedSubscriptions[channel] = subscribe as (handler: IpcEventHandler<unknown>) => () => void

  return subscribe
}

export const onMihomoConnections =
  createSharedIpcSubscription<IMihomoConnectionsInfo>('mihomoConnections')
