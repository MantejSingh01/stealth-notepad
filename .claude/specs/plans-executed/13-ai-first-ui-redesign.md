---
id: 13
title: AI-First UI Redesign
status: planned
---

## Overview

Complete UI redesign from notepad-first to AI-first layout inspired by ParakeetAI. The app gains three distinct modes with different window sizes. Notepad is demoted from the primary surface to a third-tier panel accessible via hotkey or tab. `index.html` is rewritten from scratch; `renderer.js` gains mode-switching logic and updated DOM refs.

## Three modes

| Mode | Size | Description |
|---|---|---|
| Bar mode | 400 x 52 px | Default. Thin floating bar: status dot, session timer, last AI answer preview (truncated). Click to expand. |
| AI Panel mode | 440 x 600 px | Full panel. AI answer feed (60%), transcript feed last 6 lines (25%), bottom action bar. |
| Room Panel | +280 px right slide-in | Triggered by Cmd+Shift+R. Room controls, shared notepad, screenshot viewer, member typing indicator. |

## Files to modify

- `index.html` — complete rewrite
- `renderer.js` — update DOM refs, add mode-switching logic, adapt existing functions to new element IDs
- `main.js` — add `ipcMain.handle` for new window size constants; update `WIN_BASE`, `WIN_BAR`, and add `WIN_AI_PANEL` / `WIN_WITH_ROOM`

## Key code snippets

### 1. Window size constants update (main.js)

```js
const WIN_BAR      = { width: 400,  height: 52  };
const WIN_AI_PANEL = { width: 440,  height: 600 };
const WIN_WITH_ROOM = { width: 720, height: 600 }; // AI panel + room slide-in
const WIN_BASE     = WIN_AI_PANEL; // default open size
```

### 2. IPC for mode switching (main.js)

```js
ipcMain.on('set-mode-bar', () => {
  if (!mainWindow) return;
  mainWindow.setSize(WIN_BAR.width, WIN_BAR.height);
});

ipcMain.on('set-mode-ai-panel', () => {
  if (!mainWindow) return;
  mainWindow.setSize(WIN_AI_PANEL.width, WIN_AI_PANEL.height);
});

ipcMain.on('set-mode-with-room', () => {
  if (!mainWindow) return;
  mainWindow.setSize(WIN_WITH_ROOM.width, WIN_WITH_ROOM.height);
});
```

### 3. HTML structure (index.html) — top-level skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Stealth Notepad</title>
  <style>/* see section 4 */</style>
</head>
<body>
  <!-- BAR MODE -->
  <div id="bar-mode" class="bar-mode">
    <span id="bar-status-dot" class="status-dot"></span>
    <span id="bar-timer" class="bar-timer">00:00</span>
    <span id="bar-preview" class="bar-preview">Ready</span>
    <div class="bar-controls">
      <button id="bar-expand-btn" class="bar-btn">Expand</button>
      <button id="bar-close-btn" class="bar-btn bar-btn-close">x</button>
    </div>
  </div>

  <!-- AI PANEL MODE -->
  <div id="ai-panel-mode" class="ai-panel-mode" style="display:none;">
    <div id="title-bar" class="title-bar">
      <span class="title">Stealth</span>
      <div class="title-controls">
        <span id="opacity-display" class="opacity-label">100%</span>
        <button id="collapse-to-bar-btn" class="ctrl-btn">Bar</button>
        <button id="minimize-btn" class="ctrl-btn">&#8212;</button>
        <button id="close-btn" class="ctrl-btn ctrl-close">&#x2715;</button>
      </div>
    </div>

    <!-- AI answer feed — 60% -->
    <div id="ai-feed" class="ai-feed"></div>

    <!-- Transcript feed — last 6 lines, 25% -->
    <div id="transcript-feed" class="transcript-feed"></div>

    <!-- Bottom action bar -->
    <div class="action-bar">
      <button id="transcript-btn" class="action-btn">Mic</button>
      <button id="capture-btn" class="action-btn">Screenshot</button>
      <button id="analyze-screen-btn" class="action-btn">Analyze Screen</button>
      <button id="analyze-audio-btn" class="action-btn">Analyze Audio</button>
      <button id="analyze-both-btn" class="action-btn">Analyze Both</button>
      <button id="answer-question-btn" class="action-btn">Answer</button>
      <button id="clear-ai-btn" class="action-btn action-btn-muted">Clear</button>
    </div>

    <!-- Notepad tab (tertiary, hidden by default) -->
    <div id="notepad-tab" class="notepad-tab" style="display:none;">
      <textarea id="notepad" class="notepad" placeholder="Notes..."></textarea>
    </div>

    <label id="auto-answer-label" class="auto-answer-label">
      <input type="checkbox" id="auto-answer-toggle" checked /> Auto-answer
    </label>

    <!-- Audio device row (from spec 10) -->
    <div id="audio-device-row" class="audio-device-row">
      <label for="audio-device-select" class="audio-label">Audio:</label>
      <select id="audio-device-select" class="audio-select">
        <option value="">Default microphone</option>
      </select>
    </div>
    <div id="blackhole-hint" class="blackhole-hint" style="display:none;">
      System audio not found. Install BlackHole and route audio through it.
    </div>
  </div>

  <!-- ROOM PANEL (slide-in, 280px) -->
  <div id="room-panel" class="room-panel" style="display:none;">
    <!-- Room panel content — see spec 14 -->
  </div>

  <script src="renderer.js"></script>
</body>
</html>
```

### 4. CSS (inside index.html `<style>`)

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: transparent;
  overflow: hidden;
  -webkit-app-region: drag;
  height: 100vh;
}

/* ── BAR MODE ── */
.bar-mode {
  width: 100%;
  height: 52px;
  background: rgba(10, 10, 15, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  -webkit-app-region: drag;
}
.status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #4ade80; flex-shrink: 0;
}
.bar-timer { font-size: 12px; color: rgba(255,255,255,0.5); flex-shrink: 0; }
.bar-preview {
  flex: 1; font-size: 12px; color: rgba(255,255,255,0.75);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bar-controls { display: flex; gap: 6px; -webkit-app-region: no-drag; }
.bar-btn {
  background: rgba(255,255,255,0.08); border: none; border-radius: 5px;
  color: #fff; font-size: 11px; padding: 3px 8px; cursor: pointer;
}
.bar-btn:hover { background: rgba(255,255,255,0.15); }
.bar-btn-close { background: rgba(255,90,90,0.3); }

/* ── AI PANEL MODE ── */
.ai-panel-mode {
  width: 100%; height: 100vh;
  background: rgba(10, 10, 15, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.title-bar {
  height: 32px; flex-shrink: 0;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px;
  -webkit-app-region: drag;
}
.title { font-size: 12px; color: rgba(255,255,255,0.5); }
.title-controls { display: flex; gap: 6px; align-items: center; -webkit-app-region: no-drag; }
.opacity-label { font-size: 10px; color: rgba(255,255,255,0.35); }
.ctrl-btn {
  background: rgba(255,255,255,0.07); border: none; border-radius: 4px;
  color: rgba(255,255,255,0.7); font-size: 10px; padding: 2px 6px; cursor: pointer;
}
.ctrl-close { background: rgba(255,80,80,0.25); }

.ai-feed {
  flex: 3; overflow-y: auto; padding: 8px 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.ai-bubble {
  background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3);
  border-radius: 8px; padding: 8px 10px;
  font-size: 12px; color: rgba(255,255,255,0.9); line-height: 1.5;
}
.ai-status-line { font-size: 11px; color: rgba(255,255,255,0.4); font-style: italic; padding: 2px 0; }

.transcript-feed {
  flex: 1; overflow-y: auto; padding: 4px 10px;
  border-top: 1px solid rgba(255,255,255,0.06);
  font-size: 11px; color: rgba(255,255,255,0.45);
  max-height: 25%;
}

.action-bar {
  flex-shrink: 0; display: flex; gap: 4px; padding: 6px 8px;
  border-top: 1px solid rgba(255,255,255,0.06);
  flex-wrap: wrap;
  -webkit-app-region: no-drag;
}
.action-btn {
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 5px; color: rgba(255,255,255,0.8); font-size: 10px;
  padding: 4px 8px; cursor: pointer; flex-shrink: 0;
}
.action-btn:hover { background: rgba(255,255,255,0.14); }
.action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.action-btn-muted { color: rgba(255,255,255,0.4); }

.notepad-tab {
  flex-shrink: 0; border-top: 1px solid rgba(255,255,255,0.06);
}
.notepad {
  width: 100%; height: 120px; background: transparent;
  border: none; resize: none; color: rgba(255,255,255,0.8);
  font-size: 12px; padding: 8px 10px; font-family: inherit;
  outline: none;
}

.auto-answer-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: rgba(255,255,255,0.5);
  padding: 3px 10px; cursor: pointer;
  -webkit-app-region: no-drag;
}
.audio-device-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 10px;
  -webkit-app-region: no-drag;
}
.audio-label { font-size: 11px; color: rgba(255,255,255,0.45); }
.audio-select {
  flex: 1; font-size: 11px; background: rgba(255,255,255,0.06);
  color: #fff; border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px; padding: 2px 4px;
}
.blackhole-hint { font-size: 10px; color: #facc15; padding: 3px 10px; }

/* ── ROOM PANEL ── */
.room-panel {
  position: fixed; top: 0; right: 0;
  width: 280px; height: 100vh;
  background: rgba(15, 15, 20, 0.95);
  border-left: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; padding: 12px;
  -webkit-app-region: no-drag;
}

/* ── ANIMATIONS ── */
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.thinking-dot { font-style: italic; animation: pulse 1s infinite; }
```

### 5. Mode switching in renderer.js

```js
let currentMode = 'bar'; // 'bar' | 'ai-panel'

function enterBarMode() {
  currentMode = 'bar';
  document.getElementById('bar-mode').style.display = 'flex';
  document.getElementById('ai-panel-mode').style.display = 'none';
  ipcRenderer.send('set-mode-bar');
}

function enterAiPanelMode() {
  currentMode = 'ai-panel';
  document.getElementById('bar-mode').style.display = 'none';
  document.getElementById('ai-panel-mode').style.display = 'flex';
  ipcRenderer.send('set-mode-ai-panel');
}
```

Wire bar expand button:
```js
const barExpandBtn = document.getElementById('bar-expand-btn');
if (barExpandBtn) barExpandBtn.addEventListener('click', () => enterAiPanelMode());
```

Wire collapse-to-bar button:
```js
const collapseToBarBtn = document.getElementById('collapse-to-bar-btn');
if (collapseToBarBtn) collapseToBarBtn.addEventListener('click', () => enterBarMode());
```

### 6. Bar preview update

After each AI response token (or on completion), update the bar preview text so it always shows the latest answer snippet:

```js
function updateBarPreview(text) {
  const preview = document.getElementById('bar-preview');
  if (preview) preview.textContent = text.slice(0, 60) + (text.length > 60 ? '...' : '');
}
```

Call `updateBarPreview(fullText)` at the end of `streamOpenRouter` (or after the single-shot response in non-streaming mode).

### 7. Notepad tab toggle

Add a hotkey or button to show/hide the notepad tab:
```js
ipcRenderer.on('toggle-notepad-tab', () => {
  const tab = document.getElementById('notepad-tab');
  if (tab) tab.style.display = tab.style.display === 'none' ? 'block' : 'none';
});
```

In main.js, register `CommandOrControl+Shift+T` for this IPC message.

### 8. Transcript feed max-6-lines enforcement (renderer.js)

After each `appendTranscript` call, trim the feed to the last 6 entries:
```js
function trimTranscriptFeed() {
  const feed = document.getElementById('transcript-feed');
  if (!feed) return;
  while (feed.children.length > 6) feed.removeChild(feed.firstChild);
}
```

## Hotkeys / UX

| Hotkey | Action |
|---|---|
| Cmd+Shift+N | Toggle window visibility (existing) |
| Cmd+Shift+T | Toggle notepad tab (new) |
| Cmd+Shift+R | Toggle room panel (existing, now resizes window) |
| Click bar expand | Switch to AI Panel mode |
| Click "Bar" button | Switch to Bar mode |

## Edge cases & gotchas

- On first show, the window should open in Bar mode (400x52). The user expands to AI Panel mode manually. Change `mainWindow.hide()` → the window starts hidden and shows in bar mode when toggled.
- The existing `collapse-to-bar` / `expand-from-bar` IPC handlers in `main.js` can be replaced by the new `set-mode-bar` / `set-mode-ai-panel` handlers. Remove the old ones to avoid conflicts.
- The companion panel concept (split notepad + AI side by side) is replaced by the AI Panel mode. Remove `resize-for-companion` IPC handler or keep it as an alias during transition.
- `preBarSize` tracking in main.js is no longer needed; remove it.
- All existing DOM element IDs used by `renderer.js` (`notepad`, `transcript-feed`, `ai-feed`, `analyze-screen-btn`, etc.) must be preserved verbatim in the new HTML to avoid breaking existing renderer logic.
- The room panel (`id="room-panel"`) must remain in the DOM so the existing `toggle-room-panel` IPC handler in `renderer.js` still works.
- `index.html` is a complete rewrite — do not merge, replace the whole file.

## npm dependencies

None.
