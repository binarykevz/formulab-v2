const express = require('express');
const multer = require('multer');
const router = express.Router();
const upload = multer({storage:multer.memoryStorage()});
const { authenticate } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const excelService = require('../services/excel.service');

router.use(authenticate, tenantIsolation);

router.get('/export', async (req,res) => {
  const buf = await excelService.exportMaterials(req.orgId);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(buf));
});

router.post('/import', upload.single('file'), async (req,res) => {
  const result = await excelService.importMaterials(req.orgId, req.file.buffer);
  res.json(result);
});

module.exports = router;