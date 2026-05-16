import { Button, Card, CardBody, CardFooter, Chip, Progress, Tooltip } from '@heroui/react'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { calcTraffic, calcPercent } from '@renderer/utils/calc'
import { CgLoadbarDoc } from 'react-icons/cg'
import { IoMdRefresh } from 'react-icons/io'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import dayjs from '@renderer/utils/dayjs'
import React, { lazy, Suspense, useState } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { TiFolder } from 'react-icons/ti'
import { useTranslation } from 'react-i18next'
import { handleSiderCardPointerDown, handleSiderCardPress, siderCardClass } from './sider-card'
import { useSiderNavigation } from './sider-navigation'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const ConfigViewer = lazy(() => import('./config-viewer'))

interface Props {
  iconOnly?: boolean
}

const ProfileCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { iconOnly } = props
  const { profileDisplayDate = 'expire', disableAnimations = false } = appConfig || {}
  const { selected: match, goToPage } = useSiderNavigation('/profiles')
  const [updating, setUpdating] = useState(false)
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false)
  const { profileConfig, addProfileItem } = useProfileConfig()
  const { current, items } = profileConfig ?? {}
  const info = items?.find((item) => item && item.id === current) ?? {
    id: 'default',
    type: 'local',
    name: t('sider.cards.emptyProfile')
  }

  const extra = info?.extra
  const usage = (extra?.upload ?? 0) + (extra?.download ?? 0)
  const total = extra?.total ?? 0

  if (iconOnly) {
    return (
      <div className="col-span-2 flex justify-center">
        <Tooltip content={t('sider.cards.profiles')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goToPage}
          >
            <TiFolder className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="col-span-2 profile-card">
      {showRuntimeConfig && (
        <Suspense fallback={null}>
          <ConfigViewer onClose={() => setShowRuntimeConfig(false)} />
        </Suspense>
      )}
      <Card
        as="div"
        fullWidth
        isPressable
        disableAnimation
        onPointerDown={(event) => handleSiderCardPointerDown(event, goToPage)}
        onPress={(event) => handleSiderCardPress(event, goToPage)}
        className={siderCardClass(match, disableAnimations)}
      >
        <CardBody className="pb-1">
          <div className="flex justify-between h-[32px]">
            <h3
              title={info?.name}
              className={`text-ellipsis whitespace-nowrap overflow-hidden text-md font-bold leading-[32px] ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {info?.name}
            </h3>
            <div className="flex">
              <Button
                isIconOnly
                size="sm"
                title={t('sider.cards.viewRuntimeConfig')}
                variant="light"
                color="default"
                onPress={() => {
                  setShowRuntimeConfig(true)
                }}
              >
                <CgLoadbarDoc
                  className={`text-[24px] ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                />
              </Button>
              {info.type === 'remote' && (
                <Tooltip placement="left" content={dayjs(info.updated).fromNow()}>
                  <Button
                    isIconOnly
                    size="sm"
                    disabled={updating}
                    variant="light"
                    color="default"
                    onPress={async () => {
                      setUpdating(true)
                      await addProfileItem(info)
                      setUpdating(false)
                    }}
                  >
                    <IoMdRefresh
                      className={`text-[24px] ${match ? 'text-primary-foreground' : 'text-foreground'} ${updating ? 'animate-spin' : ''}`}
                    />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
          {info.type === 'remote' && extra && (
            <div
              className={`mt-2 flex justify-between ${match ? 'text-primary-foreground' : 'text-foreground'} `}
            >
              <small>{`${calcTraffic(usage)}/${calcTraffic(total)}`}</small>
              {profileDisplayDate === 'expire' ? (
                <Button
                  size="sm"
                  variant="light"
                  className={`h-[20px] p-1 m-0 ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                  onPress={async () => {
                    await patchAppConfig({ profileDisplayDate: 'update' })
                  }}
                >
                  {extra.expire
                    ? dayjs.unix(extra.expire).format('YYYY-MM-DD')
                    : t('sider.cards.neverExpire')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="light"
                  className={`h-[20px] p-1 m-0 ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                  onPress={async () => {
                    await patchAppConfig({ profileDisplayDate: 'expire' })
                  }}
                >
                  {dayjs(info.updated).fromNow()}
                </Button>
              )}
            </div>
          )}
        </CardBody>
        <CardFooter className="pt-0">
          {info.type === 'remote' && !extra && (
            <div
              className={`w-full mt-2 flex justify-between ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              <Chip
                size="sm"
                variant="bordered"
                className={`${match ? 'text-primary-foreground border-primary-foreground' : 'border-primary text-primary'}`}
              >
                {t('sider.cards.remote')}
              </Chip>
              <small>{dayjs(info.updated).fromNow()}</small>
            </div>
          )}
          {info.type === 'local' && (
            <div
              className={`mt-2 flex justify-between ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              <Chip
                size="sm"
                variant="bordered"
                className={`${match ? 'text-primary-foreground border-primary-foreground' : 'border-primary text-primary'}`}
              >
                {t('sider.cards.local')}
              </Chip>
            </div>
          )}
          {extra && (
            <Progress
              className="w-full"
              aria-label={t('sider.cards.trafficUsage')}
              classNames={{ indicator: match ? 'bg-primary-foreground' : 'bg-foreground' }}
              value={calcPercent(extra?.upload, extra?.download, extra?.total)}
            />
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

export default ProfileCard
