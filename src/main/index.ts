import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Config, MenuAction, PtyCreateOptions } from '@shared/types'
import { keysFor, type ShortcutId } from '@shared/shortcuts'
import { getTheme } from '@shared/themes'
import type { Server } from 'node:net'
import { ConfigStore, socketPath } from './config'
import { createControl, serveControl } from './control'
import { installCli } from './cliInstall'
import { PtyManager } from './pty'
import { detectScripts } from './scripts'
import { Updater } from './updater'

const isMac = process.platform === 'darwin'

let win: BrowserWindow | null = null
const store = new ConfigStore()

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const ptys = new PtyManager(
  {
    data: (id, data) => send('pty:data', { id, data }),
    exit: (e) => send('pty:exit', e),
    status: (s) => send('pty:status', s)
  },
  () => store.get().settings.shell
)

const updater = new Updater((state) => send('update:state', state))

// ── mrt: the command-line tool talks to the app through the renderer ────────

let controlServer: Server | null = null
let nextRequest = 1
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function callRenderer(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!win || win.isDestroyed() || win.webContents.isLoading()) {
    return Promise.reject(new Error('MrTerminal is still starting; try again in a moment.'))
  }
  const id = nextRequest++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error('MrTerminal did not answer in time.'))
    }, 15000)
    pendingRequests.set(id, { resolve, reject, timer })
    send('control:request', { id, method, params })
  })
}

const control = createControl({ renderer: callRenderer, ptys, detectScripts, version: app.getVersion() })

function saveBounds(): void {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
  const maximized = win.isMaximized()
  const bounds = maximized ? (store.get().window ?? win.getBounds()) : win.getBounds()
  store.setWindow({ ...bounds, maximized })
}

function createWindow(): void {
  const saved = store.get().window
  const theme = getTheme(store.get().settings.theme)
  nativeTheme.themeSource = theme.dark ? 'dark' : 'light'
  win = new BrowserWindow({
    width: saved?.width ?? 1320,
    height: saved?.height ?? 840,
    x: saved?.x,
    y: saved?.y,
    minWidth: 720,
    minHeight: 420,
    show: false,
    backgroundColor: theme.ui.bg,
    title: 'MrTerminal',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    // Centred in the 44px bar the sidebar head and the top bar share.
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (saved?.maximized) win.maximize()

  win.once('ready-to-show', () => win?.show())
  win.on('resize', saveBounds)
  win.on('move', saveBounds)
  win.on('close', saveBounds)
  win.on('closed', () => {
    win = null
  })

  // Links printed in a terminal open in the real browser, never in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Quitting kills every terminal and whatever runs in it, and Cmd+Q sits
// next to Cmd+W and Cmd+A. The first press only shows a banner; a second
// one within the window quits.
const QUIT_CONFIRM_MS = 2000
let quitArmedAt = 0

function requestQuit(): void {
  if (!win || win.isDestroyed() || Date.now() - quitArmedAt < QUIT_CONFIRM_MS) return app.quit()
  quitArmedAt = Date.now()
  send('quit:armed', QUIT_CONFIRM_MS)
}

function buildMenu(): void {
  const key = (id: ShortcutId): string => keysFor(id, process.platform)
  const item = (label: string, action: MenuAction & ShortcutId): MenuItemConstructorOptions => ({
    label,
    accelerator: key(action),
    click: () => send('menu', action)
  })

  const quit: MenuItemConstructorOptions = {
    label: isMac ? `Quit ${app.name}` : 'Quit',
    accelerator: key('quit'),
    click: requestQuit
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { label: 'Check for Updates…', click: () => send('menu', 'check-updates') },
              { type: 'separator' },
              item('Settings…', 'settings'),
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              quit
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'Shell',
      submenu: [
        item('New Terminal', 'new-terminal'),
        item('Split Right', 'split-right'),
        item('Split Down', 'split-down'),
        { type: 'separator' },
        item('Restart Terminal', 'restart-terminal'),
        item('Clear', 'clear-terminal'),
        item('Close Terminal', 'close-terminal'),
        item('Reopen Closed Tab or Project', 'reopen-closed'),
        { type: 'separator' },
        item('Add Project…', 'add-project'),
        { label: "Install 'mrt' Command…", click: () => void installCli(win) },
        ...(isMac ? [] : [{ type: 'separator' } as const, item('Settings…', 'settings'), quit])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy', accelerator: key('copy') },
        { role: 'paste', accelerator: key('paste') },
        { role: 'selectAll', accelerator: key('select-all') }
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Toggle Sidebar', 'toggle-sidebar'),
        item('Toggle Compact Sidebar', 'toggle-compact'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle('config:load', () => store.get())
  ipcMain.on('config:save', (_e, config: Config) => store.set(config))
  ipcMain.on('config:save-sync', (event, config: Config) => {
    store.set(config)
    store.flush()
    event.returnValue = true
  })

  ipcMain.handle('dialog:pick-folder', async () => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Add Project',
      buttonLabel: 'Add Project',
      properties: ['openDirectory', 'createDirectory']
    })
    const path = result.filePaths[0]
    return result.canceled || !path ? null : { path, name: basename(path) }
  })
  ipcMain.handle('scripts:detect', (_e, path: string) => detectScripts(path))
  ipcMain.on('chrome:set', (_e, background: string, dark: boolean) => {
    nativeTheme.themeSource = dark ? 'dark' : 'light'
    if (win && !win.isDestroyed() && /^#[0-9a-f]{6}$/i.test(background)) win.setBackgroundColor(background)
  })
  ipcMain.on('shell:reveal', (_e, path: string) => void shell.openPath(path))

  ipcMain.handle('pty:create', (_e, opts: PtyCreateOptions) => ptys.create(opts))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id))

  ipcMain.on('control:response', (_e, id: number, response: { result?: unknown; error?: string }) => {
    const pending = pendingRequests.get(id)
    if (!pending) return
    pendingRequests.delete(id)
    clearTimeout(pending.timer)
    if (response.error !== undefined) pending.reject(new Error(response.error))
    else pending.resolve(response.result)
  })

  ipcMain.handle('update:get', () => updater.get())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.on('update:install', () => void updater.install())

  ipcMain.on('env', (event) => {
    event.returnValue = { platform: process.platform, home: homedir() }
  })
}

if (!app.requestSingleInstanceLock()) {
  // Two instances would fight over the config file and re-run every command.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    registerIpc()
    buildMenu()
    createWindow()
    updater.start()
    controlServer = serveControl(socketPath, control)
  })

  // One window, and its terminals are the whole point: closing it quits.
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    updater.stop()
    controlServer?.close()
    ptys.killAll()
    store.flush()
  })
}
