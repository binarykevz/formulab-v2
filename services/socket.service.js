const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
let io;

function init(httpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } });
  io.use((socket, next) => {
    try {
      socket.user = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
      next();
    } catch (e) { next(new Error('Auth failed')); }
  });
  io.on('connection', (socket) => {
    socket.join(`org:${socket.user.orgId}`);
    if (socket.user.department === 'PURCHASING') socket.join(`org:${socket.user.orgId}:purchasing`);
  });
  console.log('✅ Socket.IO ready');
}
module.exports = { init, getIO: () => io };