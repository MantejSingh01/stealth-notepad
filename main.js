require('dotenv').config();
const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, safeStorage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let serverProcess = null;
/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
let isVisible = false;
let stealthEnabled = true;

const OPACITY_LEVELS = [0.3, 0.5, 0.7, 1.0];
let opacityIndex = 3;

const WIN_BAR     = { width: 400,  height: 52  }; // collapsed bar
const WIN_BASE    = { width: 440,  height: 600 }; // AI panel only
const WIN_WITH_CP = { width: 720,  height: 600 }; // AI panel + room panel

const PADDING = 10; // gap from screen edge in pixels

/**
 * Snap the window to one of 6 named positions.
 * @param {'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right'} pos
 */
function snapTo(pos) {
  if (!mainWindow) return;
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

  const [tx, ty] = positions[pos] || positions['top-center'];
  mainWindow.setPosition(tx, ty);
}

function applyStealthMode(enable) {
  stealthEnabled = enable;
  if (!mainWindow) return;
  if (process.platform === 'darwin') {
    mainWindow.setContentProtection(enable);
  }
  if (process.platform === 'win32') {
    const { setWindowExStyle } = require('./native-helper');
    if (setWindowExStyle) setWindowExStyle(mainWindow.getNativeWindowHandle(), enable);
  }
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
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
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

  applyStealthMode(true);

  mainWindow.loadFile('index.html');
  mainWindow.hide();
  registerHotkeys();

  if (!app.isPackaged && !process.env.COLLAB_SERVER_URL) {
    const serverPath = path.join(__dirname, 'server.js');
    serverProcess = spawn(process.execPath, [serverPath], { stdio: 'inherit' });
  }


  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerHotkeys() {
  globalShortcut.register('CommandOrControl+Shift+N', () => toggleWindow());

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (mainWindow && isVisible) mainWindow.webContents.send('clear-text');
  });

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow && isVisible) mainWindow.webContents.send('save-to-clipboard');
  });

  globalShortcut.register('Escape', () => {
    if (mainWindow && isVisible) hideWindow();
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-room-panel');
  });

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (!mainWindow) return;
    opacityIndex = (opacityIndex + 1) % OPACITY_LEVELS.length;
    const opacity = OPACITY_LEVELS[opacityIndex];
    mainWindow.setOpacity(opacity);
    mainWindow.webContents.send('opacity-changed', opacity);
  });

  // Ctrl+Shift+P - Toggle companion panel (inside notepad window)
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-companion');
  });

  // Ctrl+Shift+T - Toggle audio recording
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-transcription');
  });

  // Ctrl+Shift+I - Capture & share screenshot
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) mainWindow.webContents.send('trigger-screenshot');
  });

  // Ctrl+Shift+A - Analyze both screenshot and transcript with AI
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (mainWindow) mainWindow.webContents.send('trigger-ai-analyze');
  });

  // Cmd+Shift+, - Open settings panel
  globalShortcut.register('CommandOrControl+Shift+,', () => {
    if (mainWindow) mainWindow.webContents.send('open-settings');
  });

  // Cmd+Shift+X - Clear AI feed & reset context
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    if (mainWindow) mainWindow.webContents.send('clear-ai-feed');
  });

  // Cmd+Shift+B - Toggle auto-answer
  globalShortcut.register('CommandOrControl+Shift+B', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-auto-answer');
  });

  // Cmd+Shift+L - Toggle auto-scroll
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    if (mainWindow) mainWindow.webContents.send('toggle-auto-scroll');
  });

  // Ctrl+Shift+V - Toggle stealth (make visible/hidden for screen sharing)
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    applyStealthMode(!stealthEnabled);
    if (mainWindow) mainWindow.webContents.send('stealth-changed', stealthEnabled);
  });

  // Snap shortcuts — globalShortcut is required because setIgnoreMouseEvents(true)
  // prevents the window from receiving keyboard focus on macOS.
  globalShortcut.register('CommandOrControl+Alt+U', () => snapTo('top-left'));
  globalShortcut.register('CommandOrControl+Alt+I', () => snapTo('top-center'));
  globalShortcut.register('CommandOrControl+Alt+O', () => snapTo('top-right'));
  globalShortcut.register('CommandOrControl+Alt+J', () => snapTo('bottom-left'));
  globalShortcut.register('CommandOrControl+Alt+K', () => snapTo('bottom-center'));
  globalShortcut.register('CommandOrControl+Alt+L', () => snapTo('bottom-right'));

  // Scroll AI feed shortcuts
  globalShortcut.register('CommandOrControl+Alt+[', () => {
    if (mainWindow) mainWindow.webContents.send('scroll-ai-feed', -150);
  });
  globalShortcut.register('CommandOrControl+Alt+]', () => {
    if (mainWindow) mainWindow.webContents.send('scroll-ai-feed', 150);
  });

}

function toggleWindow() {
  if (!mainWindow) return;
  if (isVisible) hideWindow();
  else showWindow();
}

let hasShownOnce = false;

function showWindow() {
  if (!mainWindow) return;
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
  isVisible = true;
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  isVisible = false;
}

// IPC handlers
ipcMain.on('minimize', () => hideWindow());
ipcMain.on('close', () => app.quit());

// Toggle click-through: false = interactive (hovering button), true = pass-through (hovering bg)
ipcMain.on('set-ignore-mouse', (_, ignore) => {
  if (mainWindow) mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('resize-for-companion', (_, open) => {
  if (!mainWindow) return;
  const size = open ? WIN_WITH_CP : WIN_BASE;
  mainWindow.setSize(size.width, size.height);
});

ipcMain.on('snap-window', (_, pos) => snapTo(pos));

ipcMain.on('toggle-stealth', () => {
  applyStealthMode(!stealthEnabled);
  if (mainWindow) mainWindow.webContents.send('stealth-changed', stealthEnabled);
});

ipcMain.on('collapse-to-bar', () => {
  if (!mainWindow) return;
  mainWindow.setSize(WIN_BAR.width, WIN_BAR.height);
});

ipcMain.on('expand-from-bar', () => {
  if (!mainWindow) return;
  mainWindow.setSize(WIN_BASE.width, WIN_BASE.height);
});

ipcMain.handle('get-screen-source-id', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.length ? sources[0].id : null;
});

ipcMain.handle('capture-screenshot', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 720 },
  });
  if (!sources.length) return null;
  return `data:image/jpeg;base64,${sources[0].thumbnail.toJPEG(65).toString('base64')}`;
});

const KEY_FILE = path.join(app.getPath('userData'), 'api-key.enc');

ipcMain.handle('save-api-key', (_, plaintext) => {
  if (!safeStorage.isEncryptionAvailable()) {
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

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // macOS: remove from Dock + Cmd+Tab switcher
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (serverProcess) serverProcess.kill();
});
