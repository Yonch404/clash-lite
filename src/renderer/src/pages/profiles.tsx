import {
  Button,
  Checkbox,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Tooltip
} from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { toast } from '@renderer/components/base/toast'
import ProfileItem from '@renderer/components/profiles/profile-item'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { getFilePath, readTextFile } from '@renderer/utils/ipc'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MdContentPaste, MdUnfoldMore, MdUnfoldLess } from 'react-icons/md'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { FaPlus } from 'react-icons/fa6'
import { IoMdRefresh } from 'react-icons/io'
import { useTranslation } from 'react-i18next'

const Profiles: React.FC = () => {
  const { t } = useTranslation()
  const {
    profileConfig,
    setProfileConfig,
    addProfileItem,
    updateProfileItem,
    removeProfileItem,
    changeCurrentProfile,
    mutateProfileConfig
  } = useProfileConfig()
  const { current, items = [] } = profileConfig || {}
  const [sortedItems, setSortedItems] = useState(items)
  const [useProxy, setUseProxy] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [userAgent, setUserAgent] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [importing, setImporting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const [url, setUrl] = useState('')
  const [, setNow] = useState(new Date())
  const isUrlEmpty = url.trim() === ''
  const sensors = useSensors(useSensor(PointerSensor))
  const handleImport = async (): Promise<void> => {
    setImporting(true)
    await addProfileItem({
      name: '',
      type: 'remote',
      url,
      useProxy,
      authToken: authToken || undefined,
      userAgent: userAgent || undefined
    })
    setUrl('')
    setAuthToken('')
    setUserAgent('')
    setImporting(false)
  }
  const pageRef = useRef<HTMLDivElement>(null)

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    if (over) {
      if (active.id !== over.id) {
        const newOrder = sortedItems.slice()
        const activeIndex = newOrder.findIndex((item) => item.id === active.id)
        const overIndex = newOrder.findIndex((item) => item.id === over.id)
        const [movedItem] = newOrder.splice(activeIndex, 1)
        newOrder.splice(overIndex, 0, movedItem)
        setSortedItems(newOrder)
        await setProfileConfig({ current, items: newOrder })
      }
    }
  }

  const handleImportRef = useRef(handleImport)
  handleImportRef.current = handleImport

  const addProfileItemRef = useRef(addProfileItem)
  addProfileItemRef.current = addProfileItem

  const tRef = useRef(t)
  tRef.current = t

  const handleInputKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.currentTarget.value.trim() === '') return
    handleImportRef.current()
  }, [])

  useEffect(() => {
    const element = pageRef.current
    if (!element) return

    const handleDragOver = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setFileOver(true)
    }

    const handleDragLeave = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setFileOver(false)
    }

    const handleDrop = async (event: DragEvent): Promise<void> => {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer?.files) {
        const file = event.dataTransfer.files[0]
        if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
          try {
            const path = window.api.webUtils.getPathForFile(file)
            const content = await readTextFile(path)
            await addProfileItemRef.current({ name: file.name, type: 'local', file: content })
          } catch (e) {
            toast.error(String(e))
          }
        } else {
          toast.warning(tRef.current('profiles.error.unsupportedFileType'))
        }
      }
      setFileOver(false)
    }

    element.addEventListener('dragover', handleDragOver)
    element.addEventListener('dragleave', handleDragLeave)
    element.addEventListener('drop', handleDrop)

    return (): void => {
      element.removeEventListener('dragover', handleDragOver)
      element.removeEventListener('dragleave', handleDragLeave)
      element.removeEventListener('drop', handleDrop)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setSortedItems(items)
  }, [items])

  return (
    <BasePage
      ref={pageRef}
      title={t('profiles.title')}
      header={
        <Button
          size="sm"
          title={t('profiles.updateAll')}
          className="app-nodrag"
          variant="light"
          isIconOnly
          onPress={async () => {
            setUpdating(true)
            for (const item of items) {
              if (item.id === current) continue
              if (item.type !== 'remote') continue
              await addProfileItem(item)
            }
            const currentItem = items.find((item) => item.id === current)
            if (currentItem && currentItem.type === 'remote') {
              await addProfileItem(currentItem)
            }
            setUpdating(false)
          }}
        >
          <IoMdRefresh className={`text-lg ${updating ? 'animate-spin' : ''}`} />
        </Button>
      }
    >
      <div className="sticky profiles-sticky top-0 z-40 bg-background">
        <div className="flex flex-col gap-2 p-2">
          <div className="flex gap-2">
            <Input
              size="sm"
              placeholder={t('profiles.input.placeholder')}
              value={url}
              onValueChange={setUrl}
              onKeyUp={handleInputKeyUp}
              className="flex-1"
              endContent={
                <>
                  <Button
                    size="md"
                    isIconOnly
                    variant="light"
                    onPress={() => {
                      navigator.clipboard.readText().then((text) => {
                        setUrl(text)
                      })
                    }}
                    className="mr-2"
                  >
                    <MdContentPaste className="text-lg" />
                  </Button>
                  <Checkbox
                    className="whitespace-nowrap"
                    checked={useProxy}
                    onValueChange={setUseProxy}
                  >
                    {t('profiles.useProxy')}
                  </Checkbox>
                </>
              }
            />

            <Tooltip content={t('profiles.editInfo.authToken')} placement="bottom">
              <Button
                size="sm"
                variant={showAdvanced ? 'solid' : 'light'}
                isIconOnly
                onPress={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? (
                  <MdUnfoldLess className="text-lg" />
                ) : (
                  <MdUnfoldMore className="text-lg" />
                )}
              </Button>
            </Tooltip>
            <Button
              size="sm"
              color="primary"
              isDisabled={isUrlEmpty}
              isLoading={importing}
              onPress={handleImport}
            >
              {t('profiles.import')}
            </Button>
            <Dropdown>
              <DropdownTrigger>
                <Button className="new-profile" size="sm" isIconOnly color="primary">
                  <FaPlus />
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                onAction={async (key) => {
                  if (key === 'open') {
                    try {
                      const files = await getFilePath(['yml', 'yaml'])
                      if (files?.length) {
                        const content = await readTextFile(files[0])
                        const fileName = files[0].split('/').pop()?.split('\\').pop()
                        await addProfileItem({ name: fileName, type: 'local', file: content })
                      }
                    } catch (e) {
                      toast.error(String(e))
                    }
                  } else if (key === 'new') {
                    await addProfileItem({
                      name: t('profiles.newProfile'),
                      type: 'local',
                      file: 'proxies: []\nproxy-groups: []\nrules: []'
                    })
                  }
                }}
              >
                <DropdownItem key="open">{t('profiles.open')}</DropdownItem>
                <DropdownItem key="new">{t('profiles.new')}</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
          {showAdvanced && (
            <div className="flex gap-2">
              <Input
                size="sm"
                type="password"
                placeholder={t('profiles.editInfo.authTokenPlaceholder')}
                value={authToken}
                onValueChange={setAuthToken}
                onKeyUp={handleInputKeyUp}
                className="flex-1"
              />
              <Input
                size="sm"
                placeholder={t('profiles.editInfo.userAgentPlaceholder')}
                value={userAgent}
                onValueChange={setUserAgent}
                onKeyUp={handleInputKeyUp}
                className="flex-1"
              />
            </div>
          )}
        </div>
        <Divider />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div
          className={`${fileOver ? 'blur-sm' : ''} grid sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 m-2`}
        >
          <SortableContext
            items={sortedItems.map((item) => {
              return item.id
            })}
          >
            {sortedItems.map((item) => (
              <ProfileItem
                key={item.id}
                isCurrent={item.id === current}
                addProfileItem={addProfileItem}
                removeProfileItem={removeProfileItem}
                mutateProfileConfig={mutateProfileConfig}
                updateProfileItem={updateProfileItem}
                info={item}
                onPress={async () => {
                  await changeCurrentProfile(item.id)
                }}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>
    </BasePage>
  )
}

export default Profiles
