import { execFile } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { configDir } from './config'

/**
 * The script that starts `mrt`. A packaged Mac app carries one that finds the
 * app relative to itself, so it keeps working after the app is moved or
 * updated. Elsewhere (development, Linux) one is written with absolute paths.
 */
function launcher(): string {
  const bundled = join(process.resourcesPath, 'bin', 'mrt')
  if (app.isPackaged && process.platform === 'darwin' && existsSync(bundled)) return bundled
  const script = join(configDir, 'bin', 'mrt')
  const cli = join(app.getAppPath(), 'out', 'main', 'cli.js')
  const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  mkdirSync(dirname(script), { recursive: true })
  // An unpackaged app is Electron plus the project folder.
  const appArg = app.isPackaged ? '' : ` MRT_APP_ARG=${quote(app.getAppPath())}`
  writeFileSync(
    script,
    `#!/bin/sh\n# mrt: MrTerminal's command-line tool.\n` +
      `MRT_APP=${quote(process.execPath)}${appArg} ELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(cli)} "$@"\n`
  )
  chmodSync(script, 0o755)
  return script
}

function link(target: string, path: string): void {
  try {
    if (lstatSync(path)) rmSync(path)
  } catch {
    /* nothing there yet */
  }
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path)
}

/** macOS asks for an administrator password to write to /usr/local/bin. */
function linkAsAdmin(target: string, path: string): Promise<void> {
  const sh = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  const command = `mkdir -p /usr/local/bin && ln -sf ${sh(target)} ${sh(path)}`
  const script = `do shell script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`
  return new Promise((resolve, reject) => execFile('osascript', ['-e', script], (err) => (err ? reject(err) : resolve())))
}

/** Put `mrt` on the PATH: /usr/local/bin where possible, else ~/.local/bin. */
export async function installCli(win: BrowserWindow | null): Promise<void> {
  if (process.platform === 'win32') {
    const script = join(configDir, 'bin', 'mrt.cmd')
    const cli = join(app.getAppPath(), 'out', 'main', 'cli.js')
    // Batch expands percent signs even inside quotes. Delayed expansion must
    // be off so installation paths containing exclamation marks also work.
    const batch = (s: string): string => s.replace(/%/g, '%%')
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      'set "ELECTRON_RUN_AS_NODE=1"',
      `set "MRT_APP=${batch(process.execPath)}"`,
      `set "MRT_APP_ARG=${app.isPackaged ? '' : batch(app.getAppPath())}"`,
      `"${batch(process.execPath)}" "${batch(cli)}" %*`,
      'exit /b %errorlevel%',
      ''
    ].join('\r\n'))
    const options = {
      type: 'info' as const,
      message: "Installed the 'mrt' command",
      detail: `${script}\n\nAdd ${dirname(script)} to your user Path in Windows Environment Variables, then open a new terminal.\n\nTry: mrt status\nTeach your coding agent: mrt skill install`
    }
    if (win) await dialog.showMessageBox(win, options)
    else await dialog.showMessageBox(options)
    return
  }
  const target = launcher()
  const system = '/usr/local/bin/mrt'
  let installed: string | null = null
  try {
    link(target, system)
    installed = system
  } catch {
    if (process.platform === 'darwin') {
      try {
        await linkAsAdmin(target, system)
        installed = system
      } catch {
        /* cancelled; fall back to the user's own bin folder */
      }
    }
  }
  if (!installed) {
    installed = join(homedir(), '.local', 'bin', 'mrt')
    link(target, installed)
  }
  const onPath = (process.env.PATH ?? '').split(delimiter).includes(dirname(installed))
  const options = {
    type: 'info' as const,
    message: "Installed the 'mrt' command",
    detail:
      `${installed} → ${target}\n\n` +
      (onPath ? '' : `Add ${dirname(installed)} to your PATH to use it.\n\n`) +
      'Try: mrt status\nTeach your coding agent: mrt skill install'
  }
  if (win) await dialog.showMessageBox(win, options)
  else await dialog.showMessageBox(options)
}
