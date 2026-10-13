import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Config, MenuAction, PtyCreateOptions } from '@shared/types'
import { getTheme } from '@shared/themes'
import { ConfigStore } from './config'
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
    trafficLightPosition: { x: 16, y: 16 },
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

function buildMenu(): void {
  // Ctrl+W / Ctrl+D / Ctrl+K mean something to the shell, so outside macOS
  // the terminal shortcuts take Shift as well.
  const key = (mac: string, other: string): string => (isMac ? mac : other)
  const item = (label: string, accelerator: string, action: MenuAction): MenuItemConstructorOptions => ({
    label,
    accelerator: accelerator || undefined,
    click: () => send('menu', action)
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              item('Check for Updates…', '', 'check-updates'),
              { type: 'separator' },
              item('Settings…', 'Cmd+,', 'settings'),
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'Shell',
      submenu: [
        item('New Terminal', key('Cmd+T', 'Ctrl+Shift+T'), 'new-terminal'),
        item('Split Right', key('Cmd+D', 'Ctrl+Shift+D'), 'split-right'),
        item('Split Down', key('Cmd+Shift+D', 'Ctrl+Shift+E'), 'split-down'),
        { type: 'separator' },
        item('Restart Terminal', key('Cmd+Shift+R', 'Ctrl+Shift+R'), 'restart-terminal'),
        item('Clear', key('Cmd+K', 'Ctrl+Shift+K'), 'clear-terminal'),
        item('Close Terminal', key('Cmd+W', 'Ctrl+Shift+W'), 'close-terminal'),
        item('Reopen Closed Tab or Project', key('Cmd+Shift+T', 'Ctrl+Shift+Z'), 'reopen-closed'),
        { type: 'separator' },
        item('Add Project…', 'CmdOrCtrl+O', 'add-project'),
        ...(isMac ? [] : [{ type: 'separator' } as const, item('Settings…', 'Ctrl+,', 'settings'), { role: 'quit' } as const])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy', accelerator: key('Cmd+C', 'Ctrl+Shift+C') },
        { role: 'paste', accelerator: key('Cmd+V', 'Ctrl+Shift+V') },
        { role: 'selectAll', accelerator: key('Cmd+A', 'Ctrl+Shift+A') }
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Toggle Sidebar', 'CmdOrCtrl+B', 'toggle-sidebar'),
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
  })

  // One window, and its terminals are the whole point: closing it quits.
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    updater.stop()
    ptys.killAll()
    store.flush()
  })
}
