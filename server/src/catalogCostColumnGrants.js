'use strict';
/**
 * PHÂN QUYỀN CỘT % CHI PHÍ TRONG "DANH MỤC QUẢN LÝ" — BẢN V2 THEO NHÓM ĐƠN VỊ
 * Spec: SPEC_CATALOG_COST_COLUMNS.md · CEO chốt 06/08 + nâng chi tiết 08/08/2026.
 *
 * CEO 08/08: *"phải có phân quyền chi tiết cho mỗi NV được hiển thị chi tiết cho
 * loại cột 'C' nào, cho loại mã đơn vị nào... Ghi chú là phân quyền sẽ đi theo NHÓM
 * mã đơn vị... chứ không có chuyện NV DN008 chỉ xem được cột C41 ở 033.PKĐK An Long
 * Khánh mà ở 003.PKĐK An Long Thành lại không xem được."*
 *
 * ⇒ Mô hình v2: quyền là ma trận  NV × CỘT × NHÓM ĐƠN VỊ.
 *    { c41: ['*'], c43: ['PKĐK', 'BV'] }  — mỗi cột một danh sách nhóm riêng.
 *    Nhóm lấy từ `employeeCostUnitGroups.resolve` (BV/TTYT/PKĐK/NT/TYT/TTKSBT...)
 *    — cùng bộ nhóm màn "Chi phí của tôi" đang dùng, một nguồn duy nhất.
 *    Cấp theo nhóm là cấp CẢ nhóm: hai đơn vị cùng nhóm không bao giờ lệch nhau.
 *
 * ‼ Ba luật KHÔNG ĐỔI từ v1:
 *  1. **MẶC ĐỊNH TẮT.** Chưa cấp ⇒ không thấy gì; đơn vị không phân giải được nhóm
 *     ⇒ chỉ '*' mới phủ tới (fail-closed, không suy).
 *  2. **Chỉ CEO ghi** (route chặn `auth.isCeoActor`; setGrant bắt buộc actor).
 *  3. **Whitelist C33–C46; C32/C47 cấm vĩnh viễn.**
 *
 * Bản v1 cũ ({columns:[], units:[]} — một phạm vi chung cho mọi cột) được tự nâng
 * khi đọc: mỗi cột nhận phạm vi cũ; mã đơn vị lẻ được NỚI LÊN BIÊN NHÓM chứa nó
 * (đúng luật mới "đi theo nhóm"). Không cần bước chuyển đổi tay.
 */

const persist = require('./persist');
const unitGroups = require('./employeeCostUnitGroups');

const FILE = 'catalog_cost_column_grants';
const AUDIT_LIMIT = 500;
// Cùng luật với `isAllowedCostColumn` bên web (C33–C46). Có test khoá hai nơi khớp nhau.
const ALLOWED_COLUMN = /^c(?:3[3-9]|4[0-6])$/;
const PERMANENTLY_BLOCKED = Object.freeze(['c32', 'c47']);
// '*' = "mọi nhóm đơn vị NV đang phụ trách" — vẫn bị phân công chặn, không phải toàn công ty.
const ALL_UNITS = '*';
const EMPTY_GRANT = Object.freeze({ columns: Object.freeze({}), columnKeys: Object.freeze([]) });

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const lower = (value) => text(value).toLowerCase();

function isAllowedColumn(value) {
  const key = lower(value);
  return ALLOWED_COLUMN.test(key) && !PERMANENTLY_BLOCKED.includes(key);
}

/** Nhóm của một mã đơn vị — MỘT nguồn duy nhất, chung với màn Chi phí của tôi. */
function groupOf(unitCode) {
  return unitGroups.resolve(unitCode).key || '';
}

function normalizeGroups(list) {
  const raw = Array.isArray(list) ? list : [];
  if (raw.some((item) => text(item?.key ?? item) === ALL_UNITS)) return [ALL_UNITS];
  const out = [];
  for (const item of raw) {
    const key = unitGroups.normalizePrefix(item?.key ?? item);
    if (key && !out.includes(key)) out.push(key);
  }
  return out.sort();
}

/** Mã đơn vị lẻ → tập nhóm chứa chúng (nới lên biên nhóm — luật "đi theo nhóm"). */
function resolveUnitsToGroups(units = []) {
  const raw = Array.isArray(units) ? units : [];
  if (raw.some((item) => text(item?.code ?? item) === ALL_UNITS)) return [ALL_UNITS];
  const out = new Set();
  for (const item of raw) {
    const key = groupOf(item?.code ?? item);
    if (key) out.add(key);
  }
  return [...out].sort();
}

/**
 * Chuẩn hoá ma trận cột→nhóm. Nhận cả hai kiểu đầu vào:
 *  v2: { c41: ['*'], c43: ['PKĐK'] }
 *  v1: columns=['c41','c43'] + units=['*'|mã lẻ] — một phạm vi chung, tự nâng.
 * Cột ngoài whitelist là LỖI (không im lặng bỏ — CEO tick nhầm phải biết ngay).
 * Cột có phạm vi rỗng bị loại: "cấp cột mà không nhóm nào" = không cấp.
 */
function normalizeColumnScopes(grant = {}) {
  const scopes = {};
  const columnsValue = grant?.columns;
  if (columnsValue && typeof columnsValue === 'object' && !Array.isArray(columnsValue)) {
    for (const [rawKey, rawScope] of Object.entries(columnsValue)) {
      const key = lower(rawKey);
      if (!isAllowedColumn(key)) {
        throw Object.assign(new Error(`Cột ${key.toUpperCase() || '(trống)'} không nằm trong hợp đồng chi phí được phép hiển thị`), {
          status: 400, code: 'CATALOG_GRANT_COLUMN_NOT_ALLOWED',
        });
      }
      const groups = normalizeGroups(rawScope?.groups ?? rawScope);
      if (groups.length) scopes[key] = groups;
    }
    return scopes;
  }
  // v1: danh sách cột + một phạm vi đơn vị chung.
  const legacyColumns = [];
  for (const item of Array.isArray(columnsValue) ? columnsValue : []) {
    const key = lower(item?.key ?? item);
    if (!key) continue;
    if (!isAllowedColumn(key)) {
      throw Object.assign(new Error(`Cột ${key.toUpperCase()} không nằm trong hợp đồng chi phí được phép hiển thị`), {
        status: 400, code: 'CATALOG_GRANT_COLUMN_NOT_ALLOWED',
      });
    }
    if (!legacyColumns.includes(key)) legacyColumns.push(key);
  }
  if (!legacyColumns.length) return scopes;
  const units = Array.isArray(grant?.units) ? grant.units : [];
  const shared = units.length ? resolveUnitsToGroups(units) : [ALL_UNITS];
  const groups = shared.length ? shared : [ALL_UNITS];
  for (const key of legacyColumns.sort()) scopes[key] = [...groups];
  return scopes;
}

// Đọc entry đã lưu (tin cậy hơn payload ngoài, nhưng vẫn chuẩn hoá phòng file cũ/sửa tay).
function scopesOfEntry(entry) {
  try {
    return normalizeColumnScopes(entry || {});
  } catch {
    // File hỏng/cột cấm lọt vào từ đời cũ: fail-closed cột đó thay vì sập cả app.
    const scopes = {};
    const value = entry?.columns;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [rawKey, rawScope] of Object.entries(value)) {
        const key = lower(rawKey);
        if (!isAllowedColumn(key)) continue;
        const groups = normalizeGroups(rawScope?.groups ?? rawScope);
        if (groups.length) scopes[key] = groups;
      }
    }
    return scopes;
  }
}

function readAll(store = persist) {
  const value = store.load(FILE, {});
  const rows = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { grants: rows.grants && typeof rows.grants === 'object' ? rows.grants : {}, audit: Array.isArray(rows.audit) ? rows.audit : [] };
}

/** Quyền của MỘT nhân viên. Chưa cấp ⇒ rỗng (không thấy gì) — không bao giờ null. */
function readFor(empCode, { store = persist } = {}) {
  const code = upper(empCode);
  const entry = readAll(store).grants[code];
  if (!entry) return { empCode: code, columns: {}, columnKeys: [], granted: false, updatedAt: null, updatedBy: null };
  const columns = scopesOfEntry(entry);
  return {
    empCode: code,
    columns,
    columnKeys: Object.keys(columns).sort(),
    granted: true,
    updatedAt: entry.updatedAt || null,
    updatedBy: entry.updatedBy || null,
  };
}

function list({ store = persist } = {}) {
  const { grants } = readAll(store);
  return Object.keys(grants).sort().map((code) => readFor(code, { store }));
}

/**
 * CEO đặt quyền cho một NV — payload v2 {columns:{c41:['*']}}, v1 vẫn nhận (tự nâng).
 * `actor` bắt buộc để audit không bao giờ trống. Route phải chặn `auth.isCeoActor`.
 */
function setGrant(empCode, grant = {}, { actor, store = persist, now = () => new Date().toISOString() } = {}) {
  const code = upper(empCode);
  if (!/^(DN|VP)\d{3}$/.test(code)) {
    throw Object.assign(new Error('Mã nhân viên không hợp lệ'), { status: 400, code: 'CATALOG_GRANT_EMP_INVALID' });
  }
  const who = upper(actor);
  if (!who) {
    throw Object.assign(new Error('Thiếu người thao tác để ghi audit'), { status: 400, code: 'CATALOG_GRANT_ACTOR_REQUIRED' });
  }
  const columns = normalizeColumnScopes(grant);

  const rows = readAll(store);
  const before = rows.grants[code] || null;
  const at = now();
  rows.grants[code] = { columns, updatedAt: at, updatedBy: who };
  rows.audit.unshift({
    at, actor: who, empCode: code,
    before: before ? { columns: scopesOfEntry(before) } : null,
    after: { columns },
  });
  rows.audit = rows.audit.slice(0, AUDIT_LIMIT);
  store.save(FILE, rows);
  return readFor(code, { store });
}

function listAudit({ store = persist, limit = 100 } = {}) {
  return readAll(store).audit.slice(0, Math.max(0, Number(limit) || 0));
}

/** Phạm vi của MỘT cột có phủ đơn vị này không. '*' phủ mọi đơn vị NV phụ trách;
 *  danh sách nhóm chỉ phủ đơn vị PHÂN GIẢI ĐƯỢC vào nhóm đó — không phân giải
 *  được thì fail-closed, không suy. */
function columnScopeAllows(grant, column, unitCode) {
  const scope = grant?.columns?.[lower(column)];
  if (!Array.isArray(scope) || !scope.length) return false;
  if (scope.includes(ALL_UNITS)) return true;
  const group = groupOf(unitCode);
  return !!group && scope.includes(group);
}

/**
 * Cột NV này thực sự được thấy Ở ÍT NHẤT MỘT NHÓM, giao với cột nguồn đang có.
 * CEO thấy tất cả. Việc che TỪNG Ô (cột × đơn vị) làm tiếp bằng columnScopeAllows.
 */
function visibleColumns(session, availableColumns = [], { store = persist } = {}) {
  const available = [];
  for (const item of Array.isArray(availableColumns) ? availableColumns : []) {
    const key = lower(item?.key ?? item);
    if (isAllowedColumn(key) && !available.includes(key)) available.push(key);
  }
  available.sort();
  if (session?.isCeo) return available;
  const grant = readFor(session?.emp_code, { store });
  return available.filter((key) => grant.columnKeys.includes(key));
}

/** Đơn vị này có ÍT NHẤT MỘT cột được cấp phủ tới không — dùng để bỏ nguyên dòng. */
function unitInScope(grant, unitCode) {
  const keys = Object.keys(grant?.columns || {});
  return keys.some((key) => columnScopeAllows(grant, key, unitCode));
}

/** Có được xem % của đúng ô (đơn vị × cột) này không — dùng ngay tại chỗ render. */
function canSee(session, { unitCode, column }, { store = persist } = {}) {
  if (session?.isCeo) return true;
  const grant = readFor(session?.emp_code, { store });
  return columnScopeAllows(grant, column, unitCode);
}

module.exports = {
  FILE, AUDIT_LIMIT, ALL_UNITS, EMPTY_GRANT, PERMANENTLY_BLOCKED,
  isAllowedColumn, normalizeGroups, normalizeColumnScopes, resolveUnitsToGroups, groupOf,
  readFor, list, setGrant, listAudit,
  visibleColumns, columnScopeAllows, unitInScope, canSee,
};
