import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const originalPlatform = process.platform;

function setPlatform(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function restorePlatform() {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
}

/**
 * Load main.js with a fake Electron so stealth, IPC, and key storage
 * can be exercised without a display or the electron package.
 * @param {{ platform?: string, encryptionAvailable?: boolean }} [options]
 */
export async function bootMain(options = {}) {
  const platform = options.platform || originalPlatform;
  setPlatform(platform);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'stealth-qa-'));
  const state = {
    windows: [],
    shortcuts: new Map(),
    ipcHandlers: new Map(),
    ipcListeners: new Map(),
    appListeners: new Map(),
    encryptionAvailable: options.encryptionAvailable !== false,
    sources: [{
      id: 'screen:0',
      thumbnail: { toJPEG: () => Buffer.from('jpeg-bytes') },
    }],
    dockHidden: false,
    releaseReady: () => {},
  };

  class BrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.calls = [];
      this.webContents = {
        send: (channel, ...args) => this.calls.push(['send', channel, ...args]),
        focus() {},
        on() {},
      };
      state.windows.push(this);
    }
    setContentProtection(enable) { this.calls.push(['setContentProtection', enable]); }
    isContentProtected() { return this.calls.some((c) => c[0] === 'setContentProtection' && c[1] === true); }
    setAlwaysOnTop() { this.calls.push(['setAlwaysOnTop']); }
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() { this.calls.push(['setIgnoreMouseEvents']); }
    loadFile() {}
    hide() { this.calls.push(['hide']); }
    show() { this.calls.push(['show']); }
    focus() {}
    setOpacity() {}
    getSize() { return [400, 52]; }
    setSize() {}
    setPosition() {}
    getNativeWindowHandle() { return Buffer.alloc(8); }
    isDestroyed() { return false; }
    on() {}
    static getAllWindows() { return state.windows; }
  }

  const electron = {
    app: {
      isPackaged: true,
      dock: { hide() { state.dockHidden = true; } },
      getPath(name) {
        if (name === 'userData') return userData;
        throw new Error(`unexpected getPath(${name})`);
      },
      whenReady() {
        return new Promise((resolve) => { state.releaseReady = resolve; });
      },
      on(event, cb) {
        const list = state.appListeners.get(event) || [];
        list.push(cb);
        state.appListeners.set(event, list);
      },
      quit() { state.quit = true; },
      exit(code) { state.exitCode = code; },
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler(handler) { state.permissionHandler = handler; },
      },
    },
    BrowserWindow,
    globalShortcut: {
      register(accel, cb) {
        state.shortcuts.set(accel, cb);
        return true;
      },
      unregister(accel) { state.shortcuts.delete(accel); },
      unregisterAll() { state.shortcuts.clear(); },
    },
    ipcMain: {
      on(channel, cb) { state.ipcListeners.set(channel, cb); },
      handle(channel, cb) { state.ipcHandlers.set(channel, cb); },
    },
    safeStorage: {
      isEncryptionAvailable: () => state.encryptionAvailable,
      encryptString(value) {
        if (typeof value !== 'string') throw new TypeError('encryptString expects a string');
        const body = Buffer.from(value, 'utf8');
        for (let i = 0; i < body.length; i++) body[i] ^= 0xff;
        return Buffer.concat([Buffer.from('ENC'), body]);
      },
      decryptString(buf) {
        const data = Buffer.from(buf);
        if (data.length < 4 || data.subarray(0, 3).toString('utf8') !== 'ENC') {
          throw new Error('unable to decrypt');
        }
        const body = Buffer.from(data.subarray(3));
        for (let i = 0; i < body.length; i++) body[i] ^= 0xff;
        return body.toString('utf8');
      },
    },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    },
    desktopCapturer: {
      getSources: async () => state.sources,
    },
  };

  const listenerEvents = ['uncaughtException', 'unhandledRejection', 'exit'];
  const listenersBefore = new Map(listenerEvents.map((event) => [event, new Set(process.listeners(event))]));

  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === 'electron') return electron;
    return originalRequire.apply(this, arguments);
  };

  const mainPath = path.join(root, 'main.js');
  try {
    delete require.cache[mainPath];
    require(mainPath);
  } finally {
    Module.prototype.require = originalRequire;
  }

  state.releaseReady();
  await new Promise((resolve) => setImmediate(resolve));
  if (state.windows.length !== 1) {
    throw new Error(`main.js did not create a window on ${platform}`);
  }

  const win = state.windows[0];
  return {
    state,
    electron,
    userData,
    keyFile: path.join(userData, 'api-key.enc'),
    event: {
      sender: win.webContents,
      senderFrame: { url: pathToFileURL(path.join(root, 'index.html')).href },
    },
    cleanup() {
      restorePlatform();
      for (const event of listenerEvents) {
        for (const listener of process.listeners(event)) {
          if (!listenersBefore.get(event).has(listener)) process.removeListener(event, listener);
        }
      }
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
}

export function readAppFile(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}
