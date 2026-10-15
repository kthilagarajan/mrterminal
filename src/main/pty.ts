import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import * as pty from 'node-pty'
import type { CommandResult, PtyCreateOptions, PtyExit, PtyStatus } from '@shared/types'
import { plainText } from './plainText'
import { parseMarks, shellLaunch } from './shellIntegration'

/** One command line the shell ran, located in the session's output. */
interface CommandRecord {
  /** Increases across all terminals, so "commands after now" is one comparison. */
  seq: number
  /** Output offsets (see `Session.output`) where its output starts and ends. */
  start: number
  end?: number
  exitCode?: number
}

/** How much raw output is kept per terminal for `mrt read --command` and `mrt wait`. */
const OUTPUT_LIMIT = 1_000_000
const COMMAND_LIMIT = 100

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
  /** The command line running now, when the shell reports it. */
  line?: string
  /** Output offset where the last mark found ended; marks before it are already counted. */
  markedUpTo: number
  /** The most recent output; its first character is output offset `outputStart`. */
  output: string
  outputStart: number
  commands: CommandRecord[]
  /** Seen busy since the last line was entered; the fallback for shells without marks. */
  sawBusy: boolean
  /** The shell has drawn its first prompt (or, without marks, has had time to). */
  prompted: boolean
  /** A command is about to be typed on start and has not been seen starting yet. */
  starting: boolean
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
const STRIP_ENV = [/^npm_/, /^ELECTRON_/, /^VITE_/, /^NODE_ENV$/, /^INIT_CWD$/, /^MRTERMINAL_/, /^MRT_/]

function shellEnv(id: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || STRIP_ENV.some((re) => re.test(key))) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'MrTerminal'
  // Lets `mrt` (and an agent) running inside a terminal know which one it is.
  env.MRT_TERMINAL_ID = id
  if (process.env.MRTERMINAL_HOME) env.MRTERMINAL_HOME = process.env.MRTERMINAL_HOME
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
  private seq = 0

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
      const launch = shellLaunch(shell, shellEnv(opts.id))
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
      markedUpTo: 0,
      output: '',
      outputStart: 0,
      commands: [],
      sawBusy: false,
      prompted: false,
      starting: !!(opts.command && opts.run && cwdOk),
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
      this.record(opts.id, session, data)
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
      if (opts.run) this.entered(session)
      proc.write(opts.run ? `${opts.command}\r` : opts.command)
    }
    const onFirstOutput = (): void => {
      if (opts.command) session.timers.push(setTimeout(type, 250))
      // Shells without marks never announce their prompt; give them a moment.
      session.timers.push(setTimeout(() => (session.prompted = true), 1500))
    }
    if (opts.command) session.timers.push(setTimeout(type, 3000))

    this.startPolling()
    return { ok: true }
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (/[\r\n]/.test(data)) this.entered(session)
    session.proc.write(data)
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  /** The newest command number handed out so far, in any terminal. */
  get lastSeq(): number {
    return this.seq
  }

  /** What the shell in a terminal is doing, for `mrt ls`. */
  info(id: string): { busy: boolean; process: string; integrated: boolean; lastCommand?: CommandResult } | null {
    const session = this.sessions.get(id)
    if (!session) return null
    const last = session.commands.at(-1)
    return {
      busy: session.busy,
      process: session.process,
      integrated: session.integrated,
      lastCommand: last && this.result(session, last)
    }
  }

  /** The newest command that has started (running or finished), if any. */
  lastCommand(id: string): CommandResult | null {
    const session = this.sessions.get(id)
    const last = session?.commands.at(-1)
    return session && last ? this.result(session, last) : null
  }

  /** The command running right now, if the shell reports commands. */
  runningSeq(id: string): number | null {
    const last = this.sessions.get(id)?.commands.at(-1)
    return last && last.end === undefined ? last.seq : null
  }

  /**
   * The terminal is about to run its command: just opened or restarted,
   * shell still starting. A missing session counts, since the renderer
   * creates it a moment after a terminal opens.
   */
  starting(id: string): boolean {
    const session = this.sessions.get(id)
    return !session || session.starting
  }

  /** Resolve once the shell is at its first prompt, so typed text is not echoed twice. */
  waitForPrompt(id: string, timeoutMs: number): Promise<boolean> {
    return this.until(timeoutMs, (timedOut) => {
      const session = this.sessions.get(id)
      return session?.prompted ? true : timedOut ? false : null
    })
  }

  /**
   * Resolve once the first command in `id` numbered above `afterSeq` has
   * finished. The terminal may not exist yet, or be about to restart: it is
   * looked up afresh on every check. Shells that send no marks are judged by
   * busy going back to idle, without an exit code.
   */
  waitForCommand(id: string, afterSeq: number, timeoutMs: number): Promise<CommandResult & { timedOut: boolean }> {
    return this.until(timeoutMs, (timedOut) => {
      const session = this.sessions.get(id)
      if (!session) return timedOut ? { output: '', running: false, timedOut } : null
      const command = session.commands.find((c) => c.seq > afterSeq)
      if (command && (command.end !== undefined || timedOut)) return { ...this.result(session, command), timedOut }
      if (!session.integrated && session.entered && session.sawBusy && !session.busy) {
        return { output: plainText(session.output.slice(-20_000)), running: false, timedOut: false }
      }
      return timedOut ? { output: plainText(session.output.slice(-20_000)), running: true, timedOut } : null
    })
  }

  /**
   * Resolve once `pattern` shows up in the output of the terminal's newest
   * command (running or finished), so a server that was already up before
   * the wait began still counts, and the typed command line itself does not.
   * Shells without marks have no commands; there the whole output is searched.
   */
  waitForMatch(id: string, pattern: RegExp, timeoutMs: number): Promise<{ match?: string; timedOut: boolean }> {
    return this.until(timeoutMs, (timedOut) => {
      const session = this.sessions.get(id)
      if (session) {
        const last = session.commands.at(-1)
        const text = last ? this.result(session, last).output : plainText(session.output)
        const match = text.match(pattern)
        if (match) return { match: match[0], timedOut: false }
      }
      return timedOut ? { timedOut } : null
    })
  }

  /** Resolve once nothing is running in the terminal. */
  waitForIdle(id: string, timeoutMs: number): Promise<{ timedOut: boolean }> {
    return this.until(timeoutMs, (timedOut) => {
      const session = this.sessions.get(id)
      if (!session || !session.busy) return { timedOut: false }
      return timedOut ? { timedOut } : null
    })
  }

  private until<T>(timeoutMs: number, check: (timedOut: boolean) => T | null): Promise<T> {
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve) => {
      const tick = (): void => {
        const timedOut = Date.now() >= deadline
        const result = check(timedOut)
        if (result !== null) resolve(result)
        else setTimeout(tick, 100)
      }
      tick()
    })
  }

  private entered(session: Session): void {
    session.entered = true
    session.sawBusy = session.busy
  }

  /** Keep the output, and turn command marks into command records. */
  private record(id: string, session: Session, data: string): void {
    const base = session.outputStart + session.output.length
    session.output += data
    if (session.output.length > OUTPUT_LIMIT) {
      const drop = session.output.length - OUTPUT_LIMIT * 0.75
      session.output = session.output.slice(drop)
      session.outputStart += drop
    }

    const text = session.tail + data
    const textStart = base - session.tail.length
    // Long enough for a C mark with its command line (see shellIntegration.ts).
    session.tail = text.slice(-4096)
    for (const mark of parseMarks(text)) {
      const start = textStart + mark.start
      const end = textStart + mark.end
      if (start < session.markedUpTo) continue
      session.markedUpTo = end
      session.integrated = true
      const open = session.commands.at(-1)
      if (mark.kind === 'A') session.prompted = true
      session.line = mark.kind === 'C' ? mark.commandLine : undefined
      if (mark.kind === 'C') {
        session.starting = false
        if (open && open.end === undefined) open.end = start
        session.commands.push({ seq: ++this.seq, start: end })
        if (session.commands.length > COMMAND_LIMIT) session.commands.shift()
      } else if (open && open.end === undefined) {
        open.end = start
        open.exitCode = mark.exitCode
      }
      this.setStatus(id, session, mark.kind === 'C', session.process, true)
    }
  }

  private result(session: Session, command: CommandRecord): CommandResult {
    const from = Math.max(0, command.start - session.outputStart)
    const to = command.end === undefined ? undefined : command.end - session.outputStart
    return {
      output: plainText(session.output.slice(from, to)),
      exitCode: command.exitCode,
      running: command.end === undefined,
      truncated: command.start < session.outputStart || undefined
    }
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

  private setStatus(id: string, session: Session, busy: boolean, process: string, marked = false): void {
    // A new C mark while busy is a new command line (zsh can run one from a hook).
    if (busy === session.busy && process === session.process && !(marked && busy)) return
    if (busy) session.sawBusy = true
    session.busy = busy
    session.process = process
    this.events.status({ id, busy, process, command: busy ? session.line : undefined })
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
