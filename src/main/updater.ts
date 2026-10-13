import { app, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { UpdateState } from '@shared/types'

/** Releases of this GitHub repository are the update channel. */
const REPO = 'kthilagarajan/mrterminal'
/** Tests point this at a local file server instead of GitHub. */
const FEED = process.env.MRTERMINAL_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

interface Asset {
  name: string
  browser_download_url: string
  size?: number
  /** `sha256:<hex>`, published by GitHub for release assets. */
  digest?: string | null
}

interface Release {
  tag_name: string
  html_url?: string
  assets?: Asset[]
}

/** Compare dotted versions numerically: 0.10.0 is newer than 0.9.1. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/**
 * Shell script that swaps the running app bundle for the new one once the app
 * has exited, then reopens it. If the swap fails the old app is put back.
 */
export function swapScript(pid: number, current: string, next: string): string {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  return `#!/bin/sh
APP=${q(current)}
NEW=${q(next)}
OLD="$APP.previous"
# Wait (up to 30s) for the running app to quit.
i=0
while kill -0 ${pid} 2>/dev/null && [ $i -lt 300 ]; do sleep 0.1; i=$((i + 1)); done
rm -rf "$OLD"
if mv "$APP" "$OLD" && mv "$NEW" "$APP"; then
  rm -rf "$OLD"
else
  [ -e "$APP" ] || mv "$OLD" "$APP"
fi
open "$APP"
`
}

/**
 * Over-the-air updates from GitHub releases.
 *
 * Electron's built-in updater only accepts apps signed with an Apple Developer
 * certificate, which this app does not have, so the update is applied by hand:
 * download the release's .zip, check it against the published SHA-256, unpack
 * it, and swap the app bundle after quitting.
 */
export class Updater {
  private state: UpdateState = { status: 'idle', current: app.getVersion() }
  private asset: Asset | null = null
  private releaseUrl = RELEASES_PAGE
  private timer: NodeJS.Timeout | null = null

  constructor(private onChange: (state: UpdateState) => void) {}

  get(): UpdateState {
    return this.state
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  /** Check now and keep checking; a no-op for unpackaged dev runs. */
  start(): void {
    if (!app.isPackaged && !process.env.MRTERMINAL_UPDATE_FEED) return
    setTimeout(() => void this.check(), 4000)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'downloading' || this.state.status === 'installing') return this.state
    this.set({ status: 'checking', error: undefined })
    try {
      const response = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json' } })
      // A repository with no published release answers 404: simply nothing to offer.
      if (response.status === 404) {
        this.set({ status: 'idle' })
        return this.state
      }
      if (!response.ok) throw new Error(`Update server answered ${response.status}`)
      const release = (await response.json()) as Release
      const version = String(release.tag_name ?? '').replace(/^v/, '')
      if (!version || !isNewer(version, this.state.current)) {
        this.set({ status: 'idle' })
        return this.state
      }
      this.releaseUrl = release.html_url || RELEASES_PAGE
      // macOS builds are published as MrTerminal-<version>-<arch>.zip.
      this.asset =
        process.platform === 'darwin'
          ? ((release.assets ?? []).find((a) => a.name.endsWith(`-${process.arch}.zip`)) ?? null)
          : null
      this.set({ status: 'available', version, canInstall: this.asset !== null })
    } catch (err) {
      this.set({ status: 'error', error: (err as Error).message })
    }
    return this.state
  }

  /** Download and apply the update, or open the download page where that is not possible. */
  async install(): Promise<void> {
    if (this.state.status !== 'available' && this.state.status !== 'error') return
    if (!this.asset) {
      void shell.openExternal(this.releaseUrl)
      return
    }
    try {
      const bundle = this.bundlePath()
      const work = mkdtempSync(join(tmpdir(), 'mrterminal-update-'))
      const zip = join(work, 'update.zip')
      await this.download(this.asset, zip)

      this.set({ status: 'installing' })
      const unpacked = join(work, 'app')
      await run('ditto', ['-x', '-k', zip, unpacked])
      const appName = readdirSync(unpacked).find((name) => name.endsWith('.app'))
      if (!appName) throw new Error('The update did not contain an app')

      const script = join(work, 'swap.sh')
      writeFileSync(script, swapScript(process.pid, bundle, join(unpacked, appName)), { mode: 0o755 })
      spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref()
      app.quit()
    } catch (err) {
      this.set({ status: 'error', error: (err as Error).message })
    }
  }

  /** The .app we are running from, provided it can be replaced in place. */
  private bundlePath(): string {
    // .../MrTerminal.app/Contents/MacOS/MrTerminal
    const bundle = dirname(dirname(dirname(process.execPath)))
    if (!bundle.endsWith('.app')) throw new Error('Not running from an app bundle')
    if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) {
      throw new Error('Move MrTerminal to the Applications folder first, then update')
    }
    try {
      accessSync(dirname(bundle), constants.W_OK)
    } catch {
      throw new Error(`No permission to replace ${bundle}`)
    }
    return bundle
  }

  private async download(asset: Asset, target: string): Promise<void> {
    this.set({ status: 'downloading', progress: 0 })
    const response = await net.fetch(asset.browser_download_url)
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
    const total = Number(response.headers.get('content-length')) || asset.size || 0
    const file = createWriteStream(target)
    const hash = createHash('sha256')
    let received = 0
    let shown = 0
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
        if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', resolve))
        received += chunk.length
        const progress = total ? Math.min(99, Math.floor((received / total) * 100)) : 0
        if (progress !== shown) this.set({ progress: (shown = progress) })
      }
    } finally {
      await new Promise<void>((resolve) => file.end(resolve))
    }
    const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null
    if (expected && hash.digest('hex') !== expected.toLowerCase()) {
      rmSync(target, { force: true })
      throw new Error('The download was corrupted (checksum mismatch)')
    }
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))))
  })
}
