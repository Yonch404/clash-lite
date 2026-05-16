import React from 'react'
import useSWR from 'swr'
import { hasUsableCurrentProfile } from '@renderer/utils/ipc'

export function useProfileAvailability(): boolean {
  const { data, mutate } = useSWR('hasUsableCurrentProfile', hasUsableCurrentProfile)

  React.useEffect(() => {
    const handler = (): void => {
      mutate()
    }
    window.electron.ipcRenderer.on('profileConfigUpdated', handler)
    window.electron.ipcRenderer.on('appConfigUpdated', handler)
    window.electron.ipcRenderer.on('controledMihomoConfigUpdated', handler)
    return (): void => {
      window.electron.ipcRenderer.removeListener('profileConfigUpdated', handler)
      window.electron.ipcRenderer.removeListener('appConfigUpdated', handler)
      window.electron.ipcRenderer.removeListener('controledMihomoConfigUpdated', handler)
    }
  }, [mutate])

  return data === true
}
