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
const BASELINE_202606 = path.join(DATA, 'target_baseline_202606.json');
const previewCache = new Map();
const PRIORITY = { manual: 4, upload: 3, appsale: 2, ai: 1, legacy: 0 };

const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
const normKy = (v) => String(v || '').trim().replace('/', '.');
const normEmp = (v) => String(v || '').trim().toUpperCase();
// ROADMAP Target Bonus đa chiều: hiện tại chỉ dùng scope='all'.
// Các scope chi tiết (theo sản phẩm/đơn vị/nhà thầu...) để làm sau, chưa đổi resolver/hành vi hiện tại.
const normScope = (v) => String(v || 'all').trim().toLowerCase() || 'all';
function sourceAliases() {
  const cfg = readJson(path.join(DATA, 'target_roster.json'), {});
  return Object.fromEntries(Object.entries(cfg.source_aliases || {}).map(([k, v]) => [normEmp(k), normEmp(v)]));
}
function toNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Math.round(Number(s) || 0);
}
function noAccent(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().trim(); }
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.richText) return v.richText.map((x) => x.text || '').join('');
  }
  return String(v);
}
function isBlankCell(v) { return cellText(v).trim() === ''; }
function entriesRaw() { return readJson(ENTRIES, []); }
function legacyEntries() {
  const aliases = sourceAliases();
  return readJson(LEGACY, []).map((x) => ({
    id: `legacy_${aliases[normEmp(x.emp_code)] || normEmp(x.emp_code)}_${normKy(x.ky)}`,
    raw_emp_code: normEmp(x.emp_code), emp_code: aliases[normEmp(x.emp_code)] || normEmp(x.emp_code), ky: normKy(x.ky), target: Number(x.target || 0),
    // targets_real.json được import từ Lumos/App Sale V_TEM_TARGET_BONUS.
    // Dùng như nguồn tham khảo tự động, đứng dưới manual/upload và trên AI.
    source: 'appsale', scope: 'all', source_label: x.source || 'Lumos V_TEM_TARGET_BONUS/App Sale', source_ky: normKy(x.source_ky || x.ky),
    active: true, at: null, by: 'appsale', batchId: 'appsale', appsale: true,
  }));
}
function withDefaultScope(e) { return { ...e, scope: normScope(e.scope) }; }
function allEntries() { return legacyEntries().concat(entriesRaw().filter((x) => x.active !== false).map(withDefaultScope)); }
function kyValue(ky) {
  const [m, y] = String(ky || '').split('.').map(Number);
  return (y || 0) * 100 + (m || 0);
}
function ignoreAppSaleForKy(ky) { return ky && kyValue(ky) >= 202607; }
function appendAudit(entry) {
  const a = readJson(AUDIT, []);
  a.push({ at: new Date().toISOString(), ...entry });
  writeJson(AUDIT, a.slice(-1000));
}
function listAudit() { return readJson(AUDIT, []).slice().reverse(); }
function baseline202606() {
  const raw = readJson(BASELINE_202606, null);
  if (!raw?.rows?.length) return { ky: '06.2026', label: 'T06/2026 Lumos', rows: [], total: 0 };
  const rows = raw.rows.map((r) => ({ ...r, emp_code: normEmp(r.emp_code), target: Number(r.target || 0) }));
  return { ...raw, rows, total: Number(raw.total || rows.reduce((s, r) => s + Number(r.target || 0), 0)) };
}
function latestAssignedTargets({ beforeKy, empCodes } = {}) {
  const allowed = empCodes ? new Set(empCodes.map(normEmp)) : null;
  const limit = kyValue(beforeKy);
  const map = new Map();
  for (const e of allEntries()) {
    if (e.source === 'appsale') continue;
    if (allowed && !allowed.has(e.emp_code)) continue;
    if (beforeKy && kyValue(e.ky) >= limit) continue;
    if (Number(e.target || 0) <= 0) continue;
    const cur = map.get(e.emp_code);
    if (!cur || kyValue(e.ky) > kyValue(cur.ky) || (kyValue(e.ky) === kyValue(cur.ky) && String(e.at || '').localeCompare(String(cur.at || '')) > 0)) map.set(e.emp_code, e);
  }
  return map;
}
function resolveTargets({ ky, empCodes } = {}) {
  const allowed = empCodes ? new Set(empCodes.map(normEmp)) : null;
  const map = new Map();
  const entries = allEntries();
  for (const e of entries) {
    if (ky && e.ky !== ky) continue;
    // CEO chốt Target KPI: từ kỳ 07.2026 trở đi không lấy Lumos/App Sale làm target đang dùng.
    // Chưa giao manual/upload/AI thì để trạng thái "Chưa giao target".
    if (ignoreAppSaleForKy(ky) && e.source === 'appsale') continue;
    if (allowed && !allowed.has(e.emp_code)) continue;
    const k = `${e.ky}|${e.emp_code}`;
    const cur = map.get(k);
    const ep = PRIORITY[e.source] ?? 0;
    const cp = cur ? (PRIORITY[cur.source] ?? 0) : -1;
    if (!cur || ep > cp || (ep === cp && String(e.at || '').localeCompare(String(cur.at || '')) > 0)) map.set(k, e);
  }
  // Nếu kỳ hiện tại chưa có target thật, tự kéo Lumos/App Sale kỳ gần nhất <= kỳ đang xem
  // làm nguồn tham khảo để không hiện 0đ trống. Không đè manual/upload/AI cùng kỳ.
  if (ky && !ignoreAppSaleForKy(ky)) {
    const codes = empCodes ? empCodes.map(normEmp) : [...new Set(entries.map((e) => e.emp_code))];
    const kVal = kyValue(ky);
    for (const code of codes) {
      const key = `${ky}|${code}`;
      if (map.has(key)) continue;
      const fallback = entries
        .filter((e) => e.source === 'appsale' && e.emp_code === code && kyValue(e.ky) <= kVal && Number(e.target || 0) > 0)
        .sort((a, b) => kyValue(b.ky) - kyValue(a.ky))[0];
      if (fallback) map.set(key, {
        ...fallback,
        id: `appsale_ref_${code}_${ky}_from_${fallback.ky}`,
        ky,
        source: 'appsale',
        source_ky: fallback.ky,
        source_label: fallback.source_label || 'Lumos V_TEM_TARGET_BONUS/App Sale',
        reference: true,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.ky.localeCompare(b.ky) || a.emp_code.localeCompare(b.emp_code));
}
function upsertEntry({ emp_code, ky, target, source = 'manual', scope = 'all', user, note, batchId }) {
  const code = normEmp(emp_code); const k = normKy(ky); const src = String(source || 'manual');
  const sc = normScope(scope);
  if (!code || !k) throw new Error('Thiếu mã NV hoặc kỳ');
  if (!/^\d{2}\.\d{4}$/.test(k)) throw new Error('Kỳ phải dạng MM.YYYY');
  const amount = toNum(target);
  if (amount < 0) throw new Error('Target không hợp lệ');
  const now = new Date().toISOString();
  const id = `${src}_${code}_${k}_${crypto.randomBytes(4).toString('hex')}`;
  const old = entriesRaw();
  const deactivated = old.map((e) => (e.emp_code === code && e.ky === k && e.source === src && normScope(e.scope) === sc && e.active !== false ? { ...e, scope: normScope(e.scope), active: false, replacedBy: id } : withDefaultScope(e)));
  const entry = { id, emp_code: code, ky: k, target: amount, source: src, scope: sc, active: true, at: now, by: user?.emp_code || user?.name || 'admin', note: note || '', batchId: batchId || id };
  deactivated.push(entry);
  writeJson(ENTRIES, deactivated);
  appendAudit({ action: `target_${src}_upsert`, emp_code: code, ky: k, target: amount, source: src, scope: sc, by: entry.by, batchId: entry.batchId });
  return entry;
}
function monthKy(year, month) { return `${String(month).padStart(2, '0')}.${year}`; }
function quarterMonths({ quarter, year }) {
  const q = Number(quarter), y = Number(year);
  if (!Number.isInteger(q) || q < 1 || q > 4 || !Number.isInteger(y) || y < 2000) throw new Error('Quý/năm không hợp lệ');
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2].map((m) => monthKy(y, m));
}
function splitQuarterTarget(total) {
  const amount = toNum(total);
  if (amount < 0) throw new Error('Target quý không hợp lệ');
  const base = Math.floor(amount / 3);
  return [base, base, amount - base * 2];
}
function bulkUpsert({ rows, source = 'manual', user, note, batchId }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Không có dòng target');
  const bid = batchId || `${source}_${Date.now().toString(36)}`;
  const out = rows.map((r) => upsertEntry({ ...r, source, user, note, batchId: bid }));
  appendAudit({ action: `target_${source}_bulk_upsert`, by: user?.emp_code || 'admin', batchId: bid, rows: out.length, totalTarget: out.reduce((s, x) => s + Number(x.target || 0), 0) });
  return { batchId: bid, rows: out.length, totalTarget: out.reduce((s, x) => s + Number(x.target || 0), 0), entries: out };
}
function upsertQuarter({ quarter, year, items, source = 'manual', user, note }) {
  if (!Array.isArray(items) || !items.length) throw new Error('Không có dòng target quý');
  const kys = quarterMonths({ quarter, year });
  const batchId = `quarter_${year}Q${quarter}_${Date.now().toString(36)}`;
  const rows = [];
  for (const item of items) {
    const parts = splitQuarterTarget(item.target ?? item.quarter_target);
    kys.forEach((ky, i) => rows.push({ emp_code: item.emp_code, ky, target: parts[i] }));
  }
  const result = bulkUpsert({ rows, source, user, note: note || `quarter_${year}Q${quarter}_split3`, batchId });
  return { ...result, quarter: Number(quarter), year: Number(year), kys };
}
async function parseTargetWorkbook(buffer, validEmp) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0]; if (!ws) throw new Error('File không có sheet');
  const header = (ws.getRow(1).values || []).slice(1).map((v) => noAccent((v && v.text) || v).replace(/\s+/g, '_'));
  const col = {};
  header.forEach((h, i) => {
    if (['emp_code','ma_nv','manv','ma_nhan_vien'].includes(h)) col.emp_code = i;
    if (['ky','period','thang','month'].includes(h)) col.ky = i;
    if (['target','target_hien_tai','target_gia_tri','chi_tieu','chitieu','muc_tieu'].includes(h)) col.target = i;
  });
  if (col.emp_code == null || col.ky == null || col.target == null) throw new Error('File cần cột emp_code, ky, target');
  const rows = [], errors = [], skipped = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const cells = (ws.getRow(r).values || []).slice(1);
    if (!cells.length || cells.every((c) => c == null || c === '')) continue;
    const emp_code = normEmp(cellText(cells[col.emp_code])); const ky = normKy(cellText(cells[col.ky]));
    const targetBlank = isBlankCell(cells[col.target]);
    const target = targetBlank ? null : toNum(cells[col.target]);
    if (!emp_code && !ky && targetBlank) continue;
    if (!validEmp(emp_code)) errors.push(`Dòng ${r}: mã NV không hợp lệ/không thuộc đội target (${emp_code || 'trống'})`);
    if (!/^\d{2}\.\d{4}$/.test(ky)) errors.push(`Dòng ${r}: kỳ không đúng MM.YYYY (${ky || 'trống'})`);
    if (!targetBlank && target < 0) errors.push(`Dòng ${r}: target âm/không hợp lệ`);
    // Theo directive template: ô Target trống nghĩa là giữ nguyên target hiện tại, không ghi đè 0.
    if (targetBlank) { skipped.push({ row: r, emp_code, ky, reason: 'blank_target_keep_current' }); continue; }
    rows.push({ emp_code, ky, target });
  }
  return { rows, errors, skipped, meta: { totalRows: rows.length, skippedRows: skipped.length, totalTarget: rows.reduce((s, r) => s + r.target, 0), empCount: new Set(rows.map((r) => r.emp_code)).size, kyCount: new Set(rows.map((r) => r.ky)).size, kys: [...new Set(rows.map((r) => r.ky))].sort() } };
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
    const row = withDefaultScope(e);
    if (row.batchId === batchId && row.active !== false) { n += 1; return { ...row, active: false, rolledBackAt: new Date().toISOString(), rolledBackBy: user?.emp_code || 'admin' }; }
    return row;
  });
  writeJson(ENTRIES, updated);
  appendAudit({ action: 'target_rollback_batch', by: user?.emp_code || 'admin', batchId, rows: n });
  return { batchId, rows: n };
}
module.exports = { PRIORITY, resolveTargets, upsertEntry, bulkUpsert, upsertQuarter, quarterMonths, splitQuarterTarget, parseTargetWorkbook, stashPreview, commitPreview, rollbackBatch, listAudit, baseline202606, latestAssignedTargets, toNum, normScope };
