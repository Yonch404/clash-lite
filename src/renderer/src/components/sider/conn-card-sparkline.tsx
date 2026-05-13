import { useEffect, useMemo, useState, type FC } from 'react'

interface Props {
  series: number[]
  selected: boolean
}

interface Point {
  x: number
  y: number
}

function buildSmoothPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`]

  for (let index = 0; index < points.length - 1; index++) {
    const current = points[index]
    const next = points[index + 1]
    const previous = points[index - 1] || current
    const nextAfter = points[index + 2] || next

    const cp1x = current.x + (next.x - previous.x) / 6
    const cp1y = current.y + (next.y - previous.y) / 6
    const cp2x = next.x - (nextAfter.x - current.x) / 6
    const cp2y = next.y - (nextAfter.y - current.y) / 6

    commands.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(
        2
      )}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`
    )
  }

  return commands.join(' ')
}

const ConnCardSparkline: FC<Props> = ({ series, selected }) => {
  const gradientId = `conn-card-gradient-${selected ? 'selected' : 'default'}`
  const targetMax = useMemo(() => Math.max(...series, 1), [series])
  const [displayMax, setDisplayMax] = useState(targetMax)

  useEffect(() => {
    setDisplayMax((current) => {
      const ratio = targetMax > current ? 0.45 : 0.14
      const next = current + (targetMax - current) * ratio
      const shouldSnap = Math.abs(next - targetMax) < Math.max(0.5, targetMax * 0.02)

      return Math.max(1, shouldSnap ? targetMax : next)
    })
  }, [series, targetMax])

  const { linePath, areaPath } = useMemo(() => {
    const step = 100 / Math.max(series.length - 1, 1)
    const points = series.map((value, index) => {
      const x = index * step
      const y = 100 - Math.min(88, (value / displayMax) * 88)
      return { x, y }
    })
    const path = buildSmoothPath(points)

    return {
      linePath: path,
      areaPath: `${path} L 100 100 L 0 100 Z`
    }
  }, [series, displayMax])

  const color = selected ? '6 182 212' : '161 161 170'

  return (
    <svg
      className="h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`rgb(${color})`} stopOpacity="0.72" />
          <stop offset="100%" stopColor={`rgb(${color})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke="transparent" strokeLinecap="round" />
    </svg>
  )
}

export default ConnCardSparkline
