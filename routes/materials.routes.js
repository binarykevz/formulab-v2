const express = require('express');
const multer = require('multer');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const excelService = require('../services/excel.service');
const inventoryDb = require('../db/inventory');
const { authenticate } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const { audit } = require('../middleware/audit');

router.use(authenticate, tenantIsolation);

// List materials
router.get('/', async (req, res) => {
  try {
    const result = await inventoryDb.db.execute({
      sql: 'SELECT * FROM materials_master WHERE org_id = ? AND is_active = 1 ORDER BY code',
      args: [req.orgId]
    });
    res.json({ materials: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Export materials
router.get('/export', async (req, res) => {
  try {
    const buf = await excelService.exportMaterials(req.orgId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="materials-${req.orgId.slice(0,8)}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export requests
router.get('/export-requests', async (req, res) => {
  try {
    const buf = await excelService.exportRequests(req.orgId, req.query.status);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="requests.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Download import template
router.get('/template', (req, res) => {
  excelService.generateImportTemplate().then(buf => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="import-template.xlsx"');
    res.send(Buffer.from(buf));
  });
});

// Import materials
router.post('/import', upload.single('file'), audit('IMPORT', 'materials'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await excelService.importMaterials(req.orgId, req.file.buffer);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;