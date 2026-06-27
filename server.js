require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

// DB Init
const accountsDb = require('./db/accounts');
const inventoryDb = require('./db/inventory');
const auditDb = require('./db/audit');

// Services
const emailService = require('./services/email.service');
const telegram = require('./services/telegram.service');
const socketService = require('./services/socket.service');
const { scheduleBackups } = require('./services/backup.service');

// Routes
const authRoutes = require('./routes/auth.routes');
const inviteRoutes = require('./routes/invite.routes');
const requestRoutes = require('./routes/request.routes');
const materialsRoutes = require('./routes/materials.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate Limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    await accountsDb.init();
    await inventoryDb.init();
    await auditDb.init();
    
    emailService.init();
    telegram.init();
    socketService.init(server);
    scheduleBackups();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`\n🚀 FIMS v2.0 running on http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ENABLED`);
      console.log(`📊 Dashboard: http://localhost:${PORT}/admin-dashboard.html`);
      console.log(`🗄️  Backups: SCHEDULED\n`);
    });
  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
}

start();