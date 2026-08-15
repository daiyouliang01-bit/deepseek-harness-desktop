import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'

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

/**
 * Navigation guard (Task 1.3): only the validated loopback origin, the dev
 * server, or bundled files may ever be loaded. Everything else is blocked.
 */
function isAllowedNavigation(url: string): boolean {
  if (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)) return true
  if (url.startsWith('file://')) return true
  // Official Harness Web UI is served on 127.0.0.1:<port> (see docs/upstream-contract.md)
  return /^http:\/\/127\.0\.0\.1(:\d+)?\//.test(url) || /^http:\/\/localhost(:\d+)?\//.test(url)
}

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
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
      console.warn('[guard] blocked navigation to', url)
    }
  })

  // Open external https links in the system browser; deny in-app windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- IPC: narrow desktop contract (see docs/ipc-contract.md) ---
// Runtime IPC handlers are stubs until Task 1.2 (HarnessProcess) lands.

ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('app:get-platform', () => process.platform)
ipcMain.handle('app:quit', () => {
  app.quit()
})
ipcMain.handle('runtime:get-status', () => ({ state: 'idle' }))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Task 1.5 will keep the app alive in the tray; until then quit on non-macOS.
  if (process.platform !== 'darwin') app.quit()
})
