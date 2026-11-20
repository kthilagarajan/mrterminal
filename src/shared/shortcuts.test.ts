import { describe, expect, it } from 'vitest'
import { displayKeys, isWindowShortcut, KEYS, SHORTCUT_GROUPS } from './shortcuts'

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

describe('isWindowShortcut', () => {
  const press = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
    ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })

  it("lets the window's plain Ctrl shortcuts past the terminal outside macOS", () => {
    for (const key of ['b', 'B', 'o', 'q', ',']) expect(isWindowShortcut(press(key, { ctrlKey: true }), 'win32')).toBe(true)
    expect(isWindowShortcut(press('b', { ctrlKey: true }), 'linux')).toBe(true)
  })

  it('leaves the shell its own keys, and macOS alone', () => {
    for (const key of ['c', 'd', 'w', 'r', 'a', 'e', 'k']) expect(isWindowShortcut(press(key, { ctrlKey: true }), 'linux')).toBe(false)
    expect(isWindowShortcut(press('b'), 'linux')).toBe(false)
    expect(isWindowShortcut(press('b', { ctrlKey: true, shiftKey: true }), 'linux')).toBe(false)
    expect(isWindowShortcut(press('b', { ctrlKey: true, altKey: true }), 'linux')).toBe(false)
    expect(isWindowShortcut(press('b', { ctrlKey: true }), 'darwin')).toBe(false)
  })
})
