---
id: 15
title: Packaging and Distribution
status: planned
---

## Overview

Prepare the app for shipment and sale. API key moves from `.env` / environment variable to a user-entered settings panel stored via Electron `safeStorage` (OS keychain). A first-run wizard handles permissions and platform setup. Dead files are removed. Build configuration is hardened for macOS notarization.

## Files to modify

- `main.js` — add `safeStorage` IPC handlers for save/load/clear API key; remove `.env` dependency for the key
- `renderer.js` — add settings panel open/close logic, key save/load/clear handlers
- `index.html` — add settings panel markup
- `package.json` — add `hardenedRuntime: true` to electron-builder config; add dead-file exclusions
- Files to delete: `companion.html`, `companion.js`, `agent.js`
- `.env` — remove `OPENROUTER_API_KEY` / `OPENAI_API_KEY` line (keep other vars if needed)

## Key code snippets

### 1. safeStorage IPC handlers (main.js)

```js
const { safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(app.getPath('userData'), 'api-key.enc');

ipcMain.handle('save-api-key', (_, plaintext) => {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store as plain text (dev environments without keychain)
    fs.writeFileSync(KEY_FILE, plaintext, 'utf8');
    return { ok: true, encrypted: false };
  }
  const encrypted = safeStorage.encryptString(plaintext);
  fs.writeFileSync(KEY_FILE, encrypted);
  return { ok: true, encrypted: true };
});

ipcMain.handle('load-api-key', () => {
  if (!fs.existsSync(KEY_FILE)) return null;
  try {
    const data = fs.readFileSync(KEY_FILE);
    if (!safeStorage.isEncryptionAvailable()) return data.toString('utf8');
    return safeStorage.decryptString(data);
  } catch (_) {
    return null;
  }
});

ipcMain.handle('clear-api-key', () => {
  if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
  return { ok: true };
});
```

### 2. Load key on startup (renderer.js)

On `DOMContentLoaded`, load the stored key and make it available to AI calls:

```js
/** @type {string} */
let openRouterApiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';

window.addEventListener('DOMContentLoaded', async () => {
  const stored = await ipcRenderer.invoke('load-api-key');
  if (stored) openRouterApiKey = stored;

  // Show first-run wizard if no key and no env var
  if (!openRouterApiKey) showFirstRunWizard();
});
```

Replace all `process.env.OPENROUTER_API_KEY` / `process.env.OPENAI_API_KEY` references in AI fetch calls with `openRouterApiKey`.

### 3. Settings panel HTML (index.html)

Add inside the `<body>`, outside the main panel divs:

```html
<div id="settings-panel" class="settings-panel" style="display:none;">
  <div class="settings-header">
    <span class="settings-title">Settings</span>
    <button id="settings-close-btn" class="settings-close-btn">&#x2715;</button>
  </div>

  <div class="settings-section">
    <label class="settings-label">OpenRouter API Key</label>
    <input id="api-key-input" type="password" class="settings-input"
           placeholder="sk-or-..." autocomplete="off" />
    <div class="settings-btn-row">
      <button id="save-key-btn" class="settings-btn settings-btn-primary">Save</button>
      <button id="clear-key-btn" class="settings-btn settings-btn-danger">Clear</button>
    </div>
    <div id="key-status" class="settings-status"></div>
  </div>

  <div id="first-run-section" class="settings-section" style="display:none;">
    <div class="settings-label">Setup</div>
    <div id="mic-permission-row" class="settings-check-row">
      <span class="settings-check-icon" id="mic-check-icon">&#x25CB;</span>
      <span>Microphone access</span>
      <button id="request-mic-btn" class="settings-btn">Grant</button>
    </div>
    <div id="screen-permission-row" class="settings-check-row">
      <span class="settings-check-icon" id="screen-check-icon">&#x25CB;</span>
      <span>Screen recording access</span>
      <button id="request-screen-btn" class="settings-btn">Grant</button>
    </div>
    <div id="blackhole-setup-row" class="settings-check-row" style="display:none;">
      <span class="settings-check-icon">&#x25CB;</span>
      <span>BlackHole virtual audio</span>
      <a id="blackhole-link" href="#" class="settings-link">Install guide</a>
    </div>
  </div>
</div>
```

### 4. Settings panel CSS (index.html `<style>`)

```css
.settings-panel {
  position: fixed; inset: 0;
  background: rgba(8, 8, 12, 0.97);
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px; z-index: 200;
  -webkit-app-region: no-drag;
  overflow-y: auto;
}
.settings-header {
  display: flex; justify-content: space-between; align-items: center;
}
.settings-title { font-size: 14px; color: rgba(255,255,255,0.8); font-weight: 600; }
.settings-close-btn {
  background: none; border: none; color: rgba(255,255,255,0.4);
  font-size: 14px; cursor: pointer;
}
.settings-section {
  background: rgba(255,255,255,0.04); border-radius: 8px; padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.settings-label { font-size: 11px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.05em; }
.settings-input {
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px; color: #fff; font-size: 12px; padding: 6px 8px;
  outline: none; font-family: inherit;
}
.settings-btn-row { display: flex; gap: 6px; }
.settings-btn {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 5px; color: rgba(255,255,255,0.8); font-size: 11px;
  padding: 5px 12px; cursor: pointer;
}
.settings-btn-primary { background: rgba(99,102,241,0.3); border-color: rgba(99,102,241,0.5); }
.settings-btn-danger  { background: rgba(239,68,68,0.2);  border-color: rgba(239,68,68,0.4);  }
.settings-status { font-size: 11px; color: #4ade80; min-height: 16px; }
.settings-check-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: rgba(255,255,255,0.7);
}
.settings-check-icon { font-size: 14px; color: rgba(255,255,255,0.3); }
.settings-link { font-size: 11px; color: rgba(99,102,241,0.8); text-decoration: none; }
.settings-link:hover { text-decoration: underline; }
```

### 5. Settings panel logic (renderer.js)

```js
function openSettings() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.style.display = 'flex';
}

function closeSettings() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.style.display = 'none';
}

// Close button
const settingsCloseBtn = document.getElementById('settings-close-btn');
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);

// Save key
const saveKeyBtn = document.getElementById('save-key-btn');
if (saveKeyBtn) {
  saveKeyBtn.addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('api-key-input'));
    const key = input ? input.value.trim() : '';
    if (!key) return;
    const result = await ipcRenderer.invoke('save-api-key', key);
    openRouterApiKey = key;
    const status = document.getElementById('key-status');
    if (status) status.textContent = result.ok ? 'Key saved.' : 'Save failed.';
  });
}

// Clear key
const clearKeyBtn = document.getElementById('clear-key-btn');
if (clearKeyBtn) {
  clearKeyBtn.addEventListener('click', async () => {
    await ipcRenderer.invoke('clear-api-key');
    openRouterApiKey = '';
    const input = /** @type {HTMLInputElement} */ (document.getElementById('api-key-input'));
    if (input) input.value = '';
    const status = document.getElementById('key-status');
    if (status) status.textContent = 'Key cleared.';
  });
}
```

### 6. First-run wizard (renderer.js)

```js
function showFirstRunWizard() {
  openSettings();
  const section = document.getElementById('first-run-section');
  if (section) section.style.display = 'flex';

  // Show BlackHole row on macOS
  if (process.platform === 'darwin') {
    const row = document.getElementById('blackhole-setup-row');
    if (row) row.style.display = 'flex';
    const link = document.getElementById('blackhole-link');
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        require('electron').shell.openExternal('https://existential.audio/blackhole/');
      });
    }
  }

  // Microphone permission
  const micBtn = document.getElementById('request-mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        const icon = document.getElementById('mic-check-icon');
        if (icon) { icon.textContent = '✓'; icon.style.color = '#4ade80'; }
        micBtn.disabled = true;
      } catch (_) {
        showNotification('Microphone access denied. Enable it in System Settings.');
      }
    });
  }

  // Screen recording permission — trigger a capture attempt
  const screenBtn = document.getElementById('request-screen-btn');
  if (screenBtn) {
    screenBtn.addEventListener('click', async () => {
      try {
        await ipcRenderer.invoke('capture-screenshot');
        const icon = document.getElementById('screen-check-icon');
        if (icon) { icon.textContent = '✓'; icon.style.color = '#4ade80'; }
        screenBtn.disabled = true;
      } catch (_) {
        showNotification('Screen recording denied. Enable it in System Preferences > Privacy.');
      }
    });
  }
}
```

### 7. Settings hotkey (main.js)

```js
globalShortcut.register('CommandOrControl+Shift+Comma', () => {
  if (mainWindow) mainWindow.webContents.send('open-settings');
});
```

In renderer.js:
```js
ipcRenderer.on('open-settings', () => openSettings());
```

Also add a gear/settings button in the action bar or title bar:
```html
<button id="settings-btn" class="action-btn" title="Settings">&#9881;</button>
```
```js
const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
```

### 8. package.json build config changes

In the `build` section of `package.json`:

```json
{
  "build": {
    "mac": {
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "files": [
      "**/*",
      "!companion.html",
      "!companion.js",
      "!agent.js",
      "!.env",
      "!**/*.test.js",
      "!node_modules/.cache"
    ]
  }
}
```

Create `build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
    <key>com.apple.security.device.audio-input</key><true/>
    <key>com.apple.security.screen-recording</key><true/>
  </dict>
</plist>
```

### 9. Dead file removal

Delete the following files:
- `companion.html`
- `companion.js`
- `agent.js`

In `main.js`, remove any `require('./companion')`, `require('./agent')`, or references to `companion.html`. Search for `companion.html` in `createWindow` or any `loadFile` calls and remove them.

## Hotkeys / UX

| Hotkey | Action |
|---|---|
| Cmd+Shift+, | Open settings panel |
| Settings gear button | Open settings panel |
| First-run wizard | Shown automatically when no API key is set on startup |

## Edge cases & gotchas

- `safeStorage` requires the app to be signed / have a proper app identity on macOS. In development (unsigned), `safeStorage.isEncryptionAvailable()` may return `false`. The fallback writes the key as plain text. This is acceptable in dev; in production the app will be signed.
- The `KEY_FILE` path uses `app.getPath('userData')` which resolves to `~/Library/Application Support/<appName>` on macOS. This path is created by Electron automatically.
- Do not commit the encrypted key file or `.env` to source control. Ensure `.gitignore` includes `*.enc` and `.env`.
- `safeStorage.decryptString` can throw if the key file was encrypted by a different OS user or after a keychain reset. Wrap in try/catch and treat failure as "no key stored."
- The `openRouterApiKey` variable in renderer must replace all `process.env.OPENROUTER_API_KEY` uses. If streaming (spec 11) uses `process.env` directly in `streamOpenRouter`, update that function to use the module-level variable instead.
- On Windows, `safeStorage` uses DPAPI. Same API, same behavior — no platform-specific code needed.
- Removing `companion.html`, `companion.js`, `agent.js` must not break any `require` or `loadFile` call. Audit `main.js` and `renderer.js` before deletion.
- The `hardenedRuntime: true` flag requires entitlements that allow Electron's JIT compilation (`com.apple.security.cs.allow-unsigned-executable-memory`) and native module loading. Without these entitlements the app will crash on launch when notarized.

## npm dependencies

None. `safeStorage` is built into Electron 28.
