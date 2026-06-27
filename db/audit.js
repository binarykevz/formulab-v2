const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
  url: process.env.TURSO_AUDIT_URL,
  authToken: process.env.TURSO_AUDIT_TOKEN,
});

async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS registration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT,
      org_name TEXT,
      user_name TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      department TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      status TEXT DEFAULT 'SUCCESS',
      email_sent INTEGER DEFAULT 0,
      telegram_sent INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      status TEXT DEFAULT 'SUCCESS',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reg_org ON registration_logs(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at)`,
  ], 'write');
  console.log('✅ Audit DB initialized (separate)');
}

async function logRegistration(data) {
  await db.execute({
    sql: `INSERT INTO registration_logs 
      (org_id, org_name, user_name, username, email, department, ip_address, user_agent, status, email_sent, telegram_sent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.orgId || null,
      data.orgName || null,
      data.userName,
      data.username,
      data.email,
      data.department,
      data.ipAddress || null,
      data.userAgent || null,
      data.status || 'SUCCESS',
      data.emailSent ? 1 : 0,
      data.telegramSent ? 1 : 0,
      Date.now()
    ]
  });
}

async function logAudit(data) {
  await db.execute({
    sql: `INSERT INTO audit_logs 
      (org_id, user_id, username, action, resource, resource_id, details, ip_address, user_agent, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.orgId || null,
      data.userId || null,
      data.username || 'SYSTEM',
      data.action,
      data.resource,
      data.resourceId || null,
      JSON.stringify(data.details || {}),
      data.ipAddress || null,
      data.userAgent || null,
      data.status || 'SUCCESS',
      Date.now()
    ]
  });
}

module.exports = { db, init, logRegistration, logAudit };
