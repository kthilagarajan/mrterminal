import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { configDir } from './config'

/**
 * Shell integration: makes the shell say when a command starts and when the
 * prompt is back, using the standard OSC 133 marks (the same ones iTerm2 and
 * VS Code use). That is the only reliable way to know a terminal is really
 * running something: looking at process names breaks as soon as a prompt
 * framework or a wrapper sits in between.
 *
 *   ESC ] 133 ; C BEL   a command is about to run
 *   ESC ] 133 ; D ; n BEL  it finished with exit code n
 *   ESC ] 133 ; A BEL   the prompt is being drawn
 */

const dir = join(configDir, 'shell')

// OSC 7 lets presets capture a later `cd`, including paths with URI delimiters.
// Keep this in the shell: spawning a helper at every prompt would slow it down.
const CWD_REPORT = `__mrt_cwd() {
  local __mrt_path=$PWD
  __mrt_path=\${__mrt_path//\\%/%25}
  __mrt_path=\${__mrt_path//\\\\/%5C}
  __mrt_path=\${__mrt_path// /%20}
  __mrt_path=\${__mrt_path//\\?/%3F}
  __mrt_path=\${__mrt_path//\\#/%23}
  __mrt_path=\${__mrt_path//$'\\a'/%07}
  __mrt_path=\${__mrt_path//$'\\e'/%1B}
  __mrt_path=\${__mrt_path//$'\\n'/%0A}
  __mrt_path=\${__mrt_path//$'\\r'/%0D}
  builtin printf '\\e]7;file://localhost%s\\a' "$__mrt_path"
}
`

// zsh reads its startup files from $ZDOTDIR. Ours stand in for the user's,
// source the real ones, add two hooks, and hand ZDOTDIR back.
const ZSH_FILES: Record<string, string> = {
  '.zshenv': `# MrTerminal shell integration. Your own ~/.zshenv is loaded from here.
if [[ -f $USER_ZDOTDIR/.zshenv ]]; then
  ZDOTDIR=$USER_ZDOTDIR
  . $USER_ZDOTDIR/.zshenv
  USER_ZDOTDIR=$ZDOTDIR
  ZDOTDIR=$MRT_ZDOTDIR
fi
`,
  '.zprofile': `if [[ -f $USER_ZDOTDIR/.zprofile ]]; then
  ZDOTDIR=$USER_ZDOTDIR
  . $USER_ZDOTDIR/.zprofile
  ZDOTDIR=$MRT_ZDOTDIR
fi
`,
  '.zshrc': `# From here on zsh sees your own configuration directory again, so your
# .zshrc, .zlogin, history and completion cache behave as in any terminal.
if [[ $HISTFILE == $MRT_ZDOTDIR/* ]]; then HISTFILE=$USER_ZDOTDIR/\${HISTFILE:t}; fi
if [[ -n $MRT_ZDOTDIR_UNSET && $USER_ZDOTDIR == $HOME ]]; then unset ZDOTDIR; else ZDOTDIR=$USER_ZDOTDIR; fi
if [[ -f $USER_ZDOTDIR/.zshrc ]]; then . $USER_ZDOTDIR/.zshrc; fi

${CWD_REPORT}
# First in line, so $? is still the exit code of the command that just ended.
__mrt_precmd() { builtin printf '\\e]133;D;%s\\a\\e]133;A\\a' $?; __mrt_cwd }
__mrt_preexec() { builtin printf '\\e]133;C\\a' }
precmd_functions=(__mrt_precmd $precmd_functions)
preexec_functions+=(__mrt_preexec)
unset MRT_ZDOTDIR MRT_ZDOTDIR_UNSET USER_ZDOTDIR
`
}

// bash has no equivalent of ZDOTDIR, so it is started with --init-file and
// this file does what a login shell would have done before adding the marks.
// PS0 (bash 4.4+) is what announces a command; macOS's stock bash 3.2 lacks
// it, and there nothing is emitted so the process-name fallback stays in use.
const BASH_INIT = `# MrTerminal shell integration.
[ -r /etc/profile ] && . /etc/profile
for __mrt_f in ~/.bash_profile ~/.bash_login ~/.profile; do
  if [ -r "$__mrt_f" ]; then . "$__mrt_f"; break; fi
done
unset __mrt_f
${CWD_REPORT}
if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then
  # Runs first and hands $? on, so prompts that show the exit code still see it.
  __mrt_prompt() { local s=$?; builtin printf '\\e]133;D;%s\\a\\e]133;A\\a' $s; return $s; }
  PROMPT_COMMAND="__mrt_prompt\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
  PS0='\\e]133;C\\a'"$PS0"
fi
PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND; }__mrt_cwd"
`

let written = false

function writeFiles(): void {
  if (written) return
  mkdirSync(join(dir, 'zsh'), { recursive: true })
  mkdirSync(join(dir, 'bash'), { recursive: true })
  for (const [name, content] of Object.entries(ZSH_FILES)) writeFileSync(join(dir, 'zsh', name), content)
  writeFileSync(join(dir, 'bash', 'init.sh'), BASH_INIT)
  written = true
}

/** Arguments and environment that start `shell` as a login shell with the marks enabled. */
export function shellLaunch(shell: string, env: Record<string, string>): { args: string[]; env: Record<string, string> } {
  if (process.platform === 'win32') return { args: [], env }
  const name = basename(shell)
  try {
    if (name === 'zsh') {
      writeFiles()
      const zdotdir = join(dir, 'zsh')
      return {
        args: ['-l'],
        env: {
          ...env,
          ZDOTDIR: zdotdir,
          MRT_ZDOTDIR: zdotdir,
          USER_ZDOTDIR: env.ZDOTDIR || env.HOME || homedir(),
          ...(env.ZDOTDIR ? {} : { MRT_ZDOTDIR_UNSET: '1' })
        }
      }
    }
    if (name === 'bash') {
      writeFiles()
      return { args: ['--init-file', join(dir, 'bash', 'init.sh')], env }
    }
  } catch (err) {
    console.error('mrterminal: shell integration unavailable:', err)
  }
  // fish 4 emits the marks by itself; anything else falls back to process names.
  return { args: ['-l'], env }
}

export interface Mark {
  kind: 'A' | 'C' | 'D'
  /** Exit code carried by a `D` mark (`133;D;<code>`). */
  exitCode?: number
  /** Where the mark starts and ends in the text it was found in. */
  start: number
  end: number
}

/** Every complete command mark in a piece of terminal output, in order. */
export function parseMarks(text: string): Mark[] {
  const marks: Mark[] = []
  for (const match of text.matchAll(/\x1b\]133;([ACD])(?:;(\d+))?[^\x07\x1b]*(?:\x07|\x1b\\)/g)) {
    const mark: Mark = { kind: match[1] as Mark['kind'], start: match.index, end: match.index + match[0].length }
    if (match[2] !== undefined) mark.exitCode = Number(match[2])
    marks.push(mark)
  }
  return marks
}

/** The last command mark in a chunk of terminal output, if any. */
export function lastMark(text: string): 'A' | 'C' | 'D' | null {
  return parseMarks(text).at(-1)?.kind ?? null
}
