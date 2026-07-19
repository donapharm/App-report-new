const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assignmentAdmin = require('./assignmentAdmin');
const store = require('./store');
const { provinceOf } = require('./province');

const CACHE_FILE = process.env.CATALOG_MANAGEMENT_CACHE_FILE || path.join(__dirname, '..', 'data', 'catalog_management_lkg.json');
const DEFAULT_TIMEOUT_MS = 6500;
const TYPE_LABELS = { unit_qlnb: 'Đơn vị + Mã QLNB', unit: 'Đơn vị', group: 'Nhóm ưu tiên', route: 'Tuyến', iit: 'Mã QLNB', special: 'Hàng cần đẩy', all: 'Toàn bộ' };
const EMPLOYEE_FORBIDDEN_KEYS = /(^|_)(?:(?:old|new|from|to)[_-]?emp|counterpart|actor|batch|transfer_batch_id|note|audit|history|by|internal)(_|$)/i;
const EMPLOYEE_FORBIDDEN_PHRASES = /bàn giao cho|nhận từ/i;
const PERMANENTLY_BLOCKED_CATALOG_FIELDS = Object.freeze(['c32', 'c47']);
const PERMANENTLY_BLOCKED_CATALOG_SET = new Set(PERMANENTLY_BLOCKED_CATALOG_FIELDS);
const APPROVED_OPTIONAL_CATALOG_FIELDS = Object.freeze([]);
const APPROVED_OPTIONAL_CATALOG_SET = new Set(APPROVED_OPTIONAL_CATALOG_FIELDS);

function normalizedFieldName(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}
function isPermanentlyBlockedCatalogField(value) {
  return PERMANENTLY_BLOCKED_CATALOG_SET.has(normalizedFieldName(value));
}
function isCatalogCostField(value) {
  return /^c(?:3[2-9]|4[0-7])$/.test(normalizedFieldName(value));
}
function assertNoPermanentCatalogFields(value, pathName = 'catalogPayload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPermanentCatalogFields(item, `${pathName}[${index}]`));
    return true;
  }
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    if (isPermanentlyBlockedCatalogField(key)) {
      throw Object.assign(new Error(`Permanent catalog field blocked at ${pathName}.${key}`), {
        status: 502,
        code: 'CATALOG_PERMANENT_FIELD_BLOCKED',
      });
    }
    assertNoPermanentCatalogFields(child, `${pathName}.${key}`);
  }
  return true;
}
function assertCatalogFieldPolicy(value, pathName = 'catalogPayload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCatalogFieldPolicy(item, `${pathName}[${index}]`));
    return true;
  }
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    const field = normalizedFieldName(key);
    if (isPermanentlyBlockedCatalogField(field)) {
      throw Object.assign(new Error(`Permanent catalog field blocked at ${pathName}.${key}`), {
        status: 502,
        code: 'CATALOG_PERMANENT_FIELD_BLOCKED',
      });
    }
    if (isCatalogCostField(field) && !APPROVED_OPTIONAL_CATALOG_SET.has(field)) {
      throw Object.assign(new Error(`Catalog field is not approved at ${pathName}.${key}`), {
        status: 502,
        code: 'CATALOG_FIELD_NOT_APPROVED',
      });
    }
    assertCatalogFieldPolicy(child, `${pathName}.${key}`);
  }
  return true;
}

function configured() {
  return Boolean(String(process.env.DATA_HUB_BASE_URL || '').trim() && String(process.env.DATA_HUB_ASSIGNMENT_KEY || '').trim());
}
function toHubPeriod(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}/.test(v)) return v.slice(0, 7);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  const m = v.match(/^(0[1-9]|1[0-2])\.(\d{4})$/);
  if (!m) throw Object.assign(new Error('Kỳ phải có dạng MM.YYYY hoặc YYYY-MM'), { status: 400 });
  return `${m[2]}-${m[1]}`;
}
function toUiPeriod(value) {
  const v = String(value || '').trim();
  const m = v.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? `${m[2]}.${m[1]}` : v;
}
function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function readCache(period) {
  try {
    const value = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    assertCatalogFieldPolicy(value, 'catalogLkg');
    const snapshot = value?.snapshots && period
      ? value.snapshots[period] || null
      : value && Array.isArray(value.rows) && (!period || value.period === period) ? value : null;
    if (snapshot) assertCatalogSnapshotContract(snapshot, `catalogLkg.${period || snapshot.period || 'legacy'}`);
    return snapshot;
  } catch { return null; }
}
function safeRestoredSnapshots(restoredSnapshots = {}) {
  const safe = {};
  for (const [period, restored] of Object.entries(restoredSnapshots || {})) {
    try {
      assertCatalogFieldPolicy(restored, `restoredCatalogLkg.${period}`);
      assertCatalogSnapshotContract(restored, `restoredCatalogLkg.${period}`);
      safe[period] = restored;
    }
    catch { /* permanently omit contaminated snapshots during the next rewrite */ }
  }
  return safe;
}
function writeCacheAtomic(snapshot) {
  assertCatalogFieldPolicy(snapshot, 'catalogSnapshot');
  assertCatalogSnapshotContract(snapshot, 'catalogSnapshot');
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  let current = {};
  try { current = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch { current = {}; }
  const restoredSnapshots = current.snapshots || (Array.isArray(current.rows) && current.period ? { [current.period]: current } : {});
  // A reset/restore may bring back an old poisoned snapshot. Never carry it
  // into the next LKG: retain only snapshots that pass the current policy.
  const snapshots = safeRestoredSnapshots(restoredSnapshots);
  snapshots[snapshot.period] = snapshot;
  const periods = Object.keys(snapshots).sort().slice(-18);
  const value = {
    source: 'data-hub-lkg', version: snapshot.meta.version, checksum: snapshot.meta.checksum,
    updatedAt: snapshot.meta.updatedAt, snapshots: Object.fromEntries(periods.map((p) => [p, snapshots[p]])),
  };
  assertCatalogFieldPolicy(value, 'catalogLkg');
  const tmp = `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CACHE_FILE);
}
function unwrap(value) {
  if (value && typeof value === 'object' && value.data && typeof value.data === 'object') return value.data;
  return value || {};
}
function arrayOf(value, names) {
  for (const name of names) if (Array.isArray(value?.[name])) return value[name];
  return [];
}
function normalizeRow(row = {}) {
  const scope = String(row.scope || '').trim().toLowerCase();
  const type = String(row.type || row.category_type || row.assignment_type || ({ unit_qlnb: 'unit_qlnb', qlnb: 'iit', don_vi: 'unit', route: 'route', all: 'all' }[scope]) || '').trim().toLowerCase();
  const value = String(row.value ?? row.code ?? row.category_key ?? row.assignment_value ?? '').trim();
  const emp = String(row.emp_code || row.employee_code || row.owner_emp_code || '').trim().toUpperCase();
  const unitCode = row.unit_code || null;
  return {
    id: String(row.id || row.assignment_id || `${emp}:${type}:${value}`),
    emp_code: emp,
    emp_name: String(row.emp_name || row.employee_name || store.findUserByCode(emp)?.name || emp),
    type,
    value,
    label: String(row.label || row.category_label || (type === 'unit_qlnb'
      ? `${row.unit_code || value.split('\u001f')[0] || '—'} · ${row.qlnb_code || value.split('\u001f')[1] || '—'}`
      : `${TYPE_LABELS[type] || type}${value && value !== 'all' ? ` · ${value}` : ''}`)),
    unit_code: unitCode,
    qlnb_code: row.qlnb_code || null,
    route: row.route || null,
    province: provinceOf(unitCode, row.unit_name || unitCode, row.province),
    contractor_code: row.contractor_code || row.c4 || null,
    product_name: row.product_name || row.c16 || null,
    active_ingredient: row.active_ingredient || row.c15 || null,
    strength: row.strength || row.ham_luong || row.c17 || null,
    uom: row.uom || row.c25 || null,
    bid_price: row.bid_price ?? row.c31 ?? null,
    effective_from: toHubPeriod(row.effective_from || row.from_period || row.from_ky || '01.1970'),
    effective_to: row.effective_to || row.to_period || row.to_ky ? toHubPeriod(row.effective_to || row.to_period || row.to_ky) : null,
    active: row.active !== false,
    source: String(row.source || 'data-hub'),
    transfer_batch_id: row.transfer_batch_id || row.batch_id || null,
    actor: row.actor || row.by || null,
    internal_note: row.internal_note || row.note || null,
  };
}
function enrichRowsFromCatalog(rows, catalog) {
  assertCatalogFieldPolicy(catalog, 'catalogProjection');
  const byPair = new Map();
  for (const row of catalog || []) {
    const key = `${String(row.c7 || '').trim()}\u001f${String(row.c5 || '').trim()}`;
    if (key !== '\u001f' && !byPair.has(key)) byPair.set(key, row);
  }
  return rows.map((row) => {
    const item = byPair.get(`${String(row.unit_code || '').trim()}\u001f${String(row.qlnb_code || '').trim()}`);
    return item ? { ...row, contractor_code: item.c4 || null, product_name: item.c16 || null, active_ingredient: item.c15 || null, strength: item.c17 || null, uom: item.c25 || null, bid_price: item.c31 ?? null } : row;
  });
}
function assertContractorCoverage(catalog = []) {
  if (!Array.isArray(catalog) || !catalog.length) {
    throw Object.assign(new Error('Data Hub trả catalog rỗng; từ chối ghi đè cache tốt gần nhất.'), {
      status: 502,
      upstream: true,
      code: 'CATALOG_SOURCE_EMPTY',
    });
  }
  const missing = catalog.filter((row) => !String(row?.c4 || '').trim()).length;
  if (missing) {
    throw Object.assign(new Error(`Data Hub thiếu C4/Mã nhà thầu ở ${missing}/${catalog.length} dòng catalog; từ chối ghi đè cache tốt gần nhất.`), {
      status: 502,
      upstream: true,
      code: 'CATALOG_CONTRACTOR_C4_MISSING',
    });
  }
  return true;
}
const CRITICAL_CATALOG_FIELDS = Object.freeze([
  'contractor_code', 'unit_code', 'qlnb_code', 'product_name',
  'active_ingredient', 'strength', 'uom', 'bid_price',
]);
const CRITICAL_CATALOG_SOURCE_FIELDS = Object.freeze(['c4', 'c5', 'c7', 'c15', 'c16', 'c17', 'c25', 'c31']);
function presentValue(value) {
  return value !== null && value !== undefined && !(typeof value === 'string' && !value.trim());
}
function firstPresentValue(row, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row || {}, field) && presentValue(row[field])) return row[field];
  }
  return null;
}
function cstValue(value) {
  if (!presentValue(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw Object.assign(new Error(`Nguồn CST có giá trị số không hợp lệ: ${String(value)}`), {
      status: 502,
      code: 'CATALOG_CST_INVALID_NUMBER',
    });
  }
  return number;
}
function assertCatalogSourceContract(catalog = [], rows = [], pathName = 'dataHubCatalogPayload') {
  assertContractorCoverage(catalog);
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('Data Hub trả danh sách phân công rỗng; từ chối ghi đè cache tốt gần nhất.'), {
      status: 502, upstream: true, code: 'CATALOG_ASSIGNMENTS_EMPTY',
    });
  }
  for (const field of CRITICAL_CATALOG_SOURCE_FIELDS) {
    const missing = catalog.filter((row) => !presentValue(row?.[field])).length;
    if (missing) {
      throw Object.assign(new Error(`Data Hub thiếu ${field} ở ${missing}/${catalog.length} dòng catalog; từ chối ghi đè cache tốt gần nhất.`), {
        status: 502, upstream: true, code: 'CATALOG_CRITICAL_SOURCE_MISSING', details: { field, missing, total: catalog.length, pathName },
      });
    }
  }
  const invalidUnitQlnb = rows.filter((row) => row.type === 'unit_qlnb'
    && (!String(row.unit_code || '').trim() || !String(row.qlnb_code || '').trim()));
  if (invalidUnitQlnb.length) {
    throw Object.assign(new Error(`Data Hub có ${invalidUnitQlnb.length} phân công đơn vị + QLNB thiếu khóa; từ chối ghi đè cache tốt gần nhất.`), {
      status: 502, upstream: true, code: 'CATALOG_ASSIGNMENT_KEY_MISSING', details: { missing: invalidUnitQlnb.length, total: rows.length, pathName },
    });
  }
  const catalogPairs = new Set(catalog.map((row) => `${String(row.c7 || '').trim()}\u001f${String(row.c5 || '').trim()}`));
  const pairRows = rows.filter((row) => String(row.unit_code || '').trim() && String(row.qlnb_code || '').trim());
  const missingPairs = pairRows.filter((row) => !catalogPairs.has(`${String(row.unit_code).trim()}\u001f${String(row.qlnb_code).trim()}`));
  if (missingPairs.length) {
    throw Object.assign(new Error(`Data Hub thiếu catalog cho ${missingPairs.length}/${pairRows.length} cặp đơn vị + QLNB; từ chối ghi đè cache tốt gần nhất.`), {
      status: 502, upstream: true, code: 'CATALOG_PAIR_COVERAGE_MISSING', details: { missing: missingPairs.length, total: pairRows.length, pathName },
    });
  }
  return { catalogRows: catalog.length, assignmentRows: rows.length, pairRows: pairRows.length };
}
function assertCatalogSnapshotContract(snapshot = {}, pathName = 'catalogSnapshot') {
  return assertCatalogSourceContract(snapshot.catalog, snapshot.rows, pathName);
}
function cstRowsByPair(cstRows = []) {
  const byPair = new Map();
  for (const item of cstRows || []) {
    const unit = String(item.unit_code ?? item.unitCode ?? '').trim();
    const qlnb = String(item.iit_code ?? item.productCode ?? '').trim();
    if (!unit || !qlnb) continue;
    const key = `${unit}\u001f${qlnb}`;
    const current = byPair.get(key) || { cst_initial: null, cst_remaining: null, cst_source: null };
    const initial = cstValue(firstPresentValue(item, ['bid_qty_initial', 'slTrungThau']));
    const remaining = cstValue(firstPresentValue(item, ['remain_qty', 'slConLai']));
    // Sparse overlays may enrich another dataset (for example C30) but must
    // never erase a complete CST baseline. Explicit zero remains a valid value.
    if (initial !== null) current.cst_initial = initial;
    if (remaining !== null) current.cst_remaining = remaining;
    if (initial !== null || remaining !== null) current.cst_source = item.cst_source || item.source || current.cst_source;
    if (initial !== null || remaining !== null) byPair.set(key, current);
  }
  return byPair;
}
function enrichRowsWithCst(rows, cstRows) {
  const byPair = cstRowsByPair(cstRows);
  return rows.map((row) => {
    const cst = byPair.get(`${String(row.unit_code || '').trim()}\u001f${String(row.qlnb_code || '').trim()}`);
    return cst ? { ...row, ...cst } : { ...row, cst_initial: null, cst_remaining: null, cst_source: null };
  });
}
function projectionError(message, details = {}) {
  return Object.assign(new Error(message), {
    status: 502,
    code: 'CATALOG_CRITICAL_FIELD_COVERAGE_LOSS',
    details,
  });
}
function assertCriticalProjectionCoverage(beforeRows = [], afterRows = []) {
  if (beforeRows.length !== afterRows.length) {
    throw projectionError(`Projection danh mục đổi số dòng bất thường: ${beforeRows.length} → ${afterRows.length}.`, {
      before: beforeRows.length, after: afterRows.length,
    });
  }
  for (let index = 0; index < beforeRows.length; index += 1) {
    const before = beforeRows[index] || {};
    const after = afterRows[index] || {};
    for (const field of CRITICAL_CATALOG_FIELDS) {
      if (presentValue(before[field]) && before[field] !== after[field]) {
        throw projectionError(`Projection làm thay đổi hoặc mất cột trọng yếu ${field} tại dòng ${index + 1}.`, {
          field, index, id: before.id || null, expected: before[field], actual: after[field] ?? null,
        });
      }
    }
  }
  return true;
}
function assertCstProjectionCoverage(rows = [], cstRows = []) {
  const expectedByPair = cstRowsByPair(cstRows);
  let matched = 0;
  for (const row of rows || []) {
    const key = `${String(row.unit_code || '').trim()}\u001f${String(row.qlnb_code || '').trim()}`;
    const expected = expectedByPair.get(key);
    if (!expected) continue;
    matched += 1;
    for (const field of ['cst_initial', 'cst_remaining']) {
      if (expected[field] !== null && (!presentValue(row[field]) || Number(row[field]) !== expected[field])) {
        throw projectionError(`Projection CST sai ${field} tại ${row.unit_code || '—'} + ${row.qlnb_code || '—'}.`, {
          field, key, expected: expected[field], actual: row[field] ?? null,
        });
      }
    }
  }
  return { sourcePairs: expectedByPair.size, matchedRows: matched };
}
function buildCatalogRows(rows = [], cstRows = []) {
  const enriched = enrichRowsWithCst(rows, cstRows);
  assertCriticalProjectionCoverage(rows, enriched);
  assertCstProjectionCoverage(enriched, cstRows);
  return enriched;
}
function localSnapshot(period, reason = 'Data Hub chưa được cấu hình') {
  const ky = toUiPeriod(period);
  const rows = assignmentAdmin.listAssignments({}).map((row) => normalizeRow({ ...row, source: 'local-fallback' }));
  const catalog = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8')); }
    catch { return {}; }
  })();
  // Audit local chỉ đi qua adminView; employeeView luôn dựng response từ whitelist riêng.
  const history = typeof assignmentAdmin.listAudit === 'function' ? assignmentAdmin.listAudit() : [];
  const body = { rows, catalog, history, period, readOnly: true };
  assertCatalogFieldPolicy(body, 'localCatalogSnapshot');
  return {
    ...body,
    meta: {
      source: 'local-fallback', version: 'local-phase1', checksum: checksum({ rows, catalog }),
      updatedAt: new Date().toISOString(), lastSyncAt: null, stale: true, readOnly: true,
      message: `${reason}. Hiển thị phân công local kỳ ${ky} ở chế độ chỉ đọc; không thay đổi quyền production.`,
    },
  };
}
async function fetchJson(url, options = {}) {
  const timeoutMs = Math.max(1000, Number(process.env.DATA_HUB_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: {
      accept: 'application/json', 'content-type': 'application/json',
      'x-assignment-key': String(process.env.DATA_HUB_ASSIGNMENT_KEY || ''),
      ...(options.headers || {}),
    } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `Data Hub HTTP ${response.status}`), { status: response.status, upstream: true });
    return unwrap(body);
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error(`Data Hub timeout sau ${timeoutMs}ms`), { upstream: true });
    throw error;
  } finally { clearTimeout(timer); }
}
function baseUrl() { return String(process.env.DATA_HUB_BASE_URL || '').trim().replace(/\/$/, ''); }
async function remoteSnapshot(period) {
  const root = `${baseUrl()}/api/integrations/app-report`;
  // Một snapshot kết hợp bảo đảm catalog + timeline cùng version/checksum, tránh ghép hai lần đọc lệch thời điểm.
  const payload = await fetchJson(`${root}/assignments/catalog-management?ky=${encodeURIComponent(period)}`);
  assertCatalogFieldPolicy(payload, 'dataHubCatalogPayload');
  const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
  const assignmentRows = arrayOf(payload, ['rows', 'assignments', 'items']).map(normalizeRow);
  assertCatalogSourceContract(catalog, assignmentRows);
  const rows = enrichRowsFromCatalog(assignmentRows, catalog);
  const history = arrayOf(payload, ['history', 'audit', 'events']);
  const version = String(payload.version || payload.meta?.version || 'unknown');
  const upstreamChecksum = payload.checksum || payload.meta?.checksum;
  const syncedAt = new Date().toISOString();
  const snapshot = {
    rows, catalog, history, period, readOnly: false,
    meta: { source: 'data-hub', version, checksum: String(upstreamChecksum || checksum({ rows, catalog })), updatedAt: payload.updatedAt || syncedAt, lastSyncAt: syncedAt, stale: false, readOnly: false, message: 'Đã đồng bộ Data Hub.' },
  };
  writeCacheAtomic(snapshot);
  return snapshot;
}
async function getSnapshot(periodInput) {
  const period = toHubPeriod(periodInput);
  // Data Hub is the only source of truth. Never present the legacy 1,808-row
  // local seed as the managed sales catalog. If configuration is temporarily
  // unavailable, only a previously validated Data Hub snapshot may be shown.
  if (!configured()) {
    const cached = readCache(period);
    if (cached) return { ...cached, period, readOnly: true, meta: { ...cached.meta, source: 'data-hub-lkg', stale: true, readOnly: true, message: 'Data Hub chưa được cấu hình; đang giữ bản đồng bộ tốt gần nhất ở chế độ chỉ đọc.' } };
    throw Object.assign(new Error('Data Hub chưa được cấu hình và chưa có bản đồng bộ tốt gần nhất.'), { status: 503 });
  }
  try { return await remoteSnapshot(period); }
  catch (error) {
    const cached = readCache(period);
    if (cached) return { ...cached, period, readOnly: true, meta: { ...cached.meta, source: 'data-hub-lkg', stale: true, readOnly: true, message: `Data Hub tạm lỗi; giữ bản đồng bộ tốt gần nhất. ${error.message}` } };
    throw Object.assign(new Error(`Data Hub tạm lỗi và chưa có bản đồng bộ tốt gần nhất: ${error.message}`), { status: 503 });
  }
}
function activeIn(row, period) {
  return row.active !== false && row.effective_from <= period && (!row.effective_to || row.effective_to >= period);
}
function employeeItem(row, status) {
  return { id: row.id, type: row.type, value: row.value, label: row.label, route: row.route, province: row.province || provinceOf(row.unit_code, row.unit_code), contractor_code: row.contractor_code, unit_code: row.unit_code, qlnb_code: row.qlnb_code, product_name: row.product_name, active_ingredient: row.active_ingredient, strength: row.strength, uom: row.uom, bid_price: row.bid_price, cst_initial: row.cst_initial, cst_remaining: row.cst_remaining, effective_from: row.effective_from, effective_to: row.effective_to, status };
}
function assertEmployeeSafe(value, pathName = 'response') {
  if (Array.isArray(value)) return value.forEach((v, i) => assertEmployeeSafe(v, `${pathName}[${i}]`));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && EMPLOYEE_FORBIDDEN_PHRASES.test(value)) throw new Error(`Employee privacy phrase at ${pathName}`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (EMPLOYEE_FORBIDDEN_KEYS.test(key) || isPermanentlyBlockedCatalogField(key)) throw new Error(`Employee privacy field at ${pathName}.${key}`);
    assertEmployeeSafe(child, `${pathName}.${key}`);
  }
}
function employeeView(snapshot, empCode, periodInput) {
  assertCatalogFieldPolicy(snapshot, 'employeeCatalogSnapshot');
  const period = toHubPeriod(periodInput);
  const emp = String(empCode || '').trim().toUpperCase();
  const own = snapshot.rows.filter((row) => row.emp_code === emp);
  const current = own.filter((row) => activeIn(row, period)).map((row) => employeeItem(row, 'current'));
  const ending = own.filter((row) => row.active !== false && row.effective_to === period).map((row) => employeeItem(row, 'ending'));
  const starting = own.filter((row) => row.active !== false && row.effective_from === period).map((row) => employeeItem(row, 'starting'));
  const response = {
    period, period_ui: toUiPeriod(period), employee: { code: emp, name: store.findUserByCode(emp)?.name || emp },
    sections: { current, ending, starting },
    meta: { source: snapshot.meta.source, version: snapshot.meta.version, checksum: snapshot.meta.checksum, updatedAt: snapshot.meta.updatedAt, lastSyncAt: snapshot.meta.lastSyncAt, stale: !!snapshot.meta.stale, readOnly: true, message: snapshot.meta.message },
  };
  assertEmployeeSafe(response);
  return response;
}
function adminView(snapshot) {
  assertCatalogFieldPolicy(snapshot, 'adminCatalogSnapshot');
  // The browser only needs the resolved unit+QLNB timeline. Keep the full
  // restricted catalog server-side in the versioned LKG snapshot to avoid
  // sending a duplicate ~6 MB payload on every CEO page load.
  const rows = snapshot.rows.map((row) => row.province ? row : { ...row, province: provinceOf(row.unit_code, row.unit_code) });
  return { period: snapshot.period, period_ui: toUiPeriod(snapshot.period), rows, catalog_total: Array.isArray(snapshot.catalog) ? snapshot.catalog.length : 0, history: snapshot.history || [], meta: snapshot.meta };
}
async function getHistory() {
  if (!configured()) return { history: [], source: 'unavailable' };
  const payload = await fetchJson(`${baseUrl()}/api/integrations/app-report/assignments/history?limit=300`);
  return { history: arrayOf(payload, ['history', 'rows', 'events']), source: 'data-hub' };
}
async function transfer(payload, session) {
  if (!configured()) throw Object.assign(new Error('Data Hub chưa được cấu hình. Đợt 1 không ghi local và không thay đổi quyền production.'), { status: 503 });
  const effectiveFrom = toHubPeriod(payload.effective_period || payload.period || payload.ky);
  const toEmp = String(payload.to_emp_code || payload.to_emp || '').trim().toUpperCase();
  const type = String(payload.type || '').trim().toLowerCase();
  const scope = ({ unit_qlnb: 'unit_qlnb', iit: 'qlnb', qlnb: 'qlnb', unit: 'don_vi', don_vi: 'don_vi', route: 'route', all: 'all' })[type];
  if (!scope) throw Object.assign(new Error('Loại điều chuyển không hợp lệ'), { status: 400 });
  if (!toEmp) throw Object.assign(new Error('Thiếu nhân viên tiếp nhận'), { status: 400 });
  const values = Array.isArray(payload.values) && payload.values.length ? payload.values : [payload.value];
  const items = values.map((value) => ({ scope, code: scope === 'all' ? 'ALL' : String(value || '').trim() })).filter((item) => item.code);
  if (!items.length) throw Object.assign(new Error('Thiếu mã điều chuyển'), { status: 400 });
  const body = { effective_from: effectiveFrom, to_emp: toEmp, items, reason: String(payload.note || payload.reason || '').trim() };
  return fetchJson(`${baseUrl()}/api/integrations/app-report/assignments/transfer`, {
    method: 'POST', headers: { 'x-app-report-actor': String(session.emp_code || session.name || 'App Report CEO') }, body: JSON.stringify(body),
  });
}
function diagnostics() {
  let cacheRoot = null;
  try { cacheRoot = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); assertCatalogFieldPolicy(cacheRoot, 'catalogLkg'); } catch { cacheRoot = null; }
  const count = cacheRoot?.snapshots ? Object.keys(cacheRoot.snapshots).length : (cacheRoot?.rows ? 1 : 0);
  return { configured: configured(), endpoint: configured() ? `${baseUrl()}/api/integrations/app-report` : null, timeoutMs: Math.max(1000, Number(process.env.DATA_HUB_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS), cache: count ? { available: true, periods: count, version: cacheRoot.version || cacheRoot.meta?.version || null, checksum: cacheRoot.checksum || cacheRoot.meta?.checksum || null, updatedAt: cacheRoot.updatedAt || cacheRoot.meta?.updatedAt || null } : { available: false }, phase1NoCutover: true };
}

module.exports = { configured, toHubPeriod, toUiPeriod, getSnapshot, getHistory, employeeView, adminView, transfer, diagnostics, assertEmployeeSafe, assertNoPermanentCatalogFields, assertCatalogFieldPolicy, assertContractorCoverage, assertCatalogSourceContract, assertCatalogSnapshotContract, assertCriticalProjectionCoverage, assertCstProjectionCoverage, buildCatalogRows, safeRestoredSnapshots, isPermanentlyBlockedCatalogField, PERMANENTLY_BLOCKED_CATALOG_FIELDS, APPROVED_OPTIONAL_CATALOG_FIELDS, CRITICAL_CATALOG_FIELDS, CRITICAL_CATALOG_SOURCE_FIELDS, normalizeRow, enrichRowsFromCatalog, enrichRowsWithCst, activeIn, CACHE_FILE };
