const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
  url: process.env.TURSO_ACCOUNTS_URL,
  authToken: process.env.TURSO_ACCOUNTS_TOKEN,
});

async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      department TEXT NOT NULL CHECK(department IN ('R&D','QA','PURCHASING','PRODUCTION','MARKETING','OTHERS')),
      password_hash TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_login INTEGER,
      FOREIGN KEY(org_id) REFERENCES organizations(id),
      UNIQUE(org_id, username),
      UNIQUE(org_id, email)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)`,
  ], 'write');
  console.log('✅ Accounts DB initialized');
}

module.exports = { db, init };
