/**
 * The few lines `mrt skill install` puts into an agent's always-loaded
 * instructions (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md), between markers so
 * a later install replaces them and leaves the user's own text alone.
 */

const RULES_BEGIN = '<!-- mrt:begin (written by `mrt skill install`; edits inside are replaced) -->'
const RULES_END = '<!-- mrt:end -->'
export const AGENT_RULES = `${RULES_BEGIN}
## MrTerminal

MrTerminal is installed: the \`mrt\` command drives the user's terminal workspace
(see the mrt skill, or \`mrt skill show\`).

- Run every long-running command (dev servers, watchers, workers, logs) with
  \`mrt run\`, never in your own shell or as a background job.
- Reuse the project's terminals: check \`mrt ls\` first. \`mrt run\` and
  \`mrt open -- <command>\` pick up the terminal already open for a command and
  start it again if it stopped. Don't pass \`--new\` unless asked.
- To start a stopped terminal again, \`mrt restart <terminal>\`: it re-runs its
  last command, whoever ran it.
${RULES_END}`

/** The file's text with the rules block in it, replacing an earlier one, everything else kept. */
export function withRules(existing: string): string {
  const start = existing.indexOf(RULES_BEGIN)
  const end = existing.indexOf(RULES_END, start)
  if (start >= 0 && end > start) return existing.slice(0, start) + AGENT_RULES + existing.slice(end + RULES_END.length)
  const gap = existing === '' ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return `${existing}${gap}${AGENT_RULES}\n`
}
