/**
 * Keyboard shortcuts, in Electron's accelerator syntax, for macOS and for
 * everything else. The menu binds them; Settings lists them. `also` is a
 * second key for the same thing (Cmd+N next to Cmd+T, as in other terminals),
 * caught in the renderer since a menu item takes only one accelerator.
 *
 * Ctrl+W / Ctrl+D / Ctrl+K mean something to the shell, so outside macOS the
 * terminal shortcuts take Shift as well.
 */
export interface Keys {
  mac: string
  other: string
  also?: { mac: string; other: string }
}

export const KEYS = {
  'new-terminal': { mac: 'Cmd+T', other: 'Ctrl+Shift+T', also: { mac: 'Cmd+N', other: 'Ctrl+Shift+N' } },
  'split-right': { mac: 'Cmd+D', other: 'Ctrl+Shift+D' },
  'split-down': { mac: 'Cmd+Shift+D', other: 'Ctrl+Shift+E' },
  'restart-terminal': { mac: 'Cmd+Shift+R', other: 'Ctrl+Shift+R' },
  'clear-terminal': { mac: 'Cmd+K', other: 'Ctrl+Shift+K' },
  'close-terminal': { mac: 'Cmd+W', other: 'Ctrl+Shift+W' },
  'reopen-closed': { mac: 'Cmd+Shift+T', other: 'Ctrl+Shift+Z' },
  find: { mac: 'Cmd+F', other: 'Ctrl+Shift+F' },
  'zoom-in': { mac: 'Cmd+=', other: 'Ctrl+=' },
  'zoom-out': { mac: 'Cmd+-', other: 'Ctrl+-' },
  'zoom-reset': { mac: 'Cmd+0', other: 'Ctrl+0' },
  'add-project': { mac: 'Cmd+O', other: 'Ctrl+O' },
  settings: { mac: 'Cmd+,', other: 'Ctrl+,' },
  'toggle-sidebar': { mac: 'Cmd+B', other: 'Ctrl+B' },
  'toggle-compact': { mac: 'Cmd+Shift+B', other: 'Ctrl+Shift+B' },
  quit: { mac: 'Cmd+Q', other: 'Ctrl+Q' },
  copy: { mac: 'Cmd+C', other: 'Ctrl+Shift+C' },
  paste: { mac: 'Cmd+V', other: 'Ctrl+Shift+V' },
  'select-all': { mac: 'Cmd+A', other: 'Ctrl+Shift+A' },
  // Handled in the renderer: the menu shows these without binding them, since
  // Electron cannot reliably bind a shifted bracket, Tab or a second key.
  'next-tab': { mac: 'Cmd+Shift+]', other: 'Ctrl+Tab', also: { mac: 'Ctrl+Tab', other: 'Ctrl+PageDown' } },
  'previous-tab': {
    mac: 'Cmd+Shift+[',
    other: 'Ctrl+Shift+Tab',
    also: { mac: 'Ctrl+Shift+Tab', other: 'Ctrl+PageUp' }
  },
  // Handled in the renderer, not the menu: nine menu items each would bury the rest.
  'go-to-tab': { mac: 'Cmd+1…9', other: 'Ctrl+1…9' },
  'go-to-project': { mac: 'Cmd+Shift+1…9', other: 'Ctrl+Shift+1…9' }
} satisfies Record<string, Keys>

export type ShortcutId = keyof typeof KEYS

export function keysFor(id: ShortcutId, platform: string): string {
  return platform === 'darwin' ? KEYS[id].mac : KEYS[id].other
}

/** The second key for a shortcut, if it has one. */
export function alsoKeysFor(id: ShortcutId, platform: string): string | undefined {
  const also = (KEYS[id] as Keys).also
  return also && (platform === 'darwin' ? also.mac : also.other)
}

/** What Settings shows, in the order it shows it. */
export const SHORTCUT_GROUPS: { title: string; items: [ShortcutId, string][] }[] = [
  {
    title: 'Terminals',
    items: [
      ['go-to-tab', 'Go to tab 1–9 (9: last)'],
      ['next-tab', 'Next tab'],
      ['previous-tab', 'Previous tab'],
      ['new-terminal', 'New terminal'],
      ['split-right', 'Split right'],
      ['split-down', 'Split down'],
      ['restart-terminal', 'Restart terminal'],
      ['clear-terminal', 'Clear'],
      ['close-terminal', 'Close terminal'],
      ['reopen-closed', 'Reopen closed'],
      ['find', 'Find']
    ]
  },
  {
    title: 'Projects',
    items: [
      ['go-to-project', 'Go to project 1–9 (9: last)'],
      ['add-project', 'Add project']
    ]
  },
  {
    title: 'Window',
    items: [
      ['toggle-sidebar', 'Toggle sidebar'],
      ['toggle-compact', 'Compact project list'],
      ['zoom-in', 'Bigger text'],
      ['zoom-out', 'Smaller text'],
      ['zoom-reset', 'Default text size'],
      ['settings', 'Settings'],
      ['quit', 'Quit (press twice)']
    ]
  },
  {
    title: 'Edit',
    items: [
      ['copy', 'Copy'],
      ['paste', 'Paste'],
      ['select-all', 'Select all']
    ]
  }
]

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘' }

/** `Cmd+Shift+D` as macOS writes it, `⇧⌘D`; elsewhere unchanged. */
export function displayKeys(keys: string, platform: string): string {
  if (platform !== 'darwin') return keys
  const parts = keys.split('+')
  const key = parts.pop() ?? ''
  const order = Object.keys(MAC_SYMBOLS)
  const modifiers = parts.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return modifiers.map((m) => MAC_SYMBOLS[m] ?? m).join('') + key
}

/** The parts of a KeyboardEvent a shortcut is matched against. */
export interface KeyPress {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const CODES: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight', '=': 'Equal', '-': 'Minus', ',': 'Comma' }

/** The physical key a shortcut's key sits on, so Shift+] still reads as ], not }. */
function codeFor(key: string): string {
  if (CODES[key]) return CODES[key]
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`
  return key
}

/** Whether a key press is exactly `keys` (`Cmd+Shift+]`, `Ctrl+Tab`, ...): no modifier missing or extra. */
export function matchesKeys(keys: string, press: KeyPress): boolean {
  const parts = keys.split('+')
  // `Cmd+-` and `Ctrl+=` end in the key itself; a trailing `+` would leave an empty part.
  const key = parts.pop() || '+'
  const has = (m: string): boolean => parts.includes(m)
  return (
    press.code === codeFor(key) &&
    press.metaKey === has('Cmd') &&
    press.ctrlKey === has('Ctrl') &&
    press.altKey === has('Alt') &&
    press.shiftKey === has('Shift')
  )
}
