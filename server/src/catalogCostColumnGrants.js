'use strict';
/**
 * PHÂN QUYỀN CỘT % CHI PHÍ TRONG "DANH MỤC QUẢN LÝ" (CEO chốt 06/08/2026)
 * Spec: SPEC_CATALOG_COST_COLUMNS.md
 *
 * CEO: *"chỉ CEO mới quản lý ai được xem cột nào, hiển thị cột nào, không ai khác.
 * Muốn có một menu phân quyền theo từng NV: được thấy cột nào / được thấy đơn vị
 * nào được hiển thị cột nào theo mình phụ trách."*
 *
 * ‼ Ba luật không được đổi:
 *  1. **MẶC ĐỊNH TẮT.** NV chưa được cấp thì KHÔNG thấy cột % nào. Không có
 *     "mặc định cho xem hết" — quên cấu hình phải nghiêng về phía kín, không hở.
 *  2. **Chỉ CEO ghi.** Kiểm ở route bằng `auth.isCeoActor`; module này không tự
 *     tin ai gọi nó, nên `setGrant` bắt buộc có `actor` để ghi audit.
 *  3. **Chỉ trong whitelist hợp đồng chi phí.** C33–C46; C32/C47 bị chặn vĩnh viễn
 *     ở tầng catalog nên không bao giờ được xuất hiện ở đây.
 *
 * Phạm vi đơn vị KHÔNG mở rộng quyền: nó chỉ THU HẸP trong số đơn vị NV đã phụ
 * trách. Danh sách đơn vị phụ trách vẫn do phân công quyết định, không phải file này.
 */

const persist = require('./persist');

const FILE = 'catalog_cost_column_grants';
const AUDIT_LIMIT = 500;
// Cùng luật với `isAllowedCostColumn` bên web (C33–C46). Có test khoá hai nơi khớp nhau.
const ALLOWED_COLUMN = /^c(?:3[3-9]|4[0-6])$/;
// C32 (tổng CP) và C47 (thành tiền CP) bị chặn vĩnh viễn ở catalogManagement —
// liệt kê tường minh để người đọc thấy ngay, dù regex trên đã loại sẵn.
const PERMANENTLY_BLOCKED = Object.freeze(['c32', 'c47']);
const ALL_UNITS = '*';
// Fail-closed: chưa cấp thì rỗng, và rỗng nghĩa là KHÔNG THẤY GÌ.
const EMPTY_GRANT = Object.freeze({ columns: Object.freeze([]), units: Object.freeze([]) });

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const lower = (value) => text(value).toLowerCase();

function isAllowedColumn(value) {
  const key = lower(value);
  return ALLOWED_COLUMN.test(key) && !PERMANENTLY_BLOCKED.includes(key);
}

function normalizeColumns(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const key = lower(item?.key ?? item);
    if (isAllowedColumn(key) && !out.includes(key)) out.push(key);
  }
  return out.sort();
}

function normalizeUnits(list) {
  const raw = Array.isArray(list) ? list : [];
  // '*' nghĩa là "mọi đơn vị NV đang phụ trách" — vẫn bị phân công chặn, không phải
  // "mọi đơn vị công ty". Có '*' thì các mã lẻ thừa, bỏ đi cho khỏi hiểu nhầm.
  if (raw.some((item) => text(item?.code ?? item) === ALL_UNITS)) return [ALL_UNITS];
  const out = [];
  for (const item of raw) {
    const code = upper(item?.code ?? item);
    if (code && !out.includes(code)) out.push(code);
  }
  return out.sort();
}

function readAll(store = persist) {
  const value = store.load(FILE, {});
  const rows = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { grants: rows.grants && typeof rows.grants === 'object' ? rows.grants : {}, audit: Array.isArray(rows.audit) ? rows.audit : [] };
}

/** Quyền của MỘT nhân viên. Chưa cấp ⇒ rỗng (không thấy gì) — không bao giờ trả null
 *  để nơi gọi khỏi phải nhớ xử lý null rồi lỡ tay coi như "cho xem hết". */
function readFor(empCode, { store = persist } = {}) {
  const code = upper(empCode);
  const entry = readAll(store).grants[code];
  if (!entry) return { empCode: code, ...EMPTY_GRANT, granted: false, updatedAt: null, updatedBy: null };
  return {
    empCode: code,
    columns: normalizeColumns(entry.columns),
    units: normalizeUnits(entry.units),
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
 * CEO đặt quyền cho một NV. `actor` là mã người thao tác — bắt buộc, để audit không
 * bao giờ trống. Route phải chặn `auth.isCeoActor` TRƯỚC khi gọi; module không tự
 * kiểm vai vì nó không nhìn thấy session.
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
  // Cột ngoài whitelist là LỖI, không im lặng bỏ qua: im lặng thì CEO tick nhầm
  // cột cấm mà vẫn thấy báo "đã lưu", tưởng đã cấp.
  for (const item of Array.isArray(grant.columns) ? grant.columns : []) {
    const key = lower(item?.key ?? item);
    if (key && !isAllowedColumn(key)) {
      throw Object.assign(new Error(`Cột ${key.toUpperCase()} không nằm trong hợp đồng chi phí được phép hiển thị`), {
        status: 400, code: 'CATALOG_GRANT_COLUMN_NOT_ALLOWED',
      });
    }
  }
  const columns = normalizeColumns(grant.columns);
  // Cấp cột mà không nói phạm vi ⇒ mặc định mọi đơn vị NV đang phụ trách.
  // Không cấp cột nào ⇒ phạm vi vô nghĩa, dọn về rỗng cho sổ sạch.
  const units = columns.length ? (normalizeUnits(grant.units).length ? normalizeUnits(grant.units) : [ALL_UNITS]) : [];

  const rows = readAll(store);
  const before = rows.grants[code] || null;
  const at = now();
  rows.grants[code] = { columns, units, updatedAt: at, updatedBy: who };
  rows.audit.unshift({
    at, actor: who, empCode: code,
    before: before ? { columns: normalizeColumns(before.columns), units: normalizeUnits(before.units) } : null,
    after: { columns, units },
  });
  rows.audit = rows.audit.slice(0, AUDIT_LIMIT);
  store.save(FILE, rows);
  return readFor(code, { store });
}

function listAudit({ store = persist, limit = 100 } = {}) {
  return readAll(store).audit.slice(0, Math.max(0, Number(limit) || 0));
}

/**
 * Cột NV này thực sự được thấy, giao với danh sách cột nguồn đang có.
 * CEO thấy tất cả. Người khác: chỉ phần được cấp. Chưa cấp ⇒ rỗng.
 */
function visibleColumns(session, availableColumns = [], { store = persist } = {}) {
  const available = normalizeColumns(availableColumns);
  const isCeo = !!session?.isCeo;
  if (isCeo) return available;
  const grant = readFor(session?.emp_code, { store });
  return available.filter((key) => grant.columns.includes(key));
}

/** Đơn vị này có nằm trong phạm vi được cấp không. Rỗng ⇒ KHÔNG. */
function unitInScope(grant, unitCode) {
  const units = normalizeUnits(grant?.units);
  if (!units.length) return false;
  if (units.includes(ALL_UNITS)) return true;
  return units.includes(upper(unitCode));
}

/** Có được xem % của đúng ô (đơn vị × cột) này không — dùng ngay tại chỗ render. */
function canSee(session, { unitCode, column }, { store = persist } = {}) {
  if (session?.isCeo) return true;
  const grant = readFor(session?.emp_code, { store });
  if (!grant.columns.includes(lower(column))) return false;
  return unitInScope(grant, unitCode);
}

module.exports = {
  FILE, AUDIT_LIMIT, ALL_UNITS, EMPTY_GRANT, PERMANENTLY_BLOCKED,
  isAllowedColumn, normalizeColumns, normalizeUnits,
  readFor, list, setGrant, listAudit, visibleColumns, unitInScope, canSee,
};
