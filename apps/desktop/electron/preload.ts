import { contextBridge, ipcRenderer } from 'electron'
import type { RuntimeStatus } from './runtime/runtime-types'

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
  startRuntime: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:start'),
  stopRuntime: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:stop'),
  restartRuntime: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:restart'),
  openLogs: (): Promise<boolean> => ipcRenderer.invoke('runtime:open-logs'),

  onRuntimeStatus: (callback: (status: RuntimeStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: RuntimeStatus) => callback(status)
    ipcRenderer.on('runtime:status', listener)
    return () => {
      ipcRenderer.removeListener('runtime:status', listener)
    }
  }
}

contextBridge.exposeInMainWorld('desktop', api)

export type DesktopApi = typeof api
