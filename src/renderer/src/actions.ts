import type { Config, DetectedScript, MenuAction, Project, RestoreMode, ScriptGroup } from '@shared/types'
import { findDock, getDock } from './dock'
import {
  addProject,
  getProject,
  getState,
  patchConfig,
  refreshScripts,
  removeProject,
  setState
} from './store'
import { disposeRuntime, getRuntime, setCleanExitHandler } from './terminals'

// A shell that exits cleanly (the user typed `exit`) takes its tab with it.
setCleanExitHandler((id) => findDock(id)?.close(id))

export async function boot(): Promise<void> {
  const config = await window.api.config.load()
  const hasSession = config.projects.some((p) => p.terminals.length > 0)
  setState({ config })
  // Nothing to restore, or the user already told us what they want.
  if (!hasSession) applyRestore('resume', false)
  else if (config.settings.restoreOnLaunch !== 'ask') applyRestore(config.settings.restoreOnLaunch, false)
}

export function applyRestore(mode: Exclude<RestoreMode, 'ask'>, remember: boolean): void {
  let config = getState().config as Config
  if (mode === 'fresh') {
    config = { ...config, projects: config.projects.map((p) => ({ ...p, terminals: [], layout: null })) }
  }
  if (remember) config = { ...config, settings: { ...config.settings, restoreOnLaunch: mode } }
  setState({ ready: true, restoreRun: mode === 'resume', config })
}

function activeProject(): Project | undefined {
  const id = getState().config?.activeProjectId
  return id ? getProject(id) : undefined
}

export async function pickProject(): Promise<void> {
  const picked = await window.api.pickFolder()
  if (!picked) return
  const id = addProject(picked.path, picked.name)
  void refreshScripts(id)
}

export function selectProject(id: string): void {
  patchConfig({ activeProjectId: id })
}

export function deleteProject(project: Project): void {
  const running = project.terminals.filter((t) => getState().statuses[t.id]?.busy).length
  const detail = running > 0 ? `\n\n${running} running process${running > 1 ? 'es' : ''} will be stopped.` : ''
  if (!window.confirm(`Remove "${project.name}" from MrTerminal?${detail}\n\nThe folder itself is not touched.`)) return
  for (const terminal of project.terminals) disposeRuntime(terminal.id)
  removeProject(project.id)
}

/** Shown on a tab when the script lives in a nested package: `web:dev`. */
function scriptTitle(group: ScriptGroup | null, script: DetectedScript): string {
  const folder = group?.relDir.split(/[\\/]/).pop()
  return folder ? `${folder}:${script.name}` : script.name
}

/**
 * Run a script. If it already has a terminal, that one is shown (and started
 * again if it had stopped) instead of piling up duplicates.
 */
export function runScript(project: Project, group: ScriptGroup | null, script: DetectedScript, forceNew: boolean): void {
  const dock = getDock(project.id)
  if (!dock) return
  const existing = forceNew
    ? undefined
    : project.terminals.find((t) => t.command === script.command && t.cwd === script.cwd)
  if (existing) {
    dock.focus(existing.id)
    if (!getState().statuses[existing.id]?.busy) getRuntime(existing.id)?.restart()
    return
  }
  dock.open({ title: scriptTitle(group, script), command: script.command, cwd: script.cwd })
}

export function handleMenu(action: MenuAction): void {
  const project = activeProject()
  const dock = project && getDock(project.id)
  const activeId = dock?.activeId
  switch (action) {
    case 'new-terminal':
      return dock?.openShell('tab')
    case 'split-right':
      return dock?.openShell('right')
    case 'split-down':
      return dock?.openShell('below')
    case 'close-terminal':
      return activeId ? dock?.close(activeId) : undefined
    case 'restart-terminal':
      return activeId ? getRuntime(activeId)?.restart() : undefined
    case 'clear-terminal':
      return activeId ? getRuntime(activeId)?.term.clear() : undefined
    case 'add-project':
      return void pickProject()
    case 'toggle-sidebar':
      return patchConfig({ sidebarHidden: !getState().config?.sidebarHidden })
    case 'settings':
      return setState({ settingsOpen: true })
  }
}
