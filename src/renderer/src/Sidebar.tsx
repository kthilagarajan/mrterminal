import { useState, type FormEvent, type MouseEvent } from 'react'
import type { Config, CustomCommand, DetectedScript, Preset, Project } from '@shared/types'
import { getDock } from './dock'
import { deleteProject, pickProject, runScript, selectProject } from './actions'
import { Icon } from './Icon'
import { editProject, patchConfig, refreshScripts, setState, uid, useStore, type TermStatus } from './store'

type ScriptState = 'running' | 'open' | 'none'

function scriptState(
  project: Project,
  statuses: Record<string, TermStatus>,
  script: { command?: string; cwd: string }
): ScriptState {
  const terminal = project.terminals.find((t) => t.command === script.command && t.cwd === script.cwd)
  if (!terminal) return 'none'
  return statuses[terminal.id]?.busy ? 'running' : 'open'
}

function ScriptRow({
  script,
  state,
  hint: customHint,
  onRun,
  onEdit,
  onRemove
}: {
  script: DetectedScript
  state: ScriptState
  /** Replaces the default "click to run" tooltip line. */
  hint?: string
  onRun: (event: MouseEvent) => void
  onEdit?: () => void
  onRemove?: () => void
}) {
  const copy = `${window.api.platform === 'darwin' ? '⌥' : 'Alt+'}click for another copy`
  const hint =
    customHint ??
    `${state === 'running' ? 'Running. Click to show it' : state === 'open' ? 'Click to run it again' : 'Click to run'} · ${copy}`
  return (
    <div
      className={`script script-${state}`}
      role="button"
      title={`${script.command}\n${script.detail ?? ''}\n\n${hint}`}
      onClick={onRun}
    >
      <span className="script-icon">{state === 'running' ? <span className="dot dot-busy" /> : <Icon name="play" />}</span>
      <span className="script-name">{script.name}</span>
      <span className="script-detail">{script.detail ?? script.command}</span>
      {onEdit && (
        <button
          className="icon-btn script-remove"
          title="Edit this command"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <Icon name="edit" />
        </button>
      )}
      {onRemove && (
        <button
          className="icon-btn script-remove"
          title="Delete this command"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <Icon name="close" />
        </button>
      )}
    </div>
  )
}

/** Where a custom command runs: its own folder if it has one, else the project root. */
function commandCwd(project: Project, cwd: string | undefined): string {
  const folder = cwd?.trim().replace(/^\.\//, '')
  if (!folder || folder === '.') return project.path
  if (folder.startsWith('~')) return window.api.home + folder.slice(1)
  if (folder.startsWith('/') || /^[A-Za-z]:[\\/]/.test(folder)) return folder
  return `${project.path}/${folder}`
}

/** Add a custom command to the project, or edit `existing`. */
function CommandForm({ project, existing, onDone }: { project: Project; existing?: CustomCommand; onDone: () => void }) {
  const [command, setCommand] = useState(existing?.command ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [cwd, setCwd] = useState(existing?.cwd ?? '')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!command.trim()) return
    const entry: CustomCommand = {
      id: existing?.id ?? uid(),
      name: name.trim() || command.trim().split(/\s+/)[0],
      command: command.trim(),
      cwd: cwd.trim() || undefined
    }
    editProject(project.id, (p) => ({
      ...p,
      customCommands: existing
        ? p.customCommands.map((c) => (c.id === existing.id ? entry : c))
        : [...p.customCommands, entry]
    }))
    onDone()
  }

  return (
    <form className="add-command" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <input autoFocus placeholder="Command, e.g. docker compose up db" spellCheck={false} value={command} onChange={(e) => setCommand(e.target.value)} />
      <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        placeholder="Folder (optional), e.g. apps/api"
        title="Where to run it: relative to the project, or an absolute path. Empty = project root."
        spellCheck={false}
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
      />
      <div className="add-command-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!command.trim()}>
          {existing ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  )
}

/** Name a new preset made from the open terminals, or rename / re-capture `existing`. */
function PresetForm({ project, existing, onDone }: { project: Project; existing?: Preset; onDone: () => void }) {
  const [name, setName] = useState(existing?.name ?? `Preset ${project.presets.length + 1}`)
  const [recapture, setRecapture] = useState(false)
  const count = project.terminals.length

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const dock = getDock(project.id)
    if (!name.trim() || !dock) return
    const content = existing && !recapture ? existing : dock.snapshot()
    const preset: Preset = {
      id: existing?.id ?? uid(),
      name: name.trim(),
      terminals: content.terminals,
      layout: content.layout
    }
    editProject(project.id, (p) => ({
      ...p,
      presets: existing ? p.presets.map((x) => (x.id === existing.id ? preset : x)) : [...p.presets, preset]
    }))
    onDone()
  }

  return (
    <form className="add-command" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <input autoFocus placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
      {existing ? (
        <label className="check small">
          <input type="checkbox" checked={recapture} disabled={count === 0} onChange={(e) => setRecapture(e.target.checked)} />
          Replace with the {count} terminal{count === 1 ? '' : 's'} open now
        </label>
      ) : (
        <p className="empty">
          Saves the {count} open terminal{count === 1 ? '' : 's'} and how they are arranged.
        </p>
      )}
      <div className="add-command-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Save
        </button>
      </div>
    </form>
  )
}

type MapNode = { size: number } & ({ kind: 'leaf'; ids: string[] } | { kind: 'branch'; children: MapNode[] })

/** Read the split tree out of a saved dockview layout; null if there is none. */
function parseLayout(layout: unknown): { root: MapNode; horizontal: boolean; ratio: number } | null {
  type Raw = { type?: string; size?: number; data?: unknown }
  const node = (raw: Raw): MapNode | null => {
    const size = typeof raw?.size === 'number' && raw.size > 0 ? raw.size : 1
    if (raw?.type === 'leaf') {
      const views = (raw.data as { views?: unknown })?.views
      return Array.isArray(views) ? { kind: 'leaf', size, ids: views.filter((v) => typeof v === 'string') } : null
    }
    if (raw?.type === 'branch' && Array.isArray(raw.data)) {
      const children = raw.data.map(node).filter((n): n is MapNode => n !== null)
      return children.length > 0 ? { kind: 'branch', size, children } : null
    }
    return null
  }
  const grid = (layout as { grid?: { root?: Raw; orientation?: string; width?: number; height?: number } })?.grid
  const root = grid?.root ? node(grid.root) : null
  if (!grid || !root) return null
  const ratio = grid.width && grid.height ? grid.width / grid.height : 1.6
  return { root, horizontal: grid.orientation !== 'VERTICAL', ratio: Math.min(3, Math.max(1, ratio)) }
}

/** Pane ids in reading order: the order the terminals are numbered in. */
function leafIds(node: MapNode): string[] {
  return node.kind === 'leaf' ? node.ids : node.children.flatMap(leafIds)
}

function LayoutMap({ node, horizontal, label }: { node: MapNode; horizontal: boolean; label: Map<string, { n: number; title: string }> }) {
  if (node.kind === 'branch') {
    return (
      <div className="map-branch" style={{ flexGrow: node.size, flexDirection: horizontal ? 'row' : 'column' }}>
        {node.children.map((child, i) => (
          <LayoutMap key={i} node={child} horizontal={!horizontal} label={label} />
        ))}
      </div>
    )
  }
  const items = node.ids.map((id) => label.get(id)).filter((x) => x !== undefined)
  return (
    <div className="map-leaf" style={{ flexGrow: node.size }} title={items.length > 1 ? 'Tabs in the same pane' : undefined}>
      {items.map((item) => (
        <div className="map-item" key={item.n}>
          <b className="num">{item.n}</b>
          <span>{item.title}</span>
        </div>
      ))}
    </div>
  )
}

/** What a preset will do: a miniature of the window, and the command behind each number. */
function PresetDetails({ project, preset }: { project: Project; preset: Preset }) {
  const layout = parseLayout(preset.layout)
  const order = layout ? leafIds(layout.root) : []
  const terminals = [...preset.terminals].sort((a, b) => {
    const [ia, ib] = [order.indexOf(a.id), order.indexOf(b.id)]
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
  })
  const label = new Map(terminals.map((t, i) => [t.id, { n: i + 1, title: t.title }]))

  return (
    <div className="preset-body">
      {layout && (
        <>
          <div className="preset-caption">Opens in this layout</div>
          <div className="map" style={{ aspectRatio: String(layout.ratio) }}>
            <LayoutMap node={layout.root} horizontal={layout.horizontal} label={label} />
          </div>
        </>
      )}
      <ol className="preset-list">
        {terminals.map((t, i) => {
          const folder = t.cwd.startsWith(`${project.path}/`) ? t.cwd.slice(project.path.length + 1) : ''
          return (
            <li key={t.id} title={`${t.command ?? 'Shell'}\n${t.cwd}`}>
              <b className="num">{i + 1}</b>
              <span>{t.title}</span>
              <code>
                {t.command ?? 'shell'}
                {folder && ` · in ${folder}/`}
              </code>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Presets({ project, statuses }: { project: Project; statuses: Record<string, TermStatus> }) {
  /** 'new', the id of the preset being edited, or null when the form is closed. */
  const [editing, setEditing] = useState<string | null>(null)
  const canSave = project.terminals.length > 0

  return (
    <div className="group">
      <div className="group-head group-head-static">
        <span className="group-name">Presets</span>
        <button
          className="icon-btn"
          disabled={!canSave}
          title={canSave ? 'Save the open terminals as a preset' : 'Open some terminals first, then save them as a preset'}
          onClick={() => setEditing('new')}
        >
          <Icon name="plus" />
        </button>
      </div>
      {project.presets.map((preset) => {
        if (editing === preset.id) {
          return <PresetForm key={preset.id} project={project} existing={preset} onDone={() => setEditing(null)} />
        }
        // Running = everything in it is open and none of its commands has stopped.
        const states = preset.terminals.map((t) => ({ t, state: scriptState(project, statuses, t) }))
        const allOpen = states.every((s) => s.state !== 'none')
        const state: ScriptState =
          allOpen && states.every((s) => !s.t.command || s.state === 'running')
            ? 'running'
            : states.some((s) => s.state !== 'none')
              ? 'open'
              : 'none'
        const count = preset.terminals.length
        return (
          <div className="preset" key={preset.id}>
            <ScriptRow
              script={{ name: preset.name, command: preset.name, cwd: project.path, detail: `${count} terminal${count === 1 ? '' : 's'}` }}
              state={state}
              hint={
                state === 'running'
                  ? 'All running. Click to put them back in this layout'
                  : state === 'open'
                    ? 'Click to start the ones that are not running'
                    : 'Click to open them all'
              }
              onRun={() => getDock(project.id)?.launch(preset)}
              onEdit={() => setEditing(preset.id)}
              onRemove={() => editProject(project.id, (p) => ({ ...p, presets: p.presets.filter((x) => x.id !== preset.id) }))}
            />
            <PresetDetails project={project} preset={preset} />
          </div>
        )
      })}
      {editing === 'new' && <PresetForm project={project} onDone={() => setEditing(null)} />}
      {editing === null && project.presets.length === 0 && (
        <p className="empty">
          {canSave
            ? 'Press + to save the open terminals as a preset, then start them all with one click.'
            : 'Open the terminals you want together, then save them here to start them all with one click.'}
        </p>
      )}
    </div>
  )
}

function Scripts({ project }: { project: Project }) {
  const groups = useStore((s) => s.scripts[project.id])
  const statuses = useStore((s) => s.statuses)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  /** 'new', the id of the command being edited, or null when the form is closed. */
  const [editing, setEditing] = useState<string | null>(null)

  const query = filter.trim().toLowerCase()
  const matches = (s: DetectedScript): boolean =>
    !query || s.name.toLowerCase().includes(query) || s.command.toLowerCase().includes(query)
  const total = (groups ?? []).reduce((n, g) => n + g.scripts.length, 0)

  const custom = project.customCommands
    .map((c) => ({
      entry: c,
      script: { name: c.name, command: c.command, cwd: commandCwd(project, c.cwd), detail: c.command }
    }))
    .filter((c) => matches(c.script))

  return (
    <section className="scripts">
      <div className="section-head">
        <span>Scripts</span>
        <button className="icon-btn" title="Re-read scripts from disk" onClick={() => void refreshScripts(project.id)}>
          <Icon name="refresh" />
        </button>
      </div>
      {total > 8 && (
        <input
          className="filter"
          placeholder="Filter scripts"
          spellCheck={false}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="scripts-list">
        {!query && <Presets project={project} statuses={statuses} />}
        {groups?.map((group) => {
          const key = `${group.relDir}|${group.source}|${group.runner}`
          const scripts = group.scripts.filter(matches)
          if (scripts.length === 0) return null
          const open = query !== '' || !collapsed[key]
          return (
            <div className="group" key={key}>
              <button className="group-head" onClick={() => setCollapsed({ ...collapsed, [key]: open })}>
                <span className={open ? 'chevron chevron-open' : 'chevron'}>
                  <Icon name="chevron" />
                </span>
                <span className="group-name">{group.relDir ? `${group.relDir}/` : ''}{group.source}</span>
                <span className="group-runner">{group.runner}</span>
              </button>
              {open &&
                scripts.map((script) => (
                  <ScriptRow
                    key={script.command}
                    script={script}
                    state={scriptState(project, statuses, script)}
                    onRun={(e) => runScript(project, group, script, e.altKey)}
                  />
                ))}
            </div>
          )
        })}
        {groups && total === 0 && (
          <p className="empty">No scripts found in this folder. Add your own commands below.</p>
        )}


        <div className="group">
          <div className="group-head group-head-static">
            <span className="group-name">Custom commands</span>
            <button className="icon-btn" title="Add a command to this project" onClick={() => setEditing('new')}>
              <Icon name="plus" />
            </button>
          </div>
          {custom.map(({ entry, script }) =>
            editing === entry.id ? (
              <CommandForm key={entry.id} project={project} existing={entry} onDone={() => setEditing(null)} />
            ) : (
              <ScriptRow
                key={entry.id}
                script={script}
                state={scriptState(project, statuses, script)}
                onRun={(e) => runScript(project, null, script, e.altKey)}
                onEdit={() => setEditing(entry.id)}
                onRemove={() =>
                  editProject(project.id, (p) => ({
                    ...p,
                    customCommands: p.customCommands.filter((c) => c.id !== entry.id)
                  }))
                }
              />
            )
          )}
          {editing === 'new' && <CommandForm project={project} onDone={() => setEditing(null)} />}
          {editing === null && project.customCommands.length === 0 && (
            <button className="empty empty-btn" onClick={() => setEditing('new')}>
              Add your own command for this project
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function startResize(event: MouseEvent, startWidth: number): void {
  const startX = event.clientX
  const move = (e: globalThis.MouseEvent): void => {
    patchConfig({ sidebarWidth: Math.min(520, Math.max(200, startWidth + e.clientX - startX)) })
  }
  const up = (): void => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.classList.remove('resizing')
  }
  document.body.classList.add('resizing')
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

/** `~/code` for `/Users/me/code/webportal`: the name already says the rest. */
function parentFolder(path: string): string {
  const parent = path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '') || '/'
  return parent.startsWith(window.api.home) ? `~${parent.slice(window.api.home.length)}` : parent
}

export function Sidebar({ config }: { config: Config }) {
  const statuses = useStore((s) => s.statuses)
  const active = config.projects.find((p) => p.id === config.activeProjectId)

  return (
    <aside className="sidebar" style={{ width: config.sidebarWidth }}>
      <div className="sidebar-drag">
        <span className="brand">MrTerminal</span>
      </div>
      <div className="section-head">
        <span>Projects</span>
        <button className="icon-btn" title="Add a project folder" onClick={() => void pickProject()}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="projects">
        {config.projects.map((project) => {
          const running = project.terminals.filter((t) => statuses[t.id]?.busy).length
          return (
            <div
              key={project.id}
              role="button"
              className={project.id === active?.id ? 'project project-active' : 'project'}
              title={project.path}
              onClick={() => selectProject(project.id)}
            >
              <span className="project-tile">{project.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1) || '·'}</span>
              <span className="project-text">
                <span className="project-name">{project.name}</span>
                <span className="project-path">{parentFolder(project.path)}</span>
              </span>
              {running > 0 && (
                <span className="project-running" title={`${running} running`}>
                  <span className="dot dot-busy" />
                  {running}
                </span>
              )}
              <button
                className="icon-btn project-remove"
                title="Remove project"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteProject(project)
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          )
        })}
        {config.projects.length === 0 && <p className="empty">No projects yet.</p>}
      </div>

      {active ? <Scripts key={active.id} project={active} /> : <div className="scripts" />}

      <button className="sidebar-foot" onClick={() => setState({ settingsOpen: true })}>
        <Icon name="gear" /> Settings
      </button>
      <div className="sidebar-resize" onMouseDown={(e) => startResize(e, config.sidebarWidth)} />
    </aside>
  )
}
