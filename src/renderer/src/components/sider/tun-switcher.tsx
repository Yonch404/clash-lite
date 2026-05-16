import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import BorderSwitch from '@renderer/components/base/border-swtich'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useProfileAvailability } from '@renderer/hooks/use-profile-availability'
import { TbDeviceIpadHorizontalBolt } from 'react-icons/tb'
import React from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { restartCore } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'
import { useSiderNavigation } from './sider-navigation'

interface Props {
  iconOnly?: boolean
}

const TunSwitcher: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { iconOnly } = props
  const { selected: match, goToPage } = useSiderNavigation('/tun')
  const { appConfig } = useAppConfig()
  const { disableAnimations = false } = appConfig || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const profileUsable = useProfileAvailability()
  const cardDisabled = !profileUsable
  const tunEnabled =
    profileUsable && controledMihomoConfig ? (controledMihomoConfig.tun?.enable ?? true) : false
  const onChange = async (enable: boolean): Promise<void> => {
    if (!profileUsable) return

    await patchControledMihomoConfig({ tun: { enable } })
    window.electron.ipcRenderer.send('updateTrayMenu')
    await window.electron.ipcRenderer.invoke('updateTrayIcon')

    if (platform === 'win32' || (platform === 'linux' && enable)) {
      await restartCore()
    }
  }

  if (iconOnly) {
    return (
      <div className="col-span-1 flex justify-center">
        <Tooltip content={t('sider.cards.tun')} placement="right">
          <Button
            size="sm"
            isIconOnly
            isDisabled={cardDisabled}
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
        isPressable={!cardDisabled}
        disableAnimation
        onPointerDown={
          cardDisabled ? undefined : (event) => handleSiderCardPointerDown(event, goToPage)
        }
        onPress={cardDisabled ? undefined : (event) => handleSiderCardPress(event, goToPage)}
        className={`${siderCardClass(match, disableAnimations)} ${cardDisabled ? 'opacity-60' : ''}`}
      >
        <CardBody className="pb-1 pt-0 px-0">
          <div className="flex justify-between">
            <Button isIconOnly className="bg-transparent pointer-events-none" variant="flat">
              <TbDeviceIpadHorizontalBolt
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isDisabled={cardDisabled}
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
