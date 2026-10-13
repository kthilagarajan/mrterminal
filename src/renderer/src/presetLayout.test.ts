import { describe, expect, it } from 'vitest'
import { leafIds, parseLayout, removeFromLayout } from './presetLayout'

const leaf = (size: number, ...views: string[]) => ({ type: 'leaf', size, data: { views, activeView: views[0], id: views[0] } })
const branch = (size: number, ...data: unknown[]) => ({ type: 'branch', size, data })
const layout = (root: unknown, ids: string[]) => ({
  grid: { root, orientation: 'HORIZONTAL', width: 1000, height: 600 },
  panels: Object.fromEntries(ids.map((id) => [id, { id }])),
  activeGroup: '1'
})

/** `a | (b / c)`: one pane on the left, two stacked on the right. */
const three = layout(branch(600, leaf(500, 'a'), branch(500, leaf(300, 'b'), leaf(300, 'c'))), ['a', 'b', 'c'])

const shape = (l: unknown): string => {
  const parsed = parseLayout(l)!
  const draw = (n: ReturnType<typeof parseLayout> extends infer P ? (P extends { root: infer R } ? R : never) : never, h: boolean): string =>
    n.kind === 'leaf' ? n.ids.join('+') : `(${n.children.map((c) => draw(c, !h)).join(h ? ' | ' : ' / ')})`
  return draw(parsed.root, parsed.horizontal)
}

describe('parseLayout', () => {
  it('reads the tree in reading order', () => {
    expect(shape(three)).toBe('(a | (b / c))')
    expect(leafIds(parseLayout(three)!.root)).toEqual(['a', 'b', 'c'])
    expect(parseLayout(null)).toBeNull()
    expect(parseLayout({ grid: {} })).toBeNull()
  })
})

describe('removeFromLayout', () => {
  it('lets the neighbour take over a removed pane', () => {
    const next = removeFromLayout(three, 'b') as typeof three
    expect(shape(next)).toBe('(a | c)')
    expect(Object.keys(next.panels)).toEqual(['a', 'c'])
    expect(three.panels).toHaveProperty('b') // the original is untouched
  })

  it('turns the layout when only a nested split is left', () => {
    expect(shape(removeFromLayout(three, 'a'))).toBe('(b / c)')
  })

  it('merges a lone nested split into its grandparent', () => {
    // a | (b / (c | d)) without b  ->  a | c | d
    const nested = layout(
      branch(600, leaf(400, 'a'), branch(600, leaf(300, 'b'), branch(300, leaf(300, 'c'), leaf(300, 'd')))),
      ['a', 'b', 'c', 'd']
    )
    expect(shape(removeFromLayout(nested, 'b'))).toBe('(a | c | d)')
  })

  it('removes one tab and keeps the pane', () => {
    const tabs = layout(branch(600, leaf(500, 'a', 'b'), leaf(500, 'c')), ['a', 'b', 'c'])
    const next = removeFromLayout(tabs, 'a') as typeof tabs
    expect(shape(next)).toBe('(b | c)')
    expect((next.grid.root as { data: { data: { activeView: string } }[] }).data[0].data.activeView).toBe('b')
  })

  it('returns null when nothing is left', () => {
    expect(removeFromLayout(layout(branch(600, leaf(1000, 'a')), ['a']), 'a')).toBeNull()
  })
})
