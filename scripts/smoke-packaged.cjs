// Exercise the packaged Electron app, renderer, IPC and native pty together.
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { connect } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const home = mkdtempSync(join(tmpdir(), 'mrt-smoke-'))
const windows = process.platform === 'win32'
const socketPath = windows
  ? `\\\\.\\pipe\\mrterminal-${home.replace(/[^A-Za-z0-9]/g, '-')}`
  : join(home, 'mrt.sock')
const env = { ...process.env, MRTERMINAL_HOME: home }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(resolve(process.argv[2]), windows ? [] : ['--no-sandbox', '--ozone-platform=x11'], { env, stdio: 'inherit' })
let exited = false
child.on('exit', () => { exited = true })
child.on('error', (err) => { console.error(err); exited = true })

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    let data = ''
    socket.setEncoding('utf8')
    socket.setTimeout(35_000, () => socket.destroy(new Error(`Timed out: ${method}`)))
    socket.on('error', reject)
    socket.on('connect', () => socket.write(JSON.stringify({ id: 1, method, params }) + '\n'))
    socket.on('data', (chunk) => {
      data += chunk
      if (!data.includes('\n')) return
      socket.end()
      const response = JSON.parse(data.split('\n')[0])
      if (response.error) reject(new Error(response.error.message))
      else resolve(response.result)
    })
  })
}

async function smoke() {
  let ready = false
  for (let i = 0; i < 120; i++) {
    assert(!exited, 'Packaged app exited before becoming ready')
    try {
      if ((await call('status')).ready) { ready = true; break }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert(ready, 'App did not become ready')
  const project = await call('project.add', { path: home, name: 'Smoke' })
  const run = await call('run', {
    project: project.id,
    target: windows ? "Write-Output 'mrt-packaged-ok'" : "printf 'mrt-packaged-ok\\n'",
    wait: true,
    timeout: 20
  })
  assert.equal(run.result.exitCode, 0)
  assert.equal(run.result.running, false)
  assert.equal(run.result.timedOut, false)
  assert.match(run.result.output, /mrt-packaged-ok/)
  console.log('Packaged app smoke test passed (renderer, IPC, pty, shell marks and command output).')
}

smoke().catch((err) => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (windows) {
    await new Promise((resolve) => {
      const kill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      kill.on('exit', resolve)
      kill.on('error', resolve)
    })
  } else child.kill('SIGTERM')
  for (let i = 0; i < 50 && !exited; i++) await new Promise((resolve) => setTimeout(resolve, 100))
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
