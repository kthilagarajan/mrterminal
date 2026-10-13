import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import type { DetectedScript, ScriptGroup } from '@shared/types'

const MAX_DEPTH = 3
const MAX_DIRS = 400
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'venv',
  'env',
  'coverage',
  '__pycache__',
  'Pods',
  'DerivedData'
])

type Dict = Record<string, unknown>

interface Ctx {
  root: string
  dir: string
  files: Set<string>
}

type Detector = (ctx: Ctx) => ScriptGroup[]

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function readJson(path: string): Dict | null {
  const text = readText(path)
  if (text === null) return null
  try {
    const value = JSON.parse(text)
    return isDict(value) ? value : null
  } catch {
    return null
  }
}

function readToml(path: string): Dict | null {
  const text = readText(path)
  if (text === null) return null
  try {
    return parseToml(text) as Dict
  } catch {
    return null
  }
}

/** Walk from `dir` up to the project root looking for any of `names`. */
function findUp(ctx: Ctx, names: string[]): string | null {
  let dir = ctx.dir
  for (;;) {
    for (const name of names) if (existsSync(join(dir, name))) return name
    if (dir === ctx.root) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function group(ctx: Ctx, source: string, runner: string, scripts: DetectedScript[]): ScriptGroup[] {
  if (scripts.length === 0) return []
  return [{ source, relDir: relative(ctx.root, ctx.dir), runner, scripts }]
}

function describe(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(' && ')
  if (isDict(value)) {
    for (const key of ['cmd', 'shell', 'script', 'call', 'composite', 'help']) {
      if (typeof value[key] === 'string') return value[key] as string
    }
  }
  return undefined
}

// ── Node ────────────────────────────────────────────────────────────────────

const LOCKFILES: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'package-lock.json': 'npm'
}

function packageManager(ctx: Ctx, pkg: Dict): string {
  const declared = [pkg, ctx.dir === ctx.root ? null : readJson(join(ctx.root, 'package.json'))]
    .map((p) => (typeof p?.packageManager === 'string' ? p.packageManager.split('@')[0] : ''))
    .find((name) => ['npm', 'pnpm', 'yarn', 'bun'].includes(name))
  if (declared) return declared
  const lock = findUp(ctx, Object.keys(LOCKFILES))
  return lock ? LOCKFILES[lock] : 'npm'
}

const packageJson: Detector = (ctx) => {
  if (!ctx.files.has('package.json')) return []
  const pkg = readJson(join(ctx.dir, 'package.json'))
  if (!pkg || !isDict(pkg.scripts)) return []
  const pm = packageManager(ctx, pkg)
  const scripts = Object.entries(pkg.scripts)
    .filter(([, body]) => typeof body === 'string')
    .map(([name, body]) => ({
      name,
      command: `${pm} run ${name}`,
      cwd: ctx.dir,
      detail: body as string
    }))
  return group(ctx, 'package.json', pm, scripts)
}

const denoJson: Detector = (ctx) => {
  const file = ['deno.json', 'deno.jsonc'].find((f) => ctx.files.has(f))
  if (!file) return []
  const tasks = readJson(join(ctx.dir, file))?.tasks
  if (!isDict(tasks)) return []
  const scripts = Object.entries(tasks).map(([name, body]) => ({
    name,
    command: `deno task ${name}`,
    cwd: ctx.dir,
    detail: describe(body)
  }))
  return group(ctx, file, 'deno', scripts)
}

// ── Python ──────────────────────────────────────────────────────────────────

function table(root: Dict, ...path: string[]): Dict | null {
  let node: unknown = root
  for (const key of path) {
    if (!isDict(node)) return null
    node = node[key]
  }
  return isDict(node) ? node : null
}

const pyproject: Detector = (ctx) => {
  if (!ctx.files.has('pyproject.toml')) return []
  const toml = readToml(join(ctx.dir, 'pyproject.toml'))
  if (!toml) return []

  const lock = findUp(ctx, ['uv.lock', 'poetry.lock', 'pdm.lock'])
  const env =
    lock === 'uv.lock' || table(toml, 'tool', 'uv')
      ? 'uv'
      : lock === 'poetry.lock' || table(toml, 'tool', 'poetry')
        ? 'poetry'
        : lock === 'pdm.lock' || table(toml, 'tool', 'pdm')
          ? 'pdm'
          : null
  const prefix = env ? `${env} run ` : ''

  const out: ScriptGroup[] = []
  const add = (runner: string, entries: Dict | null, command: (name: string) => string): void => {
    if (!entries) return
    const scripts = Object.entries(entries)
      .filter(([name]) => !name.startsWith('_'))
      .map(([name, body]) => ({ name, command: command(name), cwd: ctx.dir, detail: describe(body) }))
    out.push(...group(ctx, 'pyproject.toml', runner, scripts))
  }

  // Console entry points: `name = "package.module:function"`.
  const entryPoints = { ...table(toml, 'tool', 'poetry', 'scripts'), ...table(toml, 'project', 'scripts') }
  add(env ?? 'python', entryPoints, (name) => `${prefix}${name}`)
  add('poe', table(toml, 'tool', 'poe', 'tasks'), (name) => `${prefix}poe ${name}`)
  add('pdm', table(toml, 'tool', 'pdm', 'scripts'), (name) => `pdm run ${name}`)
  add('taskipy', table(toml, 'tool', 'taskipy', 'tasks'), (name) => `${prefix}task ${name}`)
  add('hatch', table(toml, 'tool', 'hatch', 'envs', 'default', 'scripts'), (name) => `hatch run ${name}`)
  return out
}

/** Projects with no task runner at all: offer the obvious entry files. */
const pythonEntryFiles: Detector = (ctx) => {
  const lock = findUp(ctx, ['uv.lock', 'poetry.lock', 'pdm.lock'])
  const python = lock ? `${lock.split('.')[0]} run python` : 'python3'
  const scripts: DetectedScript[] = []
  if (ctx.files.has('manage.py')) {
    for (const cmd of ['runserver', 'migrate', 'makemigrations', 'shell', 'test']) {
      scripts.push({ name: cmd, command: `${python} manage.py ${cmd}`, cwd: ctx.dir })
    }
  }
  for (const file of ['main.py', 'app.py', 'server.py', 'run.py']) {
    if (ctx.files.has(file)) scripts.push({ name: file, command: `${python} ${file}`, cwd: ctx.dir })
  }
  return group(ctx, ctx.files.has('manage.py') ? 'manage.py' : 'Python files', 'python', scripts)
}

// ── Make-likes ──────────────────────────────────────────────────────────────

const makefile: Detector = (ctx) => {
  const file = ['Makefile', 'makefile', 'GNUmakefile'].find((f) => ctx.files.has(f))
  if (!file) return []
  const text = readText(join(ctx.dir, file))
  if (text === null) return []
  const seen = new Set<string>()
  const scripts: DetectedScript[] = []
  for (const line of text.split('\n')) {
    // `target: deps  ## help`, but not `VAR := value` or pattern rules.
    const match = /^([A-Za-z0-9_][\w.-]*)\s*:(?![=:])[^#]*(?:##\s*(.+))?$/.exec(line.trimEnd())
    if (!match || seen.has(match[1])) continue
    seen.add(match[1])
    scripts.push({ name: match[1], command: `make ${match[1]}`, cwd: ctx.dir, detail: match[2] })
  }
  return group(ctx, file, 'make', scripts)
}

const justfile: Detector = (ctx) => {
  const file = ['justfile', 'Justfile', '.justfile'].find((f) => ctx.files.has(f))
  if (!file) return []
  const text = readText(join(ctx.dir, file))
  if (text === null) return []
  const scripts: DetectedScript[] = []
  let comment: string | undefined
  for (const line of text.split('\n')) {
    const match = /^@?([A-Za-z_][\w-]*)(?:\s+[^:]*)?:(?!=)/.exec(line)
    if (match && !match[1].startsWith('_')) {
      scripts.push({ name: match[1], command: `just ${match[1]}`, cwd: ctx.dir, detail: comment })
    }
    comment = line.startsWith('#') ? line.replace(/^#+\s*/, '') : undefined
  }
  return group(ctx, file, 'just', scripts)
}

const procfile: Detector = (ctx) => {
  const file = ['Procfile.dev', 'Procfile'].find((f) => ctx.files.has(f))
  if (!file) return []
  const text = readText(join(ctx.dir, file))
  if (text === null) return []
  const scripts: DetectedScript[] = []
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line)
    if (match) scripts.push({ name: match[1], command: match[2].trim(), cwd: ctx.dir, detail: match[2].trim() })
  }
  return group(ctx, file, 'procfile', scripts)
}

// ── Fixed command sets ──────────────────────────────────────────────────────

function fixed(source: string, runner: string, commands: [string, string][]): Detector {
  return (ctx) =>
    group(
      ctx,
      source,
      runner,
      commands.map(([name, command]) => ({ name, command, cwd: ctx.dir }))
    )
}

const compose: Detector = (ctx) => {
  const file = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find((f) =>
    ctx.files.has(f)
  )
  if (!file) return []
  return fixed(file, 'docker', [
    ['up', 'docker compose up'],
    ['up -d', 'docker compose up -d'],
    ['logs', 'docker compose logs -f --tail=100'],
    ['down', 'docker compose down']
  ])(ctx)
}

const cargo: Detector = (ctx) => {
  if (!ctx.files.has('Cargo.toml')) return []
  return fixed('Cargo.toml', 'cargo', [
    ['run', 'cargo run'],
    ['build', 'cargo build'],
    ['test', 'cargo test'],
    ['check', 'cargo check']
  ])(ctx)
}

const goMod: Detector = (ctx) => {
  if (!ctx.files.has('go.mod')) return []
  return fixed('go.mod', 'go', [
    ['run', 'go run .'],
    ['build', 'go build ./...'],
    ['test', 'go test ./...']
  ])(ctx)
}

const composer: Detector = (ctx) => {
  if (!ctx.files.has('composer.json')) return []
  const scripts = readJson(join(ctx.dir, 'composer.json'))?.scripts
  if (!isDict(scripts)) return []
  return group(
    ctx,
    'composer.json',
    'composer',
    Object.entries(scripts)
      .filter(([name]) => !/^(pre|post)-/.test(name))
      .map(([name, body]) => ({ name, command: `composer run ${name}`, cwd: ctx.dir, detail: describe(body) }))
  )
}

const DETECTORS: Detector[] = [
  packageJson,
  denoJson,
  pyproject,
  pythonEntryFiles,
  makefile,
  justfile,
  procfile,
  compose,
  cargo,
  goMod,
  composer
]

/**
 * Find every runnable script in a project: the root plus nested packages
 * (monorepo workspaces, `api/` + `web/` layouts and so on).
 */
export function detectScripts(root: string): ScriptGroup[] {
  const groups: ScriptGroup[] = []
  let queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let visited = 0

  while (queue.length > 0 && visited < MAX_DIRS) {
    const next: typeof queue = []
    for (const { dir, depth } of queue) {
      if (visited++ >= MAX_DIRS) break
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      const files = new Set(entries.filter((e) => !e.isDirectory()).map((e) => e.name))
      const ctx: Ctx = { root, dir, files }
      for (const detect of DETECTORS) groups.push(...detect(ctx))

      if (depth >= MAX_DEPTH) continue
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
        next.push({ dir: join(dir, entry.name), depth: depth + 1 })
      }
    }
    queue = next
  }

  // Breadth-first already puts the root first; keep nested folders alphabetical.
  return groups.sort((a, b) => {
    const depth = (g: ScriptGroup): number => (g.relDir === '' ? 0 : g.relDir.split(/[\\/]/).length)
    return depth(a) - depth(b) || a.relDir.localeCompare(b.relDir)
  })
}
