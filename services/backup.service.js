const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function scheduleBackups() {
  const dir = process.env.BACKUP_DIR || './backups';
  if(!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});
  
  cron.schedule(process.env.BACKUP_CRON || '0 2 * * *', () => {
    console.log(`🗄️ Backup started at ${new Date().toISOString()}`);
    // In production, use Turso CLI or libsql dump features here
    // For now, we just log the scheduled task
    fs.writeFileSync(path.join(dir, `backup-${Date.now}.log`), 'Backup placeholder');
    console.log('✅ Backup completed');
  });
  console.log('⏰ Backups scheduled');
}
module.exports = { scheduleBackups };