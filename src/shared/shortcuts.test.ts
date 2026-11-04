import { describe, expect, it } from 'vitest'
import { displayKeys, KEYS, matchesKeys, SHORTCUT_GROUPS } from './shortcuts'

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

describe('matchesKeys', () => {
  const press = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  })

  it('matches the physical key, so Shift+] is still ]', () => {
    expect(matchesKeys('Cmd+Shift+]', press('BracketRight', { metaKey: true, shiftKey: true }))).toBe(true)
    expect(matchesKeys('Cmd+N', press('KeyN', { metaKey: true }))).toBe(true)
    expect(matchesKeys('Ctrl+Tab', press('Tab', { ctrlKey: true }))).toBe(true)
    expect(matchesKeys('Ctrl+-', press('Minus', { ctrlKey: true }))).toBe(true)
  })

  it('wants exactly the modifiers written', () => {
    expect(matchesKeys('Cmd+N', press('KeyN', { metaKey: true, shiftKey: true }))).toBe(false)
    expect(matchesKeys('Ctrl+Tab', press('Tab', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchesKeys('Ctrl+Shift+N', press('KeyN', { ctrlKey: true }))).toBe(false)
    expect(matchesKeys('Cmd+N', press('KeyN'))).toBe(false)
  })
})
