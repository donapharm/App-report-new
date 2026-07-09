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
    raw: r,
  };
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

module.exports = { CACHE_FILE, DEFAULT_URL, normUnitPrefix, normalizePayload, normalizeRow, fetchTenderQuota, cstForEmployeeUnits };
