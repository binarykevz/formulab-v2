const puppeteer = require('puppeteer');
const inventoryDb = require('../db/inventory');

async function generateRequestPDF(id, orgId) {
  const req = (await inventoryDb.db.execute({ sql: 'SELECT * FROM purchase_requests WHERE id=? AND org_id=?', args:[id,orgId] })).rows[0];
  if (!req) throw new Error('Not found');
  const items = (await inventoryDb.db.execute({ sql: 'SELECT * FROM purchase_request_items WHERE request_id=?', args:[id] })).rows;
  
  const html = `<html><body style="font-family:Arial;padding:40px;">
    <h1>PURCHASE REQUEST: ${req.id}</h1>
    <p><b>Product:</b> ${req.product_name} | <b>Status:</b> ${req.status}</p>
    <table border="1" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <tr style="background:#eee;"><th>Material</th><th>Code</th><th>Qty</th><th>Total</th></tr>
      ${items.map(i=>`<tr><td>${i.raw_material}</td><td>${i.material_code}</td><td>${i.qty_total}</td><td>₱${i.total_cost}</td></tr>`).join('')}
    </table>
    <h3 style="text-align:right;">Grand Total: ₱${req.grand_total}</h3>
  </body></html>`;

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return pdf;
}
module.exports = { generateRequestPDF };