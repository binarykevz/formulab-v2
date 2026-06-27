const express = require('express');
const router = express.Router();

const accountsDb = require('../db/accounts');
const inventoryDb = require('../db/inventory');
const { authenticate } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');

router.use(authenticate, tenantIsolation);

// OVERALL STATS
router.get('/stats', async (req, res) => {
  try {
    const orgId = req.orgId;
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    const [totalReqs, pending, approved, declined, totalValue, monthReqs, users, invites] = await Promise.all([
      inventoryDb.db.execute({ sql: 'SELECT COUNT(*) as c FROM purchase_requests WHERE org_id = ?', args: [orgId] }),
      inventoryDb.db.execute({ sql: "SELECT COUNT(*) as c FROM purchase_requests WHERE org_id = ? AND status = 'PENDING'", args: [orgId] }),
      inventoryDb.db.execute({ sql: "SELECT COUNT(*) as c FROM purchase_requests WHERE org_id = ? AND status = 'APPROVED'", args: [orgId] }),
      inventoryDb.db.execute({ sql: "SELECT COUNT(*) as c FROM purchase_requests WHERE org_id = ? AND status = 'DECLINED'", args: [orgId] }),
      inventoryDb.db.execute({ sql: 'SELECT COALESCE(SUM(grand_total),0) as t FROM purchase_requests WHERE org_id = ? AND status = ?', args: [orgId, 'APPROVED'] }),
      inventoryDb.db.execute({ sql: 'SELECT COUNT(*) as c FROM purchase_requests WHERE org_id = ? AND created_at >= ?', args: [orgId, thirtyDaysAgo] }),
      accountsDb.db.execute({ sql: 'SELECT COUNT(*) as c FROM users WHERE org_id = ? AND is_active = 1', args: [orgId] }),
      accountsDb.db.execute({ sql: "SELECT COUNT(*) as c FROM invites WHERE org_id = ? AND status = 'PENDING'", args: [orgId] }),
    ]);

    res.json({
      totalRequests: totalReqs.rows[0].c,
      pending: pending.rows[0].c,
      approved: approved.rows[0].c,
      declined: declined.rows[0].c,
      totalApprovedValue: totalValue.rows[0].t,
      requestsLast30Days: monthReqs.rows[0].c,
      activeUsers: users.rows[0].c,
      pendingInvites: invites.rows[0].c
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// CHART: Requests by status (pie)
router.get('/chart/status', async (req, res) => {
  try {
    const result = await inventoryDb.db.execute({
      sql: `SELECT status, COUNT(*) as count FROM purchase_requests 
            WHERE org_id = ? GROUP BY status`,
      args: [req.orgId]
    });
    res.json({
      labels: result.rows.map(r => r.status),
      data: result.rows.map(r => r.count)
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// CHART: Requests by department (bar)
router.get('/chart/departments', async (req, res) => {
  try {
    const result = await inventoryDb.db.execute({
      sql: `SELECT department, COUNT(*) as count, SUM(grand_total) as total
            FROM purchase_requests WHERE org_id = ? 
            GROUP BY department ORDER BY count DESC`,
      args: [req.orgId]
    });
    res.json({
      labels: result.rows.map(r => r.department),
      counts: result.rows.map(r => r.count),
      totals: result.rows.map(r => r.total)
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// CHART: Monthly trend (line) — last 12 months
router.get('/chart/monthly', async (req, res) => {
  try {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
        start: d.getTime(),
        end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime()
      });
    }
    const labels = [], counts = [], totals = [];
    for (const m of months) {
      const r = await inventoryDb.db.execute({
        sql: `SELECT COUNT(*) as c, COALESCE(SUM(grand_total),0) as t 
              FROM purchase_requests WHERE org_id = ? AND created_at BETWEEN ? AND ?`,
        args: [req.orgId, m.start, m.end]
      });
      labels.push(m.label);
      counts.push(r.rows[0].c);
      totals.push(r.rows[0].t);
    }
    res.json({ labels, counts, totals });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// CHART: Top materials by usage
router.get('/chart/top-materials', async (req, res) => {
  try {
    const result = await inventoryDb.db.execute({
      sql: `SELECT raw_material, COUNT(*) as uses, SUM(total_cost) as cost
            FROM purchase_request_items WHERE org_id = ?
            GROUP BY raw_material ORDER BY uses DESC LIMIT 10`,
      args: [req.orgId]
    });
    res.json({
      labels: result.rows.map(r => r.raw_material),
      uses: result.rows.map(r => r.uses),
      costs: result.rows.map(r => r.cost)
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// TOP USERS (activity)
router.get('/top-users', async (req, res) => {
  try {
    const result = await inventoryDb.db.execute({
      sql: `SELECT requestor_name, department, COUNT(*) as count
            FROM purchase_requests WHERE org_id = ?
            GROUP BY requestor_name, department ORDER BY count DESC LIMIT 10`,
      args: [req.orgId]
    });
    res.json({ users: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;