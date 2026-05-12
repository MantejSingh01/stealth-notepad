---
id: 01-keyboard-window-movement
status: executed
---

# Spec: Keyboard-Based Window Movement

## Goal
Allow the user to reposition the notepad window using keyboard shortcuts so they never need the mouse during a screen share.

## Hotkeys
| Shortcut | Action |
|---|---|
| Ctrl+Alt+Left | Move window 10px left |
| Ctrl+Alt+Right | Move window 10px right |
| Ctrl+Alt+Up | Move window 10px up |
| Ctrl+Alt+Down | Move window 10px down |

## Files to modify
- `main.js` — add 4 new `globalShortcut.register()` calls inside `registerHotkeys()`

## Implementation
```js
// Inside registerHotkeys() in main.js
const MOVE_STEP = 10;
const moveKeys = {
  'CommandOrControl+Alt+Left':  (x, y) => [x - MOVE_STEP, y],
  'CommandOrControl+Alt+Right': (x, y) => [x + MOVE_STEP, y],
  'CommandOrControl+Alt+Up':    (x, y) => [x, y - MOVE_STEP],
  'CommandOrControl+Alt+Down':  (x, y) => [x, y + MOVE_STEP],
};

for (const [key, fn] of Object.entries(moveKeys)) {
  globalShortcut.register(key, () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(...fn(x, y));
  });
}
```

## Edge cases
- macOS may intercept Ctrl+Alt+Arrow for Mission Control — document this in README
- No renderer change needed
- No new npm packages needed
