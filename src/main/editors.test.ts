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

  it('opens the VS Code family, Zed and Sublime through their launcher on macOS, in a new window', () => {
    const found = findEditors(
      env('darwin', [
        '/Applications/Cursor.app',
        '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
        '/Applications/Zed.app',
        '/Applications/Zed.app/Contents/MacOS/cli',
        '/Applications/Sublime Text.app'
      ])
    )
    expect(found.map((e) => [e.id, e.launch])).toEqual([
      ['cursor', { kind: 'exec', file: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor', args: ['--new-window'] }],
      ['zed', { kind: 'exec', file: '/Applications/Zed.app/Contents/MacOS/cli', args: ['--new'] }],
      // No launcher inside the bundle: fall back to `open -a`.
      ['sublime', { kind: 'app', app: '/Applications/Sublime Text.app' }]
    ])
  })

  it('finds launchers on the PATH on Linux', () => {
    const found = findEditors(env('linux', ['/usr/bin/code', '/home/me/.local/bin/zeditor'], '/usr/bin:/home/me/.local/bin'))
    expect(found.map((e) => [e.id, e.launch])).toEqual([
      ['vscode', { kind: 'exec', file: '/usr/bin/code', args: ['--new-window'] }],
      ['zed', { kind: 'exec', file: '/home/me/.local/bin/zeditor', args: ['--new'] }]
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
      ['cursor', { kind: 'exec', file: 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe', args: ['--new-window'] }],
      ['vscode', { kind: 'exec', file: 'C:\\VSCode\\bin\\code.cmd', args: ['--new-window'] }]
    ])
  })

  it('finds nothing when nothing is installed', () => {
    expect(findEditors(env('darwin', []))).toEqual([])
  })
})
