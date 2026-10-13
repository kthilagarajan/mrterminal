import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import type { TerminalDef } from '@shared/types'
import { getState, setStatus } from './store'

/**
 * A live terminal: an xterm.js view plus the shell process behind it in the
 * main process. It lives outside both React and dockview so that dragging a
 * tab between splits (which remounts its panel) never touches the process.
 */
export interface Runtime {
  def: TerminalDef
  term: Terminal
  el: HTMLDivElement
  restart(): void
  /** Take keyboard focus, now or as soon as the terminal is on screen. */
  focus(): void
  /** Re-measure after something other than the panel size changed. */
  refit(): void
  dispose(): void
}

const runtimes = new Map<string, Runtime>()
const exitHandlers = new Map<string, (exitCode: number) => void>()
let onCleanExit: (id: string) => void = () => {}

const FONT = '"SF Mono", Menlo, Monaco, "JetBrains Mono", "DejaVu Sans Mono", Consolas, monospace'

const THEME = {
  background: '#0d0e12',
  foreground: '#d7dae0',
  cursor: '#f472b6',
  cursorAccent: '#0d0e12',
  selectionBackground: '#3b4261',
  black: '#1c1e26',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#c0caf5',
  brightBlack: '#565f89',
  brightRed: '#ff899d',
  brightGreen: '#b9f27c',
  brightYellow: '#ffc777',
  brightBlue: '#8db0ff',
  brightMagenta: '#c7a9ff',
  brightCyan: '#a4daff',
  brightWhite: '#ffffff'
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
  const term = new Terminal({
    fontFamily: FONT,
    fontSize: getState().config?.settings.fontSize ?? 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    macOptionClickForcesSelection: true,
    theme: THEME
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

  const start = (runCommand: boolean): void => {
    started = true
    exited = false
    setStatus(id, { busy: false, process: '' })
    void window.api.pty
      .create({ id, cwd: def.cwd, cols: term.cols, rows: term.rows, command: def.command, run: runCommand })
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
    if (!started) start(run)
  }
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
    term,
    el,
    refit: layout,
    focus() {
      wantsFocus = !opened
      if (opened) term.focus()
    },
    restart() {
      if (!opened) return
      term.reset()
      start(true)
      term.focus()
    },
    dispose() {
      runtimes.delete(id)
      observer.disconnect()
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

export function setFontSize(size: number): void {
  for (const runtime of runtimes.values()) {
    runtime.term.options.fontSize = size
    runtime.refit()
  }
}

/** Route process events from the main process to their terminals. */
export function connectPtyEvents(): void {
  window.api.pty.onData(({ id, data }) => runtimes.get(id)?.term.write(data))
  window.api.pty.onExit(({ id, exitCode, signal }) => exitHandlers.get(id)?.(signal ? 1 : exitCode))
  window.api.pty.onStatus(({ id, busy, process }) => {
    if (runtimes.has(id)) setStatus(id, { busy, process })
  })
}
