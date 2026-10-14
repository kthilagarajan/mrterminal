import { describe, expect, it } from 'vitest'
import { cwdFromOsc7 } from './terminalCwd'

describe('cwdFromOsc7', () => {
  it('decodes directory reports without confusing literal URI characters', () => {
    expect(cwdFromOsc7('file://localhost/Users/me/api%20%2520%23%3F%5C', 'darwin')).toBe('/Users/me/api %20#?\\')
    expect(cwdFromOsc7('file://my-computer/home/me/project', 'linux')).toBe('/home/me/project')
  })

  it('supports Windows drive and network directories', () => {
    expect(cwdFromOsc7('file:///C:/Users/me/project', 'win32')).toBe('C:/Users/me/project')
    expect(cwdFromOsc7('file://server/share/project', 'win32')).toBe('//server/share/project')
  })

  it('ignores malformed reports and control characters', () => {
    for (const value of ['hello', 'https://example.com/path', 'file:///bad%escape', 'file:///bad%00path', 'file:///bad%0Apath']) {
      expect(cwdFromOsc7(value, 'linux')).toBeNull()
    }
  })
})
