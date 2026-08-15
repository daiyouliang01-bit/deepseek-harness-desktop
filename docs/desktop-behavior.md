# Desktop Behavior — DeepSeek Harness Desktop

> Task 1.5 deliverable. Documents tray, global shortcut, notifications, and
> window lifecycle.

## System tray

- Icon: 16×16 gradient icon (`electron/tray-icon.ts`, generated PNG).
- Click tray icon: toggle window visibility.
- Context menu (rebuilt live on every runtime state change):
  - Show / Hide Window
  - Runtime: `<state>` (read-only indicator)
  - Start Runtime / Stop Runtime (depends on state)
  - Open Logs
  - Quit DeepSeek Harness Desktop

## Global shortcut

- Default: **Cmd+Shift+Space** (CommandOrControl+Shift+Space) — summons /
  hides the window.
- If the accelerator is taken by another app, registration fails gracefully
  (warning logged; the app keeps working).

## Notifications

- First `ready`: "Runtime ready at <url>" (once per app run; re-ready after
  restart does not re-notify).
- `error`: "Runtime error" + the failure message.
- `stopped`: "Runtime stopped".
- Silently disabled when the OS doesn't support notifications.

## Window lifecycle

- **Close = hide to tray.** The window closes visually but the app (and the
  Harness runtime) keep running — ChatGPT/Claude-style residency.
- Quit happens only via: tray menu Quit, app menu Cmd/Ctrl+Q, or the UI Quit
  button (which invokes the same path).
- On quit: global shortcut unregistered, child process tree killed (SIGTERM →
  SIGKILL escalation / taskkill on Windows), logs flushed.
- Single-instance: launching a second copy focuses the existing window.

## Official UI ↔ Custom Shell switching

- App menu **View → Custom Shell (preview)**: loads the bundled shell
  renderer and switches it to the custom ChatGPT/Claude-style shell (Task
  3.1–3.5 views).
- App menu **View → Official Web UI**: loads the validated loopback URL of
  the runtime (no-op with an error if the runtime isn't ready).
- The custom shell's Settings panel also has "Open official UI".
- Custom shell stays on screen even when the runtime is ready (it does not
  get replaced automatically once explicitly opened).
