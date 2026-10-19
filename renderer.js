const { ipcRenderer, clipboard } = require('electron');
const { io: ioConnect } = require('socket.io-client');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── API Key (loaded from secure storage on startup) ───────────────────────────
let openRouterApiKey = process.env.OPEN_ROUTER_KEY || '';

ipcRenderer.invoke('load-api-key').then((key) => {
  if (key) openRouterApiKey = key;
  refreshApiKeyStatus();
}).catch(() => {});

// ── Click-through: pass mouse events to apps beneath when not over UI ─────────
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  // The window is sized to the chrome. Feeds, headers, and dialogs must stay
  // clickable so text can be selected and scrolled. Pass-through is only for
  // the transparent gap outside those regions.
  const interactive = el && el.closest(
    '#bar-mode, #panel-mode, #notepad-overlay, #screenshot-modal, #session-modal, #settings-modal'
  );
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

  /** @param {HTMLElement} host @param {string} source */
  function fillTooltip(host, source) {
    host.replaceChildren();
    const lines = source.split(/<br\s*\/?>/i);
    lines.forEach((line, index) => {
      if (index) host.appendChild(document.createElement('br'));
      const re = /<kbd>(.*?)<\/kbd>/gi;
      let last = 0;
      let match;
      while ((match = re.exec(line))) {
        host.appendChild(document.createTextNode(line.slice(last, match.index)));
        const kbd = document.createElement('kbd');
        kbd.textContent = match[1];
        host.appendChild(kbd);
        last = match.index + match[0].length;
      }
      host.appendChild(document.createTextNode(line.slice(last)));
    });
  }

  /** @param {Element} el */
  function placeTooltip(el) {
    const text = /** @type {HTMLElement} */ (el).dataset.tip || '';
    fillTooltip(tip, text);
    tip.style.display = 'block';
    const rect = el.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const inBar = el.closest('#bar-mode');
    let left, top;
    if (inBar) {
      left = Math.max(8, rect.left - tipW - 8);
      top = rect.top + rect.height / 2 - tipH / 2;
    } else {
      left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      top = rect.top > 60 ? rect.top - tipH - 8 : rect.bottom + 8;
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  /** @param {Element} el */
  function scheduleTooltip(el) {
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => placeTooltip(el), 120);
  }

  function hideTooltip() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    tip.style.display = 'none';
  }

  document.addEventListener('mouseover', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    const el = target ? target.closest('[data-tip]') : null;
    if (el) scheduleTooltip(el);
  });

  document.addEventListener('mouseout', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    const el = target ? target.closest('[data-tip]') : null;
    if (!el) return;
    if (el.contains(document.activeElement)) return;
    hideTooltip();
  });

  document.addEventListener('focusin', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    const el = target ? target.closest('[data-tip]') : null;
    if (el) scheduleTooltip(el);
  });

  document.addEventListener('focusout', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (target && target.closest('[data-tip]')) hideTooltip();
  });
})();

// ── UI helpers (dialogs, announcements, stealth copy) ────────────────────────
const stealthCaptureSupported = process.platform === 'darwin' || process.platform === 'win32';
let barPreviewText = stealthCaptureSupported
  ? 'Stealth on — hidden from screen share'
  : 'Capture blocking is not available on this system';

/** @param {string} message */
function announce(message) {
  const live = document.getElementById('live-status');
  if (!live || !message) return;
  // Clearing first lets a repeated message be announced again. The timeout
  // covers a hidden window, where requestAnimationFrame may not run.
  const token = (announce.token = (announce.token || 0) + 1);
  live.textContent = '';
  const write = () => {
    if (announce.token !== token || live.textContent === message) return;
    live.textContent = message;
  };
  requestAnimationFrame(write);
  setTimeout(write, 60);
}

/** @param {string} [text] */
function updateBarPreview(text) {
  if (typeof text === 'string' && text.trim()) {
    barPreviewText = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  const el = document.getElementById('bar-preview');
  if (!el) return;
  if (!stealthCaptureSupported) {
    const isDefault = barPreviewText === 'Capture blocking is not available on this system';
    el.textContent = isDefault ? barPreviewText : `Not capture-protected · ${barPreviewText}`;
    return;
  }
  el.textContent = stealthOn ? barPreviewText : `VISIBLE · ${barPreviewText}`;
}

/** @type {HTMLElement | null} */
let modalReturnFocus = null;
/** @type {((e: KeyboardEvent) => void) | null} */
let focusTrapHandler = null;

function anyDialogOpen() {
  return ['notepad-overlay', 'screenshot-modal', 'session-modal', 'settings-modal'].some((id) => {
    const el = document.getElementById(id);
    return el instanceof HTMLElement && el.style.display === 'flex';
  });
}

/** @param {boolean} on */
function setBackgroundInert(on) {
  ['bar-mode', 'panel-mode'].forEach((id) => {
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) el.inert = on;
  });
}

function releaseFocusTrap() {
  if (focusTrapHandler) document.removeEventListener('keydown', focusTrapHandler);
  focusTrapHandler = null;
}

/** @param {HTMLElement} modal */
function trapFocus(modal) {
  releaseFocusTrap();
  focusTrapHandler = (e) => {
    if (e.key !== 'Tab' || modal.style.display === 'none') return;
    const nodes = Array.from(modal.querySelectorAll('button, input, select, textarea, a[href]'))
      .filter((node) => node instanceof HTMLElement && !node.hasAttribute('disabled') && node.getClientRects().length > 0);
    if (!nodes.length) return;
    const first = /** @type {HTMLElement} */ (nodes[0]);
    const last = /** @type {HTMLElement} */ (nodes[nodes.length - 1]);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', focusTrapHandler);
}

/**
 * @param {HTMLElement} modal
 * @param {string} [focusSelector]
 */
function openModal(modal, focusSelector) {
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  setBackgroundInert(true);
  const preferred = focusSelector ? modal.querySelector(focusSelector) : null;
  const focusEl = preferred instanceof HTMLElement
    ? preferred
    : modal.querySelector('input, select, textarea, button');
  if (focusEl instanceof HTMLElement) {
    try {
      focusEl.focus({ focusVisible: true });
    } catch {
      focusEl.focus();
    }
  }
  trapFocus(modal);
}

function topOpenDialog() {
  const ids = ['settings-modal', 'session-modal', 'screenshot-modal', 'notepad-overlay'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el instanceof HTMLElement && el.style.display === 'flex') return el;
  }
  return null;
}

/** @param {HTMLElement} modal */
function closeModal(modal) {
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  releaseFocusTrap();
  const next = topOpenDialog();
  if (next) {
    setBackgroundInert(true);
    trapFocus(next);
    const focusEl = next.querySelector('input, select, textarea, button');
    if (focusEl instanceof HTMLElement) {
      try { focusEl.focus({ focusVisible: true }); }
      catch { focusEl.focus(); }
    }
    return;
  }
  setBackgroundInert(false);
  if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
  modalReturnFocus = null;
}

function dropEmptyHint(id) {
  const hint = document.getElementById(id);
  if (hint) hint.remove();
}

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
  const saveStatus = document.getElementById('notepad-save-status');
  if (saveStatus) saveStatus.textContent = saved ? 'Saved on this device' : 'Notes save on this device';

  if (process.platform === 'darwin') {
    document.querySelectorAll('[data-tip]').forEach((el) => {
      if (el instanceof HTMLElement && el.dataset.tip) {
        el.dataset.tip = el.dataset.tip.replaceAll('Ctrl+', '⌘');
      }
    });
  }

  // Prevent double-click on drag regions from maximizing/zooming the window
  document.querySelectorAll('.panel-header, #bar-mode').forEach((el) => {
    el.addEventListener('dblclick', (e) => e.preventDefault());
  });
});

/** @type {ReturnType<typeof setTimeout> | null} */
let notepadSaveTimer = null;
notepad.addEventListener('input', () => {
  localStorage.setItem('notepad-content', notepad.value);
  const saveStatus = document.getElementById('notepad-save-status');
  if (saveStatus) saveStatus.textContent = 'Saving…';
  if (notepadSaveTimer) clearTimeout(notepadSaveTimer);
  notepadSaveTimer = setTimeout(() => {
    if (saveStatus) saveStatus.textContent = 'Saved on this device';
  }, 250);
});

// ── Window controls ───────────────────────────────────────────────────────────
if (minimizeBtn) minimizeBtn.addEventListener('click', () => ipcRenderer.send('minimize'));
if (closeBtn)    closeBtn.addEventListener('click',    () => ipcRenderer.send('close'));

const stealthToggleBtn = document.getElementById('stealth-toggle-btn');
let stealthOn = true;

function applyStealthButtonState() {
  const unsupported = !stealthCaptureSupported;
  document.body.classList.toggle('stealth-off', stealthCaptureSupported && !stealthOn);
  document.body.classList.toggle('stealth-unsupported', unsupported);

  const badges = [
    document.getElementById('stealth-badge'),
    document.getElementById('bar-stealth-badge'),
  ];
  const badgeCopy = unsupported
    ? ['Not protected', 'Not protected']
    : ['On screen', 'On screen'];
  badges.forEach((badge, index) => {
    if (!(badge instanceof HTMLElement)) return;
    badge.hidden = stealthCaptureSupported && stealthOn;
    badge.textContent = badgeCopy[index];
  });

  const barIcon = document.getElementById('bar-click-area');
  if (barIcon) {
    barIcon.textContent = stealthOn && !unsupported ? '🔒' : '🔓';
    barIcon.setAttribute('aria-label', unsupported
      ? 'Screen-capture blocking is not available on this system'
      : (stealthOn ? 'Stealth on' : 'Stealth off, visible in screen share'));
  }

  if (!stealthToggleBtn) {
    updateBarPreview();
    return;
  }
  const protectedOn = stealthOn && !unsupported;
  stealthToggleBtn.textContent = protectedOn ? '🔒' : '🔓';
  stealthToggleBtn.style.color = protectedOn ? 'rgba(74,222,128,0.95)' : 'rgba(254,202,202,0.98)';
  stealthToggleBtn.style.borderColor = protectedOn ? 'rgba(74,222,128,0.45)' : 'rgba(248,113,113,0.75)';
  const label = unsupported
    ? 'Screen-capture blocking is not available on Linux. This control does not hide the window from screen share.'
    : (stealthOn
      ? 'Stealth on, hidden from screen share. Activate to show this window in screen share.'
      : 'Stealth off. This window can appear in screen share. Activate to hide it again.');
  stealthToggleBtn.title = label;
  stealthToggleBtn.setAttribute('aria-label', label);
  stealthToggleBtn.setAttribute('aria-pressed', stealthOn ? 'true' : 'false');
  updateBarPreview();
}
applyStealthButtonState();

if (stealthToggleBtn) {
  stealthToggleBtn.addEventListener('click', () => {
    ipcRenderer.send('toggle-stealth');
  });
}

ipcRenderer.on('stealth-changed', (_, enabled) => {
  stealthOn = enabled;
  applyStealthButtonState();
  if (!stealthCaptureSupported) {
    showNotification('Screen-capture blocking is not available on Linux', 'danger');
    return;
  }
  showNotification(
    enabled ? 'Stealth on — hidden from screen capture' : 'Stealth off — this window can appear in screen capture',
    enabled ? 'ok' : 'danger'
  );
});

// ── IPC from main ─────────────────────────────────────────────────────────────
ipcRenderer.on('clear-text', () => {
  notepad.value = '';
  localStorage.removeItem('notepad-content');
  const saveStatus = document.getElementById('notepad-save-status');
  if (saveStatus) saveStatus.textContent = 'Notes cleared';
  showNotification('Notes cleared');
});

ipcRenderer.on('opacity-changed', (_, opacity) => {
  const el = document.getElementById('opacity-display');
  if (!el) return;
  const pct = Math.round(Number(opacity) * 100);
  el.textContent = `${pct}%`;
  el.classList.toggle('opacity-low', Number(opacity) < 0.7);
  const hint = Number(opacity) < 1
    ? `Window opacity ${pct} percent. The whole window is dimmed, including text.`
    : 'Window opacity 100 percent.';
  el.title = hint;
  if (Number(opacity) <= 0.5) announce(hint);
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
  if (status) {
    status.style.background = '#4ade80';
    status.setAttribute('aria-label', `In room ${roomId}`);
  }
  updateCompanionStatus(roomId);
}

function onLeftRoom() {
  inRoom = false;
  const display = document.getElementById('room-id-display');
  const status  = document.getElementById('room-status');
  if (display) display.textContent = '—';
  if (status) {
    status.style.background = '#ef4444';
    status.setAttribute('aria-label', 'Not in a room');
  }
  updateCompanionStatus(null);
}

const createRoomBtn = document.getElementById('create-room-btn');
if (createRoomBtn) {
  createRoomBtn.addEventListener('click', () => {
    connectSocket();
    if (!socket) return;
    socket.emit('create-room', (/** @type {{ ok: boolean, roomId: string }} */ res) => {
      if (!res.ok) { showNotification('Could not create a room', 'warn'); return; }
      onJoinedRoom(res.roomId);
      showNotification(`Room ${res.roomId} created`);
    });
  });
}

const joinRoomBtn = document.getElementById('join-room-btn');
if (joinRoomBtn) {
  joinRoomBtn.addEventListener('click', () => {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('join-input'));
    const id = input ? input.value.trim().toUpperCase() : '';
    if (!id) { showNotification('Enter a room ID to join', 'warn'); return; }
    connectSocket();
    if (!socket) return;
    socket.emit('join-room', id, (/** @type {{ ok: boolean, error?: string }} */ res) => {
      if (!res.ok) { showNotification(`Room not found: ${id}`); return; }
      onJoinedRoom(id);
    });
  });
}

const roomIdDisplay = document.getElementById('room-id-display');
if (roomIdDisplay) {
  roomIdDisplay.title = 'Copy room ID';
  roomIdDisplay.style.cursor = 'pointer';
  roomIdDisplay.setAttribute('role', 'button');
  roomIdDisplay.tabIndex = 0;
  const copyRoomId = () => {
    const id = (roomIdDisplay.textContent || '').split(' ')[0];
    if (!id || id === '—') return;
    clipboard.writeText(id);
    showNotification('Room ID copied');
  };
  roomIdDisplay.addEventListener('click', copyRoomId);
  roomIdDisplay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyRoomId(); }
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

function openNotepad() {
  const overlay = document.getElementById('notepad-overlay');
  if (overlay instanceof HTMLElement) openModal(overlay, '#notepad');
}

function closeNotepad() {
  const overlay = document.getElementById('notepad-overlay');
  if (overlay instanceof HTMLElement) closeModal(overlay);
}

const notepadTabBtn = document.getElementById('notepad-tab-btn');
if (notepadTabBtn) notepadTabBtn.addEventListener('click', openNotepad);

const notepadCloseBtn = document.getElementById('notepad-close-btn');
if (notepadCloseBtn) notepadCloseBtn.addEventListener('click', closeNotepad);

const screenshotCloseBtn = document.getElementById('screenshot-close-btn');
if (screenshotCloseBtn) {
  screenshotCloseBtn.addEventListener('click', () => {
    const modal = document.getElementById('screenshot-modal');
    if (modal instanceof HTMLElement) closeModal(modal);
  });
}

const screenshotAnalyzeBtn = document.getElementById('screenshot-analyze-btn');
if (screenshotAnalyzeBtn) {
  screenshotAnalyzeBtn.addEventListener('click', () => {
    const modal = document.getElementById('screenshot-modal');
    if (modal instanceof HTMLElement) closeModal(modal);
    analyzeScreen();
  });
}

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
    appendTranscript(inRoom ? 'Screenshot captured and shared' : 'Screenshot captured', 'local');
    if (socket && inRoom) socket.emit('screenshot-share', { imageData, senderId: socket.id });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    appendTranscript(`Screenshot error: ${e.message}`, 'local', true);
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
  enterPanelMode();
  const modal = document.getElementById('screenshot-modal');
  if (modal instanceof HTMLElement) openModal(modal, '#screenshot-close-btn');
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

let whisperBlocked = false;

/**
 * Ask main whether nodejs-whisper can run. PR #3 returns
 * { ok, code, root, error } and { ok:false, code:'packed-in-asar' } for packaged builds.
 * A missing handler (main without that IPC) resolves as "try anyway".
 * @returns {Promise<boolean>}
 */
async function transcriptionRuntimeReady() {
  if (whisperBlocked) return false;
  /** @type {unknown} */
  let status = null;
  try {
    status = await ipcRenderer.invoke('get-whisper-status');
  } catch {
    return true;
  }
  if (status == null || typeof status !== 'object') return true;
  const ok = /** @type {{ ok?: unknown }} */ (status).ok;
  if (ok === true) return true;
  if (ok === false) {
    blockTranscription();
    return false;
  }
  return true;
}

function blockTranscription() {
  if (whisperBlocked) return;
  whisperBlocked = true;
  stopTranscription({ silent: true });
  appendTranscript('Transcription unavailable in this build', 'local', true);
}

async function processChunk() {
  if (!(await transcriptionRuntimeReady())) return;
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
      appendTranscript('Transcription engine is not installed. Run npm install, then npm run rebuild.', 'local', true);
      stopTranscription({ silent: true });
    } else {
      appendTranscript(`Transcription error: ${e.message}`, 'local', true);
    }
  } finally {
    fs.unlink(tmp, () => {});
  }
}

// ── Audio device management ────────────────────────────────────────────────────
/** @param {boolean} [requestPermission] */
async function populateAudioDevices(requestPermission = false) {
  const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('audio-device-select'));
  if (!select) return;
  try {
    // Permission is deferred until the user starts recording so a screen share
    // does not get an OS prompt the moment the window appears.
    if (requestPermission) {
      await navigator.mediaDevices.getUserMedia({ audio: true })
        .then((s) => s.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const previous = select.value;
    select.replaceChildren();
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
    if (previous && Array.from(select.options).some((opt) => opt.value === previous)) {
      select.value = previous;
    } else if (preferredId) {
      select.value = preferredId;
    }
    if (!select.options.length) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No audio inputs found';
      select.appendChild(empty);
    }
    const labelsAvailable = inputs.some((d) => d.label);
    // Show BlackHole hint on macOS if not found
    const hint = document.getElementById('blackhole-hint');
    if (hint) hint.style.display = (process.platform === 'darwin' && labelsAvailable && !blackholeFound) ? 'block' : 'none';
    const statusEl = document.getElementById('audio-device-status');
    if (statusEl) {
      const isSystem = select.value === '__desktop__' || (select.options[select.selectedIndex]?.text || '').startsWith('🔊');
      statusEl.style.display = isSystem ? 'inline' : 'none';
    }
  } catch (e) {
    select.replaceChildren();
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Audio devices unavailable';
    select.appendChild(opt);
    showNotification('Audio devices could not be listed', 'warn');
  }
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

/** @param {boolean} active */
function setRecordingUi(active) {
  const dot = document.getElementById('bar-rec-dot');
  if (dot instanceof HTMLElement) dot.style.display = active ? 'inline-block' : 'none';
  const barLabel = document.getElementById('bar-rec-label');
  const panelLabel = document.getElementById('panel-rec-label');
  if (barLabel instanceof HTMLElement) barLabel.hidden = !active;
  if (panelLabel instanceof HTMLElement) panelLabel.hidden = !active;
  if (transcriptBtn) {
    transcriptBtn.textContent = active ? '⏹ Stop' : '🎙 Record';
    transcriptBtn.style.color = active ? '#fecaca' : '#c4b5fd';
    transcriptBtn.style.borderColor = active ? '#f87171' : '#a78bfa';
    transcriptBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    transcriptBtn.setAttribute('aria-label', active ? 'Stop recording' : 'Start recording');
  }
}

async function startTranscription() {
  try {
    const stream = await getAudioStream();
    isTranscribing = true;
    setRecordingUi(true);
    announce('Recording started');
    recordChunk(stream);
    populateAudioDevices(false);
  } catch (err) {
    isTranscribing = false;
    setRecordingUi(false);
    const e = /** @type {Error} */ (err);
    appendTranscript(`Mic error: ${e.message}`, 'local', true);
  }
}

/** @param {{ silent?: boolean }} [options] */
function stopTranscription(options = {}) {
  isTranscribing = false;
  const recorder = mediaRecorder;
  if (recorder && recorder.state === 'recording') recorder.stop();
  if (recorder && recorder.stream) {
    recorder.stream.getTracks().forEach((track) => track.stop());
  }
  setRecordingUi(false);
  if (!options.silent) announce('Recording stopped');
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
/**
 * @param {string} text
 * @param {'local' | 'remote'} source
 * @param {boolean} [isError]
 */
function appendTranscript(text, source, isError = false) {
  if (!transcriptFeed) return;
  dropEmptyHint('transcript-empty');
  const entry = document.createElement('div');
  entry.className = `transcript-entry ${source}${isError ? ' error' : ''}`;
  const timeEl = document.createElement('span');
  timeEl.className = 'ts-time';
  timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const textEl = document.createElement('span');
  textEl.className = 'ts-text';
  textEl.textContent = text;
  entry.append(timeEl, textEl);
  transcriptFeed.appendChild(entry);
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
  if (isError) announce(text);
}

// ── Notifications ─────────────────────────────────────────────────────────────
/**
 * @param {string} message
 * @param {'ok' | 'warn' | 'danger'} [tone]
 */
function showNotification(message, tone = 'ok') {
  const el = document.createElement('div');
  el.textContent = message;
  el.setAttribute('aria-hidden', 'true');
  const background = tone === 'danger' ? '#b91c1c' : tone === 'warn' ? '#fbbf24' : '#4ade80';
  const color = tone === 'danger' ? '#fff' : '#111';
  el.style.cssText = `
    position:fixed; top:6px; right:8px; left:8px;
    background:${background}; color:${color};
    padding:10px 14px; border-radius:6px;
    font-size:12px; font-weight:600; z-index:1000;
    animation:slideIn 0.3s ease;
  `;
  document.body.appendChild(el);
  announce(message);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 2400);
}

// ── Init state ────────────────────────────────────────────────────────────────
updateCompanionStatus(null); // capture/transcript disabled until room joined; AI buttons always enabled

// ── AI Analysis ───────────────────────────────────────────────────────────────

let autoAnswerEnabled = true;
let aiAutoScroll = true;

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
  dropEmptyHint('ai-empty');

  const entry = document.createElement('div');
  entry.className = 'ai-entry';
  const timeEl = document.createElement('span');
  timeEl.className = 'ts-time';
  timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const textSpan = document.createElement('span');
  textSpan.className = 'ai-text';
  const thinking = document.createElement('span');
  thinking.className = 'ai-thinking';
  thinking.textContent = '···';
  textSpan.appendChild(thinking);
  entry.append(timeEl, textSpan);
  if (feed) feed.appendChild(entry);
  if (aiAutoScroll && feed) feed.scrollTop = feed.scrollHeight;

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
    if (textSpan) textSpan.textContent = '';
    await tryStream('openai/gpt-4o');
  }

  const preview = accumulated.replace(/[#*`]/g, ' ').replace(/\s+/g, ' ').trim();
  if (preview) {
    updateBarPreview(preview);
    announce('AI response ready');
  }
  return accumulated;
}

/** @param {boolean} loading */
function setAiLoading(loading) {
  aiLoading = loading;
  const btns = [
    analyzeScreenBtn,
    analyzeAudioBtn,
    analyzeBothBtn,
    document.getElementById('answer-question-btn'),
    document.getElementById('chat-send-btn'),
  ];
  btns.forEach((b) => { if (b instanceof HTMLButtonElement) b.disabled = loading; });
  const feed = document.getElementById('ai-feed');
  if (feed) feed.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function ensureApiKey() {
  if (openRouterApiKey) return true;
  appendAiEntry('Add an OpenRouter API key in Settings before asking the AI.', true);
  openSettings();
  return false;
}

/**
 * @param {string} text
 * @param {boolean} [isError]
 */
function appendAiEntry(text, isError = false) {
  const feed = document.getElementById('ai-feed');
  if (!feed) return;
  dropEmptyHint('ai-empty');
  const entry = document.createElement('div');
  entry.className = `ai-entry${isError ? ' error' : ''}`;
  const timeEl = document.createElement('span');
  timeEl.className = 'ts-time';
  timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const textEl = document.createElement('span');
  textEl.className = 'ai-text';
  if (isError) textEl.textContent = text;
  else textEl.innerHTML = renderMarkdown(text);
  entry.append(timeEl, textEl);
  feed.appendChild(entry);
  if (aiAutoScroll) feed.scrollTop = feed.scrollHeight;
  if (isError) announce(text);
  else updateBarPreview(text.replace(/[#*`]/g, ' '));
}

/** @param {string} text */
function appendUserEntry(text) {
  const feed = document.getElementById('ai-feed');
  if (!feed) return;
  dropEmptyHint('ai-empty');
  const entry = document.createElement('div');
  entry.className = 'ai-entry user';
  const timeEl = document.createElement('span');
  timeEl.className = 'ts-time';
  timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const textEl = document.createElement('span');
  textEl.className = 'ai-text';
  textEl.textContent = text;
  entry.append(timeEl, textEl);
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
  if (!ensureApiKey()) return;
  if (!lastScreenshotDataUrl) {
    appendAiEntry('No screenshot yet. Capture the screen first.', true);
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
  if (!ensureApiKey()) return;
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
  if (!ensureApiKey()) return;
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
    feed.replaceChildren();
    const hint = document.createElement('p');
    hint.id = 'ai-empty';
    hint.className = 'empty-hint';
    hint.textContent = 'AI context cleared. Ready for a fresh start.';
    feed.appendChild(hint);
  }
  lastScreenshotDataUrl = null;
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById('screenshot-img'));
  if (img) { img.src = ''; img.style.display = 'none'; }
  const ph = document.getElementById('screenshot-placeholder');
  if (ph) ph.style.display = 'block';
  const modal = document.getElementById('screenshot-modal');
  if (modal instanceof HTMLElement && modal.style.display === 'flex') closeModal(modal);
  announce('AI feed cleared');
}

ipcRenderer.on('clear-ai-feed', () => doClearAiFeed());

ipcRenderer.on('toggle-auto-answer', () => {
  autoAnswerEnabled = !autoAnswerEnabled;
  renderAutoAnswer();
});

ipcRenderer.on('toggle-auto-scroll', () => {
  aiAutoScroll = !aiAutoScroll;
  renderAutoScroll();
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
    if (sessionModal instanceof HTMLElement) openModal(sessionModal, '#session-company');
  });
}

if (sessionCancelBtn) {
  sessionCancelBtn.addEventListener('click', () => {
    if (sessionModal instanceof HTMLElement) closeModal(sessionModal);
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
    if (sessionModal instanceof HTMLElement) closeModal(sessionModal);
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

/** @param {number} seconds @param {string} label */
function paintTimer(seconds, label) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  ['session-timer', 'bar-timer'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = `${m}:${s}`;
    el.setAttribute('aria-label', label);
  });
}

function startTimer() {
  if (timerInterval) return;
  timerSeconds = 0;
  paintTimer(0, 'Session time 00:00');
  timerInterval = setInterval(() => {
    timerSeconds++;
    const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    paintTimer(timerSeconds, `Session time ${m}:${s}`);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  paintTimer(0, 'Session timer stopped');
}

// ── AI Auto-answer toggle ──────────────────────────────────────────────────────
function renderAutoAnswer() {
  const btn = document.getElementById('auto-answer-btn');
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.setAttribute('aria-pressed', autoAnswerEnabled ? 'true' : 'false');
  btn.textContent = autoAnswerEnabled ? '⚡ Auto' : '⚡ Off';
  btn.style.color = autoAnswerEnabled ? 'rgba(74,222,128,0.95)' : 'rgba(255,255,255,0.78)';
  btn.style.borderColor = autoAnswerEnabled ? 'rgba(74,222,128,0.45)' : 'rgba(255,255,255,0.28)';
  btn.style.background = autoAnswerEnabled ? 'rgba(74,222,128,0.12)' : 'transparent';
}

const autoAnswerBtn = document.getElementById('auto-answer-btn');
if (autoAnswerBtn) {
  autoAnswerBtn.addEventListener('click', () => {
    autoAnswerEnabled = !autoAnswerEnabled;
    renderAutoAnswer();
    announce(autoAnswerEnabled ? 'Auto-answer on' : 'Auto-answer off');
  });
}
renderAutoAnswer();

// ── AI Auto-scroll ─────────────────────────────────────────────────────────────
function renderAutoScroll() {
  const btn = document.getElementById('ai-autoscroll-btn');
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.setAttribute('aria-pressed', aiAutoScroll ? 'true' : 'false');
  btn.textContent = aiAutoScroll ? '↓ Auto' : '↓ Off';
  btn.style.color = aiAutoScroll ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.78)';
}

const aiAutoscrollBtn = document.getElementById('ai-autoscroll-btn');
if (aiAutoscrollBtn) {
  aiAutoscrollBtn.addEventListener('click', () => {
    aiAutoScroll = !aiAutoScroll;
    renderAutoScroll();
    announce(aiAutoScroll ? 'Auto-scroll on' : 'Auto-scroll off');
  });
}
renderAutoScroll();

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
  if (!ensureApiKey()) return;
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
  if (!ensureApiKey()) return;
  appendUserEntry(text);
  if (input) input.value = '';
  setAiLoading(true);
  try {
    const systemPrompt = buildSystemPrompt();
    await streamOpenRouter([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ]);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    if (input && !input.value) input.value = text;
    appendAiEntry(`Error: ${e.message}`, true);
  } finally {
    setAiLoading(false);
    if (input) input.focus();
  }
}

const chatSendBtn = document.getElementById('chat-send-btn');
const chatInput   = document.getElementById('chat-input');
if (chatSendBtn) chatSendBtn.addEventListener('click', () => sendChatMessage());
if (chatInput)   chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ── Settings modal ────────────────────────────────────────────────────────────
/**
 * Normalize save-api-key / clear-api-key results.
 * PR #3 returns { ok:true } or { ok:false, error }.
 * The previous main process returns { ok:true, encrypted } or, if a handler
 * returns nothing, undefined. A thrown invoke is handled by the caller.
 * @param {unknown} result
 * @returns {{ ok: true, legacy?: boolean, encrypted?: unknown } | { ok: false, error: string }}
 */
function readIpcAck(result) {
  if (result == null) return { ok: true, legacy: true };
  if (typeof result !== 'object') return { ok: false, error: '' };
  const rec = /** @type {{ ok?: unknown, error?: unknown, encrypted?: unknown }} */ (result);
  if (rec.ok === true) return { ok: true, encrypted: rec.encrypted };
  if (rec.ok === false) return { ok: false, error: typeof rec.error === 'string' ? rec.error : '' };
  return { ok: false, error: '' };
}

/** @type {Record<string, string>} */
const SAVE_KEY_ERRORS = {
  unauthorized: 'The key was not saved. This window is not allowed to store it.',
  'invalid-key': 'The key was not saved. Enter a key and try again.',
  'encryption-unavailable': 'The key was not saved. OS encryption is unavailable, so the key would not be protected.',
  'write-failed': 'The key was not saved. It could not be written to disk.',
};

/** @type {Record<string, string>} */
const CLEAR_KEY_ERRORS = {
  unauthorized: 'The key was not cleared. This window is not allowed to remove it.',
  'unlink-failed': 'The key was not cleared. The saved file could not be removed.',
};

/**
 * @param {string} code
 * @param {Record<string, string>} table
 * @param {string} fallback
 */
function apiKeyErrorMessage(code, table, fallback) {
  return (code && table[code]) || fallback;
}

/**
 * @param {string} [message]
 * @param {boolean} [isError]
 */
function refreshApiKeyStatus(message, isError = false) {
  const status = document.getElementById('api-key-status');
  if (!status) return;
  status.textContent = message || (openRouterApiKey ? 'A key is saved on this device.' : 'No key saved yet.');
  status.classList.toggle('is-error', Boolean(isError) && Boolean(message));
}

/** @param {HTMLInputElement | null} input @param {string} message */
function showApiKeyError(input, message) {
  refreshApiKeyStatus(message, true);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-errormessage', 'api-key-status');
    input.focus();
  }
  showNotification(message, 'danger');
}

function openSettings() {
  const modal = document.getElementById('settings-modal');
  const input = document.getElementById('api-key-input');
  if (input) input.removeAttribute('aria-invalid');
  refreshApiKeyStatus();
  if (modal instanceof HTMLElement) openModal(modal, '#api-key-input');
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal instanceof HTMLElement) closeModal(modal);
}

const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

const settingsCancelBtn = document.getElementById('settings-cancel-btn');
if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettings);

const settingsSaveBtn = document.getElementById('settings-save-btn');
if (settingsSaveBtn) {
  settingsSaveBtn.addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById('api-key-input'));
    const key = input ? input.value.trim() : '';
    if (!key) {
      showApiKeyError(input, 'Enter a key before saving.');
      return;
    }
    settingsSaveBtn.disabled = true;
    try {
      const ack = readIpcAck(await ipcRenderer.invoke('save-api-key', key));
      if (!ack.ok) {
        showApiKeyError(input, apiKeyErrorMessage(ack.error, SAVE_KEY_ERRORS, 'The key was not saved.'));
        return;
      }
      openRouterApiKey = key;
      if (input) {
        input.value = '';
        input.removeAttribute('aria-invalid');
      }
      const savedWithoutEncryption = ack.encrypted === false;
      const message = savedWithoutEncryption
        ? 'API key saved without OS encryption.'
        : 'API key saved.';
      refreshApiKeyStatus(message);
      closeSettings();
      showNotification(message, savedWithoutEncryption ? 'warn' : 'ok');
    } catch {
      showApiKeyError(input, 'The key was not saved. The app could not finish storing it.');
    } finally {
      settingsSaveBtn.disabled = false;
    }
  });
}

const settingsClearBtn = document.getElementById('settings-clear-btn');
if (settingsClearBtn) {
  settingsClearBtn.addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById('api-key-input'));
    settingsClearBtn.disabled = true;
    try {
      const ack = readIpcAck(await ipcRenderer.invoke('clear-api-key'));
      if (!ack.ok) {
        showApiKeyError(input, apiKeyErrorMessage(ack.error, CLEAR_KEY_ERRORS, 'The key was not cleared.'));
        return;
      }
      openRouterApiKey = '';
      if (input) {
        input.value = '';
        input.removeAttribute('aria-invalid');
      }
      refreshApiKeyStatus('API key cleared.');
      closeSettings();
      showNotification('API key cleared.');
    } catch {
      showApiKeyError(input, 'The key was not cleared. The app could not finish removing it.');
    } finally {
      settingsClearBtn.disabled = false;
    }
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


