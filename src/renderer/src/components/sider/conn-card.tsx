import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { FaCircleArrowDown, FaCircleArrowUp } from 'react-icons/fa6'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic } from '@renderer/utils/calc'
import React, { lazy, Suspense, useEffect, useState, useCallback } from 'react'
import { IoLink } from 'react-icons/io5'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'

const ConnCardChart = lazy(() => import('./conn-card-chart'))

interface Props {
  iconOnly?: boolean
}
const ConnCard: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const { appConfig } = useAppConfig()
  const { disableAnimations = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/connections')
  const { t } = useTranslation()
  const goToPage = (): void => {
    void navigate('/connections')
  }

  const [upload, setUpload] = useState(0)
  const [download, setDownload] = useState(0)
  const [series, setSeries] = useState(Array(10).fill(0))

  // 使用 useCallback 创建稳定的 handler 引用，通过 ref 读取 showTraffic 避免重建
  const handleTraffic = useCallback((_e: unknown, ...args: unknown[]) => {
    const info = args[0] as IMihomoTrafficInfo
    setUpload(info.up)
    setDownload(info.down)
    setSeries((prev) => {
      const data = [...prev]
      data.shift()
      data.push(info.up + info.down)
      return data
    })
  }, [])

  useEffect(() => {
    window.electron.ipcRenderer.on('mihomoTraffic', handleTraffic)
    return (): void => {
      window.electron.ipcRenderer.removeListener('mihomoTraffic', handleTraffic)
    }
  }, [handleTraffic])

  if (iconOnly) {
    return (
      <div className="col-span-2 flex justify-center">
        <Tooltip content={t('sider.cards.connections')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goToPage}
          >
            <IoLink className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="col-span-2 conn-card">
      <Card
        as="div"
        fullWidth
        isPressable
        disableAnimation
        onPointerDown={(event) => handleSiderCardPointerDown(event, goToPage)}
        onPress={(event) => handleSiderCardPress(event, goToPage)}
        className={siderCardClass(match, disableAnimations)}
      >
        <div className="w-full h-full absolute top-0 left-0 pointer-events-none overflow-hidden rounded-[14px]">
          <Suspense fallback={null}>
            <ConnCardChart series={series} selected={match} />
          </Suspense>
        </div>
        <CardBody className="pb-1 pt-0 px-0">
          <div className="flex justify-between">
            <Button
              isIconOnly
              className="bg-transparent pointer-events-none"
              variant="flat"
              color="default"
            >
              <IoLink
                color="default"
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
              />
            </Button>
            <div className={`p-2 w-full ${match ? 'text-primary-foreground' : 'text-foreground'} `}>
              <div className="flex justify-between">
                <div className="w-full text-right mr-2">{calcTraffic(upload)}/s</div>
                <FaCircleArrowUp className="h-[24px] leading-[24px]" />
              </div>
              <div className="flex justify-between">
                <div className="w-full text-right mr-2">{calcTraffic(download)}/s</div>
                <FaCircleArrowDown className="h-[24px] leading-[24px]" />
              </div>
            </div>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.connections')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default ConnCard
