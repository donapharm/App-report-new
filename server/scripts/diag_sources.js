#!/usr/bin/env node
/**
 * diag_sources.js — CHẨN ĐOÁN nguồn App Sale để sửa đúng cột (KHÔNG ghi gì, chỉ đọc).
 * Mục tiêu:
 *   1) Tìm cột TÊN PHÁP NHÂN ĐẦY ĐỦ: liệt kê cột của legal_entities + vài dòng mẫu
 *      (DONAPHARM, Tự Đức) để xem cột nào chứa "Công ty TNHH Dược phẩm ...".
 *   2) Tìm cột TỈNH/VÙNG của đơn vị: liệt kê cột của units + vài dòng mẫu
 *      (đơn vị Vũng Tàu, Bình Phước) + có bảng provinces/regions không.
 *   3) Ca partner "Đối tác khác": xem contractors + legal_entity nó trỏ tới.
 *
 * Dùng:  node server/scripts/diag_sources.js
 */
const fs = require('fs');
const path = require('path');
const APPSALE_ROOT = process.env.APPSALE_ROOT || '/home/osboxes/.openclaw/workspace-main/projects/appsale-donapharm-claude/source/appsale-donapharm';
const Pg = require(path.join(APPSALE_ROOT, 'node_modules', 'pg'));
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv(path.join(APPSALE_ROOT, '.env'));
const pool = new Pg.Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE,
});
const q = (sql, p = []) => pool.query(sql, p).then((r) => r.rows).catch((e) => ({ ERROR: String(e.message || e) }));
const cols = (t) => q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
const tableExists = (t) => q(`SELECT to_regclass($1) IS NOT NULL AS ok`, [t]).then((r) => Array.isArray(r) ? r[0]?.ok : r);

(async () => {
  const out = {};
  // 1) legal_entities: cột + mẫu
  out.legal_entities_columns = await cols('legal_entities');
  out.legal_entities_samples = await q(
    `SELECT * FROM legal_entities WHERE lower(name) LIKE '%donapharm%' OR lower(name) LIKE '%tu duc%' OR lower(name) LIKE '%tự đức%' OR lower(name) LIKE '%doi tac%' OR lower(name) LIKE '%đối tác%' ORDER BY id LIMIT 15`);

  // 2) units: cột + mẫu (Vũng Tàu, Bình Phước)
  out.units_columns = await cols('units');
  out.units_samples = await q(
    `SELECT * FROM units WHERE lower(name) LIKE '%vung tau%' OR lower(name) LIKE '%vũng tàu%' OR lower(name) LIKE '%binh phuoc%' OR lower(name) LIKE '%bình phước%' OR lower(name) LIKE '%an nga tu%' OR lower(name) LIKE '%an ngã tư%' ORDER BY id LIMIT 12`);

  // 2b) có bảng tỉnh/vùng không?
  out.has_provinces = await tableExists('provinces');
  out.has_regions = await tableExists('regions');
  out.provinces_columns = (await tableExists('provinces')) ? await cols('provinces') : 'N/A';
  out.regions_columns = (await tableExists('regions')) ? await cols('regions') : 'N/A';
  out.provinces_samples = (await tableExists('provinces')) ? await q(`SELECT * FROM provinces ORDER BY id LIMIT 20`) : 'N/A';

  // 3) contractors + legal_entity ca "Đối tác khác" (TUE.N/Tự Đức) và DONA
  out.contractors_samples = await q(
    `SELECT c.id, c.code, c.name, c.legal_entity_id, c.is_partner, le.name AS le_name
       FROM contractors c LEFT JOIN legal_entities le ON le.id=c.legal_entity_id
      WHERE lower(c.code) LIKE '%tue%' OR lower(c.name) LIKE '%tu duc%' OR lower(c.name) LIKE '%tự đức%'
         OR lower(c.code) LIKE '%dona%' OR lower(c.name) LIKE '%dona%' ORDER BY c.id LIMIT 20`);

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
