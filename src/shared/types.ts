/** What to do with the previous session's terminals when the app starts. */
export type RestoreMode =
  | 'ask' // show the prompt every launch
  | 'resume' // restore the layout and re-run every command
  | 'layout' // restore the layout, leave commands typed at the prompt
  | 'fresh' // start with no terminals

export interface Settings {
  restoreOnLaunch: RestoreMode
  /** Absolute path of the shell to launch. null = the user's login shell. */
  shell: string | null
  fontSize: number
  /** Terminal font family. null = the built-in monospace stack. */
  fontFamily: string | null
  /** Id of a theme from `themes.ts`. */
  theme: string
}

export interface TerminalDef {
  id: string
  title: string
  cwd: string
  /** Command typed into the shell on start. Absent for a plain shell. */
  command?: string
}

export interface CustomCommand {
  id: string
  name: string
  command: string
  /** Folder to run in: relative to the project, or absolute. Absent = project root. */
  cwd?: string
}

/** A set of terminals, with their arrangement, that opens in one click. */
export interface Preset {
  id: string
  name: string
  terminals: TerminalDef[]
  /** Dockview layout referring to the ids in `terminals`. */
  layout: unknown | null
}

export interface Project {
  id: string
  name: string
  path: string
  /** Terminals that are currently open; this is what gets restored. */
  terminals: TerminalDef[]
  /** Serialized dockview layout (splits, tabs, sizes). */
  layout: unknown | null
  customCommands: CustomCommand[]
  presets: Preset[]
  /**
   * Names the user gave to detected scripts, keyed by `aliasKey`. An entry
   * whose script no longer exists is simply never looked up.
   */
  aliases: Record<string, string>
  /** Shown open in the sidebar (scripts, presets, commands) or just its running terminals. */
  expanded: boolean
  /** The project's own colour (icon, card outline), one of PROJECT_COLORS. */
  color: string
}

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

export interface Config {
  version: 1
  settings: Settings
  projects: Project[]
  activeProjectId: string | null
  sidebarWidth: number
  sidebarHidden: boolean
  window?: WindowBounds
}

export interface DetectedScript {
  name: string
  /** The full command line to run, e.g. `pnpm run dev`. */
  command: string
  /** Absolute directory the command runs in. */
  cwd: string
  /** What the script does, e.g. the body of an npm script. */
  detail?: string
}

export interface ScriptGroup {
  /** File the scripts came from, e.g. `package.json`. */
  source: string
  /** Directory relative to the project root; '' for the root. */
  relDir: string
  /** Tool that runs them, e.g. `pnpm`. */
  runner: string
  scripts: DetectedScript[]
}

export interface PtyCreateOptions {
  id: string
  cwd: string
  cols: number
  rows: number
  command?: string
  /** true: run `command`. false: type it at the prompt without pressing Enter. */
  run: boolean
}

export interface PtyExit {
  id: string
  exitCode: number
  signal?: number
}

export interface PtyStatus {
  id: string
  /** A foreground process other than the shell is running. */
  busy: boolean
  process: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error'
  /** The version that is running. */
  current: string
  /** The newer version on offer. */
  version?: string
  /** False where the app cannot replace itself; the download page opens instead. */
  canInstall?: boolean
  /** Download progress, 0-99. */
  progress?: number
  error?: string
}

export type MenuAction =
  | 'new-terminal'
  | 'split-right'
  | 'split-down'
  | 'close-terminal'
  | 'restart-terminal'
  | 'clear-terminal'
  | 'add-project'
  | 'toggle-sidebar'
  | 'settings'
  | 'reopen-closed'
  | 'check-updates'

/** Hues that stay readable on both dark and light themes. */
export const PROJECT_COLORS = [
  '#e0569b',
  '#5b9cf5',
  '#3fb98a',
  '#e3a03a',
  '#9d7bf0',
  '#e8704f',
  '#35b5c4',
  '#c4b23a',
  '#d66bd0',
  '#7c8cf8'
]

/** The first colour no project is using yet, so neighbours look different. */
export function nextProjectColor(used: string[]): string {
  return PROJECT_COLORS.find((c) => !used.includes(c)) ?? PROJECT_COLORS[used.length % PROJECT_COLORS.length]
}

export const DEFAULT_SETTINGS: Settings = {
  restoreOnLaunch: 'ask',
  shell: null,
  fontSize: 13,
  fontFamily: null,
  theme: 'midnight'
}

export function defaultConfig(): Config {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    projects: [],
    activeProjectId: null,
    sidebarWidth: 280,
    sidebarHidden: false
  }
}
