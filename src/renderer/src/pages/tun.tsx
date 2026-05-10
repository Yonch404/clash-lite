import { Button } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { showErrorSync } from '@renderer/utils/error-display'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import { restartCore, setupFirewall } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

const Tun: React.FC = () => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const canResetFirewall = platform === 'win32' || platform === 'linux'

  return (
    <BasePage title={t('tun.title')}>
      <SettingCard className="tun-settings">
        {canResetFirewall && (
          <SettingItem title={t('tun.firewall.title')}>
            <Button
              size="sm"
              color="primary"
              isLoading={loading}
              onPress={async () => {
                setLoading(true)
                try {
                  await setupFirewall()
                  new Notification(t('tun.notifications.firewallResetSuccess'))
                  await restartCore()
                } catch (e) {
                  showErrorSync(e, t('common.error.firewallSetupFailed'))
                } finally {
                  setLoading(false)
                }
              }}
            >
              {t('tun.firewall.reset')}
            </Button>
          </SettingItem>
        )}
      </SettingCard>
    </BasePage>
  )
}

export default Tun
