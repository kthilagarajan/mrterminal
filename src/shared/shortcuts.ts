/**
 * Keyboard shortcuts, in Electron's accelerator syntax, for macOS and for
 * everything else. The menu binds them; Settings lists them.
 *
 * Ctrl+W / Ctrl+D / Ctrl+K mean something to the shell, so outside macOS the
 * terminal shortcuts take Shift as well.
 */
export const KEYS = {
  'new-terminal': { mac: 'Cmd+T', other: 'Ctrl+Shift+T' },
  'split-right': { mac: 'Cmd+D', other: 'Ctrl+Shift+D' },
  'split-down': { mac: 'Cmd+Shift+D', other: 'Ctrl+Shift+E' },
  'restart-terminal': { mac: 'Cmd+Shift+R', other: 'Ctrl+Shift+R' },
  'clear-terminal': { mac: 'Cmd+K', other: 'Ctrl+Shift+K' },
  'close-terminal': { mac: 'Cmd+W', other: 'Ctrl+Shift+W' },
  'reopen-closed': { mac: 'Cmd+Shift+T', other: 'Ctrl+Shift+Z' },
  'add-project': { mac: 'Cmd+O', other: 'Ctrl+O' },
  settings: { mac: 'Cmd+,', other: 'Ctrl+,' },
  'toggle-sidebar': { mac: 'Cmd+B', other: 'Ctrl+B' },
  'toggle-compact': { mac: 'Cmd+Shift+B', other: 'Ctrl+Shift+B' },
  quit: { mac: 'Cmd+Q', other: 'Ctrl+Q' },
  copy: { mac: 'Cmd+C', other: 'Ctrl+Shift+C' },
  paste: { mac: 'Cmd+V', other: 'Ctrl+Shift+V' },
  'select-all': { mac: 'Cmd+A', other: 'Ctrl+Shift+A' },
  // Handled in the renderer, not the menu: nine menu items each would bury the rest.
  'go-to-tab': { mac: 'Cmd+1…9', other: 'Ctrl+1…9' },
  'go-to-project': { mac: 'Cmd+Shift+1…9', other: 'Ctrl+Shift+1…9' }
} satisfies Record<string, { mac: string; other: string }>

export type ShortcutId = keyof typeof KEYS

export function keysFor(id: ShortcutId, platform: string): string {
  return platform === 'darwin' ? KEYS[id].mac : KEYS[id].other
}

/** What Settings shows, in the order it shows it. */
export const SHORTCUT_GROUPS: { title: string; items: [ShortcutId, string][] }[] = [
  {
    title: 'Terminals',
    items: [
      ['go-to-tab', 'Go to tab 1–9 (9: last)'],
      ['new-terminal', 'New terminal'],
      ['split-right', 'Split right'],
      ['split-down', 'Split down'],
      ['restart-terminal', 'Restart terminal'],
      ['clear-terminal', 'Clear'],
      ['close-terminal', 'Close terminal'],
      ['reopen-closed', 'Reopen closed']
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
