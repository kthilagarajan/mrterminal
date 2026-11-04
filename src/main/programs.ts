import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
// posix, not the host's: the platform comes from `Env`, so tests can run anywhere.
import { posix } from 'node:path'
import { BUILTIN_AGENTS, type GlobalCommand } from '@shared/types'

export interface Env {
  platform: NodeJS.Platform
  home: string
  path: string
  localAppData?: string
  appData?: string
  isFile: (path: string) => boolean
}

/**
 * Where agent installers put their programs. An app started from the Dock
 * gets a bare PATH (/usr/bin:/bin...), not the one the user's shell builds,
 * so these are searched as well.
 */
function extraDirs(env: Env): string[] {
  if (env.platform === 'win32') {
    return [
      env.localAppData && `${env.localAppData}\\Antigravity`,
      env.localAppData && `${env.localAppData}\\Programs\\cursor-agent`,
      env.appData && `${env.appData}\\npm`,
      `${env.home}\\.grok\\bin`,
      `${env.home}\\.local\\bin`
    ].filter((d): d is string => !!d)
  }
  return [
    '.local/bin',
    '.grok/bin',
    '.claude/local',
    '.npm-global/bin',
    '.bun/bin',
    '.volta/bin',
    '.cargo/bin'
  ]
    .map((d) => posix.join(env.home, d))
    .concat(['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'])
}

/** The program of a command line: its first word, unquoted. */
export function programOf(command: string): string {
  const line = command.trim()
  const quoted = /^(["'])(.*?)\1/.exec(line)
  return quoted ? quoted[2] : (line.split(/\s+/)[0] ?? '')
}

/** Where the program of `command` lives, or null when it is not installed. */
export function findProgram(command: string, env: Env): string | null {
  let program = programOf(command)
  if (!program) return null
  if (program === '~' || program.startsWith('~/')) program = posix.join(env.home, program.slice(1))
  const win = env.platform === 'win32'
  if (program.includes('/') || (win && program.includes('\\'))) return env.isFile(program) ? program : null
  const dirs = [...env.path.split(win ? ';' : ':').filter(Boolean), ...extraDirs(env)]
  const suffixes = win ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of [...new Set(dirs)]) {
    for (const suffix of suffixes) {
      const file = win ? `${dir.replace(/\\$/, '')}\\${program}${suffix}` : posix.join(dir, program)
      if (env.isFile(file)) return file
    }
  }
  return null
}

/** Typed into a shell, so a path with spaces needs quotes. */
function shellWord(path: string): string {
  return /[\s'"$`\\()&;|<>*?]/.test(path) && !path.includes('"') ? `"${path}"` : path
}

/**
 * The built-in agents for a config that has none yet: each one points at
 * where it was found, and those not installed are kept but left out of the menu.
 */
export function detectAgents(env: Env): GlobalCommand[] {
  return BUILTIN_AGENTS.map(({ id, name, program }) => {
    const found = findProgram(program, env)
    return found ? { id, name, command: shellWord(found) } : { id, name, command: program, hidden: true }
  })
}

export function currentEnv(): Env {
  return {
    platform: process.platform,
    home: homedir(),
    path: process.env.PATH ?? process.env.Path ?? '',
    localAppData: process.env.LOCALAPPDATA,
    appData: process.env.APPDATA,
    isFile: (path) => {
      try {
        return existsSync(path) && statSync(path).isFile()
      } catch {
        return false
      }
    }
  }
}
