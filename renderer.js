const { ipcRenderer, clipboard } = require('electron');
const { io: ioConnect } = require('socket.io-client');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── API Key (loaded from secure storage on startup) ───────────────────────────
let openRouterApiKey = process.env.OPEN_ROUTER_KEY || '';

ipcRenderer.invoke('load-api-key').then((key) => {
  if (key) openRouterApiKey = key;
}).catch(() => {});

// ── Click-through: pass mouse events to apps beneath when not over UI ─────────
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const interactive = el && el.closest('button, input, textarea, select, a, [data-interactive]');
  ipcRenderer.send('set-ignore-mouse', !interactive);
});

// ── Custom tooltip system ─────────────────────────────────────────────────────
(function initTooltips() {
  const tip = document.createElement('div');
  tip.id = 'custom-tooltip';
  tip.style.cssText = [
    'position:fixed', 'z-index:9999', 'pointer-events:none',
    'background:rgba(15,15,25,0.97)', 'color:#e2e8f0',
    'font-size:10px', 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'padding:5px 10px', 'border-radius:5px',
    'border:1px solid rgba(255,255,255,0.15)',
    'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    'white-space:nowrap', 'display:none', 'line-height:1.5',
    'max-width:220px', 'white-space:normal',
  ].join(';');
  document.body.appendChild(tip);

  /** @type {ReturnType<typeof setTimeout> | null} */
  let showTimer = null;

  document.addEventListener('mouseover', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    const el = target ? target.closest('[data-tip]') : null;
    if (!el) return;
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      const text = /** @type {HTMLElement} */ (el).dataset.tip || '';
      tip.innerHTML = text;
      tip.style.display = 'block';
      const rect = el.getBoundingClientRect();
      const tipW = tip.offsetWidth;
      const tipH = tip.offsetHeight;
      const inBar = /** @type {HTMLElement} */ (el).closest('#bar-mode');
      let left, top;
      if (inBar) {
        // Show to the left of the button, vertically centred on it
        left = rect.left - tipW - 8;
        left = Math.max(8, left);
        top = rect.top + rect.height / 2 - tipH / 2;
      } else {
        left = rect.left + rect.width / 2 - tipW / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
        top = rect.top > 60 ? rect.top - tipH - 8 : rect.bottom + 8;
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }, 120);
  });

  document.addEventListener('mouseout', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (target && target.closest('[data-tip]')) {
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      tip.style.display = 'none';
    }
  });
})();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const notepad         = /** @type {HTMLTextAreaElement} */ (document.getElementById('notepad'));
const minimizeBtn     = document.getElementById('minimize-btn');
const closeBtn        = document.getElementById('close-btn');
const screenshotImg   = /** @type {HTMLImageElement} */ (document.getElementById('screenshot-img'));
const screenshotPH    = document.getElementById('screenshot-placeholder');
const transcriptFeed  = document.getElementById('transcript-feed');
const captureBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('capture-btn'));
const transcriptBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('transcript-btn'));
const companionStatus = document.getElementById('companion-room-status');
const analyzeScreenBtn = /** @type {HTMLButtonElement} */ (document.getElementById('analyze-screen-btn'));
const analyzeAudioBtn  = /** @type {HTMLButtonElement} */ (document.getElementById('analyze-audio-btn'));
const analyzeBothBtn   = /** @type {HTMLButtonElement} */ (document.getElementById('analyze-both-btn'));
const clearAiBtn       = document.getElementById('clear-ai-btn');

// ── Socket / room state ───────────────────────────────────────────────────────
/** @type {ReturnType<typeof ioConnect> | null} */
let socket = null;
let inRoom = false;

// ── AI state ──────────────────────────────────────────────────────────────────
/** @type {string | null} */
let lastScreenshotDataUrl = null;
let aiLoading = false;
const SERVER_URL = process.env.COLLAB_SERVER_URL || 'https://stealthnotepad-production.up.railway.app';

function connectSocket() {
  if (socket) return;
  const s = ioConnect(SERVER_URL);

  s.on('text-update', (/** @type {string} */ text) => {
    const rn = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('room-notepad'));
    if (rn) rn.value = text;
  });

  s.on('screenshot-share', (/** @type {{ imageData: string, senderId: string }} */ data) => {
    if (data.senderId === s.id) return;
    showRoomScreenshot(data.imageData);
    appendTranscript('[Screenshot received]', 'remote');
  });

  s.on('transcript-update', (/** @type {{ text: string, senderId: string }} */ data) => {
    if (data.senderId === s.id) return;
    appendTranscript(data.text, 'remote');
  });

  s.on('room-members', (/** @type {number} */ count) => {
    const el = document.getElementById('room-id-display');
    if (el && inRoom) {
      const roomId = el.textContent ? el.textContent.split(' ')[0] : '—';
      el.textContent = `${roomId} (${count})`;
    }
  });

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

  socket = s;
}

// ── Notepad ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('notepad-content');
  if (saved) notepad.value = saved;

  // Prevent double-click on drag regions from maximizing/zooming the window
  document.querySelectorAll('.panel-header, #bar-mode').forEach((el) => {
    el.addEventListener('dblclick', (e) => e.preventDefault());
  });
});

notepad.addEventListener('input', () => {
  localStorage.setItem('notepad-content', notepad.value);
});

// ── Window controls ───────────────────────────────────────────────────────────
if (minimizeBtn) minimizeBtn.addEventListener('click', () => ipcRenderer.send('minimize'));
if (closeBtn)    closeBtn.addEventListener('click',    () => ipcRenderer.send('close'));

const stealthToggleBtn = document.getElementById('stealth-toggle-btn');
let stealthOn = true;

function applyStealthButtonState() {
  if (!stealthToggleBtn) return;
  if (stealthOn) {
    stealthToggleBtn.textContent = '🔒';
    stealthToggleBtn.style.color = 'rgba(74,222,128,0.8)';
    stealthToggleBtn.style.borderColor = 'rgba(74,222,128,0.2)';
    stealthToggleBtn.title = 'Stealth ON — hidden from screen share';
  } else {
    stealthToggleBtn.textContent = '🔓';
    stealthToggleBtn.style.color = 'rgba(239,68,68,0.8)';
    stealthToggleBtn.style.borderColor = 'rgba(239,68,68,0.2)';
    stealthToggleBtn.title = 'Stealth OFF — visible in screen share';
  }
}

if (stealthToggleBtn) {
  stealthToggleBtn.addEventListener('click', () => {
    ipcRenderer.send('toggle-stealth');
  });
}

ipcRenderer.on('stealth-changed', (_, enabled) => {
  stealthOn = enabled;
  applyStealthButtonState();
  showNotification(enabled ? 'Stealth ON — hidden from capture' : 'Stealth OFF — visible in capture');
});

// ── IPC from main ─────────────────────────────────────────────────────────────
ipcRenderer.on('clear-text', () => {
  notepad.value = '';
  localStorage.removeItem('notepad-content');
  showNotification('Text cleared');
});

ipcRenderer.on('opacity-changed', (_, opacity) => {
  const el = document.getElementById('opacity-display');
  if (el) el.textContent = `${Math.round(opacity * 100)}%`;
});

ipcRenderer.on('save-to-clipboard', () => {
  if (notepad.value.trim()) {
    clipboard.writeText(notepad.value);
    showNotification('Copied to clipboard!');
  } else {
    showNotification('Nothing to copy');
  }
});

ipcRenderer.on('toggle-room-panel', () => toggleRoomPanel());

ipcRenderer.on('toggle-companion', () => enterPanelMode());
ipcRenderer.on('trigger-screenshot', () => captureAndShare());
ipcRenderer.on('toggle-transcription', () => {
  if (isTranscribing) stopTranscription();
  else startTranscription();
});

// ── Room panel ────────────────────────────────────────────────────────────────

/** @param {string} roomId */
function onJoinedRoom(roomId) {
  inRoom = true;
  const display = document.getElementById('room-id-display');
  const status  = document.getElementById('room-status');
  if (display) display.textContent = roomId;
  if (status)  status.style.background = '#4ade80';
  updateCompanionStatus(roomId);
}

function onLeftRoom() {
  inRoom = false;
  const display = document.getElementById('room-id-display');
  const status  = document.getElementById('room-status');
  if (display) display.textContent = '—';
  if (status)  status.style.background = '#ef4444';
  updateCompanionStatus(null);
}

const createRoomBtn = document.getElementById('create-room-btn');
if (createRoomBtn) {
  createRoomBtn.addEventListener('click', () => {
    connectSocket();
    if (!socket) return;
    socket.emit('create-room', (/** @type {{ ok: boolean, roomId: string }} */ res) => {
      if (!res.ok) return;
      onJoinedRoom(res.roomId);
    });
  });
}

const joinRoomBtn = document.getElementById('join-room-btn');
if (joinRoomBtn) {
  joinRoomBtn.addEventListener('click', () => {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('join-input'));
    const id = input ? input.value.trim().toUpperCase() : '';
    if (!id) return;
    connectSocket();
    if (!socket) return;
    socket.emit('join-room', id, (/** @type {{ ok: boolean, error?: string }} */ res) => {
      if (!res.ok) { showNotification(`Room not found: ${id}`); return; }
      onJoinedRoom(id);
    });
  });
}

const leaveRoomBtn = document.getElementById('leave-room-btn');
if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener('click', () => {
    if (socket) socket.emit('leave-room');
    onLeftRoom();
    stopTimer();
    sessionContext = null;
    if (sessionBadge) sessionBadge.style.display = 'none';
  });
}

const captureRoomBtn = document.getElementById('capture-room-btn');
if (captureRoomBtn) captureRoomBtn.addEventListener('click', () => captureAndShare());

const companionBtn = document.getElementById('companion-btn');
if (companionBtn) companionBtn.addEventListener('click', () => toggleRoomPanel());

// ── Mode switching (bar ↔ panel) ──────────────────────────────────────────────
let roomPanelOpen = false;

function enterBarMode() {
  const barEl   = document.getElementById('bar-mode');
  const panelEl = document.getElementById('panel-mode');
  if (barEl)   barEl.style.display   = 'flex';
  if (panelEl) panelEl.style.display = 'none';
  ipcRenderer.send('collapse-to-bar');
}

function enterPanelMode() {
  const barEl   = document.getElementById('bar-mode');
  const panelEl = document.getElementById('panel-mode');
  if (barEl)   barEl.style.display   = 'none';
  if (panelEl) panelEl.style.display = 'flex';
  ipcRenderer.send('expand-from-bar');
}

function toggleRoomPanel() {
  // Ensure we're in panel mode before showing the room panel
  const panelEl = document.getElementById('panel-mode');
  if (panelEl && panelEl.style.display === 'none') enterPanelMode();
  roomPanelOpen = !roomPanelOpen;
  const wrapper = document.getElementById('room-panel-wrapper');
  if (wrapper) wrapper.style.display = roomPanelOpen ? 'flex' : 'none';
  ipcRenderer.send('resize-for-companion', roomPanelOpen);
}

// Wire bar/panel buttons — icon & preview text also expand on click
const barExpandBtn = document.getElementById('bar-expand-btn');
if (barExpandBtn) barExpandBtn.addEventListener('click', () => enterPanelMode());

document.querySelectorAll('[data-bar-expand], #bar-click-area').forEach((el) => {
  el.addEventListener('click', () => enterPanelMode());
});

const collapseToBarBtn = document.getElementById('collapse-to-bar-btn');
if (collapseToBarBtn) collapseToBarBtn.addEventListener('click', () => enterBarMode());

const notepadTabBtn = document.getElementById('notepad-tab-btn');
if (notepadTabBtn) {
  notepadTabBtn.addEventListener('click', () => {
    const overlay = document.getElementById('notepad-overlay');
    if (overlay) overlay.style.display = 'flex';
  });
}

const notepadCloseBtn = document.getElementById('notepad-close-btn');
if (notepadCloseBtn) {
  notepadCloseBtn.addEventListener('click', () => {
    const overlay = document.getElementById('notepad-overlay');
    if (overlay) overlay.style.display = 'none';
  });
}

const screenshotCloseBtn = document.getElementById('screenshot-close-btn');
if (screenshotCloseBtn) {
  screenshotCloseBtn.addEventListener('click', () => {
    const modal = document.getElementById('screenshot-modal');
    if (modal) modal.style.display = 'none';
  });
}

const screenshotAnalyzeBtn = document.getElementById('screenshot-analyze-btn');
if (screenshotAnalyzeBtn) screenshotAnalyzeBtn.addEventListener('click', () => analyzeScreen());

/** @param {string | null} roomId */
function updateCompanionStatus(roomId) {
  if (companionStatus) {
    companionStatus.textContent = roomId ? `Room: ${roomId}` : 'Not in a room';
  }
  if (captureBtn) captureBtn.disabled = false; // capture works with or without room
  // AI buttons are always enabled — no room required
}

// ── Room notepad sync ─────────────────────────────────────────────────────────
let typingTimeout = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

const roomNotepad = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('room-notepad'));
if (roomNotepad) {
  roomNotepad.addEventListener('input', () => {
    if (socket && inRoom) socket.emit('text-update', roomNotepad.value);
    if (socket && inRoom) socket.emit('typing', { senderId: socket.id });
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      if (socket && inRoom) socket.emit('stop-typing', { senderId: socket.id });
    }, 1500);
  });
}

// ── Screenshot ────────────────────────────────────────────────────────────────
/** @param {string} dataUrl */
function showRoomScreenshot(dataUrl) {
  const img = document.getElementById('room-screenshot-img');
  const ph  = document.getElementById('room-screenshot-ph');
  if (img instanceof HTMLImageElement) { img.src = dataUrl; img.style.display = 'block'; }
  if (ph) ph.style.display = 'none';
}

async function captureAndShare() {
  try {
    const imageData = await ipcRenderer.invoke('capture-screenshot');
    if (!imageData) return;
    showScreenshot(imageData);
    appendTranscript('[Screenshot captured & shared]', 'local');
    if (socket && inRoom) socket.emit('screenshot-share', { imageData, senderId: socket.id });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendTranscript(`Screenshot error: ${e.message}`, 'local');
  }
}

/** @param {string} dataUrl */
function showScreenshot(dataUrl) {
  lastScreenshotDataUrl = dataUrl;
  if (screenshotImg) {
    screenshotImg.src = dataUrl;
    screenshotImg.style.display = 'block';
  }
  if (screenshotPH) screenshotPH.style.display = 'none';
  showRoomScreenshot(dataUrl);
}

if (captureBtn) captureBtn.addEventListener('click', () => captureAndShare());

// ── Audio transcription (nodejs-whisper) ──────────────────────────────────────
let isTranscribing = false;
/** @type {MediaRecorder | null} */
let mediaRecorder = null;
let audioChunks = /** @type {Blob[]} */ ([]);
const CHUNK_MS = 8000;

/** @param {MediaStream} stream */
function recordChunk(stream) {
  if (!isTranscribing) { stream.getTracks().forEach((t) => t.stop()); return; }
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    if (audioChunks.length) await processChunk();
    if (isTranscribing) recordChunk(stream);
  };
  mediaRecorder.start();
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  }, CHUNK_MS);
}

async function processChunk() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const buf  = Buffer.from(await blob.arrayBuffer());
  const tmp  = path.join(os.tmpdir(), `stealth-${Date.now()}.webm`);
  const langEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('whisper-lang'));
  const lang = langEl ? langEl.value : 'en';
  const modelName = lang === 'en' ? 'tiny.en' : 'tiny';
  try {
    fs.writeFileSync(tmp, buf);
    const { nodewhisper } = require('nodejs-whisper');
    /** @type {Record<string, unknown>} */
    const whisperOpts = {
      outputInText: true, outputInVtt: false, outputInSrt: false,
      outputInCsv: false, translateToEnglish: false, wordTimestamps: false, splitOnWord: true,
    };
    if (lang) whisperOpts.language = lang;
    const result = await nodewhisper(tmp, {
      modelName,
      autoDownloadModelName: modelName,
      removeWavFileAfterTranscription: true,
      withCuda: false,
      whisperOptions: whisperOpts,
    });
    let text = Array.isArray(result)
      ? result.map((r) => r.speech || r.text || '').join(' ').trim()
      : String(result).trim();
    if (text) {
      appendTranscript(text, 'local');
      if (socket && inRoom) socket.emit('transcript-update', { text, senderId: socket.id });
    }
    if (text && autoAnswerEnabled && !aiLoading && looksLikeQuestion(text)) {
      answerQuestion();
    }
  } catch (err) {
    const e = /** @type {Error & { code?: string }} */ (err);
    if (e.code === 'MODULE_NOT_FOUND') {
      appendTranscript('nodejs-whisper not installed — run: npm install && npm run rebuild', 'local');
      stopTranscription();
    } else {
      appendTranscript(`Transcription error: ${e.message}`, 'local');
    }
  } finally {
    fs.unlink(tmp, () => {});
  }
}

// ── Audio device management ────────────────────────────────────────────────────
async function populateAudioDevices() {
  const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('audio-device-select'));
  if (!select) return;
  try {
    // Request permission so labels populate
    await navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {});
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    select.innerHTML = '';
    let preferredId = '';
    // Offer system audio (desktopCapturer) on both macOS and Windows
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const sysOpt = document.createElement('option');
      sysOpt.value = '__desktop__';
      sysOpt.textContent = '🔊 System Audio (recommended)';
      select.appendChild(sysOpt);
      preferredId = '__desktop__';
    }
    let blackholeFound = false;
    for (const device of inputs) {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      const isSystem = /blackhole|stereo mix|what u hear|loopback/i.test(device.label);
      opt.textContent = isSystem ? `🔊 ${device.label}` : (device.label || `Microphone ${select.options.length + 1}`);
      if (isSystem) { blackholeFound = true; if (!preferredId) preferredId = device.deviceId; }
      select.appendChild(opt);
    }
    if (preferredId) select.value = preferredId;
    // Show BlackHole hint on macOS if not found
    const hint = document.getElementById('blackhole-hint');
    if (hint) hint.style.display = (process.platform === 'darwin' && !blackholeFound) ? 'block' : 'none';
    const statusEl = document.getElementById('audio-device-status');
    if (statusEl) {
      const isSystem = select.value === '__desktop__' || (select.options[select.selectedIndex]?.text || '').startsWith('🔊');
      statusEl.style.display = isSystem ? 'inline' : 'none';
    }
  } catch (e) { /* silent */ }
}

async function getDesktopAudioStream() {
  const sourceId = await ipcRenderer.invoke('get-screen-source-id');
  if (!sourceId) return null;
  try {
    const raw = await navigator.mediaDevices.getUserMedia(/** @type {any} */ ({
      audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 320, maxHeight: 240 } },
    }));
    raw.getVideoTracks().forEach((t) => t.stop());
    const tracks = raw.getAudioTracks();
    return tracks.length ? new MediaStream(tracks) : null;
  } catch {
    return null;
  }
}

async function getAudioStream() {
  const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('audio-device-select'));
  const deviceId = select ? select.value : '';

  // Desktop audio: explicit selection OR auto-try on macOS (no BlackHole needed on macOS 13+)
  if (deviceId === '__desktop__' || (deviceId === '' && process.platform === 'darwin')) {
    const stream = await getDesktopAudioStream();
    if (stream) {
      const hint = document.getElementById('blackhole-hint');
      if (hint) hint.style.display = 'none'; // desktop audio works, hide BlackHole hint
      return stream;
    }
    // desktop audio failed — fall through to device selection
  }

  // BlackHole or other named device selected
  if (deviceId && deviceId !== 'default' && deviceId !== '__desktop__') {
    return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
  }

  // Fallback: default microphone
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

const audioDeviceSelect = document.getElementById('audio-device-select');
if (audioDeviceSelect) {
  audioDeviceSelect.addEventListener('change', () => {
    const statusEl = document.getElementById('audio-device-status');
    if (statusEl) {
      const sel = /** @type {HTMLSelectElement} */ (audioDeviceSelect);
      const isSystem = sel.value === '__desktop__' || (sel.options[sel.selectedIndex]?.text || '').startsWith('🔊');
      statusEl.style.display = isSystem ? 'inline' : 'none';
    }
  });
}

window.addEventListener('DOMContentLoaded', () => { populateAudioDevices(); });

async function startTranscription() {
  try {
    const stream = await getAudioStream();
    isTranscribing = true;
    if (transcriptBtn) {
      transcriptBtn.textContent = '⏹ Stop';
      transcriptBtn.style.color = '#ef4444';
      transcriptBtn.style.borderColor = '#ef4444';
    }
    const recDot = document.getElementById('bar-rec-dot');
    if (recDot) recDot.style.display = 'inline-block';
    recordChunk(stream);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendTranscript(`Mic error: ${e.message}`, 'local');
  }
}

function stopTranscription() {
  isTranscribing = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  if (transcriptBtn) {
    transcriptBtn.textContent = '🎙 Record';
    transcriptBtn.style.color = '#a78bfa';
    transcriptBtn.style.borderColor = '#a78bfa';
  }
}

if (transcriptBtn) {
  transcriptBtn.addEventListener('click', () => {
    if (isTranscribing) stopTranscription();
    else startTranscription();
  });
}

// ── Transcript feed ───────────────────────────────────────────────────────────
/**
 * @param {string} text
 * @param {'local' | 'remote'} source
 */
function appendTranscript(text, source) {
  if (!transcriptFeed) return;
  const entry = document.createElement('div');
  entry.className = `transcript-entry ${source}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  entry.innerHTML = `<span class="ts-time">${time}</span><span class="ts-text">${text}</span>`;
  transcriptFeed.appendChild(entry);
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

// ── Notifications ─────────────────────────────────────────────────────────────
/** @param {string} message */
function showNotification(message) {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `
    position:fixed; top:50px; right:20px;
    background:rgba(74,222,128,0.9); color:#000;
    padding:10px 20px; border-radius:6px;
    font-size:12px; font-weight:500; z-index:1000;
    animation:slideIn 0.3s ease;
  `;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 2000);
}

// ── Init state ────────────────────────────────────────────────────────────────
updateCompanionStatus(null); // capture/transcript disabled until room joined; AI buttons always enabled

// ── AI Analysis ───────────────────────────────────────────────────────────────

let autoAnswerEnabled = true;

/** @param {string} text @returns {boolean} */
function looksLikeQuestion(text) {
  const tail = text.slice(-150).toLowerCase();
  if (tail.includes('?')) return true;
  const openers = ['can you', 'could you', 'how would', 'how do', 'tell me', 'explain', 'what is', 'what are', 'what was', 'describe', 'walk me through', 'why did', 'why would'];
  return openers.some(o => tail.includes(o));
}

/**
 * Streams AI response tokens into a live bubble in the AI feed.
 * @param {Array<{role: string, content: unknown}>} messages
 * @returns {Promise<string>} — full accumulated text
 */
async function streamOpenRouter(messages) {
  const { OpenAI } = require('openai');
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openRouterApiKey,
    timeout: 30000,
    dangerouslyAllowBrowser: true,
  });

  const feed = document.getElementById('ai-feed');

  // Create the bubble element immediately
  const entry = document.createElement('div');
  entry.className = 'ai-entry';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  entry.innerHTML = `<span class="ts-time">${time}</span><span class="ai-text"><span class="ai-thinking">···</span></span>`;
  if (feed) feed.appendChild(entry);
  if (aiAutoScroll && feed) feed.scrollTop = feed.scrollHeight;

  const textSpan = entry.querySelector('.ai-text');
  let accumulated = '';

  const tryStream = async (/** @type {string} */ model) => {
    const stream = await client.chat.completions.create({
      model,
      messages: /** @type {import('openai').OpenAI.ChatCompletionMessageParam[]} */ (messages),
      max_tokens: 1024,
      stream: true,
    });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        accumulated += token;
        if (textSpan) textSpan.innerHTML = renderMarkdown(accumulated);
        if (aiAutoScroll && feed) feed.scrollTop = feed.scrollHeight;
      }
    }
  };

  try {
    await tryStream('anthropic/claude-opus-4');
  } catch (_primaryErr) {
    accumulated = '';
    await tryStream('openai/gpt-4o');
  }

  return accumulated;
}

/** @param {boolean} loading */
function setAiLoading(loading) {
  aiLoading = loading;
  const btns = [analyzeScreenBtn, analyzeAudioBtn, analyzeBothBtn];
  btns.forEach((b) => { if (b) b.disabled = loading; });
}

/**
 * @param {string} text
 * @param {boolean} [isError]
 */
function appendAiEntry(text, isError = false) {
  const feed = document.getElementById('ai-feed');
  if (!feed) return;
  const entry = document.createElement('div');
  entry.className = `ai-entry${isError ? ' error' : ''}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rendered = isError
    ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : renderMarkdown(text);
  entry.innerHTML = `<span class="ts-time">${time}</span><span class="ai-text">${rendered}</span>`;
  feed.appendChild(entry);
  if (aiAutoScroll) feed.scrollTop = feed.scrollHeight;
}

/** @returns {string} */
function getTranscriptContext() {
  if (!transcriptFeed) return '';
  const entries = transcriptFeed.querySelectorAll('.ts-text');
  return Array.from(entries).slice(-10).map((e) => e.textContent).join('\n').trim();
}

async function analyzeScreen() {
  if (aiLoading) return;
  if (!lastScreenshotDataUrl) {
    appendAiEntry('No screenshot captured yet. Press Ctrl+Shift+I first.', true);
    return;
  }
  setAiLoading(true);
  try {
    await streamOpenRouter([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: lastScreenshotDataUrl } },
        { type: 'text', text: `You are an expert software engineer and technical interview coach.

Analyze this screenshot carefully and:
1. Identify the technical question, coding problem, or task shown on screen.
2. Provide a complete, working code solution in the most appropriate language.
3. Explain EVERY line of code — what it does, why it is written that way, and any edge cases it handles.
4. If multiple approaches exist, briefly compare trade-offs and recommend the best one with justification.
5. State the time complexity and space complexity clearly.
6. If the problem involves a data structure or algorithm, name it explicitly.

Format your response as:
**Problem:** <restate the problem in one sentence>
**Approach:** <algorithm/strategy chosen and why>
**Code:**
\`\`\`<language>
<solution>
\`\`\`
**Line-by-line explanation:** <explain each meaningful line or block>
**Complexity:** Time: O(...) | Space: O(...)` },
      ],
    }]);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendAiEntry(`Error: ${e.message}`, true);
  } finally {
    setAiLoading(false);
  }
}

async function analyzeAudio() {
  if (aiLoading) return;
  const transcript = getTranscriptContext();
  if (!transcript) {
    appendAiEntry('No transcript yet. Start transcribing first.', true);
    return;
  }
  setAiLoading(true);
  try {
    await streamOpenRouter([{
      role: 'user',
      content: `You are an expert software engineer and technical interview coach.

The following is an audio transcript from a technical interview or coding session:

${transcript}

Your tasks:
1. Identify the most recent technical question, coding problem, or task mentioned in the transcript.
2. Provide a complete, working code solution in the most appropriate language.
3. Explain EVERY line of code — what it does, why it is written that way, and any edge cases it handles.
4. If multiple approaches exist, briefly compare trade-offs and recommend the best one with justification.
5. State the time complexity and space complexity clearly.
6. If the problem involves a data structure or algorithm, name it explicitly.

Format your response as:
**Problem:** <restate the problem in one sentence>
**Approach:** <algorithm/strategy chosen and why>
**Code:**
\`\`\`<language>
<solution>
\`\`\`
**Line-by-line explanation:** <explain each meaningful line or block>
**Complexity:** Time: O(...) | Space: O(...)`,
    }]);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendAiEntry(`Error: ${e.message}`, true);
  } finally {
    setAiLoading(false);
  }
}

async function analyzeBoth() {
  if (aiLoading) return;
  const transcript = getTranscriptContext();
  const hasScreen = !!lastScreenshotDataUrl;
  const hasAudio = !!transcript;
  if (!hasScreen && !hasAudio) {
    appendAiEntry('Nothing to analyze. Capture a screenshot or start transcribing first.', true);
    return;
  }
  setAiLoading(true);
  try {
    /** @type {Array<{type: string, image_url?: {url: string}, text?: string}>} */
    const content = [];
    if (hasScreen) content.push({ type: 'image_url', image_url: { url: /** @type {string} */ (lastScreenshotDataUrl) } });
    const sharedFormat = `Format your response as:
**Problem:** <restate the problem in one sentence>
**Approach:** <algorithm/strategy chosen and why>
**Code:**
\`\`\`<language>
<solution>
\`\`\`
**Line-by-line explanation:** <explain each meaningful line or block>
**Complexity:** Time: O(...) | Space: O(...)`;
    if (hasAudio) {
      content.push({ type: 'text', text: `You are an expert software engineer and technical interview coach.

Audio transcript:
${transcript}

Using the screenshot and/or transcript above:
1. Identify the technical question, coding problem, or task being asked.
2. Provide a complete, working code solution in the most appropriate language.
3. Explain EVERY line of code — what it does, why it is written that way, and any edge cases it handles.
4. If multiple approaches exist, compare trade-offs and recommend the best one with justification.
5. State time and space complexity clearly.
6. If the problem involves a data structure or algorithm, name it explicitly.

${sharedFormat}` });
    } else {
      content.push({ type: 'text', text: `You are an expert software engineer and technical interview coach.

Analyze this screenshot and:
1. Identify the technical question, coding problem, or task shown.
2. Provide a complete, working code solution in the most appropriate language.
3. Explain EVERY line of code — what it does, why it is written that way, and any edge cases it handles.
4. If multiple approaches exist, compare trade-offs and recommend the best one with justification.
5. State time and space complexity clearly.
6. If the problem involves a data structure or algorithm, name it explicitly.

${sharedFormat}` });
    }
    await streamOpenRouter([{ role: 'user', content }]);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendAiEntry(`Error: ${e.message}`, true);
  } finally {
    setAiLoading(false);
  }
}

// ── AI button event listeners ─────────────────────────────────────────────────
if (analyzeScreenBtn) analyzeScreenBtn.addEventListener('click', () => analyzeScreen());
if (analyzeAudioBtn)  analyzeAudioBtn.addEventListener('click',  () => analyzeAudio());
if (analyzeBothBtn)   analyzeBothBtn.addEventListener('click',   () => analyzeBoth());
function doClearAiFeed() {
  const feed = document.getElementById('ai-feed');
  if (feed) {
    feed.innerHTML = '<div style="margin:auto;text-align:center;color:rgba(255,255,255,0.15);font-size:10px;padding:20px 0;">AI context cleared — ready for a fresh start</div>';
  }
  lastScreenshotDataUrl = null;
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById('screenshot-img'));
  if (img) { img.src = ''; img.style.display = 'none'; }
  const ph = document.getElementById('screenshot-placeholder');
  if (ph) ph.style.display = 'block';
}

ipcRenderer.on('clear-ai-feed', () => doClearAiFeed());

ipcRenderer.on('toggle-auto-answer', () => {
  const btn = document.getElementById('auto-answer-btn');
  if (!btn) return;
  autoAnswerEnabled = !autoAnswerEnabled;
  btn.style.color = autoAnswerEnabled ? 'rgba(74,222,128,0.85)' : 'rgba(255,255,255,0.25)';
  btn.style.borderColor = autoAnswerEnabled ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)';
  btn.style.background = autoAnswerEnabled ? 'rgba(74,222,128,0.1)' : 'transparent';
});

ipcRenderer.on('toggle-auto-scroll', () => {
  const btn = document.getElementById('ai-autoscroll-btn');
  if (!btn) return;
  aiAutoScroll = !aiAutoScroll;
  btn.style.color = aiAutoScroll ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.25)';
  btn.textContent = aiAutoScroll ? '↓ Auto' : '↓ Off';
});

if (clearAiBtn) {
  clearAiBtn.addEventListener('click', () => doClearAiFeed());
}
ipcRenderer.on('trigger-ai-analyze', () => analyzeBoth());

ipcRenderer.on('scroll-ai-feed', (_, delta) => {
  const feed = document.getElementById('ai-feed');
  if (feed) feed.scrollTop += delta;
});


// ── Session Context ────────────────────────────────────────────────────────────
/** @type {{ company: string, role: string, language: string } | null} */
let sessionContext = null;

/** @returns {string} */
function buildSystemPrompt() {
  const base = `You are an expert software engineer and technical interview coach. For any technical or coding question:
1. Provide a complete, working code solution in the most appropriate language.
2. Explain EVERY line of code — what it does, why it is written that way, and any edge cases it handles.
3. If multiple approaches exist, compare trade-offs and recommend the best one with justification.
4. State time and space complexity clearly.
5. If the problem involves a data structure or algorithm, name it explicitly.
Format responses as: **Problem** → **Approach** → **Code** (in a fenced block) → **Line-by-line explanation** → **Complexity**.`;
  if (!sessionContext) return base;
  /** @type {Record<string, string>} */
  const langNames = { en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese', '': 'the detected language' };
  const lang = langNames[sessionContext.language] || 'English';
  return `${base} The user is a ${sessionContext.role} interviewing at ${sessionContext.company}. Tailor your answers to that context. Respond in ${lang}.`;
}

const sessionBtn = document.getElementById('session-btn');
const sessionModal = document.getElementById('session-modal');
const sessionStartBtn = document.getElementById('session-start-btn');
const sessionCancelBtn = document.getElementById('session-cancel-btn');
const sessionBadge = document.getElementById('session-badge');

if (sessionBtn) {
  sessionBtn.addEventListener('click', () => {
    if (sessionModal) sessionModal.style.display = 'flex';
  });
}

if (sessionCancelBtn) {
  sessionCancelBtn.addEventListener('click', () => {
    if (sessionModal) sessionModal.style.display = 'none';
  });
}

if (sessionStartBtn) {
  sessionStartBtn.addEventListener('click', () => {
    const company  = /** @type {HTMLInputElement} */ (document.getElementById('session-company'));
    const role     = /** @type {HTMLInputElement} */ (document.getElementById('session-role'));
    const language = /** @type {HTMLSelectElement} */ (document.getElementById('session-language'));
    sessionContext = {
      company:  company  ? company.value.trim()  : '',
      role:     role     ? role.value.trim()     : '',
      language: language ? language.value        : 'en',
    };
    if (sessionModal) sessionModal.style.display = 'none';
    if (sessionBadge) {
      sessionBadge.textContent = sessionContext.company || sessionContext.role
        ? `${sessionContext.role}${sessionContext.company ? ' @ ' + sessionContext.company : ''}`
        : 'Session Active';
      sessionBadge.style.display = 'inline';
    }
    startTimer();
    showNotification('Session started');
  });
}

// ── Session Timer ──────────────────────────────────────────────────────────────
let timerSeconds = 0;
/** @type {ReturnType<typeof setInterval> | null} */
let timerInterval = null;

function startTimer() {
  if (timerInterval) return;
  timerSeconds = 0;
  timerInterval = setInterval(() => {
    timerSeconds++;
    const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    const el = document.getElementById('session-timer');
    if (el) el.textContent = `⏱ ${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = document.getElementById('session-timer');
  if (el) el.textContent = '⏱ 00:00';
}

// ── AI Auto-answer toggle ──────────────────────────────────────────────────────
const autoAnswerBtn = document.getElementById('auto-answer-btn');
if (autoAnswerBtn) {
  autoAnswerBtn.addEventListener('click', () => {
    autoAnswerEnabled = !autoAnswerEnabled;
    autoAnswerBtn.style.color = autoAnswerEnabled ? 'rgba(74,222,128,0.85)' : 'rgba(255,255,255,0.25)';
    autoAnswerBtn.style.borderColor = autoAnswerEnabled ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)';
    autoAnswerBtn.style.background = autoAnswerEnabled ? 'rgba(74,222,128,0.1)' : 'transparent';
  });
}

// ── AI Auto-scroll ─────────────────────────────────────────────────────────────
let aiAutoScroll = true;

const aiAutoscrollBtn = document.getElementById('ai-autoscroll-btn');
if (aiAutoscrollBtn) {
  aiAutoscrollBtn.style.color = 'rgba(251,191,36,0.85)';
  aiAutoscrollBtn.addEventListener('click', () => {
    aiAutoScroll = !aiAutoScroll;
    aiAutoscrollBtn.style.color = aiAutoScroll ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.25)';
    aiAutoscrollBtn.textContent = aiAutoScroll ? '↓ Auto' : '↓ Off';
  });
}

// ── Markdown renderer (XSS-safe) ──────────────────────────────────────────────
/** @param {string} text @returns {string} */
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-family:monospace;">$1</code>')
    .replace(/^#{3}\s(.+)$/gm, '<strong style="font-size:11px;color:rgba(255,255,255,0.6);">$1</strong>')
    .replace(/^#{1,2}\s(.+)$/gm, '<strong>$1</strong>')
    .replace(/^[-*]\s(.+)$/gm, '• $1')
    .replace(/^\d+\.\s(.+)$/gm, '$1')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/\n/g, '<br>');
}


// ── Answer Question ────────────────────────────────────────────────────────────
async function answerQuestion() {
  if (aiLoading) return;
  const transcript = getTranscriptContext();
  if (!transcript) {
    appendAiEntry('No transcript yet. Start transcribing first.', true);
    return;
  }
  setAiLoading(true);
  try {
    const systemPrompt = buildSystemPrompt();
    await streamOpenRouter([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `The following is a transcript from a technical interview or coding session:

${transcript}

Your tasks:
1. Identify the most recent technical question, coding problem, or task from the transcript.
2. Provide a complete, working code solution in the most appropriate language.
3. Explain EVERY line of code — what it does, why it is written that way, and any edge cases it handles.
4. If multiple approaches exist, compare trade-offs and recommend the best one with justification.
5. State time and space complexity clearly.
6. If the problem involves a data structure or algorithm, name it explicitly.

Format your response as:
**Problem:** <restate the problem in one sentence>
**Approach:** <algorithm/strategy chosen and why>
**Code:**
\`\`\`<language>
<solution>
\`\`\`
**Line-by-line explanation:** <explain each meaningful line or block>
**Complexity:** Time: O(...) | Space: O(...)` },
    ]);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendAiEntry(`Error: ${e.message}`, true);
  } finally {
    setAiLoading(false);
  }
}

const answerQuestionBtn = document.getElementById('answer-question-btn');
if (answerQuestionBtn) answerQuestionBtn.addEventListener('click', () => answerQuestion());

// ── Direct chat ───────────────────────────────────────────────────────────────
async function sendChatMessage() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById('chat-input'));
  const text = input ? input.value.trim() : '';
  if (!text || aiLoading) return;
  if (input) { input.value = ''; input.blur(); }
  setAiLoading(true);
  try {
    const systemPrompt = buildSystemPrompt();
    await streamOpenRouter([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ]);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendAiEntry(`Error: ${e.message}`, true);
  } finally {
    setAiLoading(false);
  }
}

const chatSendBtn = document.getElementById('chat-send-btn');
const chatInput   = document.getElementById('chat-input');
if (chatSendBtn) chatSendBtn.addEventListener('click', () => sendChatMessage());
if (chatInput)   chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ── Settings modal ────────────────────────────────────────────────────────────
function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.style.display = 'flex';
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.style.display = 'none';
}

const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

const settingsCancelBtn = document.getElementById('settings-cancel-btn');
if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettings);

const settingsSaveBtn = document.getElementById('settings-save-btn');
if (settingsSaveBtn) {
  settingsSaveBtn.addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('api-key-input'));
    const key = input ? input.value.trim() : '';
    if (!key) return;
    await ipcRenderer.invoke('save-api-key', key);
    openRouterApiKey = key;
    closeSettings();
    showNotification('API key saved');
  });
}

const settingsClearBtn = document.getElementById('settings-clear-btn');
if (settingsClearBtn) {
  settingsClearBtn.addEventListener('click', async () => {
    await ipcRenderer.invoke('clear-api-key');
    openRouterApiKey = '';
    const input = /** @type {HTMLInputElement} */ (document.getElementById('api-key-input'));
    if (input) input.value = '';
    closeSettings();
    showNotification('API key cleared');
  });
}

ipcRenderer.on('open-settings', () => openSettings());

// ── Collapse / Expand bar ──────────────────────────────────────────────────────
const collapseBtn = document.getElementById('collapse-btn');
const barOverlay  = document.getElementById('bar-overlay');
const expandBtn   = document.getElementById('expand-btn');
const container   = document.querySelector('.container');

if (collapseBtn) {
  collapseBtn.addEventListener('click', () => {
    if (container instanceof HTMLElement) container.style.display = 'none';
    if (barOverlay) barOverlay.style.display = 'flex';
    ipcRenderer.send('collapse-to-bar');
  });
}

if (expandBtn) {
  expandBtn.addEventListener('click', () => {
    if (barOverlay) barOverlay.style.display = 'none';
    if (container instanceof HTMLElement) container.style.display = 'flex';
    ipcRenderer.send('expand-from-bar');
  });
}


