import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  defaultConfig,
  type Config,
  type Project,
  type WindowBounds
} from '@shared/types'

/** `~/.mrterminal`, overridable so tests and dev runs don't touch real state. */
export const configDir = process.env.MRTERMINAL_HOME || join(homedir(), '.mrterminal')
export const configPath = join(configDir, 'config.json')

function normalizeProject(raw: Partial<Project>): Project | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.path !== 'string') return null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.path,
    path: raw.path,
    terminals: Array.isArray(raw.terminals)
      ? raw.terminals.filter((t) => t && typeof t.id === 'string' && typeof t.cwd === 'string')
      : [],
    layout: raw.layout ?? null,
    customCommands: Array.isArray(raw.customCommands)
      ? raw.customCommands.filter((c) => c && typeof c.id === 'string' && typeof c.command === 'string')
      : [],
    presets: Array.isArray(raw.presets)
      ? raw.presets.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.terminals))
      : []
  }
}

/** Fill in anything missing so a hand-edited or older file still loads. */
export function normalizeConfig(raw: unknown): Config {
  const base = defaultConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<Config>
  const projects = Array.isArray(r.projects)
    ? r.projects.map(normalizeProject).filter((p): p is Project => p !== null)
    : []
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    projects,
    activeProjectId: projects.some((p) => p.id === r.activeProjectId)
      ? (r.activeProjectId as string)
      : (projects[0]?.id ?? null),
    sidebarWidth: typeof r.sidebarWidth === 'number' ? r.sidebarWidth : base.sidebarWidth,
    sidebarHidden: r.sidebarHidden === true,
    window: r.window
  }
}

export class ConfigStore {
  private config: Config
  private timer: NodeJS.Timeout | null = null

  constructor() {
    this.config = this.read()
  }

  private read(): Config {
    if (!existsSync(configPath)) return defaultConfig()
    try {
      return normalizeConfig(JSON.parse(readFileSync(configPath, 'utf8')))
    } catch (err) {
      // Keep the unreadable file around rather than silently overwriting it.
      try {
        renameSync(configPath, `${configPath}.corrupt-${Date.now()}`)
      } catch {
        /* nothing more we can do */
      }
      console.error('mrterminal: could not read config, starting fresh:', err)
      return defaultConfig()
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
      writeFileSync(tmp, JSON.stringify(this.config, null, 2))
      renameSync(tmp, configPath)
    } catch (err) {
      console.error('mrterminal: could not write config:', err)
    }
  }
}
