import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'
import React, { useEffect, useState } from 'react'
import { getProfileStr, setProfileStr } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import { BaseEditor } from '../base/base-editor'

interface Props {
  id: string
  onClose: () => void
}

const EditFileModal: React.FC<Props> = (props) => {
  const { id, onClose } = props
  const [currData, setCurrData] = useState('')
  const { t } = useTranslation()

  useEffect(() => {
    const loadContent = async (): Promise<void> => {
      setCurrData(await getProfileStr(id))
    }
    loadContent()
  }, [id])

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      size="5xl"
      hideCloseButton
      disableAnimation
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex pb-0 app-drag">
          <div className="flex justify-start">
            <div className="flex items-center">{t('profiles.editFile.title')}</div>
          </div>
        </ModalHeader>
        <ModalBody className="h-full">
          <BaseEditor language="yaml" value={currData} onChange={(value) => setCurrData(value)} />
        </ModalBody>
        <ModalFooter className="pt-0">
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            color="primary"
            onPress={async () => {
              await setProfileStr(id, currData)
              onClose()
            }}
          >
            {t('common.confirm')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditFileModal
