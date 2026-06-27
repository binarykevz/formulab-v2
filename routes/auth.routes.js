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
// ============ FORGOT PASSWORD: REQUEST OTP ============
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests. Try again in 15 minutes.' },
  keyGenerator: (req) => `otp:${req.body.email}:${req.ip}`
});

router.post('/forgot-password', otpLimiter, audit('REQUEST_OTP', 'password_reset'), async (req, res) => {
  try {
    const { email, organization } = req.body;
    if (!email || !organization) {
      return res.status(400).json({ error: 'Email and organization required' });
    }

    // Find organization
    const orgRes = await accountsDb.db.execute({
      sql: 'SELECT id, name FROM organizations WHERE name = ? OR slug = ?',
      args: [organization, genSlug(organization)]
    });
    if (orgRes.rows.length === 0) {
      // Don't reveal if org exists — but still send generic response for security
      return res.json({ 
        message: 'If the email exists, an OTP has been sent.',
        // In dev mode, return OTP for testing
        ...(process.env.NODE_ENV === 'development' ? { dev_otp: null } : {})
      });
    }
    const org = orgRes.rows[0];

    // Find user
    const userRes = await accountsDb.db.execute({
      sql: 'SELECT * FROM users WHERE org_id = ? AND email = ? AND is_active = 1',
      args: [org.id, email]
    });
    if (userRes.rows.length === 0) {
      return res.json({ message: 'If the email exists, an OTP has been sent.' });
    }
    const user = userRes.rows[0];

    // Check for recent OTP (prevent spam)
    const recentOtp = await accountsDb.db.execute({
      sql: `SELECT created_at FROM password_resets 
            WHERE user_id = ? AND created_at > ? AND used = 0`,
      args: [user.id, Date.now() - (2 * 60 * 1000)] // 2 min cooldown
    });
    if (recentOtp.rows.length > 0) {
      const waitSec = Math.ceil((recentOtp.rows[0].created_at + 2*60*1000 - Date.now()) / 1000);
      return res.status(429).json({ 
        error: `Please wait ${waitSec} seconds before requesting another OTP` 
      });
    }

    // Invalidate any existing unused OTPs
    await accountsDb.db.execute({
      sql: `UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0`,
      args: [user.id]
    });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + (15 * 60 * 1000); // 15 minutes

    await accountsDb.db.execute({
      sql: `INSERT INTO password_resets 
            (id, org_id, user_id, email, otp, expires_at, ip_address, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, org.id, user.id, email, otp, expiresAt, req.ip, req.headers['user-agent'], now]
    });

    // Send OTP email
    const otpData = {
      userName: user.name,
      orgName: org.name,
      email: user.email,
      otp,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    };

    const emailSent = await emailService.sendOtpEmail(otpData);
    telegram.notifyPasswordReset(otpData, 'REQUEST').catch(()=>{});

    // Audit log
    logAudit({
      orgId: org.id,
      userId: user.id,
      username: user.username,
      action: 'REQUEST_OTP',
      resource: 'password_reset',
      details: { email: user.email, emailSent, ipAddress: req.ip },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      status: emailSent ? 'SUCCESS' : 'EMAIL_FAILED'
    }).catch(()=>{});

    res.json({ 
      message: 'OTP sent to your registered email',
      expiresAt,
      // Dev only: expose OTP for testing
      ...(process.env.NODE_ENV === 'development' ? { dev_otp: otp } : {})
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ============ VERIFY OTP & RESET PASSWORD ============
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many reset attempts. Try again later.' },
  keyGenerator: (req) => `reset:${req.body.email}:${req.ip}`
});

router.post('/reset-password', resetLimiter, audit('RESET_PASSWORD', 'password_reset'), async (req, res) => {
  try {
    const { email, organization, otp, newPassword } = req.body;
    if (!email || !organization || !otp || !newPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'OTP must be 6 digits' });
    }

    // Find org
    const orgRes = await accountsDb.db.execute({
      sql: 'SELECT id, name FROM organizations WHERE name = ? OR slug = ?',
      args: [organization, genSlug(organization)]
    });
    if (orgRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid OTP or email' });
    }
    const org = orgRes.rows[0];

    // Find valid OTP record
    const otpRes = await accountsDb.db.execute({
      sql: `SELECT pr.*, u.name, u.username, u.department 
            FROM password_resets pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.email = ? AND pr.org_id = ? AND pr.otp = ? AND pr.used = 0
            ORDER BY pr.created_at DESC LIMIT 1`,
      args: [email, org.id, otp]
    });

    if (otpRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid OTP or email' });
    }

    const record = otpRes.rows[0];
    const now = Date.now();

    // Check expiry
    if (record.expires_at < now) {
      await accountsDb.db.execute({
        sql: 'UPDATE password_resets SET used = 1 WHERE id = ?',
        args: [record.id]
      });
      return res.status(410).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Check attempts (max 5 wrong tries)
    if (record.attempts >= 5) {
      await accountsDb.db.execute({
        sql: 'UPDATE password_resets SET used = 1 WHERE id = ?',
        args: [record.id]
      });
      return res.status(429).json({ error: 'Too many invalid attempts. OTP invalidated.' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update user password
    await accountsDb.db.execute({
      sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
      args: [passwordHash, record.user_id]
    });

    // Mark OTP as used
    await accountsDb.db.execute({
      sql: 'UPDATE password_resets SET used = 1 WHERE id = ?',
      args: [record.id]
    });

    // Invalidate ALL other pending OTPs for this user
    await accountsDb.db.execute({
      sql: 'UPDATE password_resets SET used = 1 WHERE user_id = ? AND id != ?',
      args: [record.user_id, record.id]
    });

    // Send confirmation email
    const confirmData = {
      userName: record.name,
      orgName: org.name,
      email: record.email,
      ipAddress: req.ip
    };
    emailService.sendPasswordResetConfirmation(confirmData).catch(()=>{});
    telegram.notifyPasswordReset(confirmData, 'CHANGED').catch(()=>{});

    // Audit log
    logAudit({
      orgId: org.id,
      userId: record.user_id,
      username: record.username,
      action: 'RESET_PASSWORD',
      resource: 'password_reset',
      details: { email: record.email, ipAddress: req.ip },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'SUCCESS'
    }).catch(()=>{});

    res.json({ message: 'Password reset successfully. Please login with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ============ VERIFY OTP ONLY (for step-by-step UI) ============
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, organization, otp } = req.body;
    if (!email || !organization || !otp) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const orgRes = await accountsDb.db.execute({
      sql: 'SELECT id FROM organizations WHERE name = ? OR slug = ?',
      args: [organization, genSlug(organization)]
    });
    if (orgRes.rows.length === 0) return res.status(401).json({ error: 'Invalid' });

    const otpRes = await accountsDb.db.execute({
      sql: `SELECT id, expires_at, attempts FROM password_resets 
            WHERE email = ? AND org_id = ? AND otp = ? AND used = 0
            ORDER BY created_at DESC LIMIT 1`,
      args: [email, orgRes.rows[0].id, otp]
    });

    if (otpRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    const record = otpRes.rows[0];
    if (record.expires_at < Date.now()) {
      return res.status(410).json({ error: 'OTP expired' });
    }

    res.json({ valid: true, resetToken: record.id }); // Token to use in next step
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});
module.exports = router;
