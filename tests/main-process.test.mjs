import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { bootMain, readAppFile } from './helpers/boot-main.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const open = [];

afterEach(() => {
  while (open.length) open.pop().cleanup();
});

async function withMain(platform, fn) {
  const ctx = await bootMain({ platform });
  open.push(ctx);
  await fn(ctx);
}

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to === -1 ? undefined : to);
}

test('main process creates a window on Windows, macOS, and Linux', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    await withMain(platform, async (ctx) => {
      expect(ctx.state.windows).toHaveLength(1);
      expect(ctx.state.exitCode).toBeUndefined();
    });
  }
});

test('Windows and macOS apply content protection and can turn it off', async () => {
  for (const platform of ['win32', 'darwin']) {
    await withMain(platform, async (ctx) => {
      const win = ctx.state.windows[0];
      expect(win.calls.some((c) => c[0] === 'setContentProtection' && c[1] === true)).toBe(true);
      ctx.state.shortcuts.get('CommandOrControl+Shift+V')();
      expect(win.calls.some((c) => c[0] === 'setContentProtection' && c[1] === false)).toBe(true);
    });
  }
});

test('Linux does not call setContentProtection', async () => {
  await withMain('linux', async (ctx) => {
    const win = ctx.state.windows[0];
    expect(win.calls.some((c) => c[0] === 'setContentProtection')).toBe(false);
  });
});

test('showing the window reapplies content protection', async () => {
  await withMain('darwin', async (ctx) => {
    const win = ctx.state.windows[0];
    const before = win.calls.filter((c) => c[0] === 'setContentProtection').length;
    ctx.state.shortcuts.get('CommandOrControl+Alt+N')();
    const after = win.calls.filter((c) => c[0] === 'setContentProtection').length;
    expect(after).toBeGreaterThan(before);
  });
});

test('Escape is registered only while the window is visible', async () => {
  await withMain('linux', async (ctx) => {
    expect(ctx.state.shortcuts.has('Escape')).toBe(false);
    ctx.state.shortcuts.get('CommandOrControl+Alt+N')();
    expect(ctx.state.shortcuts.has('Escape')).toBe(true);
    ctx.state.shortcuts.get('CommandOrControl+Alt+N')();
    expect(ctx.state.shortcuts.has('Escape')).toBe(false);
  });
});

test('a failed shortcut registration is not ignored', () => {
  const body = between(readAppFile('main.js'), 'function registerShortcut', 'function registerHotkeys');
  expect(body).toMatch(/const ok = globalShortcut\.register/);
  expect(body).toMatch(/if\s*\(\s*!ok\s*\)/);
});

test('navigation and extra windows are denied', () => {
  const main = readAppFile('main.js');
  expect(main).toMatch(/setWindowOpenHandler/);
  expect(main).toMatch(/will-navigate/);
  expect(main).toMatch(/will-redirect/);
});

test('the dev collab process is loopback Node and drops API keys from the environment', () => {
  const main = readAppFile('main.js');
  const body = between(main, 'function localServerEnv', 'function startLocalCollabServer');
  expect(body).toMatch(/ELECTRON_RUN_AS_NODE:\s*'1'/);
  expect(body).toMatch(/HOST:\s*'127\.0\.0\.1'/);
  expect(body).toMatch(/delete env\[key\]/);
  expect(main).toMatch(/SENSITIVE_ENV = \[[^\]]*OPEN_ROUTER_KEY/);
});

test('a packaged window does not enable DevTools', async () => {
  await withMain('linux', async (ctx) => {
    expect(ctx.state.windows[0].opts.webPreferences.devTools).toBe(false);
  });
});

test('IPC from another frame cannot save an API key', async () => {
  await withMain('linux', async (ctx) => {
    const result = await ctx.state.ipcHandlers.get('save-api-key')({}, 'sk-secret');
    expect(result).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(fs.existsSync(ctx.keyFile)).toBe(false);
  });
});

test('an encrypted API key round-trips, including unicode, and is not stored as text', async () => {
  await withMain('linux', async (ctx) => {
    const save = ctx.state.ipcHandlers.get('save-api-key');
    const load = ctx.state.ipcHandlers.get('load-api-key');
    const clear = ctx.state.ipcHandlers.get('clear-api-key');
    expect(await load(ctx.event)).toBeNull();
    const key = 'clé-🔑-sk';
    const saved = await save(ctx.event, key);
    expect(saved).toMatchObject({ ok: true, encrypted: true });
    const bytes = fs.readFileSync(ctx.keyFile);
    expect(bytes.toString('utf8')).not.toContain(key);
    expect(await load(ctx.event)).toBe(key);
    expect(await clear(ctx.event)).toMatchObject({ ok: true });
    expect(fs.existsSync(ctx.keyFile)).toBe(false);
    expect(await load(ctx.event)).toBeNull();
  });
});

test('a corrupt key file loads as empty instead of throwing', async () => {
  await withMain('linux', async (ctx) => {
    fs.writeFileSync(ctx.keyFile, Buffer.from('not-a-keychain-blob'));
    expect(await ctx.state.ipcHandlers.get('load-api-key')(ctx.event)).toBeNull();
  });
});

test('save-api-key rejects a non-string, an empty string, and an oversized key', async () => {
  await withMain('linux', async (ctx) => {
    const save = ctx.state.ipcHandlers.get('save-api-key');
    expect(await save(ctx.event, { steal: true })).toMatchObject({ ok: false, error: 'invalid-key' });
    expect(await save(ctx.event, '   ')).toMatchObject({ ok: false, error: 'invalid-key' });
    expect(await save(ctx.event, 'k'.repeat(513))).toMatchObject({ ok: false, error: 'invalid-key' });
    expect(fs.existsSync(ctx.keyFile)).toBe(false);
  });
});

test('an API key is not written when OS encryption is unavailable', async () => {
  await withMain('linux', async (ctx) => {
    ctx.state.encryptionAvailable = false;
    const result = await ctx.state.ipcHandlers.get('save-api-key')(ctx.event, 'sk-secret');
    expect(result).toMatchObject({ ok: false, error: 'encryption-unavailable' });
    expect(fs.existsSync(ctx.keyFile)).toBe(false);
  });
});

test('a full disk does not throw out of save-api-key', async () => {
  await withMain('linux', async (ctx) => {
    const original = fs.writeFileSync;
    fs.writeFileSync = () => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    };
    try {
      const result = ctx.state.ipcHandlers.get('save-api-key')(ctx.event, 'sk-secret');
      expect(result).toMatchObject({ ok: false, error: 'write-failed' });
    } finally {
      fs.writeFileSync = original;
    }
  });
});

test('the API key file is readable only by its owner', async () => {
  await withMain('linux', async (ctx) => {
    await ctx.state.ipcHandlers.get('save-api-key')(ctx.event, 'sk-secret');
    expect(fs.statSync(ctx.keyFile).mode & 0o777).toBe(0o600);
  });
});

test('screenshot capture returns a data URL, or null when there is no screen', async () => {
  await withMain('linux', async (ctx) => {
    const capture = ctx.state.ipcHandlers.get('capture-screenshot');
    expect(await capture(ctx.event)).toMatch(/^data:image\/jpeg;base64,/);
    ctx.state.sources = [];
    expect(await capture(ctx.event)).toBeNull();
  });
});

test('screenshot capture reports a source failure as null instead of throwing', async () => {
  await withMain('linux', async (ctx) => {
    ctx.electron.desktopCapturer.getSources = async () => {
      throw new Error('screen recording permission denied');
    };
    await expect(ctx.state.ipcHandlers.get('capture-screenshot')(ctx.event)).resolves.toBeNull();
  });
});

test('the mac build points at an entitlements file that exists and allows the microphone', () => {
  const pkg = JSON.parse(readAppFile('package.json'));
  expect(fs.existsSync(path.join(root, pkg.build.mac.entitlements))).toBe(true);
  expect(fs.existsSync(path.join(root, pkg.build.mac.entitlementsInherit))).toBe(true);
  const plist = readAppFile('entitlements.mac.plist');
  expect(plist).toMatch(/com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);
});

test.fails('[known bug] the window is created hidden', async () => {
  await withMain('darwin', async (ctx) => {
    expect(ctx.state.windows[0].opts.show).toBe(false);
  });
});

test.fails('[known bug] content protection is applied before the window is shown', async () => {
  await withMain('darwin', async (ctx) => {
    const win = ctx.state.windows[0];
    win.calls = win.calls.filter((c) => c[0] === 'hide' || c[0] === 'setContentProtection' || c[0] === 'show');
    win.calls.length = 0;
    ctx.state.shortcuts.get('CommandOrControl+Alt+N')();
    const showAt = win.calls.findIndex((c) => c[0] === 'show');
    const protectAt = win.calls.findIndex((c) => c[0] === 'setContentProtection' && c[1] === true);
    expect(showAt).toBeGreaterThanOrEqual(0);
    expect(protectAt).toBeGreaterThanOrEqual(0);
    expect(protectAt).toBeLessThan(showAt);
  });
});

test.fails('[known bug] the renderer is sandboxed', async () => {
  await withMain('linux', async (ctx) => {
    const prefs = ctx.state.windows[0].opts.webPreferences;
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).not.toBe(false);
  });
});

test('a second instance is refused', async () => {
  expect(readAppFile('main.js')).toMatch(/requestSingleInstanceLock/);
  await withMain('linux', async (ctx) => {
    expect(ctx.state.lockRequested).toBe(true);
  });
});

test('quit flushes note storage', async () => {
  expect(readAppFile('main.js')).toMatch(/flushStorageData/);
  await withMain('linux', async (ctx) => {
    ctx.state.ipcListeners.get('close')(ctx.event);
    expect(ctx.state.flushCount).toBe(1);
    for (const cb of ctx.state.appListeners.get('will-quit') || []) cb();
    expect(ctx.state.flushCount).toBe(2);
  });
});

test('API key writes are atomic', async () => {
  const body = between(readAppFile('main.js'), "ipcMain.handle('save-api-key'", "ipcMain.handle('load-api-key'");
  expect(body).toMatch(/renameSync|\brename\(/);
  expect(body).not.toMatch(/writeFileSync\(\s*KEY_FILE/);
  await withMain('linux', async (ctx) => {
    await ctx.state.ipcHandlers.get('save-api-key')(ctx.event, 'sk-secret');
    expect(fs.existsSync(ctx.keyFile)).toBe(true);
    expect(fs.existsSync(`${ctx.keyFile}.${process.pid}.tmp`)).toBe(false);
  });
});

test('screenshot capture uses the display the window is on', async () => {
  const body = between(readAppFile('main.js'), "ipcMain.handle('capture-screenshot'", "ipcMain.handle('save-api-key'");
  expect(body).toMatch(/getDisplayMatching|sources\.find/);
  expect(body).not.toMatch(/sources\[0\]/);
  await withMain('linux', async (ctx) => {
    const image = await ctx.state.ipcHandlers.get('capture-screenshot')(ctx.event);
    const expected = Buffer.from('current-display').toString('base64');
    expect(image).toBe(`data:image/jpeg;base64,${expected}`);
    const sourceId = await ctx.state.ipcHandlers.get('get-screen-source-id')(ctx.event);
    expect(sourceId).toBe('screen:2');
  });
});

test('snap uses the display the window is on', async () => {
  await withMain('linux', async (ctx) => {
    ctx.state.shortcuts.get('CommandOrControl+Alt+U')();
    const pos = ctx.state.windows[0].calls.find((c) => c[0] === 'setPosition');
    expect(pos).toEqual(['setPosition', 1930, 10]);
  });
});

test('show and hide is Ctrl/Cmd+Alt+N only', () => {
  const body = between(readAppFile('main.js'), 'function registerHotkeys', 'function setEscapeShortcut');
  expect(body).toMatch(/CommandOrControl\+Alt\+N/);
  expect(body).not.toMatch(/CommandOrControl\+Shift\+N/);
});
