import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Execute the real renderer.js against index.html in jsdom.
 * Electron and socket.io-client are stubbed; nothing is edited in the app.
 * @param {{ note?: string, platform?: NodeJS.Platform }} [options]
 */
export function loadRenderer(options = {}) {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (options.platform) {
    Object.defineProperty(process, 'platform', { value: options.platform, configurable: true });
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    const message = err && err.message ? err.message : String(err);
    // The quota test deliberately trips an uncaught listener error.
    if (message.includes('QuotaExceededError')) return;
    console.error(err);
  });
  const dom = new JSDOM(html, { url: 'http://127.0.0.1/', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      async getUserMedia() {
        return { getTracks: () => [{ stop() {} }] };
      },
      async enumerateDevices() { return []; },
    },
  });

  const raf = (cb) => setTimeout(() => cb(Date.now()), 0);
  const cancelRaf = (id) => clearTimeout(id);
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = cancelRaf;

  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    requestAnimationFrame: raf,
    cancelAnimationFrame: cancelRaf,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLImageElement: window.HTMLImageElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Element: window.Element,
    Node: window.Node,
  };
  const previous = {};
  for (const [key, value] of Object.entries(globals)) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }

  if (options.note != null) {
    window.localStorage.setItem('notepad-content', options.note);
  }

  const sockets = [];
  const sent = [];
  const listeners = new Map();
  let invokeImpl = async () => null;
  let clipboardText = '';

  const ipcRenderer = {
    invoke: (...args) => invokeImpl(...args),
    send(channel, ...args) { sent.push([channel, ...args]); },
    on(channel, cb) { listeners.set(channel, cb); },
  };

  function ioConnect() {
    const handlers = {};
    const sock = {
      id: 'sock-self',
      handlers,
      on(event, cb) { handlers[event] = cb; },
      emit(event, payload, cb) {
        if (typeof payload === 'function') {
          cb = payload;
          payload = undefined;
        }
        if (event === 'create-room' && typeof cb === 'function') cb({ ok: true, roomId: 'ABC123' });
        if (event === 'join-room' && typeof cb === 'function') cb({ ok: true });
      },
    };
    sockets.push(sock);
    return sock;
  }

  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === 'electron') {
      return {
        ipcRenderer,
        clipboard: { writeText(text) { clipboardText = text; } },
      };
    }
    if (id === 'socket.io-client') return { io: ioConnect };
    return originalRequire.apply(this, arguments);
  };

  const rendererPath = path.join(root, 'renderer.js');
  try {
    delete require.cache[rendererPath];
    require(rendererPath);
  } finally {
    Module.prototype.require = originalRequire;
  }

  window.dispatchEvent(new window.Event('DOMContentLoaded'));

  return {
    window,
    document: window.document,
    notepad: window.document.getElementById('notepad'),
    listeners,
    sockets,
    sent,
    setInvoke(fn) { invokeImpl = fn; },
    clipboard: () => clipboardText,
    cleanup() {
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
      window.close();
    },
  };
}
