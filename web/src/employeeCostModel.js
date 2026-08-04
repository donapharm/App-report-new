export const EMPLOYEE_COST_DIMENSIONS = Object.freeze([
  { key: 'date', label: 'Ngày', kind: 'dimension' },
  { key: 'orderCode', label: 'Mã đơn hàng', kind: 'dimension' },
  { key: 'route', label: 'Tuyến', kind: 'dimension' },
  { key: 'c7', label: 'Đơn vị', kind: 'dimension' },
  { key: 'contractorName', label: 'Nhà thầu', kind: 'dimension' },
  { key: 'c5', label: 'Mã hàng (QLNB)', kind: 'dimension' },
  { key: 'c10', label: 'C10', kind: 'dimension' },
  { key: 'c16', label: 'Tên hàng', kind: 'dimension' },
  { key: 'strength', label: 'Hàm lượng', kind: 'dimension', tooltip: true },
  { key: 'c25', label: 'ĐVT', kind: 'dimension' },
  { key: 'bidPrice', label: 'Giá trúng thầu', kind: 'money' },
  { key: 'quantity', label: 'Số lượng', kind: 'dimension', format: 'number' },
  { key: 'revenueBeforeVat', label: 'Thành tiền xuất bán (trước VAT)', kind: 'money' },
  { key: 'rowMonthlyTotal', label: 'Thành tiền tháng', kind: 'money' },
  { key: 'note', label: 'Ghi chú', kind: 'dimension' },
]);

const FIELD_BY_KEY = new Map(EMPLOYEE_COST_DIMENSIONS.map((column) => [column.key, column]));
const DEFAULT_PREFIX = ['date', 'orderCode', 'route', 'c7', 'contractorName', 'c5', 'c10', 'c16', 'strength', 'c25', 'bidPrice', 'quantity', 'revenueBeforeVat'];
const DEFAULT_SUFFIX = ['rowMonthlyTotal', 'note'];
const BLOCKED = new Set(['c32', 'c47']);
const EMPTY_NOTE = 'chưa có dữ liệu chi phí kỳ này';

export function currentMonthValue(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ‼ GMT+7: `new Date()` lấy giờ máy, quanh nửa đêm sẽ ra tháng sai. Nút chọn
// tháng nhanh phải bám lịch Việt Nam.
export function currentMonthValueVN(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .format(now).slice(0, 7);
}

// Danh sách tháng bấm nhanh: tháng hiện tại + vài tháng liền trước (mới nhất trước).
/**
 * Tháng GẦN NHẤT ĐÃ KẾT THÚC, theo giờ VN.
 *
 * CEO chốt 04/08 23:07: mở màn Thanh toán CP mà trỏ vào tháng đang chạy thì luôn ra
 * "chưa có sổ" — vô nghĩa. Tháng đang chạy KHÔNG BAO GIỜ có sổ (ứng lần 1 chốt vào
 * ngày cuối tháng), nên mặc định phải là tháng liền trước.
 * Sang 00:01 ngày 01/09 (giờ VN) thì hàm này tự trả T08 — không ai phải chỉnh gì.
 */
export function lastEndedMonthVN(now = new Date()) {
  const current = currentMonthValueVN(now);
  const year = Number(current.slice(0, 4));
  const month = Number(current.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export const PAYMENT_PREFS_KEY = 'app-report:payment:prefs:v1';

/**
 * Kỳ mở màn của Thanh toán CP — CEO chốt 04/08 23:25:
 * *"khi bấm F5 nó vẫn cứ trả về tháng hiện tại, không phải là trả về tháng đang
 * xem / tháng liền kề."*
 *
 * Thứ tự ưu tiên:
 *   1. **Tháng đang xem lần trước** (nhớ trong máy) — F5 thì quay lại đúng chỗ.
 *   2. Không có/không hợp lệ ⇒ **tháng liền trước**.
 * ‼ Kẹp trần ở tháng liền trước: tháng đang chạy không bao giờ có sổ, nên dù bộ nhớ
 * còn lưu tháng đó (do bản cũ, hoặc do sang tháng mới) cũng KHÔNG được trỏ vào.
 */
export function paymentStartMonth(storage, now = new Date()) {
  const fallback = lastEndedMonthVN(now);
  let saved = '';
  try { saved = String(JSON.parse(storage?.getItem?.(PAYMENT_PREFS_KEY) || '{}')?.month || ''); } catch { saved = ''; }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(saved)) return fallback;
  return saved > fallback ? fallback : saved;
}

export function writePaymentPrefs(storage, prefs = {}) {
  try { storage?.setItem?.(PAYMENT_PREFS_KEY, JSON.stringify(prefs)); } catch { /* chế độ riêng tư: bỏ qua */ }
}

export function quickMonths(count = 4, now = new Date()) {
  const current = currentMonthValueVN(now);
  const year = Number(current.slice(0, 4));
  const month = Number(current.slice(5, 7));
  return Array.from({ length: Math.max(1, count) }, (unused, index) => {
    const cursor = year * 12 + month - 1 - index;
    return `${Math.floor(cursor / 12)}-${String(cursor % 12 + 1).padStart(2, '0')}`;
  });
}

// ‼ Nhớ lựa chọn lần trước (CEO duyệt 03/08): mở app lên về đúng NV + kỳ đang xem
// dở, thay vì lúc nào cũng nhảy về "Tất cả NV" tháng hiện tại.
// CHỈ lưu LỰA CHỌN (mã NV, kỳ, bật/tắt so sánh) — tuyệt đối không lưu số tiền hay
// dữ liệu nhân sự. Đọc ra phải kiểm định dạng: rác trong storage không được biến
// thành tham số truy vấn.
export const EMPLOYEE_COST_PREFS_KEY = 'app-report:employee-cost:prefs:v1';
const PREF_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PREF_EMP_RE = /^(ALL|[A-Z0-9_-]{2,20})$/;

export function readEmployeeCostPrefs(storage, key = EMPLOYEE_COST_PREFS_KEY) {
  try {
    const raw = JSON.parse(storage?.getItem(key) || '{}');
    const emp = String(raw?.emp || '').trim().toUpperCase();
    const from = String(raw?.from || '');
    const to = String(raw?.to || '');
    const validRange = PREF_MONTH_RE.test(from) && PREF_MONTH_RE.test(to) && from <= to;
    return {
      emp: PREF_EMP_RE.test(emp) ? emp : '',
      range: validRange ? { from, to } : null,
      compare: raw?.compare === true,
    };
  } catch {
    return { emp: '', range: null, compare: false };
  }
}

export function writeEmployeeCostPrefs(storage, prefs = {}, key = EMPLOYEE_COST_PREFS_KEY) {
  try {
    storage?.setItem(key, JSON.stringify({
      emp: String(prefs.emp || ''), from: String(prefs.from || ''),
      to: String(prefs.to || ''), compare: prefs.compare === true,
    }));
  } catch { /* storage bị chặn thì bỏ qua, không được làm hỏng màn hình */ }
}

// Chênh lệch so kỳ trước. Thiếu một trong hai đầu ⇒ trả null, KHÔNG coi là 0 —
// "không có số để so" khác hẳn "bằng nhau" (luật fail-closed).
export function employeeCostDelta(current, previous) {
  // ‼ `Number(null)` và `Number('')` đều ra 0 — nếu chỉ dựa vào Number.isFinite thì
  // "chưa có số" bị hiểu thành "bằng 0", và màn hình sẽ báo giảm 100% giả.
  // Cùng loại lỗi bot bắt được ở ô nhập target 04/08. Loại thẳng từ đầu.
  if (current == null || current === '' || previous == null || previous === '') return null;
  const now = Number(current);
  const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  const diff = now - before;
  return { diff, pct: before === 0 ? null : +(diff / Math.abs(before) * 100).toFixed(1) };
}

export function formatDeltaLabel(delta) {
  if (!delta) return '';
  const arrow = delta.diff > 0 ? '▲' : delta.diff < 0 ? '▼' : '=';
  const pct = delta.pct == null ? '' : ` ${Math.abs(delta.pct).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
  return `${arrow}${pct} (${delta.diff > 0 ? '+' : ''}${delta.diff.toLocaleString('vi-VN')}đ) so kỳ trước`;
}

export function formatMonthLabel(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[2]}/${match[1]}` : String(value || '—');
}

export function isAllowedCostColumn(column) {
  const key = String(column?.key || column || '').trim().toLowerCase();
  const match = /^c(\d+)$/.exec(key);
  if (!match || BLOCKED.has(key)) return false;
  const pos = Number(match[1]);
  return pos >= 33 && pos <= 46;
}

export function buildEmployeeCostColumns(columns = [], template = {}) {
  const costs = new Map();
  for (const raw of Array.isArray(columns) ? columns : []) {
    const key = String(raw?.key || '').trim().toLowerCase();
    if (!isAllowedCostColumn(key) || costs.has(key)) continue;
    costs.set(key, {
      key,
      label: String(raw.label || key),
      shortLabel: key.toUpperCase(),
      kind: 'percent',
      annual: !!raw.annual,
    });
  }
  const requestedLayout = Array.isArray(template?.columns) ? template.columns.map(String) : [];
  // Layout do template quy định sẽ GHI ĐÈ danh sách mặc định. Template hiện hành
  // (FULL-TIME/PART-TIME) chưa liệt kê 'c10' nên cột C10 không bao giờ hiện dù đã
  // khai báo ở DEFAULT_PREFIX. C10 là căn cứ chia thưởng P2 (CEO 27/07) nên phải
  // luôn có: chèn ngay SAU 'c5' (mã QLNB) khi template thiếu.
  if (requestedLayout.length && !requestedLayout.includes('c10')) {
    const at = requestedLayout.indexOf('c5');
    if (at >= 0) requestedLayout.splice(at + 1, 0, 'c10');
  }
  const layout = requestedLayout.length ? requestedLayout : [...DEFAULT_PREFIX, ...costs.keys(), ...DEFAULT_SUFFIX];
  const seen = new Set();
  const result = [];
  for (const rawKey of layout) {
    const key = isAllowedCostColumn(rawKey) ? String(rawKey).toLowerCase() : String(rawKey);
    if (seen.has(key)) continue;
    const column = costs.get(key) || FIELD_BY_KEY.get(key);
    if (!column) continue;
    seen.add(key);
    result.push({ ...column });
  }
  return result;
}

export function formatEmployeeCostCell(value, column = {}) {
  if (value == null || value === '') return '—';
  if (column.key === 'date') return String(value).split('-').reverse().join('/');
  const number = Number(value);
  if (column.format === 'money' || column.kind === 'money') {
    return Number.isFinite(number) ? number.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ' : String(value);
  }
  if (column.format === 'number') {
    return Number.isFinite(number) ? number.toLocaleString('vi-VN', { maximumFractionDigits: 4 }) : String(value);
  }
  if (column.kind === 'dimension') return String(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 4,
  });
}

export function formatMatchRate(match = {}) {
  if (match.rate == null || match.rate === '') return '—';
  const rate = Number(match.rate);
  return Number.isFinite(rate) ? rate.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
}

export function employeeCostKpiMatch(model = {}) {
  const fallback = model.match || {};
  if (!model.allEmployees) return fallback;
  const periodMatches = (Array.isArray(model.periods) ? model.periods : [])
    .map((period) => period?.match)
    .filter(Boolean);
  if (!periodMatches.length) return fallback;
  if (periodMatches.length === 1) return periodMatches[0];
  const matchedRows = periodMatches.reduce((sum, match) => sum + Number(match.matchedRows || 0), 0);
  const totalRows = periodMatches.reduce((sum, match) => sum + Number(match.totalRows || 0), 0);
  const unavailablePairs = periodMatches.reduce((sum, match) => sum + Number(match.unavailablePairs || 0), 0);
  const unavailableEmployees = [...new Set(periodMatches.flatMap((match) => Array.isArray(match.unavailableEmployees) ? match.unavailableEmployees.map(String) : []))].sort();
  const unavailableEmployeeCount = unavailableEmployees.length
    || Math.max(0, ...periodMatches.map((match) => Number(match.unavailableEmployeeCount || 0)));
  const threshold = Number(periodMatches.find((match) => Number.isFinite(Number(match.threshold)))?.threshold ?? 90);
  const rate = totalRows ? +(matchedRows / totalRows * 100).toFixed(1) : null;
  return { matchedRows, totalRows, rate, threshold, low: rate != null && rate < threshold, unavailablePairs, unavailableEmployeeCount, unavailableEmployees };
}

// Kỳ có doanh thu nhưng KHÔNG khớp được một dòng % nào. Khác hẳn "coverage
// thấp": ở đây không có gì để tạm tính, mọi ô tiền phải là "—" chứ không phải 0đ.
export function employeeCostNoMatch(model = {}) {
  const match = employeeCostKpiMatch(model);
  return Number(match.totalRows || 0) > 0 && Number(match.matchedRows || 0) === 0;
}

// KPI và badge "Mặt hàng thiếu %" được tải qua hai request độc lập. Nếu một
// request gặp lỗi nguồn tạm thời ở đúng một NV, hai số có thể thuộc hai snapshot
// khác nhau. Fail closed: chỉ công nhận badge khi cùng kỳ, cùng số cặp thiếu và
// cùng danh sách NV lỗi nguồn; UI sẽ ẩn số chỏi thay vì để CEO phải đoán số nào đúng.
export function employeeCostGapConsistency(model = {}, badge = {}) {
  const match = employeeCostKpiMatch(model);
  const expectedPairs = Math.max(0, Number(match.totalRows || 0) - Number(match.matchedRows || 0));
  const actualPairs = Math.max(0, Number(badge.pairCount || 0));
  const modelFrom = String(model.from || '');
  const modelTo = String(model.to || modelFrom);
  const badgeFrom = String(badge.from || '');
  const badgeTo = String(badge.to || badgeFrom);
  const sameRange = !!modelFrom && !!badgeFrom && modelFrom === badgeFrom && modelTo === badgeTo;
  const expectedUnavailable = [...new Set(Array.isArray(match.unavailableEmployees)
    ? match.unavailableEmployees.map(String).filter(Boolean) : [])].sort();
  const actualUnavailable = [...new Set(Array.isArray(badge.unavailableEmployees)
    ? badge.unavailableEmployees.map(String).filter(Boolean) : [])].sort();
  const sourceMismatch = expectedUnavailable.join('\u001f') !== actualUnavailable.join('\u001f');
  const ready = !!badge.loaded && sameRange;
  return {
    ready,
    sameRange,
    expectedPairs,
    actualPairs,
    expectedUnavailable,
    actualUnavailable,
    mismatch: ready && (expectedPairs !== actualPairs || sourceMismatch),
  };
}

function normalizedMatch(rawMatch = {}, rowCount = 0) {
  return {
    matchedRows: Number(rawMatch.matchedRows || 0),
    totalRows: Number(rawMatch.totalRows ?? rowCount),
    rate: rawMatch.rate == null ? null : Number(rawMatch.rate),
    threshold: Number(rawMatch.threshold ?? 90),
    low: !!rawMatch.low,
    // Cặp thuộc NV chưa lấy được nguồn tỷ lệ — KHÔNG phải catalog thiếu %.
    // Nêu ĐÍCH DANH mã NV để không ai phải đi dò xem "NV nào".
    unavailablePairs: Number(rawMatch.unavailablePairs || 0),
    unavailableEmployeeCount: Number(rawMatch.unavailableEmployeeCount || 0),
    unavailableEmployees: Array.isArray(rawMatch.unavailableEmployees) ? rawMatch.unavailableEmployees.map(String) : [],
  };
}

function normalizedColumnTotals(rawTotals, costColumns) {
  if (!rawTotals || typeof rawTotals !== 'object' || Array.isArray(rawTotals)) return null;
  return Object.fromEntries(costColumns.map((column) => {
    const raw = rawTotals[column.key];
    const value = raw == null ? null : Number(raw);
    return [column.key, Number.isFinite(value) ? value : null];
  }));
}

function normalizedFilterFacet(raw = {}, fallbackAvailable = true) {
  return {
    available: raw.available == null ? fallbackAvailable : !!raw.available,
    source: String(raw.source || ''),
    options: (Array.isArray(raw.options) ? raw.options : []).map((option) => ({
      value: String(option?.value || ''),
      label: String(option?.label || option?.value || ''),
      count: Number(option?.count || 0),
    })).filter((option) => option.value),
  };
}

function normalizedBonusPeriod(raw = {}) {
  const numberOrNull = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  return {
    target: numberOrNull(raw.target),
    achieved: numberOrNull(raw.achieved),
    pct: numberOrNull(raw.pct),
    bonusPct: numberOrNull(raw.bonusPct),
    baseBonusPct: numberOrNull(raw.baseBonusPct),
    baseAmount: numberOrNull(raw.baseAmount),
    priorityAmount: numberOrNull(raw.priorityAmount),
    priorityThresholdPct: numberOrNull(raw.priorityThresholdPct),
    priorityEligible: raw.priorityEligible === true,
    priorityStatus: String(raw.priorityStatus || ''),
    priorityTargetTotal: numberOrNull(raw.priorityTargetTotal),
    priorityTargetAssignedCount: numberOrNull(raw.priorityTargetAssignedCount),
    priorityTargetWarning: String(raw.priorityTargetWarning || ''),
    priorityGroups: (Array.isArray(raw.priorityGroups) ? raw.priorityGroups : []).map((item) => ({
      group: String(item?.group || ''),
      revenue: numberOrNull(item?.revenue),
      target: numberOrNull(item?.target),
      targetStatus: String(item?.targetStatus || ''),
      targetSource: String(item?.targetSource || ''),
      targetPeriods: (Array.isArray(item?.targetPeriods) ? item.targetPeriods : []).map((period) => ({
        period: String(period?.period || ''),
        target: numberOrNull(period?.target),
        targetSource: String(period?.targetSource || ''),
      })),
      excess: numberOrNull(item?.excess),
      ratePct: numberOrNull(item?.ratePct),
      amount: numberOrNull(item?.amount),
      reason: String(item?.reason || ''),
    })).filter((item) => item.group),
    priorityCoverage: {
      source: String(raw.priorityCoverage?.source || ''),
      sourceAvailable: raw.priorityCoverage?.sourceAvailable === true,
      totalRevenue: numberOrNull(raw.priorityCoverage?.totalRevenue),
      classifiedRevenue: numberOrNull(raw.priorityCoverage?.classifiedRevenue),
      unclassifiedRevenue: numberOrNull(raw.priorityCoverage?.unclassifiedRevenue),
      coveragePct: numberOrNull(raw.priorityCoverage?.coveragePct),
      c10ConflictCodes: numberOrNull(raw.priorityCoverage?.c10ConflictCodes),
      c10InvalidCodes: numberOrNull(raw.priorityCoverage?.c10InvalidCodes),
    },
    amount: numberOrNull(raw.amount),
    uncappedAmount: numberOrNull(raw.uncappedAmount),
    capAmount: numberOrNull(raw.capAmount),
    capped: raw.capped === true,
    status: String(raw.status || ''),
    contributors: numberOrNull(raw.contributors),
    tier: raw.tier && typeof raw.tier === 'object' ? {
      fromPct: numberOrNull(raw.tier.fromPct),
      toPct: numberOrNull(raw.tier.toPct),
      bonusPct: numberOrNull(raw.tier.bonusPct),
    } : null,
  };
}

export function employeeBonusViewModel(raw = {}) {
  return {
    configured: raw.configured === true,
    aggregate: raw.aggregate === true,
    message: String(raw.message || (raw.configured === true ? '' : 'Chưa cấu hình mức thưởng')),
    base: String(raw.base || 'revenue_before_vat'),
    currency: String(raw.currency || 'VND'),
    schemaVersion: Number(raw.schemaVersion || 0),
    version: String(raw.version || ''),
    effectiveFrom: String(raw.effectiveFrom || ''),
    capPct: raw.capPct == null || !Number.isFinite(Number(raw.capPct)) ? null : Number(raw.capPct),
    totalCapPct: raw.totalCapPct == null || !Number.isFinite(Number(raw.totalCapPct)) ? null : Number(raw.totalCapPct),
    priorityThresholdPct: raw.priorityThresholdPct == null || !Number.isFinite(Number(raw.priorityThresholdPct)) ? null : Number(raw.priorityThresholdPct),
    priorityRates: raw.priorityRates && typeof raw.priorityRates === 'object' ? raw.priorityRates : {},
    priorityTargets: raw.priorityTargets && typeof raw.priorityTargets === 'object' ? raw.priorityTargets : {},
    autoGroupTargets: raw.autoGroupTargets !== false,
    disclaimer: String(raw.disclaimer || 'Dự kiến/tham khảo, không phải payroll.'),
    ky: String(raw.ky || ''),
    quarterLabel: String(raw.quarterLabel || ''),
    month: normalizedBonusPeriod(raw.month),
    quarter: normalizedBonusPeriod(raw.quarter),
    employeeSubtotals: (Array.isArray(raw.employeeSubtotals) ? raw.employeeSubtotals : []).map((item) => ({
      empCode: String(item?.empCode || ''),
      employeeName: String(item?.employeeName || item?.empCode || ''),
      month: normalizedBonusPeriod(item?.month),
      quarter: normalizedBonusPeriod(item?.quarter),
      // Chỉ nhận số phạt đã được backend tính theo đúng scope. Frontend không tự
      // suy phạt của nhân viên khác trong màn ALL.
      penalty: item?.penalty && typeof item.penalty === 'object' ? employeePenaltyViewModel(item.penalty) : null,
    })),
  };
}

function numberOrNull(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function employeePenaltyViewModel(raw = {}) {
  const warning = raw.warning && typeof raw.warning === 'object' ? {
    kind: String(raw.warning.kind || ''),
    nextThresholdPct: numberOrNull(raw.warning.nextThresholdPct),
    mustExceed: raw.warning.mustExceed === true,
    revenueGap: numberOrNull(raw.warning.revenueGap),
    moneyAtRisk: numberOrNull(raw.warning.moneyAtRisk),
    text: String(raw.warning.text || ''),
  } : null;
  return {
    available: !!raw && typeof raw === 'object' && Object.keys(raw).length > 0,
    aggregate: raw.aggregate === true,
    scope: String(raw.scope || ''),
    mode: String(raw.mode || 'off'),
    effectiveFrom: String(raw.effectiveFrom || ''),
    enabled: raw.enabled === true,
    targetPct: numberOrNull(raw.targetPct),
    tier: String(raw.tier || ''),
    ratePct: numberOrNull(raw.ratePct),
    c45Amount: numberOrNull(raw.c45Amount),
    provisionalC45Amount: numberOrNull(raw.provisionalC45Amount),
    targetAmount: numberOrNull(raw.targetAmount),
    provisionalTargetAmount: numberOrNull(raw.provisionalTargetAmount),
    targetStatus: String(raw.targetStatus || raw.penaltyStatus || ''),
    penaltyStatus: String(raw.penaltyStatus || raw.targetStatus || ''),
    c45Dropped: raw.c45Dropped === true,
    c45WouldDrop: raw.c45WouldDrop === true,
    xuAmount: numberOrNull(raw.xuAmount),
    provisionalXuAmount: numberOrNull(raw.provisionalXuAmount),
    xuStatus: String(raw.xuStatus || ''),
    xuMissing: numberOrNull(raw.xuMissing),
    xuEmployeeCount: Number(raw.xuEmployeeCount || 0),
    xuContributors: Number(raw.xuContributors || 0),
    total: numberOrNull(raw.total),
    provisionalTotal: numberOrNull(raw.provisionalTotal),
    appliedAmount: numberOrNull(raw.appliedAmount),
    provisionalAppliedAmount: numberOrNull(raw.provisionalAppliedAmount),
    appliedContributors: Number(raw.appliedContributors || 0),
    cappedByC45: raw.cappedByC45 === true,
    provisional: raw.provisional === true,
    formulaText: String(raw.formulaText || ''),
    label: String(raw.label || 'Dự kiến/tham khảo — chưa trừ lương'),
    warning,
    baseTotal: numberOrNull(raw.baseTotal),
    afterPenaltyTotal: numberOrNull(raw.afterPenaltyTotal),
    employeeCount: Number(raw.employeeCount || 0),
    contributors: Number(raw.contributors || 0),
    unavailableCount: Number(raw.unavailableCount || 0),
    unavailableEmployees: (Array.isArray(raw.unavailableEmployees) ? raw.unavailableEmployees : []).map(String),
    complete: raw.complete === true,
    // Diễn giải cho người xem (CEO chốt 30/07): tên cột C45 và bảng 4 ngữ cảnh phạt
    // do BACKEND sinh từ cấu hình đang áp dụng. Frontend không tự viết mốc %/tỷ lệ.
    c45Label: String(raw.c45Label || ''),
    modeText: String(raw.modeText || ''),
    tiers: Array.isArray(raw.tiers) ? raw.tiers.map((tier) => ({
      tier: String(tier?.tier || ''),
      range: String(tier?.range || ''),
      effect: String(tier?.effect || ''),
      example: String(tier?.example || ''),
      ratePct: numberOrNull(tier?.ratePct),
      dropC45: tier?.dropC45 === true,
      active: tier?.active === true,
    })) : [],
  };
}

function normalizedTargetPeriod(raw = {}) {
  const numberOrNull = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  return {
    ky: String(raw.ky || ''),
    label: String(raw.label || raw.ky || ''),
    target: numberOrNull(raw.target),
    achieved: numberOrNull(raw.achieved),
    pct: numberOrNull(raw.pct),
    assigned: raw.assigned === true,
    source: String(raw.source || ''),
    sourceLabel: String(raw.source_label || (raw.assigned === true ? '' : 'Chưa giao target')),
    sourceKy: String(raw.source_ky || ''),
    reference: raw.reference === true,
  };
}

export function employeeTargetViewModel(raw = {}) {
  const month = normalizedTargetPeriod(raw.month);
  return {
    available: !!raw.emp_code && !!raw.ky,
    empCode: String(raw.emp_code || ''),
    ky: String(raw.ky || ''),
    basis: String(raw.basis || ''),
    basisLabel: String(raw.basis_label || ''),
    month,
    quarter: {
      label: String(raw.quarter?.label || ''),
      target: raw.quarter?.target == null || !Number.isFinite(Number(raw.quarter.target)) ? null : Number(raw.quarter.target),
      achieved: raw.quarter?.achieved == null || !Number.isFinite(Number(raw.quarter.achieved)) ? null : Number(raw.quarter.achieved),
      pct: raw.quarter?.pct == null || !Number.isFinite(Number(raw.quarter.pct)) ? null : Number(raw.quarter.pct),
      months: (Array.isArray(raw.quarter?.months) ? raw.quarter.months : []).map(normalizedTargetPeriod),
      unassignedKys: (Array.isArray(raw.quarter?.unassigned_kys) ? raw.quarter.unassigned_kys : []).map(String),
      calculation: String(raw.quarter?.calculation || ''),
      calculationLabel: String(raw.quarter?.calculation_label || ''),
      clarification: String(raw.quarter?.clarification || ''),
    },
  };
}

function periodViewModel(payload = {}) {
  const template = {
    key: String(payload.template?.key || ''),
    label: String(payload.template?.label || ''),
    calculationGroup: String(payload.template?.calculationGroup || ''),
    columns: Array.isArray(payload.template?.columns) ? payload.template.columns.map(String) : [],
  };
  const columns = buildEmployeeCostColumns(payload.columns, template);
  const dimensionColumns = columns.filter((column) => column.kind === 'dimension');
  const costColumns = columns.filter((column) => column.kind === 'percent');
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((source, rowIndex) => {
    const row = {
      rowIndex,
      stt: Number(source?.stt) || null,
      sourceLineId: String(source?.sourceLineId || `line-${rowIndex + 1}`),
      employeeCode: String(source?.employeeCode || ''),
      employeeName: String(source?.employeeName || ''),
      dailyAmounts: source?.dailyAmounts || null,
      dayRevenueMatched: !!source?.dayRevenueMatched,
      rowMonthlyTotal: source?.rowMonthlyTotal ?? null,
      rowAnnualTotal: source?.rowAnnualTotal ?? null,
    };
    for (const column of columns) {
      if (source && Object.prototype.hasOwnProperty.call(source, column.key)) row[column.key] = source[column.key];
    }
    return row;
  });
  const match = normalizedMatch(payload.match, rows.length);
  const rawSummary = payload.summary || {};
  const summary = {
    reliable: rawSummary.reliable !== false,
    monthlyTotal: rawSummary.monthlyTotal == null ? null : Number(rawSummary.monthlyTotal),
    annualTotal: rawSummary.annualTotal == null ? null : Number(rawSummary.annualTotal),
    revenueBeforeVatTotal: rawSummary.revenueBeforeVatTotal == null ? null : Number(rawSummary.revenueBeforeVatTotal),
    // Doanh thu ĐÃ gồm VAT — backend tính, hiển thị kèm để đối chiếu với App Sale.
    revenueTotal: rawSummary.revenueTotal == null ? null : Number(rawSummary.revenueTotal),
    columnTotals: normalizedColumnTotals(rawSummary.columnTotals, costColumns),
    provisionalMonthlyTotal: rawSummary.provisionalMonthlyTotal == null ? null : Number(rawSummary.provisionalMonthlyTotal),
    provisionalAnnualTotal: rawSummary.provisionalAnnualTotal == null ? null : Number(rawSummary.provisionalAnnualTotal),
    provisionalColumnTotals: normalizedColumnTotals(rawSummary.provisionalColumnTotals, costColumns),
    annualColumnKeys: Array.isArray(rawSummary.annualColumnKeys) ? rawSummary.annualColumnKeys.map(String) : [],
    annualLabels: Array.isArray(rawSummary.annualLabels) ? rawSummary.annualLabels.map(String) : [],
    penaltyAppliedAmount: numberOrNull(rawSummary.penaltyAppliedAmount),
    afterPenaltyTotal: numberOrNull(rawSummary.afterPenaltyTotal),
  };
  const rawDaily = payload.daily || {};
  const dates = rawDaily.reliable && Array.isArray(rawDaily.dates) ? rawDaily.dates.map(String) : [];
  const dailyRows = dates.flatMap((date) => rows
    .filter((row) => row.dailyAmounts?.[date])
    .map((row) => {
      const dailyRow = { ...row, date };
      let monthlyTotal = 0;
      let hasMonthlyAmount = false;
      for (const column of costColumns) {
        const amount = row.dailyAmounts[date]?.[column.key] ?? null;
        if (!column.annual && amount != null) { monthlyTotal += Number(amount); hasMonthlyAmount = true; }
      }
      dailyRow.rowMonthlyTotal = hasMonthlyAmount ? monthlyTotal : null;
      return dailyRow;
    }));
  return {
    empCode: String(payload.empCode || ''),
    period: String(payload.period || ''),
    rateEffectiveFrom: String(payload.rateEffectiveFrom || ''),
    rateEffectiveFroms: Array.isArray(payload.rateEffectiveFroms) ? payload.rateEffectiveFroms.map(String).filter(Boolean) : [],
    rateSource: String(payload.rateSource || ''),
    template,
    columns,
    dimensionColumns,
    costColumns,
    rows,
    match,
    summary,
    daily: {
      reliable: !!rawDaily.reliable,
      reason: String(rawDaily.reason || ''),
      dates,
      totals: Array.isArray(rawDaily.totals) ? rawDaily.totals : [],
      rows: dailyRows,
    },
    note: String(payload.note || (rows.length ? '' : EMPTY_NOTE)),
    dynamicCount: costColumns.length,
    search: {
      query: String(payload.search?.query || ''),
      filteredRows: Number(payload.search?.filteredRows ?? rows.length),
      totalRows: Number(payload.search?.totalRows ?? rows.length),
    },
    pagination: {
      page: Number(payload.pagination?.page || 1),
      pageSize: Number(payload.pagination?.pageSize || Math.max(rows.length, 1)),
      pageCount: Number(payload.pagination?.pageCount || 1),
      filteredRows: Number(payload.pagination?.filteredRows ?? rows.length),
      totalRows: Number(payload.pagination?.totalRows ?? rows.length),
    },
    employeeSubtotals: Array.isArray(payload.employeeSubtotals) ? payload.employeeSubtotals : [],
  };
}

export function employeeCostViewModel(payload = {}) {
  const hasPeriods = Array.isArray(payload.periods);
  const periods = (hasPeriods ? payload.periods : [payload]).map(periodViewModel);
  const rows = periods.flatMap((period) => period.rows);
  const rawMatch = payload.match || {};
  const aggregateMatch = hasPeriods ? normalizedMatch(rawMatch, rows.length) : periods[0].match;
  const rawSummary = payload.summary || {};
  const reliable = hasPeriods ? rawSummary.reliable === true : periods[0].summary.reliable;
  const first = periods[0] || periodViewModel({});
  const summary = hasPeriods ? {
    reliable,
    periodTotal: rawSummary.periodTotal == null ? null : Number(rawSummary.periodTotal),
    annualTotal: rawSummary.annualTotal == null ? null : Number(rawSummary.annualTotal),
    revenueBeforeVatTotal: rawSummary.revenueBeforeVatTotal == null ? null : Number(rawSummary.revenueBeforeVatTotal),
    revenueTotal: rawSummary.revenueTotal == null ? null : Number(rawSummary.revenueTotal),
    columnTotals: normalizedColumnTotals(rawSummary.columnTotals, first.costColumns),
    // Số tạm tính (tổng phần đã khớp %) — dùng để hiển thị kèm nhãn coverage khi
    // chưa đạt ngưỡng, thay vì để trống làm người xem tưởng hỏng.
    provisionalPeriodTotal: rawSummary.provisionalPeriodTotal == null ? null : Number(rawSummary.provisionalPeriodTotal),
    provisionalAnnualTotal: rawSummary.provisionalAnnualTotal == null ? null : Number(rawSummary.provisionalAnnualTotal),
    provisionalColumnTotals: normalizedColumnTotals(rawSummary.provisionalColumnTotals, first.costColumns),
    annualColumnKeys: Array.isArray(rawSummary.annualColumnKeys) ? rawSummary.annualColumnKeys.map(String) : [],
    monthlyTotal: periods.length === 1 ? periods[0].summary.monthlyTotal : null,
    annualLabels: [...new Set(periods.flatMap((period) => period.summary.annualLabels))],
    penaltyAppliedAmount: numberOrNull(rawSummary.penaltyAppliedAmount),
    afterPenaltyTotal: numberOrNull(rawSummary.afterPenaltyTotal),
  } : {
    ...periods[0].summary,
    periodTotal: periods[0].summary.monthlyTotal,
    provisionalPeriodTotal: periods[0].summary.provisionalMonthlyTotal ?? null,
  };
  return {
    empCode: String(payload.empCode || first.empCode || ''),
    from: String(payload.from || first.period || ''),
    to: String(payload.to || first.period || ''),
    // Tỷ lệ % lấy từ bảng công bố tháng nào (khi tháng đang xem chưa có bảng riêng).
    // Backend quyết định; UI chỉ nói ra, tuyệt đối không im lặng dùng số tháng khác.
    rateEffectiveFrom: String(payload.rateEffectiveFrom || ''),
    rateEffectiveFroms: [...new Set((Array.isArray(payload.rateEffectiveFroms)
      ? payload.rateEffectiveFroms : [payload.rateEffectiveFrom, ...periods.flatMap((period) => period.rateEffectiveFroms || [period.rateEffectiveFrom])])
      .filter(Boolean).map(String))].sort(),
    ratePolicy: {
      state: String(payload.ratePolicy?.state || ''),
      lookupOutcome: String(payload.ratePolicy?.lookupOutcome || ''),
      effectiveFrom: String(payload.ratePolicy?.effectiveFrom || payload.rateEffectiveFrom || ''),
      appliedPeriods: Number(payload.ratePolicy?.appliedPeriods || 0),
      unresolvedPeriods: Number(payload.ratePolicy?.unresolvedPeriods || 0),
    },
    periods,
    period: first.period,
    template: first.template,
    columns: first.columns,
    dimensionColumns: first.dimensionColumns,
    costColumns: first.costColumns,
    rows,
    match: aggregateMatch,
    summary,
    note: String(payload.note || (rows.length ? '' : EMPTY_NOTE)),
    dynamicCount: periods.reduce((sum, period) => sum + period.dynamicCount, 0),
    // Trạng thái khoá sổ kỳ (CEO chốt 30/07): trước ngày 8 tháng sau là DỰ KIẾN.
    // Frontend KHÔNG tự tính ngày — chỉ đọc lại số backend đã quyết theo giờ VN.
    periodClose: {
      closed: payload.periodClose?.closed === true,
      closeDay: Number(payload.periodClose?.closeDay || 0) || null,
      closeDate: String(payload.periodClose?.closeDate || ''),
      note: String(payload.periodClose?.note || ''),
      label: String(payload.periodClose?.label || ''),
    },
    allEmployees: !!payload.allEmployees,
    filters: {
      province: String(payload.filters?.province || ''),
      unitGroup: String(payload.filters?.unitGroup || ''),
      route: String(payload.filters?.route || ''),
      date: String(payload.filters?.date || ''),
    },
    filterOptions: {
      province: normalizedFilterFacet(payload.filterOptions?.province, false),
      unitGroup: normalizedFilterFacet(payload.filterOptions?.unitGroup),
      route: normalizedFilterFacet(payload.filterOptions?.route),
      date: normalizedFilterFacet(payload.filterOptions?.date),
    },
    search: {
      query: String(payload.search?.query || ''),
      filteredRows: Number(payload.search?.filteredRows ?? rows.length),
      totalRows: Number(payload.search?.totalRows ?? rows.length),
    },
    target: employeeTargetViewModel(payload.target),
    bonus: employeeBonusViewModel(payload.bonus),
    penalty: employeePenaltyViewModel(payload.penalty),
    // Projection App Salary đã được backend self-scope + allowlist. Frontend chỉ
    // chuẩn hoá để hiển thị, không nhận token và không tự suy số 0 khi thiếu.
    salaryAdvance: payload.salaryAdvance && typeof payload.salaryAdvance === 'object' ? {
      available: payload.salaryAdvance.available === true,
      applicable: payload.salaryAdvance.applicable == null ? null : payload.salaryAdvance.applicable === true,
      period: String(payload.salaryAdvance.period || ''),
      emp_code: String(payload.salaryAdvance.emp_code || ''),
      amount: Number.isSafeInteger(payload.salaryAdvance.amount) ? payload.salaryAdvance.amount : null,
      currency: String(payload.salaryAdvance.currency || ''),
      locked: payload.salaryAdvance.locked == null ? null : payload.salaryAdvance.locked === true,
      status: String(payload.salaryAdvance.status || ''),
      reason: payload.salaryAdvance.reason == null ? null : String(payload.salaryAdvance.reason),
      suspect: payload.salaryAdvance.suspect == null ? null : payload.salaryAdvance.suspect === true,
      suspect_reason: payload.salaryAdvance.suspect_reason == null ? null : String(payload.salaryAdvance.suspect_reason),
      suspectReason: payload.salaryAdvance.suspectReason == null ? null : String(payload.salaryAdvance.suspectReason),
      suspectMessage: payload.salaryAdvance.suspectMessage == null ? null : String(payload.salaryAdvance.suspectMessage),
      comparisonAfterPenaltyTotal: Number.isSafeInteger(payload.salaryAdvance.comparisonAfterPenaltyTotal)
        && payload.salaryAdvance.comparisonAfterPenaltyTotal >= 0 ? payload.salaryAdvance.comparisonAfterPenaltyTotal : null,
    } : null,
    // Bảng thanh toán TOÀN ĐỘI (chế độ Tất cả NV) — backend dựng, frontend chỉ vẽ.
    paymentTeam: payload.paymentTeam && typeof payload.paymentTeam === 'object' ? {
      period: String(payload.paymentTeam.period || ''),
      invariantOk: payload.paymentTeam.invariantOk !== false,
      totals: {
        employees: Number(payload.paymentTeam.totals?.employees || 0),
        total: numberOrNull(payload.paymentTeam.totals?.total),
        received: numberOrNull(payload.paymentTeam.totals?.received),
        outstanding: numberOrNull(payload.paymentTeam.totals?.outstanding),
        // CEO chốt 04/08: bảng CEO là TỔNG HỢP CHUNG — tách rõ 4 con số.
        firstAdvance: numberOrNull(payload.paymentTeam.totals?.firstAdvance),
        second: numberOrNull(payload.paymentTeam.totals?.second),
        final: numberOrNull(payload.paymentTeam.totals?.final),
        c44: numberOrNull(payload.paymentTeam.totals?.c44),
        employeesWithoutFirstAdvance: Number(payload.paymentTeam.totals?.employeesWithoutFirstAdvance || 0),
        overdueEmployees: Number(payload.paymentTeam.totals?.overdueEmployees || 0),
        overdueAmount: numberOrNull(payload.paymentTeam.totals?.overdueAmount),
      },
      rows: (Array.isArray(payload.paymentTeam.rows) ? payload.paymentTeam.rows : []).map((row) => ({
        empCode: String(row?.empCode || ''),
        employeeName: String(row?.employeeName || ''),
        total: numberOrNull(row?.total),
        received: numberOrNull(row?.received),
        outstanding: numberOrNull(row?.outstanding),
        firstAdvance: numberOrNull(row?.firstAdvance),
        firstAdvanceNone: row?.firstAdvanceNone === true,
        second: numberOrNull(row?.second),
        final: numberOrNull(row?.final),
        c44: numberOrNull(row?.c44),
        overdueCount: Number(row?.overdueCount || 0),
        overdueAmount: numberOrNull(row?.overdueAmount),
        nextLabel: String(row?.nextLabel || ''),
        nextDueDate: String(row?.nextDueDate || ''),
        nextAmount: numberOrNull(row?.nextAmount),
        nextDaysFromToday: row?.nextDaysFromToday == null ? null : Number(row.nextDaysFromToday),
      })),
      excluded: (Array.isArray(payload.paymentTeam.excluded) ? payload.paymentTeam.excluded : []).map((item) => ({
        empCode: String(item?.empCode || ''),
        employeeName: String(item?.employeeName || ''),
        reason: String(item?.reason || ''),
      })),
    } : null,
    // SỔ "Thanh toán CP của tôi" — backend tính hết, frontend CHỈ hiển thị.
    // Không tự cộng trừ lại: mọi số ở đây phải là số backend đã kiểm bất biến.
    paymentSchedule: payload.paymentSchedule && typeof payload.paymentSchedule === 'object' ? {
      available: payload.paymentSchedule.available === true,
      period: String(payload.paymentSchedule.period || ''),
      reason: payload.paymentSchedule.reason == null ? null : String(payload.paymentSchedule.reason),
      total: numberOrNull(payload.paymentSchedule.total),
      received: numberOrNull(payload.paymentSchedule.received),
      receivedFromSalary: numberOrNull(payload.paymentSchedule.receivedFromSalary),
      receivedRecorded: numberOrNull(payload.paymentSchedule.receivedRecorded),
      outstanding: numberOrNull(payload.paymentSchedule.outstanding),
      twoInstalmentsOnly: payload.paymentSchedule.twoInstalmentsOnly === true,
      invariantOk: payload.paymentSchedule.invariantOk !== false,
      warnings: Array.isArray(payload.paymentSchedule.warnings) ? payload.paymentSchedule.warnings.map(String) : [],
      c44: payload.paymentSchedule.c44 && typeof payload.paymentSchedule.c44 === 'object' ? {
        amount: numberOrNull(payload.paymentSchedule.c44.amount),
        note: String(payload.paymentSchedule.c44.note || ''),
      } : null,
      installments: (Array.isArray(payload.paymentSchedule.installments) ? payload.paymentSchedule.installments : []).map((item) => ({
        index: Number(item?.index || 0),
        key: String(item?.key || ''),
        label: String(item?.label || ''),
        amount: numberOrNull(item?.amount),
        dueDate: String(item?.dueDate || ''),
        gapNote: String(item?.gapNote || ''),
        status: String(item?.status || 'plan'),
        source: String(item?.source || ''),
        editable: item?.editable === true,
        noneReason: item?.noneReason == null ? null : String(item.noneReason),
        flowState: String(item?.flowState || 'plan'),
        flowBy: String(item?.flowBy || ''),
        flowAt: String(item?.flowAt || ''),
        flowNote: String(item?.flowNote || ''),
        canRequest: item?.canRequest === true,
        canRequestUnlock: item?.canRequestUnlock === true,
        graceDate: String(item?.graceDate || ''),
        graceDays: Number(item?.graceDays || 0),
        daysFromGrace: item?.daysFromGrace == null ? null : Number(item.daysFromGrace),
        daysFromToday: item?.daysFromToday == null ? null : Number(item.daysFromToday),
      })),
    } : null,
    // Phép trừ thuộc backend; frontend chỉ giữ projection allowlist để hiển thị.
    remainingAfterAdvance: payload.remainingAfterAdvance && typeof payload.remainingAfterAdvance === 'object' ? {
      available: payload.remainingAfterAdvance.available === true,
      period: String(payload.remainingAfterAdvance.period || ''),
      amount: Number.isSafeInteger(payload.remainingAfterAdvance.amount) && payload.remainingAfterAdvance.amount >= 0
        ? payload.remainingAfterAdvance.amount : null,
      afterPenaltyTotal: Number.isSafeInteger(payload.remainingAfterAdvance.afterPenaltyTotal)
        && payload.remainingAfterAdvance.afterPenaltyTotal >= 0 ? payload.remainingAfterAdvance.afterPenaltyTotal : null,
      salaryAdvanceAmount: Number.isSafeInteger(payload.remainingAfterAdvance.salaryAdvanceAmount)
        && payload.remainingAfterAdvance.salaryAdvanceAmount >= 0 ? payload.remainingAfterAdvance.salaryAdvanceAmount : null,
      currency: String(payload.remainingAfterAdvance.currency || ''),
      locked: payload.remainingAfterAdvance.locked === true,
      status: String(payload.remainingAfterAdvance.status || 'provisional'),
      suspect: payload.remainingAfterAdvance.suspect === true,
      reason: payload.remainingAfterAdvance.reason == null ? null : String(payload.remainingAfterAdvance.reason),
      note: String(payload.remainingAfterAdvance.note || ''),
    } : null,
  };
}

export function normalizeEmployeeCostSearch(value) {
  return String(value ?? '').toLocaleLowerCase('vi').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function employeeCostPageItems(page, pageCount) {
  const current = Math.min(Math.max(1, Number(page) || 1), Math.max(1, Number(pageCount) || 1));
  const total = Math.max(1, Number(pageCount) || 1);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const keep = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]
    .filter((value) => value >= 1 && value <= total));
  if (current <= 4) [2, 3, 4, 5].forEach((value) => keep.add(value));
  if (current >= total - 3) [total - 4, total - 3, total - 2, total - 1].forEach((value) => keep.add(value));
  const pages = [...keep].sort((a, b) => a - b);
  return pages.flatMap((value, index) => index && value - pages[index - 1] > 1 ? ['…', value] : [value]);
}

export function employeeCostSearchTokens(value) {
  return normalizeEmployeeCostSearch(value).split(/\s+/).filter(Boolean);
}

function employeeCostSearchForms(value) {
  const normalized = normalizeEmployeeCostSearch(value);
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const forms = new Set([normalized, words.join('')]);
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 2; end <= Math.min(words.length, start + 4); end += 1) {
      forms.add(`${words.slice(start, end - 1).map((word) => word[0]).join('')}${words[end - 1]}`);
    }
  }
  return [...forms];
}

function employeeCostSearchTextIncludes(value, token) {
  return employeeCostSearchForms(value).some((form) => form.includes(token));
}

function rowSearchText(row = {}, columns = []) {
  const values = [row.employeeCode, row.employeeName];
  for (const column of columns) {
    values.push(row[column.key]);
    if (column.kind === 'percent') values.push(row.amounts?.[column.key]);
  }
  return normalizeEmployeeCostSearch(values.filter((value) => value != null).join(' '));
}

export function filterSortEmployeeCostRows(rows = [], columns = [], query = '', sort = {}) {
  const tokens = employeeCostSearchTokens(query);
  const filtered = rows.filter((row) => {
    if (!tokens.length) return true;
    const forms = employeeCostSearchForms(rowSearchText(row, columns));
    return tokens.every((token) => forms.some((form) => form.includes(token)));
  });
  const key = String(sort.key || '');
  const direction = sort.dir === 'desc' ? -1 : 1;
  const sorted = key ? filtered.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = left.row[key]; const b = right.row[key];
    const aEmpty = a == null || a === ''; const bEmpty = b == null || b === '';
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? left.index - right.index : (aEmpty ? 1 : -1);
    const an = Number(a); const bn = Number(b);
    const compared = Number.isFinite(an) && Number.isFinite(bn)
      ? an - bn
      : String(a).localeCompare(String(b), 'vi', { numeric: true, sensitivity: 'base' });
    return compared ? compared * direction : left.index - right.index;
  }).map((item) => item.row) : filtered;
  return sorted.map((row, index) => ({ ...row, stt: index + 1 }));
}

export function employeeCostHighlightParts(value, query) {
  const text = String(value ?? '');
  const tokens = employeeCostSearchTokens(query);
  if (!text || !tokens.length) return [{ text, match: false }];
  const normalized = [];
  const sourceIndex = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text[index].toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    for (const char of unit) {
      if (/[a-z0-9]/.test(char)) { normalized.push(char); sourceIndex.push(index); }
      else if (normalized.at(-1) !== ' ') { normalized.push(' '); sourceIndex.push(index); }
    }
  }
  const haystack = normalized.join('');
  const ranges = [];
  for (const token of tokens) {
    let cursor = 0; let directlyMatched = false;
    while ((cursor = haystack.indexOf(token, cursor)) >= 0) {
      ranges.push([sourceIndex[cursor], (sourceIndex[cursor + token.length - 1] ?? sourceIndex[cursor]) + 1]);
      directlyMatched = true; cursor += token.length;
    }
    if (!directlyMatched && employeeCostSearchTextIncludes(text, token)) ranges.push([0, text.length]);
  }
  if (!ranges.length) return [{ text, match: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = ranges.reduce((result, range) => {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push([...range]);
    return result;
  }, []);
  const parts = []; let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true }); cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

export function employeeCostColumnKpis(model = {}) {
  const annualKeys = new Set(Array.isArray(model.summary?.annualColumnKeys) ? model.summary.annualColumnKeys : []);
  const totals = model.summary?.columnTotals;
  // Khi coverage chưa đạt ngưỡng, `columnTotals` bị khóa null (fail-closed) làm ô
  // KPI trống trơn. Vẫn hiện số tổng của PHẦN ĐÃ KHỚP nhưng gắn cờ `provisional`
  // để UI ghi rõ "tạm tính · chưa gồm mã thiếu %", không để người xem hiểu nhầm.
  const provisional = totals == null;
  // ‼ KHÔNG dòng nào khớp % ⇒ tổng phần đã khớp bằng 0, nhưng 0đ ở đây KHÔNG
  // phải "tạm tính" mà là KHÔNG CÓ SỐ (kỳ chưa có bảng % chi phí). Hiển thị 0đ
  // làm người xem tưởng app hỏng hoặc tưởng tháng này không tốn chi phí. Theo
  // luật fail-closed: thiếu dữ liệu hiện "—", không bao giờ hiện 0.
  const noMatch = employeeCostNoMatch(model);
  const source = noMatch ? null : (provisional ? model.summary?.provisionalColumnTotals : totals);
  return (Array.isArray(model.costColumns) ? model.costColumns : []).map((column) => ({
    key: column.key,
    label: column.label,
    annual: annualKeys.has(column.key),
    value: source?.[column.key] ?? null,
    provisional: !noMatch && provisional && source?.[column.key] != null,
  }));
}
