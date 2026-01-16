import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';

const PORT = 3001;

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: '*' } });

// Single pair: one viewer, one streamer
let viewerSocket: Socket | null = null;
let streamerSocket: Socket | null = null;

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

io.on('connection', (socket) => {
  log(`Client connected: ${socket.id}`);

  socket.on('register', (payload) => {
    const { role } = typeof payload === 'string' ? JSON.parse(payload) : payload;

    if (role === 'viewer') {
      viewerSocket = socket;
      log(`Viewer registered: ${socket.id}`);
    } else if (role === 'streamer') {
      streamerSocket = socket;
      log(`Streamer registered: ${socket.id}`);
    } else {
      log(`Unknown role: ${role}`);
    }
  });

  socket.on('offer', (data) => {
    if (streamerSocket) {
      log(`Forwarding offer from viewer to streamer`);
      streamerSocket.emit('offer', { offer: data.offer, viewerSocketId: socket.id });
    } else {
      log(`No streamer connected to forward offer`);
    }
  });

  socket.on('answer', (data) => {
    if (viewerSocket) {
      log(`Forwarding answer from streamer to viewer`);
      viewerSocket.emit('answer', data.answer);
    } else {
      log(`No viewer connected to forward answer`);
    }
  });

  socket.on('candidate', (data) => {
    const { to, candidate } = data;

    if (to === 'streamer' && streamerSocket) {
      log(`Forwarding ICE candidate to streamer`);
      streamerSocket.emit('candidate', { candidate });
    } else if (to === 'viewer' && viewerSocket) {
      log(`Forwarding ICE candidate to viewer`);
      viewerSocket.emit('candidate', { candidate });
    } else {
      log(`Cannot forward candidate to ${to} - not connected`);
    }
  });

  socket.on('disconnect', (reason) => {
    log(`Client disconnected: ${socket.id}, reason: ${reason}`);

    if (viewerSocket?.id === socket.id) {
      viewerSocket = null;
      log(`Viewer disconnected`);
    }
    if (streamerSocket?.id === socket.id) {
      streamerSocket = null;
      log(`Streamer disconnected`);
    }
  });
});

app.get('/', (_, res) => {
  res.json({
    status: 'running',
    viewer: viewerSocket ? { id: viewerSocket.id, connected: viewerSocket.connected } : null,
    streamer: streamerSocket ? { id: streamerSocket.id, connected: streamerSocket.connected } : null
  });
});

httpServer.listen(PORT, () => {
  log(`Signaling server running on http://localhost:${PORT}`);
});
