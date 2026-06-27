const ExcelJS = require('exceljs');
const crypto = require('crypto');
const inventoryDb = require('../db/inventory');

async function exportMaterials(orgId) {
  const result = await inventoryDb.db.execute({
    sql: 'SELECT * FROM materials_master WHERE org_id = ? AND is_active = 1 ORDER BY code',
    args: [orgId]
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FIMS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Materials', {
    properties: { tabColor: { argb: '667EEA' } }
  });

  ws.columns = [
    { header: 'Code', key: 'code', width: 15 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Supplier', key: 'supplier', width: 25 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Unit Cost', key: 'unit_cost', width: 15 },
    { header: 'Category', key: 'category', width: 20 },
  ];

  // Style header
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667EEA' } };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 22;

  result.rows.forEach(r => {
    ws.addRow({
      code: r.code, name: r.name, supplier: r.supplier,
      unit: r.unit, unit_cost: r.unit_cost, category: r.category || ''
    });
  });

  // Auto-filter
  ws.autoFilter = { from: 'A1', to: 'F1' };

  return await wb.xlsx.writeBuffer();
}

async function exportRequests(orgId, status) {
  let sql = 'SELECT * FROM purchase_requests WHERE org_id = ?';
  const args = [orgId];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY created_at DESC';

  const reqs = await inventoryDb.db.execute({ sql, args });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Requests');
  ws.columns = [
    { header: 'ID', key: 'id', width: 22 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Product', key: 'product_name', width: 25 },
    { header: 'Batch', key: 'batch_no', width: 15 },
    { header: 'Requestor', key: 'requestor_name', width: 20 },
    { header: 'Department', key: 'department', width: 15 },
    { header: 'Total', key: 'grand_total', width: 15 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Decided By', key: 'decided_by', width: 20 },
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667EEA' } };

  reqs.rows.forEach(r => {
    const row = ws.addRow(r);
    const statusColor = { PENDING:'FFF39C12', APPROVED:'FF27AE60', DECLINED:'FFE74C3C' }[r.status] || 'FF95A5A6';
    row.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor } };
    row.getCell(8).font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });

  return await wb.xlsx.writeBuffer();
}

async function importMaterials(orgId, buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheet found');

  const results = { added: 0, updated: 0, errors: [] };
  const now = Date.now();

  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const code = String(row.getCell(1).value || '').trim();
    const name = String(row.getCell(2).value || '').trim();
    const supplier = String(row.getCell(3).value || '').trim();
    const unit = String(row.getCell(4).value || 'g').trim();
    const unitCost = Number(row.getCell(5).value) || 0;
    const category = String(row.getCell(6).value || '').trim();

    if (!code || !name) {
      results.errors.push(`Row ${i}: Missing code or name`);
      continue;
    }

    try {
      const existing = await inventoryDb.db.execute({
        sql: 'SELECT id FROM materials_master WHERE org_id = ? AND code = ?',
        args: [orgId, code]
      });

      if (existing.rows.length > 0) {
        await inventoryDb.db.execute({
          sql: `UPDATE materials_master SET name=?, supplier=?, unit=?, unit_cost=?, category=?, updated_at=?
                WHERE org_id=? AND code=?`,
          args: [name, supplier, unit, unitCost, category, now, orgId, code]
        });
        results.updated++;
      } else {
        await inventoryDb.db.execute({
          sql: `INSERT INTO materials_master (id, org_id, code, name, supplier, unit, unit_cost, category, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [crypto.randomUUID(), orgId, code, name, supplier, unit, unitCost, category, now, now]
        });
        results.added++;
      }
    } catch (err) {
      results.errors.push(`Row ${i}: ${err.message}`);
    }
  }
  return results;
}

async function generateImportTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Template');
  ws.columns = [
    { header: 'Code', key: 'code', width: 15 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Supplier', key: 'supplier', width: 25 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Unit Cost', key: 'unit_cost', width: 15 },
    { header: 'Category', key: 'category', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ code: 'SLS-001', name: 'Sodium Lauryl Sulfate', supplier: 'ABC Chem', unit: 'g', unit_cost: 0.50, category: 'Surfactant' });
  ws.addRow({ code: 'GLY-002', name: 'Glycerin', supplier: 'XYZ Supply', unit: 'g', unit_cost: 0.30, category: 'Humectant' });
  return await wb.xlsx.writeBuffer();
}

module.exports = { exportMaterials, exportRequests, importMaterials, generateImportTemplate };