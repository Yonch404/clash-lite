import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { LuGroup } from 'react-icons/lu'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'
import { useSiderNavigation } from './sider-navigation'

interface Props {
  iconOnly?: boolean
}

const ProxyCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { disableAnimations = false } = appConfig || {}
  const { selected: match, goToPage } = useSiderNavigation('/proxies')

  if (iconOnly) {
    return (
      <div className="col-span-2 flex justify-center">
        <Tooltip content={t('proxies.card.title')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goToPage}
          >
            <LuGroup className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }
  return (
    <div className="col-span-2 proxy-card">
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
          <div className="flex">
            <Button
              isIconOnly
              className="bg-transparent pointer-events-none"
              variant="flat"
              color="default"
            >
              <LuGroup
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold sider-card-title ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('proxies.card.title')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default ProxyCard
