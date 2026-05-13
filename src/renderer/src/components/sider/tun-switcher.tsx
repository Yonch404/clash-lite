import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import BorderSwitch from '@renderer/components/base/border-swtich'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { TbDeviceIpadHorizontalBolt } from 'react-icons/tb'
import { useLocation, useNavigate } from 'react-router-dom'
import React from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { checkAdminPrivileges, restartAsAdmin } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'

interface Props {
  iconOnly?: boolean
}

const TunSwitcher: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { iconOnly } = props
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/tun') || false
  const { appConfig } = useAppConfig()
  const { disableAnimations = false } = appConfig || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const tunEnabled = controledMihomoConfig ? (controledMihomoConfig.tun?.enable ?? true) : false
  const goToPage = (): void => {
    void navigate('/tun')
  }
  const onChange = async (enable: boolean): Promise<void> => {
    if (enable && platform === 'win32') {
      const isAdmin = await checkAdminPrivileges()
      if (!isAdmin) {
        const confirmed = window.confirm(t('tun.permissions.message'))
        if (!confirmed) return

        await patchControledMihomoConfig({ tun: { enable } })
        window.electron.ipcRenderer.send('updateTrayMenu')
        await window.electron.ipcRenderer.invoke('updateTrayIcon')
        await restartAsAdmin()
        return
      }
    }

    await patchControledMihomoConfig({ tun: { enable } })
    window.electron.ipcRenderer.send('updateTrayMenu')
    await window.electron.ipcRenderer.invoke('updateTrayIcon')
  }

  if (iconOnly) {
    return (
      <div className="col-span-1 flex justify-center">
        <Tooltip content={t('sider.cards.tun')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goToPage}
          >
            <TbDeviceIpadHorizontalBolt className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="col-span-1 tun-card">
      <Card
        as="div"
        fullWidth
        isPressable
        disableAnimation
        onPointerDown={(event) => handleSiderCardPointerDown(event, goToPage)}
        onPress={(event) => handleSiderCardPress(event, goToPage)}
        className={siderCardClass(match, disableAnimations)}
      >
        <CardBody className="pb-1 pt-0 px-0">
          <div className="flex justify-between">
            <Button isIconOnly className="bg-transparent pointer-events-none" variant="flat">
              <TbDeviceIpadHorizontalBolt
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isShowBorder={match && tunEnabled}
              isSelected={tunEnabled}
              onValueChange={onChange}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.tun')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default TunSwitcher
