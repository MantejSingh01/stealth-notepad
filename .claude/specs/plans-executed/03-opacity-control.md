---
id: 03-opacity-control
status: executed
---

# Spec: On-the-Fly Opacity Control

## Goal
User can cycle the window opacity using a hotkey so the notepad can blend into the background.

## Hotkey
`Ctrl+Shift+O` — cycles through [0.3, 0.5, 0.7, 1.0]

## Files to modify
- `main.js` — add opacity state + hotkey + IPC send
- `renderer.js` — listen for `opacity-changed` IPC, update title
- `index.html` — add `<span id="opacity-display">` in title bar

## main.js changes
```js
// At module level
const OPACITY_LEVELS = [0.3, 0.5, 0.7, 1.0];
let opacityIndex = 3; // start at 100%

// Inside registerHotkeys()
globalShortcut.register('CommandOrControl+Shift+O', () => {
  if (!mainWindow) return;
  opacityIndex = (opacityIndex + 1) % OPACITY_LEVELS.length;
  const opacity = OPACITY_LEVELS[opacityIndex];
  mainWindow.setOpacity(opacity);
  mainWindow.webContents.send('opacity-changed', opacity);
});
```

## renderer.js changes
```js
ipcRenderer.on('opacity-changed', (_, opacity) => {
  const display = document.getElementById('opacity-display');
  if (display) display.textContent = `${Math.round(opacity * 100)}%`;
});
```

## index.html changes
Add inside `.title-bar` next to the title text:
```html
<span id="opacity-display" style="font-size:11px; color:rgba(255,255,255,0.4); margin-left:8px;">100%</span>
```

## Edge cases
- `setOpacity` is not supported on Linux with some window managers — fail silently
- No new npm packages needed
