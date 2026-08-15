import { contextBridge, ipcRenderer } from 'electron'

export interface RuntimeStatus {
  state: string
}

/**
 * The only surface exposed to the renderer (see docs/ipc-contract.md).
 * Every capability is a narrow, explicitly typed IPC call.
 */
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:get-platform'),
  getRuntimeStatus: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:get-status'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
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
