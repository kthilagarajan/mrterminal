import type { Project } from './types'

/** Rewrite the panel ids inside a saved layout, wherever they appear. */
export function renameIds(node: unknown, ids: Map<string, string>): unknown {
  if (typeof node === 'string') return ids.get(node) ?? node
  if (Array.isArray(node)) return node.map((item) => renameIds(item, ids))
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [ids.get(key) ?? key, renameIds(value, ids)])
    )
  }
  return node
}

/**
 * Terminal ids are unique across the app (they are `MRT_TERMINAL_ID`, and
 * name each runtime). A project file brought in from elsewhere, such as a
 * second checkout of the same repository, can repeat ids already in use;
 * those terminals get fresh ids, in its layout too.
 */
export function withFreshIds(file: Partial<Project>, taken: Set<string>, uid: () => string): Partial<Project> {
  if (!file.terminals) return file
  const ids = new Map<string, string>()
  for (const t of file.terminals) {
    if (!taken.has(t.id) && !ids.has(t.id)) continue
    let id = uid()
    while (taken.has(id)) id = uid()
    ids.set(t.id, id)
    taken.add(id)
  }
  if (ids.size === 0) return file
  return {
    ...file,
    terminals: file.terminals.map((t) => (ids.has(t.id) ? { ...t, id: ids.get(t.id)! } : t)),
    layout: file.layout ? renameIds(file.layout, ids) : (file.layout ?? null)
  }
}
