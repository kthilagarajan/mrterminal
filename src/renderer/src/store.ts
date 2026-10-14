import { useSyncExternalStore } from 'react'
import { nextProjectColor, type Config, type Project, type ScriptGroup, type Settings, type TerminalDef, type UpdateState } from '@shared/types'

export interface TermStatus {
  /** A command is executing right now. */
  busy: boolean
  /**
   * It has been executing long enough to be worth showing. Every `ls` is
   * busy for a few milliseconds; showing that makes the sidebar flicker on
   * each Enter. This is what the UI draws; `busy` is what decisions use.
   */
  shown: boolean
  process: string
  /** Set once the shell has exited with a non-zero code. */
  exitCode?: number
}

export interface State {
  config: Config | null
  /** False until the user (or their saved preference) picked how to restore. */
  ready: boolean
  /** How terminals from the previous session start: run, or just prefill. */
  restoreRun: boolean
  statuses: Record<string, TermStatus>
  scripts: Record<string, ScriptGroup[] | undefined>
  settingsOpen: boolean
  update: UpdateState | null
  /** How many closed tabs/projects can still be reopened. */
  closedCount: number
}

let state: State = {
  config: null,
  ready: false,
  restoreRun: true,
  statuses: {},
  scripts: {},
  settingsOpen: false,
  update: null,
  closedCount: 0
}

const listeners = new Set<() => void>()
let saveTimer: number | undefined

export function getState(): State {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setState(patch: Partial<State>): void {
  const configChanged = 'config' in patch && patch.config !== state.config
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
  if (configChanged && state.config && state.ready) {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => state.config && window.api.config.save(state.config), 300)
  }
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function uid(): string {
  return crypto.randomUUID().slice(0, 8)
}

// ── Config edits ────────────────────────────────────────────────────────────

function editConfig(edit: (config: Config) => Config): void {
  if (state.config) setState({ config: edit(state.config) })
}

export function editProject(id: string, edit: (project: Project) => Project): void {
  editConfig((c) => ({ ...c, projects: c.projects.map((p) => (p.id === id ? edit(p) : p)) }))
}

/** Identifies a command within a project: where it runs (relative) and what it runs. */
export function aliasKey(project: Project, command: string, cwd: string): string {
  const folder = cwd === project.path ? '' : cwd.startsWith(`${project.path}/`) ? cwd.slice(project.path.length + 1) : cwd
  return `${folder}\n${command}`
}

export function getProject(id: string): Project | undefined {
  return state.config?.projects.find((p) => p.id === id)
}

export function patchConfig(patch: Partial<Config>): void {
  editConfig((c) => ({ ...c, ...patch }))
}

export function patchSettings(patch: Partial<Settings>): void {
  editConfig((c) => ({ ...c, settings: { ...c.settings, ...patch } }))
}

export function addProject(path: string, name: string): string {
  const existing = state.config?.projects.find((p) => p.path === path)
  if (existing) {
    patchConfig({ activeProjectId: existing.id })
    return existing.id
  }
  const project: Project = { id: uid(), name, path, terminals: [], layout: null, customCommands: [], presets: [], aliases: {}, expanded: true, color: nextProjectColor((state.config?.projects ?? []).map((p) => p.color)) }
  editConfig((c) => ({ ...c, projects: [...c.projects, project], activeProjectId: project.id }))
  return project.id
}

export function removeProject(id: string): void {
  editConfig((c) => {
    const projects = c.projects.filter((p) => p.id !== id)
    return {
      ...c,
      projects,
      activeProjectId: c.activeProjectId === id ? (projects[0]?.id ?? null) : c.activeProjectId
    }
  })
}

/** Move a project so that it sits at `index` in the list. */
export function moveProject(id: string, index: number): void {
  editConfig((c) => {
    const from = c.projects.findIndex((p) => p.id === id)
    if (from < 0) return c
    const projects = [...c.projects]
    const [project] = projects.splice(from, 1)
    projects.splice(Math.max(0, Math.min(projects.length, index)), 0, project)
    return { ...c, projects }
  })
}

/** Put a removed project back where it was and show it. */
export function restoreProject(project: Project, index: number): void {
  editConfig((c) => {
    const projects = [...c.projects]
    projects.splice(Math.min(index, projects.length), 0, project)
    return { ...c, projects, activeProjectId: project.id }
  })
}

export function addTerminalDef(projectId: string, def: TerminalDef): void {
  editProject(projectId, (p) => ({ ...p, terminals: [...p.terminals, def] }))
}

/**
 * Remember where a plain shell has `cd`'d to, so reopening it (after closing
 * the tab or the app) lands in the same folder. A command's cwd is part of its
 * identity and stays as launched.
 */
export function setShellCwd(id: string, cwd: string): void {
  const project = state.config?.projects.find((p) => p.terminals.some((t) => t.id === id))
  const def = project?.terminals.find((t) => t.id === id)
  if (!project || !def || def.command || def.cwd === cwd) return
  editProject(project.id, (p) => ({ ...p, terminals: p.terminals.map((t) => (t.id === id ? { ...t, cwd } : t)) }))
}

export function removeTerminalDef(projectId: string, id: string): void {
  editProject(projectId, (p) => ({ ...p, terminals: p.terminals.filter((t) => t.id !== id) }))
  cancelShow(id)
  if (id in state.statuses) {
    const { [id]: _gone, ...statuses } = state.statuses
    setState({ statuses })
  }
}

/** How long a command must run before it is shown as running. */
const SHOW_AFTER_MS = 2000
const showTimers = new Map<string, number>()

function cancelShow(id: string): void {
  window.clearTimeout(showTimers.get(id))
  showTimers.delete(id)
}

export function setStatus(id: string, status: Omit<TermStatus, 'shown'>): void {
  const shown = status.busy && (state.statuses[id]?.shown ?? false)
  if (!status.busy) cancelShow(id)
  else if (!shown && !showTimers.has(id)) {
    showTimers.set(
      id,
      window.setTimeout(() => {
        showTimers.delete(id)
        const current = state.statuses[id]
        if (current?.busy) setState({ statuses: { ...state.statuses, [id]: { ...current, shown: true } } })
      }, SHOW_AFTER_MS)
    )
  }
  setState({ statuses: { ...state.statuses, [id]: { ...status, shown } } })
}

export async function refreshScripts(projectId: string): Promise<void> {
  const project = getProject(projectId)
  if (!project) return
  const groups = await window.api.detectScripts(project.path)
  setState({ scripts: { ...state.scripts, [projectId]: groups } })
}

/** Write immediately; used when the window is going away. */
export function saveNow(): void {
  window.clearTimeout(saveTimer)
  if (state.config && state.ready) window.api.config.saveSync(state.config)
}
