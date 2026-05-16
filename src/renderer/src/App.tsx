import { useTheme } from 'next-themes'
import { Suspense, useCallback, useEffect, useRef } from 'react'
import { NavigateFunction, useLocation, useNavigate, useRoutes } from 'react-router-dom'
import OutboundModeSwitcher from '@renderer/components/sider/outbound-mode-switcher'
import SysproxySwitcher from '@renderer/components/sider/sysproxy-switcher'
import TunSwitcher from '@renderer/components/sider/tun-switcher'
import { Button, Divider } from '@heroui/react'
import { IoSettings } from 'react-icons/io5'
import routes from '@renderer/routes'
import ProfileCard from '@renderer/components/sider/profile-card'
import ProxyCard from '@renderer/components/sider/proxy-card'
import ConnCard from '@renderer/components/sider/conn-card'
import LogCard from '@renderer/components/sider/log-card'
import MihomoCoreCard from '@renderer/components/sider/mihomo-core-card'
import UpdaterButton from '@renderer/components/updater/updater-button'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { applyTheme, setNativeTheme, setTitleBarOverlay } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import { TitleBarOverlayOptions } from 'electron'
import NetworkCard from '@renderer/components/sider/network-card'
import { createTourDriver, getDriver, startTourIfNeeded } from '@renderer/utils/tour'
import 'driver.js/dist/driver.css'
import { useTranslation } from 'react-i18next'
import { SiderNavigationProvider } from '@renderer/components/sider/sider-navigation'

let navigate: NavigateFunction

export { getDriver }

const SIDER_WIDTH = 250

const SIDER_CARDS = [
  { key: 'sysproxy', Component: SysproxySwitcher },
  { key: 'tun', Component: TunSwitcher },
  { key: 'proxy', Component: ProxyCard },
  { key: 'profile', Component: ProfileCard },
  { key: 'connection', Component: ConnCard },
  { key: 'mihomo', Component: MihomoCoreCard },
  { key: 'log', Component: LogCard },
  { key: 'network', Component: NetworkCard }
]

const App: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { appTheme = 'system', useWindowFrame = false } = appConfig || {}
  const tourInitialized = useRef(false)
  const { setTheme, systemTheme } = useTheme()
  navigate = useNavigate()
  const location = useLocation()
  const page = useRoutes(routes)

  const setTitlebar = useCallback((): void => {
    if (!useWindowFrame && platform !== 'darwin') {
      const options = { height: 48 } as TitleBarOverlayOptions
      try {
        options.color = window.getComputedStyle(document.documentElement).backgroundColor
        options.symbolColor = window.getComputedStyle(document.documentElement).color
        setTitleBarOverlay(options)
      } catch {
        // ignore
      }
    }
  }, [useWindowFrame])

  useEffect(() => {
    if (!tourInitialized.current) {
      tourInitialized.current = true
      createTourDriver(t, navigate)
      startTourIfNeeded()
    }
  }, [t])

  useEffect(() => {
    setNativeTheme(appTheme)
    setTheme(appTheme)
    setTitlebar()
  }, [appTheme, systemTheme, setTheme, setTitlebar])

  useEffect(() => {
    applyTheme('default.css').then(() => {
      setTitlebar()
    })
  }, [setTitlebar])

  return (
    <div className="w-full h-screen flex">
      <div
        style={{ width: `${SIDER_WIDTH}px` }}
        className="side h-full overflow-y-auto no-scrollbar shrink-0"
      >
        <div className="app-drag sticky top-0 z-40 backdrop-blur bg-transparent h-12.25">
          <div
            className={`flex justify-between p-2 ${!useWindowFrame && platform === 'darwin' ? 'ml-15' : ''}`}
          >
            <div className="flex ml-1 min-w-0 items-center gap-2">
              <h3 className="text-lg font-bold leading-8">Clash Lite</h3>
              <UpdaterButton />
            </div>
            <div className="flex items-center gap-1 app-nodrag">
              <Button
                size="sm"
                className="app-nodrag"
                isIconOnly
                color={location.pathname.includes('/settings') ? 'primary' : 'default'}
                variant={location.pathname.includes('/settings') ? 'solid' : 'light'}
                onPress={() => {
                  navigate('/settings')
                }}
              >
                <IoSettings className="text-[20px]" />
              </Button>
            </div>
          </div>
        </div>
        <SiderNavigationProvider>
          <div className="mt-2 mx-2">
            <OutboundModeSwitcher />
          </div>
          <div style={{ overflowX: 'clip' }}>
            <div className="grid grid-cols-2 gap-2 m-2">
              {SIDER_CARDS.map(({ key, Component }) => (
                <Component key={key} />
              ))}
            </div>
          </div>
        </SiderNavigationProvider>
      </div>
      <Divider orientation="vertical" />
      <div
        style={{ width: `calc(100% - ${SIDER_WIDTH + 1}px)` }}
        className="main grow h-full overflow-y-auto"
      >
        <Suspense
          fallback={<div className="h-full w-full animate-pulse bg-content1" aria-busy="true" />}
        >
          {page}
        </Suspense>
      </div>
    </div>
  )
}

export default App
