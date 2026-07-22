const EMPTY_COVERAGE = Object.freeze({ matchedPairs: 0, totalPairs: 0, rate: 0, gapPairCount: 0, gapCodeCount: 0 });

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const searchText = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase();

export function gapReasonLabel(reason) {
  return reason === 'qd_mismatch' ? 'Lệch mã QĐ/QLNB' : 'Thiếu hẳn';
}

export function normalizeEmployeeCostGaps(payload = {}) {
  const pairs = (Array.isArray(payload.pairs) ? payload.pairs : []).map((pair) => ({
    period: text(pair.period),
    employeeCode: upper(pair.employeeCode),
    employeeName: text(pair.employeeName || pair.employeeCode),
    unitCode: upper(pair.unitCode),
    unitLabel: text(pair.unitLabel),
    productCode: upper(pair.productCode),
    productName: text(pair.productName || pair.productCode),
    revenueAffected: number(pair.revenueAffected),
    orderLineCount: number(pair.orderLineCount),
    reason: pair.reason === 'qd_mismatch' ? 'qd_mismatch' : 'missing',
    suggestedCatalogCode: pair.suggestedCatalogCode ? upper(pair.suggestedCatalogCode) : null,
  })).filter((pair) => pair.employeeCode && pair.unitLabel && pair.productCode);
  const coverageByEmployee = (Array.isArray(payload.coverageByEmployee) ? payload.coverageByEmployee : []).map((entry) => ({
    employeeCode: upper(entry.employeeCode),
    employeeName: text(entry.employeeName || entry.employeeCode),
    matchedPairs: number(entry.matchedPairs),
    totalPairs: number(entry.totalPairs),
    rate: number(entry.rate),
    gapPairCount: number(entry.gapPairCount),
  })).filter((entry) => entry.employeeCode);
  return {
    from: text(payload.from),
    to: text(payload.to),
    scope: { admin: !!payload.scope?.admin, employeeCode: upper(payload.scope?.employeeCode) || null },
    coverage: { ...EMPTY_COVERAGE, ...(payload.coverage || {}) },
    coverageByEmployee,
    pairs,
  };
}

function aggregate(pairs) {
  const map = new Map();
  for (const pair of pairs) {
    const current = map.get(pair.productCode) || {
      productCode: pair.productCode,
      productName: pair.productName,
      unitLabels: new Set(), employeeCodes: new Set(), suggestedCatalogCodes: new Set(),
      revenueAffected: 0, pairCount: 0, orderLineCount: 0, reason: 'missing',
    };
    current.unitLabels.add(pair.unitLabel);
    current.employeeCodes.add(pair.employeeCode);
    if (pair.suggestedCatalogCode) current.suggestedCatalogCodes.add(pair.suggestedCatalogCode);
    if (pair.reason === 'qd_mismatch') current.reason = 'qd_mismatch';
    current.revenueAffected += pair.revenueAffected;
    current.pairCount += 1;
    current.orderLineCount += pair.orderLineCount;
    map.set(pair.productCode, current);
  }
  return [...map.values()].map((item) => ({
    ...item,
    unitLabels: [...item.unitLabels].sort((a, b) => a.localeCompare(b, 'vi')),
    employeeCodes: [...item.employeeCodes].sort(),
    suggestedCatalogCodes: [...item.suggestedCatalogCodes].sort((a, b) => a.localeCompare(b, 'vi')),
    unitCount: item.unitLabels.size,
    employeeCount: item.employeeCodes.size,
  })).sort((a, b) => b.revenueAffected - a.revenueAffected || a.productCode.localeCompare(b.productCode, 'vi'));
}

export function employeeCostGapView(payload = {}, filters = {}) {
  const model = normalizeEmployeeCostGaps(payload);
  const query = searchText(filters.q);
  const unit = searchText(filters.unit);
  const employee = upper(filters.employee);
  const reason = ['missing', 'qd_mismatch'].includes(filters.reason) ? filters.reason : '';
  const pairs = model.pairs.filter((pair) => {
    if (employee && pair.employeeCode !== employee) return false;
    if (reason && pair.reason !== reason) return false;
    if (unit && !searchText(`${pair.unitCode} ${pair.unitLabel}`).includes(unit)) return false;
    if (query && !searchText(`${pair.productCode} ${pair.productName} ${pair.unitLabel} ${pair.employeeCode} ${pair.suggestedCatalogCode || ''}`).includes(query)) return false;
    return true;
  });
  const selectedCoverage = employee
    ? model.coverageByEmployee.find((entry) => entry.employeeCode === employee)
    : model.coverage;
  return {
    ...model,
    pairs,
    items: aggregate(pairs),
    coverage: { ...EMPTY_COVERAGE, ...(selectedCoverage || {}) },
    remainingPairs: pairs.length,
    remainingCodes: new Set(pairs.map((pair) => pair.productCode)).size,
    employeeOptions: model.coverageByEmployee,
    unitOptions: [...new Set(model.pairs.map((pair) => pair.unitLabel))].sort((a, b) => a.localeCompare(b, 'vi')),
  };
}
