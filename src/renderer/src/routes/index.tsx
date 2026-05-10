import { lazy } from 'react'
import { Navigate } from 'react-router-dom'

const NetworkPage = lazy(() => import('@renderer/pages/network'))
const Proxies = lazy(() => import('@renderer/pages/proxies'))
const Settings = lazy(() => import('@renderer/pages/settings'))
const Profiles = lazy(() => import('@renderer/pages/profiles'))
const Logs = lazy(() => import('@renderer/pages/logs'))
const Connections = lazy(() => import('@renderer/pages/connections'))
const Mihomo = lazy(() => import('@renderer/pages/mihomo'))
const Sysproxy = lazy(() => import('@renderer/pages/sysproxy'))
const Tun = lazy(() => import('@renderer/pages/tun'))

const routes = [
  {
    path: '/network',
    element: <NetworkPage />
  },
  {
    path: '/mihomo',
    element: <Mihomo />
  },
  {
    path: '/sysproxy',
    element: <Sysproxy />
  },
  {
    path: '/tun',
    element: <Tun />
  },
  {
    path: '/proxies',
    element: <Proxies />
  },
  {
    path: '/logs',
    element: <Logs />
  },
  {
    path: '/connections',
    element: <Connections />
  },
  {
    path: '/profiles',
    element: <Profiles />
  },
  {
    path: '/settings',
    element: <Settings />
  },
  {
    path: '/',
    element: <Navigate to="/proxies" />
  }
]

export default routes
