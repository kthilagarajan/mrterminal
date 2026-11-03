import type { TerminalDef } from '@shared/types'

/** What a terminal is doing right now, as far as reuse cares. */
export interface LiveTerminal {
  busy: boolean
  /** The command line running, when busy and the shell reports it. */
  command?: string
  /** Where its shell is now (a plain shell follows `cd`). */
  cwd: string
}

export interface WantedTerminal {
  command?: string
  cwd: string
  title?: string
}

function samePath(a: string, b: string): boolean {
  const trim = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)
  return trim(a) === trim(b)
}

/**
 * The open terminal an `mrt open` / `mrt run` should use instead of opening
 * another one, so an agent that comes back to a project picks up the
 * terminals it (or the user) already has rather than piling up duplicates.
 *
 * - For a command: the terminal opened for it (command + cwd, as the sidebar
 *   links them); else a plain shell in that folder where it last ran, typed
 *   by hand or sent by an agent, unless that shell is now busy with
 *   something else.
 * - For a plain shell: only one asked for by title, the plain shell of that
 *   title in that folder, busy or not (the caller is told it is running;
 *   opening a second one of the same name would make the name ambiguous).
 *   An untitled request never takes over one of the user's own shells.
 *
 * `exclude` is the caller's own terminal: typing a server into the shell an
 * agent runs in would block the agent.
 */
export function findReusable(
  terminals: TerminalDef[],
  want: WantedTerminal,
  live: (def: TerminalDef) => LiveTerminal,
  exclude?: string
): TerminalDef | undefined {
  const candidates = terminals.filter((t) => t.id !== exclude)
  if (want.command) {
    const own = candidates.find((t) => t.command === want.command && samePath(t.cwd, want.cwd))
    if (own) return own
    return candidates.find((t) => {
      if (t.command) return false
      const now = live(t)
      if (!samePath(now.cwd, want.cwd)) return false
      return now.busy ? now.command === want.command : t.last === want.command
    })
  }
  if (!want.title) return undefined
  const title = want.title.toLowerCase()
  return candidates.find((t) => {
    if (t.command || t.title.toLowerCase() !== title) return false
    return samePath(live(t).cwd, want.cwd)
  })
}
