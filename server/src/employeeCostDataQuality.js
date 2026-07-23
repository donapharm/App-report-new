'use strict';

const { UNALLOCATED_EMP } = require('./store');

const RULE_ORDER = Object.freeze([
  'PRODUCT_MISSING',
  'PRODUCT_MISMATCH',
  'UOM_MISMATCH',
  'BID_PRICE_INVALID',
  'UNIT_UNKNOWN',
]);

const GAP_REASON_QD_MISMATCH = 'qd_mismatch';
const GAP_REASON_MISSING = 'missing';

const DEFAULT_CONFIG = Object.freeze({
  rules: Object.freeze({
    PRODUCT_MISSING: Object.freeze({ enabled: true, severity: 'red' }),
    PRODUCT_MISMATCH: Object.freeze({ enabled: true, severity: 'red', treatUnallocatedAsMismatch: true }),
    UOM_MISMATCH: Object.freeze({ enabled: true, severity: 'red' }),
    BID_PRICE_INVALID: Object.freeze({ enabled: true, severity: 'red', minPositive: 0, outlierRatio: 3 }),
    UNIT_UNKNOWN: Object.freeze({ enabled: true, severity: 'yellow' }),
  }),
});

function safeText(value, max = 300) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : '';
}

function upper(value, max = 240) {
  return safeText(value, max).toUpperCase();
}

function normalizedText(value, max = 300) {
  return safeText(value, max).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase();
}

function numericValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function revenueAmountOf(row = {}) {
  return numericValue(row.revenue ?? row.tong_tien ?? row.REVENUE ?? row.TONG_TIEN) ?? 0;
}

function productCodeOf(row = {}) {
  return upper(row.product_code ?? row.iit_code ?? row.qlnb_code ?? row.c5 ?? row.PRODUCT_CODE ?? row.IIT_CODE ?? row.QLNB_CODE ?? row.C5, 160);
}

function productNameOf(row = {}) {
  return safeText(row.product_name ?? row.c16 ?? row.name ?? row.PRODUCT_NAME ?? row.C16 ?? row.NAME, 300);
}

function unitLabelOf(row = {}) {
  return safeText(row.unit_name ?? row.c7 ?? row.DONVI ?? row.UNIT_NAME ?? row.C7, 240);
}

function unitCodeOf(row = {}) {
  const direct = safeText(row.unit_code ?? row.c7 ?? row.UNIT_CODE ?? row.C7 ?? row.DONVI, 240);
  if (!direct) return '';
  return upper(direct.includes('.') ? direct.split('.', 1)[0] : direct, 120);
}

function uomOf(row = {}) {
  return safeText(row.uom ?? row.c25 ?? row.UOM ?? row.C25, 80);
}

function bidPriceOf(row = {}) {
  return numericValue(row.bid_price ?? row.c31 ?? row.BID_PRICE ?? row.C31);
}

function routeOf(row = {}) {
  return safeText(row.route ?? row.tuyen ?? row.ROUTE ?? row.TUYEN, 120);
}

function employeeCodeOf(row = {}) {
  return upper(row.emp_code ?? row.empCode ?? row.EMP_NUMBER ?? row.MA_NV, 40);
}

function periodOf(row = {}) {
  const explicit = safeText(row.period ?? row.month, 20);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(explicit)) return explicit;
  if (/^(0[1-9]|1[0-2])\.\d{4}$/.test(explicit)) return `${explicit.slice(3)}-${explicit.slice(0, 2)}`;
  const date = safeText(row.date ?? row.ngay ?? row.order_date ?? row.invoice_date ?? row.DATE, 20).slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(date) ? date : '';
}

function normalizeConfig(config = {}) {
  const inputRules = config && typeof config === 'object' ? config.rules || {} : {};
  const rules = {};
  for (const type of RULE_ORDER) {
    const defaults = DEFAULT_CONFIG.rules[type] || {};
    const incoming = inputRules[type] && typeof inputRules[type] === 'object' ? inputRules[type] : {};
    rules[type] = {
      enabled: incoming.enabled == null ? !!defaults.enabled : !!incoming.enabled,
      severity: defaults.severity,
      ...(type === 'PRODUCT_MISMATCH' ? {
        treatUnallocatedAsMismatch: incoming.treatUnallocatedAsMismatch == null
          ? !!defaults.treatUnallocatedAsMismatch
          : !!incoming.treatUnallocatedAsMismatch,
      } : {}),
      ...(type === 'BID_PRICE_INVALID' ? {
        minPositive: Number.isFinite(Number(incoming.minPositive)) ? Number(incoming.minPositive) : Number(defaults.minPositive || 0),
        outlierRatio: Number.isFinite(Number(incoming.outlierRatio)) && Number(incoming.outlierRatio) > 1
          ? Number(incoming.outlierRatio)
          : Number(defaults.outlierRatio || 3),
      } : {}),
    };
  }
  return { rules };
}

function catalogSignature(row = {}) {
  return [productCodeOf(row), unitCodeOf(row), normalizedText(productNameOf(row), 300), normalizedText(uomOf(row), 80), bidPriceOf(row)].join('\u001f');
}

function buildCatalogContext(catalogRows = []) {
  const byPair = new Map();
  const byCode = new Map();
  const knownUnits = new Map();
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) {
    const productCode = productCodeOf(row);
    const unitCode = unitCodeOf(row);
    const label = unitLabelOf(row);
    if (unitCode) knownUnits.set(unitCode, label || unitCode);
    if (!productCode) continue;
    if (unitCode) {
      const pairKey = `${unitCode}\u001f${productCode}`;
      const pairRows = byPair.get(pairKey) || [];
      pairRows.push(row);
      byPair.set(pairKey, pairRows);
    }
    const codeRows = byCode.get(productCode) || [];
    codeRows.push(row);
    byCode.set(productCode, codeRows);
  }
  return { byPair, byCode, knownUnits };
}

function consistentCatalogRow(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const signatures = new Set(rows.map((row) => catalogSignature(row)));
  return signatures.size === 1 ? rows[0] : null;
}

function resolveCatalogRow(revenueRow, catalogContext) {
  const productCode = productCodeOf(revenueRow);
  const unitCode = unitCodeOf(revenueRow);
  if (!productCode) return null;
  const exact = unitCode ? consistentCatalogRow(catalogContext.byPair.get(`${unitCode}\u001f${productCode}`) || []) : null;
  if (exact) return exact;
  return consistentCatalogRow(catalogContext.byCode.get(productCode) || []);
}

function buildKnownUnitIndex({ knownUnits = [], rosterRows = [], catalogContext } = {}) {
  const units = new Set();
  const labels = new Set();
  for (const [unitCode, label] of catalogContext?.knownUnits || []) {
    units.add(unitCode);
    if (label) labels.add(normalizedText(label, 240));
  }
  for (const row of Array.isArray(rosterRows) ? rosterRows : []) {
    const unitCode = unitCodeOf(row);
    const label = unitLabelOf(row) || safeText(row.unit_name ?? row.label, 240);
    if (unitCode) units.add(unitCode);
    if (label) labels.add(normalizedText(label, 240));
  }
  for (const item of Array.isArray(knownUnits) ? knownUnits : []) {
    const raw = typeof item === 'string' ? { unit_code: item, unit_name: item } : item;
    const unitCode = unitCodeOf(raw);
    const label = unitLabelOf(raw) || safeText(raw.label ?? raw.name, 240);
    if (unitCode) units.add(unitCode);
    if (label) labels.add(normalizedText(label, 240));
  }
  return { units, labels };
}

function extractGapPairs(input = {}) {
  const direct = Array.isArray(input.gapPairs) ? input.gapPairs : [];
  if (direct.length) return direct;
  if (Array.isArray(input.existingGapPairs)) return input.existingGapPairs;
  if (Array.isArray(input.gapReport?.pairs)) return input.gapReport.pairs;
  if (Array.isArray(input.existingGapReport?.pairs)) return input.existingGapReport.pairs;
  return [];
}

function assertPrerequisites({ revenueRows, catalogRows, config, knownUnits, rosterRows }) {
  const hasRevenue = Array.isArray(revenueRows) && revenueRows.length > 0;
  if (!hasRevenue) return;
  const catalogRequired = config.rules.UOM_MISMATCH.enabled || config.rules.BID_PRICE_INVALID.enabled;
  if (catalogRequired && (!Array.isArray(catalogRows) || catalogRows.length === 0)) {
    throw Object.assign(new Error('Thiếu catalog để kiểm tra chất lượng dữ liệu chi phí; dừng để tránh phân loại sai.'), {
      code: 'EMPLOYEE_COST_DQ_CATALOG_REQUIRED',
      status: 502,
    });
  }
  if (config.rules.UNIT_UNKNOWN.enabled) {
    const catalogContext = buildCatalogContext(catalogRows);
    const unitIndex = buildKnownUnitIndex({ knownUnits, rosterRows, catalogContext });
    if (!unitIndex.units.size && !unitIndex.labels.size) {
      throw Object.assign(new Error('Thiếu danh mục đơn vị để kiểm tra UNIT_UNKNOWN; dừng để tránh phân loại sai.'), {
        code: 'EMPLOYEE_COST_DQ_UNITS_REQUIRED',
        status: 502,
      });
    }
  }
}

function makeCandidate(base = {}) {
  return {
    type: base.type,
    severity: base.severity,
    field: base.field,
    errorValue: base.errorValue || '',
    sourceProductCode: base.sourceProductCode || '',
    sourceProductName: base.sourceProductName || '',
    sourceUnitCode: base.sourceUnitCode || '',
    sourceUnitLabel: base.sourceUnitLabel || '',
    route: base.route || '',
    employeeCode: base.employeeCode || '',
    period: base.period || '',
    revenueAffected: Number(base.revenueAffected || 0),
    lineCount: Number(base.lineCount || 0) || 1,
    cause: base.cause || '',
    action: base.action || '',
    repairSource: base.repairSource || '',
  };
}

function buildGapCandidates(gapPairs = [], config) {
  const candidates = [];
  for (const pair of Array.isArray(gapPairs) ? gapPairs : []) {
    const reason = safeText(pair.reason, 80).toLowerCase();
    const suggestedCode = upper(pair.suggestedCatalogCode, 160);
    const type = reason === GAP_REASON_QD_MISMATCH || suggestedCode ? 'PRODUCT_MISMATCH' : 'PRODUCT_MISSING';
    if (!config.rules[type]?.enabled) continue;
    candidates.push(makeCandidate({
      type,
      severity: config.rules[type].severity,
      field: 'Mã QLNB',
      errorValue: type === 'PRODUCT_MISMATCH' && suggestedCode ? `${upper(pair.productCode, 160)} ≠ ${suggestedCode}` : upper(pair.productCode, 160),
      sourceProductCode: upper(pair.productCode, 160),
      sourceProductName: safeText(pair.productName, 300),
      sourceUnitCode: upper(pair.unitCode, 120) || upper(String(pair.unitLabel || '').split('.', 1)[0], 120),
      sourceUnitLabel: safeText(pair.unitLabel, 240),
      employeeCode: upper(pair.employeeCode, 40),
      period: periodOf(pair),
      revenueAffected: Number(pair.revenueAffected || 0),
      lineCount: Number(pair.orderLineCount || 0) || 1,
      cause: type === 'PRODUCT_MISSING'
        ? 'Mã QLNB có doanh thu nhưng catalog chưa có cấu hình chi phí tương ứng.'
        : `Mã QLNB doanh thu đang lệch catalog, nghi khác số QĐ với mã ${suggestedCode || 'đang cấu hình'}.`,
      action: type === 'PRODUCT_MISSING'
        ? 'Bổ sung cấu hình mã tại DataHub rồi đối soát lại.'
        : 'Xác nhận alias hoặc mã đúng trong DataHub để khớp doanh thu với catalog.',
      repairSource: 'DataHub',
    }));
  }
  return candidates;
}

function buildUnallocatedCandidates(revenueRows = [], config) {
  if (!config.rules.PRODUCT_MISMATCH.enabled || !config.rules.PRODUCT_MISMATCH.treatUnallocatedAsMismatch) return [];
  const candidates = [];
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) {
    const employeeCode = employeeCodeOf(row);
    const attributionStatus = upper(row.attribution_status, 80);
    if (employeeCode !== UNALLOCATED_EMP && attributionStatus !== 'ROSTER_CONFLICT_QUARANTINED') continue;
    candidates.push(makeCandidate({
      type: 'PRODUCT_MISMATCH',
      severity: config.rules.PRODUCT_MISMATCH.severity,
      field: 'Phân bổ doanh thu',
      errorValue: 'UNALLOCATED',
      sourceProductCode: productCodeOf(row),
      sourceProductName: productNameOf(row),
      sourceUnitCode: unitCodeOf(row),
      sourceUnitLabel: unitLabelOf(row) || unitCodeOf(row),
      route: routeOf(row),
      employeeCode,
      period: periodOf(row),
      revenueAffected: revenueAmountOf(row),
      lineCount: 1,
      cause: 'Dòng doanh thu đang bị cách ly UNALLOCATED nên chưa thể gán đúng nhân viên/phân bổ để đối soát.',
      action: 'Kiểm tra lại App Sale và roster phân công rồi đồng bộ lại doanh thu.',
      repairSource: 'App Sale / danh mục phân công',
    }));
  }
  return candidates;
}

function buildRevenueCandidates(revenueRows = [], catalogContext, unitIndex, config) {
  const candidates = [];
  for (const row of Array.isArray(revenueRows) ? revenueRows : []) {
    const revenueAffected = revenueAmountOf(row);
    const sourceProductCode = productCodeOf(row);
    const sourceProductName = productNameOf(row);
    const sourceUnitCode = unitCodeOf(row);
    const sourceUnitLabel = unitLabelOf(row) || sourceUnitCode;
    const period = periodOf(row);
    const employeeCode = employeeCodeOf(row);
    const route = routeOf(row);
    const catalogRow = resolveCatalogRow(row, catalogContext);

    if (config.rules.UNIT_UNKNOWN.enabled) {
      const knownUnit = sourceUnitCode && unitIndex.units.has(sourceUnitCode);
      const knownLabel = sourceUnitLabel && unitIndex.labels.has(normalizedText(sourceUnitLabel, 240));
      if (!knownUnit && !knownLabel) {
        candidates.push(makeCandidate({
          type: 'UNIT_UNKNOWN',
          severity: config.rules.UNIT_UNKNOWN.severity,
          field: 'Mã đơn vị',
          errorValue: sourceUnitLabel || sourceUnitCode || 'Thiếu mã đơn vị',
          sourceProductCode,
          sourceProductName,
          sourceUnitCode,
          sourceUnitLabel,
          route,
          employeeCode,
          period,
          revenueAffected,
          lineCount: 1,
          cause: 'Mã đơn vị từ doanh thu chưa khớp danh mục đơn vị hiện hành nên App Report không resolve được tên chuẩn.',
          action: 'Bổ sung hoặc sửa mã đơn vị tại App Sale/danh mục đơn vị rồi đồng bộ lại.',
          repairSource: 'App Sale / danh mục đơn vị',
        }));
      }
    }

    let bidPriceAlreadyFlagged = false;
    if (config.rules.BID_PRICE_INVALID.enabled) {
      const saleBidPrice = bidPriceOf(row);
      const minPositive = config.rules.BID_PRICE_INVALID.minPositive;
      let errorValue = '';
      let cause = '';
      if (saleBidPrice == null) {
        errorValue = 'Thiếu giá trúng thầu';
        cause = 'Giá trúng thầu tại doanh thu đang trống nên không an toàn để đối soát chi phí.';
      } else if (saleBidPrice <= minPositive) {
        errorValue = String(saleBidPrice);
        cause = 'Giá trúng thầu tại doanh thu đang bằng 0 hoặc âm nên có nguy cơ sai tiền.';
      }
      if (cause) {
        bidPriceAlreadyFlagged = true;
        candidates.push(makeCandidate({
          type: 'BID_PRICE_INVALID', severity: config.rules.BID_PRICE_INVALID.severity,
          field: 'Giá trúng thầu', errorValue, sourceProductCode, sourceProductName,
          sourceUnitCode, sourceUnitLabel, route, employeeCode, period, revenueAffected, lineCount: 1,
          cause, action: 'Kiểm tra và sửa giá trúng thầu tại App Sale rồi đồng bộ lại.', repairSource: 'App Sale',
        }));
      }
    }

    if (!catalogRow) continue;

    if (config.rules.UOM_MISMATCH.enabled) {
      const saleUom = normalizedText(uomOf(row), 80);
      const catalogUom = normalizedText(uomOf(catalogRow), 80);
      if (saleUom && catalogUom && saleUom !== catalogUom) {
        candidates.push(makeCandidate({
          type: 'UOM_MISMATCH',
          severity: config.rules.UOM_MISMATCH.severity,
          field: 'Đơn vị tính',
          errorValue: `${uomOf(row)} ≠ ${uomOf(catalogRow)}`,
          sourceProductCode,
          sourceProductName: sourceProductName || productNameOf(catalogRow),
          sourceUnitCode,
          sourceUnitLabel,
          route,
          employeeCode,
          period,
          revenueAffected,
          lineCount: 1,
          cause: 'Đơn vị tính trên doanh thu khác catalog nên có rủi ro ghép nhầm mặt hàng hoặc sai quy đổi.',
          action: 'Kiểm tra ĐVT tại App Sale và catalog rồi chuẩn hóa một nguồn đúng.',
          repairSource: 'App Sale / catalog',
        }));
      }
    }

    if (config.rules.BID_PRICE_INVALID.enabled && !bidPriceAlreadyFlagged) {
      const saleBidPrice = bidPriceOf(row);
      const catalogBidPrice = bidPriceOf(catalogRow);
      const minPositive = config.rules.BID_PRICE_INVALID.minPositive;
      const outlierRatio = config.rules.BID_PRICE_INVALID.outlierRatio;
      if (saleBidPrice != null && catalogBidPrice != null && catalogBidPrice > minPositive) {
        const ratio = Math.max(saleBidPrice, catalogBidPrice) / Math.min(saleBidPrice, catalogBidPrice);
        if (ratio > outlierRatio) {
          candidates.push(makeCandidate({
            type: 'BID_PRICE_INVALID', severity: config.rules.BID_PRICE_INVALID.severity,
            field: 'Giá trúng thầu', errorValue: `${saleBidPrice} so với ${catalogBidPrice}`,
            sourceProductCode, sourceProductName: sourceProductName || productNameOf(catalogRow),
            sourceUnitCode, sourceUnitLabel, route, employeeCode, period, revenueAffected, lineCount: 1,
            cause: 'Giá trúng thầu tại doanh thu lệch mạnh so với catalog nên cần kiểm tra lại nguồn giá.',
            action: 'Kiểm tra và sửa giá trúng thầu tại App Sale rồi đồng bộ lại.', repairSource: 'App Sale',
          }));
        }
      }
    }
  }
  return candidates;
}

function ruleWeight(severity) {
  return severity === 'red' ? 0 : 1;
}

function groupedKey(candidate) {
  return [
    candidate.type,
    upper(candidate.sourceUnitCode, 120),
    upper(candidate.sourceUnitLabel, 240),
    upper(candidate.sourceProductCode, 160),
    normalizedText(candidate.sourceProductName, 300),
  ].join('\u001f');
}

function pushUnique(target, value, transform = (item) => item) {
  if (!value) return;
  const normalized = transform(value);
  if (!normalized) return;
  if (!target.some((item) => transform(item) === normalized)) target.push(value);
}

function groupCandidates(candidates = []) {
  const grouped = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = groupedKey(candidate);
    const current = grouped.get(key) || {
      type: candidate.type,
      severity: candidate.severity,
      field: candidate.field,
      sourceProductCode: candidate.sourceProductCode,
      sourceProductName: candidate.sourceProductName,
      sourceUnitCode: candidate.sourceUnitCode,
      sourceUnitLabel: candidate.sourceUnitLabel,
      revenueAffected: 0,
      lineCount: 0,
      employeeCodes: [],
      periods: [],
      routes: [],
      errorValues: [],
      causes: [],
      actions: [],
      repairSources: [],
    };
    current.revenueAffected += Number(candidate.revenueAffected || 0);
    current.lineCount += Number(candidate.lineCount || 0) || 1;
    pushUnique(current.employeeCodes, candidate.employeeCode, (item) => upper(item, 40));
    pushUnique(current.periods, candidate.period, (item) => safeText(item, 20));
    pushUnique(current.routes, candidate.route, (item) => normalizedText(item, 120));
    pushUnique(current.errorValues, candidate.errorValue, (item) => safeText(item, 200));
    pushUnique(current.causes, candidate.cause, (item) => safeText(item, 400));
    pushUnique(current.actions, candidate.action, (item) => safeText(item, 400));
    pushUnique(current.repairSources, candidate.repairSource, (item) => safeText(item, 120));
    grouped.set(key, current);
  }
  return [...grouped.values()].map((item) => ({
    type: item.type,
    severity: item.severity,
    field: item.field,
    errorValue: item.errorValues.join('; '),
    sourceProductCode: item.sourceProductCode,
    sourceProductName: item.sourceProductName,
    sourceUnitCode: item.sourceUnitCode,
    sourceUnitLabel: item.sourceUnitLabel,
    route: item.routes.join(', '),
    employeeCodes: item.employeeCodes.sort(),
    periods: item.periods.sort(),
    revenueAffected: item.revenueAffected,
    lineCount: item.lineCount,
    cause: item.causes.join('; '),
    action: item.actions.join('; '),
    repairSource: item.repairSources.join(' / '),
  })).sort((left, right) => ruleWeight(left.severity) - ruleWeight(right.severity)
    || right.revenueAffected - left.revenueAffected
    || right.lineCount - left.lineCount
    || left.type.localeCompare(right.type, 'vi')
    || left.sourceUnitCode.localeCompare(right.sourceUnitCode, 'vi')
    || left.sourceProductCode.localeCompare(right.sourceProductCode, 'vi'));
}

function summarize(exceptions = []) {
  return exceptions.reduce((summary, item) => ({
    count: summary.count + 1,
    redCount: summary.redCount + (item.severity === 'red' ? 1 : 0),
    yellowCount: summary.yellowCount + (item.severity === 'yellow' ? 1 : 0),
    revenueAffected: summary.revenueAffected + Number(item.revenueAffected || 0),
    redRevenueAffected: summary.redRevenueAffected + (item.severity === 'red' ? Number(item.revenueAffected || 0) : 0),
    lineCount: summary.lineCount + Number(item.lineCount || 0),
  }), {
    count: 0,
    redCount: 0,
    yellowCount: 0,
    revenueAffected: 0,
    redRevenueAffected: 0,
    lineCount: 0,
  });
}

function publicConfig(config) {
  const output = { rules: {} };
  for (const type of RULE_ORDER) {
    const rule = config.rules[type];
    output.rules[type] = {
      enabled: !!rule.enabled,
      severity: rule.severity,
      ...(type === 'PRODUCT_MISMATCH' ? { treatUnallocatedAsMismatch: !!rule.treatUnallocatedAsMismatch } : {}),
      ...(type === 'BID_PRICE_INVALID' ? { minPositive: rule.minPositive, outlierRatio: rule.outlierRatio } : {}),
    };
  }
  return output;
}

function analyzeDataQuality(input = {}) {
  const revenueRows = Array.isArray(input.revenueRows) ? input.revenueRows.slice() : [];
  const catalogRows = Array.isArray(input.catalogRows) ? input.catalogRows.slice() : [];
  const rosterRows = Array.isArray(input.rosterRows) ? input.rosterRows.slice() : [];
  const knownUnits = Array.isArray(input.knownUnits) ? input.knownUnits.slice() : [];
  const gapPairs = extractGapPairs(input);
  const config = normalizeConfig(input.config);

  assertPrerequisites({ revenueRows, catalogRows, config, knownUnits, rosterRows });

  const catalogContext = buildCatalogContext(catalogRows);
  const unitIndex = buildKnownUnitIndex({ knownUnits, rosterRows, catalogContext });
  const candidates = [
    ...buildGapCandidates(gapPairs, config),
    ...buildUnallocatedCandidates(revenueRows, config),
    ...buildRevenueCandidates(revenueRows, catalogContext, unitIndex, config),
  ];
  const exceptions = groupCandidates(candidates);
  return {
    exceptions,
    summary: summarize(exceptions),
    config: publicConfig(config),
  };
}

module.exports = {
  RULE_ORDER,
  DEFAULT_CONFIG,
  GAP_REASON_QD_MISMATCH,
  GAP_REASON_MISSING,
  safeText,
  normalizeConfig,
  buildCatalogContext,
  buildKnownUnitIndex,
  analyzeDataQuality,
};
