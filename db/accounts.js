const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
  url: process.env.TURSO_ACCOUNTS_URL,
  authToken: process.env.TURSO_ACCOUNTS_TOKEN,
});

async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, username TEXT NOT NULL,
      email TEXT NOT NULL, department TEXT NOT NULL, password_hash TEXT NOT NULL,
      is_active INTEGER DEFAULT 1, created_at INTEGER NOT NULL, last_login INTEGER,
      FOREIGN KEY(org_id) REFERENCES organizations(id), UNIQUE(org_id, username), UNIQUE(org_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, department TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL, invited_by TEXT NOT NULL, invited_by_name TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING', expires_at INTEGER NOT NULL, accepted_at INTEGER,
      accepted_user_id TEXT, created_at INTEGER NOT NULL,
      FOREIGN KEY(org_id) REFERENCES organizations(id)
    )`,
    `CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL,
      otp TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0,
      ip_address TEXT, user_agent TEXT, created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token)`,
    `CREATE INDEX IF NOT EXISTS idx_reset_email ON password_resets(email)`
  ], 'write');
  console.log('✅ Accounts DB initialized');
}

module.exports = { db, init };