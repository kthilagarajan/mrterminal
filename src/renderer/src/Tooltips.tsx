import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Hint = { element: HTMLElement; text: string }

/** One overlay keeps hints out of the sidebar's scrolling and dockview's clipping. */
export function Tooltips() {
  const [hint, setHint] = useState<Hint | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let target: HTMLElement | null = null
    let timer: number | undefined
    const hide = (): void => {
      window.clearTimeout(timer)
      target = null
      setHint(null)
    }
    const find = (node: EventTarget | null): HTMLElement | null =>
      node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null
    const show = (element: HTMLElement | null, delay: number): void => {
      if (!element || !element.dataset.tooltip) return hide()
      if (element === target) return
      hide()
      target = element
      timer = window.setTimeout(() => {
        if (element.isConnected) setHint({ element, text: element.dataset.tooltip! })
      }, delay)
    }
    const over = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') show(find(event.target), 350)
    }
    const out = (event: PointerEvent): void => {
      if (target && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) hide()
    }
    const focus = (event: FocusEvent): void => show(find(event.target), 0)
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') hide() }
    const scroll = (event: Event): void => {
      // Streaming terminal output must not dismiss a hint elsewhere in the UI.
      if (event.target === document || (event.target instanceof Element && target && event.target.contains(target))) hide()
    }

    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('click', hide, true)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('click', hide, true)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  useLayoutEffect(() => {
    if (!hint || !ref.current) return
    const anchor = hint.element.getBoundingClientRect()
    const box = ref.current.getBoundingClientRect()
    const margin = 8
    const below = anchor.bottom + margin
    const top = below + box.height <= window.innerHeight - margin ? below : anchor.top - box.height - margin
    setPosition({
      left: Math.max(margin, Math.min(anchor.left + (anchor.width - box.width) / 2, window.innerWidth - box.width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - box.height - margin))
    })
    const previous = hint.element.getAttribute('aria-describedby')
    hint.element.setAttribute('aria-describedby', [previous, 'control-tooltip'].filter(Boolean).join(' '))
    return () => {
      if (previous === null) hint.element.removeAttribute('aria-describedby')
      else hint.element.setAttribute('aria-describedby', previous)
    }
  }, [hint])

  return hint && <div ref={ref} id="control-tooltip" role="tooltip" className="tooltip" style={position}>{hint.text}</div>
}
