const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
  url: process.env.TURSO_INVENTORY_URL,
  authToken: process.env.TURSO_INVENTORY_TOKEN,
});

async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS purchase_requests (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, company_name TEXT NOT NULL, date TEXT NOT NULL,
      product_name TEXT NOT NULL, batch_no TEXT NOT NULL, requestor_id TEXT NOT NULL,
      requestor_name TEXT NOT NULL, department TEXT NOT NULL, grand_total REAL DEFAULT 0,
      status TEXT DEFAULT 'PENDING', decided_by TEXT, decided_at INTEGER, notes TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_request_items (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, org_id TEXT NOT NULL, raw_material TEXT NOT NULL,
      material_code TEXT NOT NULL, supplier TEXT NOT NULL, qty_sachet REAL NOT NULL,
      qty_total REAL NOT NULL, unit_cost REAL NOT NULL, total_cost REAL NOT NULL,
      FOREIGN KEY(request_id) REFERENCES purchase_requests(id)
    )`,
    `CREATE TABLE IF NOT EXISTS materials_master (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      supplier TEXT NOT NULL, unit TEXT DEFAULT 'g', unit_cost REAL DEFAULT 0, category TEXT,
      is_active INTEGER DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(org_id, code)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_req_org ON purchase_requests(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mat_org ON materials_master(org_id)`
  ], 'write');
  console.log('✅ Inventory DB initialized');
}

module.exports = { db, init };