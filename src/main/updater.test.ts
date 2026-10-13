import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, net: {}, shell: {} }))

const { isNewer, swapScript } = await import('./updater')

describe('isNewer', () => {
  it('compares numerically, not as text', () => {
    expect(isNewer('0.10.0', '0.9.1')).toBe(true)
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('garbage', '0.1.0')).toBe(false)
  })
})

describe('swapScript', () => {
  let dir: string
  let app: string
  let next: string
  let env: NodeJS.ProcessEnv

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mrterminal it's-"))
    app = join(dir, 'Mr Terminal.app')
    next = join(dir, 'new', 'Mr Terminal.app')
    mkdirSync(app)
    mkdirSync(next, { recursive: true })
    writeFileSync(join(app, 'version'), 'old')
    writeFileSync(join(next, 'version'), 'new')
    // Stand in for macOS `open`: record what would have been launched.
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'open'), `#!/bin/sh\necho "$1" > "${join(dir, 'opened')}"\n`, { mode: 0o755 })
    env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const runScript = (pid: number): void => {
    const script = join(dir, 'swap.sh')
    writeFileSync(script, swapScript(pid, app, next))
    execFileSync('/bin/sh', [script], { env })
  }

  it('waits for the app to exit, swaps the bundle and reopens it', () => {
    // Not a child of this process, or it would linger as a zombie and never look exited.
    const pid = Number(execFileSync('/bin/sh', ['-c', 'sleep 0.5 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }))
    const started = Date.now()
    runScript(pid)
    expect(Date.now() - started).toBeGreaterThan(300)
    expect(readFileSync(join(app, 'version'), 'utf8')).toBe('new')
    expect(existsSync(`${app}.previous`)).toBe(false)
    expect(readFileSync(join(dir, 'opened'), 'utf8').trim()).toBe(app)
  })

  it('keeps the old app when the new one is missing', () => {
    rmSync(next, { recursive: true })
    runScript(999999)
    expect(readFileSync(join(app, 'version'), 'utf8')).toBe('old')
    expect(readFileSync(join(dir, 'opened'), 'utf8').trim()).toBe(app)
  })
})
