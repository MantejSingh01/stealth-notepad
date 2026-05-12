---
id: 14
title: Room Panel Polish
status: planned
---

## Overview

The collaboration room controls are currently an unstyled panel. This spec turns them into a polished 280px slide-in panel (the right-side panel introduced in spec 13). It shows room ID, member count, a leave button, a shared notepad textarea with real-time sync, a screenshot viewer, and a members typing indicator. Depends on spec 13 for the room panel DOM container.

## Files to modify

- `index.html` — fill in the `#room-panel` container with full room panel markup
- `renderer.js` — add member count tracking, typing indicator emit/receive, screenshot viewer display inside room panel, polish existing create/join/leave logic

## Key code snippets

### 1. Room panel HTML (inside `<div id="room-panel">`) (index.html)

```html
<div id="room-panel" class="room-panel" style="display:none;">
  <!-- Header -->
  <div class="rp-header">
    <span class="rp-title">Room</span>
    <button id="rp-close-btn" class="rp-close-btn">&#x2715;</button>
  </div>

  <!-- Room status row -->
  <div class="rp-status-row">
    <span id="rp-status-dot" class="rp-dot rp-dot-off"></span>
    <span id="rp-room-id" class="rp-room-id">Not in a room</span>
    <span id="rp-member-count" class="rp-member-count"></span>
  </div>

  <!-- Create / Join -->
  <div id="rp-join-area" class="rp-join-area">
    <button id="create-room-btn" class="rp-btn rp-btn-primary">Create Room</button>
    <div class="rp-join-row">
      <input id="join-input" class="rp-input" placeholder="Room ID" maxlength="8" />
      <button id="join-room-btn" class="rp-btn">Join</button>
    </div>
  </div>

  <!-- Leave (shown when in room) -->
  <button id="leave-room-btn" class="rp-btn rp-btn-danger" style="display:none;">Leave Room</button>

  <!-- Shared notepad -->
  <div class="rp-section-label">Shared Notes</div>
  <textarea id="shared-notepad" class="rp-notepad" placeholder="Type notes here — synced with room..."></textarea>

  <!-- Typing indicator -->
  <div id="rp-typing-indicator" class="rp-typing" style="display:none;">
    <span class="rp-typing-dots">...</span> Someone is typing
  </div>

  <!-- Screenshot viewer -->
  <div class="rp-section-label">Last Screenshot</div>
  <div id="rp-screenshot-area" class="rp-screenshot-area">
    <span id="rp-screenshot-ph" class="rp-screenshot-ph">No screenshot yet</span>
    <img id="rp-screenshot-img" class="rp-screenshot-img" style="display:none;" alt="shared screenshot" />
  </div>

  <!-- Room controls -->
  <button id="capture-btn" class="rp-btn rp-btn-secondary" disabled>Share Screenshot</button>
  <button id="transcript-btn" class="rp-btn rp-btn-secondary" style="display:none;" disabled>Share Transcript</button>
</div>
```

### 2. CSS additions for room panel (index.html `<style>`)

```css
.room-panel {
  position: fixed; top: 0; right: 0;
  width: 280px; height: 100vh;
  background: rgba(12, 12, 18, 0.97);
  border-left: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px;
  overflow-y: auto;
  -webkit-app-region: no-drag;
  z-index: 100;
}
.rp-header {
  display: flex; justify-content: space-between; align-items: center;
  flex-shrink: 0;
}
.rp-title { font-size: 13px; color: rgba(255,255,255,0.7); font-weight: 600; }
.rp-close-btn {
  background: none; border: none; color: rgba(255,255,255,0.4);
  font-size: 13px; cursor: pointer; padding: 2px 4px;
}
.rp-close-btn:hover { color: rgba(255,255,255,0.8); }

.rp-status-row { display: flex; align-items: center; gap: 6px; }
.rp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.rp-dot-off { background: #ef4444; }
.rp-dot-on { background: #4ade80; }
.rp-room-id { font-size: 12px; color: rgba(255,255,255,0.75); font-weight: 500; flex: 1; }
.rp-member-count { font-size: 11px; color: rgba(255,255,255,0.35); }

.rp-join-area { display: flex; flex-direction: column; gap: 6px; }
.rp-join-row { display: flex; gap: 4px; }
.rp-input {
  flex: 1; background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px; color: #fff; font-size: 12px;
  padding: 5px 8px; outline: none; font-family: inherit;
}
.rp-btn {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 5px; color: rgba(255,255,255,0.8); font-size: 11px;
  padding: 5px 10px; cursor: pointer; white-space: nowrap;
}
.rp-btn:hover { background: rgba(255,255,255,0.15); }
.rp-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.rp-btn-primary { background: rgba(99,102,241,0.3); border-color: rgba(99,102,241,0.5); }
.rp-btn-primary:hover { background: rgba(99,102,241,0.45); }
.rp-btn-danger { background: rgba(239,68,68,0.2); border-color: rgba(239,68,68,0.4); }
.rp-btn-danger:hover { background: rgba(239,68,68,0.35); }
.rp-btn-secondary { background: rgba(255,255,255,0.05); }

.rp-section-label {
  font-size: 10px; color: rgba(255,255,255,0.3);
  text-transform: uppercase; letter-spacing: 0.06em;
  margin-top: 4px;
}
.rp-notepad {
  width: 100%; height: 100px; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
  color: rgba(255,255,255,0.85); font-size: 12px; font-family: inherit;
  padding: 6px 8px; resize: none; outline: none;
}
.rp-typing {
  font-size: 11px; color: rgba(255,255,255,0.35); font-style: italic;
}
.rp-typing-dots { animation: pulse 1s infinite; }

.rp-screenshot-area {
  width: 100%; min-height: 60px; background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.rp-screenshot-ph { font-size: 11px; color: rgba(255,255,255,0.25); }
.rp-screenshot-img { width: 100%; height: auto; display: block; }
```

### 3. Member count tracking (renderer.js)

Add socket event listeners for member count. The server emits `room-members` with a count when a member joins or leaves:

```js
s.on('room-members', (/** @type {{ count: number }} */ data) => {
  const el = document.getElementById('rp-member-count');
  if (el) el.textContent = `${data.count} member${data.count !== 1 ? 's' : ''}`;
});
```

### 4. Typing indicator (renderer.js)

Emit typing events from shared notepad input; receive and display them:

```js
let typingTimeout = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

const sharedNotepad = /** @type {HTMLTextAreaElement} */ (
  document.getElementById('shared-notepad')
);
if (sharedNotepad) {
  sharedNotepad.addEventListener('input', () => {
    // Sync text to room
    if (socket && inRoom) socket.emit('text-update', sharedNotepad.value);

    // Emit typing event
    if (socket && inRoom) socket.emit('typing', { senderId: socket.id });

    // Stop emitting after 1.5s of no input
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      if (socket && inRoom) socket.emit('stop-typing', { senderId: socket.id });
    }, 1500);
  });
}
```

Receive typing from other members:
```js
s.on('typing', (/** @type {{ senderId: string }} */ data) => {
  if (data.senderId === s.id) return;
  const indicator = document.getElementById('rp-typing-indicator');
  if (indicator) indicator.style.display = 'block';
});

s.on('stop-typing', (/** @type {{ senderId: string }} */ data) => {
  if (data.senderId === s.id) return;
  const indicator = document.getElementById('rp-typing-indicator');
  if (indicator) indicator.style.display = 'none';
});
```

Note: if the server does not yet handle `typing` / `stop-typing` events, they will be silently ignored. The server-side changes (broadcast `typing`/`stop-typing` to the room) are a companion task.

### 5. Room panel screenshot viewer (renderer.js)

Update `showScreenshot` to also update the room panel screenshot viewer:

```js
function showScreenshot(dataUrl) {
  lastScreenshotDataUrl = dataUrl;

  // Existing companion panel screenshot
  if (screenshotImg) {
    screenshotImg.src = dataUrl;
    screenshotImg.style.display = 'block';
  }
  if (screenshotPH) screenshotPH.style.display = 'none';

  // Room panel screenshot viewer
  const rpImg = /** @type {HTMLImageElement} */ (document.getElementById('rp-screenshot-img'));
  const rpPh  = document.getElementById('rp-screenshot-ph');
  if (rpImg) { rpImg.src = dataUrl; rpImg.style.display = 'block'; }
  if (rpPh)  rpPh.style.display = 'none';
}
```

### 6. Room panel open/close — resize window (renderer.js)

Update the `toggle-room-panel` IPC receiver to also send the resize signal:

```js
ipcRenderer.on('toggle-room-panel', () => {
  const panel = document.getElementById('room-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'flex';
  ipcRenderer.send(isOpen ? 'set-mode-ai-panel' : 'set-mode-with-room');
});
```

### 7. Room join/leave UI state (renderer.js)

On join or create:
```js
function onJoinedRoom(roomId) {
  inRoom = true;
  const dot = document.getElementById('rp-status-dot');
  const idEl = document.getElementById('rp-room-id');
  const joinArea = document.getElementById('rp-join-area');
  const leaveBtn = document.getElementById('leave-room-btn');
  if (dot) { dot.className = 'rp-dot rp-dot-on'; }
  if (idEl) idEl.textContent = roomId;
  if (joinArea) joinArea.style.display = 'none';
  if (leaveBtn) leaveBtn.style.display = 'block';
  updateCompanionStatus(roomId);
}
```

On leave:
```js
function onLeftRoom() {
  inRoom = false;
  const dot = document.getElementById('rp-status-dot');
  const idEl = document.getElementById('rp-room-id');
  const joinArea = document.getElementById('rp-join-area');
  const leaveBtn = document.getElementById('leave-room-btn');
  if (dot) { dot.className = 'rp-dot rp-dot-off'; }
  if (idEl) idEl.textContent = 'Not in a room';
  if (joinArea) joinArea.style.display = 'flex';
  if (leaveBtn) leaveBtn.style.display = 'none';
  updateCompanionStatus(null);
}
```

Replace direct inline DOM manipulation in create/join/leave button handlers with calls to `onJoinedRoom` / `onLeftRoom`.

### 8. Room panel close button (renderer.js)

```js
const rpCloseBtn = document.getElementById('rp-close-btn');
if (rpCloseBtn) {
  rpCloseBtn.addEventListener('click', () => {
    const panel = document.getElementById('room-panel');
    if (panel) panel.style.display = 'none';
    ipcRenderer.send('set-mode-ai-panel');
  });
}
```

## Hotkeys / UX

| Hotkey / Action | Behaviour |
|---|---|
| Cmd+Shift+R | Toggle room panel (existing, now also resizes window) |
| X button in room panel | Close room panel, resize to AI Panel mode |

## Edge cases & gotchas

- The `typing` / `stop-typing` socket events require server support. If the server does not broadcast them, the typing indicator will never appear. This is safe — no errors, just no indicator.
- The shared notepad (`#shared-notepad`) is separate from the main notepad (`#notepad`). The `text-update` socket event should be routed to `shared-notepad` in the room panel, not the main notepad, to avoid overwriting the user's private notes. Review the existing `s.on('text-update')` handler and update it accordingly.
- `room-members` event may not exist on the current server. If it does not, the member count label will simply remain empty. Server-side broadcasting is a companion task.
- The `leave-room-btn` element ID is reused from the existing HTML. If spec 13 removed it from the old location, it now lives only in the room panel. Verify only one element with this ID exists.
- Screenshot viewer dimensions: `rp-screenshot-img` uses `width: 100%` so screenshots scale to fit the 280px panel width.
- When the room panel opens while the window is in Bar mode, force-expand to AI Panel mode first, then show the room panel.

## npm dependencies

None.
