import { describe, expect, it } from 'vitest'
import { findEditors } from './editors'

const env = (platform: NodeJS.Platform, files: string[], path = '', localAppData?: string) => ({
  platform,
  home: '/Users/me',
  path,
  localAppData,
  exists: (p: string) => files.includes(p)
})

describe('findEditors', () => {
  it('finds macOS apps in /Applications and ~/Applications, in a fixed order', () => {
    const found = findEditors(
      env('darwin', ['/Applications/Visual Studio Code.app', '/Users/me/Applications/WebStorm.app', '/Applications/Cursor.app'])
    )
    expect(found.map((e) => e.id)).toEqual(['cursor', 'vscode', 'webstorm'])
    expect(found[2].launch).toEqual({ kind: 'app', app: '/Users/me/Applications/WebStorm.app' })
  })

  it('finds launchers on the PATH on Linux', () => {
    const found = findEditors(env('linux', ['/usr/bin/code', '/home/me/.local/bin/zeditor'], '/usr/bin:/home/me/.local/bin'))
    expect(found.map((e) => [e.id, e.launch])).toEqual([
      ['vscode', { kind: 'exec', file: '/usr/bin/code' }],
      ['zed', { kind: 'exec', file: '/home/me/.local/bin/zeditor' }]
    ])
  })

  it('finds .cmd launchers and per-user installs on Windows', () => {
    const found = findEditors(
      env(
        'win32',
        ['C:\\VSCode\\bin\\code.cmd', 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe'],
        'C:\\Windows;C:\\VSCode\\bin',
        'C:\\Users\\me\\AppData\\Local'
      )
    )
    expect(found.map((e) => [e.id, e.launch])).toEqual([
      ['cursor', { kind: 'exec', file: 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe' }],
      ['vscode', { kind: 'exec', file: 'C:\\VSCode\\bin\\code.cmd' }]
    ])
  })

  it('finds nothing when nothing is installed', () => {
    expect(findEditors(env('darwin', []))).toEqual([])
  })
})
