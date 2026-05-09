import {
  cn,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Switch
} from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import React, { useState } from 'react'
import { mihomoHotReloadConfig, addProfileUpdater } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import { isValidCron } from 'cron-validator'
import SettingItem from '../base/base-setting-item'

interface Props {
  item: IProfileItem
  updateProfileItem: (item: IProfileItem) => Promise<void>
  onClose: () => void
}
const EditInfoModal: React.FC<Props> = (props) => {
  const { item, updateProfileItem, onClose } = props
  const [values, setValues] = useState({
    ...item,
    autoUpdate: item.autoUpdate ?? item.type === 'remote'
  })
  const inputWidth = 'w-[400px] md:w-[400px] lg:w-[600px] xl:w-[800px]'
  const { t } = useTranslation()

  const onSave = async (): Promise<void> => {
    try {
      const updatedItem: IProfileItem = { ...values }
      await updateProfileItem(updatedItem)
      await addProfileUpdater(updatedItem)
      await mihomoHotReloadConfig()
      onClose()
    } catch (e) {
      toast.error(String(e))
    }
  }

  return (
    <Modal
      backdrop="blur"
      size="5xl"
      classNames={{
        backdrop: 'top-[48px]',
        base: 'w-[600px] md:w-[600px] lg:w-[800px] xl:w-[1024px]'
      }}
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex app-drag">{t('profiles.editInfo.title')}</ModalHeader>
        <ModalBody>
          <SettingItem title={t('profiles.editInfo.name')}>
            <Input
              size="sm"
              className={cn(inputWidth)}
              value={values.name}
              onValueChange={(v) => {
                setValues({ ...values, name: v })
              }}
            />
          </SettingItem>
          {values.type === 'remote' && (
            <>
              <SettingItem title={t('profiles.editInfo.url')}>
                <Input
                  size="sm"
                  className={cn(inputWidth)}
                  value={values.url}
                  onValueChange={(v) => {
                    setValues({ ...values, url: v })
                  }}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.authToken')}>
                <Input
                  size="sm"
                  type="password"
                  className={cn(inputWidth)}
                  value={values.authToken || ''}
                  onValueChange={(v) => {
                    setValues({ ...values, authToken: v })
                  }}
                  placeholder={t('profiles.editInfo.authTokenPlaceholder')}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.userAgent')}>
                <Input
                  size="sm"
                  className={cn(inputWidth)}
                  value={values.userAgent || ''}
                  onValueChange={(v) => {
                    setValues({ ...values, userAgent: v || undefined })
                  }}
                  placeholder={t('profiles.editInfo.userAgentPlaceholder')}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.useProxy')}>
                <Switch
                  size="sm"
                  isSelected={values.useProxy ?? false}
                  onValueChange={(v) => {
                    setValues({ ...values, useProxy: v })
                  }}
                />
              </SettingItem>
              <SettingItem title={t('profiles.editInfo.autoUpdate')}>
                <Switch
                  size="sm"
                  isSelected={values.autoUpdate}
                  onValueChange={(v) => {
                    setValues({ ...values, autoUpdate: v })
                  }}
                />
              </SettingItem>
              {values.autoUpdate && (
                <>
                  <SettingItem title={t('profiles.editInfo.interval')}>
                    <div className="flex flex-col gap-2">
                      <Input
                        size="sm"
                        type="text"
                        className={cn(
                          inputWidth,
                          // 不合法
                          typeof values.interval === 'string' &&
                          !/^\d+$/.test(values.interval) &&
                          !isValidCron(values.interval, { seconds: false }) &&
                          'border-red-500'
                        )}
                        value={values.interval?.toString() ?? ''}
                        onValueChange={(v) => {
                          // 输入限制
                          if (/^[\d\s*\-,/]*$/.test(v)) {
                            // minute interval
                            if (/^\d+$/.test(v)) {
                              setValues({ ...values, interval: parseInt(v, 10) || 0 })
                              return
                            }
                            // cron expression
                            try {
                              setValues({ ...values, interval: v })
                            } catch {
                              // ignore
                            }
                          }
                        }}
                        placeholder={t('profiles.editInfo.intervalPlaceholder')}
                      />

                      {/* 动态提示信息 */}
                      <div
                        className="text-xs"
                        style={{
                          color:
                            typeof values.interval === 'string' &&
                              !/^\d+$/.test(values.interval) &&
                              !isValidCron(values.interval, { seconds: false })
                              ? '#ef4444'
                              : '#6b7280'
                        }}
                      >
                        {typeof values.interval === 'number'
                          ? t('profiles.editInfo.intervalMinutes')
                          : /^\d+$/.test(values.interval?.toString() || '')
                            ? t('profiles.editInfo.intervalMinutes')
                            : isValidCron(values.interval?.toString() || '', { seconds: false })
                              ? t('profiles.editInfo.intervalCron')
                              : t('profiles.editInfo.intervalHint')}
                      </div>
                    </div>
                  </SettingItem>
                  <SettingItem title={t('profiles.editInfo.fixedInterval')}>
                    <Switch
                      size="sm"
                      isSelected={values.allowFixedInterval ?? false}
                      onValueChange={(v) => {
                        setValues({ ...values, allowFixedInterval: v })
                      }}
                    />
                  </SettingItem>
                </>
              )}
            </>
          )}
          <SettingItem title={t('profiles.editInfo.updateTimeout')}>
            <Input
              size="sm"
              type="text"
              className={cn(inputWidth)}
              value={values.updateTimeout?.toString() ?? ''}
              onValueChange={(v) => {
                if (v === '') {
                  setValues({ ...values, updateTimeout: undefined })
                  return
                }
                if (/^\d+$/.test(v)) {
                  setValues({ ...values, updateTimeout: parseInt(v, 10) })
                }
              }}
              placeholder={t('profiles.editInfo.updateTimeoutPlaceholder')}
            />
          </SettingItem>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" color="primary" onPress={onSave}>
            {t('common.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditInfoModal
