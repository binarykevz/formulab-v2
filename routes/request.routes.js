const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const inventoryDb = require('../db/inventory');
const { authenticate, requireDepartment } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const { audit } = require('../middleware/audit');
const pdfService = require('../services/pdf.service');
const socketService = require('../services/socket.service');

router.use(authenticate, tenantIsolation);

router.post('/', audit('CREATE','request'), async (req,res) => {
  const {company_name,date,product_name,batch_no,items} = req.body;
  const id = 'REQ-'+Date.now();
  const total = items.reduce((s,i)=>s+i.total_cost,0);
  await inventoryDb.db.execute({sql:'INSERT INTO purchase_requests(id,org_id,company_name,date,product_name,batch_no,requestor_id,requestor_name,department,grand_total,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',args:[id,req.orgId,company_name,date,product_name,batch_no,req.user.id,req.user.name,req.user.department,total,Date.now(),Date.now()]});
  for(const i of items) await inventoryDb.db.execute({sql:'INSERT INTO purchase_request_items(id,request_id,org_id,raw_material,material_code,supplier,qty_sachet,qty_total,unit_cost,total_cost) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[crypto.randomUUID(),id,req.orgId,i.raw_material,i.material_code,i.supplier,i.qty_sachet,i.qty_total,i.unit_cost,i.total_cost]});
  
  socketService.getIO()?.to(`org:${req.orgId}`).emit('request:created',{id});
  res.json({id,message:'Created'});
});

router.get('/', async (req,res) => {
  const r = await inventoryDb.db.execute({sql:'SELECT * FROM purchase_requests WHERE org_id=? ORDER BY created_at DESC',args:[req.orgId]});
  res.json({requests:r.rows});
});

router.get('/:id/pdf', async (req,res) => {
  const pdf = await pdfService.generateRequestPDF(req.params.id, req.orgId);
  res.setHeader('Content-Type','application/pdf');
  res.send(pdf);
});

router.post('/:id/decide', requireDepartment('PURCHASING'), audit('DECIDE','request'), async (req,res) => {
  const {status,notes} = req.body;
  await inventoryDb.db.execute({sql:'UPDATE purchase_requests SET status=?,decided_by=?,decided_at=?,notes=?,updated_at=? WHERE id=? AND org_id=?',args:[status,req.user.name,Date.now(),notes,Date.now(),req.params.id,req.orgId]});
  socketService.getIO()?.to(`org:${req.orgId}`).emit('request:decided',{id:req.params.id,status});
  res.json({message:`${status}`});
});

module.exports = router;