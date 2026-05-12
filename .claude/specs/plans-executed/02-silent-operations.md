---
id: 02-silent-operations
status: executed
---

# Spec: Silent Operations — No Confirm() Popups

## Goal
All buttons and shortcuts must operate silently. The current `confirm()` dialogs are visible during screen sharing and break stealth.

## Files to modify
- `renderer.js` — remove 2 `confirm()` wrappers

## Changes

### Close button (renderer.js)
```js
// BEFORE
closeBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to close Stealth Notepad?')) {
    ipcRenderer.send('close');
  }
});

// AFTER
closeBtn.addEventListener('click', () => {
  ipcRenderer.send('close');
});
```

### Clear shortcut (renderer.js)
```js
// BEFORE
ipcRenderer.on('clear-text', () => {
  if (confirm('Clear all text?')) {
    notepad.value = '';
    localStorage.removeItem('notepad-content');
    showNotification('Text cleared');
  }
});

// AFTER
ipcRenderer.on('clear-text', () => {
  notepad.value = '';
  localStorage.removeItem('notepad-content');
  showNotification('Text cleared');
});
```

## Edge cases
- No undo after clear — acceptable, this is a stealth notepad
- No new npm packages needed
