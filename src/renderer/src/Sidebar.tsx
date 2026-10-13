import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import type React from 'react'
import type { Config, CustomCommand, DetectedScript, Preset, Project, ScriptGroup } from '@shared/types'
import {
  deleteProject,
  pickProject,
  runScript,
  scriptTitle,
  selectProject,
  showTerminal,
  stopAll,
  stopTerminal
} from './actions'
import { customCwd, getDock, renameCommand } from './dock'
import { Icon } from './Icon'
import { PresetDialog } from './PresetDialog'
import {
  aliasKey,
  editProject,
  getState,
  moveProject,
  patchConfig,
  refreshScripts,
  setState,
  uid,
  useStore,
  type TermStatus
} from './store'

type Statuses = Record<string, TermStatus>
type ScriptState = 'running' | 'open' | 'none'

/** The open terminal that runs this command, if there is one. */
function terminalFor(project: Project, script: { command?: string; cwd: string }) {
  return project.terminals.find((t) => t.command === script.command && t.cwd === script.cwd)
}

function scriptState(project: Project, statuses: Statuses, script: { command?: string; cwd: string }): ScriptState {
  const terminal = terminalFor(project, script)
  if (!terminal) return 'none'
  return statuses[terminal.id]?.shown ? 'running' : 'open'
}

function IconButton({
  icon,
  title,
  className = '',
  disabled,
  onClick
}: {
  icon: Parameters<typeof Icon>[0]['name']
  title: string
  className?: string
  disabled?: boolean
  onClick: (event: MouseEvent) => void
}) {
  return (
    <button
      className={`icon-btn ${className}`}
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick(event)
      }}
    >
      <Icon name={icon} />
    </button>
  )
}

/**
 * The button at the start of a row. It always shows what a click on it will
 * do: start the thing, or, while it is running, stop it.
 */
function RunButton({ running, onRun, onStop }: { running: boolean; onRun: (event: MouseEvent) => void; onStop?: () => void }) {
  return (
    <button
      className={running ? 'run-btn run-btn-running' : 'run-btn'}
      title={running ? 'Stop (Ctrl-C)' : 'Run'}
      onClick={(event) => {
        event.stopPropagation()
        if (running && onStop) onStop()
        else onRun(event)
      }}
    >
      <Icon name={running ? 'stop' : 'play'} />
    </button>
  )
}

/** A muted heading that folds the rows under it; `children` are its buttons on the right. */
function GroupHead({
  label,
  open,
  onToggle,
  children
}: {
  label: React.ReactNode
  open: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="group-head" role="button" onClick={onToggle}>
      <span className={open ? 'chevron chevron-open' : 'chevron'}>
        <Icon name="chevron" />
      </span>
      <span className="group-name">{label}</span>
      {children}
    </div>
  )
}

function ScriptRow({
  script,
  state,
  hint: customHint,
  onRun,
  onStop,
  onEdit,
  onRemove
}: {
  script: DetectedScript
  state: ScriptState
  /** Replaces the default "click to run" tooltip line. */
  hint?: string
  onRun: (event: MouseEvent) => void
  onStop?: () => void
  onEdit?: () => void
  onRemove?: () => void
}) {
  const copy = `${window.api.platform === 'darwin' ? '⌥' : 'Alt+'}click for another copy`
  const hint =
    customHint ??
    `${state === 'running' ? 'Running. Click to show it' : state === 'open' ? 'Click to run it again' : 'Click to run'} · ${copy}`
  return (
    <div
      className={`row script script-${state}`}
      role="button"
      title={`${script.command}\n${script.detail ?? ''}\n\n${hint}`}
      onClick={onRun}
    >
      <RunButton running={state === 'running'} onRun={onRun} onStop={onStop} />
      <span className="row-name">{script.name}</span>
      <span className="row-detail">{script.detail ?? script.command}</span>
      <span className="row-actions">
        {onEdit && <IconButton icon="edit" title="Rename or edit" onClick={onEdit} />}
        {onRemove && <IconButton icon="close" title="Delete this command" onClick={onRemove} />}
      </span>
    </div>
  )
}

/** Inline name field. `onDone(undefined)` = cancelled, `onDone('')` = back to the original name. */
function RenameForm({ name, original, onDone }: { name: string; original: string; onDone: (name?: string) => void }) {
  const [value, setValue] = useState(name)
  return (
    <form
      className="rename"
      onSubmit={(e) => {
        e.preventDefault()
        onDone(value.trim())
      }}
    >
      <input
        autoFocus
        spellCheck={false}
        value={value}
        placeholder={original}
        title={`Shown here and on the terminal's tab. Clear it to go back to "${original}".`}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onDone(value.trim())}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
      />
    </form>
  )
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

/** What is running in this project right now, each with its own stop button. */
function Running({ project, statuses }: { project: Project; statuses: Statuses }) {
  const [open, setOpen] = useState(true)
  const running = project.terminals.filter((t) => statuses[t.id]?.shown)
  if (running.length === 0) return null
  return (
    <div className="group running">
      <GroupHead label="Running" open={open} onToggle={() => setOpen(!open)}>
        <span className="group-count">{running.length}</span>
      </GroupHead>
      {open && (
        <div className="running-list">
          {running.map((terminal) => (
            <div
              key={terminal.id}
              className="row script-running"
              role="button"
              title={`Running: ${terminal.command ?? statuses[terminal.id]?.process}\n${terminal.cwd}\n\nClick to show it`}
              onClick={() => showTerminal(project.id, terminal.id)}
            >
              <RunButton running onRun={() => {}} onStop={() => stopTerminal(terminal.id)} />
              <span className="row-name">{terminal.title}</span>
              <span className="row-detail">{terminal.command ?? statuses[terminal.id]?.process}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Presets({ project, statuses }: { project: Project; statuses: Statuses }) {
  /** 'new', the preset being edited, or null when the dialog is closed. */
  const [editing, setEditing] = useState<Preset | 'new' | null>(null)
  const [open, setOpen] = useState(true)
  const canSave = project.terminals.length > 0

  return (
    <div className="group">
      <GroupHead label="Presets" open={open} onToggle={() => setOpen(!open)}>
        <IconButton
          icon="plus"
          disabled={!canSave}
          title={canSave ? 'Save the open terminals as a preset' : 'Open some terminals first, then save them as a preset'}
          onClick={() => setEditing('new')}
        />
      </GroupHead>
      {open && project.presets.map((preset) => {
        // Running = everything in it is open and none of its commands has stopped.
        const states = preset.terminals.map((t) => ({ t, state: scriptState(project, statuses, t) }))
        const allOpen = states.every((s) => s.state !== 'none')
        const state: ScriptState =
          allOpen && states.some((s) => s.t.command) && states.every((s) => !s.t.command || s.state === 'running')
            ? 'running'
            : states.some((s) => s.state !== 'none')
              ? 'open'
              : 'none'
        const count = preset.terminals.length
        return (
          <ScriptRow
            key={preset.id}
            script={{
              name: preset.name,
              command: preset.terminals.map((t) => `${t.title}: ${t.command ?? 'terminal'}`).join('\n'),
              cwd: project.path,
              detail: `${count} terminal${count === 1 ? '' : 's'}`
            }}
            state={state}
            hint={
              state === 'running'
                ? 'All running. Click to put them back in their layout'
                : 'Click to open them all in their layout'
            }
            onRun={() => {
              selectProject(project.id)
              getDock(project.id)?.launch(preset)
            }}
            onStop={() => {
              for (const { t, state: s } of states) {
                const terminal = s === 'running' ? terminalFor(project, t) : undefined
                if (terminal) stopTerminal(terminal.id)
              }
            }}
            onEdit={() => setEditing(preset)}
          />
        )
      })}
      {open && project.presets.length === 0 && (
        <p className="empty">
          {canSave ? 'Press + to save the open terminals and start them all with one click.' : 'Open the terminals you want together, then save them here.'}
        </p>
      )}
      {editing && <PresetDialog project={project} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ScriptGroupView({
  project,
  group,
  scripts,
  statuses
}: {
  project: Project
  group: ScriptGroup
  scripts: DetectedScript[]
  statuses: Statuses
}) {
  const [collapsed, setCollapsed] = useState(false)
  /** Alias key of the script being renamed. */
  const [renaming, setRenaming] = useState<string | null>(null)
  const open = !collapsed

  return (
    <div className="group">
      <GroupHead
        label={`${group.relDir ? `${group.relDir}/` : ''}${group.source}`}
        open={open}
        onToggle={() => setCollapsed(open)}
      >
        <span className="group-runner">{group.runner}</span>
      </GroupHead>
      {open &&
        scripts.map((script) => {
          const key = aliasKey(project, script.command, script.cwd)
          const alias = project.aliases[key]
          if (renaming === key) {
            return (
              <RenameForm
                key={key}
                name={alias ?? script.name}
                original={script.name}
                onDone={(name) => {
                  setRenaming(null)
                  if (name === undefined) return
                  // Clearing the field (or typing the original) drops the alias.
                  if (!name || name === script.name) {
                    renameCommand(project.id, script.command, script.cwd, scriptTitle(group, script), false)
                  } else renameCommand(project.id, script.command, script.cwd, name)
                }}
              />
            )
          }
          const terminal = terminalFor(project, script)
          return (
            <ScriptRow
              key={key}
              script={alias ? { ...script, name: alias, detail: script.command } : script}
              state={scriptState(project, statuses, script)}
              onRun={(e) => {
                selectProject(project.id)
                runScript(project, group, script, e.altKey)
              }}
              onStop={terminal && (() => stopTerminal(terminal.id))}
              onEdit={() => setRenaming(key)}
            />
          )
        })}
    </div>
  )
}

/** Everything a project can run: presets, detected scripts, the user's own commands. */
function ProjectBody({ project, statuses }: { project: Project; statuses: Statuses }) {
  const groups = useStore((s) => s.scripts[project.id])
  /** 'new', the id of the command being edited, or null when the form is closed. */
  const [editing, setEditing] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(true)

  return (
    <>
      <Presets project={project} statuses={statuses} />
      {groups?.map((group) => (
        <ScriptGroupView
          key={`${group.relDir}|${group.source}|${group.runner}`}
          project={project}
          group={group}
          scripts={group.scripts}
          statuses={statuses}
        />
      ))}
      {groups && groups.length === 0 && <p className="empty">No scripts found in this folder.</p>}

      <div className="group">
        <GroupHead label="Custom commands" open={customOpen} onToggle={() => setCustomOpen(!customOpen)}>
          <IconButton
            icon="plus"
            title="Add a command to this project"
            onClick={() => {
              setCustomOpen(true)
              setEditing('new')
            }}
          />
        </GroupHead>
        {customOpen && project.customCommands.map((entry) => {
          if (editing === entry.id) {
            return <CommandForm key={entry.id} project={project} existing={entry} onDone={() => setEditing(null)} />
          }
          const script = { name: entry.name, command: entry.command, cwd: customCwd(project, entry.cwd), detail: entry.command }
          const terminal = terminalFor(project, script)
          return (
            <ScriptRow
              key={entry.id}
              script={script}
              state={scriptState(project, statuses, script)}
              onRun={(e) => {
                selectProject(project.id)
                runScript(project, null, script, e.altKey)
              }}
              onStop={terminal && (() => stopTerminal(terminal.id))}
              onEdit={() => setEditing(entry.id)}
              onRemove={() =>
                editProject(project.id, (p) => ({
                  ...p,
                  customCommands: p.customCommands.filter((c) => c.id !== entry.id)
                }))
              }
            />
          )
        })}
        {editing === 'new' && <CommandForm project={project} onDone={() => setEditing(null)} />}
        {customOpen && editing === null && project.customCommands.length === 0 && (
          <button className="empty empty-btn" onClick={() => setEditing('new')}>
            Add your own command for this project
          </button>
        )}
      </div>
    </>
  )
}

/** The "..." menu of a project. Closes on any click outside it. */
function ProjectMenu({ project, index, count, onClose }: { project: Project; index: number; count: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: globalThis.MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const item = (label: string, action: () => void, options: { disabled?: boolean; danger?: boolean } = {}) => (
    <button
      className={options.danger ? 'menu-item menu-danger' : 'menu-item'}
      disabled={options.disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClose()
        action()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      {item('Move up', () => moveProject(project.id, index - 1), { disabled: index === 0 })}
      {item('Move down', () => moveProject(project.id, index + 1), { disabled: index === count - 1 })}
      {item('Open folder', () => window.api.reveal(project.path))}
      <div className="menu-sep" />
      {item('Remove project…', () => deleteProject(project), { danger: true })}
    </div>
  )
}

/** `~/code` for `/Users/me/code/webportal`: the name already says the rest. */
function parentFolder(path: string): string {
  const parent = path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '') || '/'
  return parent.startsWith(window.api.home) ? `~${parent.slice(window.api.home.length)}` : parent
}

/** `TA` for `telemedicine-app`, `W` for `webportal`: what goes on the project's tile. */
function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+|(?<=\p{Ll})(?=\p{Lu})/u).filter(Boolean)
  return words.slice(0, 2).map((w) => w[0]).join('') || '·'
}

/**
 * Show a project and unfold it, folding the others: the open card is the
 * project on screen. The chevron still unfolds any card on its own.
 */
function openProject(id: string): void {
  const config = getState().config
  if (!config) return
  patchConfig({ activeProjectId: id, projects: config.projects.map((p) => ({ ...p, expanded: p.id === id })) })
}

const DRAG_TYPE = 'application/x-mrterminal-project'

function ProjectNode({
  project,
  index,
  count,
  active,
  statuses
}: {
  project: Project
  index: number
  count: number
  active: boolean
  statuses: Statuses
}) {
  const [menu, setMenu] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** Where a dragged project would land relative to this one. */
  const [drop, setDrop] = useState<'before' | 'after' | null>(null)
  const running = project.terminals.filter((t) => statuses[t.id]?.shown).length
  const expanded = project.expanded
  const card = useRef<HTMLDivElement>(null)

  // Folding a long card from its pinned title leaves the list scrolled past
  // it; bring the card back into view.
  useEffect(() => {
    if (!expanded) card.current?.scrollIntoView({ block: 'nearest' })
  }, [expanded])

  const toggle = (): void => editProject(project.id, (p) => ({ ...p, expanded: !p.expanded }))
  const refresh = (): void => {
    setRefreshing(true)
    void refreshScripts(project.id).finally(() => window.setTimeout(() => setRefreshing(false), 400))
  }

  const side = (event: DragEvent): 'before' | 'after' => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2 ? 'before' : 'after'
  }
  const dragOver = (event: DragEvent): void => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDrop(side(event))
  }
  const dropped = (event: DragEvent): void => {
    const id = event.dataTransfer.getData(DRAG_TYPE)
    setDrop(null)
    if (!id || id === project.id) return
    event.preventDefault()
    // The dragged project leaves a gap first, which shifts everything after it.
    const from = (getState().config?.projects ?? []).findIndex((p) => p.id === id)
    const target = side(event) === 'before' ? index : index + 1
    moveProject(id, from < target ? target - 1 : target)
  }

  const classes = ['project', active && 'project-active', expanded && 'project-open', dragging && 'project-dragging', drop && `project-drop-${drop}`]

  return (
    // The whole card is the drop target, so the line shows between cards
    // wherever the pointer is over one, not only over its title.
    <div
      ref={card}
      className={classes.filter(Boolean).join(' ')}
      style={{ '--project': project.color } as CSSProperties}
      onDragOver={dragOver}
      onDragEnter={dragOver}
      onDragLeave={(event) => {
        // Moving between elements inside the card is not leaving it.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null)
      }}
      onDrop={dropped}
    >
      <div
        className="project-head"
        role="button"
        draggable
        title={`${project.path}\n\nClick to ${active ? (expanded ? 'collapse' : 'expand') : 'show'} · drag to reorder`}
        // Click shows the project; clicking the one already shown folds or unfolds it.
        onClick={() => (active ? toggle() : openProject(project.id))}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, project.id)
          event.dataTransfer.effectAllowed = 'move'
          setDragging(true)
        }}
        onDragEnd={() => setDragging(false)}
      >
        <span className="project-tile">{initials(project.name)}</span>
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
        <span className={menu ? 'project-actions project-actions-open' : 'project-actions'}>
          {running > 0 && <IconButton icon="stop" title={`Stop all ${running} running`} onClick={() => stopAll(project)} />}
          <IconButton icon="refresh" className={refreshing ? 'spin' : ''} title="Re-read this project's scripts" onClick={refresh} />
          <IconButton icon="more" title="More" onClick={() => setMenu(!menu)} />
        </span>
        <IconButton
          icon="chevron"
          className={expanded ? 'project-fold project-fold-open' : 'project-fold'}
          title={expanded ? 'Collapse' : 'Expand without switching to it'}
          onClick={toggle}
        />
        {menu && <ProjectMenu project={project} index={index} count={count} onClose={() => setMenu(false)} />}
      </div>
      <Running project={project} statuses={statuses} />
      {expanded && (
        <div className="project-body">
          <ProjectBody project={project} statuses={statuses} />
        </div>
      )}
    </div>
  )
}

function startResize(event: MouseEvent, startWidth: number): void {
  const startX = event.clientX
  const move = (e: globalThis.MouseEvent): void => {
    patchConfig({ sidebarWidth: Math.min(520, Math.max(220, startWidth + e.clientX - startX)) })
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

export function Sidebar({ config }: { config: Config }) {
  const statuses = useStore((s) => s.statuses)

  return (
    <aside className="sidebar" style={{ width: config.sidebarWidth }}>
      <header className="sidebar-head">
        <span className="brand">
          <span className="brand-mark">
            <Icon name="terminal" />
          </span>
          MrTerminal
        </span>
        <IconButton icon="plus" title="Add a project folder" onClick={() => void pickProject()} />
      </header>
      <div className="tree">
        {config.projects.map((project, index) => (
          <ProjectNode
            key={project.id}
            project={project}
            index={index}
            count={config.projects.length}
            active={project.id === config.activeProjectId}
            statuses={statuses}
          />
        ))}
        {config.projects.length === 0 && <p className="empty">No projects yet. Press + to add a folder.</p>}
      </div>
      <button className="sidebar-foot" onClick={() => setState({ settingsOpen: true })}>
        <Icon name="gear" /> Settings
      </button>
      <div className="sidebar-resize" onMouseDown={(e) => startResize(e, config.sidebarWidth)} />
    </aside>
  )
}
