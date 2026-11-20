import { alsoKeysFor, keysFor, matchesKeys, type KeyPress } from '@shared/shortcuts'
import {
  DEFAULT_SETTINGS,
  type Config,
  type DetectedScript,
  type GlobalCommand,
  type MenuAction,
  type Project,
  type RestoreMode,
  type ScriptGroup
} from '@shared/types'
import { applyAppearance } from './appearance'
import { rememberClosed, takeClosed } from './closed'
import { findDock, getDock, withDock, type ProjectDock } from './dock'
import {
  addProject,
  addProjectFolder,
  aliasKey,
  editProject,
  getProject,
  getState,
  patchConfig,
  patchSettings,
  refreshScripts,
  removeProject,
  restoreProject,
  rerunCommand,
  setState,
  type SettingsTab
} from './store'
import { disposeRuntime, getRuntime, setCleanExitHandler, terminalForCommand } from './terminals'

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
  // With no projects there is still somewhere to type: a shell in the home folder.
  if (config.projects.length === 0) {
    const id = addProject(window.api.home, 'Home')
    withDock(id, (dock) => dock.openShell())
  }
}

export function applyRestore(mode: Exclude<RestoreMode, 'ask'>, remember: boolean): void {
  let config = getState().config as Config
  if (mode === 'fresh') {
    config = { ...config, projects: config.projects.map((p) => ({ ...p, terminals: [], layout: null })) }
  }
  if (remember) config = { ...config, settings: { ...config.settings, restoreOnLaunch: mode } }
  // Projects load when first shown, but what was running when the app quit
  // starts again right away, in every project.
  const { opened } = getState()
  const running = mode === 'resume'
    ? config.projects.filter((p) => !opened.includes(p.id) && p.terminals.some((t) => t.resume)).map((p) => p.id)
    : []
  setState({ ready: true, restoreRun: mode === 'resume', config, opened: [...opened, ...running] })
}

function activeProject(): Project | undefined {
  const id = getState().config?.activeProjectId
  return id ? getProject(id) : undefined
}

export async function pickProject(): Promise<void> {
  const picked = await window.api.pickFolder()
  if (!picked) return
  const id = await addProjectFolder(picked.path, picked.name)
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

/**
 * Terminals of the project whose command ran this session and has stopped:
 * what the project's play button starts again. Empty for a project that has
 * only just been opened, which has nothing of its own to run again yet.
 */
export function stoppedTerminals(project: Project): Project['terminals'] {
  const { ran, statuses } = getState()
  return project.terminals.filter((t) => ran.includes(t.id) && !statuses[t.id]?.busy && rerunCommand(t))
}

/** Start again every command of the project that ran this session and stopped. */
export function resumeAll(project: Project): void {
  for (const terminal of stoppedTerminals(project)) getRuntime(terminal.id)?.restart(undefined, false)
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
  const existing = forceNew ? undefined : terminalForCommand(project.terminals, script.command, script.cwd)
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

/** The terminal a global command can be typed into: the one on screen, if it is at a prompt. */
export function idleActiveTerminal(projectId: string): string | undefined {
  const id = getDock(projectId)?.activeId
  return id && !getState().statuses[id]?.busy ? id : undefined
}

/**
 * Run a global command (an agent, say) in the project's folder: in a new
 * terminal, or typed into the one on screen when it is at a prompt.
 */
export function runGlobalCommand(projectId: string, command: GlobalCommand, where: 'new' | 'current'): void {
  const project = getProject(projectId)
  if (!project) return
  withDock(projectId, (dock) => {
    const current = where === 'current' ? idleActiveTerminal(projectId) : undefined
    if (current) {
      window.api.pty.write(current, `${command.command}\r`)
      dock.focus(current)
      return
    }
    dock.open({ title: command.name, command: command.command, cwd: project.path })
  })
}

export function openSettings(tab: SettingsTab = 'general'): void {
  setState({ settingsOpen: true, settingsTab: tab })
}

/** The nth (from 1) of a list; 9 means the last, as in browsers. */
function nth<T>(list: T[], n: number): T | undefined {
  return n === 9 ? list.at(-1) : list[n - 1]
}

/**
 * The shortcuts the menu cannot bind (see KEYS): the second key of a few,
 * tab cycling, and Cmd+Shift+= (Cmd++) for bigger text.
 */
function rendererKeys(platform: string): [string, MenuAction][] {
  const mac = platform === 'darwin'
  const list: [string | undefined, MenuAction][] = [
    [alsoKeysFor('new-terminal', platform), 'new-terminal'],
    [keysFor('next-tab', platform), 'next-tab'],
    [alsoKeysFor('next-tab', platform), 'next-tab'],
    [keysFor('previous-tab', platform), 'previous-tab'],
    [alsoKeysFor('previous-tab', platform), 'previous-tab'],
    [mac ? 'Cmd+Shift+=' : 'Ctrl+Shift+=', 'zoom-in']
  ]
  return list.filter((entry): entry is [string, MenuAction] => !!entry[0])
}

let keyTable: [string, MenuAction][] | undefined

/** The action a key press stands for among the renderer's own shortcuts. */
export function rendererAction(press: KeyPress, platform: string): MenuAction | undefined {
  keyTable ??= rendererKeys(platform)
  return keyTable.find(([keys]) => matchesKeys(keys, press))?.[1]
}

/**
 * Cmd+1…9 goes to a tab of the project on screen, Cmd+Shift+1…9 to a
 * project (Ctrl outside macOS), plus the shortcuts in `rendererKeys`.
 * Caught before xterm sees the key.
 */
export function handleKey(event: KeyboardEvent): void {
  const mac = window.api.platform === 'darwin'
  const action = rendererAction(event, window.api.platform)
  if (action) {
    event.preventDefault()
    event.stopPropagation()
    return handleMenu(action)
  }
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

const MIN_FONT = 9
const MAX_FONT = 24

/** Bigger or smaller text in every terminal, saved like the Settings field. */
function zoom(step: number | 'reset'): void {
  const settings = getState().config?.settings
  if (!settings) return
  const size = step === 'reset' ? DEFAULT_SETTINGS.fontSize : Math.min(MAX_FONT, Math.max(MIN_FONT, settings.fontSize + step))
  if (size === settings.fontSize) return
  patchSettings({ fontSize: size })
  applyAppearance({ ...settings, fontSize: size })
}

/** The tab after (or before) the active one, in the order the tabs read on screen, wrapping round. */
function cycleTab(dock: ProjectDock, step: 1 | -1): void {
  const ids = dock.orderedIds
  if (ids.length < 2) return
  const at = dock.activeId ? ids.indexOf(dock.activeId) : -1
  dock.focus(ids[(at + step + ids.length) % ids.length])
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
    case 'next-tab':
      return dock ? cycleTab(dock, 1) : undefined
    case 'previous-tab':
      return dock ? cycleTab(dock, -1) : undefined
    case 'find':
      return activeId ? getRuntime(activeId)?.find() : undefined
    case 'zoom-in':
      return zoom(1)
    case 'zoom-out':
      return zoom(-1)
    case 'zoom-reset':
      return zoom('reset')
    case 'add-project':
      return void pickProject()
    case 'toggle-sidebar':
      return patchConfig({ sidebarHidden: !getState().config?.sidebarHidden })
    case 'toggle-compact':
      return patchConfig({ sidebarCompact: !getState().config?.sidebarCompact })
    case 'reopen-closed':
      return reopenClosed()
    case 'settings':
      return openSettings()
    case 'check-updates':
      openSettings()
      return void window.api.update.check()
  }
}
