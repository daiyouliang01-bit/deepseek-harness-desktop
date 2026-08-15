# IPC Contract — Desktop Adapter (Task 1.1)

The preload bridge (`window.desktop`) is the **only** surface the renderer may
use. It is exposed via `contextBridge.exposeInMainWorld('desktop', api)` in
`apps/desktop/electron/preload.ts` and implemented in
`apps/desktop/electron/main.ts`.

Security invariants:

- Renderer has no `require`, `process`, `fs`, or `child_process`.
- Every method is an explicit `ipcRenderer.invoke` round trip through a
  handler registered in the main process.
- All values crossing the bridge must be JSON-serializable; no live objects.

## API surface

| Method | Channel | Args → Result | Errors |
|---|---|---|---|
| `getVersion()` | `app:get-version` | `() → string` | — |
| `getPlatform()` | `app:get-platform` | `() → 'darwin' \| 'win32' \| 'linux'` | — |
| `getRuntimeStatus()` | `runtime:get-status` | `() → RuntimeStatus` | — |
| `quit()` | `app:quit` | `() → void` | — |
| `onRuntimeStatus(cb)` | `runtime:status` (event) | `cb(RuntimeStatus)` | — |

## Types

```ts
interface RuntimeStatus {
  state: 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'error'
  // extended in Task 1.2: pid, port, url, lastError, uptimeMs
}
```

## Future surface (scheduled)

| Phase | Method(s) |
|---|---|
| 1.2 | `startRuntime()`, `stopRuntime()`, `restartRuntime()`, `openLogs()` |
| 1.3 | `reloadUI()`, runtime status events with real states |
| 1.5 | tray actions, global shortcut events, notification permission |
| 2.1+ | protocol event stream (`onProtocolEvent`), command methods |

Adding a method requires: preload entry → main `ipcMain.handle` → contract row
here → typecheck. No method may be added to bypass the main process.
