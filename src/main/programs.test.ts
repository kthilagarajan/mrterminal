import { describe, expect, it } from 'vitest'
import { detectAgents, findProgram, programOf, type Env } from './programs'
import { normalizeConfig } from './config'

function env(files: string[], platform: NodeJS.Platform = 'darwin', path = '/usr/bin:/bin'): Env {
  return { platform, home: '/Users/me', path, isFile: (p) => files.includes(p) }
}

describe('programOf', () => {
  it('takes the first word, or a quoted path', () => {
    expect(programOf('claude --resume')).toBe('claude')
    expect(programOf('  codex ')).toBe('codex')
    expect(programOf('"/Applications/My Tools/agy" -p hi')).toBe('/Applications/My Tools/agy')
  })
})

describe('findProgram', () => {
  it('searches PATH', () => {
    expect(findProgram('claude', env(['/usr/bin/claude']))).toBe('/usr/bin/claude')
  })

  it('searches where installers put agents, which a Dock-launched app has no PATH for', () => {
    expect(findProgram('claude', env(['/Users/me/.local/bin/claude']))).toBe('/Users/me/.local/bin/claude')
    expect(findProgram('grok', env(['/Users/me/.grok/bin/grok']))).toBe('/Users/me/.grok/bin/grok')
    expect(findProgram('cursor-agent', env(['/opt/homebrew/bin/cursor-agent']))).toBe('/opt/homebrew/bin/cursor-agent')
  })

  it('checks a path as given, expanding ~', () => {
    expect(findProgram('~/bin/agy -p x', env(['/Users/me/bin/agy']))).toBe('/Users/me/bin/agy')
    expect(findProgram('/nope/claude', env(['/usr/bin/claude']))).toBeNull()
  })

  it('finds Windows launchers with their extension', () => {
    const win: Env = { ...env(['C:\\npm\\codex.cmd'], 'win32', 'C:\\npm;C:\\Windows'), home: 'C:\\Users\\me' }
    expect(findProgram('codex', win)).toBe('C:\\npm\\codex.cmd')
  })

  it('says null when it is not installed', () => {
    expect(findProgram('grok', env([]))).toBeNull()
    expect(findProgram('   ', env([]))).toBeNull()
  })
})

describe('detectAgents', () => {
  it('points found agents at their program and hides the rest', () => {
    const agents = detectAgents(env(['/Users/me/.local/bin/claude', '/Users/me/Library/My Bin/codex'], 'darwin', '/Users/me/Library/My Bin'))
    expect(agents.find((a) => a.id === 'claude')).toEqual({ id: 'claude', name: 'Claude Code', command: '/Users/me/.local/bin/claude' })
    expect(agents.find((a) => a.id === 'codex')?.command).toBe('"/Users/me/Library/My Bin/codex"')
    expect(agents.find((a) => a.id === 'antigravity')).toEqual({ id: 'antigravity', name: 'Antigravity', command: 'agy', hidden: true })
    expect(agents.map((a) => a.id)).toEqual(['claude', 'codex', 'cursor', 'antigravity', 'grok'])
  })
})

describe('normalizeConfig global commands', () => {
  it('seeds a file that has none, and keeps a list the user edited, even an empty one', () => {
    const seed = () => [{ id: 'claude', name: 'Claude Code', command: 'claude' }]
    expect(normalizeConfig({ projects: [] }, seed).globalCommands).toEqual(seed())
    expect(normalizeConfig({ globalCommands: [] }, seed).globalCommands).toEqual([])
    const kept = normalizeConfig({ globalCommands: [{ id: 'x', name: 'Mine', command: 'claude --resume', hidden: false }, { id: 1 }] }, seed)
    expect(kept.globalCommands).toEqual([{ id: 'x', name: 'Mine', command: 'claude --resume' }])
  })
})
