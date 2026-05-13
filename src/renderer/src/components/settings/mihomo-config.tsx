import React, { useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import { Button, Input, Select, SelectItem, Switch, Tooltip } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import debounce from '@renderer/utils/debounce'
import { restartCore } from '@renderer/utils/ipc'
import { IoIosHelpCircle } from 'react-icons/io'
import { platform, version } from '@renderer/utils/init'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'

const MihomoConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    diffWorkDir = false,
    delayTestConcurrency,
    delayTestTimeout,
    delayTestUrl,
    userAgent,
    subscriptionTimeout = 30000,
    mihomoCpuPriority = 'PRIORITY_NORMAL',
    proxyCols = 'auto'
  } = appConfig || {}
  const [url, setUrl] = useState(delayTestUrl)
  const setUrlDebounce = debounce((v: string) => {
    patchAppConfig({ delayTestUrl: v })
  }, 500)
  const [ua, setUa] = useState(userAgent)
  const setUaDebounce = debounce((v: string) => {
    patchAppConfig({ userAgent: v })
  }, 500)
  return (
    <SettingCard>
      <SettingItem title={t('mihomo.userAgent')} divider>
        <Input
          size="sm"
          className="w-[60%]"
          value={ua}
          placeholder={t('mihomo.userAgentPlaceholder', { version })}
          onValueChange={(v) => {
            setUa(v)
            setUaDebounce(v)
          }}
        ></Input>
      </SettingItem>
      <SettingItem title={t('settings.subscriptionTimeout')} divider>
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            className="w-25"
            type="number"
            value={(subscriptionTimeout / 1000)?.toString()}
            onValueChange={async (v: string) => {
              const num = parseInt(v)
              await patchAppConfig({ subscriptionTimeout: num * 1000 })
            }}
            onBlur={async (e) => {
              let num = parseInt(e.target.value)
              if (isNaN(num)) num = 30
              if (num < 30) num = 30
              await patchAppConfig({ subscriptionTimeout: num * 1000 })
            }}
          />
          <span className="text-default-500">{t('common.seconds')}</span>
        </div>
      </SettingItem>
      <SettingItem title={t('mihomo.delayTest.url')} divider>
        <Input
          size="sm"
          className="w-[60%]"
          value={url}
          placeholder={t('mihomo.delayTest.urlPlaceholder')}
          onValueChange={(v) => {
            setUrl(v)
            setUrlDebounce(v)
          }}
        ></Input>
      </SettingItem>
      <SettingItem title={t('mihomo.delayTest.concurrency')} divider>
        <Input
          type="number"
          size="sm"
          className="w-[60%]"
          value={delayTestConcurrency?.toString()}
          placeholder={t('mihomo.delayTest.concurrencyPlaceholder')}
          onValueChange={(v) => {
            patchAppConfig({ delayTestConcurrency: parseInt(v) })
          }}
        />
      </SettingItem>
      <SettingItem title={t('mihomo.delayTest.timeout')} divider>
        <Input
          type="number"
          size="sm"
          className="w-[60%]"
          value={delayTestTimeout?.toString()}
          placeholder={t('mihomo.delayTest.timeoutPlaceholder')}
          onValueChange={(v) => {
            patchAppConfig({ delayTestTimeout: parseInt(v) })
          }}
        />
      </SettingItem>
      <SettingItem title={t('mihomo.proxyColumns.title')} divider>
        <Select
          classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
          disableAnimation
          className="w-37.5"
          size="sm"
          selectedKeys={new Set([proxyCols])}
          aria-label={t('mihomo.proxyColumns.title')}
          disallowEmptySelection={true}
          onSelectionChange={async (v) => {
            await patchAppConfig({ proxyCols: v.currentKey as 'auto' | '1' | '2' | '3' | '4' })
          }}
        >
          <SelectItem key="auto">{t('mihomo.proxyColumns.auto')}</SelectItem>
          <SelectItem key="1">{t('mihomo.proxyColumns.one')}</SelectItem>
          <SelectItem key="2">{t('mihomo.proxyColumns.two')}</SelectItem>
          <SelectItem key="3">{t('mihomo.proxyColumns.three')}</SelectItem>
          <SelectItem key="4">{t('mihomo.proxyColumns.four')}</SelectItem>
        </Select>
      </SettingItem>
      {platform === 'win32' && (
        <SettingItem title={t('mihomo.cpuPriority.title')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            disableAnimation
            className="w-37.5"
            size="sm"
            selectedKeys={new Set([mihomoCpuPriority])}
            aria-label={t('mihomo.cpuPriority.title')}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              try {
                await patchAppConfig({
                  mihomoCpuPriority: v.currentKey as Priority
                })
                await restartCore()
              } catch (e) {
                toast.error(String(e))
              }
            }}
          >
            <SelectItem key="PRIORITY_HIGHEST">{t('mihomo.cpuPriority.realtime')}</SelectItem>
            <SelectItem key="PRIORITY_HIGH">{t('mihomo.cpuPriority.high')}</SelectItem>
            <SelectItem key="PRIORITY_ABOVE_NORMAL">
              {t('mihomo.cpuPriority.aboveNormal')}
            </SelectItem>
            <SelectItem key="PRIORITY_NORMAL">{t('mihomo.cpuPriority.normal')}</SelectItem>
            <SelectItem key="PRIORITY_BELOW_NORMAL">
              {t('mihomo.cpuPriority.belowNormal')}
            </SelectItem>
            <SelectItem key="PRIORITY_LOW">{t('mihomo.cpuPriority.low')}</SelectItem>
          </Select>
        </SettingItem>
      )}
      <SettingItem
        title={t('mihomo.workDir.title')}
        actions={
          <Tooltip content={t('mihomo.workDir.tooltip')}>
            <Button isIconOnly size="sm" variant="light">
              <IoIosHelpCircle className="text-lg" />
            </Button>
          </Tooltip>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={diffWorkDir}
          onValueChange={async (v) => {
            try {
              await patchAppConfig({ diffWorkDir: v })
              await restartCore()
            } catch (e) {
              toast.error(String(e))
            }
          }}
        />
      </SettingItem>
    </SettingCard>
  )
}

export default MihomoConfig
