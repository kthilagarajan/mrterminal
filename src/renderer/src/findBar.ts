import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { getTheme } from '@shared/themes'
import { matchesKeys } from '@shared/shortcuts'
import { icons } from './icons'
import { getState } from './store'

export interface FindBar {
  /** Show the bar (or select its text if it is showing) with the terminal's selection as the query. */
  open(): void
  dispose(): void
}

function searchOptions(): ISearchOptions {
  const theme = getTheme(getState().config?.settings.theme)
  return {
    decorations: {
      matchBackground: theme.term.selection,
      matchOverviewRuler: theme.ui.muted,
      activeMatchBackground: theme.term.selection,
      activeMatchBorder: theme.ui.accent,
      activeMatchColorOverviewRuler: theme.ui.accent
    }
  }
}

function iconButton(icon: keyof typeof icons, label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'icon-btn'
  el.dataset.tooltip = label
  el.setAttribute('aria-label', label)
  el.innerHTML = icons[icon]
  // Keep focus in the field, and keep dockview from starting a drag.
  el.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  el.addEventListener('click', onClick)
  return el
}

/**
 * Cmd+F (Ctrl+Shift+F elsewhere): a small search field over the top right of
 * a terminal. Enter finds the next match, Shift+Enter the one before, Escape
 * closes it and gives the keyboard back to the shell.
 */
export function createFindBar(term: Terminal, host: HTMLElement): FindBar {
  const search = new SearchAddon()
  term.loadAddon(search)

  const bar = document.createElement('div')
  bar.className = 'find-bar'
  bar.hidden = true
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = 'Find'
  input.spellcheck = false
  input.setAttribute('aria-label', 'Find in terminal')
  const count = document.createElement('span')
  count.className = 'find-count'

  const mac = window.api.platform === 'darwin'
  const find = (forward: boolean): void => {
    if (!input.value) {
      search.clearDecorations()
      count.textContent = ''
      return
    }
    const found = forward ? search.findNext(input.value, searchOptions()) : search.findPrevious(input.value, searchOptions())
    bar.classList.toggle('find-none', !found)
  }
  const close = (): void => {
    bar.hidden = true
    search.clearDecorations()
    term.clearSelection()
    term.focus()
  }

  search.onDidChangeResults(({ resultIndex, resultCount }) => {
    if (!input.value) count.textContent = ''
    else if (resultCount === 0) count.textContent = 'No results'
    else if (resultIndex < 0) count.textContent = `${resultCount}+`
    else count.textContent = `${resultIndex + 1} of ${resultCount}`
  })

  input.addEventListener('input', () => {
    // Search from the top of the current match as the query grows.
    const found = search.findNext(input.value, { ...searchOptions(), incremental: true })
    bar.classList.toggle('find-none', !!input.value && !found)
    if (!input.value) {
      search.clearDecorations()
      count.textContent = ''
    }
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      return close()
    }
    const next = mac ? 'Cmd+G' : 'Ctrl+G'
    if (event.key === 'Enter' || matchesKeys(next, event) || matchesKeys(`${next.split('+')[0]}+Shift+G`, event)) {
      event.preventDefault()
      find(!event.shiftKey)
    }
    // Typing in the field is not typing in the shell.
    event.stopPropagation()
  })

  bar.append(
    input,
    count,
    iconButton('chevronUp', 'Previous match (Shift+Enter)', () => find(false)),
    iconButton('chevronDown', 'Next match (Enter)', () => find(true)),
    iconButton('close', 'Close (Esc)', close)
  )
  // Clicks in the bar stay out of dockview and out of the terminal underneath.
  bar.addEventListener('pointerdown', (event) => event.stopPropagation())
  host.append(bar)

  return {
    open() {
      const selection = term.getSelection()
      if (selection && !selection.includes('\n')) input.value = selection
      bar.hidden = false
      input.focus()
      input.select()
      if (input.value) find(true)
    },
    dispose() {
      bar.remove()
    }
  }
}
