import type { CommandResult, CustomCommand } from './types'

/**
 * The `mrt` command-line tool talks to the running app over a local socket:
 * one JSON request per line, one JSON response per line.
 *
 *   → {"id":1,"method":"open","params":{...}}
 *   ← {"id":1,"result":{...}}   or   {"id":1,"error":{"message":"..."}}
 *
 * Main answers what it can on its own (pty output, waits) and asks the
 * renderer, which owns projects, layouts and xterm buffers, for the rest.
 */

export interface ControlRequest {
  id: number
  method: string
  params?: Record<string, unknown>
}

export type ControlResponse = { id: number; result: unknown } | { id: number; error: { message: string } }

/** Where the caller is, so "this project" and "this terminal" mean something. */
export interface CallerContext {
  /** Working directory of the `mrt` process. */
  cwd?: string
  /** `MRT_TERMINAL_ID` when `mrt` runs inside one of the app's terminals. */
  terminalId?: string
}

export interface TermInfo {
  id: string
  projectId: string
  project: string
  title: string
  /** The shell's current directory (follows `cd`). */
  cwd: string
  /** The command the terminal was opened for; absent for a plain shell. */
  command?: string
  /** A command is executing right now, as the shell reports it. */
  running: boolean
  /** Foreground process name. */
  process: string
  /** The selected tab of its project. */
  active: boolean
  /** Set when the shell itself has exited (the tab waits for Enter to restart). */
  shellExitCode?: number
  /** The most recent command line, filled in by main. Output is left out. */
  lastCommand?: Omit<CommandResult, 'output' | 'truncated'>
}

export interface ProjectInfo {
  id: string
  name: string
  path: string
  active: boolean
  terminals: TermInfo[]
  presets: { name: string; terminals: number }[]
  commands: Omit<CustomCommand, 'id'>[]
}

export interface AppState {
  /** False while the app asks how to restore the previous session. */
  ready: boolean
  activeProjectId: string | null
  projects: ProjectInfo[]
}

export class ControlError extends Error {}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, '') : path
}

function within(path: string, folder: string): boolean {
  const p = trimSlash(path)
  const f = trimSlash(folder)
  return p === f || p.startsWith(`${f}/`) || p.startsWith(`${f}\\`)
}

function terminalOwner(state: AppState, terminalId: string | undefined): ProjectInfo | undefined {
  return terminalId ? state.projects.find((p) => p.terminals.some((t) => t.id === terminalId)) : undefined
}

/** The project the caller is in: its folder, else its terminal's project. */
function contextProject(state: AppState, ctx: CallerContext): ProjectInfo | undefined {
  const byFolder = ctx.cwd
    ? state.projects.filter((p) => within(ctx.cwd!, p.path)).sort((a, b) => b.path.length - a.path.length)[0]
    : undefined
  return byFolder ?? terminalOwner(state, ctx.terminalId)
}

/**
 * Find a project by id, name or folder. With no name: the project whose
 * folder the caller is in, the project of the terminal it runs in, or the
 * project on screen, in that order.
 */
export function resolveProject(state: AppState, ref: string | undefined, ctx: CallerContext): ProjectInfo {
  if (state.projects.length === 0) throw new ControlError('No projects yet. Add one with: mrt project add <folder>')
  if (!ref) {
    const project = contextProject(state, ctx) ?? state.projects.find((p) => p.id === state.activeProjectId)
    if (project) return project
    throw new ControlError('Which project? Pass --project <name>.')
  }
  const lower = ref.toLowerCase()
  const found =
    state.projects.find((p) => p.id === ref) ??
    state.projects.find((p) => trimSlash(p.path) === trimSlash(ref)) ??
    state.projects.filter((p) => p.name.toLowerCase() === lower)
  if (!Array.isArray(found)) return found
  if (found.length === 1) return found[0]
  if (found.length > 1) throw new ControlError(`More than one project is called "${ref}"; use its id: ${found.map((p) => p.id).join(', ')}`)
  throw new ControlError(`No project "${ref}". Projects: ${state.projects.map((p) => p.name).join(', ')}`)
}

/**
 * Find a terminal by id, title or command. `self` is the terminal `mrt` runs
 * in. Several matches are narrowed to the caller's project before giving up.
 */
export function resolveTerminal(state: AppState, ref: string, ctx: CallerContext, projectRef?: string): TermInfo {
  const scope = projectRef ? [resolveProject(state, projectRef, ctx)] : state.projects
  const all = scope.flatMap((p) => p.terminals)
  if (ref === 'self') {
    const self = all.find((t) => t.id === ctx.terminalId)
    if (self) return self
    throw new ControlError('"self" only works inside a MrTerminal terminal.')
  }
  const byId = all.find((t) => t.id === ref)
  if (byId) return byId

  const lower = ref.toLowerCase()
  let matches = all.filter((t) => t.title.toLowerCase() === lower || t.command === ref)
  if (matches.length > 1) {
    const here = contextProject(state, ctx)
    const narrowed = matches.filter((t) => t.projectId === here?.id)
    if (narrowed.length > 0) matches = narrowed
  }
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new ControlError(
      `"${ref}" matches ${matches.length} terminals; use an id:\n` +
        matches.map((t) => `  ${t.id}  ${t.project} / ${t.title}`).join('\n')
    )
  }
  const names = all.map((t) => `${t.title} (${t.id})`).join(', ')
  throw new ControlError(`No terminal "${ref}".${names ? ` Open: ${names}` : ' No terminals are open.'}`)
}

/** Key names `mrt keys` understands, and what they send. */
export const KEYS: Record<string, string> = {
  enter: '\r',
  tab: '\t',
  esc: '\x1b',
  escape: '\x1b',
  backspace: '\x7f',
  space: ' ',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  delete: '\x1b[3~'
}

/** `ctrl-c`, `enter`, `up`... to the bytes a terminal would send. */
export function keyBytes(name: string): string {
  const key = name.toLowerCase()
  const ctrl = key.match(/^(?:ctrl|c)[-+]([a-z@[\\\]^_])$/)
  if (ctrl) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f)
  if (key in KEYS) return KEYS[key]
  throw new ControlError(`Unknown key "${name}". Use ctrl-<letter> or one of: ${Object.keys(KEYS).join(', ')}`)
}
