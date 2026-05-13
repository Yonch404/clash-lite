import { Tabs, Tab } from '@heroui/react'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { mihomoCloseAllConnections, patchMihomoConfig, updateTrayIcon } from '@renderer/utils/ipc'
import { Key } from 'react'
import { useTranslation } from 'react-i18next'

const OutboundModeSwitcher: React.FC = () => {
  const { t } = useTranslation()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { mutate: mutateGroups } = useGroups()
  const { mode } = controledMihomoConfig || {}

  const onChangeMode = async (mode: OutboundMode): Promise<void> => {
    await patchControledMihomoConfig({ mode })
    await patchMihomoConfig({ mode })
    await mihomoCloseAllConnections()
    mutateGroups()
    window.electron.ipcRenderer.send('updateTrayMenu')
    await updateTrayIcon()
  }
  if (!mode) return null
  return (
    <Tabs
      fullWidth
      color="primary"
      selectedKey={mode}
      classNames={{
        tabList: 'bg-content1 shadow-medium outbound-mode-card',
        tab: 'h-7 py-0',
        tabContent: 'text-[14px]'
      }}
      onSelectionChange={(key: Key) => onChangeMode(key as OutboundMode)}
    >
      <Tab
        className={`${mode === 'rule' ? 'font-bold' : ''}`}
        key="rule"
        title={t('sider.cards.outbound.rule')}
      />
      <Tab
        className={`${mode === 'global' ? 'font-bold' : ''}`}
        key="global"
        title={t('sider.cards.outbound.global')}
      />
      <Tab
        className={`${mode === 'direct' ? 'font-bold' : ''}`}
        key="direct"
        title={t('sider.cards.outbound.direct')}
      />
    </Tabs>
  )
}

export default OutboundModeSwitcher
