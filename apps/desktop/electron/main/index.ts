import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
import { TaskMonitor } from '../tasks/task-monitor'
import { loadWindowState, saveWindowState, type SavedWindowState } from '../window-state'
import { isPortFree } from '../runtime/port-probe'
import { HarnessProcess } from '../runtime/harness-process'
import { findRuntime } from '../runtime/dsh-bin'
import type { RuntimeStatus } from '../runtime/runtime-types'
import { LedgerIntegration, readDshVersion } from '../runtime/ledger-integration'
import { ensurePhoneSyncLinked } from '../runtime/phone-sync-installer'
import { ensureCommunityLinksLinked } from '../runtime/community-links-installer'
import { ensurePhoneSettingsLinked } from '../runtime/phone-settings-installer'
import { ensureCodingAgentLinked } from '../runtime/coding-agent-installer'
import { ensureDesktopChromeLinked } from '../runtime/desktop-chrome-installer'
import { PinGate } from '../runtime/pin-gate'
import { applySidebarTrustPatch } from '../runtime/sidebar-trust-patch'
import { recoverStaleCredentialLocks } from '../runtime/credential-lock-recovery'
import {
  defaultDesktopHome,
  findProfileFileDepsIntoSharedHome,
  isSharedWebHome,
  ensureDesktopLocaleZh,
  materializeLeakedLinks,
  resolveDesktopDshHome,
  sharedWebHome
} from '../runtime/dsh-home-isolation'
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
  show: (title, body, onClick) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body })
    if (onClick) n.on('click', () => {
      onClick()
      // Clicking a notification is an explicit attention request: surface the
      // window even when close-to-tray would have kept it hidden.
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
    n.show()
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
      buildAppMenuTemplate(
        {
          openCustomShell: () => openCustomShell(),
          openOfficialUI: () => void openOfficialUI(),
          reload: () => mainWindow?.webContents.reload(),
          quit: () => app.quit()
        },
        // Dev-only menu entries (Custom Shell preview / Official Web UI /
        // DevTools) stay out of packaged builds — external review item #10.
        { devMode: !app.isPackaged }
      ) as Electron.MenuItemConstructorOptions[]
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

/**
 * Resolve the dsh data directory for the desktop shell.
 *
 * HARD RULE: never `~/.dsh`. That directory belongs to standalone `dsh web`
 * on :3080. Desktop default is `~/.dsh-desktop`. A configured / env value
 * that equals `~/.dsh` is ignored. Desktop changes are never synced back to
 * :3080 unless the user explicitly asks.
 */
function resolveDshHome(): string {
  let configured: string | undefined
  try {
    const raw = readFileSync(join(app.getPath('userData'), 'config', 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as { dshHome?: unknown }
    if (typeof parsed.dshHome === 'string') configured = parsed.dshHome
  } catch {
    /* missing/corrupt settings → default */
  }
  return resolveDesktopDshHome({
    configured,
    envHome: process.env['DSH_HOME']
  })
}

const DESKTOP_DSH_HOME = resolveDshHome()
const leaked = materializeLeakedLinks(DESKTOP_DSH_HOME, sharedWebHome())
if (leaked.length > 0) {
  console.log(`[isolation] copied then disconnected leaked links: ${leaked.join(', ')}`)
}

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
  const dshHome = DESKTOP_DSH_HOME
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

// Isolation guard: the desktop profile must not depend on files inside the
// :3080 data dir (~/.dsh). A leaked `file:` dep would re-couple the two
// homes (plugin crashes took both down once); warn loudly if it happens.
const leakedFileDeps = findProfileFileDepsIntoSharedHome(
  join(DESKTOP_DSH_HOME, 'profiles', 'web'),
  sharedWebHome()
)
if (leakedFileDeps.length > 0) {
  logLine('stderr', `[isolation] 隔离违规:桌面 profile 的 file: 依赖指向 ~/.dsh: ${leakedFileDeps.join(', ')}`)
}

const runtime = new HarnessProcess({
  runtime: runtimeDescriptor,
  topLevelArgs: ['--patch', desktopPatchPath()],
  extraArgs: [
    '--no-open',
    ...(TRUSTED_HOSTS.length > 0 ? TRUSTED_HOSTS.flatMap((h) => ['--trusted-host', h]) : [])
  ],
  port: PREFERRED_PORT,
  autoRestart: true,
  // Dedicated data directory when configured: the child dsh must read/write
  // the same DSH_HOME the desktop shell resolves (session-log isolation).
  env: { DSH_HOME: DESKTOP_DSH_HOME },
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

// --- task center (P1 slice 1): completion notifications + dock badge ---
const taskMonitor = new TaskMonitor(
  {
    isSupported: () => Notification.isSupported(),
    notify: (title, body, onClick) => notifier.notify(title, body, onClick),
    // Dock badge intentionally disabled (user preference): a lingering count
    // reads as unread mail rather than "work in flight". Completion
    // notifications remain the attention signal.
    setBadge: () => undefined
  },
  {
    list: async () => {
      const adapter = ensureSessionAdapter()
      if (!adapter) return []
      return adapter.list()
    },
    // .dsh/tasks/<id>.json sidecar: phase 'failed' / lastVerify all-no → 失败
    taskStatus: async (sessionId) => {
      const adapter = ensureSessionAdapter()
      return adapter?.readTaskStatus(sessionId) ?? null
    }
  }
)
// Clicking a completion notification jumps straight to that conversation,
// not just to the window.
taskMonitor.onActivate = (sessionId) => {
  mainWindow?.webContents.send('agent:set-session', sessionId)
}

// Approval / question prompts that arrive while the user is away: surface a
// clickable notification per request id (deduped — the live stream replays).
const seenPrompts = new Set<string>()
function notifyAttentionEvents(events: Array<{ type: string; id?: string; permission?: string }>): void {
  for (const ev of events) {
    if (ev.type !== 'approval-request' && ev.type !== 'question') continue
    if (!ev.id || seenPrompts.has(ev.id)) continue
    seenPrompts.add(ev.id)
    // Bounded memory: once the set grows past 500, drop the oldest half.
    if (seenPrompts.size > 500) {
      let n = 250
      for (const id of seenPrompts) {
        if (n-- <= 0) break
        seenPrompts.delete(id)
      }
    }
    const label = ev.type === 'approval-request' ? '需要批准' : '需要回答'
    const detail = ev.permission ?? '子任务在等待你的输入'
    notifier.notify(label, detail, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
  }
}

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
    onEvents: (events) => {
      mainWindow?.webContents.send('agent:event', events)
      notifyAttentionEvents(events)
    },
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
  return { ok: true }
}

// NOTE: the old floating "📱 手机" FAB (injectPhoneFab) was removed — the
// phone entry now lives in the official web UI's 设置 → 手机 page (provided
// by the @dshd/phone-settings bundle), so clicking it no longer switches the
// window to the shell renderer (which had no way back).

runtime.on('statusChange', (status: RuntimeStatus) => {
  notifier.handleStatus(status)
  updateTrayMenu()
  if (status.state === 'ready' && status.ready && mainWindow && !uiLoaded && !shellRequested) {
    uiLoaded = true
    // Load ONLY the validated loopback URL.
    void mainWindow.loadURL(status.ready.url)
    // Start the PIN gate in front of the actual dsh web port so the tunnel
    // (phone access) never reaches dsh without the PIN.
    void startPinGate(status.ready.url)
  } else if (status.state === 'error' || status.state === 'stopped') {
    sessionAdapter = null // runtime gone → adapter must rebuild on next ready
    stopStreamBridge()
    stopPinGate()
    taskMonitor.stop() // no runtime → nothing to watch; badge cleared
    if (uiLoaded) {
      // Runtime died while the Web UI was loaded → go back to the shell
      // renderer (loading/recovery screen).
      uiLoaded = false
      loadRendererScreen()
    }
  }
  if (status.state === 'ready') taskMonitor.start()
  pushStatus()
})

async function startRuntime(): Promise<RuntimeStatus> {
  try {
    // Companion wiring (plan R30/R13): the dsh child inherits process.env,
    // so publish the gate port + shared token BEFORE the runtime spawns.
    process.env['DSH_PIN_GATE_PORT'] = String(PIN_GATE_PORT)
    ensureCompanionToken()
    ensureDesktopLocaleZh(DESKTOP_DSH_HOME)

    // Task 7.2: link the bundled phone-sync plugin into the web profile so the
    // spawned dsh can load it (idempotent; failure only disables phone access).
    const dshHome = DESKTOP_DSH_HOME
    const recoveredCredentialLocks = recoverStaleCredentialLocks(dshHome)
    for (const lockPath of recoveredCredentialLocks) {
      logLine('stdout', `[credentials] moved stale lock ${lockPath}`)
    }
    const linked = ensurePhoneSyncLinked(dshHome, join(__dirname, '../..'))
    if (linked) {
      logLine('stdout', `[phone-sync] linked ${linked}`)
    }

    // Task: link the bundled community-links plugin into the web profile so
    // the spawned dsh can load it (idempotent; failure only hides the
    // community-resource entry).
    const linkedCommunity = ensureCommunityLinksLinked(dshHome, join(__dirname, '../..'))
    if (linkedCommunity) {
      logLine('stdout', `[community-links] linked ${linkedCommunity}`)
    }

    // Task: link the bundled phone-settings plugin into the web profile so the
    // phone access settings page (设置 → 手机) is available in the official UI.
    const linkedPhoneSettings = ensurePhoneSettingsLinked(dshHome, join(__dirname, '../..'))
    if (linkedPhoneSettings) {
      logLine('stdout', `[phone-settings] linked ${linkedPhoneSettings}`)
    }

    // Coding Agent host plugin: insert-only row, never fatal if linking fails.
    const linkedCodingAgent = ensureCodingAgentLinked(dshHome, join(__dirname, '../..'), process.resourcesPath)
    if (linkedCodingAgent) {
      logLine('stdout', `[coding-agent] linked ${linkedCodingAgent}`)
    }

    // Desktop-only composer/session chrome. Linked into ~/.dsh-desktop only.
    const linkedDesktopChrome = ensureDesktopChromeLinked(dshHome, join(__dirname, '../..'), process.resourcesPath)
    if (linkedDesktopChrome) {
      logLine('stdout', `[desktop-chrome] linked ${linkedDesktopChrome}`)
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

// P2 — remember window size/position across launches (debounced persist).
let boundsPersistTimer: NodeJS.Timeout | null = null
function persistWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  const b = mainWindow.getBounds()
  const state: SavedWindowState = { width: b.width, height: b.height, x: b.x, y: b.y, maximized: mainWindow.isMaximized() }
  saveWindowState(app.getPath('userData'), state)
}

function createWindow(): void {
  const displays = screen.getAllDisplays().map((d) => d.workArea)
  const saved = loadWindowState(app.getPath('userData'), displays)
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
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

  // Auto-show ONCE. ready-to-show re-fires after every navigation (shell →
  // official UI load), and a re-show would pop the window back open right
  // after the user closed it to tray while a load was in flight. The same
  // race exists on FIRST show: closing before the renderer finished painting
  // (hide-to-tray) must not be undone by the pending ready-to-show.
  let autoShown = false
  let closedToTray = false
  mainWindow.on('ready-to-show', () => {
    if (autoShown || closedToTray) return
    autoShown = true
    if (!startHidden) mainWindow?.show()
    if (saved.maximized) mainWindow?.maximize()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Persist bounds as they change (debounced) and once more on close.
  mainWindow.on('resize', () => {
    if (boundsPersistTimer) clearTimeout(boundsPersistTimer)
    boundsPersistTimer = setTimeout(persistWindowBounds, 500)
  })
  mainWindow.on('move', () => {
    if (boundsPersistTimer) clearTimeout(boundsPersistTimer)
    boundsPersistTimer = setTimeout(persistWindowBounds, 500)
  })

  // Hide to tray on close (Task 1.5); quit only via tray/menu/Cmd+Q.
  mainWindow.on('close', (event) => {
    persistWindowBounds()
    if (!isQuitting) {
      closedToTray = true
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

// P2-2 file-workflow bridge (foundation): reveal in Finder / open with the
// default app. Generic by design — the file-preview plugin and diagnostics
// both build on these rather than shelling out themselves.
ipcMain.handle('files:reveal', (_e, target: unknown) => {
  if (typeof target !== 'string' || target.length === 0) return false
  shell.showItemInFolder(target)
  return true
})
ipcMain.handle('files:open', async (_e, target: unknown) => {
  if (typeof target !== 'string' || target.length === 0) return { ok: false, error: 'empty path' }
  const message = await shell.openPath(target)
  return message ? { ok: false, error: message } : { ok: true }
})

// P2 — read-only diagnostics snapshot for the settings page (external review
// item #5): one authoritative answer to "what is ACTUALLY running" — real
// runtime state, versions, data dir, ports — instead of hardcoded copy.
ipcMain.handle('diagnostics:get', async () => {
  const status = runtime.getStatus()
  let port3080InUse: boolean | null = null
  try {
    port3080InUse = !(await isPortFree(3080))
  } catch {
    port3080InUse = null // probe failure must not break the snapshot
  }
  return {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron ?? '?',
    node: process.versions.node ?? '?',
    platform: process.platform,
    dshPinnedVersion: readDshVersion(runtimeDescriptor),
    dshHome: DESKTOP_DSH_HOME,
    profile: 'web',
    preferredPort: PREFERRED_PORT,
    port3080InUse,
    runtime: {
      state: status.state,
      pid: status.pid ?? null,
      url: status.ready?.url ?? null,
      port: status.ready?.port ?? null,
      startedAt: status.startedAt ?? null,
      lastError: status.lastError ?? null
    }
  }
})
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
      allowFullApp: process.env['DSH_PIN_GATE_ALLOW_FULL'] !== '0',
      publicBaseUrl: process.env['DSH_PUBLIC_BASE'] || 'https://dsh.dpharness.xyz',
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
ipcMain.handle('pair:mint', () => {
  if (!pinGate) return { ok: false, error: 'PIN gate not started' }
  return pinGate.mintPair()
})
ipcMain.handle('pair:list', () => {
  if (!pinGate) return { ok: false, error: 'PIN gate not started' }
  return { ok: true, value: pinGate.listPaired() }
})
ipcMain.handle('pair:revoke', (_e, id: string) => {
  if (!pinGate) return { ok: false, error: 'PIN gate not started' }
  return pinGate.revokePaired(typeof id === 'string' ? id : '')
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
ipcMain.handle('agent:task-status', (_e, sessionId: string) => {
  const current = ensureSessionAdapter()
  if (!current) return { ok: false, error: 'runtime not ready' }
  return { ok: true, value: current.readTaskStatus(sessionId) }
})

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

// --- data-directory settings (multi-instance isolation) ---
ipcMain.handle('settings:get-dsh-home', () => ({
  ok: true,
  value: DESKTOP_DSH_HOME,
  default: defaultDesktopHome()
}))
ipcMain.handle('settings:set-dsh-home', (_e, value: string) => {
  const next = typeof value === 'string' ? value.trim() : ''
  if (next !== '' && !next.startsWith('/')) return { ok: false, error: '必须是绝对路径' }
  if (next !== '' && isSharedWebHome(next)) {
    return {
      ok: false,
      error: '禁止使用 ~/.dsh：那是 3080 独立 web 的目录。桌面端必须用独立目录（默认 ~/.dsh-desktop）。'
    }
  }
  try {
    mkdirSync(join(app.getPath('userData'), 'config'), { recursive: true })
    const file = join(app.getPath('userData'), 'config', 'settings.json')
    const current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (next === '') delete current.dshHome
    else current.dshHome = next
    writeFileSync(file, JSON.stringify(current, null, 2), 'utf8')
    return { ok: true, value: next, restartRequired: next !== DESKTOP_DSH_HOME }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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

// Clean shutdown: stop the runtime and WAIT for it before quitting.
// Plan v1.4 residual gap — the previous fire-and-forget `void runtime.stop()`
// raced Electron's exit, so a dsh that ignored SIGTERM outlived the app and
// its SIGKILL escalation (an .unref()'d timer) was never delivered.
let stopAttempted = false
app.on('before-quit', (event) => {
  isQuitting = true
  shortcutManager.dispose()
  // Second pass (after our own app.quit() below) or nothing owned to stop:
  // an adopted instance is deliberately left alive for reuse next launch.
  if (stopAttempted || !runtime.isRunning()) {
    if (!stopAttempted) crashEvidence.markCleanExit()
    return // allow quit to proceed
  }
  stopAttempted = true
  event.preventDefault()
  void runtime
    .stop()
    .catch(() => undefined)
    .finally(() => {
      // Mark clean ONLY when the tree is verifiably gone. A timed-out
      // survivor leaves status at 'error' and its ledger entry unexpected,
      // so reapBeforeSpawn() reaps it on the next launch.
      if (runtime.getStatus().state !== 'error') crashEvidence.markCleanExit()
      app.quit()
    })
})

// will-quit: belt-and-braces marker for paths where before-quit's async stop
// may not have settled (plan v1.4 R7 — the ledger clean marker is written
// synchronously inside recordCleanStop via saveLedger).
app.on('will-quit', () => {
  isQuitting = true
})

// SIGTERM/SIGINT (e.g. `kill <pid>`, system shutdown on Linux): route through
// the normal quit path so the deterministic stop-and-wait above applies here
// too (plan v1.4 G1).
process.on('SIGTERM', () => {
  app.quit()
})
process.on('SIGINT', () => {
  app.quit()
})
