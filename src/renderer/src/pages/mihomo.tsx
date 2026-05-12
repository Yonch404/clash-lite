import { Button } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { toast } from '@renderer/components/base/toast'
import { mihomoUpgrade, mihomoVersion, restartCore } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import PubSub from 'pubsub-js'
import React, { useState } from 'react'
import { IoMdCloudDownload } from 'react-icons/io'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

const Mihomo: React.FC = () => {
  const { t } = useTranslation()
  const [upgrading, setUpgrading] = useState(false)
  const { data: mihomoCoreVersion, mutate: mutateMihomoCoreVersion } = useSWR(
    'mihomoVersion',
    mihomoVersion
  )

  return (
    <BasePage title={t('mihomo.title')}>
      <SettingCard>
        <SettingItem title="Mihomo">
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
      </SettingCard>
    </BasePage>
  )
}

export default Mihomo
