const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 4444;
const rooms = new Map(); // roomId -> Set of socket IDs

const httpServer = createServer((req, res) => {
  // Health check for Railway
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  }
});
const io = new Server(httpServer, { cors: { origin: '*' } });

function makeId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  // @ts-ignore
  let currentRoom = null;

  socket.on('create-room', (cb) => {
    const id = makeId();
    rooms.set(id, new Set([socket.id]));
    socket.join(id);
    currentRoom = id;
    cb({ ok: true, roomId: id });
    io.to(id).emit('room-members', rooms.get(id).size);
  });

  socket.on('join-room', (roomId, cb) => {
    if (!rooms.has(roomId)) return cb({ ok: false, error: 'Room not found' });
    rooms.get(roomId).add(socket.id);
    socket.join(roomId);
    currentRoom = roomId;
    cb({ ok: true });
    io.to(roomId).emit('room-members', rooms.get(roomId).size);
  });

  socket.on('text-update', (text) => {
    // @ts-ignore
    if (currentRoom) socket.to(currentRoom).emit('text-update', text);
  });

  socket.on('screenshot-share', (data) => {
    // @ts-ignore
    if (currentRoom) socket.to(currentRoom).emit('screenshot-share', data);
  });

  socket.on('transcript-update', (data) => {
    // @ts-ignore
    if (currentRoom) socket.to(currentRoom).emit('transcript-update', data);
  });

  socket.on('typing', (data) => {
    // @ts-ignore
    if (currentRoom) socket.to(currentRoom).emit('typing', data);
  });

  socket.on('stop-typing', (data) => {
    // @ts-ignore
    if (currentRoom) socket.to(currentRoom).emit('stop-typing', data);
  });

  socket.on('leave-room', () => {
    // @ts-ignore
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.delete(socket.id);
        socket.leave(currentRoom);
        io.to(currentRoom).emit('room-members', room.size);
      }
      currentRoom = null;
    }
  });

  socket.on('disconnect', () => {
    // @ts-ignore
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.delete(socket.id);
        io.to(currentRoom).emit('room-members', room.size);
      }
    }
  });
});

httpServer.listen(PORT, () => console.log(`Room server on :${PORT}`));

