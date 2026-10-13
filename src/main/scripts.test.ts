import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectScripts } from './scripts'

let root: string

function write(file: string, content: string | object): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
}

function commands(source?: string): string[] {
  return detectScripts(root)
    .filter((g) => !source || g.source === source)
    .flatMap((g) => g.scripts.map((s) => s.command))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mrterminal-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('package.json', () => {
  it('defaults to npm', () => {
    write('package.json', { scripts: { dev: 'vite', build: 'vite build' } })
    const [group] = detectScripts(root)
    expect(group).toMatchObject({ source: 'package.json', relDir: '', runner: 'npm' })
    expect(group.scripts).toEqual([
      { name: 'dev', command: 'npm run dev', cwd: root, detail: 'vite' },
      { name: 'build', command: 'npm run build', cwd: root, detail: 'vite build' }
    ])
  })

  it('picks the package manager from the lockfile', () => {
    write('package.json', { scripts: { dev: 'vite' } })
    write('pnpm-lock.yaml', '')
    expect(commands()).toEqual(['pnpm run dev'])
  })

  it('prefers the packageManager field over a lockfile', () => {
    write('package.json', { packageManager: 'yarn@4.1.0', scripts: { dev: 'vite' } })
    write('package-lock.json', '{}')
    expect(commands()).toEqual(['yarn run dev'])
  })

  it('finds workspace packages and inherits the root lockfile', () => {
    write('package.json', { scripts: { lint: 'eslint .' } })
    write('bun.lock', '')
    write('apps/web/package.json', { scripts: { dev: 'next dev' } })
    write('node_modules/dep/package.json', { scripts: { nope: 'x' } })
    const groups = detectScripts(root)
    expect(groups.map((g) => g.relDir)).toEqual(['', join('apps', 'web')])
    expect(groups[1].scripts[0]).toMatchObject({ command: 'bun run dev', cwd: join(root, 'apps', 'web') })
  })

  it('survives a malformed file', () => {
    write('package.json', '{ not json')
    expect(detectScripts(root)).toEqual([])
  })
})

describe('python', () => {
  it('reads entry points and task runners from pyproject.toml', () => {
    write(
      'pyproject.toml',
      [
        '[project.scripts]',
        'serve = "app.main:run"',
        '[tool.poe.tasks]',
        'test = "pytest -q"',
        'lint = { cmd = "ruff check ." }',
        '_hidden = "x"'
      ].join('\n')
    )
    write('uv.lock', '')
    expect(commands('pyproject.toml')).toEqual(['uv run serve', 'uv run poe test', 'uv run poe lint'])
  })

  it('uses poetry when the project is a poetry project', () => {
    write('pyproject.toml', '[tool.poetry.scripts]\ncli = "pkg.cli:main"\n')
    expect(commands()).toEqual(['poetry run cli'])
  })

  it('offers entry files when there is no task runner', () => {
    write('api/main.py', '')
    write('api/manage.py', '')
    expect(commands()).toContain('python3 main.py')
    expect(commands()).toContain('python3 manage.py runserver')
  })
})

describe('other runners', () => {
  it('lists Makefile targets but not variables or special targets', () => {
    write(
      'Makefile',
      ['CC := gcc', '.PHONY: dev', 'dev: deps ## Start everything', '\t@echo hi', 'deps:', '%.o: %.c'].join('\n')
    )
    const [group] = detectScripts(root)
    expect(group.scripts.map((s) => s.command)).toEqual(['make dev', 'make deps'])
    expect(group.scripts[0].detail).toBe('Start everything')
  })

  it('runs Procfile entries directly', () => {
    write('Procfile', 'web: bundle exec puma\nworker: sidekiq\n')
    expect(commands()).toEqual(['bundle exec puma', 'sidekiq'])
  })

  it('detects compose, cargo, go and just', () => {
    write('compose.yaml', 'services: {}')
    write('Cargo.toml', '[package]\nname = "x"')
    write('go.mod', 'module x')
    write('justfile', '# Run the thing\nserve port="80":\n  echo\n_private:\n  echo\n')
    const all = commands()
    expect(all).toEqual(
      expect.arrayContaining(['docker compose up', 'cargo run', 'go run .', 'just serve'])
    )
    expect(all).not.toContain('just _private')
  })
})
