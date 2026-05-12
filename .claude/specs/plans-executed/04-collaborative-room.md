---
id: 04-collaborative-room
status: executed
---

# Spec: Collaborative Room with Shared ID

## Goal
Two users on different machines can share a 6-char room ID and type together in real-time. No account needed.

## Architecture
- `server.js` — standalone Socket.IO server (Node.js, ~90 lines)
- Renderer connects directly via `socket.io-client`
- `main.js` spawns `server.js` as a child process on startup; kills it on quit
- Sync: on every `input` event, broadcast full textarea value to all room members (last-write-wins, fine for 2 users)

## New file: server.js
```js
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 4444;
const rooms = new Map(); // roomId -> Set of socket IDs

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });

function makeId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('create-room', (cb) => {
    const id = makeId();
    rooms.set(id, new Set([socket.id]));
    socket.join(id);
    currentRoom = id;
    cb({ ok: true, roomId: id });
  });

  socket.on('join-room', (roomId, cb) => {
    if (!rooms.has(roomId)) return cb({ ok: false, error: 'Room not found' });
    rooms.get(roomId).add(socket.id);
    socket.join(roomId);
    currentRoom = roomId;
    cb({ ok: true });
  });

  socket.on('text-update', (text) => {
    if (currentRoom) socket.to(currentRoom).emit('text-update', text);
  });

  socket.on('leave-room', () => {
    if (currentRoom) {
      rooms.get(currentRoom)?.delete(socket.id);
      socket.leave(currentRoom);
      currentRoom = null;
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) rooms.get(currentRoom)?.delete(socket.id);
  });
});

httpServer.listen(PORT, () => console.log(`Room server on :${PORT}`));
```

## main.js changes
```js
const { spawn } = require('child_process');
let serverProcess = null;

// In createWindow(), after registerHotkeys():
const serverPath = path.join(__dirname, 'server.js');
serverProcess = spawn(process.execPath, [serverPath], { stdio: 'inherit' });

// In app 'will-quit' handler:
if (serverProcess) serverProcess.kill();

// New hotkey inside registerHotkeys():
globalShortcut.register('CommandOrControl+Shift+R', () => {
  if (mainWindow) mainWindow.webContents.send('toggle-room-panel');
});
```

## renderer.js changes
```js
const io = require('socket.io-client');
let socket = null;
let inRoom = false;

function connectSocket() {
  if (socket) return;
  socket = io('http://localhost:4444');
  socket.on('text-update', (text) => {
    notepad.value = text;
    localStorage.setItem('notepad-content', text);
  });
}

// Update notepad input handler to also broadcast:
notepad.addEventListener('input', () => {
  localStorage.setItem('notepad-content', notepad.value);
  if (socket && inRoom) socket.emit('text-update', notepad.value);
});

document.getElementById('create-room-btn').addEventListener('click', () => {
  connectSocket();
  socket.emit('create-room', ({ ok, roomId }) => {
    if (ok) {
      inRoom = true;
      document.getElementById('room-id-display').textContent = roomId;
      document.getElementById('room-status').style.background = '#4ade80';
    }
  });
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const id = document.getElementById('join-input').value.trim().toUpperCase();
  if (!id) return;
  connectSocket();
  socket.emit('join-room', id, ({ ok, error }) => {
    if (ok) {
      inRoom = true;
      document.getElementById('room-id-display').textContent = id;
      document.getElementById('room-status').style.background = '#4ade80';
    } else {
      showNotification(`Room not found: ${id}`);
    }
  });
});

document.getElementById('leave-room-btn').addEventListener('click', () => {
  if (socket) socket.emit('leave-room');
  inRoom = false;
  document.getElementById('room-id-display').textContent = '—';
  document.getElementById('room-status').style.background = '#ef4444';
});

ipcRenderer.on('toggle-room-panel', () => {
  const panel = document.getElementById('room-panel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
});
```

## index.html changes
Add below `.shortcuts-hint`:
```html
<div id="room-panel" style="display:none; padding:8px 15px; background:rgba(255,255,255,0.03); border-top:1px solid rgba(255,255,255,0.1); align-items:center; gap:10px; flex-wrap:wrap;">
  <div id="room-status" style="width:8px;height:8px;border-radius:50%;background:#ef4444;"></div>
  <span style="font-size:11px;color:rgba(255,255,255,0.5);">Room: <strong id="room-id-display">—</strong></span>
  <button id="create-room-btn" style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;">Create</button>
  <input id="join-input" placeholder="ROOM ID" style="font-size:11px;width:70px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.1);border:none;color:#fff;" />
  <button id="join-room-btn" style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;">Join</button>
  <button id="leave-room-btn" style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;">Leave</button>
</div>
```

## npm dependencies
```
npm install socket.io socket.io-client
```

## Edge cases
- Server port 4444 conflict — allow PORT env var override
- Remote collaboration requires the server to be hosted (Railway/Render free tier); local only works on same machine
- Rapid typing: debounce `text-update` emit to 100ms to avoid flooding
- If both users type simultaneously, last keystroke wins — acceptable for a stealth notepad
