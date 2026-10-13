import type { Config, DetectedScript, MenuAction, Project, RestoreMode, ScriptGroup } from '@shared/types'
import { applyAppearance } from './appearance'
import { rememberClosed, takeClosed } from './closed'
import { findDock, getDock } from './dock'
import {
  addProject,
  aliasKey,
  getProject,
  getState,
  patchConfig,
  refreshScripts,
  removeProject,
  restoreProject,
  setState
} from './store'
import { disposeRuntime, getRuntime, setCleanExitHandler } from './terminals'

// A shell that exits cleanly (the user typed `exit`) takes its tab with it.
setCleanExitHandler((id) => findDock(id)?.close(id))

export async function boot(): Promise<void> {
  window.api.update.onState((update) => setState({ update }))
  void window.api.update.get().then((update) => setState({ update }))
  const config = await window.api.config.load()
  applyAppearance(config.settings)
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

/** Interrupt whatever is running in a terminal, as Ctrl-C would. */
export function stopTerminal(id: string): void {
  window.api.pty.write(id, '\x03')
}

export function stopAll(project: Project): void {
  for (const terminal of project.terminals) {
    if (getState().statuses[terminal.id]?.busy) stopTerminal(terminal.id)
  }
}

/** Show a terminal: switch to its project and focus its tab. */
export function showTerminal(projectId: string, id: string): void {
  selectProject(projectId)
  getDock(projectId)?.focus(id)
}

export function deleteProject(project: Project): void {
  const running = project.terminals.filter((t) => getState().statuses[t.id]?.busy).length
  const lost = [
    project.presets.length > 0 && `${project.presets.length} preset${project.presets.length > 1 ? 's' : ''}`,
    project.customCommands.length > 0 &&
      `${project.customCommands.length} custom command${project.customCommands.length > 1 ? 's' : ''}`,
    Object.keys(project.aliases).length > 0 && 'renamed scripts',
    'its terminal layout'
  ].filter(Boolean)
  const message = [
    `Remove "${project.name}" from MrTerminal?`,
    `Its settings here will be lost: ${lost.join(', ')}.`,
    running > 0 ? `${running} running process${running > 1 ? 'es' : ''} will be stopped.` : '',
    'The folder and its files are not touched.'
  ]
  if (!window.confirm(message.filter(Boolean).join('\n\n'))) return
  const index = getState().config?.projects.findIndex((p) => p.id === project.id) ?? 0
  rememberClosed({ kind: 'project', project, index })
  for (const terminal of project.terminals) disposeRuntime(terminal.id)
  removeProject(project.id)
}

/** Undo the last close: a terminal tab or a removed project (like ⇧⌘T in a browser). */
export function reopenClosed(): void {
  for (let item = takeClosed(); item; item = takeClosed()) {
    if (item.kind === 'project') {
      if (getProject(item.project.id)) continue
      restoreProject(item.project, item.index)
      return
    }
    const dock = getDock(item.projectId)
    // Its project may have been removed since; then try the one before.
    if (!dock || getProject(item.projectId)?.terminals.some((t) => t.id === item.def.id)) continue
    selectProject(item.projectId)
    dock.reopen(item.def, item.layout)
    return
  }
}

/** Shown on a tab when the script lives in a nested package: `web:dev`. */
export function scriptTitle(group: ScriptGroup | null, script: DetectedScript): string {
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
  const alias = project.aliases[aliasKey(project, script.command, script.cwd)]
  dock.open({ title: alias ?? scriptTitle(group, script), command: script.command, cwd: script.cwd })
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
    case 'reopen-closed':
      return reopenClosed()
    case 'settings':
      return setState({ settingsOpen: true })
    case 'check-updates':
      setState({ settingsOpen: true })
      return void window.api.update.check()
  }
}
