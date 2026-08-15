import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedNavigation } from '../navigation-guard'
import { KeyVault } from '../keys/vault'
import { HarnessProcess } from '../runtime/harness-process'
import { findDsh } from '../runtime/dsh-bin'
import type { RuntimeStatus } from '../runtime/runtime-types'
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

let uiLoaded = false // whether the official Web UI is currently loaded

function pushStatus(): void {
  mainWindow?.webContents.send('runtime:status', runtime.getStatus())
}

runtime.on('statusChange', (status: RuntimeStatus) => {
  if (status.state === 'ready' && status.ready && mainWindow && !uiLoaded) {
    uiLoaded = true
    // Load ONLY the validated loopback URL.
    void mainWindow.loadURL(status.ready.url)
  } else if (status.state === 'error' || status.state === 'stopped') {
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

ipcMain.handle('ui:open-official', async (): Promise<{ ok: boolean; reason?: string }> => {
  const status = runtime.getStatus()
  if (status.state !== 'ready' || !status.ready) {
    return { ok: false, reason: `runtime not ready (${status.state})` }
  }
  uiLoaded = true
  await mainWindow?.loadURL(status.ready.url)
  return { ok: true }
})

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
  // Boot the runtime immediately (Task 1.3: auto-start on launch).
  void startRuntime()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Task 1.5 will keep the app alive in the tray; until then quit on non-macOS.
  if (process.platform !== 'darwin') app.quit()
})

// Clean shutdown: kill the child process tree on quit.
app.on('before-quit', () => {
  void runtime.stop()
})
