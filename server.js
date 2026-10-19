'use strict';

const { createServer } = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = resolvePort(process.env.PORT || '4444');
const HOST = resolveHost();

const ROOM_ID_RE = /^[A-Z0-9]{6}$/;
const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MAX_ROOMS = 500;
const MAX_MEMBERS = 32;
const MAX_TEXT = 200_000;
const MAX_TRANSCRIPT = 16_000;
const MAX_IMAGE = 4_000_000;

const rooms = new Map(); // roomId -> Set of socket ids
const buckets = new Map(); // rate-limit key -> { count, reset }
const joinTimes = [];

function resolvePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('[room-server] invalid PORT');
    process.exit(1);
  }
  return port;
}

function resolveHost() {
  const fromEnv = process.env.HOST && process.env.HOST.trim();
  if (fromEnv) {
    if (fromEnv.length > 255 || !/^[\w.:%-]+$/.test(fromEnv)) {
      console.error('[room-server] invalid HOST');
      process.exit(1);
    }
    return fromEnv;
  }
  // Railway sets PORT and reaches the process on all interfaces. The Electron
  // child always sets HOST=127.0.0.1. A bare `node server.js` stays on loopback.
  return process.env.PORT ? '0.0.0.0' : '127.0.0.1';
}

function extraOrigins() {
  return (process.env.COLLAB_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  // The Electron renderer is a file:// page, which Chromium reports as the
  // origin "null" or file://. A missing Origin is not allowed here; the
  // socket middleware accepts it only when the shared secret matches.
  if (origin === 'null' || (typeof origin === 'string' && origin.startsWith('file://'))) return true;
  if (!origin) return false;
  return extraOrigins().includes(origin);
}

function sharedSecret() {
  const value = process.env.COLLAB_SHARED_SECRET;
  return typeof value === 'string' ? value : '';
}

function tokensEqual(expected, supplied) {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(typeof supplied === 'string' ? supplied : '', 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(auth) {
  if (!auth || typeof auth !== 'object') return '';
  return typeof auth.token === 'string' ? auth.token : '';
}

function missingOriginAuthorized(auth) {
  const expected = sharedSecret();
  if (!expected) return false;
  return tokensEqual(expected, presentedToken(auth));
}

function makeId() {
  const alphabet = ROOM_ALPHABET;
  const size = alphabet.length;
  // Rejection sampling: discard bytes that would bias the remainder.
  const limit = 256 - (256 % size);
  let id = '';
  while (id.length < 6) {
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < bytes.length && id.length < 6; i++) {
      if (bytes[i] < limit) id += alphabet[bytes[i] % size];
    }
  }
  return id;
}

function rateLimit(id, bucket, limit, windowMs) {
  const now = Date.now();
  const key = `${id}\0${bucket}`;
  let entry = buckets.get(key);
  if (!entry || now >= entry.reset) {
    entry = { count: 0, reset: now + windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= limit;
}

function clearRates(id) {
  const prefix = `${id}\0`;
  for (const key of buckets.keys()) {
    if (key.startsWith(prefix)) buckets.delete(key);
  }
}

function allowGlobalJoin() {
  const now = Date.now();
  while (joinTimes.length && now - joinTimes[0] > 10_000) joinTimes.shift();
  if (joinTimes.length >= 100) return false;
  joinTimes.push(now);
  return true;
}

function ack(cb, payload) {
  if (typeof cb !== 'function') return;
  try {
    cb(payload);
  } catch (err) {
    console.error('[room-server] ack failed', err && err.message);
  }
}

function writeText(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const httpServer = createServer((req, res) => {
  const pathOnly = (req.url || '/').split('?')[0];
  if ((req.method === 'GET' || req.method === 'HEAD') && pathOnly === '/health') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? '' : 'ok');
    return;
  }
  writeText(res, 404, 'not found');
});

httpServer.requestTimeout = 15_000;
httpServer.headersTimeout = 10_000;

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      // Missing Origin is decided in the socket middleware, where the shared
      // secret is available. A present, disallowed origin is still refused.
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      console.error('[room-server] rejected origin');
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
  },
  allowRequest(req, callback) {
    const origin = req.headers && req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) return callback('origin not allowed', false);
    return callback(null, true);
  },
  maxHttpBufferSize: 5 * 1024 * 1024,
});

function leaveRoom(socket, roomId) {
  if (!roomId) return;
  const room = rooms.get(roomId);
  socket.leave(roomId);
  if (!room) return;
  room.delete(socket.id);
  if (room.size === 0) {
    rooms.delete(roomId);
    return;
  }
  io.to(roomId).emit('room-members', room.size);
}

io.use((socket, next) => {
  try {
    const origin = socket.handshake.headers && socket.handshake.headers.origin;
    if (isAllowedOrigin(origin)) return next();
    if (!origin && missingOriginAuthorized(socket.handshake.auth)) return next();
    return next(new Error('unauthorized'));
  } catch (err) {
    console.error('[room-server] auth failed', err && err.message);
    return next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const state = { room: null };

  socket.on('error', (err) => {
    console.error('[room-server] socket error', err && err.message);
  });

  socket.on('create-room', (cb) => {
    try {
      if (!rateLimit(socket.id, 'create', 5, 60_000) || !allowGlobalJoin()) {
        return ack(cb, { ok: false, error: 'rate-limited' });
      }
      if (rooms.size >= MAX_ROOMS) {
        return ack(cb, { ok: false, error: 'capacity' });
      }
      leaveRoom(socket, state.room);
      state.room = null;

      let id = makeId();
      for (let attempt = 0; attempt < 5 && rooms.has(id); attempt++) id = makeId();
      if (rooms.has(id)) return ack(cb, { ok: false, error: 'capacity' });

      rooms.set(id, new Set([socket.id]));
      socket.join(id);
      state.room = id;
      ack(cb, { ok: true, roomId: id });
      io.to(id).emit('room-members', 1);
    } catch (err) {
      console.error('[room-server] create-room failed', err && err.message);
      ack(cb, { ok: false, error: 'server-error' });
    }
  });

  socket.on('join-room', (roomId, cb) => {
    try {
      if (!rateLimit(socket.id, 'join', 10, 10_000) || !allowGlobalJoin()) {
        return ack(cb, { ok: false, error: 'rate-limited' });
      }
      if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) {
        return ack(cb, { ok: false, error: 'Room not found' });
      }
      const room = rooms.get(roomId);
      if (!room) return ack(cb, { ok: false, error: 'Room not found' });
      if (state.room === roomId) return ack(cb, { ok: true });
      if (room.size >= MAX_MEMBERS) return ack(cb, { ok: false, error: 'Room is full' });

      leaveRoom(socket, state.room);
      room.add(socket.id);
      socket.join(roomId);
      state.room = roomId;
      ack(cb, { ok: true });
      io.to(roomId).emit('room-members', room.size);
    } catch (err) {
      console.error('[room-server] join-room failed', err && err.message);
      ack(cb, { ok: false, error: 'server-error' });
    }
  });

  socket.on('text-update', (text) => {
    try {
      if (!state.room || typeof text !== 'string' || text.length > MAX_TEXT) return;
      if (!rateLimit(socket.id, 'text', 40, 1_000)) return;
      socket.to(state.room).emit('text-update', text);
    } catch (err) {
      console.error('[room-server] text-update failed', err && err.message);
    }
  });

  socket.on('screenshot-share', (data) => {
    try {
      if (!state.room || !data || typeof data !== 'object') return;
      if (!rateLimit(socket.id, 'screenshot', 5, 10_000)) return;
      const imageData = data.imageData;
      if (typeof imageData !== 'string' || imageData.length > MAX_IMAGE) return;
      if (!imageData.startsWith('data:image/')) return;
      socket.to(state.room).emit('screenshot-share', {
        imageData,
        senderId: socket.id,
      });
    } catch (err) {
      console.error('[room-server] screenshot-share failed', err && err.message);
    }
  });

  socket.on('transcript-update', (data) => {
    try {
      if (!state.room || !data || typeof data !== 'object') return;
      if (!rateLimit(socket.id, 'transcript', 20, 10_000)) return;
      const text = data.text;
      if (typeof text !== 'string' || !text || text.length > MAX_TRANSCRIPT) return;
      socket.to(state.room).emit('transcript-update', {
        text,
        senderId: socket.id,
      });
    } catch (err) {
      console.error('[room-server] transcript-update failed', err && err.message);
    }
  });

  socket.on('typing', () => {
    try {
      if (!state.room || !rateLimit(socket.id, 'typing', 20, 1_000)) return;
      socket.to(state.room).emit('typing', { senderId: socket.id });
    } catch (err) {
      console.error('[room-server] typing failed', err && err.message);
    }
  });

  socket.on('stop-typing', () => {
    try {
      if (!state.room || !rateLimit(socket.id, 'typing', 20, 1_000)) return;
      socket.to(state.room).emit('stop-typing', { senderId: socket.id });
    } catch (err) {
      console.error('[room-server] stop-typing failed', err && err.message);
    }
  });

  socket.on('leave-room', () => {
    try {
      leaveRoom(socket, state.room);
      state.room = null;
    } catch (err) {
      console.error('[room-server] leave-room failed', err && err.message);
    }
  });

  socket.on('disconnect', () => {
    try {
      leaveRoom(socket, state.room);
      state.room = null;
      clearRates(socket.id);
    } catch (err) {
      console.error('[room-server] disconnect cleanup failed', err && err.message);
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('[room-server] uncaughtException', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[room-server] unhandledRejection', reason);
});

httpServer.on('error', (err) => {
  console.error('[room-server] failed to listen', err && err.message);
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[room-server] listening on ${HOST}:${PORT}`);
});
