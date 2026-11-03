import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import {
  applyProjectFile,
  fromProjectFile,
  hasProjectFile,
  projectFilePath,
  readProjectFile,
  toProjectFile,
  writeProjectFiles
} from './projectFile'

function project(path: string, extra: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'shop',
    path,
    terminals: [
      { id: 'a', title: 'dev', cwd: path, command: 'npm run dev', resume: 'npm run dev' },
      { id: 'b', title: 'web', cwd: join(path, 'web'), last: 'make watch' },
      { id: 'c', title: 'logs', cwd: '/var/log' }
    ],
    layout: { grid: 1 },
    customCommands: [{ id: 'x', name: 'db', command: 'docker compose up db' }],
    presets: [{ id: 'pr', name: 'All', layout: null, terminals: [{ id: '1', title: 'api', cwd: join(path, 'api'), command: 'make run' }] }],
    aliases: { '\nnpm run dev': 'server' },
    expanded: true,
    color: '#e0569b',
    ...extra
  }
}

describe('the project file', () => {
  it('stores folders relative to the project and leaves out session state', () => {
    const file = toProjectFile(project('/code/shop'))
    expect(file.terminals).toEqual([
      { id: 'a', title: 'dev', cwd: '.', command: 'npm run dev' },
      { id: 'b', title: 'web', cwd: 'web', last: 'make watch' },
      { id: 'c', title: 'logs', cwd: '/var/log' }
    ])
    expect(file.presets[0].terminals[0].cwd).toBe('api')
    expect(file).not.toHaveProperty('color')
  })

  it('reads back to the same project wherever it is checked out', () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(project('/code/shop'))))
    const read = fromProjectFile('/elsewhere/shop', file)!
    expect(read.terminals!.map((t) => t.cwd)).toEqual(['/elsewhere/shop', '/elsewhere/shop/web', '/var/log'])
    expect(read.terminals![1].last).toBe('make watch')
    expect(read.presets![0].terminals[0].cwd).toBe('/elsewhere/shop/api')
    expect(read.customCommands).toEqual([{ id: 'x', name: 'db', command: 'docker compose up db' }])
    expect(read.aliases).toEqual({ '\nnpm run dev': 'server' })
  })

  it('tolerates junk', () => {
    expect(fromProjectFile('/p', null)).toBeNull()
    expect(fromProjectFile('/p', [1])).toBeNull()
    expect(fromProjectFile('/p', { terminals: [null, { id: 1 }, { id: 'ok', cwd: '.' }] })).toEqual({
      terminals: [{ id: 'ok', title: 'ok', cwd: '/p' }]
    })
  })

  it('wins over the global config, keeping what ran at quit on this machine', () => {
    const global = project('/code/shop')
    const merged = applyProjectFile(global, {
      terminals: [{ id: 'a', title: 'server', cwd: '/code/shop', command: 'npm run dev' }],
      customCommands: []
    })
    expect(merged.terminals).toEqual([{ id: 'a', title: 'server', cwd: '/code/shop', command: 'npm run dev', resume: 'npm run dev' }])
    expect(merged.customCommands).toEqual([])
    expect(merged.presets).toBe(global.presets)
    expect(merged.color).toBe('#e0569b')
  })

  it('is written only when something changed, and never for the home folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mrt-projectfile-'))
    mkdirSync(join(dir, 'web'))
    const written = new Map<string, string>()
    writeProjectFiles([project(dir)], written)
    const path = projectFilePath(dir)
    expect(readProjectFile(dir)!.terminals!.map((t) => t.title)).toEqual(['dev', 'web', 'logs'])
    expect(JSON.parse(readFileSync(path, 'utf8')).$schema).toMatch(/project\.schema\.json$/)

    const before = statSync(path).mtimeMs
    writeFileSync(path, readFileSync(path, 'utf8'))
    const touched = statSync(path).mtimeMs
    writeProjectFiles([project(dir)], written)
    expect(statSync(path).mtimeMs).toBe(touched)
    expect(touched).toBeGreaterThanOrEqual(before)

    writeProjectFiles([project(dir, { customCommands: [] })], written)
    expect(readProjectFile(dir)!.customCommands).toEqual([])

    expect(hasProjectFile('/home/me', '/home/me')).toBe(false)
    expect(hasProjectFile('/home/me/code', '/home/me')).toBe(true)
    expect(existsSync(join(dir, '.mrterminal', 'project.json.tmp'))).toBe(false)
  })
})

describe('the project file schema', () => {
  it('describes every field the app writes', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', 'schema', 'project.schema.json'), 'utf8'))
    const file = toProjectFile(project('/code/shop'))
    expect(Object.keys(file).filter((k) => !(k in schema.properties))).toEqual([])
    const termKeys = new Set(file.terminals.flatMap((t) => Object.keys(t)))
    expect([...termKeys].filter((k) => !(k in schema.$defs.Terminal.properties))).toEqual([])
  })
})

describe('withFreshIds', () => {
  it('renames only clashing terminals, in the layout too', async () => {
    const { withFreshIds } = await import('@shared/ids')
    let n = 0
    const file = {
      terminals: [
        { id: 'a', title: 'dev', cwd: '/p' },
        { id: 'b', title: 'web', cwd: '/p' }
      ],
      layout: { grid: { root: { data: { views: ['a', 'b'], activeView: 'a' } } }, panels: { a: { id: 'a' }, b: { id: 'b' } } }
    }
    const out = withFreshIds(file, new Set(['a']), () => `n${++n}`)
    expect(out.terminals!.map((t) => t.id)).toEqual(['n1', 'b'])
    expect(out.layout).toEqual({ grid: { root: { data: { views: ['n1', 'b'], activeView: 'n1' } } }, panels: { n1: { id: 'n1' }, b: { id: 'b' } } })
    expect(withFreshIds(file, new Set(['z']), () => 'x')).toBe(file)
  })
})
