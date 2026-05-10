import { Card, CardBody, CardHeader } from '@heroui/react'
import React from 'react'

const colorMap = {
  error: 'danger',
  warning: 'warning',
  info: 'primary',
  debug: 'default'
}
const LogItem: React.FC<IMihomoLogInfo & { index: number }> = (props) => {
  const { type, payload, time, index, source } = props
  return (
    <div className={`px-2 pb-2 ${index === 0 ? 'pt-2' : ''}`}>
      <Card>
        <CardHeader className="pb-0 pt-1">
          <div className={`mr-2 text-lg font-bold text-${colorMap[type]}`}>
            {type.toUpperCase()}
          </div>
          {source && (
            <div className="mr-2 rounded-md bg-content2 px-1.5 py-0.5 text-xs font-medium text-foreground-500">
              {source}
            </div>
          )}
          <small className="text-foreground-500">{time}</small>
        </CardHeader>
        <CardBody className="select-text pt-0 text-sm">{payload}</CardBody>
      </Card>
    </div>
  )
}

export default React.memo(LogItem)
