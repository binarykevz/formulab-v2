const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
require('dotenv').config();

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const DATABASES = [
  { name: 'accounts', url: process.env.TURSO_ACCOUNTS_URL, token: process.env.TURSO_ACCOUNTS_TOKEN },
  { name: 'inventory', url: process.env.TURSO_INVENTORY_URL, token: process.env.TURSO_INVENTORY_TOKEN },
  { name: 'audit', url: process.env.TURSO_AUDIT_URL, token: process.env.TURSO_AUDIT_TOKEN },
];

async function backupDatabase(dbConfig) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${dbConfig.name}-${timestamp}.db`;
  const filepath = path.join(BACKUP_DIR, filename);

  try {
    // Connect to remote Turso
    const remote = createClient({ url: dbConfig.url, authToken: dbConfig.token });

    // Create local file-based client
    const local = createClient({ url: `file:${filepath}` });

    // Get all tables
    const tables = await remote.execute({
      sql: "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      args: []
    });

    for (const table of tables.rows) {
      // Create table locally
      await local.execute({ sql: table.sql, args: [] });

      // Copy data
      const data = await remote.execute({ sql: `SELECT * FROM "${table.name}"`, args: [] });
      if (data.rows.length > 0) {
        const cols = data.columns;
        const placeholders = cols.map(() => '?').join(',');
        for (const row of data.rows) {
          await local.execute({
            sql: `INSERT INTO "${table.name}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`,
            args: cols.map(c => row[c])
          });
        }
      }
    }

    await remote.close();
    await local.close();

    const stats = fs.statSync(filepath);
    console.log(`✅ Backup complete: ${filename} (${(stats.size/1024).toFixed(1)} KB)`);
    return { filename, size: stats.size, path: filepath };
  } catch (err) {
    console.error(`❌ Backup failed for ${dbConfig.name}:`, err.message);
    throw err;
  }
}

async function backupAll() {
  console.log(`\n🗄️  Starting backup at ${new Date().toISOString()}`);
  const results = [];
  for (const db of DATABASES) {
    if (!db.url) {
      console.warn(`⚠️  Skipping ${db.name} (not configured)`);
      continue;
    }
    try {
      const r = await backupDatabase(db);
      results.push({ ...r, status: 'success' });
    } catch (err) {
      results.push({ name: db.name, status: 'error', error: err.message });
    }
  }
  await cleanupOldBackups();
  return results;
}

async function cleanupOldBackups(keepDays = 30) {
  const cutoff = Date.now() - (keepDays * 24 * 60 * 60 * 1000);
  const files = fs.readdirSync(BACKUP_DIR);
  let deleted = 0;
  for (const f of files) {
    const fp = path.join(BACKUP_DIR, f);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(fp);
      deleted++;
    }
  }
  if (deleted) console.log(`🧹 Cleaned up ${deleted} old backup(s)`);
}

function scheduleBackups() {
  // Run daily at 2:00 AM
  const schedule = process.env.BACKUP_CRON || '0 2 * * *';
  cron.schedule(schedule, async () => {
    try {
      await backupAll();
    } catch (err) {
      console.error('Scheduled backup failed:', err);
    }
  }, { timezone: process.env.TZ || 'UTC' });
  console.log(`⏰ Backups scheduled: ${schedule}`);
}

// CLI mode
if (require.main === module) {
  backupAll().then(r => {
    console.log('\n📊 Backup Summary:');
    console.table(r);
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { backupAll, backupDatabase, scheduleBackups, cleanupOldBackups };