require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const accountsDb = require('./db/accounts');
const inventoryDb = require('./db/inventory');
const auditDb = require('./db/audit');
const emailService = require('./services/email.service');
const telegram = require('./services/telegram.service');

const authRoutes = require('./routes/auth.routes');
const requestRoutes = require('./routes/request.routes');
const adminRoutes = require('./routes/admin.routes');
const server = http.createServer(app);
socketService.init(server);

const app = express();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  req.ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use('/api/', limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/admin', adminRoutes);

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
async function start() {
  try {
    await accountsDb.init();
    await inventoryDb.init();
    await auditDb.init();
    emailService.init();
    telegram.init();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`\n🚀 FIMS Backend running on http://localhost:${PORT}`);
      console.log(`📊 3 Turso databases connected (accounts, inventory, audit)`);
      console.log(`🔒 Multi-tenant isolation: ENABLED\n`);
    });
  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
}

start();