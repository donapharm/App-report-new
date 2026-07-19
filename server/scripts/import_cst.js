#!/usr/bin/env node
/**
 * import_cst.js — Nạp CƠ SỐ THẦU THẬT từ app cũ vào App Report.
 * Input: mảng JSON đã tính sẵn từ V_TEMP_PHARMA + SALES_REPORT theo logic app cũ.
 * Output: server/data/cst_real.json
 */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
function toNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s) || 0;
}
const [, , file] = process.argv;
if (!file) { console.error('Thiếu đường dẫn file CST .json'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('Không thấy file:', file); process.exit(1); }
const raw = readJson(file, null);
const arr = Array.isArray(raw) ? raw : (raw && (raw.rows || raw.data || raw.items || raw.cst)) || [];
if (!Array.isArray(arr) || !arr.length) { console.error('File CST rỗng/không phải mảng.'); process.exit(1); }
function pick(o, keys) { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return ''; }
const rows = arr.map((o) => {
  const bidQty = toNum(pick(o, ['bid_qty_initial', 'cst_ban_dau', 'SL_THAU', 'GIVEN_QUANTITY']));
  const sold = toNum(pick(o, ['sold_qty', 'sl_ban', 'SL_BAN', 'SL_DUNG']));
  const remain = pick(o, ['remain_qty', 'sl_con_lai', 'SL_CON']) !== '' ? toNum(pick(o, ['remain_qty', 'sl_con_lai', 'SL_CON'])) : Math.max(0, bidQty - sold);
  return {
    ky: String(pick(o, ['ky', 'KY']) || 'CURRENT').trim(),
    emp_code: String(pick(o, ['emp_code', 'MANV', 'ma_nv']) || '').trim().toUpperCase(),
    unit_code: String(pick(o, ['unit_code', 'unit_code_name', 'DONVI', 'donvi']) || '').trim(),
    unit_name: String(pick(o, ['unit_name', 'unit_code_name', 'DONVI', 'donvi']) || '').trim(),
    iit_code: String(pick(o, ['iit_code', 'IIT_CODE']) || '').trim(),
    product_name: String(pick(o, ['product_name', 'NAME', 'name']) || '').trim(),
    ham_luong: String(pick(o, ['ham_luong', 'strength', 'NONG_DO']) || '').trim(),
    active_ingredient: String(pick(o, ['active_ingredient', 'TEN_HOAT_CHAT']) || '').trim(),
    uom: String(pick(o, ['uom', 'UOM_NAME', 'UOM']) || '').trim(),
    bid_package: String(pick(o, ['bid_package', 'SO_QD_TRUNGTHAU']) || '').trim(),
    bid_qty_initial: bidQty,
    sold_qty: sold,
    remain_qty: remain,
    remain_pct: bidQty > 0 ? +(remain / bidQty * 100).toFixed(1) : 0,
    bid_price: toNum(pick(o, ['gia_thau', 'GIA_THAU', 'UNIT_PRICE_A'])),
    sale_price: toNum(pick(o, ['gia_ban', 'GIA_BAN'])),
    bid_amount: toNum(pick(o, ['tt_thau', 'TT_THAU'])),
    sold_amount: toNum(pick(o, ['tt_da_ban', 'TT_DABAN'])),
    remain_amount: toNum(pick(o, ['tt_con_lai', 'TT_CONLAI'])),
    priority: String(pick(o, ['ut', 'UT']) || '').trim(),
    source_from_date: String(pick(o, ['source_from_date', 'FROM_DATE']) || '').trim(),
    raw_nv: String(pick(o, ['raw_nv', 'RAW_NV']) || '').trim(),
    sales_emps: String(pick(o, ['sales_emps', 'SALES_EMPS']) || '').trim(),
  };
}).filter((r) => r.unit_code && r.bid_qty_initial > 0);
writeJson(path.join(DATA, 'cst_real.json'), rows);
const empSet = new Set(rows.flatMap((r) => String(r.emp_code || '').split(',').map((x) => x.trim()).filter(Boolean)));
console.log('✔ Nạp CST thật xong (KIỂM TRA):');
console.log(`  Dòng: ${rows.length} · NV: ${empSet.size} · Đơn vị: ${new Set(rows.map((r) => r.unit_code)).size} · SP có mã: ${new Set(rows.map((r) => r.iit_code).filter(Boolean)).size} · SP thiếu mã: ${rows.filter((r) => !r.iit_code).length}`);
console.log('  Mẫu 2:', JSON.stringify(rows.slice(0, 2)));
