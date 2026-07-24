const safeText = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (value) => safeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase();
const list = (value) => [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map((item) => safeText(item, 300)).filter(Boolean))];

export const DQ_TYPE_LABELS = Object.freeze({
  PRODUCT_MISSING: 'Thiếu % chi phí',
  PRODUCT_MISMATCH: 'Lệch mã QĐ/QLNB',
  UOM_MISMATCH: 'ĐVT không khớp',
  UOM_CONVERSION_UNVERIFIED: 'Quy đổi ĐVT chưa xác minh',
  BID_PRICE_INVALID: 'Giá thầu bất thường',
  UNIT_UNKNOWN: 'Đơn vị chưa nhận diện',
});

export function dataQualityTypeLabel(type) {
  return DQ_TYPE_LABELS[String(type || '').toUpperCase()] || safeText(type, 80) || 'Lỗi dữ liệu';
}

function normalizeItem(source = {}) {
  const type = safeText(source.type || source.ruleCode, 80).toUpperCase();
  if (!DQ_TYPE_LABELS[type]) return null;
  const severity = String(source.severity || '').toLowerCase() === 'yellow' ? 'yellow' : 'red';
  const productCode = safeText(source.productCode || source.iitCode, 180).toUpperCase();
  const unitCode = safeText(source.unitCode, 120).toUpperCase();
  if (!productCode && !unitCode) return null;
  return {
    type,
    severity,
    field: safeText(source.field, 100),
    invalidValue: safeText(source.invalidValue ?? source.value, 300),
    productCode,
    productName: safeText(source.productName, 300),
    suggestedCatalogCodes: list(source.suggestedCatalogCodes || source.suggestedCodes),
    unitCode,
    unitLabels: list(source.unitLabels || source.units || source.unitLabel),
    routes: list(source.routes || source.route),
    employeeCodes: list(source.employeeCodes || source.employeeCode).map((value) => value.toUpperCase()),
    periods: list(source.periods || source.period),
    revenueAffected: Number.isFinite(Number(source.revenueAffected)) ? Number(source.revenueAffected) : 0,
    lineCount: Number.isFinite(Number(source.lineCount ?? source.orderLineCount)) ? Number(source.lineCount ?? source.orderLineCount) : 0,
    cause: safeText(source.cause, 1000),
    action: safeText(source.action, 1000),
    repairSource: safeText(source.repairSource || source.sourceToFix, 200),
    status: safeText(source.status || 'new', 40).toLowerCase(),
    key: safeText(source.key, 500) || `${type}|${unitCode}|${productCode}|${safeText(source.invalidValue, 100)}`,
  };
}

export function normalizeEmployeeCostDataQuality(payload = {}) {
  const items = (Array.isArray(payload.items) ? payload.items : payload.exceptions || []).map(normalizeItem).filter(Boolean);
  const summary = payload.summary || {};
  const crosswalk = payload.sources?.productMasterCrosswalk || {};
  const crosswalkStatus = safeText(crosswalk.status, 80) === 'ready' ? 'ready' : 'source_unavailable';
  return {
    from: safeText(payload.from, 20),
    to: safeText(payload.to, 20),
    scope: payload.scope || {},
    config: payload.config || {},
    sources: {
      productMasterCrosswalk: {
        status: crosswalkStatus,
        source: safeText(crosswalk.source, 80),
        snapshotAt: safeText(crosswalk.snapshotAt, 80) || null,
        version: safeText(crosswalk.version, 160) || null,
        rowCount: Number.isFinite(Number(crosswalk.rowCount)) ? Number(crosswalk.rowCount) : 0,
        message: safeText(crosswalk.message, 400) || null,
      },
    },
    uomRuleUnavailable: crosswalkStatus === 'source_unavailable',
    summary: {
      exceptionCount: Number(summary.exceptionCount ?? items.length) || 0,
      redCount: Number(summary.redCount ?? items.filter((item) => item.severity === 'red').length) || 0,
      yellowCount: Number(summary.yellowCount ?? items.filter((item) => item.severity === 'yellow').length) || 0,
      revenueAffected: Number(summary.revenueAffected ?? items.reduce((sum, item) => sum + item.revenueAffected, 0)) || 0,
      redRevenueAffected: Number(summary.redRevenueAffected ?? items.filter((item) => item.severity === 'red').reduce((sum, item) => sum + item.revenueAffected, 0)) || 0,
    },
    items,
  };
}

export function employeeCostDataQualityView(payload = {}, filters = {}) {
  const model = normalizeEmployeeCostDataQuality(payload);
  const query = norm(filters.q);
  const type = safeText(filters.type, 80).toUpperCase();
  const severity = safeText(filters.severity, 20).toLowerCase();
  const employee = safeText(filters.employee, 80).toUpperCase();
  const unit = norm(filters.unit);
  const route = norm(filters.route);
  const repairSource = norm(filters.repairSource);
  const items = model.items.filter((item) => {
    if (type && item.type !== type) return false;
    if (severity && item.severity !== severity) return false;
    if (employee && !item.employeeCodes.includes(employee)) return false;
    if (unit && !norm(`${item.unitCode} ${item.unitLabels.join(' ')}`).includes(unit)) return false;
    if (route && !norm(item.routes.join(' ')).includes(route)) return false;
    if (repairSource && !norm(item.repairSource).includes(repairSource)) return false;
    if (query && !norm([item.type, dataQualityTypeLabel(item.type), item.productCode, item.productName, item.unitCode, item.unitLabels.join(' '), item.employeeCodes.join(' '), item.routes.join(' '), item.invalidValue, item.repairSource, item.cause, item.action].join(' ')).includes(query)) return false;
    return true;
  }).sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'red' ? -1 : 1)
    || right.revenueAffected - left.revenueAffected || left.type.localeCompare(right.type, 'vi') || left.key.localeCompare(right.key, 'vi'));
  const uniq = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  return {
    ...model,
    items,
    filteredSummary: {
      exceptionCount: items.length,
      redCount: items.filter((item) => item.severity === 'red').length,
      yellowCount: items.filter((item) => item.severity === 'yellow').length,
      revenueAffected: items.reduce((sum, item) => sum + item.revenueAffected, 0),
    },
    typeOptions: Object.keys(DQ_TYPE_LABELS).filter((value) => model.items.some((item) => item.type === value)),
    employeeOptions: uniq(model.items.flatMap((item) => item.employeeCodes)),
    unitOptions: uniq(model.items.flatMap((item) => item.unitLabels.length ? item.unitLabels : [item.unitCode])),
    routeOptions: uniq(model.items.flatMap((item) => item.routes)),
    repairSourceOptions: uniq(model.items.map((item) => item.repairSource)),
  };
}
