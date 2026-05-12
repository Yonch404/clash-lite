import { Button, Select, SelectItem } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { toast } from '@renderer/components/base/toast'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { mihomoUpgrade, mihomoVersion, restartCore } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import PubSub from 'pubsub-js'
import React, { useMemo, useState } from 'react'
import { IoMdCloudDownload } from 'react-icons/io'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

const LOG_LEVELS: LogLevel[] = ['silent', 'error', 'warning', 'info', 'debug']
const DEFAULT_LOG_RETENTION_DAYS = [1, 3, 7, 14, 30]

const Mihomo: React.FC = () => {
  const { t } = useTranslation()
  const [upgrading, setUpgrading] = useState(false)
  const { appConfig, patchAppConfig } = useAppConfig()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { data: mihomoCoreVersion, mutate: mutateMihomoCoreVersion } = useSWR(
    'mihomoVersion',
    mihomoVersion
  )
  const logLevel = controledMihomoConfig?.['log-level'] ?? 'warning'
  const maxLogDays = appConfig?.maxLogDays ?? 3
  const logRetentionDayOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_LOG_RETENTION_DAYS, maxLogDays])).sort((a, b) => a - b),
    [maxLogDays]
  )

  return (
    <BasePage title={t('mihomo.title')}>
      <SettingCard>
        <SettingItem title="Mihomo" divider>
          <div className="flex items-center gap-3">
            <span className="text-foreground-500 text-sm">{mihomoCoreVersion?.version || '-'}</span>
            <Button
              size="sm"
              color="primary"
              isLoading={upgrading}
              startContent={!upgrading && <IoMdCloudDownload className="text-lg" />}
              onPress={async () => {
                try {
                  setUpgrading(true)
                  await mihomoUpgrade()
                  await restartCore()
                  void mutateMihomoCoreVersion()
                  setTimeout(() => {
                    PubSub.publish('mihomo-core-changed')
                  }, 2000)
                  if (platform !== 'win32') {
                    new Notification(t('mihomo.coreAuthLost'), {
                      body: t('mihomo.coreUpgradeSuccess')
                    })
                  } else {
                    new Notification(t('mihomo.coreUpgradeSuccess'))
                  }
                } catch (e) {
                  if (typeof e === 'string' && e.includes('already using latest version')) {
                    new Notification(t('mihomo.alreadyLatestVersion'))
                  } else {
                    toast.error(String(e))
                  }
                } finally {
                  setUpgrading(false)
                }
              }}
            >
              {t('mihomo.upgradeCore')}
            </Button>
          </div>
        </SettingItem>
        <SettingItem title={t('mihomo.logLevel')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            disableAnimation
            className="w-37.5"
            size="sm"
            selectedKeys={new Set([logLevel])}
            aria-label={t('mihomo.selectLogLevel')}
            disallowEmptySelection
            onSelectionChange={async (keys) => {
              const nextLevel = keys.currentKey as LogLevel | undefined
              if (!nextLevel || nextLevel === logLevel) return
              try {
                await patchControledMihomoConfig({ 'log-level': nextLevel })
              } catch (e) {
                toast.error(String(e))
              }
            }}
          >
            {LOG_LEVELS.map((level) => (
              <SelectItem key={level}>{t(`mihomo.${level}`)}</SelectItem>
            ))}
          </Select>
        </SettingItem>
        <SettingItem title={t('mihomo.logRetentionDays')}>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            disableAnimation
            className="w-37.5"
            size="sm"
            selectedKeys={new Set([String(maxLogDays)])}
            aria-label={t('mihomo.logRetentionDays')}
            disallowEmptySelection
            onSelectionChange={async (keys) => {
              const nextDays = Number(keys.currentKey)
              if (!Number.isFinite(nextDays) || nextDays === maxLogDays) return
              await patchAppConfig({ maxLogDays: nextDays })
            }}
          >
            {logRetentionDayOptions.map((days) => (
              <SelectItem key={String(days)}>
                {t('mihomo.logRetentionDaysOption', { days })}
              </SelectItem>
            ))}
          </Select>
        </SettingItem>
      </SettingCard>
    </BasePage>
  )
}

export default Mihomo
