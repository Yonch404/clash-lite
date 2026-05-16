import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'

interface SiderNavigationContextValue {
  activePath: string
  isActivePath: (path: string) => boolean
  navigateTo: (path: string) => void
}

const SiderNavigationContext = createContext<SiderNavigationContextValue | null>(null)

const pathMatches = (pathname: string, targetPath: string): boolean =>
  pathname === targetPath || pathname.startsWith(`${targetPath}/`)

export const SiderNavigationProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const pendingOriginPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingPath) return

    const pendingArrived = pathMatches(location.pathname, pendingPath)
    const routeChangedElsewhere =
      pendingOriginPathRef.current !== null && location.pathname !== pendingOriginPathRef.current

    if (pendingArrived || routeChangedElsewhere) {
      pendingOriginPathRef.current = null
      setPendingPath(null)
    }
  }, [location.pathname, pendingPath])

  const activePath = pendingPath ?? location.pathname

  const navigateTo = useCallback(
    (path: string): void => {
      flushSync(() => {
        if (pathMatches(location.pathname, path)) {
          pendingOriginPathRef.current = null
          setPendingPath(null)
        } else {
          pendingOriginPathRef.current = location.pathname
          setPendingPath(path)
        }
      })

      void navigate(path)
    },
    [location.pathname, navigate]
  )

  const isActivePath = useCallback(
    (path: string): boolean => pathMatches(activePath, path),
    [activePath]
  )

  const value = useMemo(
    () => ({
      activePath,
      isActivePath,
      navigateTo
    }),
    [activePath, isActivePath, navigateTo]
  )

  return <SiderNavigationContext.Provider value={value}>{children}</SiderNavigationContext.Provider>
}

export const useSiderNavigation = (path: string): { selected: boolean; goToPage: () => void } => {
  const context = useContext(SiderNavigationContext)

  if (!context) {
    throw new Error('useSiderNavigation must be used within SiderNavigationProvider')
  }

  const { isActivePath, navigateTo } = context
  const selected = isActivePath(path)
  const goToPage = useCallback((): void => {
    navigateTo(path)
  }, [navigateTo, path])

  return { selected, goToPage }
}
