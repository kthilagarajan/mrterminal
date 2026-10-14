import { contextBridge, ipcRenderer } from 'electron'
import type {
  Config,
  MenuAction,
  PtyCreateOptions,
  PtyExit,
  PtyStatus,
  ScriptGroup,
  UpdateState
} from '@shared/types'

function on<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const env = ipcRenderer.sendSync('env') as { platform: string; home: string }

const api = {
  platform: env.platform,
  home: env.home,
  config: {
    load: (): Promise<Config> => ipcRenderer.invoke('config:load'),
    save: (config: Config): void => ipcRenderer.send('config:save', config),
    saveSync: (config: Config): void => void ipcRenderer.sendSync('config:save-sync', config)
  },
  pickFolder: (): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('dialog:pick-folder'),
  detectScripts: (path: string): Promise<ScriptGroup[]> => ipcRenderer.invoke('scripts:detect', path),
  /** Match the native window (background, title bar buttons) to the theme. */
  setChrome: (background: string, dark: boolean): void => ipcRenderer.send('chrome:set', background, dark),
  reveal: (path: string): void => ipcRenderer.send('shell:reveal', path),
  pty: {
    create: (opts: PtyCreateOptions): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('pty:create', opts),
    write: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string): void => ipcRenderer.send('pty:kill', id),
    onData: (cb: (e: { id: string; data: string }) => void) => on('pty:data', cb),
    onExit: (cb: (e: PtyExit) => void) => on('pty:exit', cb),
    onStatus: (cb: (e: PtyStatus) => void) => on('pty:status', cb)
  },
  update: {
    get: (): Promise<UpdateState> => ipcRenderer.invoke('update:get'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    install: (): void => ipcRenderer.send('update:install'),
    onState: (cb: (state: UpdateState) => void) => on('update:state', cb)
  },
  control: {
    onRequest: (cb: (request: { id: number; method: string; params: Record<string, unknown> }) => void) =>
      on('control:request', cb),
    respond: (id: number, response: { result?: unknown; error?: string }): void =>
      ipcRenderer.send('control:response', id, response)
  },
  onMenu: (cb: (action: MenuAction) => void) => on('menu', cb),
  /** The first Cmd+Q: a second one within `ms` quits. */
  onQuitArmed: (cb: (ms: number) => void) => on('quit:armed', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
