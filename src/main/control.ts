import { chmodSync, existsSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import {
  ControlError,
  keyBytes,
  resolveProject,
  resolveTerminal,
  type AppState,
  type CallerContext,
  type ControlRequest,
  type ControlResponse,
  type TermInfo
} from '@shared/control'
import type { ScriptGroup } from '@shared/types'
import type { PtyManager } from './pty'

/** Asks the renderer, which owns projects, layouts and the xterm buffers. */
export type RendererCall = (method: string, params: Record<string, unknown>) => Promise<unknown>

type Ptys = Pick<
  PtyManager,
  | 'has'
  | 'write'
  | 'info'
  | 'lastSeq'
  | 'lastCommand'
  | 'runningSeq'
  | 'starting'
  | 'waitForPrompt'
  | 'waitForCommand'
  | 'waitForMatch'
  | 'waitForIdle'
>

export interface ControlDeps {
  renderer: RendererCall
  ptys: Ptys
  detectScripts: (path: string) => ScriptGroup[]
  version: string
}

type Params = Record<string, unknown>

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

function seconds(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return (Number.isFinite(n) && n > 0 ? n : fallback) * 1000
}

/** Turns one request from `mrt` into renderer calls and pty operations. */
export function createControl(deps: ControlDeps): (method: string, params: Params) => Promise<unknown> {
  const { renderer, ptys } = deps

  async function state(): Promise<AppState> {
    const s = (await renderer('state', {})) as AppState
    for (const project of s.projects) for (const t of project.terminals) enrich(t)
    return s
  }

  function enrich(t: TermInfo): TermInfo {
    const last = ptys.lastCommand(t.id)
    if (last) t.lastCommand = { exitCode: last.exitCode, running: last.running }
    return t
  }

  async function ready(): Promise<AppState> {
    const s = await state()
    if (!s.ready) {
      throw new ControlError(
        'MrTerminal is asking how to restore the last session. Answer it in the app (or set "Restore on launch" in Settings), then retry.'
      )
    }
    return s
  }

  async function terminal(p: Params): Promise<TermInfo> {
    const ref = str(p.terminal)
    if (!ref) throw new ControlError('Which terminal? Pass its id, title or command.')
    return resolveTerminal(await ready(), ref, ctx(p), str(p.project))
  }

  const ctx = (p: Params): CallerContext => (p.context as CallerContext | undefined) ?? {}

  /** Make sure there is a shell to type into, and that it is ready for input. */
  async function shell(t: TermInfo): Promise<void> {
    // Its project has not been shown since launch, so the shell is not
    // running yet; showing it starts it.
    if (!ptys.info(t.id)) await renderer('show', { projectId: t.projectId, terminalId: t.id })
    if (t.shellExitCode !== undefined) {
      throw new ControlError(`The shell in "${t.title}" has exited. Start it again with: mrt restart ${t.id}`)
    }
    if (!(await ptys.waitForPrompt(t.id, 10_000))) throw new ControlError(`The shell in "${t.title}" is not ready.`)
  }

  async function waitCommand(id: string, afterSeq: number, p: Params): Promise<unknown> {
    return ptys.waitForCommand(id, afterSeq, seconds(p.timeout, 60))
  }

  const methods: Record<string, (p: Params) => Promise<unknown>> = {
    async status() {
      return { version: deps.version, ...(await state()) }
    },

    async 'project.add'(p) {
      const path = str(p.path) && resolve(ctx(p).cwd ?? homedir(), str(p.path)!)
      if (!path || !existsSync(path) || !statSync(path).isDirectory()) throw new ControlError(`Not a folder: ${p.path}`)
      await ready()
      const id = await renderer('project.add', { path, name: str(p.name) ?? basename(path) })
      return (await state()).projects.find((x) => x.id === id)
    },
    async 'project.remove'(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      await renderer('project.remove', { projectId: project.id })
      return { removed: project.name }
    },
    async 'project.select'(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      await renderer('project.select', { projectId: project.id })
      return project
    },

    async scripts(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      return { project: project.name, groups: deps.detectScripts(project.path), commands: project.commands }
    },

    async open(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      const cwd = str(p.cwd) && resolve(ctx(p).cwd ?? project.path, str(p.cwd)!)
      return enrich(
        (await renderer('open', {
          projectId: project.id,
          cwd: cwd ?? project.path,
          title: str(p.title),
          command: str(p.command),
          placement: str(p.split) ?? 'auto'
        })) as TermInfo
      )
    },

    async run(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      const target = str(p.target)
      if (!target) throw new ControlError('What should run? Pass a script name or a command.')
      const before = ptys.lastSeq
      const started = (await renderer('run', {
        projectId: project.id,
        target,
        cwd: str(p.cwd) && resolve(ctx(p).cwd ?? project.path, str(p.cwd)!),
        title: str(p.title),
        new: p.new === true
      })) as { terminal: TermInfo; action: 'started' | 'restarted' | 'already-running' }
      if (!p.wait) return started
      // Already running: wait for that run to end rather than for a next one.
      const running = started.action === 'already-running' ? ptys.runningSeq(started.terminal.id) : null
      const result = await waitCommand(started.terminal.id, running !== null ? running - 1 : before, p)
      return { ...started, result }
    },

    async send(p) {
      const t = await terminal(p)
      await shell(t)
      const text = typeof p.text === 'string' ? p.text : ''
      const before = ptys.lastSeq
      await renderer('show', { projectId: t.projectId, terminalId: t.id })
      // Typed as one paste, then Enter, so the line editor sees a finished line.
      ptys.write(t.id, text)
      if (p.enter !== false) ptys.write(t.id, '\r')
      if (!p.wait) return { terminal: t }
      return { terminal: t, result: await waitCommand(t.id, before, p) }
    },

    async keys(p) {
      const t = await terminal(p)
      await shell(t)
      const keys = Array.isArray(p.keys) ? p.keys.map(String) : []
      const data = keys.map(keyBytes).join('')
      await renderer('show', { projectId: t.projectId, terminalId: t.id })
      ptys.write(t.id, data)
      return { terminal: t, sent: keys }
    },

    async restart(p) {
      const t = await terminal(p)
      await renderer('restart', { projectId: t.projectId, terminalId: t.id })
      return { terminal: t }
    },
    async close(p) {
      const t = await terminal(p)
      await renderer('close', { terminalId: t.id })
      return { closed: t }
    },
    async show(p) {
      const t = await terminal(p)
      await renderer('show', { projectId: t.projectId, terminalId: t.id })
      return { terminal: t }
    },
    async rename(p) {
      const t = await terminal(p)
      const title = str(p.title)
      if (!title) throw new ControlError('What should it be called?')
      await renderer('rename', { projectId: t.projectId, terminalId: t.id, title })
      return { terminal: { ...t, title } }
    },

    async read(p) {
      const t = await terminal(p)
      if (p.mode === 'command') {
        const last = ptys.lastCommand(t.id)
        if (!last) {
          const integrated = ptys.info(t.id)?.integrated
          throw new ControlError(
            integrated === false
              ? 'This shell does not report commands (only zsh, bash 4.4+ and fish do); use mrt read without --command.'
              : `No command has run in "${t.title}" yet.`
          )
        }
        return { terminal: t, ...last }
      }
      const text = await renderer('screen', { terminalId: t.id, mode: str(p.mode) ?? 'screen', lines: p.lines })
      return { terminal: t, output: text }
    },

    async wait(p) {
      const t = await terminal(p)
      const timeout = seconds(p.timeout, 60)
      const pattern = str(p.match)
      if (pattern) {
        let re: RegExp
        try {
          re = new RegExp(pattern, 'i')
        } catch {
          throw new ControlError(`Not a valid pattern: ${pattern}`)
        }
        return { terminal: t, ...(await ptys.waitForMatch(t.id, re, timeout)) }
      }
      const running = ptys.runningSeq(t.id)
      if (running !== null) return { terminal: t, result: await ptys.waitForCommand(t.id, running - 1, timeout) }
      // Just opened or restarted: its command has not started yet.
      if (t.command && t.shellExitCode === undefined && ptys.starting(t.id)) {
        return { terminal: t, result: await ptys.waitForCommand(t.id, ptys.lastSeq, timeout) }
      }
      const idle = await ptys.waitForIdle(t.id, timeout)
      return { terminal: t, ...idle, result: ptys.lastCommand(t.id) ?? undefined }
    },

    async 'preset.list'(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      return { project: project.name, presets: project.presets }
    },
    async 'preset.launch'(p) {
      return presetCall('preset.launch', p)
    },
    async 'preset.save'(p) {
      return presetCall('preset.save', p)
    },
    async 'preset.delete'(p) {
      return presetCall('preset.delete', p)
    },

    async 'command.add'(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      const name = str(p.name)
      const command = str(p.command)
      if (!name || !command) throw new ControlError('Usage: mrt command add <name> <command>')
      await renderer('command.add', { projectId: project.id, name, command, cwd: str(p.cwd) })
      return { project: project.name, name, command }
    },
    async 'command.remove'(p) {
      const project = resolveProject(await ready(), str(p.project), ctx(p))
      const name = str(p.name)
      if (!project.commands.some((c) => c.name === name)) throw new ControlError(`No command "${name}" in ${project.name}.`)
      await renderer('command.remove', { projectId: project.id, name })
      return { project: project.name, removed: name }
    }
  }

  async function presetCall(method: string, p: Params): Promise<unknown> {
    const project = resolveProject(await ready(), str(p.project), ctx(p))
    const name = str(p.name)
    if (!name) throw new ControlError('Which preset? Pass its name.')
    if (method !== 'preset.save' && !project.presets.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      const names = project.presets.map((x) => x.name).join(', ')
      throw new ControlError(`No preset "${name}" in ${project.name}.${names ? ` Presets: ${names}` : ''}`)
    }
    await renderer(method, { projectId: project.id, name })
    return { project: project.name, preset: name }
  }

  return (method, params) => {
    const handler = Object.hasOwn(methods, method) ? methods[method] : undefined
    if (!handler) return Promise.reject(new ControlError(`Unknown method: ${method}`))
    return handler(params)
  }
}

/** Serve `handle` on a socket only the current user can open. */
export function serveControl(path: string, handle: (method: string, params: Params) => Promise<unknown>): Server {
  // The single-instance lock means a socket file left here is from a crash.
  if (process.platform !== 'win32' && existsSync(path)) rmSync(path, { force: true })

  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', (chunk: string) => {
      buffer += chunk
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.trim()) void answer(line).then((response) => socket.writable && socket.write(`${JSON.stringify(response)}\n`))
      }
    })
  })

  async function answer(line: string): Promise<ControlResponse> {
    let request: ControlRequest
    try {
      request = JSON.parse(line)
    } catch {
      return { id: 0, error: { message: 'Not JSON' } }
    }
    try {
      return { id: request.id, result: (await handle(request.method, request.params ?? {})) ?? null }
    } catch (err) {
      return { id: request.id, error: { message: (err as Error).message } }
    }
  }

  server.on('error', (err) => console.error('mrterminal: control socket:', err))
  server.listen(path, () => {
    if (process.platform !== 'win32') chmodSync(path, 0o600)
  })
  return server
}
