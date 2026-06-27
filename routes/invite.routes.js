const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const accountsDb = require('../db/accounts');
const { logRegistration } = require('../db/audit');
const { authenticate, requireDepartment } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const { audit } = require('../middleware/audit');
const emailService = require('../services/email.service');
const telegram = require('../services/telegram.service');
const io = require('../services/socket.service');

router.use(authenticate, tenantIsolation);

// CREATE INVITE (any dept can invite, but typically Purchasing/HR)
router.post('/', audit('CREATE_INVITE', 'invite'), async (req, res) => {
  try {
    const { email, department } = req.body;
    if (!email || !department) return res.status(400).json({ error: 'Email and department required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const validDepts = ['R&D','QA','PURCHASING','PRODUCTION','MARKETING','OTHERS'];
    if (!validDepts.includes(department)) {
      return res.status(400).json({ error: 'Invalid department' });
    }

    // Check if user already exists in org
    const existing = await accountsDb.db.execute({
      sql: 'SELECT id FROM users WHERE org_id = ? AND email = ?',
      args: [req.orgId, email]
    });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists in this organization' });
    }

    // Check for pending invite
    const pending = await accountsDb.db.execute({
      sql: "SELECT id FROM invites WHERE org_id = ? AND email = ? AND status = 'PENDING'",
      args: [req.orgId, email]
    });
    if (pending.rows.length > 0) {
      return res.status(409).json({ error: 'Invite already pending for this email' });
    }

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + (7 * 24 * 60 * 60 * 1000); // 7 days

    await accountsDb.db.execute({
      sql: `INSERT INTO invites (id, org_id, email, department, token, invited_by, invited_by_name, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, req.orgId, email, department, token, req.user.id, req.user.name, expiresAt, now]
    });

    // Send invite email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
    const acceptLink = `${frontendUrl}/accept-invite.html?token=${token}`;
    await emailService.sendInviteEmail({
      email,
      orgName: req.orgName,
      department,
      invitedByName: req.user.name,
      acceptLink,
      expiresAt
    });

    // Telegram notification
    telegram.send(`📨 <b>INVITE SENT</b>\n━━━━━━━━━━━━━━━\n🏢 ${req.orgName}\n📧 To: ${email}\n🏷️ Dept: ${department}\n👤 By: ${req.user.name}`).catch(()=>{});

    // Real-time notify org
    io.to(`org:${req.orgId}`).emit('invite:sent', { email, department, by: req.user.name });

    res.status(201).json({ id, message: 'Invite sent', expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// LIST INVITES (org-scoped)
router.get('/', async (req, res) => {
  try {
    const result = await accountsDb.db.execute({
      sql: `SELECT i.*, u.username as accepted_username 
            FROM invites i LEFT JOIN users u ON i.accepted_user_id = u.id
            WHERE i.org_id = ? ORDER BY i.created_at DESC LIMIT 100`,
      args: [req.orgId]
    });
    res.json({ invites: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// VALIDATE INVITE TOKEN (public)
router.get('/validate/:token', async (req, res) => {
  try {
    const result = await accountsDb.db.execute({
      sql: `SELECT i.*, o.name as org_name FROM invites i
            JOIN organizations o ON i.org_id = o.id
            WHERE i.token = ? AND i.status = 'PENDING'`,
      args: [req.params.token]
    });
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired invite' });
    }
    const invite = result.rows[0];
    if (invite.expires_at < Date.now()) {
      return res.status(410).json({ error: 'Invite has expired' });
    }
    res.json({
      valid: true,
      orgName: invite.org_name,
      email: invite.email,
      department: invite.department,
      invitedByName: invite.invited_by_name
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ACCEPT INVITE (register using token)
router.post('/accept', audit('ACCEPT_INVITE', 'invite'), async (req, res) => {
  try {
    const { token, name, username, password } = req.body;
    if (!token || !name || !username || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });

    // Validate invite
    const invRes = await accountsDb.db.execute({
      sql: `SELECT i.*, o.name as org_name FROM invites i
            JOIN organizations o ON i.org_id = o.id
            WHERE i.token = ? AND i.status = 'PENDING'`,
      args: [token]
    });
    if (invRes.rows.length === 0) return res.status(404).json({ error: 'Invalid invite' });
    const invite = invRes.rows[0];
    if (invite.expires_at < Date.now()) {
      return res.status(410).json({ error: 'Invite expired' });
    }

    // Check username uniqueness in org
    const userCheck = await accountsDb.db.execute({
      sql: 'SELECT id FROM users WHERE org_id = ? AND username = ?',
      args: [invite.org_id, username]
    });
    if (userCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Username taken in this org' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const now = Date.now();

    await accountsDb.db.execute({
      sql: `INSERT INTO users (id, org_id, name, username, email, department, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, invite.org_id, name, username, invite.email, invite.department, passwordHash, now]
    });

    await accountsDb.db.execute({
      sql: `UPDATE invites SET status = 'ACCEPTED', accepted_at = ?, accepted_user_id = ? WHERE id = ?`,
      args: [now, userId, invite.id]
    });

    // Send welcome email
    const userData = {
      orgId: invite.org_id, orgName: invite.org_name,
      userName: name, username, email: invite.email,
      department: invite.department, ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'SUCCESS', emailSent: false, telegramSent: false
    };
    emailService.sendWelcomeEmail(userData).then(ok => userData.emailSent = ok).catch(()=>{});
    telegram.notifyNewRegistration(userData).then(ok => userData.telegramSent = ok).catch(()=>{});
    logRegistration(userData).catch(()=>{});

    // Generate JWT
    const jwtToken = jwt.sign(
      { id: userId, username, name, orgId: invite.org_id, orgName: invite.org_name,
        department: invite.department, email: invite.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    io.to(`org:${invite.org_id}`).emit('user:joined', { name, username, department });

    res.json({
      token: jwtToken,
      user: { id: userId, name, username, email: invite.email, department: invite.department, organization: invite.org_name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// REVOKE INVITE
router.post('/:id/revoke', audit('REVOKE_INVITE', 'invite'), async (req, res) => {
  try {
    await accountsDb.db.execute({
      sql: "UPDATE invites SET status = 'REVOKED' WHERE id = ? AND org_id = ? AND status = 'PENDING'",
      args: [req.params.id, req.orgId]
    });
    res.json({ message: 'Invite revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;