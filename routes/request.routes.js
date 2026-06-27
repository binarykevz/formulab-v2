const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const inventoryDb = require('../db/inventory');
const { authenticate, requireDepartment } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const { audit } = require('../middleware/audit');
const telegram = require('../services/telegram.service');
const pdfService = require('../services/pdf.service');
const io = require('../services/socket.service');


// All routes require auth + tenant isolation
router.use(authenticate, tenantIsolation);

function genId() { return crypto.randomUUID(); }

// CREATE PURCHASE REQUEST
router.post('/', audit('CREATE', 'purchase_request'), async (req, res) => {
  try {
    const { company_name, date, product_name, batch_no, items } = req.body;
    if (!company_name || !date || !product_name || !batch_no || !items?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = 'REQ-' + Date.now();
    const now = Date.now();
    const grandTotal = items.reduce((s, i) => s + Number(i.total_cost || 0), 0);

io.to(`org:${req.orgId}`).emit('request:created', { id, product: product_name, by: req.user.name });
io.to(`org:${req.orgId}:purchasing`).emit('request:pending', { id });

    await inventoryDb.db.execute({
      sql: `INSERT INTO purchase_requests 
        (id, org_id, company_name, date, product_name, batch_no, requestor_id, requestor_name, department, grand_total, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      args: [id, req.orgId, company_name, date, product_name, batch_no,
             req.user.id, req.user.name, req.user.department, grandTotal, now, now]
    });

    for (const item of items) {
      await inventoryDb.db.execute({
        sql: `INSERT INTO purchase_request_items
          (id, request_id, org_id, raw_material, material_code, supplier, qty_sachet, qty_total, unit_cost, total_cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [genId(), id, req.orgId, item.raw_material, item.material_code, item.supplier,
               item.qty_sachet, item.qty_total, item.unit_cost, item.total_cost]
      });
    }

    const fullReq = { ...req.body, id, orgId: req.orgId, orgName: req.orgName, grand_total: grandTotal, items };
    telegram.notifyNewRequest(fullReq).catch(e => console.error(e));

    res.status(201).json({ id, message: 'Request submitted', grandTotal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// LIST MY REQUESTS (tenant-scoped)
router.get('/', async (req, res) => {
  try {
    const result = await inventoryDb.db.execute({
      sql: `SELECT * FROM purchase_requests WHERE org_id = ? 
            ORDER BY created_at DESC LIMIT 100`,
      args: [req.orgId]
    });
    res.json({ requests: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// LIST PENDING (Purchasing only, tenant-scoped)
router.get('/pending', requireDepartment('PURCHASING'), async (req, res) => {
  try {
    const result = await inventoryDb.db.execute({
      sql: `SELECT * FROM purchase_requests WHERE org_id = ? AND status = 'PENDING'
            ORDER BY created_at DESC`,
      args: [req.orgId]
    });
    // Fetch items for each
    const requests = [];
    for (const r of result.rows) {
      const items = await inventoryDb.db.execute({
        sql: 'SELECT * FROM purchase_request_items WHERE request_id = ? AND org_id = ?',
        args: [r.id, req.orgId]
      });
      requests.push({ ...r, items: items.rows });
    }
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending' });
  }
});


// Add this route:
router.get('/:id/pdf', async (req, res) => {
  try {
    const pdf = await pdfService.generateRequestPDF(req.params.id, req.orgId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: err.message });
  }
});


// GET SINGLE REQUEST
router.get('/:id', async (req, res) => {
  try {
    const r = await inventoryDb.db.execute({
      sql: 'SELECT * FROM purchase_requests WHERE id = ? AND org_id = ?',
      args: [req.params.id, req.orgId]
    });
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const items = await inventoryDb.db.execute({
      sql: 'SELECT * FROM purchase_request_items WHERE request_id = ? AND org_id = ?',
      args: [req.params.id, req.orgId]
    });
    res.json({ request: r.rows[0], items: items.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// DECIDE (Approve/Decline) — Purchasing only
router.post('/:id/decide', requireDepartment('PURCHASING'), audit('DECIDE', 'purchase_request'), async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!['APPROVED', 'DECLINED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existing = await inventoryDb.db.execute({
      sql: 'SELECT * FROM purchase_requests WHERE id = ? AND org_id = ?',
      args: [req.params.id, req.orgId]
    });
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const request = existing.rows[0];
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Request already decided' });
    }

    await inventoryDb.db.execute({
      sql: `UPDATE purchase_requests SET status = ?, decided_by = ?, decided_at = ?, notes = ?, updated_at = ?
            WHERE id = ? AND org_id = ?`,
      args: [status, req.user.name, Date.now(), notes || '', Date.now(), req.params.id, req.orgId]
    });

    const items = await inventoryDb.db.execute({
      sql: 'SELECT * FROM purchase_request_items WHERE request_id = ? AND org_id = ?',
      args: [req.params.id, req.orgId]
    });

    telegram.notifyRequestDecision(
      { ...request, status, orgName: req.orgName, items: items.rows },
      req.user.name, notes
    ).catch(e => console.error(e));

    res.json({ message: `Request ${status.toLowerCase()}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
