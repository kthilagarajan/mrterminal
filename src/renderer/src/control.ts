import type { Terminal } from '@xterm/xterm'
import type { AppState, TermInfo } from '@shared/control'
import type { DetectedScript, Project, ScriptGroup, TerminalDef } from '@shared/types'
import { removeProjectNow, scriptTitle } from './actions'
import { customCwd, folderName, getDock, findDock, renameCommand, type Placement, type ProjectDock } from './dock'
import { addProject, aliasKey, editProject, getProject, getState, patchConfig, refreshScripts, uid } from './store'
import { getRuntime, holdFocus } from './terminals'

/**
 * Answers `mrt` (forwarded by main). Everything goes through the same
 * terminals, tabs and config edits as clicks do, and every terminal an agent
 * touches is brought on screen, so the user sees what it does and can step
 * in. Only the keyboard focus stays where the user left it.
 */

type Params = Record<string, unknown>

class Failure extends Error {}

function project(id: unknown): Project {
  const found = typeof id === 'string' ? getProject(id) : undefined
  if (!found) throw new Failure('That project is gone.')
  return found
}

function owner(terminalId: unknown): { project: Project; def: TerminalDef } {
  for (const p of getState().config?.projects ?? []) {
    const def = p.terminals.find((t) => t.id === terminalId)
    if (def) return { project: p, def }
  }
  throw new Failure('That terminal is gone.')
}

/** A project's dock exists once React has mounted its workspace. */
async function dockFor(projectId: string): Promise<ProjectDock> {
  for (let i = 0; i < 60; i++) {
    const dock = getDock(projectId)
    if (dock) return dock
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Failure('The project did not open in time.')
}

/** Switch to the project and tab, leaving the keyboard alone. */
async function reveal(projectId: string, terminalId?: string): Promise<void> {
  holdFocus()
  if (getState().config?.activeProjectId !== projectId) patchConfig({ activeProjectId: projectId })
  if (terminalId) (await dockFor(projectId)).reveal(terminalId)
}

function termInfo(p: Project, t: TerminalDef): TermInfo {
  const status = getState().statuses[t.id]
  return {
    id: t.id,
    projectId: p.id,
    project: p.name,
    title: t.title,
    cwd: getRuntime(t.id)?.cwd ?? t.cwd,
    command: t.command,
    running: status?.busy ?? false,
    process: status?.process ?? '',
    active: getDock(p.id)?.activeId === t.id,
    shellExitCode: status?.exitCode
  }
}

function infoFor(projectId: string, terminalId: string): TermInfo {
  const p = project(projectId)
  const def = p.terminals.find((t) => t.id === terminalId)
  if (!def) throw new Failure('The terminal closed straight away.')
  return termInfo(p, def)
}

function appState(): AppState {
  const { config, ready } = getState()
  return {
    ready,
    activeProjectId: config?.activeProjectId ?? null,
    projects: (config?.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      active: p.id === config?.activeProjectId,
      terminals: p.terminals.map((t) => termInfo(p, t)),
      presets: p.presets.map((x) => ({ name: x.name, terminals: x.terminals.length })),
      commands: p.customCommands.map(({ name, command, cwd }) => ({ name, command, cwd }))
    }))
  }
}

/** A script or custom command called `target` (its name, tab title, alias or command line). */
async function findRunnable(p: Project, target: string): Promise<{ group: ScriptGroup | null; script: DetectedScript } | null> {
  const lower = target.toLowerCase()
  const custom = p.customCommands.find((c) => c.name.toLowerCase() === lower || c.command === target)
  if (custom) {
    return { group: null, script: { name: custom.name, command: custom.command, cwd: customCwd(p, custom.cwd) } }
  }
  if (!getState().scripts[p.id]) await refreshScripts(p.id)
  const found: { group: ScriptGroup; script: DetectedScript }[] = []
  for (const group of getState().scripts[p.id] ?? []) {
    for (const script of group.scripts) {
      const alias = p.aliases[aliasKey(p, script.command, script.cwd)]
      const names = [script.name, scriptTitle(group, script), alias].filter(Boolean).map((n) => n!.toLowerCase())
      if (names.includes(lower) || script.command === target) found.push({ group, script })
    }
  }
  if (found.length <= 1) return found[0] ?? null
  // The same name in several folders: the project root wins, else ask.
  const root = found.filter((f) => f.group.relDir === '')
  if (root.length >= 1) return root[0]
  throw new Failure(
    `"${target}" is defined in more than one place; pick one:\n` +
      found.map((f) => `  ${scriptTitle(f.group, f.script)}  (${f.script.command} in ${f.script.cwd})`).join('\n')
  )
}

/** Plain text from a terminal's buffer, as it is drawn: wrapped lines joined back. */
function bufferText(term: Terminal, mode: unknown, lines: unknown): string {
  const buffer = term.buffer.active
  let last = buffer.length - 1
  while (last >= 0 && !buffer.getLine(last)?.translateToString(true).trim()) last--
  const count = typeof lines === 'number' && lines > 0 ? lines : 50
  const first = mode === 'all' ? 0 : mode === 'lines' ? Math.max(0, last - count + 1) : buffer.baseY
  const out: string[] = []
  for (let i = first; i <= last; i++) {
    const line = buffer.getLine(i)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped && out.length > 0) out[out.length - 1] += text
    else out.push(text)
  }
  return out.join('\n')
}

const handlers: Record<string, (p: Params) => unknown> = {
  state: () => appState(),

  async 'project.add'({ path, name }) {
    const id = addProject(String(path), String(name))
    void refreshScripts(id)
    await dockFor(id)
    return id
  },
  'project.remove': ({ projectId }) => removeProjectNow(project(projectId)),
  'project.select': ({ projectId }) => reveal(project(projectId).id),

  async open({ projectId, cwd, title, command, placement }) {
    const p = project(projectId)
    await reveal(p.id)
    const dir = String(cwd)
    const cmd = typeof command === 'string' ? command : undefined
    const def = (await dockFor(p.id)).open(
      { title: typeof title === 'string' ? title : (cmd ?? folderName(dir)), cwd: dir, command: cmd },
      (placement as Placement) ?? 'auto',
      undefined,
      false
    )
    return infoFor(p.id, def.id)
  },

  async run({ projectId, target, cwd, title, new: forceNew }) {
    const p = project(projectId)
    const found = await findRunnable(p, String(target))
    const command = found?.script.command ?? String(target)
    const dir = (typeof cwd === 'string' ? cwd : undefined) ?? found?.script.cwd ?? p.path
    const dock = await dockFor(p.id)
    await reveal(p.id)

    // Like the sidebar: a command that already has a terminal reuses it.
    const existing = forceNew ? undefined : p.terminals.find((t) => t.command === command && t.cwd === dir)
    if (existing) {
      dock.reveal(existing.id)
      if (getState().statuses[existing.id]?.busy) return { terminal: termInfo(p, existing), action: 'already-running' }
      getRuntime(existing.id)?.restart(undefined, false)
      return { terminal: termInfo(p, existing), action: 'restarted' }
    }
    const alias = p.aliases[aliasKey(p, command, dir)]
    const name =
      (typeof title === 'string' ? title : undefined) ?? alias ?? (found ? scriptTitle(found.group, found.script) : command)
    const def = dock.open({ title: name, command, cwd: dir }, 'auto', undefined, false)
    return { terminal: infoFor(p.id, def.id), action: 'started' }
  },

  async restart({ projectId, terminalId }) {
    await reveal(String(projectId), String(terminalId))
    getRuntime(String(terminalId))?.restart(undefined, false)
  },
  close: ({ terminalId }) => findDock(String(terminalId))?.close(String(terminalId)),
  show: ({ projectId, terminalId }) => reveal(String(projectId), String(terminalId)),

  rename({ projectId, terminalId, title }) {
    const { def } = owner(terminalId)
    const name = String(title)
    // As when renaming the tab: a command's terminal shares its name with the sidebar entry.
    if (def.command) return renameCommand(String(projectId), def.command, def.cwd, name)
    getDock(String(projectId))?.api.getPanel(def.id)?.api.setTitle(name)
    editProject(String(projectId), (p) => ({
      ...p,
      terminals: p.terminals.map((t) => (t.id === def.id ? { ...t, title: name } : t))
    }))
  },

  screen({ terminalId, mode, lines }) {
    const runtime = getRuntime(String(terminalId))
    if (!runtime) throw new Failure('That terminal is gone.')
    return bufferText(runtime.term, mode, lines)
  },

  async 'preset.launch'({ projectId, name }) {
    const p = project(projectId)
    const preset = p.presets.find((x) => x.name.toLowerCase() === String(name).toLowerCase())
    if (!preset) throw new Failure(`No preset "${name}".`)
    await reveal(p.id)
    holdFocus()
    ;(await dockFor(p.id)).launch(preset)
  },
  async 'preset.save'({ projectId, name }) {
    const p = project(projectId)
    const snapshot = (await dockFor(p.id)).snapshot()
    if (snapshot.terminals.length === 0) throw new Failure('No terminals are open in this project to save.')
    const lower = String(name).toLowerCase()
    const existing = p.presets.find((x) => x.name.toLowerCase() === lower)
    const preset = { id: existing?.id ?? uid(), name: existing?.name ?? String(name), ...snapshot }
    editProject(p.id, (x) => ({
      ...x,
      presets: existing ? x.presets.map((y) => (y.id === existing.id ? preset : y)) : [...x.presets, preset]
    }))
  },
  'preset.delete'({ projectId, name }) {
    const lower = String(name).toLowerCase()
    editProject(project(projectId).id, (x) => ({ ...x, presets: x.presets.filter((y) => y.name.toLowerCase() !== lower) }))
  },

  'command.add'({ projectId, name, command, cwd }) {
    const entry = { id: uid(), name: String(name), command: String(command), cwd: typeof cwd === 'string' ? cwd : undefined }
    editProject(project(projectId).id, (x) => ({
      ...x,
      // Adding a name that exists replaces that command.
      customCommands: [...x.customCommands.filter((c) => c.name !== entry.name), entry]
    }))
  },
  'command.remove'({ projectId, name }) {
    editProject(project(projectId).id, (x) => ({ ...x, customCommands: x.customCommands.filter((c) => c.name !== name) }))
  }
}

export function connectControl(): void {
  window.api.control.onRequest(async ({ id, method, params }) => {
    try {
      const handler = handlers[method]
      if (!handler) throw new Failure(`Unknown method: ${method}`)
      if (method !== 'state' && !getState().ready) throw new Failure('MrTerminal is asking how to restore the last session.')
      window.api.control.respond(id, { result: await handler(params) })
    } catch (err) {
      window.api.control.respond(id, { error: (err as Error).message })
    }
  })
}
