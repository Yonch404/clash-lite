import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { IoGlobeOutline } from 'react-icons/io5'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'
import { useSiderNavigation } from './sider-navigation'

interface Props {
  iconOnly?: boolean
}

const IPCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { disableAnimations = false } = appConfig || {}
  const { selected: match, goToPage } = useSiderNavigation('/network')

  if (iconOnly) {
    return (
      <div className="col-span-1 flex justify-center">
        <Tooltip content={t('sider.cards.network')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goToPage}
          >
            <IoGlobeOutline className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="col-span-1 network-card">
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
            <Button
              isIconOnly
              className="bg-transparent pointer-events-none"
              variant="flat"
              color="default"
            >
              <IoGlobeOutline
                color="default"
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold text-ellipsis whitespace-nowrap overflow-hidden ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.network')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default IPCard
