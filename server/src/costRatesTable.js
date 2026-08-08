'use strict';
/**
 * BẢNG % ĐẦY ĐỦ C33–C46 TỪ KHO CỤC BỘ + MŨI DÒ THAY ĐỔI NGUỒN (Đợt 2 —
 * SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08/2026)
 *
 * Nguồn của bảng là KHO CỤC BỘ (`cost_rates_local`) — cố ý, đó là cả mục đích:
 * DataHub chết vẫn xem được, kèm căn cước "đồng bộ lúc nào, bởi ai".
 *
 * Mũi dò: chưa có trường version từ DataHub (đang xin) nên dò bằng CHỮ KÝ SỐ —
 * mỗi lượt lấy MỘT NV (xoay vòng) từ nguồn sống, so chữ ký cặp với kho.
 * Khác ⇒ huy hiệu "nguồn có thay đổi, bấm Đồng bộ". Nguồn chết ⇒ ghi nhận im lặng.
 * Tự giới hạn ≥30 phút/lượt — mở màn hình liên tục không thành tấn công nguồn.
 */

const persist = require('./persist');
const employeeCost = require('./employeeCost');
const employeeCostTemplates = require('./employeeCostTemplates');
const costRatesSync = require('./costRatesSync');
const catalogCostColumnGrants = require('./catalogCostColumnGrants');

const PROBE_FILE = 'cost_rates_probe_state';
const PROBE_MIN_INTERVAL_MS = 30 * 60 * 1000;

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const lower = (value) => text(value).toLowerCase();

/**
 * Dựng bảng theo cặp từ kho cục bộ, LỌC THEO QUYỀN ngay tại đây:
 * CEO thấy hết; NV chỉ thấy cột được cấp × đơn vị trong phạm vi × dòng của mình.
 */
function buildTable({ period, session, store = persist } = {}) {
  const entry = costRatesSync.statusOf(period, { store });
  if (!entry) return { period, available: false, reason: 'CHUA_DONG_BO', columns: [], rows: [], fetchedAt: null };

  const isCeo = !!session?.isCeo;
  const grant = catalogCostColumnGrants.readFor(session?.emp_code, { store });
  const template = employeeCostTemplates.resolveTemplate(session?.emp_code || '');
  const labelOf = (key) => template.costLabels?.[key] || key.toUpperCase();

  // Cột = whitelist ∩ (CEO: mọi cột có trong kho · NV: cột được cấp).
  const columnSet = new Set();
  const pairMap = new Map();
  const raw = store.load(costRatesSync.FILE, {})[text(period)] || {};
  for (const empCode of Object.keys(raw.employees || {}).sort()) {
    const kept = raw.employees[empCode];
    for (const column of kept.columns || []) {
      const key = lower(column?.key ?? column);
      if (catalogCostColumnGrants.isAllowedColumn(key)) columnSet.add(key);
    }
    for (const row of kept.rows || []) {
      const unit = upper(row.unit_code ?? row.c7);
      const product = upper(row.c5 ?? row.product_code);
      if (!unit || !product) continue;
      const key = `${unit}\u001f${product}`;
      const current = pairMap.get(key) || {
        unitCode: unit,
        productCode: product,
        productName: text(row.c16 ?? row.product_name) || product,
        employees: new Set(),
        rates: {},
      };
      current.employees.add(empCode);
      for (const columnKey of columnSet) {
        const value = row?.[columnKey];
        if (value != null && value !== '' && Number.isFinite(Number(value))) current.rates[columnKey] = Number(value);
      }
      pairMap.set(key, current);
    }
  }

  const allColumns = [...columnSet].sort();
  const visibleKeys = catalogCostColumnGrants.visibleColumns({ emp_code: session?.emp_code, isCeo }, allColumns, { store });
  const columns = allColumns
    .filter((key) => visibleKeys.includes(key))
    .map((key) => ({ key, label: labelOf(key) }));
  if (!columns.length) return { period, available: false, reason: 'KHONG_CO_QUYEN_COT', columns: [], rows: [], fetchedAt: entry.fetchedAt };

  const rows = [];
  for (const pair of pairMap.values()) {
    if (!isCeo) {
      // NV: chỉ dòng CÓ MÌNH phụ trách và đơn vị trong phạm vi được cấp.
      if (!pair.employees.has(upper(session?.emp_code))) continue;
      if (!catalogCostColumnGrants.unitInScope(grant, pair.unitCode)) continue;
    }
    rows.push({
      unitCode: pair.unitCode,
      productCode: pair.productCode,
      productName: pair.productName,
      employees: [...pair.employees].sort(),
      // Thiếu % ⇒ null ⇒ '—' trên màn. Không suy 0.
      rates: Object.fromEntries(columns.map(({ key }) => [key, pair.rates[key] ?? null])),
    });
  }
  rows.sort((a, b) => a.unitCode.localeCompare(b.unitCode, 'vi') || a.productCode.localeCompare(b.productCode, 'vi'));
  return { period, available: true, columns, rows, fetchedAt: entry.fetchedAt, fetchedBy: entry.fetchedBy, pairCount: rows.length };
}

/* ── Mũi dò thay đổi nguồn ──────────────────────────────────────────────────── */

function readProbe(store = persist) {
  const value = store.load(PROBE_FILE, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Dò MỘT NV (xoay vòng) so với kho. Gọi từ endpoint trạng thái — có người nhìn mới
 * dò, không cần scheduler; tự giãn ≥30 phút. KHÔNG bao giờ ném lỗi ra ngoài.
 */
async function probeSource({
  period,
  empCodes,
  store = persist,
  fetchImpl = employeeCost.fetchRawEmployeeCost,
  now = Date.now,
  minIntervalMs = PROBE_MIN_INTERVAL_MS,
} = {}) {
  const state = readProbe(store);
  const last = Number(state.at || 0);
  if (Number.isFinite(last) && now() - last < minIntervalMs) return state;

  const entry = store.load(costRatesSync.FILE, {})[text(period)];
  const codes = [...new Set((empCodes || []).map(upper))].filter((code) => entry?.employees?.[code]);
  if (!entry || !codes.length) return state;

  const cursor = (Number(state.cursor) || 0) % codes.length;
  const empCode = codes[cursor];
  const next = { at: now(), cursor: cursor + 1, empCode, period: text(period) };
  try {
    const result = await fetchImpl(empCode, { from: period, to: period, timeoutMs: 6500 });
    const periodPayload = (result?.payload?.periods || []).find((item) => item.period === period);
    if (result?.outcome !== 'ok' || !periodPayload?.rows?.length) {
      next.outcome = 'nguon_khong_phan_hoi';
      next.differs = state.differs === true; // nguồn chết thì GIỮ kết luận cũ, không xoá huy hiệu
    } else {
      const template = employeeCostTemplates.resolveTemplate(empCode);
      const live = costRatesSync.pairSignatures({ [empCode]: { rows: periodPayload.rows } }, template.costColumns || []);
      const kept = costRatesSync.pairSignatures({ [empCode]: { rows: entry.employees[empCode].rows || [] } }, template.costColumns || []);
      const diff = costRatesSync.diffSignatures(kept, live);
      next.outcome = 'ok';
      next.differs = diff.changed + diff.added + diff.removed > 0;
      next.diff = diff;
    }
  } catch {
    next.outcome = 'nguon_khong_phan_hoi';
    next.differs = state.differs === true;
  }
  store.save(PROBE_FILE, next);
  return next;
}

module.exports = { PROBE_FILE, PROBE_MIN_INTERVAL_MS, buildTable, probeSource, readProbe };
