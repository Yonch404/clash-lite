import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoGroupSummaries } from '@renderer/utils/ipc'

interface GroupsContextType {
  groups: IMihomoMixedGroupSummary[] | undefined
  mutate: () => void
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

function latestDelay(history: IMihomoHistory[]): number | undefined {
  return history[history.length - 1]?.delay
}

function isSameGroupSummary(
  previous: IMihomoMixedGroupSummary,
  next: IMihomoMixedGroupSummary
): boolean {
  return (
    previous.alive === next.alive &&
    previous.allCount === next.allCount &&
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
    latestDelay(previous.history) === latestDelay(next.history)
  )
}

function mergeGroupSummaries(
  previous: IMihomoMixedGroupSummary[] | undefined,
  next: IMihomoMixedGroupSummary[]
): IMihomoMixedGroupSummary[] {
  if (!previous) return next

  const previousByName = new Map(previous.map((group) => [group.name, group]))
  let changed = previous.length !== next.length
  const merged = next.map((group, index) => {
    const previousGroup = previousByName.get(group.name)
    if (previousGroup && isSameGroupSummary(previousGroup, group)) {
      if (previousGroup !== previous[index]) {
        changed = true
      }
      return previousGroup
    }

    changed = true
    return group
  })

  return changed ? merged : previous
}

export const GroupsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const groupsRef = React.useRef<IMihomoMixedGroupSummary[] | undefined>(undefined)
  const fetchGroups = React.useCallback(async () => {
    const groups = mergeGroupSummaries(groupsRef.current, await mihomoGroupSummaries())
    groupsRef.current = groups
    return groups
  }, [])
  const { data: groups, mutate } = useSWR<IMihomoMixedGroupSummary[]>(
    'mihomoGroupSummaries',
    fetchGroups,
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
    groupsRef.current = groups
  }, [groups])

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
