import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import BorderSwitch from '@renderer/components/base/border-swtich'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useProfileAvailability } from '@renderer/hooks/use-profile-availability'
import { triggerSysProxy, updateTrayIcon } from '@renderer/utils/ipc'
import { AiOutlineGlobal } from 'react-icons/ai'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'
import { useSiderNavigation } from './sider-navigation'

interface Props {
  iconOnly?: boolean
}

const SysproxySwitcher: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { iconOnly } = props
  const { selected: match, goToPage } = useSiderNavigation('/sysproxy')
  const { appConfig, patchAppConfig } = useAppConfig()
  const { sysProxy, disableAnimations = false } = appConfig || {}
  const { enable } = sysProxy || {}
  const profileUsable = useProfileAvailability()
  const cardDisabled = !profileUsable
  const displayEnabled = profileUsable && (enable ?? false)
  const onChange = async (enable: boolean): Promise<void> => {
    if (!profileUsable) return

    const previousState = !enable

    try {
      await patchAppConfig({ sysProxy: { enable } })
      await triggerSysProxy(enable)

      window.electron.ipcRenderer.send('updateTrayMenu')
      await updateTrayIcon()
    } catch (e) {
      await patchAppConfig({ sysProxy: { enable: previousState } })
      await updateTrayIcon()
      toast.error(String(e))
    }
  }

  if (iconOnly) {
    return (
      <div className="col-span-1 flex justify-center">
        <Tooltip content={t('sider.cards.systemProxy')} placement="right">
          <Button
            size="sm"
            isIconOnly
            isDisabled={cardDisabled}
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goToPage}
          >
            <AiOutlineGlobal className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="col-span-1 sysproxy-card">
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
            <Button
              isIconOnly
              className="bg-transparent pointer-events-none"
              variant="flat"
              color="default"
            >
              <AiOutlineGlobal
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isDisabled={cardDisabled}
              isShowBorder={match && displayEnabled}
              isSelected={displayEnabled}
              onValueChange={onChange}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.systemProxy')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default SysproxySwitcher
