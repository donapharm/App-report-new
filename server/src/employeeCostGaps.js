'use strict';

const employeeCost = require('./employeeCost');
const persist = require('./persist');

const AUDIT_FILE = 'employee_cost_gap_audit';
const AUDIT_LIMIT = 1000;
const REASON_QD_MISMATCH = 'qd_mismatch';
const REASON_MISSING = 'missing';
const EXPORT_NOTE = "Điền cột '% cần điền' hoặc xác nhận ánh xạ, rồi gửi DataHub cập nhật catalog. Xếp theo doanh thu ảnh hưởng: làm từ trên xuống để khớp nhanh nhất.";
const COST_CACHE_TTL_MS = 5 * 60 * 1000;
const costSourceCache = new Map();

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function safeText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function searchText(value) {
  return safeText(value, 1000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase();
}

function unitIdentity(row = {}) {
  return safeText(row.c7 ?? row.unit_name ?? row.unit_code ?? row.C7 ?? row.UNIT_NAME ?? row.UNIT_CODE, 240).toUpperCase();
}

function unitCode(value) {
  const text = safeText(value, 240);
  return text.includes('.') ? text.split('.', 1)[0].trim().toUpperCase() : text.toUpperCase();
}

function productCode(row = {}) {
  return safeText(row.c5 ?? row.product_code ?? row.iit_code ?? row.qlnb_code ?? row.C5 ?? row.PRODUCT_CODE ?? row.IIT_CODE ?? row.QLNB_CODE, 160).toUpperCase();
}

function productName(row = {}) {
  return safeText(row.c16 ?? row.product_name ?? row.name ?? row.C16 ?? row.PRODUCT_NAME ?? row.NAME, 300);
}

function qdParts(value) {
  const tokens = safeText(value, 200).toUpperCase().replace(/QD(?=\d)/g, 'QĐ').split('.').filter(Boolean);
  const index = tokens.findIndex((token) => /^QĐ\d+$/.test(token));
  if (index < 0) return null;
  return { prefix: tokens.slice(0, index), decision: tokens[index], tail: tokens.slice(index + 1) };
}

function commonSuffixLength(left = [], right = []) {
  let count = 0;
  while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1;
  return count;
}

function suggestionScore(gapCode, candidateCode) {
  if (`${candidateCode}.`.startsWith(`${gapCode}.`) || `${gapCode}.`.startsWith(`${candidateCode}.`)) return 80;
  const gap = qdParts(gapCode);
  const candidate = qdParts(candidateCode);
  if (!gap || !candidate || gapCode === candidateCode) return 0;
  const samePrefix = gap.prefix.join('.') === candidate.prefix.join('.');
  if (!samePrefix) return 0;
  const suffix = commonSuffixLength(gap.tail, candidate.tail);
  const decisionChanged = gap.decision !== candidate.decision;
  if ((decisionChanged && suffix < 2) || (!decisionChanged && suffix < 1)) return 0;
  return 20 + suffix * 10 + (decisionChanged ? 15 : 0);
}

function findCatalogSuggestion(pair, catalogRows = []) {
  const pairUnit = safeText(pair.unitLabel, 240).toUpperCase();
  const pairName = searchText(pair.productName);
  const pairCode = safeText(pair.productCode, 160).toUpperCase();
  if (!pairUnit || !pairName || !pairCode) return null;
  const candidates = [];
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) {
    const code = productCode(row);
    if (!code || code === pairCode || unitIdentity(row) !== pairUnit || searchText(productName(row)) !== pairName) continue;
    const score = suggestionScore(pairCode, code);
    if (score > 0) candidates.push({ code, score: 100 + score });
  }
  candidates.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code, 'vi'));
  return candidates[0]?.code || null;
}

function groupGapRows(periodPayload = {}, context = {}) {
  const map = new Map();
  for (const row of Array.isArray(periodPayload.rows) ? periodPayload.rows : []) {
    if (row.revenueMatched) continue;
    const code = safeText(row.c5, 160).toUpperCase();
    const unitLabel = safeText(row.c7, 240);
    if (!code || !unitLabel) continue;
    const key = `${context.empCode}\u001f${context.period}\u001f${unitLabel.toUpperCase()}\u001f${code}`;
    const current = map.get(key) || {
      period: context.period,
      employeeCode: normEmp(context.empCode),
      employeeName: safeText(context.employeeName || context.empCode, 160),
      unitCode: unitCode(unitLabel),
      unitLabel,
      productCode: code,
      productName: safeText(row.c16 || code, 300),
      revenueAffected: 0,
      orderLineCount: 0,
    };
    current.revenueAffected += Number.isFinite(Number(row.revenue)) ? Number(row.revenue) : 0;
    current.orderLineCount += 1;
    map.set(key, current);
  }
  return [...map.values()].map((pair) => {
    const suggestedCatalogCode = findCatalogSuggestion(pair, context.catalogRows);
    return {
      ...pair,
      reason: suggestedCatalogCode ? REASON_QD_MISMATCH : REASON_MISSING,
      suggestedCatalogCode,
    };
  });
}

function aggregatePairs(pairs = []) {
  const map = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const key = pair.productCode;
    if (!key) continue;
    const current = map.get(key) || {
      productCode: key,
      productName: pair.productName || key,
      unitLabels: new Set(),
      employeeCodes: new Set(),
      periods: new Set(),
      suggestedCatalogCodes: new Set(),
      revenueAffected: 0,
      pairCount: 0,
      orderLineCount: 0,
      reason: REASON_MISSING,
    };
    current.unitLabels.add(pair.unitLabel);
    current.employeeCodes.add(pair.employeeCode);
    current.periods.add(pair.period);
    if (pair.suggestedCatalogCode) current.suggestedCatalogCodes.add(pair.suggestedCatalogCode);
    if (pair.reason === REASON_QD_MISMATCH) current.reason = REASON_QD_MISMATCH;
    current.revenueAffected += Number(pair.revenueAffected || 0);
    current.pairCount += 1;
    current.orderLineCount += Number(pair.orderLineCount || 0);
    map.set(key, current);
  }
  return [...map.values()].map((item) => {
    const unitLabels = [...item.unitLabels].sort((a, b) => a.localeCompare(b, 'vi'));
    const employeeCodes = [...item.employeeCodes].sort();
    const suggestedCatalogCodes = [...item.suggestedCatalogCodes].sort((a, b) => a.localeCompare(b, 'vi'));
    return {
      productCode: item.productCode,
      productName: item.productName,
      unitLabels,
      unitCount: unitLabels.length,
      employeeCodes,
      employeeCount: employeeCodes.length,
      periods: [...item.periods].sort(),
      pairCount: item.pairCount,
      orderLineCount: item.orderLineCount,
      revenueAffected: item.revenueAffected,
      reason: item.reason,
      suggestedCatalogCode: suggestedCatalogCodes[0] || null,
      suggestedCatalogCodes,
    };
  }).sort((a, b) => b.revenueAffected - a.revenueAffected || a.productCode.localeCompare(b.productCode, 'vi'));
}

function normalizeFilters(filters = {}, { admin = false, ownEmp = '' } = {}) {
  const reason = [REASON_QD_MISMATCH, REASON_MISSING].includes(filters.reason) ? filters.reason : '';
  return {
    q: safeText(filters.q, 160),
    unit: safeText(filters.unit, 240),
    employee: admin ? normEmp(filters.employee) : normEmp(ownEmp),
    reason,
  };
}

function filterPairs(pairs = [], filters = {}, context = {}) {
  const normalized = normalizeFilters(filters, context);
  const query = searchText(normalized.q);
  const unit = searchText(normalized.unit);
  return (Array.isArray(pairs) ? pairs : []).filter((pair) => {
    if (normalized.employee && normEmp(pair.employeeCode) !== normalized.employee) return false;
    if (normalized.reason && pair.reason !== normalized.reason) return false;
    if (unit && !searchText(`${pair.unitCode} ${pair.unitLabel}`).includes(unit)) return false;
    if (query && !searchText(`${pair.productCode} ${pair.productName} ${pair.unitLabel} ${pair.employeeCode} ${pair.suggestedCatalogCode || ''}`).includes(query)) return false;
    return true;
  });
}

function coverageSummary(entries = []) {
  const matchedPairs = entries.reduce((sum, entry) => sum + Number(entry.matchedPairs || 0), 0);
  const totalPairs = entries.reduce((sum, entry) => sum + Number(entry.totalPairs || 0), 0);
  return {
    matchedPairs,
    totalPairs,
    rate: totalPairs ? Number((matchedPairs * 100 / totalPairs).toFixed(1)) : 0,
  };
}

function appendAudit(entry) {
  const rows = persist.load(AUDIT_FILE, []);
  rows.push({ at: new Date().toISOString(), ...entry });
  persist.save(AUDIT_FILE, rows.slice(-AUDIT_LIMIT));
}

async function mapLimit(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return result;
}

async function fetchCostCached(empCode, range, fetchCost, enabled) {
  if (!enabled) return fetchCost(empCode, range);
  const key = `${empCode}\u001f${range.from}\u001f${range.to}`;
  const hit = costSourceCache.get(key);
  if (hit && Date.now() - hit.at < COST_CACHE_TTL_MS) return hit.promise;
  const promise = Promise.resolve(fetchCost(empCode, range)).then((result) => {
    if (result?.outcome !== 'ok') costSourceCache.delete(key);
    return result;
  }, (error) => {
    costSourceCache.delete(key);
    throw error;
  });
  costSourceCache.set(key, { at: Date.now(), promise });
  if (costSourceCache.size > 200) costSourceCache.delete(costSourceCache.keys().next().value);
  return promise;
}

async function buildForSession({
  session, scope, requestedEmp, roster = [], from, to, filters = {}, event = 'gaps_view',
  revenueRowsFor, catalogRowsFor, fetchCost = employeeCost.fetchEmployeeCost, cacheCost = false, auditImpl = appendAudit,
} = {}) {
  if (typeof revenueRowsFor !== 'function' || typeof catalogRowsFor !== 'function') throw new TypeError('Thiếu nguồn doanh thu/catalog cho gap tool.');
  const admin = session?.role === 'ceo' || session?.role === 'admin';
  const ownEmp = employeeCost.resolveScopedEmployee({ session, scope, requestedEmp });
  const range = employeeCost.parseMonthRange({ from, to });
  const rosterMap = new Map((Array.isArray(roster) ? roster : []).map((employee) => [normEmp(employee.emp_code), employee]));
  const requested = normEmp(requestedEmp);
  if (admin && requested && !rosterMap.has(requested)) {
    throw Object.assign(new Error('Nhân viên không thuộc roster chi phí được duyệt.'), { status: 400, code: 'EMPLOYEE_COST_GAPS_EMP_INVALID' });
  }
  if (admin && !requested && rosterMap.size === 0) {
    throw Object.assign(new Error('Không tải được roster chi phí được duyệt.'), { status: 503, code: 'EMPLOYEE_COST_GAPS_ROSTER_UNAVAILABLE' });
  }
  const targets = admin
    ? (requested ? [requested] : [...rosterMap.keys()])
    : (ownEmp ? [ownEmp] : []);
  const uniqueTargets = [...new Set(targets.filter(Boolean))];
  const catalogRowsByPeriod = {};
  for (const period of range.months) {
    const catalogRows = await catalogRowsFor(period);
    if (!Array.isArray(catalogRows) || catalogRows.length === 0) {
      throw Object.assign(new Error(`Catalog ${period} chưa sẵn sàng; không lập worklist để tránh phân loại sai.`), { status: 502, code: 'EMPLOYEE_COST_GAPS_CATALOG_UNAVAILABLE' });
    }
    catalogRowsByPeriod[period] = catalogRows;
  }

  const employeeResults = await mapLimit(uniqueTargets, 3, async (empCode) => {
    const result = await fetchCostCached(empCode, { from: range.from, to: range.to }, fetchCost, cacheCost);
    if (result.outcome !== 'ok') {
      throw Object.assign(new Error(`Nguồn tỷ lệ chi phí của ${empCode} chưa sẵn sàng; không lập gap để tránh báo thiếu sai.`), {
        status: 502,
        code: 'EMPLOYEE_COST_GAPS_SOURCE_UNAVAILABLE',
      });
    }
    const revenueRowsByPeriod = {};
    for (const period of range.months) revenueRowsByPeriod[period] = await revenueRowsFor(empCode, period);
    const enriched = employeeCost.enrichRangePayload(result.payload, { revenueRowsByPeriod, catalogRowsByPeriod });
    const employeeName = rosterMap.get(empCode)?.name || empCode;
    const pairs = enriched.periods.flatMap((periodPayload) => groupGapRows(periodPayload, {
      empCode, employeeName, period: periodPayload.period, catalogRows: catalogRowsByPeriod[periodPayload.period],
    }));
    const coverage = coverageSummary(enriched.periods.map((periodPayload) => ({
      matchedPairs: periodPayload.match.matchedRows,
      totalPairs: periodPayload.match.totalRows,
    })));
    return { empCode, employeeName, outcome: result.outcome, pairs, coverage };
  });

  const allPairs = employeeResults.flatMap((entry) => entry.pairs);
  const coverageByEmployee = employeeResults.map((entry) => ({
    employeeCode: entry.empCode,
    employeeName: entry.employeeName,
    matchedPairs: entry.coverage.matchedPairs,
    totalPairs: entry.coverage.totalPairs,
    rate: entry.coverage.rate,
    gapPairCount: entry.pairs.length,
    outcome: entry.outcome,
  }));
  const normalizedFilters = normalizeFilters(filters, { admin, ownEmp });
  const pairs = filterPairs(allPairs, normalizedFilters, { admin, ownEmp });
  const items = aggregatePairs(pairs);
  const baseCoverage = coverageSummary(coverageByEmployee);
  const selectedCoverage = normalizedFilters.employee
    ? coverageSummary(coverageByEmployee.filter((entry) => entry.employeeCode === normalizedFilters.employee))
    : baseCoverage;
  const response = {
    from: range.from,
    to: range.to,
    scope: { admin, employeeCode: admin ? (requested || null) : ownEmp },
    coverage: {
      ...selectedCoverage,
      gapPairCount: pairs.length,
      gapCodeCount: items.length,
      allGapPairCount: allPairs.length,
      allGapCodeCount: aggregatePairs(allPairs).length,
    },
    coverageByEmployee,
    filters: normalizedFilters,
    pairs,
    items,
  };
  try {
    auditImpl({
      event,
      actor: normEmp(session?.emp_code) || 'UNKNOWN',
      role: safeText(session?.role || 'unknown', 24).toLowerCase(),
      scope: admin ? (requested || 'ALL') : ownEmp,
      from: range.from,
      to: range.to,
      targetCount: uniqueTargets.length,
      matchedPairs: baseCoverage.matchedPairs,
      totalPairs: baseCoverage.totalPairs,
      gapPairCount: allPairs.length,
      gapCodeCount: response.coverage.allGapCodeCount,
    });
  } catch (error) {
    console.warn('[employee-cost-gaps] audit write failed', { actor: normEmp(session?.emp_code), message: error.message });
  }
  return response;
}

async function createWorkbook(payload = {}) {
  return require('./employeeCostExport').gapWorkbookBuffer(payload);
}

module.exports = {
  AUDIT_FILE,
  AUDIT_LIMIT,
  REASON_QD_MISMATCH,
  REASON_MISSING,
  EXPORT_NOTE,
  safeText,
  searchText,
  qdParts,
  suggestionScore,
  findCatalogSuggestion,
  groupGapRows,
  aggregatePairs,
  normalizeFilters,
  filterPairs,
  coverageSummary,
  buildForSession,
  createWorkbook,
};
