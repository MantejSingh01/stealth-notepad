---
id: 06-process-stealth
status: executed
---

# Feature: Hide App from Running Apps List

## Goal
The app must not appear in the macOS Dock, macOS Cmd+Tab switcher, or Windows taskbar when running.

## What is achievable
- **macOS Dock** — hide via `app.dock.hide()` → also removes from Cmd+Tab switcher
- **Windows taskbar** — already handled by `skipTaskbar: true` and `type: 'toolbar'` on the BrowserWindow

## Known limitation
Cannot hide from macOS Activity Monitor or Windows Task Manager — these show all OS-level processes and cannot be bypassed by any Electron/Node.js API.

## Files to change
- `main.js` — add `if (app.dock) app.dock.hide()` inside `app.whenReady().then(...)`, before `createWindow()`

## Implementation
```js
app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // macOS: hide from Dock + Cmd+Tab
  createWindow();
});
```

## Notes
- `app.dock` is undefined on Windows/Linux so the guard `if (app.dock)` makes it cross-platform safe
- `skipTaskbar: true` on the BrowserWindow already prevents the window button from appearing in Windows taskbar
- The app process will still be visible in Activity Monitor / Task Manager — this is an OS-level constraint
