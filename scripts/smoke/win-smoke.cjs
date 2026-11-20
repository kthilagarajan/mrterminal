// Windows smoke test for an installed MrTerminal release. Each step records
// pass/fail in out/results.json and takes screenshots; a failing step does
// not stop the rest.
const { _electron } = require('playwright')
const { execFileSync, execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const OUT = path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })
const EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'MrTerminal', 'MrTerminal.exe')
const CLI = path.join(path.dirname(EXE), 'resources', 'app.asar', 'out', 'main', 'cli.js')
const DEMO = 'C:\\demo'
const FAKEBIN = 'C:\\fakebin'
const LOG = path.join(OUT, 'code-calls.log')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const record = (step, ok, detail) => { results.push({ step, ok, detail: String(detail ?? '').slice(0, 3000) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}\n${detail ?? ''}\n`) }

// Fixtures: a project with npm scripts, a fake `claude` agent and a fake `code` editor.
fs.mkdirSync(DEMO, { recursive: true })
fs.writeFileSync(path.join(DEMO, 'package.json'), JSON.stringify({ name: 'demo', scripts: { hello: 'echo hello-from-script', serve: 'node server.js' } }))
fs.writeFileSync(path.join(DEMO, 'server.js'), "require('http').createServer((q, s) => s.end('ok')).listen(8765, () => console.log('Serving HTTP on 8765'))\n")
fs.mkdirSync(FAKEBIN, { recursive: true })
fs.writeFileSync(path.join(FAKEBIN, 'claude.cmd'), '@echo off\r\necho fake claude agent running in %CD%\r\nping -n 600 127.0.0.1 >nul\r\n')
fs.writeFileSync(path.join(FAKEBIN, 'code.cmd'), `@echo off\r\necho %* >> "${LOG}"\r\n`)

const env = { ...process.env, PATH: FAKEBIN + ';' + process.env.PATH }
delete env.ELECTRON_RUN_AS_NODE

function mrt(...args) {
  try {
    return execFileSync(EXE, [CLI, '--no-launch', ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000 }).trim()
  } catch (e) {
    return `ERR(${e.status}) ${e.stdout || ''}${e.stderr || ''}`.trim()
  }
}

// Real key presses (menu accelerators ignore synthetic page events).
function realKeys(keys) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$p = Get-Process MrTerminal | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
if ($p) { [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('${keys}')`
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
}

async function launch(tag) {
  const app = await _electron.launch({ executablePath: EXE, env, timeout: 90000 })
  app.process().stderr?.on('data', (x) => fs.appendFileSync(path.join(OUT, `app-${tag}.log`), x))
  app.process().stdout?.on('data', (x) => fs.appendFileSync(path.join(OUT, `app-${tag}.log`), x))
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(1440, 900); b.center(); b.focus() })
  for (let i = 0; i < 60 && mrt('status').startsWith('ERR'); i++) await sleep(500)
  return { app, win }
}

async function step(name, fn) {
  try { const d = await fn(); record(name, d?.ok ?? true, d?.detail ?? d) } catch (e) { record(name, false, e.stack || e) }
}

;(async () => {
  record('installed exe exists', fs.existsSync(EXE), EXE)
  let { app, win } = await launch('1')
  const shot = (n) => win.screenshot({ path: path.join(OUT, n + '.png') }).catch((e) => console.log('screenshot failed', e.message))
  await sleep(4000)
  await shot('01-first-launch')
  await step('first launch shows UI', async () => {
    const text = await win.evaluate(() => document.body.innerText)
    return { ok: text.includes('MrTerminal'), detail: text.slice(0, 600) }
  })
  await step('mrt status', () => { const s = mrt('status'); return { ok: !s.startsWith('ERR'), detail: s } })
  await step('default shell is PowerShell with prompt', async () => {
    const r = mrt('read', 'self') ; const ls = mrt('ls')
    return { ok: !ls.startsWith('ERR'), detail: ls + '\n' + r }
  })
  await step('add project', () => { const s = mrt('project', 'add', DEMO); return { ok: /Added/.test(s), detail: s } })
  await sleep(1500)
  await step('detect npm scripts', () => { const s = mrt('-p', 'demo', 'scripts'); return { ok: /hello/.test(s) && /serve/.test(s), detail: s } })
  await step('run script and wait for exit code', () => { const s = mrt('-p', 'demo', 'run', 'hello', '--wait'); return { ok: /hello-from-script/.test(s), detail: s } })
  await step('open a shell split and type a command', async () => {
    const o = mrt('-p', 'demo', 'open', '--split', 'right', '--title', 'shell'); await sleep(3000)
    mrt('-p', 'demo', 'send', 'shell', 'cd $env:TEMP; echo "cmd-ok $(6*7)"; (Get-Location).Path'); await sleep(3000)
    const r = mrt('-p', 'demo', 'read', 'shell')
    return { ok: /cmd-ok 42/.test(r), detail: o + '\n' + r }
  })
  await step('long-running script (server)', () => {
    const a = mrt('-p', 'demo', 'run', 'serve'); const w = mrt('-p', 'demo', 'wait', 'serve', '--match', 'Serving HTTP', '--timeout', '30')
    return { ok: /Serving HTTP/.test(w), detail: a + '\n' + w }
  })
  await step('busy/idle and exit status (shell integration)', () => { const s = mrt('-p', 'demo', 'ls'); return { ok: /running\s+serve/.test(s) && /idle \(last: ok\)\s+hello/.test(s), detail: s } })
  await sleep(1000); await shot('02-scripts-and-commands')

  await step('agent menu lists Claude Code and starts it', async () => {
    await win.click('[aria-label="Start an agent or another global command"]'); await sleep(1000); await shot('03-agent-menu')
    const item = win.getByText('Claude Code', { exact: false }).first()
    if (!(await item.count())) { await win.keyboard.press('Escape'); return { ok: false, detail: 'Claude Code not in menu' } }
    await item.click(); await sleep(5000); await shot('04-agent-started')
    const s = mrt('-p', 'demo', 'ls'); const r = mrt('-p', 'demo', 'read', 'Claude Code')
    return { ok: /fake claude agent/.test(r), detail: s + '\n' + r }
  })
  await step('open in editor (VS Code)', async () => {
    await win.click('[aria-label="Choose an editor"]'); await sleep(1000); await shot('05-editor-menu')
    const menu = await win.evaluate(() => document.body.innerText.match(/VS Code[\s\S]{0,120}/)?.[0] || '')
    const vs = win.getByText('VS Code', { exact: false }).last()
    if (await vs.count()) await vs.click(); else await win.keyboard.press('Escape')
    await sleep(3000)
    const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : ''
    return { ok: /demo/i.test(log), detail: 'menu: ' + menu + '\ncode.cmd got: ' + log }
  })

  // Shortcuts with real key presses. ^ = Ctrl, + = Shift in SendKeys.
  const count = () => mrt('-p', 'demo', 'ls').split('\n').length - 1
  const keyStep = (label, keys, check) => step(`shortcut ${label}`, async () => {
    await win.locator('.xterm:visible').first().click(); await sleep(400)
    const before = count(); realKeys(keys); await sleep(2000); const after = count()
    return { ok: check(before, after), detail: `terminals ${before} -> ${after}` }
  })
  await keyStep('Ctrl+Shift+T new terminal', '^+t', (a, b) => b === a + 1)
  await keyStep('Ctrl+Shift+D split right', '^+d', (a, b) => b === a + 1)
  await keyStep('Ctrl+Shift+E split down', '^+e', (a, b) => b === a + 1)
  await shot('06-after-shortcuts')
  await keyStep('Ctrl+Shift+W close', '^+w', (a, b) => b === a - 1)
  await keyStep('Ctrl+Shift+Z reopen', '^+z', (a, b) => b === a + 1)
  await step('shortcut Ctrl+B toggle sidebar (terminal focused)', async () => {
    const w = () => win.evaluate(() => document.querySelector('[aria-label="Toggle sidebar"]')?.getBoundingClientRect().left)
    await win.locator('.xterm:visible').first().click(); const a = await w(); realKeys('^b'); await sleep(1000); const b = await w()
    await shot('07-ctrl-b'); if (a !== b) realKeys('^b')
    return { ok: a !== b, detail: `toggle button x ${a} -> ${b}` }
  })
  await step('shortcut Ctrl+, settings', async () => {
    await win.locator('.xterm:visible').first().click(); await sleep(300)
    realKeys('^,'); await sleep(1500)
    const first = await win.locator('.dialog-settings').count()
    realKeys('{ESC}'); await sleep(1000)
    const afterEscape = await win.locator('.dialog-settings').count()
    record('Escape closes Settings opened with Ctrl+,', first > 0 && afterEscape === 0, `open ${first}, after Escape ${afterEscape}`)
    if (!afterEscape) { realKeys('^,'); await sleep(1500) }
    await shot('08-settings')
    const open = await win.locator('.dialog-settings').count()
    for (const tab of ['Global commands', 'Shortcuts']) { const t = win.getByText(tab, { exact: true }).first(); if (await t.count()) { await t.click(); await sleep(700); await shot('09-settings-' + tab.toLowerCase().replace(' ', '-')) } }
    if (open) await win.locator('.backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {})
    return { ok: open > 0, detail: `settings dialogs: ${open}` }
  })

  // Install 'mrt' Command writes %USERPROFILE%\.mrterminal\bin\mrt.cmd.
  await step("Install 'mrt' Command", async () => {
    app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'Shell').submenu.items.find((i) => i.label.startsWith('Install')).click()).catch(() => {})
    await sleep(3000)
    const cmd = path.join(os.homedir(), '.mrterminal', 'bin', 'mrt.cmd')
    let out = ''
    try { out = execFileSync('cmd.exe', ['/c', cmd, '--no-launch', 'ls'], { encoding: 'utf8', timeout: 60000 }) } catch (e) { out = 'ERR ' + e.stdout + e.stderr }
    try { realKeys('{ENTER}') } catch {}
    await sleep(1000)
    return { ok: /demo/.test(out), detail: cmd + '\n' + out }
  })

  const before = mrt('ls')
  await shot('10-before-quit')
  await app.close()
  await sleep(3000)

  // Relaunch: the restore prompt, then everything comes back.
  ;({ app, win } = await launch('2'))
  const shot2 = (n) => win.screenshot({ path: path.join(OUT, n + '.png') }).catch(() => {})
  await sleep(4000)
  await shot2('11-restore-prompt')
  await step('restore prompt after relaunch', async () => {
    const n = await win.locator('.restore-list').count()
    if (n) { await win.locator('.btn-primary').first().click(); await sleep(8000) }
    return { ok: n > 0, detail: `prompt shown: ${n > 0}` }
  })
  await step('terminals restored after relaunch', async () => {
    const after = mrt('ls'); await shot2('12-restored')
    const r = mrt('-p', 'demo', 'read', 'serve')
    return { ok: /serve/.test(after) && /Claude Code/.test(after), detail: 'BEFORE\n' + before + '\nAFTER\n' + after + '\nserve output:\n' + r }
  })
  await step('shell restored in the folder it was in', () => {
    // The shell that ran `cd $env:TEMP` is titled after its folder once restored.
    const line = mrt('ls').split('\n').find((l) => /\sTemp\s+\(shell\)/.test(l))
    const id = line?.split(/\s+/)[0]
    const r = id ? mrt('read', id) : ''
    return { ok: /Local\\Temp>/i.test(r), detail: (line || 'no shell titled Temp') + '\n' + r }
  })
  await app.close()
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  for (const f of failed) console.log('FAILED: ' + f.step)
})().catch((e) => {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  console.error('CRASH', e)
  process.exit(1)
})
