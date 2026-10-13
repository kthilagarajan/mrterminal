import {
  createDockview,
  type DockviewApi,
  type DockviewGroupPanel,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type IDockviewPanel,
  type IHeaderActionsRenderer,
  type ITabRenderer,
  type IWatermarkRenderer
} from 'dockview'
import type { Preset, TerminalDef } from '@shared/types'
import { icons, type IconName } from './icons'
import {
  addTerminalDef,
  editProject,
  getProject,
  getState,
  removeTerminalDef,
  subscribe,
  uid
} from './store'
import { disposeRuntime, ensureRuntime, getRuntime } from './terminals'

export type Placement = 'auto' | 'right' | 'below' | 'tab'

const docks = new Map<string, ProjectDock>()

export function getDock(projectId: string): ProjectDock | undefined {
  return docks.get(projectId)
}

/** The dock that owns a terminal, wherever it is. */
export function findDock(terminalId: string): ProjectDock | undefined {
  for (const dock of docks.values()) if (dock.api.getPanel(terminalId)) return dock
  return undefined
}

function button(icon: IconName, title: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.className = 'icon-btn'
  el.title = title
  el.innerHTML = icons[icon]
  // Keep dockview from starting a tab drag or stealing terminal focus.
  el.addEventListener('pointerdown', (event) => event.stopPropagation())
  el.addEventListener('mousedown', (event) => event.stopPropagation())
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick(event)
  })
  return el
}

class TerminalPanel implements IContentRenderer {
  readonly element = document.createElement('div')
  private disposers: (() => void)[] = []

  constructor(private id: string) {
    this.element.className = 'term-host'
  }

  init({ api }: GroupPanelPartInitParameters): void {
    const runtime = getRuntime(this.id)
    if (!runtime) return
    this.element.appendChild(runtime.el)
    const focus = api.onDidActiveChange((event) => {
      if (event.isActive) runtime.focus()
    })
    this.disposers.push(() => focus.dispose())
  }

  focus(): void {
    getRuntime(this.id)?.focus()
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose()
  }
}

class TerminalTab implements ITabRenderer {
  readonly element = document.createElement('div')
  private disposers: (() => void)[] = []

  constructor(private projectId: string) {
    this.element.className = 'tab'
  }

  init({ api }: GroupPanelPartInitParameters): void {
    const id = api.id
    const dot = document.createElement('span')
    const title = document.createElement('span')
    title.className = 'tab-title'
    title.textContent = api.title ?? ''

    const paint = (): void => {
      const status = getState().statuses[id]
      const state = status?.exitCode !== undefined ? 'exited' : status?.busy ? 'busy' : 'idle'
      dot.className = `dot dot-${state}`
      const def = getRuntime(id)?.def
      this.element.title = [
        def?.command ?? 'Shell',
        state === 'busy' ? `running: ${status?.process}` : state,
        def?.cwd
      ].join('\n')
    }
    paint()
    this.disposers.push(subscribe(paint))

    const titleChange = api.onDidTitleChange((event) => {
      title.textContent = event.title
    })
    this.disposers.push(() => titleChange.dispose())

    title.addEventListener('dblclick', () => this.rename(title, api))

    this.element.append(
      dot,
      title,
      button('restart', 'Restart', () => getRuntime(id)?.restart()),
      button('close', 'Close', () => api.close())
    )
  }

  private rename(title: HTMLElement, api: GroupPanelPartInitParameters['api']): void {
    const input = document.createElement('input')
    input.className = 'tab-rename'
    input.value = api.title ?? ''
    input.size = Math.max(4, input.value.length)
    title.replaceWith(input)
    input.select()
    let done = false
    const finish = (commit: boolean): void => {
      if (done) return
      done = true
      const value = input.value.trim()
      input.replaceWith(title)
      if (!commit || !value) return
      api.setTitle(value)
      editProject(this.projectId, (p) => ({
        ...p,
        terminals: p.terminals.map((t) => (t.id === api.id ? { ...t, title: value } : t))
      }))
    }
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('mousedown', (event) => event.stopPropagation())
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') finish(true)
      if (event.key === 'Escape') finish(false)
    })
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose()
  }
}

class GroupActions implements IHeaderActionsRenderer {
  readonly element = document.createElement('div')

  constructor(
    private dock: ProjectDock,
    private group: DockviewGroupPanel
  ) {
    this.element.className = 'group-actions'
  }

  init(): void {
    const { dock, group } = this
    this.element.append(
      button('plus', 'New terminal in this pane', () => dock.openShell('tab', group)),
      button('splitRight', 'Split right', () => dock.openShell('right', group)),
      button('splitDown', 'Split down', () => dock.openShell('below', group)),
      button('maximize', 'Maximize / restore', () => {
        if (group.api.isMaximized()) group.api.exitMaximized()
        else group.api.maximize()
      })
    )
  }

  dispose(): void {}
}

class Watermark implements IWatermarkRenderer {
  readonly element = document.createElement('div')

  init(): void {
    const mod = window.api.platform === 'darwin' ? '⌘' : 'Ctrl+Shift+'
    this.element.className = 'watermark'
    this.element.innerHTML = `
      <div class="watermark-title">No terminals yet</div>
      <div>Pick a script from the sidebar to run it here,</div>
      <div>or press <kbd>${mod}T</kbd> for a shell.</div>`
  }
}

/** Rewrite the panel ids inside a saved layout, wherever they appear. */
function renameIds(node: unknown, ids: Map<string, string>): unknown {
  if (typeof node === 'string') return ids.get(node) ?? node
  if (Array.isArray(node)) return node.map((item) => renameIds(item, ids))
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [ids.get(key) ?? key, renameIds(value, ids)])
    )
  }
  return node
}

/** One project's arrangement of terminals: splits, tabs and their sizes. */
export class ProjectDock {
  readonly api: DockviewApi
  /** Set while panels come and go for reasons other than the user closing them. */
  private quiet = false
  private saveTimer = 0

  constructor(
    container: HTMLElement,
    private projectId: string
  ) {
    this.api = createDockview(container, {
      className: 'dockview-theme-abyss mrt-dock',
      disableFloatingGroups: true,
      createComponent: ({ id }) => new TerminalPanel(id),
      createTabComponent: () => new TerminalTab(projectId),
      defaultTabComponent: 'tab',
      createRightHeaderActionComponent: (group) => new GroupActions(this, group),
      createWatermarkComponent: () => new Watermark()
    })
    docks.set(projectId, this)
    this.restore()

    this.api.onDidRemovePanel((panel) => {
      if (this.quiet) return
      disposeRuntime(panel.id)
      removeTerminalDef(projectId, panel.id)
    })
    this.api.onDidLayoutChange(() => {
      if (this.quiet) return
      window.clearTimeout(this.saveTimer)
      this.saveTimer = window.setTimeout(() => this.saveLayout(), 200)
    })
  }

  /** Rebuild the previous session: saved layout first, plain tabs as a fallback. */
  private restore(): void {
    const project = getProject(this.projectId)
    if (!project) return
    const run = getState().restoreRun
    for (const def of project.terminals) ensureRuntime(def, run)
    this.applyLayout(project.layout)
  }

  /** Arrange the project's terminals as `layout` says, as far as it still applies. */
  private applyLayout(layout: unknown | null): void {
    const terminals = getProject(this.projectId)?.terminals ?? []
    this.quiet = true
    try {
      if (layout && terminals.length > 0) {
        this.api.fromJSON(layout as Parameters<DockviewApi['fromJSON']>[0])
      }
    } catch (err) {
      console.warn('Saved layout could not be restored:', err)
      this.api.clear()
    }
    // Reconcile: the terminal list is the source of truth, not the layout.
    const known = new Set(terminals.map((t) => t.id))
    for (const panel of [...this.api.panels]) if (!known.has(panel.id)) panel.api.close()
    for (const def of terminals) if (!this.api.getPanel(def.id)) this.addPanel(def, 'auto')
    this.quiet = false
  }

  /** The open terminals and their arrangement, for saving as a preset. */
  snapshot(): Pick<Preset, 'terminals' | 'layout'> {
    const terminals = getProject(this.projectId)?.terminals ?? []
    return { terminals: terminals.map((t) => ({ ...t })), layout: terminals.length > 0 ? this.api.toJSON() : null }
  }

  /**
   * Bring up a preset in its saved arrangement. Terminals of it that are
   * already open are kept (their processes are not touched, stopped ones are
   * re-run) and moved into place; the rest are started. Terminals that are not
   * part of the preset stay open alongside.
   */
  launch(preset: Preset): void {
    const open = getProject(this.projectId)?.terminals ?? []
    const taken = new Set<string>()
    const ids = new Map<string, string>()
    const stopped: string[] = []

    for (const terminal of preset.terminals) {
      const existing = open.find(
        (o) => !taken.has(o.id) && o.command === terminal.command && o.cwd === terminal.cwd
      )
      if (existing) {
        taken.add(existing.id)
        ids.set(terminal.id, existing.id)
        if (existing.command && !getState().statuses[existing.id]?.busy) stopped.push(existing.id)
      } else {
        const def = { ...terminal, id: uid() }
        ids.set(terminal.id, def.id)
        addTerminalDef(this.projectId, def)
        ensureRuntime(def, true)
      }
    }

    this.applyLayout(preset.layout ? renameIds(preset.layout, ids) : null)
    this.saveLayout()
    for (const id of stopped) getRuntime(id)?.restart()
    this.focus(ids.get(preset.terminals[0]?.id))
  }

  private saveLayout(): void {
    const layout = this.api.panels.length > 0 ? this.api.toJSON() : null
    editProject(this.projectId, (p) => ({ ...p, layout }))
  }

  private addPanel(def: TerminalDef, placement: Placement, group?: DockviewGroupPanel): IDockviewPanel {
    const reference = group ?? this.api.activeGroup ?? this.api.groups[0]
    let direction: 'right' | 'below' | 'within' = 'within'
    if (placement === 'right' || placement === 'below') direction = placement
    else if (placement === 'auto') {
      // Tile the first few so two or three processes are visible side by side,
      // then stack further ones as tabs rather than shrinking every pane.
      const groups = this.api.groups.length
      direction = groups < 2 ? 'right' : groups < 4 ? 'below' : 'within'
    }
    return this.api.addPanel({
      id: def.id,
      component: 'terminal',
      tabComponent: 'tab',
      title: def.title,
      position: reference && this.api.panels.length > 0 ? { referenceGroup: reference, direction } : undefined
    })
  }

  open(spec: Omit<TerminalDef, 'id'>, placement: Placement = 'auto', group?: DockviewGroupPanel): void {
    const def: TerminalDef = { ...spec, id: uid() }
    addTerminalDef(this.projectId, def)
    ensureRuntime(def, true)
    this.addPanel(def, placement, group).api.setActive()
    getRuntime(def.id)?.focus()
  }

  openShell(placement: Placement = 'auto', group?: DockviewGroupPanel): void {
    const project = getProject(this.projectId)
    if (project) this.open({ title: 'shell', cwd: project.path }, placement, group)
  }

  focus(id?: string): void {
    const panel = id ? this.api.getPanel(id) : (this.api.activePanel ?? this.api.panels[0])
    if (!panel) return
    panel.api.setActive()
    getRuntime(panel.id)?.focus()
  }

  get activeId(): string | undefined {
    return this.api.activePanel?.id
  }

  close(id: string): void {
    this.api.getPanel(id)?.api.close()
  }

  /** Tear down the view only; terminals are disposed by whoever removed them. */
  dispose(): void {
    this.quiet = true
    window.clearTimeout(this.saveTimer)
    docks.delete(this.projectId)
    this.api.dispose()
  }
}
