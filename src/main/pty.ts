import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import * as pty from 'node-pty'
import type { PtyCreateOptions, PtyExit, PtyStatus } from '@shared/types'
import { lastMark, shellLaunch } from './shellIntegration'

interface Session {
  proc: pty.IPty
  shellName: string
  busy: boolean
  process: string
  /** The shell reports command start/end itself; trust that over process names. */
  integrated: boolean
  /**
   * A line has been entered. Until then whatever is in the foreground was
   * started by the shell's own startup files (nvm, brew, compinit...), which
   * is the shell getting ready, not a command running.
   */
  entered: boolean
  /** End of the previous chunk, in case a mark was split across two. */
  tail: string
  /** Pending "type the command once the prompt is up" timers. */
  timers: NodeJS.Timeout[]
}

export interface PtyEvents {
  data(id: string, data: string): void
  exit(e: PtyExit): void
  status(s: PtyStatus): void
}

/**
 * A shell at its prompt is idle, whichever shell it is: people's login shell
 * often hands over to another one (`exec fish` in .zprofile, nix, tmux...).
 */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'xonsh', 'elvish', 'login'])

/** Variables that describe *our* process and would confuse tools in the shell. */
const STRIP_ENV = [/^npm_/, /^ELECTRON_/, /^VITE_/, /^NODE_ENV$/, /^INIT_CWD$/, /^MRTERMINAL_/]

function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || STRIP_ENV.some((re) => re.test(key))) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'MrTerminal'
  return env
}

export function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  if (process.env.SHELL && existsSync(process.env.SHELL)) return process.env.SHELL
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Owns the real shell processes. Each terminal is the user's own login shell
 * running in a pty; commands are typed into it, so Ctrl-C drops back to a
 * prompt with the command in history, exactly as in any other terminal.
 */
export class PtyManager {
  private sessions = new Map<string, Session>()
  private poll: NodeJS.Timeout | null = null
  private shuttingDown = false

  constructor(
    private events: PtyEvents,
    private getShell: () => string | null
  ) {}

  create(opts: PtyCreateOptions): { ok: true } | { ok: false; error: string } {
    this.kill(opts.id)

    const shell = this.getShell() || defaultShell()
    const cwdOk = isDir(opts.cwd)

    let proc: pty.IPty
    try {
      // A login shell, so PATH (nvm, Homebrew, pyenv...) matches the user's
      // normal terminal even when the app was launched from Finder.
      const launch = shellLaunch(shell, shellEnv())
      proc = pty.spawn(shell, launch.args, {
        name: 'xterm-256color',
        cols: Math.max(2, opts.cols),
        rows: Math.max(1, opts.rows),
        cwd: cwdOk ? opts.cwd : homedir(),
        env: launch.env
      })
    } catch (err) {
      return { ok: false, error: `Could not start ${shell}: ${(err as Error).message}` }
    }

    const session: Session = {
      proc,
      shellName: basename(shell).replace(/\.exe$/i, ''),
      busy: false,
      process: '',
      integrated: false,
      entered: false,
      tail: '',
      timers: []
    }
    this.sessions.set(opts.id, session)

    if (!cwdOk) {
      this.events.data(
        opts.id,
        `\x1b[33mFolder not found: ${opts.cwd}\r\nStarted in your home folder instead.\x1b[0m\r\n`
      )
    }

    let sawOutput = false
    proc.onData((data) => {
      if (this.sessions.get(opts.id) !== session) return
      this.events.data(opts.id, data)
      const mark = lastMark(session.tail + data)
      session.tail = data.slice(-12)
      if (mark) {
        session.integrated = true
        this.setStatus(opts.id, session, mark === 'C', session.process)
      }
      if (!sawOutput) {
        sawOutput = true
        onFirstOutput()
      }
    })
    proc.onExit(({ exitCode, signal }) => {
      if (this.sessions.get(opts.id) !== session) return // killed by us
      this.clear(session)
      this.sessions.delete(opts.id)
      if (!this.shuttingDown) this.events.exit({ id: opts.id, exitCode, signal })
    })

    // Wait for the shell to print its prompt before typing, otherwise the
    // command is echoed twice (once raw, once by the line editor).
    let typed = false
    const type = (): void => {
      if (typed || !opts.command || !cwdOk || this.sessions.get(opts.id) !== session) return
      typed = true
      if (opts.run) session.entered = true
      proc.write(opts.run ? `${opts.command}\r` : opts.command)
    }
    const onFirstOutput = (): void => {
      if (opts.command) session.timers.push(setTimeout(type, 250))
    }
    if (opts.command) session.timers.push(setTimeout(type, 3000))

    this.startPolling()
    return { ok: true }
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (/[\r\n]/.test(data)) session.entered = true
    session.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || cols < 2 || rows < 1) return
    try {
      session.proc.resize(cols, rows)
    } catch {
      /* the process exited between the check and the call */
    }
  }

  /** Stop a terminal without reporting an exit for it. */
  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    this.clear(session)
    try {
      session.proc.kill()
    } catch {
      /* already gone */
    }
  }

  killAll(): void {
    this.shuttingDown = true
    for (const id of [...this.sessions.keys()]) this.kill(id)
    if (this.poll) clearInterval(this.poll)
    this.poll = null
  }

  private clear(session: Session): void {
    for (const t of session.timers) clearTimeout(t)
    session.timers = []
  }

  private setStatus(id: string, session: Session, busy: boolean, process: string): void {
    if (busy === session.busy && process === session.process) return
    session.busy = busy
    session.process = process
    this.events.status({ id, busy, process })
  }

  /**
   * Keep the foreground process name current (shown in tooltips). Shells
   * without integration are also judged busy or idle by that name.
   */
  private startPolling(): void {
    if (this.poll || process.platform === 'win32') return
    this.poll = setInterval(() => {
      if (this.sessions.size === 0) {
        clearInterval(this.poll!)
        this.poll = null
        return
      }
      for (const [id, session] of this.sessions) {
        let name: string
        try {
          name = basename(session.proc.process).replace(/^-/, '')
        } catch {
          continue
        }
        const looksBusy = name !== '' && name !== session.shellName && !SHELLS.has(name)
        this.setStatus(id, session, session.integrated ? session.busy : session.entered && looksBusy, name)
      }
    }, 1000)
  }
}
