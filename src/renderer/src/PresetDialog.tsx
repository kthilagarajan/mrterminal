import { useState, type FormEvent } from 'react'
import type { Preset, Project } from '@shared/types'
import { getDock } from './dock'
import { Icon } from './Icon'
import { leafIds, parseLayout, removeFromLayout, type MapNode } from './presetLayout'
import { editProject, uid } from './store'

type Labels = Map<string, { n: number; title: string }>

/** A miniature of the window: one cell per pane, sized as it will open. */
function LayoutMap({ node, horizontal, labels }: { node: MapNode; horizontal: boolean; labels: Labels }) {
  if (node.kind === 'branch') {
    return (
      <div className="map-branch" style={{ flexGrow: node.size, flexDirection: horizontal ? 'row' : 'column' }}>
        {node.children.map((child, i) => (
          <LayoutMap key={i} node={child} horizontal={!horizontal} labels={labels} />
        ))}
      </div>
    )
  }
  const items = node.ids.map((id) => labels.get(id)).filter((x) => x !== undefined)
  return (
    <div className="map-leaf" style={{ flexGrow: node.size }} data-tooltip={items.length > 1 ? 'Tabs in the same pane' : undefined}>
      {items.map((item) => (
        <div className="map-item" key={item.n}>
          <b className="num">{item.n}</b>
          <span>{item.title}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Create a preset from the open terminals, or edit one: rename it, see where
 * each terminal will open, and drop the ones that should not be part of it.
 */
export function PresetDialog({ project, existing, onClose }: { project: Project; existing?: Preset; onClose: () => void }) {
  const [name, setName] = useState(existing?.name ?? `Preset ${project.presets.length + 1}`)
  const [draft, setDraft] = useState<Pick<Preset, 'terminals' | 'layout'>>(
    () => existing ?? getDock(project.id)?.snapshot() ?? { terminals: [], layout: null }
  )

  const layout = parseLayout(draft.layout)
  const order = layout ? leafIds(layout.root) : []
  const terminals = [...draft.terminals].sort((a, b) => {
    const [ia, ib] = [order.indexOf(a.id), order.indexOf(b.id)]
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
  })
  const labels: Labels = new Map(terminals.map((t, i) => [t.id, { n: i + 1, title: t.title }]))
  const openNow = project.terminals.length

  const remove = (id: string): void =>
    setDraft({ terminals: draft.terminals.filter((t) => t.id !== id), layout: removeFromLayout(draft.layout, id) })

  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (!name.trim() || terminals.length === 0) return
    const preset: Preset = { id: existing?.id ?? uid(), name: name.trim(), ...draft }
    editProject(project.id, (p) => ({
      ...p,
      presets: existing ? p.presets.map((x) => (x.id === existing.id ? preset : x)) : [...p.presets, preset]
    }))
    onClose()
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{existing ? 'Edit preset' : 'New preset'}</h2>
        <label className="field">
          <span>Name</span>
          <input autoFocus type="text" data-tooltip="Name shown for this preset in the sidebar" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>

        <div className="field">
          <span>Opens in this layout</span>
          {layout ? (
            <div className="map" style={{ aspectRatio: String(layout.ratio) }}>
              <LayoutMap node={layout.root} horizontal={layout.horizontal} labels={labels} />
            </div>
          ) : (
            <p className="muted small">{terminals.length > 0 ? 'Side by side, in the order below.' : 'This preset is empty.'}</p>
          )}
        </div>

        <ol className="preset-list">
          {terminals.map((t, i) => {
            const folder = t.cwd === project.path ? '.' : t.cwd.startsWith(`${project.path}/`) ? t.cwd.slice(project.path.length + 1) : t.cwd
            return (
              <li key={t.id}>
                <b className="num">{i + 1}</b>
                <span>{t.title}</span>
                <code>
                  {t.command ?? 'terminal, no command'}
                  {` · in ${folder}`}
                </code>
                <button type="button" className="icon-btn" data-tooltip="Remove from this preset" aria-label={`Remove ${t.title} from this preset`} onClick={() => remove(t.id)}>
                  <Icon name="close" />
                </button>
              </li>
            )
          })}
        </ol>

        {existing && (
          <button
            type="button"
            className="btn"
            disabled={openNow === 0}
            data-tooltip="Replace this preset's terminals and layout with what is open in the project right now"
            onClick={() => {
              const snapshot = getDock(project.id)?.snapshot()
              if (snapshot) setDraft(snapshot)
            }}
          >
            <Icon name="refresh" /> Use the {openNow} terminal{openNow === 1 ? '' : 's'} open now
          </button>
        )}

        <div className="dialog-actions dialog-actions-end">
          {existing && (
            <button
              type="button"
              className="btn btn-danger"
              data-tooltip="Delete this saved preset; open terminals keep running"
              onClick={() => {
                editProject(project.id, (p) => ({ ...p, presets: p.presets.filter((x) => x.id !== existing.id) }))
                onClose()
              }}
            >
              Delete preset
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" data-tooltip="Close without saving this preset" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" data-tooltip="Save these terminals, their folders, and their layout as a preset" disabled={!name.trim() || terminals.length === 0}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
