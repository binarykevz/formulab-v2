const ExcelJS = require('exceljs');
const crypto = require('crypto');
const inventoryDb = require('../db/inventory');

async function exportMaterials(orgId) {
  const rows = (await inventoryDb.db.execute({ sql: 'SELECT * FROM materials_master WHERE org_id=?', args:[orgId] })).rows;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Materials');
  ws.columns = [{header:'Code',key:'code'},{header:'Name',key:'name'},{header:'Supplier',key:'supplier'},{header:'Cost',key:'unit_cost'}];
  rows.forEach(r => ws.addRow(r));
  return await wb.xlsx.writeBuffer();
}

async function importMaterials(orgId, buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  let added=0, updated=0;
  for(let i=2; i<=ws.rowCount; i++){
    const r = ws.getRow(i);
    const code = String(r.getCell(1).value||'').trim();
    const name = String(r.getCell(2).value||'').trim();
    if(!code) continue;
    const exists = (await inventoryDb.db.execute({sql:'SELECT id FROM materials_master WHERE org_id=? AND code=?',args:[orgId,code]})).rows.length;
    if(exists) {
      await inventoryDb.db.execute({sql:'UPDATE materials_master SET name=?, updated_at=? WHERE org_id=? AND code=?',args:[name,Date.now(),orgId,code]});
      updated++;
    } else {
      await inventoryDb.db.execute({sql:'INSERT INTO materials_master(id,org_id,code,name,supplier,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',args:[crypto.randomUUID(),orgId,code,name,'Imported',Date.now(),Date.now()]});
      added++;
    }
  }
  return { added, updated };
}

module.exports = { exportMaterials, importMaterials };