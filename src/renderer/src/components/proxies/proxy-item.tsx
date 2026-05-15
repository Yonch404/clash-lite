import { Button, Card, CardBody } from '@heroui/react'
import React, { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onProxyDelay: (group: string, proxy: string, url?: string) => Promise<IMihomoDelay>
  proxyDisplayMode: 'simple' | 'full'
  proxy: IMihomoProxy | IMihomoGroup
  group: Pick<IMihomoGroup, 'name' | 'testUrl'>
  onSelect: (group: string, proxy: string) => void
  selected: boolean
  isGroupTesting?: boolean
}

function delayColor(delay: number): 'primary' | 'success' | 'warning' | 'danger' {
  if (delay === -1) return 'primary'
  if (delay === 0) return 'danger'
  if (delay < 500) return 'success'
  return 'warning'
}

function latestDelay(proxy: IMihomoProxy | IMihomoGroup): number {
  return proxy.history.length > 0 ? proxy.history[proxy.history.length - 1].delay : -1
}

const ProxyItemBase: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const {
    proxyDisplayMode,
    group,
    proxy,
    selected,
    onSelect,
    onProxyDelay,
    isGroupTesting = false
  } = props

  const delay = latestDelay(proxy)

  const [loading, setLoading] = useState(false)

  const isLoading = loading || isGroupTesting

  const delayText = useMemo(() => {
    if (delay === -1) return t('proxies.delay.test')
    if (delay === 0) return t('proxies.delay.timeout')
    return delay.toString()
  }, [delay, t])

  const onDelay = useCallback((): void => {
    setLoading(true)
    onProxyDelay(group.name, proxy.name, group.testUrl).finally(() => {
      setLoading(false)
    })
  }, [group.name, group.testUrl, proxy.name, onProxyDelay])

  return (
    <Card
      as="div"
      onPress={() => onSelect(group.name, proxy.name)}
      isPressable
      disableRipple
      fullWidth
      shadow="sm"
      className={`${
        selected
          ? 'bg-primary/30 border-r-2 border-r-primary border-l-2 border-l-primary'
          : 'bg-content2 border-r-2 border-r-transparent border-l-2 border-l-transparent'
      } proxy-node-pressable-card`}
      radius="sm"
    >
      <CardBody className="p-1">
        {proxyDisplayMode === 'full' ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center pl-1">
              <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                <div className="flag-emoji inline" title={proxy.name}>
                  {proxy.name}
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center pl-1">
              <div className="flex gap-1 items-center">
                <div className="text-foreground-400 text-xs bg-default-100 px-1 rounded-md">
                  {proxy.type}
                </div>
                {['tfo', 'udp', 'xudp', 'mptcp', 'smux'].map(
                  (protocol) =>
                    proxy[protocol as keyof IMihomoProxy] && (
                      <div
                        key={protocol}
                        className="text-foreground-400 text-xs bg-default-100 px-1 rounded-md"
                      >
                        {protocol}
                      </div>
                    )
                )}
              </div>
              <Button
                isIconOnly
                title={proxy.type}
                isLoading={isLoading}
                color={delayColor(delay)}
                onPress={onDelay}
                variant="light"
                className="h-full text-sm ml-auto -mt-0.5 px-2 relative w-min whitespace-nowrap"
              >
                <div className="w-full h-full flex items-center justify-end">{delayText}</div>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center pl-1">
            <div className="text-ellipsis overflow-hidden whitespace-nowrap">
              <div className="flag-emoji inline" title={proxy.name}>
                {proxy.name}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                isIconOnly
                title={proxy.type}
                isLoading={isLoading}
                color={delayColor(delay)}
                onPress={onDelay}
                variant="light"
                className="h-full text-sm px-2 relative w-min whitespace-nowrap"
              >
                <div className="w-full h-full flex items-center justify-end">{delayText}</div>
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

const ProxyItem = React.memo(ProxyItemBase, (prevProps, nextProps) => {
  // 必要时重新渲染
  return (
    prevProps.proxy.name === nextProps.proxy.name &&
    prevProps.proxy.type === nextProps.proxy.type &&
    prevProps.proxy.tfo === nextProps.proxy.tfo &&
    prevProps.proxy.udp === nextProps.proxy.udp &&
    prevProps.proxy.xudp === nextProps.proxy.xudp &&
    Boolean((prevProps.proxy as IMihomoProxy).mptcp) ===
      Boolean((nextProps.proxy as IMihomoProxy).mptcp) &&
    Boolean((prevProps.proxy as IMihomoProxy).smux) ===
      Boolean((nextProps.proxy as IMihomoProxy).smux) &&
    latestDelay(prevProps.proxy) === latestDelay(nextProps.proxy) &&
    prevProps.group.name === nextProps.group.name &&
    prevProps.group.testUrl === nextProps.group.testUrl &&
    prevProps.selected === nextProps.selected &&
    prevProps.proxyDisplayMode === nextProps.proxyDisplayMode &&
    prevProps.isGroupTesting === nextProps.isGroupTesting
  )
})

ProxyItem.displayName = 'ProxyItem'

export default ProxyItem
