const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();

const accountsDb = require('../db/accounts');
const { logRegistration } = require('../db/audit');
const { audit } = require('../middleware/audit');
const { authenticate } = require('../middleware/auth');
const emailService = require('../services/email.service');
const telegram = require('../services/telegram.service');

function genId() { return crypto.randomUUID(); }
function genSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// REGISTER
router.post('/register', audit('REGISTER', 'user'), async (req, res) => {
  try {
    const { name, username, email, organization, department } = req.body;
    const password = req.body.password;

    if (!name || !username || !email || !organization || !department || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const orgId = genId();
    const orgSlug = genSlug(organization) + '-' + Date.now().toString(36);
    const userId = genId();
    const now = Date.now();

    // Check if org slug exists
    const existingOrg = await accountsDb.db.execute({
      sql: 'SELECT id FROM organizations WHERE slug = ?', args: [orgSlug]
    });

    // For simplicity: each registration creates its own org.
    // In production, you'd have an "invite to org" flow.
    let finalOrgId, finalOrgName;
    if (existingOrg.rows.length > 0) {
      finalOrgId = existingOrg.rows[0].id;
      const orgRow = await accountsDb.db.execute({
        sql: 'SELECT name FROM organizations WHERE id = ?', args: [finalOrgId]
      });
      finalOrgName = orgRow.rows[0].name;
    } else {
      finalOrgId = orgId;
      finalOrgName = organization;
      await accountsDb.db.execute({
        sql: 'INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
        args: [orgId, organization, orgSlug, now]
      });
    }

    // Check username/email uniqueness within org
    const existingUser = await accountsDb.db.execute({
      sql: 'SELECT id FROM users WHERE org_id = ? AND (username = ? OR email = ?)',
      args: [finalOrgId, username, email]
    });
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists in this organization' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await accountsDb.db.execute({
      sql: `INSERT INTO users (id, org_id, name, username, email, department, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, finalOrgId, name, username, email, department, passwordHash, now]
    });

    const userData = {
      orgId: finalOrgId,
      orgName: finalOrgName,
      userName: name,
      username,
      email,
      department,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'SUCCESS',
      emailSent: false,
      telegramSent: false
    };

    // Send email (async, non-blocking)
    emailService.sendWelcomeEmail(userData).then(ok => {
      userData.emailSent = ok;
    }).catch(() => {});

    // Send Telegram (async, non-blocking)
    telegram.notifyNewRegistration(userData).then(ok => {
      userData.telegramSent = ok;
    }).catch(() => {});

    // Log to separate audit DB
    logRegistration(userData).catch(err => console.error('Reg log error:', err));

    res.status(201).json({
      message: 'Registration successful. Check your email.',
      userId,
      orgId: finalOrgId
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', detail: err.message });
  }
});

// LOGIN
router.post('/login', audit('LOGIN', 'user'), async (req, res) => {
  try {
    const { username, password, organization } = req.body;
    if (!username || !password || !organization) {
      return res.status(400).json({ error: 'Username, password, and organization required' });
    }

    // Find org
    const orgRes = await accountsDb.db.execute({
      sql: 'SELECT id, name FROM organizations WHERE name = ? OR slug = ?',
      args: [organization, genSlug(organization)]
    });
    if (orgRes.rows.length === 0) return res.status(401).json({ error: 'Invalid organization' });
    const org = orgRes.rows[0];

    // Find user in that org
    const userRes = await accountsDb.db.execute({
      sql: 'SELECT * FROM users WHERE org_id = ? AND username = ? AND is_active = 1',
      args: [org.id, username]
    });
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = userRes.rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Update last login
    await accountsDb.db.execute({
      sql: 'UPDATE users SET last_login = ? WHERE id = ?',
      args: [Date.now(), user.id]
    });

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        name: user.name,
        orgId: user.org_id,
        orgName: org.name,
        department: user.department,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        department: user.department,
        organization: org.name
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET CURRENT USER
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
