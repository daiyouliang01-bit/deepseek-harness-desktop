import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent } from '@dshd/protocol'
import type { KeyRecord } from '../keys/vault'
import type { RuntimeStatus } from '../runtime/runtime-types'
import type { UpdateState } from '../updater/update-manager'
import type { HistoryPage, SessionSearchResult, SessionSummary } from '../adapter/session-adapter'

export interface SessionOpResult<T> {
  ok: boolean
  error?: string
  value?: T
}

export interface TunnelStatus {
  phase: string
  url: string | null
  message: string | null
  startedAt: number
  upstream: string
}

/**
 * The only surface exposed to the renderer (see docs/ipc-contract.md).
 * Every capability is a narrow, explicitly typed IPC call.
 */
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:get-platform'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),

  // runtime lifecycle (Task 1.2/1.3)
  getRuntimeStatus: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:get-status'),
  getDiagnostics: (): Promise<unknown> => ipcRenderer.invoke('diagnostics:get'),
  startRuntime: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:start'),
  stopRuntime: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:stop'),
  restartRuntime: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:restart'),
  openLogs: (): Promise<boolean> => ipcRenderer.invoke('runtime:open-logs'),

  // UI navigation (Task 3.1)
  openOfficialUI: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('ui:open-official'),
  openPhonePanel: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('ui:open-phone-panel'),
  onOpenShell: (callback: (view?: string) => void): (() => void) => {
    const listener = (_e: unknown, view?: string) => callback(view)
    ipcRenderer.on('ui:open-shell', listener)
    return () => {
      ipcRenderer.removeListener('ui:open-shell', listener)
    }
  },
  onSetSession: (callback: (sessionId: string) => void): (() => void) => {
    const listener = (_e: unknown, sessionId: string) => callback(sessionId)
    ipcRenderer.on('agent:set-session', listener)
    return () => {
      ipcRenderer.removeListener('agent:set-session', listener)
    }
  },
  revealInFinder: (target: string): Promise<boolean> => ipcRenderer.invoke('files:reveal', target),
  openWithDefaultApp: (target: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('files:open', target),

  // key vault (Task 3.5) — only masked keys and status cross the bridge
  listKeys: (): Promise<KeyRecord[]> => ipcRenderer.invoke('keys:list'),
  setKey: (provider: string, key: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('keys:set', provider, key),
  removeKey: (provider: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('keys:remove', provider),
  keyEncryptionAvailable: (): Promise<boolean> => ipcRenderer.invoke('keys:availability'),

  // auto-update (Task 5.3)
  updateGetState: (): Promise<UpdateState> => ipcRenderer.invoke('update:get-state'),
  updateCheck: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
  updateDownload: (): Promise<UpdateState> => ipcRenderer.invoke('update:download'),
  updateInstall: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('update:install'),
  crashEvidenceGet: (): Promise<{
    previousCrashed: boolean
    rollbackSuggested: boolean
    previousVersion: string | null
    evidence: { startedAt: number; appVersion: string } | null
  }> => ipcRenderer.invoke('crash-evidence:get'),
  onUpdateState: (cb: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: unknown, state: UpdateState) => cb(state)
    ipcRenderer.on('update:state', listener)
    return () => {
      ipcRenderer.removeListener('update:state', listener)
    }
  },

  // session domain (M2)
  sessionList: (): Promise<SessionOpResult<SessionSummary[]>> => ipcRenderer.invoke('sessions:list'),
  sessionCreate: (cwd?: string): Promise<SessionOpResult<{ sessionId: string }>> => ipcRenderer.invoke('sessions:create', cwd),
  sessionHistory: (sessionId: string, beforeSeq?: number): Promise<SessionOpResult<HistoryPage>> =>
    ipcRenderer.invoke('sessions:history', sessionId, beforeSeq),
  sessionRename: (sessionId: string, title: string): Promise<SessionOpResult<string>> =>
    ipcRenderer.invoke('sessions:rename', sessionId, title),
  sessionSearch: (query: string): Promise<SessionOpResult<SessionSearchResult[]>> => ipcRenderer.invoke('sessions:search', query),
  sessionArchive: (sessionId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('sessions:archive', sessionId),

  // agent stream (M3)
  agentSend: (
    sessionId: string,
    text: string,
    imagePaths?: Array<{ name: string; path: string }>
  ): Promise<SessionOpResult<{ accepted: boolean; images?: number; rejected?: Array<{ index: number; reason: string }>; resized?: number }>> =>
    ipcRenderer.invoke('agent:send', sessionId, text, imagePaths),
  agentCancel: (sessionId: string): Promise<SessionOpResult<{ accepted: boolean }>> =>
    ipcRenderer.invoke('agent:cancel', sessionId),
  agentSetActiveSession: (sessionId: string | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('agent:set-active-session', sessionId),
  agentApprove: (sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:approve', sessionId, approvalId, outcome),
  agentAnswer: (sessionId: string, questionId: string, selected: string[]): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:answer', sessionId, questionId, selected),
  agentAttachment: (sessionId: string, attachmentId: string): Promise<SessionOpResult<{ data: string; mediaType: string; name?: string }>> =>
    ipcRenderer.invoke('agent:attachment', sessionId, attachmentId),
  agentStreamState: (): Promise<{ running: boolean }> => ipcRenderer.invoke('agent:stream-state'),
  agentTaskStatus: (
    sessionId: string,
  ): Promise<SessionOpResult<{ phase?: string; verifyOk?: boolean } | null>> =>
    ipcRenderer.invoke('agent:task-status', sessionId),
  autolaunchGet: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke('autolaunch:get'),
  autolaunchSet: (enabled: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('autolaunch:set', enabled),
  onDeepLink: (cb: (url: string) => void): (() => void) => {
    const listener = (_event: unknown, url: string) => cb(url)
    ipcRenderer.on('deep-link', listener)
    return () => {
      ipcRenderer.removeListener('deep-link', listener)
    }
  },
  onAgentEvent: (cb: (events: AgentEvent[]) => void): (() => void) => {
    const listener = (_event: unknown, events: AgentEvent[]) => cb(events)
    ipcRenderer.on('agent:event', listener)
    return () => {
      ipcRenderer.removeListener('agent:event', listener)
    }
  },
  onAgentStreamState: (cb: (state: { running: boolean; error?: string }) => void): (() => void) => {
    const listener = (_event: unknown, state: { running: boolean; error?: string }) => cb(state)
    ipcRenderer.on('agent:stream-state', listener)
    return () => {
      ipcRenderer.removeListener('agent:stream-state', listener)
    }
  },

  onRuntimeStatus: (callback: (status: RuntimeStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: RuntimeStatus) => callback(status)
    ipcRenderer.on('runtime:status', listener)
    return () => {
      ipcRenderer.removeListener('runtime:status', listener)
    }
  },

  // phone access (Task 7.2) — tunnel control proxied through the main process
  phoneStatus: (): Promise<SessionOpResult<TunnelStatus>> => ipcRenderer.invoke('phone:get-status'),
  phoneStart: (): Promise<SessionOpResult<TunnelStatus>> => ipcRenderer.invoke('phone:start'),
  phoneStop: (): Promise<SessionOpResult<TunnelStatus>> => ipcRenderer.invoke('phone:stop'),
  // data-directory settings (multi-instance isolation)
  dshHomeGet: (): Promise<{ ok: boolean; value?: string; default?: string; error?: string }> => ipcRenderer.invoke('settings:get-dsh-home'),
  dshHomeSet: (value: string): Promise<{ ok: boolean; value?: string; restartRequired?: boolean; error?: string }> => ipcRenderer.invoke('settings:set-dsh-home', value),
  // PIN gate (Task 7.3)
  pinHas: (): Promise<{ ok: boolean; value?: boolean; error?: string }> => ipcRenderer.invoke('pin:has'),
  pinSet: (pin: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('pin:set', pin),
  pinStatus: (): Promise<{ ok: boolean; value?: { enabled: boolean; locked: boolean; lockRemainingMs: number } }> =>
    ipcRenderer.invoke('pin:status'),
  pinResetLock: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('pin:reset-lock'),
  pairMint: (): Promise<{ ok: boolean; url?: string; exp?: number; qrSvg?: string; error?: string }> => ipcRenderer.invoke('pair:mint'),
  pairList: (): Promise<{ ok: boolean; value?: { id: string; label: string; createdAt: number; lastSeenAt: number }[]; error?: string }> =>
    ipcRenderer.invoke('pair:list'),
  pairRevoke: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('pair:revoke', id),
}

contextBridge.exposeInMainWorld('desktop', api)

export type DesktopApi = typeof api
