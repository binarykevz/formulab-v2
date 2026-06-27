const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.FRONTEND_URL || '*', credentials: true }
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`🔌 Connected: ${user.username} (org: ${user.orgId})`);

    // Join org-specific room (multi-tenant isolation)
    socket.join(`org:${user.orgId}`);
    // Join department room
    socket.join(`org:${user.orgId}:dept:${user.department}`);
    // Purchasing gets special room
    if (user.department === 'PURCHASING') {
      socket.join(`org:${user.orgId}:purchasing`);
    }

    socket.on('disconnect', () => {
      console.log(`🔌 Disconnected: ${user.username}`);
    });
  });

  console.log('✅ Socket.IO initialized');
  return io;
}

function getIO() { return io; }

module.exports = { init, getIO };
// Re-export as default for convenience
module.exports.to = (...args) => io?.to(...args);
module.exports.emit = (...args) => io?.emit(...args);