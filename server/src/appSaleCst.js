/**
 * appSaleCst.js — đọc Cơ số thầu từ App Sale tender-quota.
 * Nguồn chuẩn đã duyệt: GET /api/reports/tender-quota (App Sale), field slConLai dùng thẳng.
 * Nếu API cần auth và chưa có token, dùng cache materialized server/data/cst_appsale_tender_quota.json
 * do job/server script cập nhật từ cùng nguồn App Sale.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cst_appsale_tender_quota.json');
const DEFAULT_URL = process.env.APP_SALE_TENDER_QUOTA_URL || 'http://127.0.0.1:3970/api/reports/tender-quota';
const AUTH_TOKEN = process.env.APP_SALE_AUTH_TOKEN || process.env.APP_SALE_BEARER_TOKEN || '';
const CACHE_TTL_MS = Number(process.env.APP_SALE_CST_CACHE_TTL_MS || 15 * 60 * 1000);
const SOURCE_MAX_AGE_MS = Number(process.env.APP_SALE_C30_MAX_AGE_MS || 24 * 60 * 60 * 1000);
const SOURCE_MIN_ROWS = Number(process.env.APP_SALE_C30_MIN_SOURCE_ROWS || 100);

let mem = null;

function readJson(file, def) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : def; }
  catch { return def; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function normUnitPrefix(v = '') {
  const m = String(v || '').trim().match(/^(\d{3})(?:\b|[.\-_\s])/);
  return m ? m[1] : String(v || '').trim().toUpperCase();
}
function normUnitExact(v = '') { return String(v || '').trim().toUpperCase().replace(/\s+/g, ' '); }
function normProductCode(v = '') { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
function tenderQuotaKey(unitCode, productCode) { return `${normUnitExact(unitCode)}|${normProductCode(productCode)}`; }
function optionalNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function statusLabel(status = '') {
  const code = String(status || '').trim().toLowerCase();
  const labels = {
    chua_du_dk: 'Chưa đủ điều kiện',
    du_dk_cho_ky: 'Đủ điều kiện · chờ ký',
    da_ky_hieu_luc: 'Đã ký · đang hiệu lực',
    du_dk: 'Đủ điều kiện',
    da_du_dk: 'Đủ điều kiện',
    co_the_mua_them: 'Có thể mua thêm',
    dang_lam_phu_luc: 'Đang làm phụ lục',
    da_ky_phu_luc: 'Đã ký phụ lục',
    da_het_c30: 'Đã dùng hết C30',
    het_c30: 'Đã dùng hết C30',
    khong_ap_dung: 'Không áp dụng',
  };
  return labels[code] || (code ? code.replaceAll('_', ' ') : 'Chưa có trạng thái');
}
function c30ExportFields(row = {}) {
  return {
    c30_route: row.c30 ? 'CL' : '',
    c30_max_qty: row.c30?.max_qty ?? '',
    c30_used_qty: row.c30?.used_qty ?? '',
    c30_remaining_qty: row.c30?.remaining_qty ?? '',
    c30_status: row.c30?.status_label || '',
  };
}
function yearsOf(value = '') {
  const out = new Set();
  for (const match of String(value || '').matchAll(/(?:^|\D)((?:19|20)\d{2}|\d{2})(?=\D|$)/g)) {
    const raw = Number(match[1]);
    out.add(raw < 100 ? 2000 + raw : raw);
  }
  return out;
}
function periodCompatible(cstRow, sourceRow) {
  const bidYears = yearsOf(cstRow.bid_package || cstRow.contract_period || '');
  const tenderYears = yearsOf(sourceRow.kyThau || '');
  if (!bidYears.size || !tenderYears.size) return false;
  return [...bidYears].some((year) => tenderYears.has(year));
}
function payloadFreshness(payload, now = Date.now()) {
  const generatedMs = Date.parse(payload?.generatedAt || '');
  const ageMs = Number.isFinite(generatedMs) ? Math.max(0, now - generatedMs) : null;
  const rowCount = Array.isArray(payload?.rows) ? payload.rows.length : 0;
  return {
    generatedAt: payload?.generatedAt || null,
    ageMs,
    stale: ageMs === null || ageMs > SOURCE_MAX_AGE_MS,
    available: rowCount > 0,
    rowCount,
    complete: rowCount >= SOURCE_MIN_ROWS,
  };
}
function normalizeRow(r = {}) {
  const unitCode = String(r.unitCode ?? r.unit_code ?? r.ma_dv ?? '').trim();
  const productCode = String(r.productCode ?? r.iit_code ?? r.ma_qlnb ?? '').trim();
  const slConLai = Number(r.slConLai ?? r.sl_con_lai ?? r.remain_qty ?? 0);
  const slTrungThau = r.slTrungThau ?? r.sl_trung_thau;
  return {
    unitCode,
    unitName: String(r.unitName ?? r.unit_name ?? unitCode).trim(),
    unitPrefix: normUnitPrefix(unitCode),
    route: String(r.route || '').trim().toUpperCase(),
    productCode,
    productName: String(r.productName ?? r.product_name ?? productCode).trim(),
    uom: String(r.uom || '').trim(),
    kyThau: r.kyThau ?? r.ky_thau ?? null,
    hasCst: r.hasCst !== false && !!productCode && !!unitCode,
    laApThau: Boolean(r.laApThau ?? r.la_ap_thau ?? false),
    slTrungThau: slTrungThau == null ? null : Number(slTrungThau || 0),
    slDat: Number(r.slDat ?? r.sl_dat ?? 0),
    slGiao: Number(r.slGiao ?? r.sl_giao ?? 0),
    // QUAN TRỌNG: dùng thẳng slConLai từ App Sale, không tự tính lại bằng cstFormula.
    slConLai,
    cstFormula: r.cstFormula ?? r.cst_formula ?? null,
    // Chỉ giữ số C30 đã dùng/còn lại khi API trả tường minh; không suy diễn từ tổng giao.
    c30Max: r.c30Max ?? r.c30_max ?? null,
    c30Used: r.c30Used ?? r.c30_used ?? null,
    c30Remaining: r.c30Remaining ?? r.c30_remaining ?? null,
    raw: r,
  };
}

/**
 * Ghép C30 theo đúng khóa đơn vị + mã QLNB. Không tự tính lại slConLai và cũng
 * không suy diễn "C30 đã dùng/còn lại" từ daGiao: chỉ nhận các field C30 tường
 * minh nếu nguồn có trả. Khóa trùng nhiều kỳ bị loại để tránh ghép nhầm hợp đồng.
 */
function enrichCstRowsWithC30(cstRows = [], payload = {}, { now = Date.now(), allowStale = false, allowPartial = false } = {}) {
  const freshness = payloadFreshness(payload, now);
  const sourceRows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!sourceRows.length || (freshness.stale && !allowStale) || (!freshness.complete && !allowPartial)) {
    return { rows: cstRows.map((row) => ({ ...row })), meta: { ...freshness, matched: 0, ambiguous: 0 } };
  }

  const candidates = new Map();
  for (const sourceRow of sourceRows) {
    if (String(sourceRow.route || '').trim().toUpperCase() !== 'CL' || sourceRow.laApThau) continue;
    const key = tenderQuotaKey(sourceRow.unitCode, sourceRow.productCode);
    const list = candidates.get(key) || [];
    list.push(sourceRow);
    candidates.set(key, list);
  }

  let matched = 0;
  let ambiguous = 0;
  const rows = cstRows.map((row) => {
    const list = candidates.get(tenderQuotaKey(row.unit_code || row.unit_name, row.iit_code)) || [];
    const periodMatches = list.filter((sourceRow) => periodCompatible(row, sourceRow));
    if (periodMatches.length !== 1) {
      if (list.length > 0) ambiguous += 1;
      return { ...row };
    }
    const sourceRow = periodMatches[0];
    const formula = sourceRow.cstFormula && typeof sourceRow.cstFormula === 'object' ? sourceRow.cstFormula : {};
    const maxQty = optionalNumber(formula.cst30, formula.c30, sourceRow.c30Max, sourceRow.c30_max);
    if (maxQty === null || maxQty <= 0) return { ...row };

    const usedQty = optionalNumber(formula.c30DaSuDung, formula.c30_da_su_dung, formula.daDungC30, sourceRow.c30Used, sourceRow.c30_used);
    const remainingQty = optionalNumber(formula.c30ConLai, formula.c30_con_lai, formula.conLaiC30, sourceRow.c30Remaining, sourceRow.c30_remaining);
    const statusCode = String(formula.trangThai30 ?? sourceRow.trangThai30 ?? '').trim().toLowerCase();
    const candidate = Number(row.remain_pct || 0) < 10;
    // Fail-closed: chỉ trạng thái nguồn "đủ điều kiện, chờ ký" mới là việc cần
    // chủ động làm phụ lục. "Chưa đủ điều kiện" và "đã ký hiệu lực" không được
    // gộp chung thành actionable.
    const actionable = candidate && statusCode === 'du_dk_cho_ky' && remainingQty !== 0;
    matched += 1;
    return {
      ...row,
      route: 'CL',
      c30: {
        max_qty: maxQty,
        used_qty: usedQty,
        remaining_qty: remainingQty,
        main_qty: optionalNumber(formula.cstChinh),
        delivered_qty: optionalNumber(formula.daGiao),
        pending_qty: optionalNumber(formula.dangChoGiao),
        transferred_qty: optionalNumber(formula.dieuChuyen),
        status_code: statusCode,
        status_label: statusLabel(statusCode),
        candidate,
        actionable,
        tender_period: sourceRow.kyThau ?? null,
      },
    };
  });
  return { rows, meta: { ...freshness, matched, ambiguous } };
}
function normalizePayload(payload, source = 'unknown') {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.items) ? payload.items : [];
  return {
    source,
    generatedAt: payload?.generatedAt || payload?.generated_at || new Date().toISOString(),
    notes: payload?.notes || null,
    rows: rows.map(normalizeRow).filter((r) => r.hasCst && r.productCode && r.unitCode),
  };
}
async function fetchTenderQuota({ force = false } = {}) {
  const now = Date.now();
  if (!force && mem && now - mem.at < CACHE_TTL_MS) return mem.value;
  const headers = { Accept: 'application/json' };
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  try {
    const res = await fetch(DEFAULT_URL, { headers });
    if (!res.ok) throw new Error(`App Sale tender-quota HTTP ${res.status}`);
    const payload = await res.json();
    const value = normalizePayload(payload, DEFAULT_URL);
    mem = { at: now, value };
    writeJson(CACHE_FILE, { ...value, cachedAt: new Date().toISOString() });
    return value;
  } catch (e) {
    const cached = readJson(CACHE_FILE, null);
    if (cached) {
      const value = normalizePayload(cached, `${CACHE_FILE} (cache; ${e.message})`);
      mem = { at: now, value };
      return value;
    }
    return { source: `${DEFAULT_URL} (unavailable)`, generatedAt: new Date().toISOString(), error: e.message, rows: [] };
  }
}
function cstForEmployeeUnits(cstRows, unitCodes = [], { includeApThau = false } = {}) {
  const exact = new Set(unitCodes.map((x) => String(x || '').trim()).filter(Boolean));
  const prefixCount = new Map();
  for (const u of exact) {
    const p = normUnitPrefix(u);
    prefixCount.set(p, (prefixCount.get(p) || 0) + 1);
  }
  return (cstRows || [])
    .filter((r) => exact.has(r.unitCode) || prefixCount.get(r.unitPrefix) === 1)
    .filter((r) => includeApThau || !r.laApThau)
    .filter((r) => Number(r.slConLai || 0) > 0)
    .sort((a, b) => Number(b.slConLai || 0) - Number(a.slConLai || 0));
}

module.exports = {
  CACHE_FILE, DEFAULT_URL, SOURCE_MAX_AGE_MS, SOURCE_MIN_ROWS,
  normUnitPrefix, normUnitExact, normProductCode, tenderQuotaKey, periodCompatible, normalizePayload, normalizeRow,
  fetchTenderQuota, cstForEmployeeUnits, payloadFreshness, enrichCstRowsWithC30, statusLabel, c30ExportFields,
};
