'use strict';

/**
 * Conservative CST sequence classifier.
 * Call only after authorization scope has been applied. Source rows are never mutated.
 */
const STATES = Object.freeze({
  ACTIVE: 'ACTIVE_CURRENT',
  QUEUED: 'QUEUED_WAITING',
  ACTIONABLE: 'ACTIONABLE_FULL',
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
  EXHAUSTED: 'EXHAUSTED',
});
const MANDATORY_NOTE = 'CST 100% của một mã QLNB không đồng nghĩa nhân viên chưa khai thác; đơn vị phải sử dụng hết mã hiện hành trước khi chuyển sang mã kế tiếp.';
const n = (v) => Number(v || 0);
function normalizeText(v) {
  return String(v || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function normalizeProductName(v) { return normalizeText(v); }
function normalizeUom(v) { return normalizeText(v); }
function sequenceKey(row, normalizedUom = normalizeUom(row.uom)) {
  return [normalizeText(row.unit_code || row.unit_name), normalizeProductName(row.product_name), normalizedUom].join('::');
}
function qlnbFamily(row) { return normalizeText(String(row.iit_code || '').split('.').at(-1)); }
// Some source QLNBs use inconsistent UOM labels for the same product family
// (e.g. Gói/Ml). Canonicalize only when a shared QLNB family suffix provides
// concrete identity evidence; never merge arbitrary UOMs by name alone.
function buildUomCanonicalizer(rows) {
  const evidence = new Map(), graph = new Map();
  for (const row of rows) {
    const p = normalizeProductName(row.product_name), f = qlnbFamily(row), u = normalizeUom(row.uom);
    if (!p || !f || !u) continue; const k = `${p}::${f}`, set = evidence.get(k) || new Set(); set.add(u); evidence.set(k, set);
  }
  for (const [k, set] of evidence) {
    if (set.size < 2) continue; const p = k.slice(0, k.lastIndexOf('::')), vals = [...set];
    for (const u of vals) { const links = graph.get(`${p}::${u}`) || new Set(); vals.forEach((v) => links.add(v)); graph.set(`${p}::${u}`, links); }
  }
  return (row) => {
    const p = normalizeProductName(row.product_name), source = normalizeUom(row.uom), seen = new Set(), todo = [source];
    while (todo.length) { const u = todo.pop(); if (!u || seen.has(u)) continue; seen.add(u); for (const v of graph.get(`${p}::${u}`) || []) todo.push(v); }
    return { source, canonical: [...seen].sort()[0] || source };
  };
}
function code(row) { return String(row.iit_code || '').trim(); }
function isFull(row) { return n(row.remain_qty) > 0 && (n(row.sold_qty) === 0 || n(row.remain_pct) >= 99.95); }
function isExhausted(row) { return n(row.remain_qty) <= 0 || n(row.remain_pct) <= 0; }
function isPartial(row) { return !isFull(row) && !isExhausted(row) && n(row.remain_qty) > 0; }
function snapshot(row) { return { code: code(row), remainQty: n(row.remain_qty), remainPct: n(row.remain_pct), remainAmount: n(row.remain_amount), uom: row.uom || '' }; }
function classifyCstSequence(scopedRows = []) {
  const canonicalUom = buildUomCanonicalizer(scopedRows);
  const groups = new Map();
  scopedRows.forEach((row, index) => { const uom = canonicalUom(row); const key = sequenceKey(row, uom.canonical); const a = groups.get(key) || []; a.push({ row, index, uom }); groups.set(key, a); });
  const output = new Array(scopedRows.length);
  for (const [key, members] of groups) {
    const uniqueCodes = [...new Set(members.map((x) => code(x.row)).filter(Boolean))];
    const active = members.filter((x) => isPartial(x.row));
    const full = members.filter((x) => isFull(x.row));
    const exhausted = members.filter((x) => isExhausted(x.row));
    const current = active.length === 1 ? snapshot(active[0].row) : null;
    const uniqueFullCodes = [...new Set(full.map((x) => code(x.row)).filter(Boolean))];
    const uniqueNext = uniqueFullCodes.length === 1 ? snapshot(full[0].row) : null;
    const groupStatus = active.length > 1 ? STATES.NEEDS_CONFIRMATION
      : active.length === 1 ? 'WAITING_CURRENT_EXHAUSTION'
        : full.length > 1 ? STATES.NEEDS_CONFIRMATION
          : full.length === 1 ? STATES.ACTIONABLE : STATES.EXHAUSTED;
    for (const member of members) {
      const row = member.row;
      let state;
      if (active.length > 1 && isPartial(row)) state = STATES.NEEDS_CONFIRMATION;
      else if (isPartial(row)) state = STATES.ACTIVE;
      else if (isExhausted(row)) state = STATES.EXHAUSTED;
      else if (isFull(row) && active.length) state = STATES.QUEUED;
      else if (isFull(row) && full.length > 1) state = STATES.NEEDS_CONFIRMATION;
      else state = STATES.ACTIONABLE;
      output[member.index] = {
        ...row,
        cst_sequence: {
          key,
          normalized: { unitCode: normalizeText(row.unit_code || row.unit_name), productName: normalizeProductName(row.product_name), uom: member.uom.canonical },
          sourceNormalizedUom: member.uom.source,
          uomCanonicalized: member.uom.source !== member.uom.canonical,
          state,
          groupStatus,
          siblingCount: members.length - 1,
          qlnbCount: uniqueCodes.length,
          current,
          next: state === STATES.ACTIVE ? uniqueNext : (state === STATES.QUEUED ? snapshot(row) : uniqueNext),
          transition: state === STATES.QUEUED ? 'Chờ mã hiện hành sử dụng hết' : state === STATES.ACTIONABLE ? 'Có thể xem xét khai thác' : state === STATES.NEEDS_CONFIRMATION ? 'Cần xác nhận thứ tự QLNB' : state === STATES.ACTIVE ? 'Mã hiện hành đang sử dụng' : 'Mã đã sử dụng hết',
          sequenceKnown: active.length === 1 && uniqueFullCodes.length <= 1,
          mandatoryNote: MANDATORY_NOTE,
        },
      };
    }
  }
  return output;
}
function sequenceStats(rows = []) {
  const classified = rows[0]?.cst_sequence ? rows : classifyCstSequence(rows);
  const multiGroups = new Set(classified.filter((r) => r.cst_sequence.qlnbCount > 1).map((r) => r.cst_sequence.key));
  const queued = classified.filter((r) => r.cst_sequence.state === STATES.QUEUED);
  return { rows: classified.length, multiQlnbGroups: multiGroups.size, queuedRows: queued.length, queuedAmount: queued.reduce((s, r) => s + n(r.remain_amount), 0), states: classified.reduce((a, r) => (a[r.cst_sequence.state] = (a[r.cst_sequence.state] || 0) + 1, a), {}) };
}
module.exports = { STATES, MANDATORY_NOTE, normalizeText, normalizeProductName, normalizeUom, sequenceKey, classifyCstSequence, sequenceStats, isFull, isPartial, isExhausted };
