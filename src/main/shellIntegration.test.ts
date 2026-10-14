import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { afterAll, describe, expect, it } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'mrterminal-shell-'))
process.env.MRTERMINAL_HOME = join(home, 'config')
const { lastMark, shellLaunch } = await import('./shellIntegration')
writeFileSync(join(home, '.zshenv'), process.env.MRT_TEST_ZSHENV ?? '')

// Killed shells may still be writing (history, sessions) as this runs; retry.
afterAll(() => rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))

// MRT_TEST_ZSH lets a machine without a system zsh point at one.
const zsh = [process.env.MRT_TEST_ZSH, '/bin/zsh', '/usr/bin/zsh'].find((p) => p && existsSync(p))
const bash = ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash'].find((p) => {
  if (!existsSync(p)) return false
  const [major, minor] = execFileSync(p, ['-c', 'echo ${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}'], { encoding: 'utf8' })
    .split(' ')
    .map(Number)
  return major > 4 || (major === 4 && minor >= 4)
})

/** Run a shell the way the app does, type `lines` into it, return everything it printed. */
function session(shell: string, env: Record<string, string>, lines: string[]): Promise<string> {
  const launch = shellLaunch(shell, { PATH: process.env.PATH ?? '', TERM: 'xterm-256color', HOME: home, LANG: process.env.LANG ?? 'en_US.UTF-8', ...env })
  const proc = pty.spawn(shell, launch.args, { cols: 120, rows: 24, cwd: home, env: launch.env })
  let output = ''
  proc.onData((data) => (output += data))
  lines.forEach((line, i) => setTimeout(() => proc.write(`${line}\r`), 1200 + i * 900))
  setTimeout(() => proc.write('exit\r'), 1200 + lines.length * 900)
  return new Promise((resolve) => proc.onExit(() => resolve(output)))
}

const marks = (output: string): string => [...output.matchAll(/\x1b\]133;([ACD])/g)].map((m) => m[1]).join('')
const directories = (output: string): string[] => [...output.matchAll(/\x1b\]7;([^\x07]*)\x07/g)]
  .map((m) => decodeURIComponent(new URL(m[1]).pathname))

for (const shell of [zsh, bash].filter((s): s is string => !!s)) {
  it(`${shell} reports the current directory after cd, with special characters intact`, async () => {
    const folder = join(home, 'directory %20 #? \\ ü')
    mkdirSync(folder, { recursive: true })
    const output = await session(shell, {}, [`cd '${folder}'`])
    expect(directories(output)).toContain(home)
    expect(directories(output).at(-1)).toBe(folder)
  }, 15000)
}

describe('lastMark', () => {
  it('reports the most recent mark in a chunk', () => {
    expect(lastMark('hello')).toBeNull()
    expect(lastMark('\x1b]133;C\x07output')).toBe('C')
    expect(lastMark('\x1b]133;C\x07out\x1b]133;D\x07\x1b]133;A\x07$ ')).toBe('A')
  })
})

describe.skipIf(!zsh)('zsh', () => {
  it('marks each command and still loads the user\'s own startup files', async () => {
    // The relocated test zsh needs to be told where its modules are.
    writeFileSync(join(home, '.zshenv'), `${process.env.MRT_TEST_ZSHENV ?? ''}\nexport SAW_ZSHENV=1\n`)
    writeFileSync(join(home, '.zprofile'), 'export SAW_ZPROFILE=1\n')
    writeFileSync(join(home, '.zshrc'), "PROMPT='%~ > '\nexport SAW_ZSHRC=1\nprecmd() { : }\n")
    writeFileSync(join(home, '.zlogin'), 'export SAW_ZLOGIN=1\n')

    const output = await session(zsh!, {}, [
      'echo "files=$SAW_ZSHENV$SAW_ZPROFILE$SAW_ZSHRC$SAW_ZLOGIN zdotdir=[$ZDOTDIR] leak=[$MRT_ZDOTDIR$USER_ZDOTDIR]"',
      'sleep 0.3',
      ''
    ])
    expect(output).toContain('files=1111 zdotdir=[] leak=[]')
    // prompt, then per command: start, end, prompt. The empty line only redraws the prompt.
    expect(marks(output)).toMatch(/^DA(CDA){2}(DA)+C?$/)
  }, 15000)

  it('puts back a ZDOTDIR the user had set', async () => {
    const custom = join(home, 'zdot')
    execFileSync('mkdir', ['-p', custom])
    writeFileSync(join(custom, '.zshenv'), process.env.MRT_TEST_ZSHENV ?? '')
    writeFileSync(join(custom, '.zshrc'), 'export SAW_CUSTOM=1\n')
    const output = await session(zsh!, { ZDOTDIR: custom }, ['echo "custom=$SAW_CUSTOM zdotdir=[$ZDOTDIR]"'])
    expect(output).toContain(`custom=1 zdotdir=[${custom}]`)
  }, 15000)
})

describe.skipIf(!bash)('bash', () => {
  it('marks each command and loads the login profile', async () => {
    writeFileSync(join(home, '.bash_profile'), "export SAW_PROFILE=1\nPS1='$ '\nPROMPT_COMMAND='true'\n")
    const output = await session(bash!, {}, ['echo "profile=$SAW_PROFILE"', 'sleep 0.3'])
    expect(output).toContain('profile=1')
    expect(marks(output)).toMatch(/^DA(CDA){2}C?$/)
  }, 15000)
})
