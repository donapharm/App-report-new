/**
 * targetAdjustment.js — GĐ2a: điều chỉnh target vì đứt hàng / công nợ / khác.
 * Chỉ adjustment đã CEO/admin duyệt mới ảnh hưởng target đánh giá.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const targetAdmin = require('./targetAdmin');

const DATA = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA, 'target_adjustments.json');
const AUDIT = path.join(DATA, 'target_adjustment_audit.json');

const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
const normEmp = (v) => String(v || '').trim().toUpperCase();
const normKy = (v) => String(v || '').trim().replace('/', '.');
const normReason = (v) => (['dut_hang', 'cong_no', 'khac'].includes(String(v || '').trim()) ? String(v || '').trim() : 'khac');
const normStatus = (v) => (['pending', 'approved', 'rejected'].includes(String(v || '').trim()) ? String(v || '').trim() : null);
function nowIso() { return new Date().toISOString(); }
function byUser(user) { return user?.emp_code || user?.name || 'system'; }
function readAll() { return readJson(FILE, []).map((x) => ({ ...x, emp_code: normEmp(x.emp_code), ky: normKy(x.ky), reason_type: normReason(x.reason_type), status: x.status || 'pending', impact_amount: Math.max(0, targetAdmin.toNum(x.impact_amount)) })); }
function writeAll(rows) { writeJson(FILE, rows); }
function appendAudit(entry) {
  const rows = readJson(AUDIT, []);
  rows.push({ at: nowIso(), ...entry });
  writeJson(AUDIT, rows.slice(-2000));
}
function validateBase(input = {}) {
  const emp_code = normEmp(input.emp_code);
  const ky = normKy(input.ky);
  if (!emp_code) throw new Error('Thiếu mã NV');
  if (!/^\d{2}\.\d{4}$/.test(ky)) throw new Error('Kỳ phải dạng MM.YYYY');
  const impact_amount = targetAdmin.toNum(input.impact_amount);
  if (impact_amount < 0) throw new Error('Số tiền ảnh hưởng không hợp lệ');
  return { emp_code, ky, impact_amount };
}
function create(input = {}, user = {}) {
  const base = validateBase(input);
  const row = {
    id: `adj_${base.emp_code}_${base.ky}_${crypto.randomBytes(5).toString('hex')}`,
    emp_code: base.emp_code,
    ky: base.ky,
    scope: input.scope || null,
    reason_type: normReason(input.reason_type),
    impact_amount: base.impact_amount,
    note: String(input.note || '').trim(),
    status: input.status === 'approved' ? 'approved' : 'pending',
    by: byUser(user),
    at: nowIso(),
    source: input.source || 'manual',
  };
  if (row.status === 'approved') { row.approved_by = byUser(user); row.approved_at = nowIso(); }
  const rows = readAll(); rows.push(row); writeAll(rows);
  appendAudit({ action: 'target_adjustment_create', id: row.id, emp_code: row.emp_code, ky: row.ky, reason_type: row.reason_type, impact_amount: row.impact_amount, status: row.status, by: row.by });
  return row;
}
function setStatus(id, status, user = {}) {
  const st = normStatus(status);
  if (!st || st === 'pending') throw new Error('Trạng thái duyệt không hợp lệ');
  const rows = readAll();
  const idx = rows.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error('Không tìm thấy điều chỉnh target');
  const row = { ...rows[idx], status: st, approved_by: byUser(user), approved_at: nowIso() };
  rows[idx] = row; writeAll(rows);
  appendAudit({ action: `target_adjustment_${st}`, id: row.id, emp_code: row.emp_code, ky: row.ky, reason_type: row.reason_type, impact_amount: row.impact_amount, by: byUser(user) });
  return row;
}
function list({ ky, emp_code, status, session, isAdmin = false } = {}) {
  let rows = readAll();
  if (ky) rows = rows.filter((x) => x.ky === normKy(ky));
  if (emp_code) rows = rows.filter((x) => x.emp_code === normEmp(emp_code));
  if (status) rows = rows.filter((x) => x.status === status);
  if (!isAdmin && session?.emp_code) rows = rows.filter((x) => x.emp_code === normEmp(session.emp_code));
  return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
function approvedFor({ ky, empCodes } = {}) {
  const set = empCodes ? new Set(empCodes.map(normEmp)) : null;
  return readAll().filter((x) => x.status === 'approved' && (!ky || x.ky === normKy(ky)) && (!set || set.has(x.emp_code)));
}
function totalsByEmp({ ky, empCodes } = {}) {
  const m = new Map();
  for (const r of approvedFor({ ky, empCodes })) {
    const cur = m.get(r.emp_code) || { total: 0, by_reason: { dut_hang: 0, cong_no: 0, khac: 0 }, rows: [] };
    cur.total += Number(r.impact_amount || 0);
    cur.by_reason[r.reason_type] = (cur.by_reason[r.reason_type] || 0) + Number(r.impact_amount || 0);
    cur.rows.push(r);
    m.set(r.emp_code, cur);
  }
  return m;
}
function summary(rows = []) {
  const out = { total: 0, by_reason: { dut_hang: 0, cong_no: 0, khac: 0 }, count: rows.length, pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) {
    out[r.status] = (out[r.status] || 0) + 1;
    if (r.status === 'approved') {
      out.total += Number(r.impact_amount || 0);
      out.by_reason[r.reason_type] = (out.by_reason[r.reason_type] || 0) + Number(r.impact_amount || 0);
    }
  }
  return out;
}
function listAudit() { return readJson(AUDIT, []).slice().reverse(); }

function suggestionFromCst({ ky, scope, emp_code } = {}) {
  const store = require('./store');
  const emp = normEmp(emp_code);
  const rows = store.getCst({ scope }).filter((r) => {
    if (emp && !String(r.emp_code || r.sales_emps || '').split(',').map((x) => normEmp(x)).includes(emp)) return false;
    const remainPct = Number(r.remain_pct ?? r.cst_remain_pct ?? 0);
    const remainQty = Number(r.remain_qty ?? 0);
    const status = String(r.status || r.cst_status || '').toLowerCase();
    return remainQty <= 0 || remainPct <= 0 || /hết|het|cạn|can/.test(status);
  });
  const byEmp = new Map();
  for (const r of rows) {
    const emps = String(r.emp_code || r.sales_emps || emp || '').split(',').map((x) => normEmp(x)).filter(Boolean);
    const amount = Math.max(0, Number(r.bid_price || 0) * Math.max(0, Number(r.monthly_avg_qty || r.avg_qty || r.quantity || 0)));
    for (const ec of emps.length ? emps : [emp].filter(Boolean)) {
      const cur = byEmp.get(ec) || { emp_code: ec, ky: normKy(ky), reason_type: 'dut_hang', impact_amount: 0, note: 'Gợi ý từ CST hết/cạn — CEO chỉnh số trước khi duyệt', source: 'suggest_cst', lines: 0 };
      cur.impact_amount += Math.round(amount);
      cur.lines += 1;
      byEmp.set(ec, cur);
    }
  }
  return [...byEmp.values()].filter((x) => x.impact_amount > 0 || x.lines > 0).sort((a, b) => b.impact_amount - a.impact_amount).slice(0, 100);
}
function suggestions({ ky, scope, emp_code } = {}) {
  const dutHang = suggestionFromCst({ ky, scope, emp_code });
  const congNo = emp_code ? [{ emp_code: normEmp(emp_code), ky: normKy(ky), reason_type: 'cong_no', impact_amount: 0, note: 'Thiếu nguồn WEB partner còn nợ chưa giao — nhập tay/chờ kết nối nguồn', source: 'missing_web_partner' }] : [];
  return { ky: normKy(ky), suggestions: dutHang.concat(congNo), source_notes: { dut_hang: 'Dự thảo từ CST hết/cạn; không tự áp.', cong_no: 'Chưa thấy nguồn WEB partner trong repo; trả draft 0 để CEO nhập/duyệt.' } };
}

module.exports = { create, setStatus, list, approvedFor, totalsByEmp, summary, listAudit, suggestions, normKy, normEmp };
