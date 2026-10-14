import { describe, expect, it } from 'vitest'
import { displayKeys, KEYS, SHORTCUT_GROUPS } from './shortcuts'

describe('displayKeys', () => {
  it('writes macOS shortcuts with symbols, modifiers in Apple order', () => {
    expect(displayKeys('Cmd+Shift+D', 'darwin')).toBe('⇧⌘D')
    expect(displayKeys('Cmd+,', 'darwin')).toBe('⌘,')
    expect(displayKeys('Cmd+Shift+1…9', 'darwin')).toBe('⇧⌘1…9')
  })

  it('leaves other platforms as written', () => {
    expect(displayKeys('Ctrl+Shift+T', 'linux')).toBe('Ctrl+Shift+T')
  })
})

describe('SHORTCUT_GROUPS', () => {
  it('lists every shortcut once', () => {
    const listed = SHORTCUT_GROUPS.flatMap((g) => g.items.map(([id]) => id))
    expect([...listed].sort()).toEqual(Object.keys(KEYS).sort())
  })
})
