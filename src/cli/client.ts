import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import type { ControlResponse } from '@shared/control'
import { socketPath } from '../main/config'

/** The app is not running (and was not, or could not be, started). */
export class NotRunning extends Error {}

/** Send one request to the running app and wait for its answer. */
export function call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method, params })}\n`))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      socket.end()
      const response = JSON.parse(buffer.slice(0, nl)) as ControlResponse
      if ('error' in response) reject(new Error(response.error.message))
      else resolve(response.result as T)
    })
    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') reject(new NotRunning('MrTerminal is not running.'))
      else reject(err)
    })
  })
}

async function running(): Promise<boolean> {
  try {
    await call('status')
    return true
  } catch {
    return false
  }
}

/** Start the desktop app the way the user would. */
function launch(): boolean {
  const app = process.env.MRT_APP
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  if (process.platform === 'darwin') {
    const bundle = app?.match(/^(.*?\.app)\//)?.[1]
    const args = bundle ? [bundle] : ['-b', 'com.webtkdev.mrterminal']
    spawn('open', args, { detached: true, stdio: 'ignore', env }).unref()
    return true
  }
  if (!app) return false
  const args = process.env.MRT_APP_ARG ? [process.env.MRT_APP_ARG] : []
  spawn(app, args, { detached: true, stdio: 'ignore', env }).unref()
  return true
}

/** Make sure the app is up, starting it if allowed. */
export async function ensureApp(allowLaunch: boolean): Promise<void> {
  if (await running()) return
  if (!allowLaunch || !launch()) throw new NotRunning('MrTerminal is not running. Open the app and try again.')
  for (let waited = 0; waited < 30_000; waited += 250) {
    await new Promise((r) => setTimeout(r, 250))
    if (await running()) return
  }
  throw new NotRunning('Started MrTerminal, but it did not answer within 30 seconds.')
}
