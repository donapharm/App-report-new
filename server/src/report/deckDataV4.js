'use strict';
const v3 = require('./deckDataV3');
const store = require('../store');
const seq = require('../cstSequence');
const n = (v) => Number(v || 0);
const txt = (v) => String(v == null ? '' : v).trim();
function aggregate(detail, keyFn, labelFn) {
  const m = new Map();
  for (const r of detail) {
    const key = keyFn(r); const cur = m.get(key) || { key, label: labelFn(r), remainAmount: 0, revenue: 0, untouchedCount: 0, itemCount: 0, owners: new Set(), routes: new Set() };
    cur.remainAmount += r.remainAmount; cur.revenue += r.revenue; cur.itemCount++;
    if (r.sequenceState === seq.STATES.ACTIONABLE) cur.untouchedCount++;
    r.owners.forEach((x) => cur.owners.add(x)); cur.routes.add(r.route); m.set(key, cur);
  }
  return [...m.values()].map((x) => ({ ...x, owners: [...x.owners], routes: [...x.routes], opportunityRatio: x.revenue + x.remainAmount ? x.remainAmount / (x.revenue + x.remainAmount) * 100 : 0 })).sort((a, b) => b.remainAmount - a.remainAmount);
}
async function build(opts = {}) {
  const d = await v3.build(opts);
  const source = seq.classifyCstSequence(store.getCst({ scope: {} }));
  const base = d.cstOpportunity;
  const baseBuckets = new Map();
  for (const r of base.detail || []) { const k = `${r.unitCode}|${r.iitCode}`; const a = baseBuckets.get(k) || []; a.push(r); baseBuckets.set(k, a); }
  const detail = source.filter((r) => n(r.remain_pct) > 0 && n(r.remain_amount) > 0).map((r) => {
    const k = `${txt(r.unit_code)}|${txt(r.iit_code)}`, b = baseBuckets.get(k)?.shift() || {};
    const owners = [...new Set(`${r.emp_code || ''},${r.sales_emps || ''}`.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))];
    return { ...b, unitCode: txt(r.unit_code), unitName: txt(r.unit_name) || txt(r.unit_code), iitCode: txt(r.iit_code), productName: txt(r.product_name) || txt(r.iit_code), remainPct: n(r.remain_pct), remainAmount: n(r.remain_amount), remainQty: n(r.remain_qty), uom: txt(r.uom) || 'Chưa có dữ liệu', owners, sequenceState: r.cst_sequence.state, sequence: r.cst_sequence };
  });
  const actionableDetail = detail.filter((r) => ![seq.STATES.QUEUED, seq.STATES.NEEDS_CONFIRMATION].includes(r.sequenceState));
  const actionableFull = detail.filter((r) => r.sequenceState === seq.STATES.ACTIONABLE).sort((a, b) => b.remainAmount - a.remainAmount);
  const queued = detail.filter((r) => r.sequenceState === seq.STATES.QUEUED).sort((a, b) => b.remainAmount - a.remainAmount);
  const needsConfirmation = detail.filter((r) => r.sequenceState === seq.STATES.NEEDS_CONFIRMATION).sort((a, b) => b.remainAmount - a.remainAmount);
  d.schemaVersion = 4;
  d.cstOpportunity = {
    ...base, detail, actionableDetail,
    units: aggregate(actionableDetail, (r) => r.unitCode, (r) => r.unitName),
    products: aggregate(actionableDetail, (r) => r.iitCode, (r) => r.productName),
    routes: aggregate(actionableDetail, (r) => r.route || 'Chưa phân loại', (r) => r.route || 'Chưa phân loại'),
    hotOpportunities: actionableDetail.slice().sort((a, b) => b.remainAmount - a.remainAmount).slice(0, 20),
    dormantOpportunities: actionableDetail.filter((x) => x.revenue === 0).sort((a, b) => b.remainAmount - a.remainAmount).slice(0, 20),
    untouched: actionableFull.slice(0, 20), queued, needsConfirmation,
    sequenceDisplay: [...queued, ...actionableFull, ...needsConfirmation].slice(0, 20),
    sequenceStats: seq.sequenceStats(source), mandatoryNote: seq.MANDATORY_NOTE,
    warnings: [...(base.warnings || []), seq.MANDATORY_NOTE, `${queued.length} mã QLNB full đang chờ mã hiện hành; ${needsConfirmation.length} dòng cần xác nhận thứ tự.`],
  };
  return d;
}
module.exports = { build };
