import { describe, expect, it } from 'vitest'
import { keyBytes, resolveProject, resolveTerminal, type AppState, type TermInfo } from './control'

function term(id: string, projectId: string, title: string, command?: string): TermInfo {
  return { id, projectId, project: projectId, title, cwd: '/', command, running: false, process: '', active: false }
}

const state: AppState = {
  ready: true,
  activeProjectId: 'api',
  projects: [
    {
      id: 'web', name: 'Web', path: '/code/web', active: false, presets: [], commands: [],
      terminals: [term('w1', 'web', 'dev', 'npm run dev'), term('w2', 'web', 'tests', 'npm test')]
    },
    {
      id: 'api', name: 'API', path: '/code/api', active: true, presets: [], commands: [],
      terminals: [term('a1', 'api', 'dev', 'npm run dev')]
    },
    { id: 'nested', name: 'Docs', path: '/code/web/docs', active: false, presets: [], commands: [], terminals: [] }
  ]
}

describe('resolveProject', () => {
  it('finds a project by id, name or folder', () => {
    expect(resolveProject(state, 'web', {}).id).toBe('web')
    expect(resolveProject(state, 'api', {}).id).toBe('api')
    expect(resolveProject(state, '/code/api/', {}).id).toBe('api')
    expect(() => resolveProject(state, 'nope', {})).toThrow(/No project "nope"/)
  })

  it('defaults to the deepest project folder the caller is in', () => {
    expect(resolveProject(state, undefined, { cwd: '/code/web/src' }).id).toBe('web')
    expect(resolveProject(state, undefined, { cwd: '/code/web/docs/guide' }).id).toBe('nested')
    expect(resolveProject(state, undefined, { cwd: '/code/webapp' }).id).toBe('api')
  })

  it('then to the project of the calling terminal, then to the one on screen', () => {
    expect(resolveProject(state, undefined, { cwd: '/tmp', terminalId: 'w2' }).id).toBe('web')
    expect(resolveProject(state, undefined, { cwd: '/tmp' }).id).toBe('api')
  })
})

describe('resolveTerminal', () => {
  it('finds a terminal by id, title or command', () => {
    expect(resolveTerminal(state, 'w2', {}).id).toBe('w2')
    expect(resolveTerminal(state, 'Tests', {}).id).toBe('w2')
    expect(resolveTerminal(state, 'npm test', {}).id).toBe('w2')
  })

  it('narrows an ambiguous name to the caller\'s project or the one given', () => {
    expect(() => resolveTerminal(state, 'dev', { cwd: '/tmp' })).toThrow(/matches 2 terminals/)
    expect(resolveTerminal(state, 'dev', { cwd: '/code/api' }).id).toBe('a1')
    expect(resolveTerminal(state, 'npm run dev', {}, 'web').id).toBe('w1')
  })

  it('understands self inside a terminal', () => {
    expect(resolveTerminal(state, 'self', { terminalId: 'a1' }).id).toBe('a1')
    expect(() => resolveTerminal(state, 'self', {})).toThrow(/only works inside/)
  })
})

describe('keyBytes', () => {
  it('turns key names into what a terminal sends', () => {
    expect(keyBytes('ctrl-c')).toBe('\x03')
    expect(keyBytes('C-d')).toBe('\x04')
    expect(keyBytes('Enter')).toBe('\r')
    expect(keyBytes('up')).toBe('\x1b[A')
    expect(() => keyBytes('hyper')).toThrow(/Unknown key/)
  })
})
