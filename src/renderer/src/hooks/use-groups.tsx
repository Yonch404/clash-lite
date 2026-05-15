import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoGroupSummaries } from '@renderer/utils/ipc'

interface GroupsContextType {
  groups: IMihomoMixedGroupSummary[] | undefined
  mutate: () => void
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

export const GroupsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: groups, mutate } = useSWR<IMihomoMixedGroupSummary[]>(
    'mihomoGroupSummaries',
    mihomoGroupSummaries,
    {
      errorRetryInterval: 200,
      errorRetryCount: 10,
      refreshInterval: 30000,
      dedupingInterval: 5000,
      keepPreviousData: true,
      revalidateOnFocus: false
    }
  )

  React.useEffect(() => {
    const handler = (): void => {
      mutate()
    }
    window.electron.ipcRenderer.on('groupsUpdated', handler)
    return (): void => {
      window.electron.ipcRenderer.removeListener('groupsUpdated', handler)
    }
  }, [mutate])

  return <GroupsContext.Provider value={{ groups, mutate }}>{children}</GroupsContext.Provider>
}

export const useGroups = (): GroupsContextType => {
  const context = useContext(GroupsContext)
  if (context === undefined) {
    throw new Error('useGroups must be used within an GroupsProvider')
  }
  return context
}
