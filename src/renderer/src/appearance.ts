import type { Settings } from '@shared/types'
import { getTheme } from '@shared/themes'
import { setFont, setTerminalTheme } from './terminals'

/** Push the theme and font from settings into the page and every terminal. */
export function applyAppearance(settings: Settings): void {
  const theme = getTheme(settings.theme)
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.ui)) {
    root.style.setProperty(`--${key.replace(/[0-9]/, '-$&')}`, value)
  }
  // The terminal palette's blue marks where a dragged project will land.
  root.style.setProperty('--blue', theme.term.normal[4])
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  root.dataset.theme = theme.dark ? 'dark' : 'light'
  setTerminalTheme(theme)
  setFont(settings.fontSize, settings.fontFamily)
  window.api.setChrome(theme.ui.bg, theme.dark)
}
