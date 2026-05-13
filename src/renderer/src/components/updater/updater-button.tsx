import { Button } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { checkUpdate } from '@renderer/utils/ipc'
import React, { lazy, Suspense, useState } from 'react'
import useSWR from 'swr'
import { MdNewReleases } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

const UpdaterModal = lazy(() => import('./updater-modal'))

interface Props {
  iconOnly?: boolean
}

const UpdaterButton: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { autoCheckUpdate } = appConfig || {}
  const [openModal, setOpenModal] = useState(false)
  const { data: latest } = useSWR(
    autoCheckUpdate ? 'checkUpdate' : undefined,
    autoCheckUpdate ? checkUpdate : (): undefined => {},
    {
      refreshInterval: 1000 * 60 * 10
    }
  )
  if (!latest) return null

  return (
    <>
      {openModal && (
        <Suspense fallback={null}>
          <UpdaterModal
            version={latest.version}
            changelog={latest.changelog}
            onClose={() => {
              setOpenModal(false)
            }}
          />
        </Suspense>
      )}
      {iconOnly ? (
        <Button
          isIconOnly
          variant="flat"
          className={`fixed rounded-full app-nodrag`}
          color="danger"
          size="md"
          onPress={() => {
            setOpenModal(true)
          }}
        >
          <MdNewReleases className="text-[35px]" />
        </Button>
      ) : (
        <Button
          className="app-nodrag h-7 min-w-0 px-2.5 text-sm font-semibold leading-none"
          color="danger"
          size="sm"
          onPress={() => {
            setOpenModal(true)
          }}
        >
          <span className="relative -top-px leading-none">{t('common.updater.update')}</span>
        </Button>
      )}
    </>
  )
}

export default UpdaterButton
