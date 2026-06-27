const puppeteer = require('puppeteer');
const inventoryDb = require('../db/inventory');

async function generateRequestPDF(requestId, orgId) {
  // Fetch data
  const reqRes = await inventoryDb.db.execute({
    sql: 'SELECT * FROM purchase_requests WHERE id = ? AND org_id = ?',
    args: [requestId, orgId]
  });
  if (reqRes.rows.length === 0) throw new Error('Request not found');
  const req = reqRes.rows[0];

  const itemsRes = await inventoryDb.db.execute({
    sql: 'SELECT * FROM purchase_request_items WHERE request_id = ? AND org_id = ?',
    args: [requestId, orgId]
  });
  const items = itemsRes.rows;

  const statusColor = { PENDING:'#f39c12', APPROVED:'#27ae60', DECLINED:'#e74c3c' }[req.status] || '#95a5a6';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:Arial,sans-serif; }
  body { padding:30px; color:#2c3e50; font-size:12px; }
  .header { display:flex; justify-content:space-between; border-bottom:3px solid #667eea; padding-bottom:15px; margin-bottom:20px; }
  .header h1 { color:#667eea; font-size:24px; }
  .header .id { font-size:14px; color:#7f8c8d; }
  .info-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:20px; background:#f8f9fa; padding:15px; border-radius:6px; }
  .info-grid div { padding:4px 0; }
  .info-grid strong { color:#2c3e50; display:inline-block; min-width:120px; }
  .status { display:inline-block; padding:4px 12px; border-radius:12px; color:#fff; font-weight:600; background:${statusColor}; }
  table { width:100%; border-collapse:collapse; margin:20px 0; }
  th { background:#667eea; color:#fff; padding:10px; text-align:left; font-size:11px; }
  td { padding:8px 10px; border-bottom:1px solid #ecf0f1; }
  tr:nth-child(even) { background:#f8f9fa; }
  .totals { text-align:right; margin-top:20px; padding:15px; background:#f8f9fa; border-radius:6px; }
  .totals .grand { font-size:18px; color:#667eea; font-weight:700; }
  .signatures { display:grid; grid-template-columns:repeat(3,1fr); gap:30px; margin-top:50px; }
  .sig { text-align:center; border-top:1px solid #2c3e50; padding-top:8px; font-size:11px; }
  .footer { margin-top:40px; text-align:center; font-size:10px; color:#95a5a6; border-top:1px solid #ecf0f1; padding-top:10px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>📦 PURCHASE REQUEST</h1>
      <div class="id">${req.company_name}</div>
    </div>
    <div style="text-align:right;">
      <div class="status">${req.status}</div>
      <div style="margin-top:8px;font-size:11px;color:#7f8c8d;">Generated: ${new Date().toLocaleString()}</div>
    </div>
  </div>

  <div class="info-grid">
    <div><strong>Request ID:</strong> ${req.id}</div>
    <div><strong>Date:</strong> ${req.date}</div>
    <div><strong>Product:</strong> ${req.product_name}</div>
    <div><strong>Batch No:</strong> ${req.batch_no}</div>
    <div><strong>Requestor:</strong> ${req.requestor_name}</div>
    <div><strong>Department:</strong> ${req.department}</div>
  </div>

  <h3 style="margin:20px 0 10px;">Raw Materials</h3>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Raw Material</th><th>Code</th><th>Supplier</th>
        <th style="text-align:right;">Sachet (g)</th><th style="text-align:right;">QTY</th>
        <th style="text-align:right;">Unit Cost</th><th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((i,idx) => `
        <tr>
          <td>${idx+1}</td><td>${i.raw_material}</td><td>${i.material_code}</td><td>${i.supplier}</td>
          <td style="text-align:right;">${i.qty_sachet}</td>
          <td style="text-align:right;">${i.qty_total}</td>
          <td style="text-align:right;">₱${Number(i.unit_cost).toFixed(2)}</td>
          <td style="text-align:right;">₱${Number(i.total_cost).toFixed(2)}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div>Subtotal: ₱${Number(req.grand_total).toFixed(2)}</div>
    <div class="grand">GRAND TOTAL: ₱${Number(req.grand_total).toFixed(2)}</div>
    ${req.notes ? `<div style="margin-top:10px;font-style:italic;">Notes: ${req.notes}</div>` : ''}
  </div>

  <div class="signatures">
    <div class="sig">Requested By<br><strong>${req.requestor_name}</strong><br>${req.department}</div>
    <div class="sig">Approved By<br><strong>${req.decided_by || '_______________'}</strong><br>Purchasing</div>
    <div class="sig">Received By<br><strong>_______________</strong><br>Warehouse</div>
  </div>

  <div class="footer">
    This document was generated electronically by FIMS. | Page 1 of 1
  </div>
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { generateRequestPDF };