# Stealth Notepad — Features & Shortcuts

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + Shift + N` | Toggle show / hide the notepad |
| `Cmd/Ctrl + Shift + C` | Clear all text (silent, no popup) |
| `Cmd/Ctrl + Shift + S` | Copy all text to clipboard |
| `Cmd/Ctrl + Shift + O` | Cycle opacity → 30% → 50% → 70% → 100% |
| `Cmd/Ctrl + Shift + R` | Toggle the collaboration room panel |
| `Cmd/Ctrl + Shift + P` | Toggle the Companion window (screenshot + transcript) |
| `Cmd/Ctrl + Shift + T` | Toggle audio recording (system audio / mic) |
| `Cmd/Ctrl + Shift + I` | Capture & share screenshot to room |
| `Cmd/Ctrl + Shift + A` | AI analyze screenshot + transcript |
| `Cmd/Ctrl + Shift + X` | Clear AI feed & reset context (fresh start) |
| `Cmd/Ctrl + Shift + B` | Toggle auto-answer (auto-detect questions) |
| `Cmd/Ctrl + Shift + L` | Toggle auto-scroll in AI feed |
| `ESC` | Quick hide |
| `Cmd+Option+U` | Snap to top-left |
| `Cmd+Option+I` | Snap to top-center |
| `Cmd+Option+O` | Snap to top-right |
| `Cmd+Option+J` | Snap to bottom-left |
| `Cmd+Option+K` | Snap to bottom-center |
| `Cmd+Option+L` | Snap to bottom-right |
| `Cmd+Option+[` | Scroll AI feed up |
| `Cmd+Option+]` | Scroll AI feed down |

## Mouse
- **Drag** the title bar to reposition the window freely (F9–F12 removed — conflicted with macOS media keys)

---

## Collaboration Room

1. Both users must have the same `COLLAB_SERVER_URL` in their `.env` file
2. Press `Cmd/Ctrl + Shift + R` to open the room panel
3. **User 1** clicks **Create** → gets a 6-char room ID (e.g. `A3KZ91`)
4. **User 2** types the same ID in the input → clicks **Join**
5. Both users are now synced in real time
6. Click **Leave** to exit the room

---

## Running the App

```bash
# Install dependencies
npm install

# Start the app
npm start
```

## Deploying the Collaboration Server

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create project (first time only)
railway init

# Deploy
railway up

# Get your server URL
railway domain
```

## Environment Variables

Create a `.env` file in the project root:

```
COLLAB_SERVER_URL=https://your-server.up.railway.app
OPEN_ROUTER_KEY=sk-or-v1-...
```

> If `COLLAB_SERVER_URL` is not set, the app runs a local server on port 4444 (same machine only).
> `OPEN_ROUTER_KEY` is required for AI analysis features (get one at openrouter.ai).

---

## Stealth Features

- **Invisible during screen recording** — `setContentProtection(true)` on macOS
- **No taskbar icon** — window doesn't appear in the dock/taskbar
- **Frameless & transparent** — blends into any background
- **Opacity control** — dial it down to nearly invisible

## macOS Note

`Cmd+Alt+Arrow` may conflict with Mission Control.
Fix: **System Settings → Desktop & Dock → Mission Control → uncheck "Arrow keys to switch spaces"**
