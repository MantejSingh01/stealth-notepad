---
id: 05-companion-window
status: executed
---

# Spec: Companion Window with Screen Share + Audio Transcription

## Goal
Open a second Electron BrowserWindow alongside the notepad that gives room members two shared feeds: a live screenshot panel and a live audio transcript panel. Everything is broadcast over the existing socket.io infrastructure — no new server is required beyond adding two events.

## Overview
The companion window is a separate `BrowserWindow` (`companion.html` / `companion.js`). It shares the same room ID as the notepad so screenshots and transcripts sent by one user appear for all room members instantly. The notepad window itself is unchanged except for a new IPC trigger to open/close the companion window.

---

## Files to modify
| File | Change |
|---|---|
| `main.js` | Add `companionWindow` variable, `createCompanionWindow()`, IPC handlers, and a new `Ctrl+Shift+P` hotkey |
| `server.js` | Add `screenshot-share` and `transcript-update` socket events |
| `renderer.js` | Expose current `roomId` and `socket` instance to IPC so companion can reuse the same room |
| `index.html` | Add "Companion" button in the room panel that sends `open-companion` IPC |

## New files to create
| File | Purpose |
|---|---|
| `companion.html` | Companion window UI — two panels: screenshot viewer (top) and transcript feed (bottom) |
| `companion.js` | Companion window renderer — desktopCapturer, nodejs-whisper, socket.io-client wiring |

---

## Detailed implementation

### 1. server.js — new socket events

Add inside the `io.on('connection', ...)` block, after the existing `text-update` handler:

```js
socket.on('screenshot-share', (dataUrl) => {
  if (currentRoom) socket.to(currentRoom).emit('screenshot-share', dataUrl);
});

socket.on('transcript-update', (text) => {
  if (currentRoom) socket.to(currentRoom).emit('transcript-update', text);
});
```

No other server changes. The server already tracks `currentRoom` per socket so the broadcast scope is correct.

---

### 2. main.js — companion window

Add at the top of the file alongside `mainWindow`:

```js
let companionWindow = null;
```

Add a new function `createCompanionWindow()`:

```js
function createCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.focus();
    return;
  }

  // Position companion to the right of the main window
  const [mx, my] = mainWindow ? mainWindow.getPosition() : [100, 100];
  const [mw]     = mainWindow ? mainWindow.getSize()     : [600, 400];

  companionWindow = new BrowserWindow({
    width: 480,
    height: 600,
    x: mx + mw + 10,
    y: my,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
    ...(process.platform === 'darwin' && {
      visualEffectState: 'active',
      vibrancy: 'under-window',
    }),
  });

  if (process.platform === 'darwin') {
    companionWindow.setContentProtection(true);
  }

  companionWindow.loadFile('companion.html');

  companionWindow.on('closed', () => {
    companionWindow = null;
  });
}
```

Add IPC handlers (place alongside existing `ipcMain.on` calls):

```js
ipcMain.on('open-companion', () => {
  createCompanionWindow();
});

ipcMain.on('close-companion', () => {
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close();
});

// Relay room context from notepad renderer to companion renderer
ipcMain.on('room-context', (_, ctx) => {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send('room-context', ctx);
  }
});

// Relay screenshot-trigger hotkey to companion renderer
ipcMain.on('trigger-screenshot', () => {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send('trigger-screenshot');
  }
});
```

Add a new hotkey inside `registerHotkeys()`:

```js
// Ctrl+Shift+P — Open/close companion window
globalShortcut.register('CommandOrControl+Shift+P', () => {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.close();
  } else if (mainWindow) {
    createCompanionWindow();
  }
});

// Ctrl+Shift+I — Capture screenshot (relayed to companion)
globalShortcut.register('CommandOrControl+Shift+I', () => {
  ipcMain.emit('trigger-screenshot');
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send('trigger-screenshot');
  }
});
```

---

### 3. renderer.js — expose room context to companion

After the socket joins a room successfully (in both `create-room` and `join-room` callbacks), send the room context to main so it can relay it to the companion window:

```js
// Helper — call this whenever inRoom state or roomId changes
function broadcastRoomContext(roomId) {
  const serverUrl = process.env.COLLAB_SERVER_URL || 'https://stealthnotepad-production.up.railway.app';
  ipcRenderer.send('room-context', { roomId, serverUrl });
}
```

Call `broadcastRoomContext(res.roomId)` at the end of the `create-room` success branch, and `broadcastRoomContext(id)` at the end of the `join-room` success branch.

Also call `ipcRenderer.send('room-context', { roomId: null, serverUrl: null })` in the leave-room handler so the companion knows the room was left.

---

### 4. index.html — Companion button in room panel

Add a fifth button to the existing `.room-panel` button row:

```html
<button id="companion-btn" style="flex:1; padding:4px 8px; font-size:11px; background:rgba(167,139,250,0.2); color:#a78bfa; border:1px solid #a78bfa; border-radius:4px; cursor:pointer;">Companion</button>
```

Wire it in `renderer.js`:

```js
const companionBtn = document.getElementById('companion-btn');
if (companionBtn) {
  companionBtn.addEventListener('click', () => {
    ipcRenderer.send('open-companion');
  });
}
```

---

### 5. companion.html — UI layout

Full standalone HTML file. Two-panel vertical layout:
- Top half: screenshot viewer (`<img id="screenshot-view">`) with a "Capture Screenshot" button and a timestamp label
- Bottom half: transcript feed (`<div id="transcript-feed">`) with a "Start / Stop" toggle button and a status indicator

Key style decisions matching the existing app:
- `background: rgba(0,0,0,0.85)`, `backdrop-filter: blur(10px)`, `border-radius: 12px`
- `frame: false` + `-webkit-app-region: drag` on title bar
- Same monospace font, same colour palette (`#4ade80`, `#60a5fa`, `#a78bfa`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Companion</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:transparent; overflow:hidden; -webkit-app-region:drag; }
    .container { width:100%; height:100vh; display:flex; flex-direction:column; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.1); border-radius:12px; overflow:hidden; }
    .title-bar { height:35px; background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:space-between; padding:0 15px; -webkit-app-region:drag; }
    .title { font-size:13px; color:rgba(255,255,255,0.7); font-weight:500; }
    .controls { display:flex; gap:8px; -webkit-app-region:no-drag; }
    .control-btn { width:12px; height:12px; border-radius:50%; cursor:pointer; transition:opacity 0.2s; }
    .control-btn:hover { opacity:0.7; }
    .close-btn { background:#ff5f57; }
    .panel { flex:1; display:flex; flex-direction:column; overflow:hidden; border-bottom:1px solid rgba(255,255,255,0.08); }
    .panel-header { padding:6px 12px; font-size:11px; color:rgba(255,255,255,0.5); background:rgba(255,255,255,0.03); display:flex; align-items:center; justify-content:space-between; -webkit-app-region:no-drag; }
    .panel-body { flex:1; overflow:hidden; display:flex; align-items:center; justify-content:center; -webkit-app-region:no-drag; }
    #screenshot-view { max-width:100%; max-height:100%; object-fit:contain; display:none; }
    .placeholder { color:rgba(255,255,255,0.2); font-size:12px; }
    #transcript-feed { flex:1; overflow-y:auto; padding:10px 12px; font-size:12px; color:rgba(255,255,255,0.8); font-family:'Consolas','Monaco','Courier New',monospace; line-height:1.6; white-space:pre-wrap; }
    .action-btn { padding:3px 10px; font-size:11px; border-radius:4px; border:1px solid; cursor:pointer; background:transparent; }
    .btn-screenshot { color:#60a5fa; border-color:#60a5fa; }
    .btn-transcript { color:#4ade80; border-color:#4ade80; }
    .btn-transcript.active { color:#ef4444; border-color:#ef4444; }
    #transcript-feed::-webkit-scrollbar { width:6px; }
    #transcript-feed::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.2); border-radius:3px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="title-bar">
      <span class="title">Companion</span>
      <div class="controls">
        <div class="control-btn close-btn" id="close-btn"></div>
      </div>
    </div>

    <!-- Screenshot panel -->
    <div class="panel" style="flex:1.2;">
      <div class="panel-header">
        <span>Screen Share</span>
        <span id="screenshot-ts" style="color:rgba(255,255,255,0.3);"></span>
        <button class="action-btn btn-screenshot" id="capture-btn">Capture</button>
      </div>
      <div class="panel-body">
        <img id="screenshot-view" alt="screenshot" />
        <span class="placeholder" id="screenshot-placeholder">No screenshot yet</span>
      </div>
    </div>

    <!-- Transcript panel -->
    <div class="panel" style="flex:1; border-bottom:none;">
      <div class="panel-header">
        <span>Transcript</span>
        <span id="transcript-status" style="color:rgba(255,255,255,0.3);">idle</span>
        <button class="action-btn btn-transcript" id="transcript-toggle">Start</button>
      </div>
      <div class="panel-body" style="align-items:flex-start; justify-content:flex-start;">
        <div id="transcript-feed"></div>
      </div>
    </div>
  </div>
  <script src="companion.js"></script>
</body>
</html>
```

---

### 6. companion.js — full renderer logic

```js
const { ipcRenderer, desktopCapturer } = require('electron');
const { io: ioConnect } = require('socket.io-client');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── DOM refs ──────────────────────────────────────────────────────────────────
const closeBtn           = document.getElementById('close-btn');
const captureBtn         = document.getElementById('capture-btn');
const screenshotView     = document.getElementById('screenshot-view');
const screenshotTs       = document.getElementById('screenshot-ts');
const screenshotPlaceholder = document.getElementById('screenshot-placeholder');
const transcriptToggle   = document.getElementById('transcript-toggle');
const transcriptStatus   = document.getElementById('transcript-status');
const transcriptFeed     = document.getElementById('transcript-feed');

// ── State ─────────────────────────────────────────────────────────────────────
let socket        = null;
let currentRoom   = null;
let transcribing  = false;
let mediaRecorder = null;
let whisperProc   = null;

// ── Window close ──────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => ipcRenderer.send('close-companion'));

// ── Room context (relayed from notepad renderer via main.js) ──────────────────
ipcRenderer.on('room-context', (_, ctx) => {
  if (!ctx || !ctx.roomId) {
    disconnectSocket();
    return;
  }
  if (currentRoom === ctx.roomId) return; // already connected to this room
  connectSocket(ctx.serverUrl, ctx.roomId);
});

function connectSocket(serverUrl, roomId) {
  disconnectSocket();
  const s = ioConnect(serverUrl);
  s.on('connect', () => {
    s.emit('join-room', roomId, (res) => {
      if (res && res.ok) {
        currentRoom = roomId;
      }
    });
  });
  s.on('screenshot-share', (dataUrl) => {
    displayScreenshot(dataUrl);
  });
  s.on('transcript-update', (text) => {
    appendTranscript(text);
  });
  socket = s;
}

function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentRoom = null;
}

// ── Screenshot capture ────────────────────────────────────────────────────────
async function captureScreenshot() {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 800 } });
  if (!sources.length) return;
  const dataUrl = sources[0].thumbnail.toDataURL();
  displayScreenshot(dataUrl);
  if (socket && currentRoom) {
    socket.emit('screenshot-share', dataUrl);
  }
}

function displayScreenshot(dataUrl) {
  screenshotView.src = dataUrl;
  screenshotView.style.display = 'block';
  screenshotPlaceholder.style.display = 'none';
  const now = new Date();
  screenshotTs.textContent = now.toLocaleTimeString();
}

captureBtn.addEventListener('click', captureScreenshot);

// Hotkey relay from main process (Ctrl+Shift+I)
ipcRenderer.on('trigger-screenshot', () => captureScreenshot());

// ── Audio transcription via nodejs-whisper ────────────────────────────────────
// nodejs-whisper wraps the whisper.cpp binary.
// We record audio in 10-second chunks, write each chunk to a temp WAV file,
// transcribe it with the `tiny` model, then broadcast the result.

async function startTranscription() {
  if (transcribing) return;
  transcribing = true;
  transcriptToggle.textContent = 'Stop';
  transcriptToggle.classList.add('active');
  transcriptStatus.textContent = 'recording';

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  scheduleChunk(stream);
}

function scheduleChunk(stream) {
  if (!transcribing) return;

  const chunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    transcriptStatus.textContent = 'transcribing';
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const tmpPath = path.join(os.tmpdir(), `companion-audio-${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));

    try {
      const { nodewhisper } = require('nodejs-whisper');
      // nodewhisper returns an array of segment objects: [{ start, end, text }, ...]
      const result = await nodewhisper(tmpPath, {
        modelName: 'tiny.en',
        autoDownloadModelName: 'tiny.en',
        verbose: false,
        whisperOptions: { outputInText: true },
      });
      const text = result.map((s) => s.text.trim()).filter(Boolean).join(' ');
      if (text) {
        appendTranscript(text);
        if (socket && currentRoom) {
          socket.emit('transcript-update', text);
        }
      }
    } catch (err) {
      appendTranscript(`[transcription error: ${err.message}]`);
    } finally {
      fs.unlink(tmpPath, () => {});
      transcriptStatus.textContent = transcribing ? 'recording' : 'idle';
      if (transcribing) scheduleChunk(stream);
    }
  };

  // Record for 10 seconds then stop to trigger transcription
  mediaRecorder.start();
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  }, 10000);
}

function stopTranscription() {
  transcribing = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  mediaRecorder = null;
  transcriptToggle.textContent = 'Start';
  transcriptToggle.classList.remove('active');
  transcriptStatus.textContent = 'idle';
}

transcriptToggle.addEventListener('click', () => {
  if (transcribing) {
    stopTranscription();
  } else {
    startTranscription().catch((err) => {
      appendTranscript(`[mic error: ${err.message}]`);
      stopTranscription();
    });
  }
});

function appendTranscript(text) {
  const ts = new Date().toLocaleTimeString();
  transcriptFeed.textContent += `[${ts}] ${text}\n`;
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}
```

---

## Hotkeys / UX

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Open / close companion window (toggle) |
| `Ctrl+Shift+I` | Capture screenshot immediately (works even when companion is not focused) |
| Button in companion | "Capture" — same as hotkey |
| Button in companion | "Start / Stop" — toggle audio transcription |
| Button in notepad room panel | "Companion" — alias for open-companion IPC |

The companion window respects the same `setContentProtection(true)` call on macOS so it is also stealth from screen recorders.

---

## Edge cases & gotchas

1. **Screenshot data URL size** — a 1280x800 PNG data URL is ~800 KB. For large rooms (3+ users) this may be heavy. Mitigate by reducing `thumbnailSize` to 960x600 or compressing to JPEG via `thumbnail.toJPEG(70)` instead of `toDataURL()` (which is PNG).

2. **nodejs-whisper first-run model download** — the `tiny.en` model (~75 MB) is downloaded on first use via `autoDownloadModelName`. This can take 30–60 s on a slow connection. Show a loading indicator or pre-download during app startup.

3. **Audio format compatibility** — `MediaRecorder` in Electron produces `audio/webm;codecs=opus`. Whisper.cpp expects WAV (16 kHz mono). `nodejs-whisper` handles the conversion internally via ffmpeg. Confirm ffmpeg is available on the PATH or bundled with the app.

4. **macOS microphone permission** — Electron requires `NSMicrophoneUsageDescription` in `Info.plist` when packaged. Add it to `electron-builder` config. Also call `systemPreferences.askForMediaAccess('microphone')` in `main.js` before opening the companion window on macOS.

5. **Companion opened before joining a room** — the companion window should handle `currentRoom === null` gracefully: show a "Join a room first" message in both panels rather than throwing errors.

6. **Companion opened before joining a room** — if the user opens the companion before joining a room in the notepad, the `room-context` IPC will never fire. Add a fallback: on `DOMContentLoaded` in companion.js, check via `ipcRenderer.invoke('get-room-context')` (add a corresponding `ipcMain.handle` that returns the last known context from `renderer.js`).

7. **Window positioning** — if the main window is near the right edge of the screen, the companion will be placed offscreen. Clamp `x` to `screen.width - 490` using Electron's `screen` module in `createCompanionWindow()`.

8. **Transcript chunk overlap** — 10-second chunks may split words at boundaries. This is acceptable for a live-feed use case but worth documenting.

9. **Multiple monitors** — `desktopCapturer.getSources` returns one source per display. The current spec captures `sources[0]` (primary display). Consider letting the user pick from a list when multiple sources are present.

10. **socket.io `join-room` in companion** — the companion calls `join-room` independently of the notepad. The server's `rooms` map will include two sockets for the same user. This is harmless; both receive broadcasts. If this causes duplicate transcript/screenshot delivery, the server-side `join-room` handler should be aware that a single physical user may have two sockets.

---

## npm dependencies

```
npm install nodejs-whisper
```

`nodejs-whisper` pulls in `whisper.cpp` binaries for the host platform. No other new runtime dependencies. `socket.io-client`, `desktopCapturer`, `MediaRecorder`, and `fs`/`os`/`path` are already available.

Build note: `nodejs-whisper` is a native addon — ensure `electron-rebuild` is run after `npm install` for the correct Electron ABI:

```
npx electron-rebuild -f -w nodejs-whisper
```

---

## Implementation steps (ordered)

1. Add `screenshot-share` and `transcript-update` handlers to `server.js`
2. Create `companion.html` with the two-panel layout
3. Create `companion.js` with screenshot, socket, and whisper logic
4. Add `createCompanionWindow()` and new IPC handlers to `main.js`
5. Register `Ctrl+Shift+P` and `Ctrl+Shift+I` hotkeys in `registerHotkeys()`
6. Add `broadcastRoomContext()` calls to `renderer.js` join/leave handlers
7. Add "Companion" button to `index.html` room panel
8. Run `npm install nodejs-whisper` and `npx electron-rebuild -f -w nodejs-whisper`
9. Test: open companion, join room on two machines, verify screenshot broadcast and transcript feed

---

## Implementation note (post-execution change)

The companion panel was **not** implemented as a separate `BrowserWindow` as originally specced. Instead it was built as an **inline panel rendered inside the main notepad `BrowserWindow`** (a DOM overlay toggled within `index.html` / `renderer.js`).

Consequences of this change:

- `setContentProtection(true)` is already set on the main window, so the companion panel inherits stealth screen-capture protection automatically. No separate `companionWindow.setContentProtection(true)` call is required.
- `createCompanionWindow()`, the `companionWindow` variable, and the IPC relay handlers (`open-companion`, `close-companion`, `room-context` relay, `trigger-screenshot` relay) described above were not added to `main.js`.
- The `Ctrl+Shift+P` hotkey still toggles the companion, but it now sends an IPC message that the renderer handles by showing/hiding the inline panel rather than creating a new `BrowserWindow`.
- `companion.html` and `companion.js` were not created as standalone files; their equivalent logic lives inside `index.html` and `renderer.js`.
- All socket, screenshot, and transcript wiring described above is still accurate — only the window-boundary approach changed.
