/**
 * Reading and trimming the dockview layout stored in a preset. The format is
 * a tree: branches alternate between rows and columns, leaves are panes that
 * hold one or more tabs (`views`).
 */

interface RawNode {
  type: 'leaf' | 'branch'
  size?: number
  data: RawNode[] | { views: string[]; activeView?: string; id?: string }
}

interface RawLayout {
  grid: { root: RawNode; orientation: 'HORIZONTAL' | 'VERTICAL'; width?: number; height?: number }
  panels: Record<string, unknown>
  activeGroup?: string
}

export type MapNode = { size: number } & ({ kind: 'leaf'; ids: string[] } | { kind: 'branch'; children: MapNode[] })

function isLayout(layout: unknown): layout is RawLayout {
  const grid = (layout as RawLayout | null)?.grid
  return !!grid && typeof grid === 'object' && !!grid.root && typeof grid.root === 'object'
}

/** The split tree of a saved layout, for drawing; null if there is none. */
export function parseLayout(layout: unknown): { root: MapNode; horizontal: boolean; ratio: number } | null {
  if (!isLayout(layout)) return null
  const node = (raw: RawNode): MapNode | null => {
    const size = typeof raw?.size === 'number' && raw.size > 0 ? raw.size : 1
    if (raw?.type === 'leaf' && !Array.isArray(raw.data) && Array.isArray(raw.data?.views)) {
      return { kind: 'leaf', size, ids: raw.data.views.filter((v) => typeof v === 'string') }
    }
    if (raw?.type === 'branch' && Array.isArray(raw.data)) {
      const children = raw.data.map(node).filter((n): n is MapNode => n !== null)
      return children.length > 0 ? { kind: 'branch', size, children } : null
    }
    return null
  }
  const root = node(layout.grid.root)
  if (!root) return null
  const { width, height } = layout.grid
  const ratio = width && height ? width / height : 1.6
  return { root, horizontal: layout.grid.orientation !== 'VERTICAL', ratio: Math.min(3, Math.max(1, ratio)) }
}

/** Pane ids in reading order: the order the terminals are numbered in. */
export function leafIds(node: MapNode): string[] {
  return node.kind === 'leaf' ? node.ids : node.children.flatMap(leafIds)
}

/**
 * Take one terminal out of a layout. Its pane goes too if it was the only tab
 * there, and the neighbours grow into the space. Returns null when nothing is
 * left.
 */
export function removeFromLayout(layout: unknown, id: string): unknown | null {
  if (!isLayout(layout)) return null
  const copy = JSON.parse(JSON.stringify(layout)) as RawLayout

  // Returns the nodes that should stand in for `node` in its parent.
  const prune = (node: RawNode): RawNode[] => {
    if (node.type === 'leaf') {
      if (Array.isArray(node.data)) return []
      const views = node.data.views.filter((v) => v !== id)
      if (views.length === 0) return []
      node.data.views = views
      if (node.data.activeView === id) node.data.activeView = views[0]
      return [node]
    }
    const children = (Array.isArray(node.data) ? node.data : []).flatMap(prune)
    if (children.length === 0) return []
    if (children.length === 1) {
      const only = children[0]
      // A lone pane simply takes the branch's place.
      if (only.type === 'leaf') return [{ ...only, size: node.size }]
      // A lone branch runs in the same direction as our parent, so its
      // children join the parent directly, sharing the space we had.
      const inner = only.data as RawNode[]
      const total = inner.reduce((sum, child) => sum + (child.size ?? 1), 0) || 1
      return inner.map((child) => ({ ...child, size: ((child.size ?? 1) / total) * (node.size ?? total) }))
    }
    node.data = children
    return [node]
  }

  const root = copy.grid.root
  const children = (Array.isArray(root.data) ? root.data : []).flatMap(prune)
  if (children.length === 0) return null
  if (children.length === 1 && children[0].type === 'branch') {
    // The surviving branch becomes the root, which turns the layout a quarter.
    copy.grid.root = { ...children[0], size: root.size }
    copy.grid.orientation = copy.grid.orientation === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL'
  } else {
    root.data = children
  }
  delete copy.panels[id]
  delete copy.activeGroup
  return copy
}
