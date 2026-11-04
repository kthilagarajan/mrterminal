import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getState, setState, useStore } from './store'

export interface MenuItem {
  label: string
  action: () => void
  disabled?: boolean
  danger?: boolean
  tooltip?: string
  /** A second, smaller choice at the end of the row, e.g. where to run it. */
  aside?: { label: string; action: () => void; tooltip?: string; disabled?: boolean }
}

/** `null` draws a separator. */
export type MenuEntry = MenuItem | null

export interface MenuState {
  x: number
  y: number
  /** Put the menu's right edge at `x` rather than its left. */
  alignRight?: boolean
  items: MenuEntry[]
  /** Called when the menu closes, whichever way. */
  onClose?: () => void
  /** As narrow as its items, with tighter rows: for short lists like the editor picker. */
  compact?: boolean
}

/**
 * Show a menu at a point: the pointer for a right-click, or under the button
 * that opened it. One menu at a time, shared by the sidebar and the tabs
 * (which are plain DOM inside dockview, outside React).
 */
export function openMenu(at: Point, items: MenuEntry[], onClose?: () => void, compact?: boolean): void {
  closeMenu()
  setState({ menu: { ...at, items, onClose, compact } })
}

type Point = Pick<MenuState, 'x' | 'y' | 'alignRight'>

/** Under an element, right edges lined up: where a "..." button's menu goes. */
export function below(element: Element): Point {
  const box = element.getBoundingClientRect()
  return { x: box.right, y: box.bottom + 4, alignRight: true }
}

export function closeMenu(): void {
  const { menu } = getState()
  if (!menu) return
  setState({ menu: null })
  menu.onClose?.()
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Keep it on screen: flip left of / above the point when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return setPosition(null)
    const { width, height } = el.getBoundingClientRect()
    const x = menu.alignRight ? menu.x - width : menu.x
    const left = x + width > window.innerWidth - 8 ? Math.max(8, x - width) : Math.max(8, x)
    const top = menu.y + height > window.innerHeight - 8 ? Math.max(8, menu.y - height) : menu.y
    setPosition({ left, top })
  }, [menu])

  useLayoutEffect(() => {
    if (!menu) return
    const outside = (event: Event): void => {
      if (!ref.current?.contains(event.target as Node)) closeMenu()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('wheel', outside, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('mousedown', outside, true)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu])

  if (!menu) return null
  return (
    <div
      ref={ref}
      className={menu.compact ? 'menu menu-compact' : 'menu'}
      role="menu"
      // Measured first, then placed; hidden for that one frame.
      style={position ? { left: position.left, top: position.top } : { left: menu.x, top: menu.y, visibility: 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.items.map((item, i) => {
        if (!item) return <div key={i} className="menu-sep" />
        const run = (action: () => void) => (event: ReactMouseEvent): void => {
          event.stopPropagation()
          closeMenu()
          action()
        }
        const button = (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? 'menu-item menu-danger' : 'menu-item'}
            data-tooltip={item.tooltip}
            disabled={item.disabled}
            onClick={run(item.action)}
          >
            {item.label}
          </button>
        )
        if (!item.aside) return button
        return (
          <div key={i} className="menu-row">
            {button}
            <button
              role="menuitem"
              className="menu-aside"
              data-tooltip={item.aside.tooltip}
              disabled={item.aside.disabled}
              onClick={run(item.aside.action)}
            >
              {item.aside.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}
