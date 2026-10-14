import type { Config, DetectedScript, MenuAction, Project, RestoreMode, ScriptGroup } from '@shared/types'
import { applyAppearance } from './appearance'
import { rememberClosed, takeClosed } from './closed'
import { findDock, getDock, withDock, type ProjectDock } from './dock'
import {
  addProject,
  aliasKey,
  editProject,
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

let quitTimer: number | undefined

export async function boot(): Promise<void> {
  window.api.onQuitArmed((ms) => {
    setState({ quitArmed: true })
    window.clearTimeout(quitTimer)
    quitTimer = window.setTimeout(() => setState({ quitArmed: false }), ms)
  })
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
  withDock(projectId, (dock) => dock.focus(id))
}

/** A new display name; the folder keeps its own. */
export function renameProject(id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed) editProject(id, (p) => ({ ...p, name: trimmed }))
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
  removeProjectNow(project)
}

/** Remove a project without asking; it can still be reopened. */
export function removeProjectNow(project: Project): void {
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
    const { projectId, def, layout } = item
    // Its project may have been removed since; then try the one before.
    const project = getProject(projectId)
    if (!project || project.terminals.some((t) => t.id === def.id)) continue
    selectProject(projectId)
    withDock(projectId, (dock) => dock.reopen(def, layout))
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
  withDock(project.id, (dock) => {
    const current = getProject(project.id)
    if (current) runIn(dock, current, group, script, forceNew)
  })
}

function runIn(dock: ProjectDock, project: Project, group: ScriptGroup | null, script: DetectedScript, forceNew: boolean): void {
  const existing = forceNew
    ? undefined
    : project.terminals.find((t) => t.command === script.command && t.cwd === script.cwd)
  if (existing) {
    dock.focus(existing.id)
    // A terminal of a project that was only just loaded has not started yet;
    // restarting it starts it, running its command.
    if (!getState().statuses[existing.id]?.busy) getRuntime(existing.id)?.restart()
    return
  }
  const alias = project.aliases[aliasKey(project, script.command, script.cwd)]
  dock.open({ title: alias ?? scriptTitle(group, script), command: script.command, cwd: script.cwd })
}

/** The nth (from 1) of a list; 9 means the last, as in browsers. */
function nth<T>(list: T[], n: number): T | undefined {
  return n === 9 ? list.at(-1) : list[n - 1]
}

/**
 * Cmd+1…9 goes to a tab of the project on screen, Cmd+Shift+1…9 to a
 * project (Ctrl outside macOS). Caught before xterm sees the key.
 */
export function handleKey(event: KeyboardEvent): void {
  const mac = window.api.platform === 'darwin'
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  const digit = /^Digit([1-9])$/.exec(event.code)
  if (!modifier || event.altKey || !digit) return
  event.preventDefault()
  event.stopPropagation()
  const n = Number(digit[1])
  if (event.shiftKey) {
    const project = nth(getState().config?.projects ?? [], n)
    if (project) selectProject(project.id)
    return
  }
  const project = activeProject()
  const dock = project && getDock(project.id)
  const id = dock && nth(dock.orderedIds, n)
  if (id) dock.focus(id)
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
    case 'toggle-compact':
      return patchConfig({ sidebarCompact: !getState().config?.sidebarCompact })
    case 'reopen-closed':
      return reopenClosed()
    case 'settings':
      return setState({ settingsOpen: true })
    case 'check-updates':
      setState({ settingsOpen: true })
      return void window.api.update.check()
  }
}
