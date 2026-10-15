import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import { getTheme, type Theme } from '@shared/themes'
import type { TerminalDef } from '@shared/types'
import { getState, setShellCwd, setStatus } from './store'
import { cwdFromOsc7 } from './terminalCwd'

/**
 * A live terminal: an xterm.js view plus the shell process behind it in the
 * main process. It lives outside both React and dockview so that dragging a
 * tab between splits (which remounts its panel) never touches the process.
 */
export interface Runtime {
  def: TerminalDef
  /** Live shell directory, separate from the command's original launch directory. */
  readonly cwd: string
  term: Terminal
  el: HTMLDivElement
  restart(cwd?: string, focus?: boolean): void
  /** Take keyboard focus, now or as soon as the terminal is on screen. */
  focus(): void
  /** Re-measure after something other than the panel size changed. */
  refit(): void
  dispose(): void
}

const runtimes = new Map<string, Runtime>()
let holdFocusUntil = 0

/**
 * Show something without taking the keyboard away from the user. `mrt` brings
 * the terminals an agent works in on screen, but the user may be typing in
 * another one; switching tabs and projects focuses a terminal, and those
 * focus calls are ignored for a moment.
 */
export function holdFocus(ms = 400): void {
  holdFocusUntil = performance.now() + ms
}
const exitHandlers = new Map<string, (exitCode: number) => void>()
let onCleanExit: (id: string) => void = () => {}

// Geist Mono first; the system fonts behind it supply glyphs it lacks.
const DEFAULT_FONT = '"Geist Mono Variable", "SF Mono", Menlo, Monaco, "DejaVu Sans Mono", Consolas, monospace'

/** The user's font first, ours behind it in case it is missing a glyph (or missing). */
export function fontStack(custom: string | null | undefined): string {
  const name = custom?.trim().replace(/["']/g, '')
  return name ? `"${name}", ${DEFAULT_FONT}` : DEFAULT_FONT
}

function terminalTheme(theme: Theme): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = theme.term.normal
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] =
    theme.term.bright
  return {
    background: theme.ui.bg,
    foreground: theme.ui.text,
    cursor: theme.ui.accent,
    cursorAccent: theme.ui.bg,
    selectionBackground: theme.term.selection,
    scrollbarSliderBackground: `${theme.ui.muted}40`,
    scrollbarSliderHoverBackground: `${theme.ui.muted}66`,
    scrollbarSliderActiveBackground: `${theme.ui.muted}80`,
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
  }
}

/** The line-editing shortcuts macOS users expect from Terminal.app / iTerm. */
const MAC_KEYS: Record<string, string> = {
  'meta+ArrowLeft': '\x01',
  'meta+ArrowRight': '\x05',
  'meta+Backspace': '\x15',
  'alt+ArrowLeft': '\x1bb',
  'alt+ArrowRight': '\x1bf',
  'alt+Backspace': '\x17'
}

export function getRuntime(id: string): Runtime | undefined {
  return runtimes.get(id)
}

export function setCleanExitHandler(handler: (id: string) => void): void {
  onCleanExit = handler
}

/** @param run run the terminal's command on start, or only type it at the prompt */
export function ensureRuntime(def: TerminalDef, run: boolean): Runtime {
  const existing = runtimes.get(def.id)
  if (existing) return existing

  const { id } = def
  const settings = getState().config?.settings
  const term = new Terminal({
    fontFamily: fontStack(settings?.fontFamily),
    fontSize: settings?.fontSize ?? 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    macOptionClickForcesSelection: true,
    theme: terminalTheme(getTheme(settings?.theme))
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)))

  const el = document.createElement('div')
  el.className = 'term'

  let opened = false
  let started = false
  let exited = false
  let wantsFocus = false
  let frame = 0
  let cwd = def.cwd

  term.parser.registerOscHandler(7, (value) => {
    const reported = cwdFromOsc7(value, window.api.platform)
    if (reported !== null) {
      cwd = reported
      setShellCwd(id, reported)
    }
    return true
  })

  // A plain shell restarts where it was left; a command where it was launched.
  // The first start picks up whatever was running when the app last quit.
  const start = (runCommand: boolean, directory = def.command ? def.cwd : cwd, command = def.command): void => {
    started = true
    exited = false
    cwd = directory
    setStatus(id, { busy: false, process: '' })
    void window.api.pty
      .create({ id, cwd: directory, cols: term.cols, rows: term.rows, command, run: runCommand })
      .then((result) => {
        if (!result.ok) {
          exited = true
          term.write(`\x1b[31m${result.error}\x1b[0m\r\n`)
          setStatus(id, { busy: false, process: '', exitCode: 1 })
        }
      })
  }

  // xterm can only measure itself once it is on screen, so the shell is
  // started on first layout and always gets the real size.
  const layout = (): void => {
    if (el.clientWidth < 20 || el.clientHeight < 20) return
    if (!opened) {
      opened = true
      term.open(el)
      if (wantsFocus) term.focus()
    }
    fit.fit()
    if (!started) start(run, undefined, def.resume ?? def.command)
    else window.api.pty.resize(id, term.cols, term.rows)
  }
  // A terminal in a background tab is never laid out. Its command still has
  // to start (think of a restored session), so begin at the default size; it
  // is resized the moment the tab is shown.
  const startHidden = window.setTimeout(() => {
    if (!started) start(run, undefined, def.resume ?? def.command)
  }, 500)
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(layout)
  })
  observer.observe(el)

  term.onData((data) => {
    if (exited) {
      if (data === '\r') runtime.restart()
      return
    }
    window.api.pty.write(id, data)
  })
  term.onResize(({ cols, rows }) => window.api.pty.resize(id, cols, rows))

  if (window.api.platform === 'darwin') {
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || event.ctrlKey || event.shiftKey) return true
      if (event.metaKey === event.altKey) return true
      const sequence = MAC_KEYS[`${event.metaKey ? 'meta' : 'alt'}+${event.key}`]
      if (!sequence) return true
      event.preventDefault()
      window.api.pty.write(id, sequence)
      return false
    })
  }

  const runtime: Runtime = {
    def,
    get cwd() { return cwd },
    term,
    el,
    refit: layout,
    focus() {
      if (performance.now() < holdFocusUntil) return
      wantsFocus = !opened
      if (opened) term.focus()
    },
    restart(directory, focus = true) {
      term.reset()
      start(true, directory)
      if (focus) term.focus()
    },
    dispose() {
      runtimes.delete(id)
      observer.disconnect()
      window.clearTimeout(startHidden)
      cancelAnimationFrame(frame)
      window.api.pty.kill(id)
      term.dispose()
      el.remove()
    }
  }
  runtimes.set(id, runtime)

  exitHandlers.set(id, (exitCode) => {
    // Typing `exit` closes the terminal like anywhere else; a crash keeps the
    // output on screen so it can be read.
    if (exitCode === 0) return onCleanExit(id)
    exited = true
    setStatus(id, { busy: false, process: '', exitCode })
    term.write(`\r\n\x1b[2m[shell exited with code ${exitCode} · press Enter to restart]\x1b[0m\r\n`)
  })

  return runtime
}

export function disposeRuntime(id: string): void {
  exitHandlers.delete(id)
  runtimes.get(id)?.dispose()
}

export function setFont(size: number, family: string | null): void {
  for (const runtime of runtimes.values()) {
    runtime.term.options.fontSize = size
    runtime.term.options.fontFamily = fontStack(family)
    runtime.refit()
  }
}

export function refitAll(): void {
  for (const runtime of runtimes.values()) runtime.refit()
}

export function setTerminalTheme(theme: Theme): void {
  for (const runtime of runtimes.values()) runtime.term.options.theme = terminalTheme(theme)
}

/** Route process events from the main process to their terminals. */
export function connectPtyEvents(): void {
  window.api.pty.onData(({ id, data }) => runtimes.get(id)?.term.write(data))
  window.api.pty.onExit(({ id, exitCode, signal }) => exitHandlers.get(id)?.(signal ? 1 : exitCode))
  window.api.pty.onStatus(({ id, busy, process, command }) => {
    if (runtimes.has(id)) setStatus(id, { busy, process, command })
  })
}
