const express = require('express');
const router = express.Router();

const { db: auditDb } = require('../db/audit');
const { authenticate, requireDepartment } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');

router.use(authenticate, tenantIsolation);

// View audit logs (tenant-scoped)
router.get('/audit', requireDepartment('PURCHASING', 'QA', 'R&D'), async (req, res) => {
  try {
    const { limit = 100, action, user_id, from, to } = req.query;
    let sql = 'SELECT * FROM audit_logs WHERE org_id = ?';
    const args = [req.orgId];

    if (action) { sql += ' AND action = ?'; args.push(action); }
    if (user_id) { sql += ' AND user_id = ?'; args.push(user_id); }
    if (from) { sql += ' AND created_at >= ?'; args.push(Number(from)); }
    if (to) { sql += ' AND created_at <= ?'; args.push(Number(to)); }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    args.push(Number(limit));

    const result = await auditDb.execute({ sql, args });
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// View registration logs (tenant-scoped)
router.get('/registrations', requireDepartment('PURCHASING'), async (req, res) => {
  try {
    const result = await auditDb.execute({
      sql: 'SELECT * FROM registration_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 100',
      args: [req.orgId]
    });
    res.json({ registrations: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;