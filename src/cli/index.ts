import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { AppState, TermInfo } from '@shared/control'
import type { CommandResult, ScriptGroup } from '@shared/types'
import { version } from '../../package.json'
import schema from '../../schema/config.schema.json'
import skill from '../../skills/mrt/SKILL.md?raw'
import { configPath } from '../main/config'
import { call, ensureApp, NotRunning } from './client'
import { COMMANDS, GLOBAL_HELP, helpText } from './commands'

class Usage extends Error {}

const { values: opts, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        project: { type: 'string', short: 'p' },
        json: { type: 'boolean' },
        'no-launch': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        cwd: { type: 'string' },
        title: { type: 'string' },
        name: { type: 'string' },
        split: { type: 'string' },
        new: { type: 'boolean' },
        wait: { type: 'boolean' },
        timeout: { type: 'string' },
        'no-enter': { type: 'boolean' },
        lines: { type: 'string' },
        all: { type: 'boolean' },
        command: { type: 'boolean' },
        match: { type: 'string' },
        dir: { type: 'string' }
      }
    })
  } catch (err) {
    process.stderr.write(`mrt: ${(err as Error).message}\nRun mrt --help for usage.\n`)
    process.exit(2)
  }
})()

const context = { cwd: process.cwd(), terminalId: process.env.MRT_TERMINAL_ID }
const json = opts.json === true

function out(text: string): void {
  if (text) process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

/** Ask the app, starting it first if needed. */
async function app<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  await ensureApp(!opts['no-launch'])
  return call<T>(method, { context, project: opts.project, ...params })
}

function need(value: string | undefined, usage: string): string {
  if (!value) throw new Usage(`Usage: mrt ${usage}`)
  return value
}

function state(t: TermInfo): string {
  if (t.shellExitCode !== undefined) return `shell exited ${t.shellExitCode}`
  if (t.running) return 'running'
  const exit = t.lastCommand?.exitCode
  return exit === undefined ? 'idle' : exit === 0 ? 'idle (last: ok)' : `idle (last: exit ${exit})`
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ')).join('\n')
}

function terminals(list: TermInfo[]): string {
  if (list.length === 0) return 'No terminals are open.'
  return table([
    ['ID', 'PROJECT', 'STATE', 'TITLE', 'COMMAND'],
    ...list.map((t) => [t.id, t.project, state(t), t.title, t.command ?? '(shell)'])
  ])
}

/** Print a finished (or still running) command and pick the exit code for mrt. */
function commandResult(result: (CommandResult & { timedOut?: boolean }) | undefined): number {
  if (!result) return 0
  if (json) return result.timedOut ? 124 : (result.exitCode ?? 0)
  out(result.output)
  if (result.timedOut) {
    process.stderr.write('mrt: still running after the timeout; check again with mrt wait or mrt read.\n')
    return 124
  }
  if (result.exitCode !== undefined) process.stderr.write(`mrt: exit ${result.exitCode}\n`)
  return result.exitCode ?? 0
}

/**
 * Agents that do not read the shared ~/.agents/skills folder get a link to
 * it, so there is one copy to update.
 */
const AGENT_SKILL_DIRS = [{ agent: 'Claude Code', home: join(homedir(), '.claude') }]

/** Write the skill to ~/.agents/skills/mrt (or `dir`) and link it where agents look. */
function installSkill(dir: string | undefined): { path: string; linked: { agent: string; path: string }[]; skipped: string[] } {
  const target = resolve(dir ?? join(homedir(), '.agents', 'skills', 'mrt'))
  const file = join(target, 'SKILL.md')
  mkdirSync(target, { recursive: true })
  writeFileSync(file, skill)
  const linked: { agent: string; path: string }[] = []
  const skipped: string[] = []
  if (dir) return { path: file, linked, skipped }

  for (const { agent, home } of AGENT_SKILL_DIRS) {
    if (!existsSync(home)) continue
    const link = join(home, 'skills', 'mrt')
    let existing: ReturnType<typeof lstatSync> | null = null
    try {
      existing = lstatSync(link)
    } catch {
      /* nothing there yet */
    }
    // Replace our own earlier link or copy, never someone else's skill.
    const ours =
      !existing ||
      existing.isSymbolicLink() ||
      (existing.isDirectory() &&
        readdirSync(link).every((f) => f === 'SKILL.md') &&
        /^---\nname: mrt\n/.test(readFileSync(join(link, 'SKILL.md'), 'utf8')))
    if (!ours) {
      skipped.push(link)
      continue
    }
    rmSync(link, { recursive: true, force: true })
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link)
    linked.push({ agent, path: link })
  }
  return { path: file, linked, skipped }
}

/** Each command prints its result and returns mrt's exit code. */
async function run(): Promise<number> {
  const [command, ...args] = positionals
  if (opts.version) return out(version), 0
  if (!command || command === 'help' || opts.help) {
    const topic = COMMANDS.find((c) => c.name === (command === 'help' ? args[0] : command))
    out(topic ? `Usage: mrt ${topic.usage}\n\n${topic.summary}.\n\n${GLOBAL_HELP}` : helpText(version))
    return 0
  }

  const print = (result: unknown, text: () => string): number => {
    out(json ? JSON.stringify(result, null, 2) : text())
    return 0
  }
  const rest = args.join(' ')

  switch (command) {
    case 'status': {
      let status: AppState & { version: string }
      try {
        status = await call('status', { context })
      } catch (err) {
        if (!(err instanceof NotRunning)) throw err
        return print({ running: false }, () => 'MrTerminal is not running.'), 3
      }
      return print({ running: true, ...status }, () =>
        [
          `MrTerminal ${status.version} is running.${status.ready ? '' : ' It is asking how to restore the last session.'}`,
          ...status.projects.flatMap((p) => [
            '',
            `${p.active ? '▶' : ' '} ${p.name}  ${p.path}  (${p.id})`,
            ...p.terminals.map((t) => `    ${t.id}  ${state(t).padEnd(16)} ${t.title}${t.command ? `  $ ${t.command}` : ''}`)
          ])
        ].join('\n')
      )
    }

    case 'ls': {
      const status = await app<AppState>('status')
      const ref = opts.project
      const list = status.projects
        .filter((p) => !ref || p.id === ref || p.name.toLowerCase() === ref.toLowerCase() || p.path === resolve(ref))
        .flatMap((p) => p.terminals)
      return print(list, () => terminals(list))
    }

    case 'projects': {
      const status = await app<AppState>('status')
      return print(status.projects, () =>
        status.projects.length === 0
          ? 'No projects yet. Add one with: mrt project add <folder>'
          : table([
              ['ID', 'NAME', 'TERMINALS', 'FOLDER'],
              ...status.projects.map((p) => [p.id, `${p.name}${p.active ? ' ▶' : ''}`, String(p.terminals.length), p.path])
            ])
      )
    }

    case 'project': {
      const [action, target] = args
      if (action === 'add') {
        const r = await app<{ name: string; id: string }>('project.add', {
          path: resolve(need(target, 'project add <folder>')),
          name: opts.name
        })
        return print(r, () => `Added ${r.name} (${r.id}).`)
      }
      if (action === 'remove') {
        const r = await app<{ removed: string }>('project.remove', { project: need(target ?? opts.project, 'project remove <project>') })
        return print(r, () => `Removed ${r.removed}. Undo in the app with Reopen Closed.`)
      }
      if (action === 'show') {
        const r = await app<{ name: string }>('project.select', { project: target ?? opts.project })
        return print(r, () => `Showing ${r.name}.`)
      }
      throw new Usage('Usage: mrt project add <folder> | remove <project> | show <project>')
    }

    case 'scripts': {
      const r = await app<{ project: string; groups: ScriptGroup[]; commands: { name: string; command: string; cwd?: string }[] }>('scripts')
      return print(r, () => {
        const lines: string[] = []
        for (const g of r.groups) {
          lines.push(`${g.source}${g.relDir ? ` in ${g.relDir}` : ''}`)
          for (const s of g.scripts) lines.push(`  ${(g.relDir ? `${g.relDir}:${s.name}` : s.name).padEnd(24)} ${s.command}`)
        }
        if (r.commands.length > 0) lines.push('Custom commands', ...r.commands.map((c) => `  ${c.name.padEnd(24)} ${c.command}${c.cwd ? `  (in ${c.cwd})` : ''}`))
        return lines.length > 0 ? lines.join('\n') : `Nothing to run was found in ${r.project}.`
      })
    }

    case 'open': {
      const t = await app<TermInfo>('open', { cwd: opts.cwd, title: opts.title, split: opts.split, command: rest || undefined })
      return print(t, () => `Opened ${t.title} in ${t.project} (${t.id}).`)
    }

    case 'run': {
      const r = await app<{ terminal: TermInfo; action: string; result?: CommandResult & { timedOut: boolean } }>('run', {
        target: need(rest, 'run <script|command>'),
        cwd: opts.cwd,
        title: opts.title,
        new: opts.new,
        wait: opts.wait,
        timeout: opts.timeout
      })
      if (json) return out(JSON.stringify(r, null, 2)), commandResult(r.result)
      const verb = r.action === 'already-running' ? 'Already running' : r.action === 'restarted' ? 'Restarted' : 'Started'
      process.stderr.write(`mrt: ${verb} ${r.terminal.title} in ${r.terminal.project} (${r.terminal.id}).\n`)
      return commandResult(r.result)
    }

    case 'send': {
      const [ref, ...words] = args
      const r = await app<{ terminal: TermInfo; result?: CommandResult & { timedOut: boolean } }>('send', {
        terminal: need(ref, 'send <terminal> <text>'),
        text: words.join(' '),
        enter: !opts['no-enter'],
        wait: opts.wait,
        timeout: opts.timeout
      })
      if (json) return out(JSON.stringify(r, null, 2)), commandResult(r.result)
      if (!r.result) process.stderr.write(`mrt: typed into ${r.terminal.title} (${r.terminal.id}).\n`)
      return commandResult(r.result)
    }

    case 'keys': {
      const [ref, ...keys] = args
      if (keys.length === 0) throw new Usage('Usage: mrt keys <terminal> <key>...')
      const r = await app('keys', { terminal: need(ref, 'keys <terminal> <key>...'), keys })
      return print(r, () => '')
    }

    case 'stop': {
      const r = await app('keys', { terminal: need(args[0], 'stop <terminal>'), keys: ['ctrl-c'] })
      return print(r, () => '')
    }

    case 'restart':
    case 'close':
    case 'show': {
      const r = await app<{ terminal?: TermInfo; closed?: TermInfo }>(command, { terminal: need(args[0], `${command} <terminal>`) })
      return print(r, () => '')
    }

    case 'rename': {
      const [ref, ...title] = args
      const r = await app('rename', { terminal: need(ref, 'rename <terminal> <title>'), title: need(title.join(' '), 'rename <terminal> <title>') })
      return print(r, () => '')
    }

    case 'read': {
      const mode = opts.command ? 'command' : opts.all ? 'all' : opts.lines ? 'lines' : 'screen'
      const r = await app<{ output: string } & Partial<CommandResult>>('read', {
        terminal: need(args[0], 'read <terminal>'),
        mode,
        lines: opts.lines ? Number(opts.lines) : undefined
      })
      if (json) return print(r, () => '')
      out(r.output)
      if (mode === 'command') {
        if (r.running) process.stderr.write('mrt: still running\n')
        else if (r.exitCode !== undefined) process.stderr.write(`mrt: exit ${r.exitCode}\n`)
      }
      return 0
    }

    case 'wait': {
      const r = await app<{ terminal: TermInfo; match?: string; timedOut?: boolean; result?: CommandResult & { timedOut?: boolean } }>('wait', {
        terminal: need(args[0], 'wait <terminal>'),
        match: opts.match,
        timeout: opts.timeout
      })
      if (opts.match) {
        print(r, () => (r.match ? r.match : ''))
        if (r.timedOut) process.stderr.write(`mrt: no output matched within the timeout.\n`)
        return r.timedOut ? 124 : 0
      }
      if (json) return out(JSON.stringify(r, null, 2)), r.timedOut ? 124 : commandResult(r.result)
      if (r.timedOut) return process.stderr.write('mrt: still running after the timeout.\n'), 124
      return commandResult(r.result)
    }

    case 'preset': {
      const [action, ...name] = args
      if (!action || action === 'list') {
        const r = await app<{ project: string; presets: { name: string; terminals: number }[] }>('preset.list')
        return print(r, () =>
          r.presets.length === 0
            ? `${r.project} has no presets. Save the open terminals with: mrt preset save <name>`
            : r.presets.map((x) => `${x.name}  (${x.terminals} terminal${x.terminals === 1 ? '' : 's'})`).join('\n')
        )
      }
      if (!['launch', 'save', 'delete'].includes(action)) throw new Usage('Usage: mrt preset list | launch <name> | save <name> | delete <name>')
      const r = await app<{ preset: string; project: string }>(`preset.${action}`, { name: need(name.join(' '), `preset ${action} <name>`) })
      const done = { launch: 'Launched', save: 'Saved', delete: 'Deleted' }[action]
      return print(r, () => `${done} preset ${r.preset} in ${r.project}.`)
    }

    case 'command': {
      const [action, name, ...words] = args
      if (action === 'add') {
        const r = await app('command.add', { name: need(name, 'command add <name> <command>'), command: need(words.join(' '), 'command add <name> <command>'), cwd: opts.cwd })
        return print(r, () => `Added ${name}.`)
      }
      if (action === 'remove') {
        const r = await app('command.remove', { name: need(name, 'command remove <name>') })
        return print(r, () => `Removed ${name}.`)
      }
      throw new Usage('Usage: mrt command add <name> <command> | remove <name>')
    }

    case 'config': {
      const [action = 'path'] = args
      if (action === 'path') return print({ path: configPath }, () => configPath)
      if (action === 'schema') return out(JSON.stringify(schema, null, 2)), 0
      if (action === 'show') {
        if (!existsSync(configPath)) throw new Error(`No configuration yet at ${configPath}.`)
        return out(readFileSync(configPath, 'utf8')), 0
      }
      throw new Usage('Usage: mrt config [path | show | schema]')
    }

    case 'skill': {
      const [action = 'show'] = args
      if (action === 'show') return out(skill), 0
      if (action === 'install') {
        const r = installSkill(opts.dir)
        return print(r, () =>
          [
            `Installed the mrt skill: ${r.path}`,
            ...r.linked.map((l) => `Linked for ${l.agent}: ${l.path}`),
            ...r.skipped.map((l) => `Left alone (not ours): ${l}`)
          ].join('\n')
        )
      }
      throw new Usage('Usage: mrt skill [show | install [--dir D]]')
    }
  }
  throw new Usage(`Unknown command "${command}". Run mrt --help for the list.`)
}

// exitCode rather than exit(), so long output piped elsewhere is not cut off.
run().then(
  (code) => (process.exitCode = code),
  (err: Error) => {
    if (json) process.stdout.write(`${JSON.stringify({ error: err.message })}\n`)
    process.stderr.write(`mrt: ${err.message}\n`)
    process.exitCode = err instanceof Usage ? 2 : err instanceof NotRunning ? 3 : 1
  }
)
