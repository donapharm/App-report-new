/**
 * targetAdmin.js — quản target đa nguồn: manual > upload > appsale > ai.
 * Lưu file JSON nhỏ trong server/data, không đụng dữ liệu doanh thu.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const DATA = path.join(__dirname, '..', 'data');
const ENTRIES = path.join(DATA, 'target_entries.json');
const AUDIT = path.join(DATA, 'target_audit.json');
const LEGACY = path.join(DATA, 'targets_real.json');
const previewCache = new Map();
const PRIORITY = { manual: 4, upload: 3, appsale: 2, ai: 1, legacy: 0 };

const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
const normKy = (v) => String(v || '').trim().replace('/', '.');
const normEmp = (v) => String(v || '').trim().toUpperCase();
function toNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Math.round(Number(s) || 0);
}
function noAccent(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().trim(); }
function entriesRaw() { return readJson(ENTRIES, []); }
function legacyEntries() {
  return readJson(LEGACY, []).map((x) => ({
    id: `legacy_${normEmp(x.emp_code)}_${normKy(x.ky)}`,
    emp_code: normEmp(x.emp_code), ky: normKy(x.ky), target: Number(x.target || 0),
    source: 'legacy', active: true, at: null, by: 'legacy', batchId: 'legacy', legacy: true,
  }));
}
function allEntries() { return legacyEntries().concat(entriesRaw().filter((x) => x.active !== false)); }
function appendAudit(entry) {
  const a = readJson(AUDIT, []);
  a.push({ at: new Date().toISOString(), ...entry });
  writeJson(AUDIT, a.slice(-1000));
}
function listAudit() { return readJson(AUDIT, []).slice().reverse(); }
function resolveTargets({ ky, empCodes } = {}) {
  const allowed = empCodes ? new Set(empCodes.map(normEmp)) : null;
  const map = new Map();
  for (const e of allEntries()) {
    if (ky && e.ky !== ky) continue;
    if (allowed && !allowed.has(e.emp_code)) continue;
    const k = `${e.ky}|${e.emp_code}`;
    const cur = map.get(k);
    const ep = PRIORITY[e.source] ?? 0;
    const cp = cur ? (PRIORITY[cur.source] ?? 0) : -1;
    if (!cur || ep > cp || (ep === cp && String(e.at || '').localeCompare(String(cur.at || '')) > 0)) map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.ky.localeCompare(b.ky) || a.emp_code.localeCompare(b.emp_code));
}
function upsertEntry({ emp_code, ky, target, source = 'manual', user, note, batchId }) {
  const code = normEmp(emp_code); const k = normKy(ky); const src = String(source || 'manual');
  if (!code || !k) throw new Error('Thiếu mã NV hoặc kỳ');
  if (!/^\d{2}\.\d{4}$/.test(k)) throw new Error('Kỳ phải dạng MM.YYYY');
  const amount = toNum(target);
  if (amount < 0) throw new Error('Target không hợp lệ');
  const now = new Date().toISOString();
  const id = `${src}_${code}_${k}_${crypto.randomBytes(4).toString('hex')}`;
  const old = entriesRaw();
  const deactivated = old.map((e) => (e.emp_code === code && e.ky === k && e.source === src && e.active !== false ? { ...e, active: false, replacedBy: id } : e));
  const entry = { id, emp_code: code, ky: k, target: amount, source: src, active: true, at: now, by: user?.emp_code || user?.name || 'admin', note: note || '', batchId: batchId || id };
  deactivated.push(entry);
  writeJson(ENTRIES, deactivated);
  appendAudit({ action: `target_${src}_upsert`, emp_code: code, ky: k, target: amount, source: src, by: entry.by, batchId: entry.batchId });
  return entry;
}
async function parseTargetWorkbook(buffer, validEmp) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0]; if (!ws) throw new Error('File không có sheet');
  const header = (ws.getRow(1).values || []).slice(1).map((v) => noAccent((v && v.text) || v).replace(/\s+/g, '_'));
  const col = {};
  header.forEach((h, i) => {
    if (['emp_code','ma_nv','manv','ma_nhan_vien'].includes(h)) col.emp_code = i;
    if (['ky','period','thang','month'].includes(h)) col.ky = i;
    if (['target','chi_tieu','chitieu','muc_tieu'].includes(h)) col.target = i;
  });
  if (col.emp_code == null || col.ky == null || col.target == null) throw new Error('File cần cột emp_code, ky, target');
  const rows = [], errors = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const cells = (ws.getRow(r).values || []).slice(1);
    if (!cells.length || cells.every((c) => c == null || c === '')) continue;
    const emp_code = normEmp(cells[col.emp_code]); const ky = normKy(cells[col.ky]); const target = toNum(cells[col.target]);
    if (!emp_code && !ky && !target) continue;
    if (!validEmp(emp_code)) errors.push(`Dòng ${r}: mã NV không hợp lệ/không thuộc đội target (${emp_code || 'trống'})`);
    if (!/^\d{2}\.\d{4}$/.test(ky)) errors.push(`Dòng ${r}: kỳ không đúng MM.YYYY (${ky || 'trống'})`);
    if (target < 0) errors.push(`Dòng ${r}: target âm/không hợp lệ`);
    rows.push({ emp_code, ky, target });
  }
  return { rows, errors, meta: { totalRows: rows.length, totalTarget: rows.reduce((s, r) => s + r.target, 0), empCount: new Set(rows.map((r) => r.emp_code)).size } };
}
function stashPreview(payload) {
  const id = crypto.randomBytes(8).toString('hex');
  previewCache.set(id, { ...payload, ts: Date.now() });
  for (const [k, v] of previewCache) if (Date.now() - v.ts > 30 * 60000) previewCache.delete(k);
  return id;
}
function commitPreview({ previewId, user }) {
  const pv = previewCache.get(previewId); if (!pv) throw new Error('Preview đã hết hạn');
  const batchId = `upload_${Date.now().toString(36)}`;
  const out = pv.rows.map((r) => upsertEntry({ ...r, source: 'upload', user, note: pv.filename, batchId }));
  previewCache.delete(previewId);
  appendAudit({ action: 'target_upload_commit', by: user?.emp_code || 'admin', batchId, rows: out.length, filename: pv.filename, totalTarget: pv.meta.totalTarget });
  return { batchId, rows: out.length, totalTarget: pv.meta.totalTarget };
}
function rollbackBatch({ batchId, user }) {
  const rows = entriesRaw();
  let n = 0;
  const updated = rows.map((e) => {
    if (e.batchId === batchId && e.active !== false) { n += 1; return { ...e, active: false, rolledBackAt: new Date().toISOString(), rolledBackBy: user?.emp_code || 'admin' }; }
    return e;
  });
  writeJson(ENTRIES, updated);
  appendAudit({ action: 'target_rollback_batch', by: user?.emp_code || 'admin', batchId, rows: n });
  return { batchId, rows: n };
}
module.exports = { PRIORITY, resolveTargets, upsertEntry, parseTargetWorkbook, stashPreview, commitPreview, rollbackBatch, listAudit, toNum };
