import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
// posix, not the host's: the platform comes from `Env`, so tests can run anywhere.
import { posix } from 'node:path'
import type { EditorInfo } from '@shared/types'

/**
 * Editors and IDEs a project folder can be opened in. Found the platform's way:
 * an .app bundle on macOS, a launcher on the PATH elsewhere (plus the usual
 * per-user install folders on Windows, which do not always reach the PATH).
 */
interface EditorDef {
  id: string
  name: string
  /** macOS: bundle names to look for in /Applications and ~/Applications. */
  apps: string[]
  /** Linux and Windows: launcher commands on the PATH. */
  commands: string[]
  /** Windows: executables under %LOCALAPPDATA%\Programs. */
  windows?: string[]
}

const EDITORS: EditorDef[] = [
  { id: 'cursor', name: 'Cursor', apps: ['Cursor'], commands: ['cursor'], windows: ['cursor\\Cursor.exe'] },
  {
    id: 'vscode',
    name: 'VS Code',
    apps: ['Visual Studio Code'],
    commands: ['code'],
    windows: ['Microsoft VS Code\\Code.exe']
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    apps: ['Visual Studio Code - Insiders'],
    commands: ['code-insiders'],
    windows: ['Microsoft VS Code Insiders\\Code - Insiders.exe']
  },
  { id: 'windsurf', name: 'Windsurf', apps: ['Windsurf'], commands: ['windsurf'], windows: ['Windsurf\\Windsurf.exe'] },
  { id: 'zed', name: 'Zed', apps: ['Zed'], commands: ['zed', 'zeditor'] },
  { id: 'sublime', name: 'Sublime Text', apps: ['Sublime Text'], commands: ['subl'] },
  { id: 'webstorm', name: 'WebStorm', apps: ['WebStorm'], commands: ['webstorm'] },
  { id: 'idea', name: 'IntelliJ IDEA', apps: ['IntelliJ IDEA', 'IntelliJ IDEA Ultimate', 'IntelliJ IDEA CE'], commands: ['idea'] },
  { id: 'pycharm', name: 'PyCharm', apps: ['PyCharm', 'PyCharm Professional Edition', 'PyCharm CE'], commands: ['pycharm'] },
  { id: 'goland', name: 'GoLand', apps: ['GoLand'], commands: ['goland'] },
  { id: 'rider', name: 'Rider', apps: ['Rider'], commands: ['rider'] },
  { id: 'android-studio', name: 'Android Studio', apps: ['Android Studio'], commands: ['studio'] },
  { id: 'fleet', name: 'Fleet', apps: ['Fleet'], commands: ['fleet'] }
]

/** How to start one editor: a macOS app, or a program to run with the folder. */
type Launch = { kind: 'app'; app: string } | { kind: 'exec'; file: string }

interface Env {
  platform: NodeJS.Platform
  home: string
  path: string
  localAppData?: string
  exists: (path: string) => boolean
}

function findLaunch(editor: EditorDef, env: Env): Launch | null {
  if (env.platform === 'darwin') {
    for (const dir of ['/Applications', posix.join(env.home, 'Applications')]) {
      for (const app of editor.apps) {
        const path = posix.join(dir, `${app}.app`)
        if (env.exists(path)) return { kind: 'app', app: path }
      }
    }
    return null
  }
  const dirs = env.path.split(env.platform === 'win32' ? ';' : ':').filter(Boolean)
  const suffixes = env.platform === 'win32' ? ['.cmd', '.exe', '.bat'] : ['']
  for (const command of editor.commands) {
    for (const dir of dirs) {
      for (const suffix of suffixes) {
        const file = env.platform === 'win32' ? `${dir.replace(/\\$/, '')}\\${command}${suffix}` : posix.join(dir, command)
        if (env.exists(file)) return { kind: 'exec', file }
      }
    }
  }
  if (env.platform === 'win32' && env.localAppData) {
    for (const exe of editor.windows ?? []) {
      const file = `${env.localAppData}\\Programs\\${exe}`
      if (env.exists(file)) return { kind: 'exec', file }
    }
  }
  return null
}

/** Exported for tests: the editors found, in the order of `EDITORS`. */
export function findEditors(env: Env): (EditorInfo & { launch: Launch })[] {
  const found: (EditorInfo & { launch: Launch })[] = []
  for (const editor of EDITORS) {
    const launch = findLaunch(editor, env)
    if (launch) found.push({ id: editor.id, name: editor.name, launch })
  }
  return found
}

function currentEnv(): Env {
  return {
    platform: process.platform,
    home: homedir(),
    path: process.env.PATH ?? process.env.Path ?? '',
    localAppData: process.env.LOCALAPPDATA,
    exists: existsSync
  }
}

/** The editors installed on this machine. Cheap enough to ask again each time. */
export function listEditors(): EditorInfo[] {
  return findEditors(currentEnv()).map(({ id, name }) => ({ id, name }))
}

export function openInEditor(id: string, folder: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const editor = findEditors(currentEnv()).find((e) => e.id === id)
  if (!editor) return Promise.resolve({ ok: false, error: `${id} is not installed` })
  const { launch } = editor
  return new Promise((resolve) => {
    const child =
      launch.kind === 'app'
        ? spawn('open', ['-a', launch.app, folder], { detached: true, stdio: 'ignore' })
        : // .cmd and .bat launchers only run through cmd.exe.
          /\.(cmd|bat)$/i.test(launch.file)
          ? spawn(`"${launch.file}"`, [`"${folder}"`], { detached: true, stdio: 'ignore', shell: true, windowsHide: true })
          : spawn(launch.file, [folder], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (err) => resolve({ ok: false, error: err.message }))
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}
