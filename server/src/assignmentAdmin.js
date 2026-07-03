const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const store = require('./store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ASSIGN_FILE = path.join(DATA_DIR, 'assignments.json');
const AUDIT_FILE = path.join(DATA_DIR, 'assignment_audit.json');
const TYPES = new Set(['unit', 'group', 'route', 'iit', 'special', 'all']);
const SEED_KYS = ['04.2026', '05.2026', '06.2026'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function nowIso() { return new Date().toISOString(); }
function actor(user) { return user?.emp_code || user?.name || 'system'; }
function id() { return crypto.randomBytes(8).toString('hex'); }
function normKy(v) { return String(v || '').trim(); }
function kyValue(ky) { const [m, y] = String(ky || '').split('.').map(Number); return (y || 0) * 100 + (m || 0); }
function activeAt(a, ky) {
  if (a.active === false) return false;
  if (!ky) return true;
  const k = kyValue(ky);
  if (a.from_ky && kyValue(a.from_ky) > k) return false;
  if (a.to_ky && kyValue(a.to_ky) < k) return false;
  return true;
}
function listAudit() { return readJson(AUDIT_FILE, []); }
function audit(action, row, user, before = null) {
  const hist = listAudit();
  hist.unshift({ id: id(), action, assignment_id: row?.id || null, before, after: row, by: actor(user), at: nowIso() });
  writeJson(AUDIT_FILE, hist.slice(0, 3000));
}
function normalize(row = {}, user) {
  const type = String(row.type || '').trim();
  if (!TYPES.has(type)) throw new Error('Loại phân công không hợp lệ');
  const emp = String(row.emp_code || '').trim().toUpperCase();
  if (!emp) throw new Error('Thiếu mã NV');
  const value = type === 'all' ? 'all' : String(row.value || '').trim();
  if (type !== 'all' && !value) throw new Error('Thiếu giá trị phân công');
  return {
    id: row.id || id(),
    emp_code: emp,
    type,
    value,
    special_kind: type === 'special' ? String(row.special_kind || row.value || '').trim() : undefined,
    from_ky: normKy(row.from_ky) || store.currentKyByDate?.() || store.latestKy(),
    to_ky: normKy(row.to_ky) || null,
    active: row.active !== false,
    source: row.source || 'manual',
    note: String(row.note || '').trim(),
    by: row.by || actor(user),
    at: row.at || nowIso(),
  };
}
function listAssignments({ emp_code, activeOnly = false, ky } = {}) {
  let rows = readJson(ASSIGN_FILE, []);
  if (emp_code) rows = rows.filter((a) => a.emp_code === String(emp_code).trim().toUpperCase());
  if (activeOnly) rows = rows.filter((a) => activeAt(a, ky));
  return rows.sort((a, b) => String(a.emp_code).localeCompare(String(b.emp_code), 'vi') || String(a.type).localeCompare(String(b.type), 'vi') || String(a.value).localeCompare(String(b.value), 'vi'));
}
function upsert(row, user) {
  const rows = readJson(ASSIGN_FILE, []);
  const rec = normalize(row, user);
  const idx = rows.findIndex((x) => x.id === rec.id);
  const before = idx >= 0 ? rows[idx] : null;
  rec.by = actor(user); rec.at = nowIso(); rec.source = row.source || 'manual';
  if (idx >= 0) rows[idx] = rec; else rows.unshift(rec);
  writeJson(ASSIGN_FILE, rows);
  audit(idx >= 0 ? 'update' : 'create', rec, user, before);
  return rec;
}
function deactivate(idValue, user) {
  const rows = readJson(ASSIGN_FILE, []);
  const idx = rows.findIndex((x) => x.id === idValue);
  if (idx < 0) throw new Error('Không tìm thấy phân công');
  const before = rows[idx];
  rows[idx] = { ...rows[idx], active: false, by: actor(user), at: nowIso() };
  writeJson(ASSIGN_FILE, rows);
  audit('deactivate', rows[idx], user, before);
  return rows[idx];
}
function makeKey(a) { return [a.emp_code, a.type, a.value, a.from_ky || '', a.to_ky || ''].join('|'); }
function seedFromHistory({ user, replaceAuto = false } = {}) {
  const existing = readJson(ASSIGN_FILE, []);
  const manualKeys = new Set(existing.filter((a) => a.source !== 'auto').map(makeKey));
  const keep = replaceAuto ? existing.filter((a) => a.source !== 'auto') : existing;
  const seen = new Set(keep.map(makeKey));
  const suggestions = [];
  const rows = store.getRowsRange({ kys: SEED_KYS, scope: {} });
  const priorityByIit = new Map();
  for (const c of store.getCst({ scope: {} })) {
    if (c.iit_code && c.priority && !priorityByIit.has(c.iit_code)) priorityByIit.set(c.iit_code, c.priority);
  }
  const empSeen = new Set();
  for (const r of rows) {
    const emp = String(r.emp_code || '').trim().toUpperCase();
    if (!emp || emp === store.UNALLOCATED_EMP) continue;
    const base = { emp_code: emp, from_ky: '07.2026', active: true, source: 'auto', note: 'Gieo mầm từ lịch sử bán 04-06/2026' };
    const priority = r.priority || priorityByIit.get(r.iit_code) || '';
    const candidates = [
      { ...base, type: 'all', value: 'all', note: 'Mặc định phụ trách toàn bộ phần của NV; gieo mầm từ lịch sử bán 04-06/2026' },
      { ...base, type: 'unit', value: r.unit_code || r.unit_name || '' },
      { ...base, type: 'iit', value: r.iit_code || '' },
      { ...base, type: 'route', value: r.route || '' },
      { ...base, type: 'group', value: priority },
    ];
    empSeen.add(emp);
    for (const c of candidates) {
      if (!c.value) continue;
      const rec = normalize(c, user);
      const key = makeKey(rec);
      if (seen.has(key) || manualKeys.has(key)) continue;
      seen.add(key); suggestions.push(rec);
    }
  }
  const next = keep.concat(suggestions.map((x) => ({ ...x, by: actor(user), at: nowIso() })));
  writeJson(ASSIGN_FILE, next);
  audit('seed_auto', { rows: suggestions.length, kys: SEED_KYS }, user, null);
  return { rows: suggestions.length, total: next.length, kys: SEED_KYS };
}
function mine(empCode, ky) { return listAssignments({ emp_code: empCode, activeOnly: true, ky }); }

async function parseWorkbook(buffer, user) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('File không có sheet');
  const header = {};
  ws.getRow(1).eachCell((c, col) => { header[String(c.value || '').trim().toLowerCase()] = col; });
  const get = (row, names) => { for (const n of names) { const col = header[n]; if (col) return row.getCell(col).value; } return ''; };
  const rows = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const emp = get(row, ['emp_code', 'ma_nv', 'mã nv']);
    const type = get(row, ['type', 'loai', 'loại']);
    const value = get(row, ['value', 'gia_tri', 'giá trị']);
    if (!emp && !type && !value) continue;
    rows.push(normalize({
      emp_code: emp, type, value,
      from_ky: get(row, ['from_ky', 'tu_ky', 'từ kỳ']),
      to_ky: get(row, ['to_ky', 'den_ky', 'đến kỳ']),
      active: String(get(row, ['active', 'hieu_luc', 'hiệu lực']) || 'true').toLowerCase() !== 'false',
      note: get(row, ['note', 'ghi_chu', 'ghi chú']),
    }, user));
  }
  return rows;
}
function commitRows(rows, user) {
  const saved = [];
  for (const r of rows) saved.push(upsert(r, user));
  return { rows: saved.length };
}

function typeLabel(type, value) {
  return ({ unit: 'Đơn vị', group: 'Nhóm UT', route: 'Tuyến', iit: 'Mã QLNB', special: 'Hàng cần đẩy', all: 'Toàn bộ' }[type] || type) + (value ? ` · ${value}` : '');
}

module.exports = { TYPES: [...TYPES], SEED_KYS, listAssignments, upsert, deactivate, seedFromHistory, mine, listAudit, parseWorkbook, commitRows, activeAt, typeLabel };
