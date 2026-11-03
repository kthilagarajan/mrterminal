import { describe, expect, it } from 'vitest'
import type { TerminalDef } from '@shared/types'
import { findReusable, type LiveTerminal } from './reuse'

const t = (id: string, extra: Partial<TerminalDef> = {}): TerminalDef => ({ id, title: id, cwd: '/p', ...extra })

function liveFrom(states: Record<string, Partial<LiveTerminal>>) {
  return (def: TerminalDef): LiveTerminal => ({ busy: false, cwd: def.cwd, ...states[def.id] })
}
const idle = liveFrom({})

describe('findReusable', () => {
  it('finds the terminal opened for a command', () => {
    const list = [t('a'), t('b', { command: 'npm run dev' })]
    expect(findReusable(list, { command: 'npm run dev', cwd: '/p' }, idle)?.id).toBe('b')
  })

  it('ignores a trailing slash on the folder', () => {
    const list = [t('b', { command: 'npm run dev' })]
    expect(findReusable(list, { command: 'npm run dev', cwd: '/p/' }, idle)?.id).toBe('b')
  })

  it('does not reuse a command opened in another folder', () => {
    const list = [t('b', { command: 'npm run dev', cwd: '/p/web' })]
    expect(findReusable(list, { command: 'npm run dev', cwd: '/p' }, idle)).toBeUndefined()
  })

  it('finds a plain shell where the command last ran (typed or sent by an agent)', () => {
    const list = [t('a', { last: 'make watch' })]
    expect(findReusable(list, { command: 'make watch', cwd: '/p' }, idle)?.id).toBe('a')
  })

  it('finds a plain shell running the command right now', () => {
    const list = [t('a', { last: 'old' })]
    const live = liveFrom({ a: { busy: true, command: 'make watch' } })
    expect(findReusable(list, { command: 'make watch', cwd: '/p' }, live)?.id).toBe('a')
  })

  it('skips a plain shell now busy with something else', () => {
    const list = [t('a', { last: 'make watch' })]
    const live = liveFrom({ a: { busy: true, command: 'vim notes' } })
    expect(findReusable(list, { command: 'make watch', cwd: '/p' }, live)).toBeUndefined()
  })

  it("never picks the caller's own terminal", () => {
    const list = [t('self', { command: 'npm run dev' })]
    expect(findReusable(list, { command: 'npm run dev', cwd: '/p' }, idle, 'self')).toBeUndefined()
  })

  it('reuses a plain shell only when asked for it by title', () => {
    const list = [t('a', { title: 'Agent' })]
    expect(findReusable(list, { cwd: '/p' }, idle)).toBeUndefined()
    expect(findReusable(list, { cwd: '/p', title: 'agent' }, idle)?.id).toBe('a')
    expect(findReusable(list, { cwd: '/p', title: 'agent' }, liveFrom({ a: { busy: true } }))?.id).toBe('a')
    expect(findReusable(list, { cwd: '/p', title: 'agent' }, liveFrom({ a: { cwd: '/elsewhere' } }))).toBeUndefined()
  })

  it('does not hand a command terminal out as a plain shell', () => {
    const list = [t('a', { title: 'dev', command: 'npm run dev' })]
    expect(findReusable(list, { cwd: '/p', title: 'dev' }, idle)).toBeUndefined()
  })
})
