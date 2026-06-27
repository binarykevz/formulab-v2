const express = require('express');
const router = express.Router();
const { authenticate, requireDepartment } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const { db: auditDb } = require('../db/audit');

router.use(authenticate, tenantIsolation);

router.get('/audit', requireDepartment('PURCHASING','QA'), async (req,res) => {
  const logs = await auditDb.execute({sql:'SELECT * FROM audit_logs WHERE org_id=? ORDER BY created_at DESC LIMIT 100',args:[req.orgId]});
  res.json({logs:logs.rows});
});

module.exports = router;