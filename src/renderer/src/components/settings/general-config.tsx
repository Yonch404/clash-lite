import React, { useState } from 'react'
import { toast } from '@renderer/components/base/toast'
import { Button, Input, Select, SelectItem, Switch, Tab, Tabs, Tooltip } from '@heroui/react'
import { BiCopy } from 'react-icons/bi'
import useSWR from 'swr'
import {
  checkAutoRun,
  copyEnv,
  disableAutoRun,
  enableAutoRun,
  relaunchApp,
  startMonitor
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import debounce from '@renderer/utils/debounce'
import { platform } from '@renderer/utils/init'
import { useTheme } from 'next-themes'
import { IoIosHelpCircle } from 'react-icons/io'
import { useTranslation } from 'react-i18next'
import SettingItem from '../base/base-setting-item'
import SettingCard from '../base/base-setting-card'
import BaseConfirmModal from '../base/base-confirm-modal'

const GeneralConfig: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { data: enable = false, mutate: mutateEnable } = useSWR('checkAutoRun', checkAutoRun)
  const { appConfig, patchAppConfig } = useAppConfig()
  const [isRelaunching, setIsRelaunching] = useState(false)
  const [showHardwareAccelConfirm, setShowHardwareAccelConfirm] = useState(false)
  const [pendingHardwareAccelValue, setPendingHardwareAccelValue] = useState(false)
  const { setTheme } = useTheme()
  const {
    silentStart = false,
    useDockIcon = true,
    showTraffic = false,
    disableAnimations = false,
    disableHardwareAcceleration = false,
    useWindowFrame = false,
    autoQuitWithoutCore = false,
    autoQuitWithoutCoreDelay = 60,
    envType = [platform === 'win32' ? 'powershell' : 'bash'],
    autoCheckUpdate,
    appTheme = 'system',
    language = 'zh-CN',
    triggerMainWindowBehavior = 'show'
  } = appConfig || {}

  return (
    <>
      {showHardwareAccelConfirm && (
        <BaseConfirmModal
          isOpen={showHardwareAccelConfirm}
          title={t('settings.hardwareAcceleration.confirm.title')}
          content={t('settings.hardwareAcceleration.confirm.content')}
          onCancel={() => {
            setShowHardwareAccelConfirm(false)
            setPendingHardwareAccelValue(false)
          }}
          onConfirm={async () => {
            setShowHardwareAccelConfirm(false)
            setIsRelaunching(true)
            try {
              await patchAppConfig({ disableHardwareAcceleration: pendingHardwareAccelValue })
              await relaunchApp()
            } catch (e) {
              toast.error(String(e))
              setIsRelaunching(false)
            }
          }}
        />
      )}
      <SettingCard>
        <SettingItem title={t('settings.language')} divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            disableAnimation
            className="w-37.5"
            size="sm"
            selectedKeys={[language]}
            aria-label={t('settings.language')}
            onSelectionChange={async (v) => {
              const newLang = Array.from(v)[0] as 'zh-CN' | 'zh-TW' | 'en-US' | 'ru-RU' | 'fa-IR'
              await patchAppConfig({ language: newLang })
              i18n.changeLanguage(newLang)
            }}
          >
            <SelectItem key="en-US">English</SelectItem>
            <SelectItem key="zh-CN">简体中文</SelectItem>
            <SelectItem key="zh-TW">繁體中文 (台灣)</SelectItem>
            <SelectItem key="ru-RU">Русский</SelectItem>
            <SelectItem key="fa-IR">فارسی</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title={t('settings.autoStart')} divider>
          <Switch
            size="sm"
            isSelected={enable}
            onValueChange={async (v) => {
              try {
                // 检查管理员权限
                const hasAdminPrivileges =
                  await window.electron.ipcRenderer.invoke('checkAdminPrivileges')

                if (!hasAdminPrivileges) {
                  const notification = new Notification(t('settings.autoStart.permissions'))
                  notification.close()
                }

                if (v) {
                  await enableAutoRun()
                } else {
                  await disableAutoRun()
                }
              } catch (e) {
                toast.error(String(e))
              } finally {
                mutateEnable()
              }
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.autoCheckUpdate')} divider>
          <Switch
            size="sm"
            isSelected={autoCheckUpdate}
            onValueChange={(v) => {
              patchAppConfig({ autoCheckUpdate: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.silentStart')} divider>
          <Switch
            size="sm"
            isSelected={silentStart}
            onValueChange={(v) => {
              patchAppConfig({ silentStart: v })
            }}
          />
        </SettingItem>
        <SettingItem
          title={t('settings.autoQuitWithoutCore')}
          actions={
            <Tooltip content={t('settings.autoQuitWithoutCoreTooltip')}>
              <Button isIconOnly size="sm" variant="light">
                <IoIosHelpCircle className="text-lg" />
              </Button>
            </Tooltip>
          }
          divider
        >
          <Switch
            size="sm"
            isSelected={autoQuitWithoutCore}
            onValueChange={(v) => {
              patchAppConfig({ autoQuitWithoutCore: v })
            }}
          />
        </SettingItem>
        {autoQuitWithoutCore && (
          <SettingItem title={t('settings.autoQuitWithoutCoreDelay')} divider>
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                className="w-25"
                type="number"
                value={autoQuitWithoutCoreDelay.toString()}
                onValueChange={async (v: string) => {
                  const num = parseInt(v)
                  await patchAppConfig({ autoQuitWithoutCoreDelay: num })
                }}
                onBlur={async (e) => {
                  let num = parseInt(e.target.value)
                  if (isNaN(num)) num = 5
                  if (num < 5) num = 5
                  await patchAppConfig({ autoQuitWithoutCoreDelay: num })
                }}
              />
              <span className="text-default-500">{t('common.seconds')}</span>
            </div>
          </SettingItem>
        )}
        <SettingItem
          title={t('settings.envType')}
          actions={envType.map((type) => (
            <Button
              key={type}
              title={type}
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => copyEnv(type)}
            >
              <BiCopy className="text-lg" />
            </Button>
          ))}
          divider
        >
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            disableAnimation
            className="w-37.5"
            size="sm"
            selectionMode="multiple"
            selectedKeys={new Set(envType)}
            aria-label={t('settings.envType')}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              try {
                await patchAppConfig({
                  envType: Array.from(v) as ('bash' | 'cmd' | 'powershell' | 'fish' | 'nushell')[]
                })
              } catch (e) {
                toast.error(String(e))
              }
            }}
          >
            <SelectItem key="bash">Bash</SelectItem>
            <SelectItem key="cmd">CMD</SelectItem>
            <SelectItem key="powershell">PowerShell</SelectItem>
            <SelectItem key="fish">Fish</SelectItem>
            <SelectItem key="nushell">Nushell</SelectItem>
          </Select>
        </SettingItem>
        {platform === 'win32' && (
          <SettingItem title={t('settings.showTraffic', { context: 'windows' })} divider>
            <Switch
              size="sm"
              isSelected={showTraffic}
              onValueChange={async (v) => {
                await patchAppConfig({ showTraffic: v })
                await startMonitor()
              }}
            />
          </SettingItem>
        )}
        {platform === 'darwin' && (
          <>
            <SettingItem title={t('settings.showDockIcon')} divider>
              <Switch
                size="sm"
                isSelected={useDockIcon}
                onValueChange={async (v) => {
                  await patchAppConfig({ useDockIcon: v })
                }}
              />
            </SettingItem>
          </>
        )}

        <SettingItem title={t('settings.useWindowFrame')} divider>
          <Switch
            size="sm"
            isSelected={useWindowFrame}
            isDisabled={isRelaunching}
            onValueChange={debounce(async (v) => {
              if (isRelaunching) return
              setIsRelaunching(true)
              try {
                await patchAppConfig({ useWindowFrame: v })
                await relaunchApp()
              } catch (e) {
                toast.error(String(e))
                setIsRelaunching(false)
              }
            }, 1000)}
          />
        </SettingItem>
        <SettingItem title={t('settings.disableAnimations')} divider>
          <Switch
            size="sm"
            isSelected={disableAnimations}
            onValueChange={async (v) => {
              await patchAppConfig({ disableAnimations: v })
            }}
          />
        </SettingItem>
        <SettingItem title={t('settings.backgroundColor')} divider>
          <Tabs
            size="sm"
            color="primary"
            selectedKey={appTheme}
            onSelectionChange={(key) => {
              const nextTheme = key as AppTheme
              setTheme(nextTheme)
              patchAppConfig({ appTheme: nextTheme })
            }}
          >
            <Tab key="system" title={t('settings.backgroundAuto')} />
            <Tab key="dark" title={t('settings.backgroundDark')} />
            <Tab key="light" title={t('settings.backgroundLight')} />
          </Tabs>
        </SettingItem>
        <SettingItem title={t('settings.triggerMainWindowBehavior')} divider>
          <Tabs
            size="sm"
            color="primary"
            selectedKey={triggerMainWindowBehavior}
            onSelectionChange={(key) => {
              patchAppConfig({ triggerMainWindowBehavior: key as 'show' | 'toggle' })
            }}
          >
            <Tab key="show" title={t('settings.triggerMainWindowBehaviorShow')} />
            <Tab key="toggle" title={t('settings.triggerMainWindowBehaviorToggle')} />
          </Tabs>
        </SettingItem>
        <SettingItem
          title={t('settings.disableHardwareAcceleration')}
          actions={
            <Tooltip content={t('settings.disableHardwareAccelerationTooltip')}>
              <Button isIconOnly size="sm" variant="light">
                <IoIosHelpCircle className="text-lg" />
              </Button>
            </Tooltip>
          }
          divider
        >
          <Switch
            size="sm"
            isSelected={disableHardwareAcceleration}
            isDisabled={isRelaunching}
            onValueChange={(v) => {
              if (isRelaunching) return
              setPendingHardwareAccelValue(v)
              setShowHardwareAccelConfirm(true)
            }}
          />
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default GeneralConfig
