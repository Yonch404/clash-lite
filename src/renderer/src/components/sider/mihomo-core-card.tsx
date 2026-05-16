import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { calcTraffic } from '@renderer/utils/calc'
import { mihomoVersion, restartCore } from '@renderer/utils/ipc'
import React, { useEffect, useState } from 'react'
import { IoMdRefresh } from 'react-icons/io'
import PubSub from 'pubsub-js'
import useSWR from 'swr'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { LuCpu } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'
import { useSiderNavigation } from './sider-navigation'

interface Props {
  iconOnly?: boolean
}

const MihomoCoreCard: React.FC<Props> = (props) => {
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { disableAnimations = false } = appConfig || {}
  const { data: version, mutate } = useSWR('mihomoVersion', mihomoVersion)
  const { selected: match, goToPage } = useSiderNavigation('/mihomo')
  const [mem, setMem] = useState(0)
  const [restarting, setRestarting] = useState(false)
  const { t } = useTranslation()
  const coreVersion = version?.version ?? '-'
  const coreVersionFontSize =
    coreVersion.length > 34 ? '0.625rem' : coreVersion.length > 26 ? '0.72rem' : '1rem'

  useEffect(() => {
    const token = PubSub.subscribe('mihomo-core-changed', () => {
      mutate()
    })

    const handler = (_e: unknown, ...args: unknown[]): void => {
      const info = args[0] as IMihomoMemoryInfo
      setMem(info.inuse)
    }

    window.electron.ipcRenderer.on('mihomoMemory', handler)

    return (): void => {
      PubSub.unsubscribe(token)
      window.electron.ipcRenderer.removeListener('mihomoMemory', handler)
    }
  }, [mutate])

  if (iconOnly) {
    return (
      <div className="col-span-2 flex justify-center">
        <Tooltip content={t('sider.cards.core')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goToPage}
          >
            <LuCpu className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="col-span-2 mihomo-core-card">
      <Card
        as="div"
        fullWidth
        isPressable
        disableAnimation
        onPointerDown={(event) => handleSiderCardPointerDown(event, goToPage)}
        onPress={(event) => handleSiderCardPress(event, goToPage)}
        className={siderCardClass(match, disableAnimations)}
      >
        <CardBody className="overflow-hidden">
          <div className="flex justify-between h-[32px] overflow-hidden">
            <h3
              className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap font-bold leading-[32px] ${match ? 'text-primary-foreground' : 'text-foreground'} `}
              style={{ fontSize: coreVersionFontSize }}
              title={coreVersion}
            >
              {coreVersion}
            </h3>

            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="default"
              title={t('mihomo.restart')}
              disabled={restarting}
              onPress={async () => {
                setRestarting(true)
                try {
                  await restartCore()
                } catch (e) {
                  toast.error(String(e))
                } finally {
                  mutate()
                  setRestarting(false)
                }
              }}
            >
              <IoMdRefresh
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] ${restarting ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <div
            className={`flex justify-between w-full text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            <h4>{t('sider.cards.core')}</h4>
            <h4>{calcTraffic(mem)}</h4>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

export default MihomoCoreCard
