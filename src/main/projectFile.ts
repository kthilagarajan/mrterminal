import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CustomCommand, Preset, Project, TerminalDef } from '@shared/types'

/**
 * A project's own copy of its terminals and commands, kept in the project
 * folder (`.mrterminal/project.json`) so it can be checked in and travels
 * with the code: on another machine, adding the folder brings the same
 * terminals, commands and presets back. When present it wins over what
 * `~/.mrterminal/config.json` remembers for that folder.
 *
 * Folders are stored relative to the project, so the file works wherever
 * the project is checked out. What only makes sense on this machine for this
 * session (what was running at quit, the window, colours, settings) stays in
 * the global config.
 */
export interface ProjectFile {
  version: 1
  terminals: TerminalDef[]
  layout: unknown | null
  customCommands: CustomCommand[]
  presets: Preset[]
  aliases: Record<string, string>
}

export const PROJECT_DIR = '.mrterminal'
export const PROJECT_FILE = 'project.json'
export const PROJECT_SCHEMA_URL =
  'https://raw.githubusercontent.com/kthilagarajan/mrterminal/main/schema/project.schema.json'

export function projectFilePath(projectPath: string): string {
  return join(projectPath, PROJECT_DIR, PROJECT_FILE)
}

/**
 * The home folder is the default "Home" project, and `~/.mrterminal` is
 * already the global config's folder; that project keeps no file of its own.
 */
export function hasProjectFile(projectPath: string, home = homedir()): boolean {
  return resolve(projectPath) !== resolve(home)
}

/** `web` for `<project>/web`, `.` for the project itself; elsewhere stays absolute. */
function toRelative(projectPath: string, cwd: string): string {
  const rel = relative(projectPath, cwd)
  if (rel === '') return '.'
  if (rel.startsWith('..') || isAbsolute(rel)) return cwd
  return rel.split(sep).join('/')
}

function toAbsolute(projectPath: string, cwd: string): string {
  return isAbsolute(cwd) ? cwd : resolve(projectPath, cwd)
}

function terminalOut(projectPath: string, { resume: _session, ...t }: TerminalDef): TerminalDef {
  const out = { ...t, cwd: toRelative(projectPath, t.cwd) }
  if (t.lastCwd) out.lastCwd = toRelative(projectPath, t.lastCwd)
  return out
}

function terminalIn(projectPath: string, raw: unknown): TerminalDef | null {
  const t = raw as Partial<TerminalDef> | null
  if (!t || typeof t.id !== 'string' || typeof t.cwd !== 'string') return null
  const def: TerminalDef = {
    id: t.id,
    title: typeof t.title === 'string' ? t.title : t.id,
    cwd: toAbsolute(projectPath, t.cwd)
  }
  if (typeof t.command === 'string' && t.command) def.command = t.command
  if (typeof t.last === 'string' && t.last) def.last = t.last
  if (typeof t.lastCwd === 'string' && t.lastCwd) def.lastCwd = toAbsolute(projectPath, t.lastCwd)
  return def
}

export function toProjectFile(project: Project): ProjectFile {
  return {
    version: 1,
    terminals: project.terminals.map((t) => terminalOut(project.path, t)),
    layout: project.layout,
    customCommands: project.customCommands,
    presets: project.presets.map((p) => ({ ...p, terminals: p.terminals.map((t) => terminalOut(project.path, t)) })),
    aliases: project.aliases
  }
}

/** What a project file says about the project at `projectPath`; null if it is not one. */
export function fromProjectFile(projectPath: string, raw: unknown): Partial<Project> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Partial<ProjectFile>
  const out: Partial<Project> = {}
  const list = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null)
  const terminals = list(r.terminals)
  if (terminals) out.terminals = terminals.map((t) => terminalIn(projectPath, t)).filter((t): t is TerminalDef => !!t)
  if ('layout' in r) out.layout = r.layout ?? null
  const commands = list(r.customCommands)
  if (commands) {
    out.customCommands = commands.filter(
      (c): c is CustomCommand => !!c && typeof (c as CustomCommand).id === 'string' && typeof (c as CustomCommand).command === 'string'
    )
  }
  const presets = list(r.presets)
  if (presets) {
    out.presets = presets
      .filter((p): p is Preset => !!p && typeof (p as Preset).id === 'string' && Array.isArray((p as Preset).terminals))
      .map((p) => ({
        ...p,
        name: typeof p.name === 'string' ? p.name : p.id,
        layout: p.layout ?? null,
        terminals: p.terminals.map((t) => terminalIn(projectPath, t)).filter((t): t is TerminalDef => !!t)
      }))
  }
  if (r.aliases && typeof r.aliases === 'object' && !Array.isArray(r.aliases)) out.aliases = r.aliases
  return out
}

/**
 * The project with its file's contents on top. A terminal the file lists
 * keeps what this machine remembers only for this session (`resume`).
 */
export function applyProjectFile(project: Project, file: Partial<Project>): Project {
  const merged = { ...project, ...file }
  if (file.terminals) {
    merged.terminals = file.terminals.map((t) => {
      const resume = project.terminals.find((o) => o.id === t.id)?.resume
      return resume ? { ...t, resume } : t
    })
  }
  return merged
}

export function readProjectFile(projectPath: string): Partial<Project> | null {
  if (!hasProjectFile(projectPath)) return null
  const path = projectFilePath(projectPath)
  if (!existsSync(path)) return null
  try {
    return fromProjectFile(projectPath, JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    console.error(`mrterminal: could not read ${path}:`, err)
    return null
  }
}

export function serializeProjectFile(project: Project): string {
  return `${JSON.stringify({ $schema: PROJECT_SCHEMA_URL, ...toProjectFile(project) }, null, 2)}\n`
}

/**
 * Write each project's file when its contents changed. `written` remembers
 * what was last written (or read) per folder, so an unchanged project never
 * touches its folder. A folder that cannot be written (read-only, gone) is
 * skipped: the global config still has everything.
 */
export function writeProjectFiles(projects: Project[], written: Map<string, string>): void {
  for (const project of projects) {
    if (!hasProjectFile(project.path) || !existsSync(project.path)) continue
    const text = serializeProjectFile(project)
    if (written.get(project.path) === text) continue
    const path = projectFilePath(project.path)
    try {
      if (existsSync(path) && readFileSync(path, 'utf8') === text) {
        written.set(project.path, text)
        continue
      }
      mkdirSync(join(project.path, PROJECT_DIR), { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, text)
      renameSync(tmp, path)
      written.set(project.path, text)
    } catch (err) {
      console.error(`mrterminal: could not write ${path}:`, err)
      written.set(project.path, text)
    }
  }
}
