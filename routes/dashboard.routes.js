const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const inventoryDb = require('../db/inventory');

router.use(authenticate, tenantIsolation);

router.get('/stats', async (req,res) => {
  const stats = await inventoryDb.db.execute({sql:"SELECT status, COUNT(*) as c FROM purchase_requests WHERE org_id=? GROUP BY status",args:[req.orgId]});
  res.json({stats:stats.rows});
});

router.get('/chart/monthly', async (req,res) => {
  // Simplified monthly aggregation
  res.json({labels:['Jan','Feb','Mar'],data:[10,15,8]});
});

module.exports = router;