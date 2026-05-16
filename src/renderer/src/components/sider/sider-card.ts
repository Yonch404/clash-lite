import type { PressEvent } from '@react-types/shared'
import type { PointerEvent } from 'react'

const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="switch"]'

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return !!target.closest(INTERACTIVE_SELECTOR)
}

const getSiderCard = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null
  }

  const card = target.closest('.sider-card-interactive')
  return card instanceof HTMLElement ? card : null
}

export const siderCardClass = (match: boolean, disableAnimations = false): string => {
  const state = match ? 'sider-card-selected' : ''
  const animation = disableAnimations ? 'sider-card-no-animation' : ''
  return `sider-card-interactive shadow-sm ${state} ${animation} !cursor-default !scale-100 data-[pressed=true]:!scale-100 active:!scale-100 tap-highlight-transparent`
}

export const handleSiderCardPress = (event: PressEvent, onPress: () => void): void => {
  if (isInteractiveTarget(event.target)) return

  const card = getSiderCard(event.target)
  if (card?.dataset.siderPointerNavigated === 'true') {
    return
  }

  onPress()
}

export const handleSiderCardPointerDown = (
  event: PointerEvent<HTMLElement>,
  onPress: () => void
): void => {
  if (event.button !== 0 || isInteractiveTarget(event.target)) return

  const card = getSiderCard(event.target)
  if (!card || card.dataset.siderPointerNavigated === 'true') return

  card.dataset.siderPointerNavigated = 'true'
  onPress()

  window.setTimeout(() => {
    delete card.dataset.siderPointerNavigated
  }, 400)
}
