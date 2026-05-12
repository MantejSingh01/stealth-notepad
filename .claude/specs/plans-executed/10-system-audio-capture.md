---
id: 10
title: System Audio Capture
status: planned
---

## Overview

Currently the app captures only microphone audio via a hardcoded `getUserMedia({ audio: true })` call. This spec adds the ability to capture system audio (what the interviewer says through Zoom, Meet, etc.) by enumerating audio devices and letting the user pick the source. On macOS, BlackHole virtual audio device is auto-detected. On Windows, `desktopCapturer` is used to get a system audio track. Microphone remains the fallback.

## Files to modify

- `renderer.js` — replace hardcoded `getUserMedia` with device-aware capture; add `listAudioDevices()`, device selector logic, BlackHole detection, Windows path
- `index.html` — add audio device selector dropdown in the companion/AI panel UI
- `main.js` — add `ipcMain.handle('get-desktop-sources')` for Windows system audio via `desktopCapturer`

## Key code snippets

### 1. Enumerate audio devices (renderer.js)

```js
/**
 * Returns all audioinput devices.
 * Triggers a getUserMedia permission prompt first if needed so labels are populated.
 * @returns {Promise<MediaDeviceInfo[]>}
 */
async function listAudioDevices() {
  // Request mic permission so device labels are visible
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (_) { /* permission denied — labels may be empty */ }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}
```

### 2. Populate device selector dropdown (renderer.js)

```js
async function populateAudioDeviceSelector() {
  const select = /** @type {HTMLSelectElement} */ (document.getElementById('audio-device-select'));
  if (!select) return;

  const devices = await listAudioDevices();
  select.innerHTML = '';

  // Default option — system default mic
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default microphone';
  select.appendChild(defaultOpt);

  devices.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Audio input ${d.deviceId.slice(0, 6)}`;
    select.appendChild(opt);
  });

  // macOS: auto-select BlackHole if found
  if (process.platform === 'darwin') {
    const blackhole = devices.find((d) => /blackhole/i.test(d.label));
    if (blackhole) {
      select.value = blackhole.deviceId;
    } else {
      showBlackholeSetupHint();
    }
  }
}
```

### 3. BlackHole setup hint (renderer.js)

```js
function showBlackholeSetupHint() {
  const hint = document.getElementById('blackhole-hint');
  if (hint) hint.style.display = 'block';
}
```

The hint element in HTML should read: "System audio not found. Install BlackHole (brew install blackhole-2ch) and set it as output in Audio MIDI Setup."

### 4. Device-aware getUserMedia (renderer.js)

Replace the current `getUserMedia({ audio: true })` call inside `startTranscription()`:

```js
async function getAudioStream() {
  const select = /** @type {HTMLSelectElement} */ (document.getElementById('audio-device-select'));
  const deviceId = select ? select.value : '';

  // Windows: attempt system audio via desktopCapturer
  if (process.platform === 'win32' && !deviceId) {
    try {
      return await getWindowsSystemAudioStream();
    } catch (_) { /* fall through to mic */ }
  }

  const constraints = deviceId
    ? { audio: { deviceId: { exact: deviceId } } }
    : { audio: true };

  return navigator.mediaDevices.getUserMedia(constraints);
}
```

### 5. Windows system audio via desktopCapturer (renderer.js + main.js)

main.js addition:
```js
const { desktopCapturer } = require('electron');

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});
```

renderer.js:
```js
async function getWindowsSystemAudioStream() {
  const sources = await ipcRenderer.invoke('get-desktop-sources');
  if (!sources || sources.length === 0) throw new Error('No desktop sources');
  const sourceId = sources[0].id;
  return navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
      },
    },
    video: false,
  });
}
```

### 6. Wire into startTranscription (renderer.js)

Replace:
```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
```
With:
```js
const stream = await getAudioStream();
```

### 7. HTML additions (index.html)

Inside the companion/AI panel, near the transcript/audio controls:

```html
<div id="audio-device-row" style="display:flex;align-items:center;gap:6px;padding:4px 8px;">
  <label for="audio-device-select" style="font-size:11px;color:rgba(255,255,255,0.5);">Audio:</label>
  <select id="audio-device-select" style="flex:1;font-size:11px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:2px 4px;">
    <option value="">Default microphone</option>
  </select>
</div>
<div id="blackhole-hint" style="display:none;font-size:10px;color:#facc15;padding:4px 8px;">
  System audio not found. Install BlackHole (brew install blackhole-2ch) and route audio through it.
</div>
```

### 8. Call populateAudioDeviceSelector on companion open

In `toggleCompanion()` or `openCompanion()`:
```js
if (companionOpen) populateAudioDeviceSelector();
```

## Hotkeys / UX

No new global hotkeys. The device selector is in the UI panel. When the user changes the selector while transcription is active, the change takes effect on the next chunk cycle (do not interrupt the current `MediaRecorder`).

## Edge cases & gotchas

- `enumerateDevices()` returns devices with empty labels if permission has not been granted yet. The `listAudioDevices()` function triggers a temporary `getUserMedia` to force label population before enumerating.
- On macOS, BlackHole must be installed AND set as the system output device (or a Multi-Output Device including BlackHole). The app can only detect its presence, not configure it.
- On Windows, `chromeMediaSource: 'desktop'` requires `desktopCapturer` access; some Windows audio drivers do not expose a loopback device. Wrap in try/catch and fall back to mic.
- `contextIsolation: false` and `nodeIntegration: true` are already set in `main.js`, so `ipcRenderer.invoke` works from renderer without a preload.
- If the user denies microphone permission, `getUserMedia` will throw. Catch and show a notification: "Microphone permission denied."
- Device list should be re-populated each time the companion opens, not cached, because the user may plug in or remove devices.

## npm dependencies

None. Uses built-in Web APIs (`navigator.mediaDevices`) and Electron's `desktopCapturer`.
