import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { rm } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'mrterminal-pty-'))
process.env.MRTERMINAL_HOME = join(home, 'config')
process.env.HOME = home
const { PtyManager } = await import('./pty')

// Killed shells may still be writing (history, sessions) as this runs; retry.
// Async retries let ConPTY finish releasing its working directory on Windows.
afterAll(() => rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }), 30_000)

const zsh = [process.env.MRT_TEST_ZSH, '/bin/zsh', '/usr/bin/zsh'].find((p) => p && existsSync(p))
const bash = ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash'].find((p) => {
  if (!existsSync(p)) return false
  const [major, minor] = execFileSync(p, ['-c', 'echo ${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}'], { encoding: 'utf8' })
    .split(' ')
    .map(Number)
  return major > 4 || (major === 4 && minor >= 4)
})

for (const shell of [zsh, bash].filter((s): s is string => !!s)) {
  describe(shell, () => {
    it('reports each command\'s own output and exit code, and waits for it', async () => {
      writeFileSync(join(home, '.zshenv'), process.env.MRT_TEST_ZSHENV ?? '')
      writeFileSync(join(home, '.zshrc'), "PROMPT='> '\n")
      writeFileSync(join(home, '.bash_profile'), "PS1='> '\n")
      const ptys = new PtyManager({ data: () => {}, exit: () => {}, status: () => {} }, () => shell)
      ptys.create({ id: 't', cwd: home, cols: 80, rows: 24, command: 'echo first', run: true })

      const first = await ptys.waitForCommand('t', 0, 8000)
      expect(first).toMatchObject({ output: 'first', exitCode: 0, running: false, timedOut: false })

      const before = ptys.lastSeq
      ptys.write('t', 'printf "a\\nb\\n"; sleep 0.3; (exit 3)\r')
      expect(ptys.runningSeq('t')).toBeNull()
      const second = await ptys.waitForCommand('t', before, 8000)
      expect(second).toMatchObject({ output: 'a\nb', exitCode: 3, timedOut: false })
      expect(ptys.lastCommand('t')?.exitCode).toBe(3)

      ptys.write('t', 'sleep 0.5; echo server ready\r')
      await expect(ptys.waitForMatch('t', /server ready/, 8000)).resolves.toMatchObject({ match: 'server ready' })
      // Only what commands print counts, not the command line as typed.
      ptys.write('t', 'echo "typed"only\r')
      await expect(ptys.waitForMatch('t', /"typed"only/, 1500)).resolves.toEqual({ timedOut: true })
      await expect(ptys.waitForMatch('t', /never printed/, 300)).resolves.toEqual({ timedOut: true })

      const third = ptys.lastSeq
      ptys.write('t', 'sleep 5\r')
      const timedOut = await ptys.waitForCommand('t', third, 500)
      expect(timedOut).toMatchObject({ running: true, timedOut: true })
      ptys.killAll()
    }, 20000)
  })
}

const windowsShells = process.platform === 'win32'
  ? ['powershell.exe', 'pwsh.exe'].filter((shell) =>
      (process.env.PATH ?? '').split(delimiter).some((dir) => existsSync(join(dir, shell))))
  : []

for (const shell of windowsShells) {
  describe(shell, () => {
    it('tracks commands, failures, running status and Ctrl-C through a real pty', async () => {
      const ptys = new PtyManager({ data: () => {}, exit: () => {}, status: () => {} }, () => shell)
      try {
        expect(ptys.create({ id: 'ps', cwd: home, cols: 120, rows: 24, command: "Write-Output 'first'", run: true })).toEqual({ ok: true })
        expect(await ptys.waitForCommand('ps', 0, 15_000)).toMatchObject({ output: 'first', exitCode: 0, timedOut: false })
        expect(ptys.info('ps')).toMatchObject({ busy: false, integrated: true })
        let before = ptys.lastSeq
        ptys.write('ps', 'cmd /c exit 3\r')
        expect(await ptys.waitForCommand('ps', before, 8000)).toMatchObject({ exitCode: 3, timedOut: false })
        before = ptys.lastSeq
        ptys.write('ps', "Write-Error 'failed'\r")
        expect(await ptys.waitForCommand('ps', before, 8000)).toMatchObject({ exitCode: 1, timedOut: false })
        before = ptys.lastSeq
        ptys.write('ps', 'Start-Sleep -Seconds 30\r')
        expect(await ptys.waitForCommand('ps', before, 500)).toMatchObject({ running: true, timedOut: true })
        expect(ptys.info('ps')?.busy).toBe(true)
        ptys.write('ps', '\x03')
        expect(await ptys.waitForIdle('ps', 8000)).toEqual({ timedOut: false })
        expect(ptys.info('ps')?.busy).toBe(false)
      } finally {
        ptys.killAll()
      }
    }, 40_000)
  })
}
