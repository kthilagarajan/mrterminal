import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { currentEnv, detectAgents } from './programs'
import {
  DEFAULT_SETTINGS,
  defaultConfig,
  defaultGlobalCommands,
  nextProjectColor,
  type Config,
  type GlobalCommand,
  type Project,
  type WindowBounds
} from '@shared/types'
import { randomUUID } from 'node:crypto'
import { withFreshIds } from '@shared/ids'
import { applyProjectFile, readProjectFile, serializeProjectFile, writeProjectFiles } from './projectFile'

/** `~/.mrterminal`, overridable so tests and dev runs don't touch real state. */
export const configDir = process.env.MRTERMINAL_HOME || join(homedir(), '.mrterminal')
export const configPath = join(configDir, 'config.json')

/** Where the running app listens for `mrt`. */
export const socketPath =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\mrterminal-${configDir.replace(/[^A-Za-z0-9]/g, '-')}`
    : join(configDir, 'mrt.sock')

/** Lets editors and agents look up what each field of config.json means. */
export const SCHEMA_URL = 'https://raw.githubusercontent.com/kthilagarajan/mrterminal/main/schema/config.schema.json'

function normalizeProject(raw: Partial<Project>): Project | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.path !== 'string') return null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.path,
    path: raw.path,
    terminals: Array.isArray(raw.terminals)
      ? raw.terminals
          .filter((t) => t && typeof t.id === 'string' && typeof t.cwd === 'string')
          // Plain shells used to be titled "shell"; they are named after their folder now.
          .map((t) => (!t.command && t.title === 'shell' ? { ...t, title: basename(t.cwd) || t.title } : t))
          .map(({ resume, ...t }) => (typeof resume === 'string' && resume ? { ...t, resume } : t))
          .map(({ last, ...t }) => (typeof last === 'string' && last ? { ...t, last } : t))
          .map(({ lastCwd, ...t }) => (typeof lastCwd === 'string' && lastCwd ? { ...t, lastCwd } : t))
      : [],
    layout: raw.layout ?? null,
    expanded: raw.expanded !== false,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '',
    customCommands: Array.isArray(raw.customCommands)
      ? raw.customCommands.filter((c) => c && typeof c.id === 'string' && typeof c.command === 'string')
      : [],
    aliases: raw.aliases && typeof raw.aliases === 'object' && !Array.isArray(raw.aliases) ? raw.aliases : {},
    presets: Array.isArray(raw.presets)
      ? raw.presets.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.terminals))
      : []
  }
}

function normalizeGlobalCommand(raw: Partial<GlobalCommand>): GlobalCommand | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.command !== 'string') return null
  const command: GlobalCommand = { id: raw.id, name: typeof raw.name === 'string' ? raw.name : raw.command, command: raw.command }
  return raw.hidden === true ? { ...command, hidden: true } : command
}

/**
 * Fill in anything missing so a hand-edited or older file still loads.
 * @param seed the global commands for a file that has none yet
 */
export function normalizeConfig(raw: unknown, seed: () => GlobalCommand[] = defaultGlobalCommands): Config {
  const base = defaultConfig()
  if (!raw || typeof raw !== 'object') return { ...base, globalCommands: seed() }
  const r = raw as Partial<Config>
  const projects = Array.isArray(r.projects)
    ? r.projects.map(normalizeProject).filter((p): p is Project => p !== null)
    : []
  // Projects saved before colours existed get one each, all different.
  for (const project of projects) {
    if (!project.color) project.color = nextProjectColor(projects.map((p) => p.color))
  }
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    projects,
    activeProjectId: projects.some((p) => p.id === r.activeProjectId)
      ? (r.activeProjectId as string)
      : (projects[0]?.id ?? null),
    sidebarWidth: typeof r.sidebarWidth === 'number' ? r.sidebarWidth : base.sidebarWidth,
    sidebarHidden: r.sidebarHidden === true,
    sidebarCompact: r.sidebarCompact === true,
    globalCommands: Array.isArray(r.globalCommands)
      ? r.globalCommands.map(normalizeGlobalCommand).filter((c): c is GlobalCommand => c !== null)
      : seed(),
    window: r.window
  }
}

export class ConfigStore {
  private config: Config
  private timer: NodeJS.Timeout | null = null
  /** What each project's own file holds, so unchanged ones are not rewritten. */
  private written = new Map<string, string>()

  constructor() {
    this.config = this.withProjectFiles(this.read())
  }

  /** A project's own `.mrterminal/project.json`, where there is one, wins. */
  private withProjectFiles(config: Config): Config {
    const taken = new Set(config.projects.flatMap((p) => p.terminals.map((t) => t.id)))
    const projects = config.projects.map((project) => {
      const found = readProjectFile(project.path)
      if (!found) return project
      // Ids this project already had are its own; only clashes with others get new ones.
      const own = new Set(project.terminals.map((t) => t.id))
      const others = new Set([...taken].filter((id) => !own.has(id)))
      const file = withFreshIds(found, others, () => randomUUID().slice(0, 8))
      const merged = applyProjectFile(project, file)
      for (const t of merged.terminals) taken.add(t.id)
      this.written.set(project.path, serializeProjectFile(merged))
      return merged
    })
    return normalizeConfig({ ...config, projects })
  }

  private read(): Config {
    // First run, or a file from before global commands: offer the agents installed here.
    const seed = (): GlobalCommand[] => detectAgents(currentEnv())
    if (!existsSync(configPath)) return normalizeConfig(null, seed)
    try {
      const config = normalizeConfig(JSON.parse(readFileSync(configPath, 'utf8')), seed)
      // A project whose folder is gone (deleted, renamed) has nothing to run.
      const projects = config.projects.filter((p) => existsSync(p.path))
      if (projects.length === config.projects.length) return config
      return normalizeConfig({ ...config, projects })
    } catch (err) {
      // Keep the unreadable file around rather than silently overwriting it.
      try {
        renameSync(configPath, `${configPath}.corrupt-${Date.now()}`)
      } catch {
        /* nothing more we can do */
      }
      console.error('mrterminal: could not read config, starting fresh:', err)
      return normalizeConfig(null, seed)
    }
  }

  get(): Config {
    return this.config
  }

  /** Replace everything the renderer owns; window bounds belong to main. */
  set(next: Config): void {
    this.config = { ...normalizeConfig(next), window: this.config.window }
    this.scheduleWrite()
  }

  setWindow(bounds: WindowBounds): void {
    this.config = { ...this.config, window: bounds }
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      mkdirSync(configDir, { recursive: true })
      const tmp = `${configPath}.tmp`
      writeFileSync(tmp, JSON.stringify({ $schema: SCHEMA_URL, ...this.config }, null, 2))
      renameSync(tmp, configPath)
    } catch (err) {
      console.error('mrterminal: could not write config:', err)
    }
    writeProjectFiles(this.config.projects, this.written)
  }
}
