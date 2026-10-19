require('dotenv').config();
const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, safeStorage, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');

let serverProcess = null;
/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
let isVisible = false;
let stealthEnabled = true;
let hotkeysRegistered = false;
let escapeRegistered = false;
let loggedProtection = false;

const OPACITY_LEVELS = [0.3, 0.5, 0.7, 1.0];
let opacityIndex = 3;

const WIN_BAR     = { width: 400,  height: 52  }; // collapsed bar
const WIN_BASE    = { width: 440,  height: 600 }; // AI panel only
const WIN_WITH_CP = { width: 720,  height: 600 }; // AI panel + room panel

const PADDING = 10; // gap from screen edge in pixels
const API_KEY_MAX = 512;
const SNAP_POSITIONS = new Set([
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]);
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'audioCapture',
  'speaker-selection',
]);
const SENSITIVE_ENV = ['OPEN_ROUTER_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'];

const KEY_FILE = path.join(app.getPath('userData'), 'api-key.enc');
const INDEX_FILE = path.normalize(path.join(__dirname, 'index.html'));

function log(...args) {
  console.error('[stealth-notepad]', ...args);
}

process.on('uncaughtException', (err) => {
  log('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  log('unhandledRejection', reason);
});

function isAppDocument(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return false;
  try {
    return path.normalize(fileURLToPath(url)) === INDEX_FILE;
  } catch (_) {
    return false;
  }
}

function fromMainWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!event || event.sender !== mainWindow.webContents) return false;
  let frameUrl = '';
  try {
    frameUrl = event.senderFrame ? event.senderFrame.url : '';
  } catch (_) {
    return false;
  }
  return isAppDocument(frameUrl);
}

/**
 * Capture exclusion for one window.
 * Electron's setContentProtection is the supported implementation:
 * Windows 10 2004+ removes the window (WDA_EXCLUDEFROMCAPTURE); older Windows
 * builds show a black rectangle (WDA_MONITOR). macOS sets NSWindowSharingNone.
 * Linux is a no-op inside Electron. The call does not report OS-level success.
 * @param {import('electron').BrowserWindow} win
 * @param {boolean} enable
 */
function applyContentProtection(win, enable) {
  if (!win || win.isDestroyed()) return { applied: false, reason: 'no-window' };
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    if (!loggedProtection) {
      loggedProtection = true;
      log('content protection is not supported on ' + process.platform + '; the window stays capturable');
    }
    return { applied: false, reason: 'unsupported-platform' };
  }
  try {
    win.setContentProtection(!!enable);
    if (enable && !loggedProtection) {
      loggedProtection = true;
      if (process.platform === 'win32') {
        const build = Number(os.release().split('.')[2] || 0);
        const mode = build >= 19041 ? 'WDA_EXCLUDEFROMCAPTURE' : 'WDA_MONITOR (black window in capture)';
        log('Windows content protection requested via setContentProtection;', mode);
      } else {
        log('macOS content protection requested via setContentProtection (NSWindowSharingNone); ScreenCaptureKit apps can still capture the window');
      }
    }
    return { applied: true };
  } catch (err) {
    log('setContentProtection failed', err);
    return { applied: false, reason: 'throw' };
  }
}

function applyStealthMode(enable) {
  stealthEnabled = !!enable;
  for (const win of BrowserWindow.getAllWindows()) {
    applyContentProtection(win, stealthEnabled);
  }
}

function logNativeHelper() {
  try {
    const helper = require('./native-helper');
    const status = helper && typeof helper.applyWindowDisplayAffinity === 'function'
      ? helper.applyWindowDisplayAffinity()
      : { available: false, reason: 'missing-export' };
    if (!status.available) {
      log('native capture addon not loaded (' + (status.reason || 'unavailable') + '); using Electron setContentProtection');
    }
  } catch (err) {
    log('native-helper failed to load; using Electron setContentProtection', err);
  }
}

/**
 * Snap the window to one of 6 named positions.
 * @param {'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'} pos
 */
function snapTo(pos) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!SNAP_POSITIONS.has(pos)) return;
  const { x: sx, y: sy, width: sw, height: sh } = screen.getPrimaryDisplay().workArea;
  const [ww, wh] = mainWindow.getSize();

  const centerX = sx + Math.round((sw - ww) / 2);
  const rightX  = sx + sw - ww - PADDING;
  const leftX   = sx + PADDING;
  const topY    = sy + PADDING;
  const botY    = sy + sh - wh - PADDING;

  const positions = {
    'top-left':      [leftX,   topY],
    'top-center':    [centerX, topY],
    'top-right':     [rightX,  topY],
    'bottom-left':   [leftX,   botY],
    'bottom-center': [centerX, botY],
    'bottom-right':  [rightX,  botY],
  };

  const target = positions[pos];
  mainWindow.setPosition(target[0], target[1]);
}

function hardenWebContents(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAppDocument(url)) {
      event.preventDefault();
      log('blocked navigation');
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppDocument(url)) {
      event.preventDefault();
      log('blocked redirect');
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.on('did-fail-load', (_event, code, description) => {
    log('page failed to load', code, description);
  });
}

function installSessionGuards() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ours = !!(mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents);
    callback(ours && ALLOWED_PERMISSIONS.has(permission));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIN_BAR.width,
    height: WIN_BAR.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    movable: false,
    webPreferences: {
      // renderer.js calls require('electron'), require('fs'), and process.env.
      // contextIsolation and sandbox stay off until a preload bridge exists.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
    ...(process.platform === 'win32' && { type: 'toolbar' }),
    ...(process.platform === 'darwin' && {
      visualEffectState: 'active',
      vibrancy: 'under-window',
    }),
  });

  // Always float above every app, visible on every Space/desktop
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through transparent areas — clicks pass to whatever app is underneath
  // Interactive elements (buttons, inputs) toggle this off via IPC
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Re-apply after the native window flags above; show/restore can drop it.
  applyStealthMode(true);

  mainWindow.loadFile('index.html');
  mainWindow.hide();
  registerHotkeys();
  startLocalCollabServer();

  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerShortcut(accelerator, handler) {
  try {
    const ok = globalShortcut.register(accelerator, () => {
      try {
        handler();
      } catch (err) {
        log('shortcut handler failed', accelerator, err);
      }
    });
    if (!ok) log('shortcut unavailable', accelerator);
  } catch (err) {
    log('shortcut register failed', accelerator, err);
  }
}

function registerHotkeys() {
  if (hotkeysRegistered) return;
  hotkeysRegistered = true;

  registerShortcut('CommandOrControl+Shift+N', () => toggleWindow());

  registerShortcut('CommandOrControl+Shift+C', () => {
    if (mainWindow && isVisible) mainWindow.webContents.send('clear-text');
  });

  registerShortcut('CommandOrControl+Shift+S', () => {
    if (mainWindow && isVisible) mainWindow.webContents.send('save-to-clipboard');
  });

  registerShortcut('CommandOrControl+Shift+R', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-room-panel');
  });

  registerShortcut('CommandOrControl+Shift+O', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    opacityIndex = (opacityIndex + 1) % OPACITY_LEVELS.length;
    const opacity = OPACITY_LEVELS[opacityIndex];
    mainWindow.setOpacity(opacity);
    if (stealthEnabled) applyContentProtection(mainWindow, true);
    mainWindow.webContents.send('opacity-changed', opacity);
  });

  // Ctrl+Shift+P - Toggle companion panel (inside notepad window)
  registerShortcut('CommandOrControl+Shift+P', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-companion');
  });

  // Ctrl+Shift+T - Toggle audio recording
  registerShortcut('CommandOrControl+Shift+T', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-transcription');
  });

  // Ctrl+Shift+I - Capture & share screenshot
  registerShortcut('CommandOrControl+Shift+I', () => {
    if (mainWindow) mainWindow.webContents.send('trigger-screenshot');
  });

  // Ctrl+Shift+A - Analyze both screenshot and transcript with AI
  registerShortcut('CommandOrControl+Shift+A', () => {
    if (mainWindow) mainWindow.webContents.send('trigger-ai-analyze');
  });

  // Cmd+Shift+, - Open settings panel
  registerShortcut('CommandOrControl+Shift+,', () => {
    if (mainWindow) mainWindow.webContents.send('open-settings');
  });

  // Cmd+Shift+X - Clear AI feed & reset context
  registerShortcut('CommandOrControl+Shift+X', () => {
    if (mainWindow) mainWindow.webContents.send('clear-ai-feed');
  });

  // Cmd+Shift+B - Toggle auto-answer
  registerShortcut('CommandOrControl+Shift+B', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-auto-answer');
  });

  // Cmd+Shift+L - Toggle auto-scroll
  registerShortcut('CommandOrControl+Shift+L', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-auto-scroll');
  });

  // Ctrl+Shift+V - Toggle stealth (make visible/hidden for screen sharing)
  registerShortcut('CommandOrControl+Shift+V', () => {
    applyStealthMode(!stealthEnabled);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stealth-changed', stealthEnabled);
  });

  // Snap shortcuts — globalShortcut is required because setIgnoreMouseEvents(true)
  // prevents the window from receiving keyboard focus on macOS.
  registerShortcut('CommandOrControl+Alt+U', () => snapTo('top-left'));
  registerShortcut('CommandOrControl+Alt+I', () => snapTo('top-center'));
  registerShortcut('CommandOrControl+Alt+O', () => snapTo('top-right'));
  registerShortcut('CommandOrControl+Alt+J', () => snapTo('bottom-left'));
  registerShortcut('CommandOrControl+Alt+K', () => snapTo('bottom-center'));
  registerShortcut('CommandOrControl+Alt+L', () => snapTo('bottom-right'));

  // Scroll AI feed shortcuts
  registerShortcut('CommandOrControl+Alt+[', () => {
    if (mainWindow) mainWindow.webContents.send('scroll-ai-feed', -150);
  });
  registerShortcut('CommandOrControl+Alt+]', () => {
    if (mainWindow) mainWindow.webContents.send('scroll-ai-feed', 150);
  });
}

function setEscapeShortcut(active) {
  if (active && !escapeRegistered) {
    try {
      escapeRegistered = globalShortcut.register('Escape', () => {
        try {
          if (mainWindow && isVisible) hideWindow();
        } catch (err) {
          log('shortcut handler failed', 'Escape', err);
        }
      });
      if (!escapeRegistered) log('shortcut unavailable', 'Escape');
    } catch (err) {
      escapeRegistered = false;
      log('shortcut register failed', 'Escape', err);
    }
    return;
  }
  if (!active && escapeRegistered) {
    globalShortcut.unregister('Escape');
    escapeRegistered = false;
  }
}

function toggleWindow() {
  if (!mainWindow) return;
  if (isVisible) hideWindow();
  else showWindow();
}

let hasShownOnce = false;

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!hasShownOnce) {
    snapTo('top-center');
    hasShownOnce = true;
  }
  // Disable mouse pass-through temporarily so the window can receive focus
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
  // Re-enable pass-through after focus is set (renderer's mousemove will manage it from here)
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  if (stealthEnabled) applyContentProtection(mainWindow, true);
  isVisible = true;
  // Escape is global; register it only while the notepad is on screen.
  setEscapeShortcut(true);
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  isVisible = false;
  setEscapeShortcut(false);
}

function localServerEnv() {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '127.0.0.1',
  };
  const requested = String(process.env.COLLAB_PORT || '4444');
  const port = Number(requested);
  env.PORT = Number.isInteger(port) && port >= 1 && port <= 65535 ? String(port) : '4444';
  for (const key of SENSITIVE_ENV) delete env[key];
  return env;
}

function startLocalCollabServer() {
  if (serverProcess || app.isPackaged || process.env.COLLAB_SERVER_URL) return;
  const serverPath = path.join(__dirname, 'server.js');
  try {
    serverProcess = spawn(process.execPath, [serverPath], {
      stdio: 'inherit',
      env: localServerEnv(),
      windowsHide: true,
    });
  } catch (err) {
    log('failed to spawn room server', err);
    serverProcess = null;
    return;
  }
  serverProcess.on('error', (err) => {
    log('room server error', err);
  });
  serverProcess.on('exit', (code, signal) => {
    if (code) log('room server exited', code, signal || '');
    serverProcess = null;
  });
}

function stopLocalCollabServer() {
  if (!serverProcess || serverProcess.killed) return;
  try {
    serverProcess.kill();
  } catch (err) {
    log('failed to stop room server', err);
  }
}

// app.exit() and a hard parent death skip will-quit; still reap the child.
process.on('exit', () => {
  if (!serverProcess || serverProcess.killed) return;
  try { serverProcess.kill(); } catch (_) { /* process is already tearing down */ }
});

// IPC handlers
ipcMain.on('minimize', (event) => {
  if (!fromMainWindow(event)) return;
  hideWindow();
});

ipcMain.on('close', (event) => {
  if (!fromMainWindow(event)) return;
  app.quit();
});

// Toggle click-through: false = interactive (hovering button), true = pass-through (hovering bg)
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (!fromMainWindow(event) || typeof ignore !== 'boolean') return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('resize-for-companion', (event, open) => {
  if (!fromMainWindow(event) || typeof open !== 'boolean') return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const size = open ? WIN_WITH_CP : WIN_BASE;
  mainWindow.setSize(size.width, size.height);
});

ipcMain.on('snap-window', (event, pos) => {
  if (!fromMainWindow(event) || typeof pos !== 'string') return;
  snapTo(pos);
});

ipcMain.on('toggle-stealth', (event) => {
  if (!fromMainWindow(event)) return;
  applyStealthMode(!stealthEnabled);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stealth-changed', stealthEnabled);
});

ipcMain.on('collapse-to-bar', (event) => {
  if (!fromMainWindow(event)) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSize(WIN_BAR.width, WIN_BAR.height);
});

ipcMain.on('expand-from-bar', (event) => {
  if (!fromMainWindow(event)) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSize(WIN_BASE.width, WIN_BASE.height);
});

ipcMain.handle('get-screen-source-id', async (event) => {
  if (!fromMainWindow(event)) return null;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length ? sources[0].id : null;
  } catch (err) {
    log('get-screen-source-id failed', err);
    return null;
  }
});

ipcMain.handle('capture-screenshot', async (event) => {
  if (!fromMainWindow(event)) return null;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (!sources.length) return null;
    return `data:image/jpeg;base64,${sources[0].thumbnail.toJPEG(65).toString('base64')}`;
  } catch (err) {
    log('capture-screenshot failed', err);
    return null;
  }
});

ipcMain.handle('save-api-key', (event, plaintext) => {
  if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
  if (typeof plaintext !== 'string') return { ok: false, error: 'invalid-key' };
  const key = plaintext.trim();
  if (!key || key.length > API_KEY_MAX) return { ok: false, error: 'invalid-key' };
  if (!safeStorage.isEncryptionAvailable()) {
    log('refusing to store API key; OS encryption is unavailable');
    return { ok: false, encrypted: false, error: 'encryption-unavailable' };
  }
  try {
    const encrypted = safeStorage.encryptString(key);
    fs.writeFileSync(KEY_FILE, encrypted, { mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch (_) { /* Windows ignores the mode bit */ }
    return { ok: true, encrypted: true };
  } catch (err) {
    log('save-api-key failed', err);
    return { ok: false, error: 'write-failed' };
  }
});

ipcMain.handle('load-api-key', (event) => {
  if (!fromMainWindow(event)) return null;
  if (!fs.existsSync(KEY_FILE)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    log('API key present but OS encryption is unavailable');
    return null;
  }
  try {
    const data = fs.readFileSync(KEY_FILE);
    return safeStorage.decryptString(data);
  } catch (err) {
    log('load-api-key failed', err);
    return null;
  }
});

ipcMain.handle('clear-api-key', (event) => {
  if (!fromMainWindow(event)) return { ok: false, error: 'unauthorized' };
  try {
    if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
    return { ok: true };
  } catch (err) {
    log('clear-api-key failed', err);
    return { ok: false, error: 'unlink-failed' };
  }
});

app.on('browser-window-created', (_event, win) => {
  hardenWebContents(win.webContents);
  const reapply = () => {
    if (stealthEnabled) applyContentProtection(win, true);
  };
  win.on('show', reapply);
  win.on('restore', reapply);
  reapply();
});

function logProcessGone(kind, details) {
  if (!details || details.reason === 'clean-exit' || details.reason === 'killed') return;
  log(kind, details.type || '', details.reason, details.exitCode);
}

app.on('render-process-gone', (_event, _webContents, details) => {
  logProcessGone('renderer gone', details);
});

app.on('child-process-gone', (_event, details) => {
  logProcessGone('child process gone', details);
});

app.whenReady().then(() => {
  installSessionGuards();
  logNativeHelper();
  if (app.dock) app.dock.hide(); // macOS: remove from Dock + Cmd+Tab switcher
  createWindow();
}).catch((err) => {
  log('failed to start', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopLocalCollabServer();
});
