/**
 * upload.js — Upload doanh thu: PARSE + VALIDATE ở BACKEND (an toàn hơn parse ở client).
 * Luồng: preview (kiểm tra, chưa ghi) → commit (ghi slot + audit) → có thể rollback slot cũ.
 *
 * Lưu:
 *   data/upload_slots.json   danh sách slot kỳ (metadata)
 *   data/uploads/<id>.json   dữ liệu dòng từng slot
 *   data/audit.json          nhật ký thao tác (ai, khi nào, làm gì)
 * TODO(LIVE): cho store.getRows đọc slot 'active' để báo cáo dùng đúng dữ liệu vừa upload.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DATA = path.join(__dirname, '..', 'data');
const UP_DIR = path.join(DATA, 'uploads');
const SLOTS = path.join(DATA, 'upload_slots.json');
const AUDIT = path.join(DATA, 'audit.json');
fs.mkdirSync(UP_DIR, { recursive: true });

const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');

// Bản đồ header linh hoạt -> field chuẩn
const HEADER_MAP = {
  emp_code: ['emp_code', 'emp_number', 'ma_nv', 'manv', 'ma nhan vien'],
  unit_code: ['unit_code', 'donvi', 'ma_dv', 'madv', 'ma don vi'],
  unit_name: ['unit_name', 'ten_dv', 'ten_vt', 'ten don vi'],
  iit_code: ['iit_code', 'qlnb', 'ma_qlnb', 'ma sp'],
  product_name: ['product_name', 'ten_thuoc', 'ten_sp', 'ten san pham'],
  quantity: ['quantity', 'so_luong', 'sl', 'soluong'],
  revenue: ['revenue', 'tong_tien', 'doanh_thu', 'thanh_tien', 'tongtien'],
  bid_package: ['bid_package', 'goi_thau', 'goithau'],
  contractor_code: ['contractor_code', 'ncc', 'nha_cung_cap'],
};
const noAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

function resolveHeaders(headerRow) {
  const map = {}; // colIndex -> field
  headerRow.forEach((h, i) => {
    const key = noAccent(h).replace(/\s+/g, '_');
    for (const [field, aliases] of Object.entries(HEADER_MAP)) {
      if (aliases.includes(key) || aliases.includes(noAccent(h))) { map[i] = field; break; }
    }
  });
  return map;
}

/** Đọc buffer .xlsx -> { rows, meta, warnings, errors }. Không ghi gì. */
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { errors: ['File không có sheet nào.'] };

  const headerRow = (ws.getRow(1).values || []).slice(1).map((v) => (v && v.text) || v);
  const colMap = resolveHeaders(headerRow);
  const fields = Object.values(colMap);
  const errors = [];
  if (!fields.includes('emp_code')) errors.push('Thiếu cột mã nhân viên (emp_code/ma_nv).');
  if (!fields.includes('revenue')) errors.push('Thiếu cột doanh thu (revenue/tong_tien).');
  if (errors.length) return { errors, headerDetected: headerRow };

  const rows = [];
  const warnings = [];
  const seen = new Set();
  let totalRevenue = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const cells = (ws.getRow(r).values || []).slice(1);
    if (!cells.length || cells.every((c) => c == null || c === '')) continue;
    const row = {};
    for (const [i, field] of Object.entries(colMap)) {
      let v = cells[i];
      if (v && typeof v === 'object' && 'result' in v) v = v.result; // ô công thức
      if (v && typeof v === 'object' && 'text' in v) v = v.text;
      row[field] = v;
    }
    row.emp_code = String(row.emp_code || '').trim().toUpperCase();
    row.revenue = Number(String(row.revenue).replace(/[^\d.-]/g, '')) || 0;
    row.quantity = Number(row.quantity) || 0;
    if (!row.emp_code) { warnings.push(`Dòng ${r}: thiếu mã NV → bỏ qua.`); continue; }
    if (row.revenue <= 0) warnings.push(`Dòng ${r}: doanh thu = 0 hoặc âm.`);
    const dupKey = [row.emp_code, row.unit_code, row.iit_code, row.revenue].join('|');
    if (seen.has(dupKey)) warnings.push(`Dòng ${r}: nghi trùng (${row.emp_code}/${row.unit_code}/${row.iit_code}).`);
    seen.add(dupKey);
    totalRevenue += row.revenue;
    rows.push(row);
  }
  return {
    errors: [],
    rows,
    warnings: warnings.slice(0, 50),
    warningCount: warnings.length,
    meta: {
      totalRows: rows.length,
      totalRevenue,
      empCount: new Set(rows.map((r) => r.emp_code)).size,
      headerDetected: headerRow,
      fieldsMapped: colMap,
    },
  };
}

// RAM cache cho bước preview (chưa commit)
const previewCache = new Map();
function stashPreview(id, payload) {
  previewCache.set(id, { ...payload, ts: Date.now() });
  // dọn preview cũ > 30 phút
  for (const [k, v] of previewCache) if (Date.now() - v.ts > 30 * 60000) previewCache.delete(k);
}

function listSlots() {
  return readJson(SLOTS, []).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}
function listAudit() {
  return readJson(AUDIT, []).slice(-100).reverse();
}
function appendAudit(entry) {
  const a = readJson(AUDIT, []);
  a.push(entry);
  writeJson(AUDIT, a);
}

function commitSlot({ previewId, ky, dateFrom, dateTo, user }) {
  const pv = previewCache.get(previewId);
  if (!pv) throw new Error('Preview đã hết hạn, vui lòng chọn lại file.');
  const id = 'slot_' + ky.replace('.', '') + '_' + Math.floor(pv.ts).toString(36);
  writeJson(path.join(UP_DIR, id + '.json'), pv.rows);
  const slots = readJson(SLOTS, []).map((s) => (s.ky === ky ? { ...s, active: false } : s));
  const slot = {
    id, ky, dateFrom, dateTo,
    totalRows: pv.meta.totalRows,
    totalRevenue: pv.meta.totalRevenue,
    empCount: pv.meta.empCount,
    filename: pv.filename,
    uploadedBy: user.emp_code,
    uploadedByName: user.name,
    uploadedAt: new Date(pv.ts).toISOString(),
    active: true,
  };
  slots.push(slot);
  writeJson(SLOTS, slots);
  appendAudit({ at: slot.uploadedAt, by: user.emp_code, action: 'commit', ky, slotId: id, rows: slot.totalRows, revenue: slot.totalRevenue });
  previewCache.delete(previewId);
  return slot;
}

// Rollback / kích hoạt lại một slot cũ của cùng kỳ
function activateSlot({ id, user }) {
  const slots = readJson(SLOTS, []);
  const target = slots.find((s) => s.id === id);
  if (!target) throw new Error('Không tìm thấy slot.');
  const updated = slots.map((s) => (s.ky === target.ky ? { ...s, active: s.id === id } : s));
  writeJson(SLOTS, updated);
  appendAudit({ at: new Date().toISOString(), by: user.emp_code, action: 'rollback', ky: target.ky, slotId: id });
  return target;
}

module.exports = { parseWorkbook, stashPreview, previewCache, listSlots, listAudit, commitSlot, activateSlot };
