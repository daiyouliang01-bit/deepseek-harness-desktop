import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedNavigation } from '../navigation-guard'
import { KeyVault } from '../keys/vault'
import { SessionAdapter } from '../adapter/session-adapter'
import { RpcClient } from '../adapter/rpc-client'
import { StreamBridge } from '../adapter/stream-bridge'
import { SessionStore } from '@dshd/session-store'
import { buildAppMenuTemplate } from '../menu'
import { RuntimeNotifier } from '../notifications'
import { HarnessProcess } from '../runtime/harness-process'
import { findDsh } from '../runtime/dsh-bin'
import type { RuntimeStatus } from '../runtime/runtime-types'
import { GlobalShortcutManager } from '../shortcuts'
import { buildTrayMenuTemplate } from '../tray'
import { TRAY_ICON_DATA_URL } from '../tray-icon'
import { createElectronUpdaterProvider, UpdateManager } from '../updater/update-manager'

// --- app-level key vault (Task 3.5) ---
// Plain-file store under userData/config; values are safeStorage-encrypted.
function createVaultStore(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  const file = join(app.getPath('userData'), 'config', 'secrets.json')
  let cache: Record<string, string> | null = null
  const { readFileSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
  function load(): Record<string, string> {
    if (cache) return cache
    try {
      cache = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    } catch {
      cache = {}
    }
    return cache
  }
  function persist(): void {
    mkdirSync(join(app.getPath('userData'), 'config'), { recursive: true })
    writeFileSync(file, JSON.stringify(load(), null, 2), 'utf8')
  }
  return {
    getItem: (k) => load()[k] ?? null,
    setItem: (k, v) => {
      load()[k] = v
      persist()
    },
    removeItem: (k) => {
      delete load()[k]
      persist()
    }
  }
}

const keyVault = new KeyVault(createVaultStore())

// --- auto-update (Task 5.3) ---
const updater = new UpdateManager(createElectronUpdaterProvider())

// --- desktop presence (Task 1.5): tray / shortcut / notifications ---
let tray: Tray | null = null
let isQuitting = false

const notifier = new RuntimeNotifier({
  isSupported: () => Notification.isSupported(),
  show: (title, body) => {
    if (!Notification.isSupported()) return
    new Notification({ title, body }).show()
  }
})

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

const shortcutManager = new GlobalShortcutManager(
  {
    register: (accelerator, cb) => {
      try {
        return globalShortcut.register(accelerator, cb)
      } catch {
        return false
      }
    },
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    unregisterAll: () => globalShortcut.unregisterAll()
  },
  () => toggleWindow()
)

const trayActions = {
  toggleWindow,
  startRuntime: () => void startRuntime(),
  stopRuntime: () => void runtime.stop(),
  openLogs: async () => {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    await shell.openPath(LOG_DIR)
  },
  quit: () => app.quit()
}

function updateTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(runtime.getStatus().state, trayActions)))
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL))
  tray.setToolTip('DeepSeek Harness Desktop')
  tray.on('click', () => toggleWindow())
  updateTrayMenu()
}

function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildAppMenuTemplate({
        openCustomShell: () => openCustomShell(),
        openOfficialUI: () => void openOfficialUI(),
        reload: () => mainWindow?.webContents.reload(),
        quit: () => app.quit()
      }) as Electron.MenuItemConstructorOptions[]
    )
  )
}

// --- single instance lock (Task 1.1) ---
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
// Directory that holds the bundled renderer (index.html + assets)
const RENDERER_DIR_URL = pathToFileURL(join(__dirname, '../renderer') + '/').href
const LOG_DIR = join(app.getPath('userData'), 'logs')
const RUNTIME_LOG = join(LOG_DIR, 'dsh-runtime.log')
const MAX_LOG_BYTES = 5 * 1024 * 1024

function logLine(stream: 'stdout' | 'stderr', line: string): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    if (existsSync(RUNTIME_LOG) && statSync(RUNTIME_LOG).size > MAX_LOG_BYTES) {
      renameSync(RUNTIME_LOG, `${RUNTIME_LOG}.1`)
    }
    appendFileSync(RUNTIME_LOG, `[${stream}] ${line}\n`)
  } catch {
    /* logging must never crash the app */
  }
}

/**
 * Navigation guard: only the validated loopback origin, the dev server, or
 * bundled files may ever be loaded. Everything else is blocked (see
 * navigation-guard.ts).
 */
function loadRendererScreen(): void {
  if (!mainWindow) return
  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- Harness runtime (Task 1.2/1.3) ---
// Resolve `dsh` from PATH or the global npm bin dir (some shells lack it).
const runtime = new HarnessProcess({
  dshBin: findDsh() ?? 'dsh',
  onOutput: logLine
})

// --- session adapter + stream bridge (M2/M3): wire client + live events ---
let sessionAdapter: SessionAdapter | null = null
let streamBridge: StreamBridge | null = null

function ensureSessionAdapter(): SessionAdapter | null {
  const status = runtime.getStatus()
  if (status.state !== 'ready' || !status.ready) return null
  if (sessionAdapter) return sessionAdapter
  const client = new RpcClient({ baseUrl: status.ready.url })
  const store = new SessionStore({
    path: join(app.getPath('userData'), 'db', 'sessions.db'),
    runtimeVersion: process.env.npm_package_version
  })
  sessionAdapter = new SessionAdapter({ client, store })

  // Start the live mux stream → push mapped protocol events to the renderer.
  streamBridge = new StreamBridge({
    client,
    onEvents: (events) => mainWindow?.webContents.send('agent:event', events),
    onClose: (err) => mainWindow?.webContents.send('agent:stream-state', { running: false, error: err?.message })
  })
  void streamBridge.start()
  mainWindow?.webContents.send('agent:stream-state', { running: true })
  return sessionAdapter
}

function stopStreamBridge(): void {
  streamBridge?.stop()
  streamBridge = null
}

let uiLoaded = false // whether the official Web UI is currently loaded
let shellRequested = false // user asked for the custom shell view

function pushStatus(): void {
  mainWindow?.webContents.send('runtime:status', runtime.getStatus())
}

/** Load the shell renderer and ask it to show the custom shell view. */
function openCustomShell(): void {
  shellRequested = true
  uiLoaded = false
  loadRendererScreen()
  const win = mainWindow
  if (win) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('ui:open-shell')
    })
  }
}

async function openOfficialUI(): Promise<{ ok: boolean; reason?: string }> {
  const status = runtime.getStatus()
  if (status.state !== 'ready' || !status.ready) {
    return { ok: false, reason: `runtime not ready (${status.state})` }
  }
  shellRequested = false
  uiLoaded = true
  await mainWindow?.loadURL(status.ready.url)
  return { ok: true }
}

runtime.on('statusChange', (status: RuntimeStatus) => {
  notifier.handleStatus(status)
  updateTrayMenu()
  if (status.state === 'ready' && status.ready && mainWindow && !uiLoaded && !shellRequested) {
    uiLoaded = true
    // Load ONLY the validated loopback URL.
    void mainWindow.loadURL(status.ready.url)
  } else if (status.state === 'error' || status.state === 'stopped') {
    sessionAdapter = null // runtime gone → adapter must rebuild on next ready
    stopStreamBridge()
    if (uiLoaded) {
      // Runtime died while the Web UI was loaded → go back to the shell
      // renderer (loading/recovery screen).
      uiLoaded = false
      loadRendererScreen()
    }
  }
  pushStatus()
})

async function startRuntime(): Promise<RuntimeStatus> {
  try {
    await runtime.start()
  } catch (err) {
    // status already reflects 'error' via the event; nothing else to do
  }
  return runtime.getStatus()
}

// --- window creation ---
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'DeepSeek Harness Desktop',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Hide to tray on close (Task 1.5); quit only via tray/menu/Cmd+Q.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Navigation guard: block any navigation to unapproved origins.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, DEV_SERVER_URL, RENDERER_DIR_URL)) {
      event.preventDefault()
      console.warn('[guard] blocked navigation to', url)
    }
  })

  // Open external https links in the system browser; deny in-app windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRendererScreen()
}

// --- IPC: narrow desktop contract (see docs/ipc-contract.md) ---

ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('app:get-platform', () => process.platform)
ipcMain.handle('app:quit', () => {
  app.quit()
})

ipcMain.handle('runtime:get-status', () => runtime.getStatus())
ipcMain.handle('runtime:start', () => startRuntime())
ipcMain.handle('runtime:stop', async () => {
  await runtime.stop()
  return runtime.getStatus()
})
ipcMain.handle('runtime:restart', async () => {
  await runtime.restart()
  return runtime.getStatus()
})
ipcMain.handle('runtime:open-logs', async () => {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
  await shell.openPath(LOG_DIR)
  return true
})

ipcMain.handle('ui:open-official', () => openOfficialUI())

// --- key vault IPC (Task 3.5): secrets never cross to the renderer ---

const PROVIDERS = ['deepseek']

ipcMain.handle('keys:list', () => keyVault.listKeys(PROVIDERS))
ipcMain.handle('keys:set', async (_event, provider: string, key: string) => {
  if (typeof provider !== 'string' || typeof key !== 'string' || !key.trim()) {
    return { ok: false, error: 'invalid arguments' }
  }
  const validation = await keyVault.validateKey(provider, key.trim())
  if (!validation.ok) return validation
  keyVault.setKey(provider, key.trim())
  return { ok: true }
})
ipcMain.handle('keys:remove', (_event, provider: string) => {
  keyVault.removeKey(provider)
  return { ok: true }
})
ipcMain.handle('keys:availability', () => keyVault.isEncryptionAvailable())

// --- session domain IPC (M2) ---

function withAdapter<T>(fn: (adapter: SessionAdapter) => Promise<T>): Promise<{ ok: boolean; error?: string; value?: T }> {
  const adapter = ensureSessionAdapter()
  if (!adapter) return Promise.resolve({ ok: false, error: 'runtime not ready' })
  return fn(adapter).then(
    (value) => ({ ok: true, value }),
    (err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
  )
}

ipcMain.handle('sessions:list', () => withAdapter((a) => a.list()))
ipcMain.handle('sessions:create', (_e, cwd?: string) => withAdapter((a) => a.create(cwd)))
ipcMain.handle('sessions:history', (_e, sessionId: string, beforeSeq?: number) =>
  withAdapter((a) => a.history(sessionId, beforeSeq))
)
ipcMain.handle('sessions:rename', (_e, sessionId: string, title: string) => withAdapter((a) => a.rename(sessionId, title)))
ipcMain.handle('sessions:search', (_e, query: string) => withAdapter((a) => a.search(query)))
ipcMain.handle('sessions:archive', (_e, sessionId: string) => {
  const adapter = ensureSessionAdapter()
  if (!adapter) return { ok: false, error: 'runtime not ready' }
  adapter.archive(sessionId)
  return { ok: true }
})

// --- agent IPC (M3): prompt/cancel + active session for the live stream ---

ipcMain.handle('agent:send', (_e, sessionId: string, text: string) =>
  withAdapter((a) => a.prompt(sessionId, text).then(() => ({ accepted: true as const })))
)
ipcMain.handle('agent:cancel', (_e, sessionId: string) =>
  withAdapter((a) => a.cancel(sessionId).then(() => ({ accepted: true as const })))
)
ipcMain.handle('agent:set-active-session', (_e, sessionId: string | null) => {
  streamBridge?.setActiveSession(sessionId)
  return { ok: true }
})
ipcMain.handle('agent:stream-state', () => ({ running: streamBridge?.isRunning() ?? false }))

// --- auto-update IPC (Task 5.3) ---

ipcMain.handle('update:get-state', () => updater.getState())
ipcMain.handle('update:check', () => updater.check())
ipcMain.handle('update:download', () => updater.download())
ipcMain.handle('update:install', () => {
  updater.install()
  return { ok: true }
})
updater.subscribe(() => {
  mainWindow?.webContents.send('update:state', updater.getState())
})

app.whenReady().then(() => {
  createWindow()
  createTray()
  installAppMenu()
  if (!shortcutManager.register()) {
    console.warn('[shortcut] summon accelerator is taken by another app')
  }
  // Boot the runtime immediately (Task 1.3: auto-start on launch).
  void startRuntime()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Tray keeps the app alive; quitting happens via tray/menu/Cmd+Q.
app.on('window-all-closed', () => {
  /* no-op: tray resident */
})

// Clean shutdown: kill the child process tree on quit.
app.on('before-quit', () => {
  isQuitting = true
  shortcutManager.dispose()
  void runtime.stop()
})
