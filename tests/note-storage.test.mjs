import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { loadRenderer } from './helpers/load-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTE = 'restored café 日本語 🧪';

let ctx;

function type(value) {
  ctx.notepad.value = value;
  ctx.notepad.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
}

beforeAll(() => {
  ctx = loadRenderer({ note: NOTE, platform: 'linux' });
});

afterAll(() => {
  ctx?.cleanup();
});

test('restores the saved note into the textarea on startup', () => {
  expect(ctx.notepad).toBeTruthy();
  expect(ctx.notepad.value).toBe(NOTE);
});

test('saves unicode, newlines, and the latest keystroke', () => {
  const text = 'café\n日本語\t🧪\nעברית\n∑';
  type('a');
  type('ab');
  type(text);
  expect(ctx.window.localStorage.getItem('notepad-content')).toBe(text);
  ctx.notepad.value = '';
  const saved = ctx.window.localStorage.getItem('notepad-content');
  if (saved) ctx.notepad.value = saved;
  expect(ctx.notepad.value).toBe(text);
});

test('saves an empty note and copies a non-empty note', () => {
  type('');
  expect(ctx.window.localStorage.getItem('notepad-content')).toBe('');
  type('  hello  ');
  ctx.listeners.get('save-to-clipboard')();
  expect(ctx.clipboard()).toBe('  hello  ');
});

test('a large note under the usual quota round-trips', () => {
  const text = 'あ'.repeat(300_000);
  type(text);
  expect(ctx.window.localStorage.getItem('notepad-content')).toBe(text);
});

test('clear-text removes the saved note', () => {
  type('keep me until clear');
  ctx.listeners.get('clear-text')();
  expect(ctx.notepad.value).toBe('');
  expect(ctx.window.localStorage.getItem('notepad-content')).toBeNull();
});

test('room typing does not overwrite the private note', () => {
  type('private');
  const room = ctx.document.getElementById('room-notepad');
  room.value = 'shared-only';
  room.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  expect(ctx.window.localStorage.getItem('notepad-content')).toBe('private');
});

test.fails('[known bug] typing still saves when localStorage throws (quota, disk full, read-only)', () => {
  const real = ctx.window.localStorage;
  const throwing = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'setItem') {
        return () => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true, writable: true });
  const marker = 'quota-should-not-drop-this';
  try {
    type(marker);
    // The handler must catch the quota error and still keep this keystroke.
    expect(real.getItem('notepad-content')).toBe(marker);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
  }
});

test.fails('[known bug] clear does not destroy a note the user cannot see', () => {
  type('invisible secret');
  ctx.listeners.get('clear-text')();
  expect(ctx.window.localStorage.getItem('notepad-content')).toBe('invisible secret');
});

test.fails('[known bug] shared room text is saved locally', () => {
  const room = ctx.document.getElementById('room-notepad');
  const text = 'room-only-note-7f3a';
  room.value = text;
  room.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  let found = false;
  for (let i = 0; i < ctx.window.localStorage.length; i++) {
    const key = ctx.window.localStorage.key(i);
    if (ctx.window.localStorage.getItem(key) === text) found = true;
  }
  expect(found).toBe(true);
});

test('a remote transcript cannot inject HTML', () => {
  ctx.document.getElementById('create-room-btn').click();
  const sock = ctx.sockets.at(-1);
  sock.handlers['transcript-update']({
    text: '<img id="pwn" src=x onerror="window.__pwned=1">',
    senderId: 'someone-else',
  });
  expect(ctx.document.getElementById('pwn')).toBeNull();
  expect(ctx.document.querySelector('#transcript-feed .ts-text').textContent).toContain('<img');
});

test('saving an API key surfaces a disk-full failure', async () => {
  ctx.setInvoke(async () => {
    throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
  });
  ctx.document.getElementById('api-key-input').value = 'sk-or-test';
  let unhandled = false;
  const onRejection = () => { unhandled = true; };
  process.on('unhandledRejection', onRejection);
  ctx.document.getElementById('settings-save-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  process.off('unhandledRejection', onRejection);
  expect(unhandled).toBe(false);
});

test('capturing a screenshot opens the preview', async () => {
  ctx.setInvoke(async (channel) => (
    channel === 'capture-screenshot' ? 'data:image/jpeg;base64,QQ==' : null
  ));
  ctx.document.getElementById('capture-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const modal = ctx.document.getElementById('screenshot-modal');
  expect(['flex', 'block']).toContain(modal.style.display);
});

test('the private notepad can be opened from the panel', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  expect(html).toContain('id="notepad-tab-btn"');
  ctx.document.getElementById('notepad-tab-btn').click();
  expect(ctx.document.getElementById('notepad-overlay').style.display).toBe('flex');
});

test('a recorder failure does not leave transcription marked on', () => {
  const src = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const start = src.indexOf('async function startTranscription');
  const end = src.indexOf('function stopTranscription');
  const body = src.slice(start, end);
  expect(body).toMatch(/catch[\s\S]*isTranscribing\s*=\s*false/);
});

test('Linux startup copy does not claim the window is hidden from screen share', () => {
  const label = ctx.document.getElementById('stealth-toggle-btn').getAttribute('aria-label');
  expect(label).toMatch(/not available/i);
  expect(label).not.toMatch(/hidden from screen share/i);
  expect(ctx.document.getElementById('bar-preview').textContent).toMatch(/not available/i);
});

test('startup lists audio devices without requesting a microphone', () => {
  const src = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  expect(src).toMatch(/DOMContentLoaded',\s*\(\)\s*=>\s*\{\s*populateAudioDevices\(\)\s*;?\s*\}/);
});

test.fails('[known bug] macOS stealth copy does not promise invisibility to ScreenCaptureKit', () => {
  const local = loadRenderer({ platform: 'darwin' });
  try {
    const label = local.document.getElementById('stealth-toggle-btn').getAttribute('aria-label');
    expect(label).not.toMatch(/hidden from screen share/i);
  } finally {
    local.cleanup();
  }
});
