import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { QRCodeSVG } from 'qrcode.react'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  url: string
  onClose: () => void
}

const QrCodeModal: React.FC<Props> = (props) => {
  const { t } = useTranslation()

  return (
    <Modal isOpen onOpenChange={(open) => !open && props.onClose()} size="xs">
      <ModalContent>
        <ModalHeader>{t('profiles.qrCode.title')}</ModalHeader>
        <ModalBody className="flex items-center pb-6">
          <QRCodeSVG value={props.url} size={220} level="M" />
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default QrCodeModal
