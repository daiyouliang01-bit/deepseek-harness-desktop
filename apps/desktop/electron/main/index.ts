import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { isAllowedNavigation } from '../navigation-guard'
import { CrashEvidence } from '../crash-evidence'
import { UpdateRollback } from '../updater/update-rollback'
import { autolaunchEnabled, HIDDEN_LAUNCH_ARG, setAutolaunch, shouldStartHidden, type LoginWindowController } from '../autolaunch'
import { KeyVault } from '../keys/vault'
import { intakeImages } from '../attachments/image-intake'
import { SessionAdapter } from '../adapter/session-adapter'
import { RpcClient } from '../adapter/rpc-client'
import { StreamBridge } from '../adapter/stream-bridge'
import { SessionStore } from '@dshd/session-store'
import { buildAppMenuTemplate } from '../menu'
import { RuntimeNotifier } from '../notifications'
import { HarnessProcess } from '../runtime/harness-process'
import { findRuntime } from '../runtime/dsh-bin'
import type { RuntimeStatus } from '../runtime/runtime-types'
import { LedgerIntegration, readDshVersion } from '../runtime/ledger-integration'
import { ensurePhoneSyncLinked } from '../runtime/phone-sync-installer'
import { PinGate } from '../runtime/pin-gate'
import { applySidebarTrustPatch } from '../runtime/sidebar-trust-patch'
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

// --- crash evidence + update rollback (crash-evidence.ts / update-rollback.ts) ---
const evidenceDir = join(app.getPath('userData'), 'crash-evidence')
const crashEvidence = new CrashEvidence({
  dir: evidenceDir,
  appVersion: app.getVersion(),
  dshVersion: () => runtime.getStatus().ready?.url !== undefined ? 'runtime-ready' : undefined
})
const rollback = new UpdateRollback({ dir: join(app.getPath('userData'), 'updates') })

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
  openPhonePanel: () => openCustomShell('phone'),
  openLogs: async () => {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    await shell.openPath(LOG_DIR)
  },
  toggleAutolaunch: () => {
    setAutolaunch(startHiddenCtrl, !autolaunchEnabled(startHiddenCtrl))
    updateTrayMenu()
  },
  quit: () => app.quit()
}

function updateTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenuTemplate(runtime.getStatus().state, trayActions, autolaunchEnabled(startHiddenCtrl))
    )
  )
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
// Desktop custom shell enables the base toolset (web surface disables it)
// via an official `--patch` overlay shipped with the app.
function desktopPatchPath(): string {
  // packaged: <resources>/desktop-tools.patch.yml; dev: repo resources dir
  // dev 下 __dirname = apps/desktop/out/main,文件在 apps/desktop/resources/,
  // 所以是 ../../resources(退两级:out/main → out → desktop),不是 ../../../。
  const candidates = [
    join(process.resourcesPath ?? '', 'desktop-tools.patch.yml'),
    join(__dirname, '../../resources/desktop-tools.patch.yml')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[1]
}

// --- process ledger (Task 7.1, plan v1.4): single-instance protection ---
// The ledger records which dsh child we spawned so a crashed / force-quit run
// can be reaped on the next launch (triple-checked, never touching manual
// instances or reused PIDs).
const runtimeDescriptor = findRuntime()
const ledger = new LedgerIntegration({
  userDataDir: app.getPath('userData'),
  appSignature: 'desktop-tools.patch.yml',
  dshVersion: readDshVersion(runtimeDescriptor)
})

// Phase 2.1: preferred fixed port (override with DSH_DESKTOP_PORT env).
const PREFERRED_PORT = Number(process.env['DSH_DESKTOP_PORT'] ?? '') || 35880

// PIN gate: loopback reverse proxy in front of dsh web, exposed via the
// tunnel so phones must enter a PIN before reaching the harness.
// Override the gate port with DSH_PIN_GATE_PORT; the upstream port is derived
// from the runtime's ready URL at start time.
const PIN_GATE_PORT = Number(process.env['DSH_PIN_GATE_PORT'] ?? '') || 35881
let pinGate: PinGate | null = null

// Companion token (plan R30/R34): one stable secret shared by the PIN gate,
// the phone-sync plugin (injected into the dsh child env) and this main
// process's control calls (tunnelCall). Persisted at ~/.dsh/companion/token
// (0600) so app restarts keep the same value; gate and plugin both rely on
// this single source of truth.
const COMPANION_TOKEN_FILE = (() => {
  const dshHome = process.env['DSH_HOME'] || join(homedir(), '.dsh')
  return join(dshHome, 'companion', 'token')
})()

function ensureCompanionToken(): string {
  const existing = process.env['DSH_COMPANION_TOKEN']
  if (existing) return existing
  try {
    if (existsSync(COMPANION_TOKEN_FILE)) {
      const raw = readFileSync(COMPANION_TOKEN_FILE, 'utf8').trim()
      if (raw.length >= 16) {
        process.env['DSH_COMPANION_TOKEN'] = raw
        return raw
      }
    }
    const token = randomBytes(32).toString('hex')
    mkdirSync(dirname(COMPANION_TOKEN_FILE), { recursive: true })
    writeFileSync(COMPANION_TOKEN_FILE, token + '\n', { mode: 0o600 })
    process.env['DSH_COMPANION_TOKEN'] = token
    return token
  } catch (err) {
    // Fallback: ephemeral token for this run only (never fail to boot).
    const token = randomBytes(32).toString('hex')
    process.env['DSH_COMPANION_TOKEN'] = token
    console.warn('[companion] token persistence failed, using ephemeral token', err)
    return token
  }
}

// Mobile remote (plan v1.5): extra authorities the dsh /api browser-trust
// fence accepts (comma-separated, e.g. DSH_TRUSTED_HOSTS=dsh.dpharness.xyz).
// Without this, phones reaching dsh via the tunnel get HTTP 403 on every RPC.
const TRUSTED_HOSTS = (process.env['DSH_TRUSTED_HOSTS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const runtime = new HarnessProcess({
  runtime: runtimeDescriptor,
  topLevelArgs: ['--patch', desktopPatchPath()],
  extraArgs: TRUSTED_HOSTS.length > 0 ? TRUSTED_HOSTS.flatMap((h) => ['--trusted-host', h]) : [],
  port: PREFERRED_PORT,
  autoRestart: true,
  onOutput: logLine,
  onSpawned: (pid, startedAt) => ledger.recordSpawned(pid, startedAt),
  onReady: (info) => ledger.recordReady(info),
  onStopped: (clean) => {
    if (clean) ledger.recordCleanStop()
    else ledger.recordUnexpectedExit()
  }
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
function openCustomShell(view?: string): void {
  shellRequested = true
  uiLoaded = false
  loadRendererScreen()
  const win = mainWindow
  if (win) {
    win.webContents.once('did-finish-load', () => {
      // Push the current runtime status so the shell renderer does not show
      // its "Runtime unavailable" recovery screen on first load.
      pushStatus()
      win.webContents.send('ui:open-shell', view ?? 'conversations')
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
  injectPhoneFab()
  return { ok: true }
}

/**
 * Inject a floating "📱 手机" button into the official Web UI so the phone
 * panel (PIN settings / tunnel) is reachable from the main window without
 * hunting for tray/menu entries. The button calls the preload bridge.
 */
function injectPhoneFab(): void {
  const win = mainWindow
  if (!win) return
  const js = `
    (() => {
      if (document.getElementById('dshd-phone-fab')) return;
      const btn = document.createElement('button');
      btn.id = 'dshd-phone-fab';
      btn.textContent = '📱 手机';
      btn.title = '手机访问 / PIN 设置';
      btn.style.cssText = [
        'position:fixed', 'bottom:20px', 'right:20px', 'z-index:2147483647',
        'padding:10px 16px', 'border:none', 'border-radius:999px',
        'background:#4f7cff', 'color:#fff', 'font-size:14px', 'font-weight:600',
        'cursor:pointer', 'box-shadow:0 4px 16px rgba(0,0,0,.35)',
        'font-family:-apple-system,system-ui,sans-serif'
      ].join(';');
      btn.addEventListener('click', () => {
        if (window.desktop && typeof window.desktop.openPhonePanel === 'function') {
          void window.desktop.openPhonePanel();
        }
      });
      document.body.appendChild(btn);
    })();
  `
  win.webContents.once('did-finish-load', () => {
    win.webContents.executeJavaScript(js).catch(() => {
      /* injected page may block eval; non-fatal */
    })
  })
}

runtime.on('statusChange', (status: RuntimeStatus) => {
  notifier.handleStatus(status)
  updateTrayMenu()
  if (status.state === 'ready' && status.ready && mainWindow && !uiLoaded && !shellRequested) {
    uiLoaded = true
    // Load ONLY the validated loopback URL.
    void mainWindow.loadURL(status.ready.url)
    injectPhoneFab()
    // Start the PIN gate in front of the actual dsh web port so the tunnel
    // (phone access) never reaches dsh without the PIN.
    void startPinGate(status.ready.url)
  } else if (status.state === 'error' || status.state === 'stopped') {
    sessionAdapter = null // runtime gone → adapter must rebuild on next ready
    stopStreamBridge()
    stopPinGate()
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
    // Companion wiring (plan R30/R13): the dsh child inherits process.env,
    // so publish the gate port + shared token BEFORE the runtime spawns.
    process.env['DSH_PIN_GATE_PORT'] = String(PIN_GATE_PORT)
    ensureCompanionToken()

    // Task 7.2: link the bundled phone-sync plugin into the web profile so the
    // spawned dsh can load it (idempotent; failure only disables phone access).
    const dshHome = process.env['DSH_HOME'] || join(require('node:os').homedir(), '.dsh')
    const linked = ensurePhoneSyncLinked(dshHome, join(__dirname, '../..'))
    if (linked) {
      logLine('stdout', `[phone-sync] linked ${linked}`)
    }

    // Task 7.x: patch better-sidebar's /sidebar fence so it honors
    // DSH_TRUSTED_HOSTS (its trustedHostsOf only reads the raw loader row,
    // so remote /sidebar requests 403 even with --trusted-host set).
    // Idempotent and never fatal; failure keeps /sidebar loopback-only.
    applySidebarTrustPatch(dshHome)

    // Plan v1.4 (B): reap any orphan from a previous crashed run BEFORE
    // spawning, so we never run two dsh instances against the same data dir.
    const reaped = await ledger.reapBeforeSpawn()
    if (reaped.reaped.length > 0) {
      logLine('stdout', `[ledger] reaped ${reaped.reaped.join(', ')} from previous run`)
    } else if (reaped.dropped.length > 0) {
      logLine('stdout', `[ledger] dropped stale ledger entries ${reaped.dropped.join(', ')} (no kill)`)
    }

    // Plan v1.4 (C): report dsh instances running outside the ledger.
    // Report-only — the user decides (modal in the shell renderer).
    const coexisting = ledger.detectCoexisting()
    const manual = coexisting.filter((i) => i.kind === 'manual')
    const appOrphans = coexisting.filter((i) => i.kind === 'app-orphan')
    if (appOrphans.length > 0) {
      logLine('stdout', `[ledger] detected ${appOrphans.length} app-signature leftover(s) outside ledger: ${appOrphans.map((i) => i.pid).join(', ')}`)
    }
    if (manual.length > 0) {
      logLine('stdout', `[ledger] detected ${manual.length} manual dsh instance(s) sharing the data dir: ${manual.map((i) => i.pid).join(', ')}`)
      mainWindow?.webContents.send('runtime:coexistence', {
        manual: manual.map((i) => ({ pid: i.pid, command: i.command })),
        appOrphans: appOrphans.map((i) => ({ pid: i.pid, command: i.command }))
      })
    }

    // Phase 2.3 (D): reuse a healthy already-running dsh instead of spawning.
    const reused = await ledger.tryReuse(PREFERRED_PORT)
    if (reused) {
      logLine('stdout', `[ledger] reusing existing dsh at ${reused.url}`)
      runtime.adopt(reused)
      return runtime.getStatus()
    }

    await runtime.start()
  } catch (err) {
    // status already reflects 'error' via the event; nothing else to do
  }
  return runtime.getStatus()
}

// --- window creation ---
const APP_ICON_PNG = join(__dirname, '../../build/icon.png')

// P1: an autostart launch (open-at-login) keeps the window hidden until the
// user summons it via tray/global-shortcut.
const startHiddenCtrl: LoginWindowController = {
  platform: process.platform,
  argv: process.argv,
  openedAtLogin: () => app.getLoginItemSettings().wasOpenedAtLogin,
  setOpenAtLogin: (enabled) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // Windows: register --hidden so an autostart launch stays out of sight.
      args: process.platform === 'win32' ? [HIDDEN_LAUNCH_ARG] : []
    })
  },
  isOpenAtLogin: () => app.getLoginItemSettings().openAtLogin
}
const startHidden = shouldStartHidden(startHiddenCtrl)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'DeepSeek Harness Desktop',
    icon: APP_ICON_PNG, // dev-mode window/dock icon (packaged uses the bundle)
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })
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

// --- phone access (Task 7.2): tunnel control via the phone-sync plugin ---
// The plugin exposes HTTP routes on the dsh web server (/phn/api/tunnel/*);
// we proxy them over IPC so the shell renderer never talks to dsh directly.

interface TunnelStatus {
  phase: string
  url: string | null
  message: string | null
  startedAt: number
  upstream: string
}

async function tunnelCall(path: string, method = 'GET'): Promise<{ ok: boolean; error?: string; value?: TunnelStatus }> {
  const status = runtime.getStatus()
  if (status.state !== 'ready' || !status.ready) return { ok: false, error: `runtime not ready (${status.state})` }
  try {
    const headers: Record<string, string> = {}
    // Plan R30: the plugin's /phn routes require the companion token; the
    // desktop control channel must present it too.
    const token = process.env['DSH_COMPANION_TOKEN']
    if (token) headers['x-dsh-companion-token'] = token
    const res = await fetch(`${status.ready.url}${path}`, { method, headers })
    const body = (await res.json()) as TunnelStatus
    return { ok: true, value: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// --- PIN gate (Task 7.3): loopback proxy in front of dsh web ---

function startPinGate(upstreamUrl: string): void {
  if (pinGate) return
  try {
    const gate = new PinGate({
      port: PIN_GATE_PORT,
      upstreamUrl,
      stateDir: join(app.getPath('userData'), 'state'),
      companionToken: process.env['DSH_COMPANION_TOKEN'] || ensureCompanionToken(),
      // The phone user wants the FULL dsh web UI through the PIN (same as the
      // desktop window), not just the /phn mobile console. Allow by default;
      // set DSH_PIN_GATE_ALLOW_FULL=0 to restrict back to the phone console.
      allowFullApp: process.env['DSH_PIN_GATE_ALLOW_FULL'] !== '0'
    })
    void gate.start().then((port) => {
      pinGate = gate
      logLine('stdout', `[pin-gate] listening on 127.0.0.1:${port} → ${upstreamUrl}`)
    }).catch((err) => {
      logLine('stderr', `[pin-gate] failed to start: ${String(err)}`)
    })
  } catch (err) {
    logLine('stderr', `[pin-gate] init failed: ${String(err)}`)
  }
}

function stopPinGate(): void {
  pinGate?.stop()
  pinGate = null
}

ipcMain.handle('phone:get-status', () => tunnelCall('/phn/api/tunnel/status'))
ipcMain.handle('phone:start', () => tunnelCall('/phn/api/tunnel/start', 'POST'))
ipcMain.handle('phone:stop', () => tunnelCall('/phn/api/tunnel/stop', 'POST'))

// PIN gate IPC: set/check the PIN from the shell renderer.
ipcMain.handle('pin:has', () => ({ ok: true, value: pinGate?.hasPin() ?? false }))
ipcMain.handle('pin:set', (_e, pin: string) => {
  if (!pinGate) return { ok: false, error: 'runtime not ready (PIN gate not started)' }
  const result = pinGate.setPin(typeof pin === 'string' ? pin : '')
  if (result.ok) pinGate.resetLock() // a fresh PIN also clears stray lock states
  return result
})
ipcMain.handle('pin:status', () => ({
  ok: true,
  value: pinGate ? pinGate.status() : { enabled: false, locked: false, lockRemainingMs: 0 }
}))
// Lockout recovery (plan R17): only the desktop owner can unblock; a stranger
// DoS-ing the public URL must not keep the real user locked out.
ipcMain.handle('pin:reset-lock', () => {
  if (!pinGate) return { ok: false, error: 'PIN gate not started' }
  pinGate.resetLock()
  return { ok: true }
})

ipcMain.handle('ui:open-official', () => openOfficialUI())
ipcMain.handle('ui:open-phone-panel', () => {
  if (!mainWindow) return { ok: false, error: 'no window' }
  openCustomShell('phone')
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

ipcMain.handle('agent:send', async (_e, sessionId: string, text: string, imagePaths?: Array<{ name: string; path: string }>) => {
  const adapter = ensureSessionAdapter()
  if (!adapter) return { ok: false, error: 'runtime not ready' }
  try {
    if (imagePaths && imagePaths.length > 0) {
      const intake = await intakeImages(imagePaths)
      if (!intake.ok) return { ok: false, error: intake.error }
      if (intake.images.length === 0) {
        return { ok: false, error: `no valid images: ${intake.rejected.map((r) => r.reason).join('; ')}` }
      }
      await adapter.promptWithImages(
        sessionId,
        text,
        intake.images.map((im) => ({ name: im.name, mediaType: im.mediaType, dataB64: im.dataB64 }))
      )
      return {
        ok: true,
        value: {
          accepted: true,
          images: intake.images.length,
          rejected: intake.rejected,
          resized: intake.images.filter((im) => im.resized).length
        }
      }
    }
    await adapter.prompt(sessionId, text)
    return { ok: true, value: { accepted: true } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
ipcMain.handle('agent:cancel', (_e, sessionId: string) =>
  withAdapter((a) => a.cancel(sessionId).then(() => ({ accepted: true as const })))
)
ipcMain.handle('agent:set-active-session', (_e, sessionId: string | null) => {
  streamBridge?.setActiveSession(sessionId)
  return { ok: true }
})
ipcMain.handle('agent:stream-state', () => ({ running: streamBridge?.isRunning() ?? false }))

// --- autolaunch IPC (P1) ---
ipcMain.handle('autolaunch:get', () => ({ enabled: autolaunchEnabled(startHiddenCtrl) }))
ipcMain.handle('autolaunch:set', (_e, enabled: boolean) => {
  setAutolaunch(startHiddenCtrl, enabled)
  return { ok: true }
})
ipcMain.handle('agent:approve', async (_e, sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected') => {
  const adapter = ensureSessionAdapter()
  const rpcId = streamBridge?.rpcIdFor(approvalId)
  if (!adapter || !rpcId) return { ok: false, error: 'approval not pending or runtime not ready' }
  try {
    await adapter.respondApproval(rpcId, sessionId, approvalId, outcome)
    streamBridge?.dropPending(approvalId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
ipcMain.handle('agent:answer', async (_e, sessionId: string, questionId: string, selected: string[]) => {
  const adapter = ensureSessionAdapter()
  const rpcId = streamBridge?.rpcIdFor(questionId)
  if (!adapter || !rpcId) return { ok: false, error: 'question not pending or runtime not ready' }
  try {
    await adapter.respondQuestion(rpcId, sessionId, { answers: [{ id: questionId, selected }] })
    streamBridge?.dropPending(questionId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
ipcMain.handle('agent:attachment', async (_e, sessionId: string, attachmentId: string) => {
  const adapter = ensureSessionAdapter()
  if (!adapter) return { ok: false, error: 'runtime not ready' }
  try {
    const att = await adapter.attachment(sessionId, attachmentId)
    return { ok: true, value: att }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

// --- auto-update IPC (Task 5.3) ---

ipcMain.handle('update:get-state', () => updater.getState())
ipcMain.handle('update:check', () => updater.check())
ipcMain.handle('update:download', () => updater.download())
ipcMain.handle('update:install', () => {
  updater.install()
  return { ok: true }
})
updater.subscribe(() => {
  const st = updater.getState()
  // Pending-install marker for cross-restart rollback: written when the
  // update is downloaded and awaiting the restart-to-install.
  if (st.status === 'downloaded' && st.version) {
    rollback.markPendingInstall(st.version)
  }
  mainWindow?.webContents.send('update:state', st)
})

// Crash-evidence / rollback query for the renderer (recovery banner).
ipcMain.handle('crash-evidence:get', () => {
  const prev = crashEvidence.readPrevious()
  const pending = rollback.readPending()
  const suggested = prev !== null && pending !== null
  return {
    previousCrashed: prev !== null,
    rollbackSuggested: suggested,
    previousVersion: pending?.version ?? null,
    evidence: prev
      ? { startedAt: prev.startedAt, appVersion: prev.appVersion }
      : null
  }
})

app.whenReady().then(() => {
  // Crash evidence: did the previous run die with a pending update?
  const prevCrashed = crashEvidence.previousRunCrashed()
  const rollbackState = rollback.evaluate(prevCrashed)
  crashEvidence.beginRun()
  createWindow()
  createTray()
  installAppMenu()
  if (!shortcutManager.register()) {
    console.warn('[shortcut] summon accelerator is taken by another app')
  }
  // P1: register dsh:// deep-link (packaged only; dev may fail harmlessly).
  try {
    app.setAsDefaultProtocolClient('dsh')
  } catch {
    /* non-fatal in dev */
  }
  // Boot the runtime immediately (Task 1.3: auto-start on launch).
  void startRuntime()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// P1: forward dsh:// deep-links to the renderer (focus window first).
app.on('open-url', (event, url) => {
  event.preventDefault()
  toggleWindow()
  mainWindow?.webContents.send('deep-link', url)
})

// Tray keeps the app alive; quitting happens via tray/menu/Cmd+Q.
app.on('window-all-closed', () => {
  /* no-op: tray resident */
})

// Clean shutdown: kill the child process tree on quit.
app.on('before-quit', () => {
  isQuitting = true
  shortcutManager.dispose()
  crashEvidence.markCleanExit()
  void runtime.stop()
})

// will-quit: belt-and-braces for paths where before-quit's async stop may not
// have settled (plan v1.4 R7 — the ledger clean marker is written synchronously
// inside recordCleanStop via saveLedger).
app.on('will-quit', () => {
  isQuitting = true
})

// SIGTERM/SIGINT (e.g. `kill <pid>`, system shutdown on Linux): give the
// child a clean stop instead of leaving it orphaned (plan v1.4 G1).
process.on('SIGTERM', () => {
  void runtime.stop().finally(() => app.quit())
})
process.on('SIGINT', () => {
  void runtime.stop().finally(() => app.quit())
})
