const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
  url: process.env.TURSO_AUDIT_URL,
  authToken: process.env.TURSO_AUDIT_TOKEN,
});

async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS registration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT, org_name TEXT, user_name TEXT,
      username TEXT, email TEXT, department TEXT, ip_address TEXT, user_agent TEXT,
      status TEXT, email_sent INTEGER, telegram_sent INTEGER, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT, user_id TEXT, username TEXT,
      action TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT, details TEXT,
      ip_address TEXT, user_agent TEXT, status TEXT, created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at)`
  ], 'write');
  console.log('✅ Audit DB initialized');
}

async function logRegistration(data) {
  await db.execute({
    sql: `INSERT INTO registration_logs (org_id, org_name, user_name, username, email, department, ip_address, user_agent, status, email_sent, telegram_sent, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [data.orgId, data.orgName, data.userName, data.username, data.email, data.department, data.ipAddress, data.userAgent, data.status, data.emailSent?1:0, data.telegramSent?1:0, Date.now()]
  });
}

async function logAudit(data) {
  await db.execute({
    sql: `INSERT INTO audit_logs (org_id, user_id, username, action, resource, resource_id, details, ip_address, user_agent, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [data.orgId, data.userId, data.username, data.action, data.resource, data.resourceId, JSON.stringify(data.details||{}), data.ipAddress, data.userAgent, data.status, Date.now()]
  });
}

module.exports = { db, init, logRegistration, logAudit };