import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { io } from 'socket.io-client';
import { readAppFile } from './helpers/boot-main.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sockets = new Set();
let child;
let baseUrl;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function connect() {
  const socket = io(baseUrl, { forceNew: true, timeout: 4000 });
  sockets.add(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 4000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function createRoom(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('create timeout')), 3000);
    socket.emit('create-room', (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function joinAndCount(socket, roomId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join timeout')), 3000);
    socket.once('room-members', (count) => {
      clearTimeout(timer);
      resolve(count);
    });
    socket.emit('join-room', roomId, (res) => {
      if (!res?.ok) {
        clearTimeout(timer);
        reject(new Error(res?.error || 'join failed'));
      }
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${buf}`)), 8000);
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${buf}`));
    });
  });
}, 20000);

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  if (child && !child.killed) child.kill('SIGKILL');
});

test('health check responds', async () => {
  const res = await fetch(`${baseUrl}/health`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('ok');
});

test('unicode room text is delivered only to members', async () => {
  const a = await connect();
  const created = await createRoom(a);
  expect(created.ok).toBe(true);
  const b = await connect();
  expect(await joinAndCount(b, created.roomId)).toBe(2);
  const text = 'café 日本語 🧪 עברית\nline';
  const got = new Promise((resolve) => b.once('text-update', resolve));
  a.emit('text-update', text);
  expect(await got).toBe(text);

  const outsider = await connect();
  let leaked = false;
  b.on('text-update', () => { leaked = true; });
  outsider.emit('text-update', 'not-in-room');
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(leaked).toBe(false);

  const missed = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no count')), 3000);
    outsider.emit('join-room', 'NOPE00', (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
  expect(missed).toEqual({ ok: false, error: 'Room not found' });
});

test('leaving a room updates the member count', async () => {
  const a = await connect();
  const created = await createRoom(a);
  const b = await connect();
  expect(await joinAndCount(b, created.roomId)).toBe(2);
  // The join broadcast can still be in flight toward A. Wait before listening.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const next = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no count')), 3000);
    a.once('room-members', (count) => {
      clearTimeout(timer);
      resolve(count);
    });
  });
  b.emit('leave-room');
  expect(await next).toBe(1);
});

test('creating a second room leaves the first', async () => {
  const a = await connect();
  const first = await createRoom(a);
  const second = await createRoom(a);
  expect(second.ok).toBe(true);
  expect(second.roomId).not.toBe(first.roomId);
  const b = await connect();
  const missed = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join timeout')), 3000);
    b.emit('join-room', first.roomId, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
  expect(missed).toEqual({ ok: false, error: 'Room not found' });
  expect(await joinAndCount(b, second.roomId)).toBe(2);
});

test('room ids are 6-character codes from crypto bytes', async () => {
  const a = await connect();
  const created = await createRoom(a);
  expect(created.roomId).toMatch(/^[A-Z0-9]{6}$/);
  const makeId = betweenServer('function makeId', 'function rateLimit');
  expect(makeId).toMatch(/crypto\.randomBytes/);
  expect(makeId).not.toMatch(/Math\.random/);
});

test.fails('[known bug] the collab server rejects a client with no credential', async () => {
  const socket = io(baseUrl, { forceNew: true, timeout: 2000, auth: {} });
  sockets.add(socket);
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 2000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve('connected');
    });
    socket.on('connect_error', () => {
      clearTimeout(timer);
      resolve('rejected');
    });
  });
  socket.disconnect();
  expect(outcome).toBe('rejected');
});

test('unknown HTTP routes get a response', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 400);
  try {
    const res = await fetch(`${baseUrl}/nope`, { signal: controller.signal });
    expect(res.status).toBe(404);
  } finally {
    clearTimeout(timer);
  }
});

test('the room server handles listen errors', () => {
  expect(readAppFile('server.js')).toMatch(/httpServer\.on\(\s*['"]error['"]/);
});

test('a missing ack callback does not take down the room server', async () => {
  const a = await connect();
  a.emit('create-room');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const res = await fetch(`${baseUrl}/health`);
  expect(res.status).toBe(200);
});

test.fails('[known bug] a missing Origin is not treated as allowed', () => {
  const body = betweenServer('function isAllowedOrigin', 'function makeId');
  expect(body).not.toMatch(/if\s*\(\s*!origin\s*\)\s*return true/);
});

test.fails('[known bug] room ids are not biased by modulo against the alphabet', () => {
  const body = betweenServer('function makeId', 'function rateLimit');
  expect(body).not.toMatch(/%\s*ROOM_ALPHABET\.length/);
});

function betweenServer(start, end) {
  const source = readAppFile('server.js');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to === -1 ? undefined : to);
}
