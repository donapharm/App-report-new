'use strict';
/**
 * BỘ LỌC DÙNG CHUNG cho hai menu chi phí (CEO yêu cầu 09/08/2026).
 *
 * CEO xin thêm cho menu "Thành tiền C32·C47" đủ bộ lọc như menu Tổng hợp, kèm hai
 * chiều mới: **tên nhà thầu** và **group DONA / đối tác**. Đặt luật ở MỘT chỗ để
 * hai menu không bao giờ lọc lệch nhau — lọc lệch thì hai màn ra hai con số cho
 * cùng một câu hỏi, và không ai biết màn nào đúng.
 *
 * ‼ TÌM NHÓM MÃ PHẢI CÓ DẤU CHẤM (CEO nhấn mạnh):
 *   gõ `033.` ⇒ ra đúng cụm 033 (`033.PKĐK…`, `033.NT-PKĐK…`)
 *   gõ `033`  ⇒ KHÔNG đủ nghĩa: còn dính `0330`, `1033`… nên coi là tìm tự do.
 * Dấu chấm chính là ranh giới giữa số nhóm và tên đơn vị, bỏ nó đi là nhóm 001 nuốt
 * luôn nhóm 0011.
 */

// ‼ Nhóm mã đơn vị lấy ĐÚNG hàm gốc của app (`catalogCostColumnGrants.groupOf`) —
// chép lại một bản regex thứ hai ở đây là mở đường cho hai màn hiểu "nhóm 033" theo
// hai kiểu khác nhau, mà sai lệch loại đó không ai phát hiện ra bằng mắt.
const { groupOf } = require('./catalogCostColumnGrants');

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const normList = (value) => [...new Set((Array.isArray(value) ? value : []).map(upper).filter(Boolean))];

/* ── GROUP DONA / ĐỐI TÁC ─────────────────────────────────────────────────────
 * CEO: *"lọc theo group: Group-DONA / Group-đối tác"*. App Report không có sẵn
 * trường này; suy từ MÃ NHÀ THẦU (C4) — `01.DONA` là hàng nhà mình, `02.AFP`,
 * `04.NGUYEN`… là đối tác.
 *
 * ‼ Mẫu nhận diện để ở ĐÂY, một chỗ, đổi được bằng biến môi trường
 * `COST_DONA_CONTRACTOR_PATTERN` — KHÔNG rải chuỗi "DONA" khắp code. Mã nhà thầu
 * rỗng ⇒ trả '' (KHÔNG đoán bừa là đối tác): không biết thì nói không biết.
 */
const DONA_PATTERN = new RegExp(text(process.env.COST_DONA_CONTRACTOR_PATTERN) || 'DONA', 'i');
const PARTNER_GROUPS = Object.freeze([
  { key: 'DONA', label: 'Group-DONA (hàng nhà mình)' },
  { key: 'PARTNER', label: 'Group-đối tác' },
]);
function partnerGroupOf(contractorCode) {
  const code = upper(contractorCode);
  if (!code) return '';
  return DONA_PATTERN.test(code) ? 'DONA' : 'PARTNER';
}

/**
 * Chuẩn hoá bộ lọc. Danh sách rỗng = KHÔNG lọc chiều đó (hiện tất cả).
 * `groupQuery` là ô gõ tay tìm nhóm mã ("033."); `search` là tìm tự do mọi chiều.
 */
function normalizeFilters(raw = {}) {
  return {
    contractors: normList(raw.contractors),           // mã nhà thầu
    contractorNames: normList(raw.contractorNames),   // tên nhà thầu
    employees: normList(raw.employees),
    routes: normList(raw.routes),
    units: normList(raw.units),                       // mã đơn vị
    groups: normList(raw.groups),                     // nhóm mã đơn vị (001, 033…)
    partnerGroups: normList(raw.partnerGroups),       // DONA | PARTNER
    priorities: normList(raw.priorities),             // H.A*, H.A…
    groupQuery: text(raw.groupQuery),
    search: text(raw.search),
  };
}

/**
 * Ô gõ nhóm mã. CÓ dấu chấm ⇒ khớp đúng cụm đó; không có ⇒ trả null để nơi gọi
 * hiểu là "chưa đủ nghĩa, đừng lọc theo nhóm" và nói cho người dùng biết.
 */
function groupQueryPrefix(query) {
  const value = text(query);
  const match = /^(\d{1,4})\s*\.\s*$/.exec(value) || /^(\d{1,4})\s*\./.exec(value);
  return match ? match[1] : null;
}

/** Có chuỗi tìm tự do khớp bất kỳ chiều nào không. */
function matchesSearch(row, search) {
  const needle = upper(search);
  if (!needle) return true;
  return [row.empCode, row.empName, row.unitCode, row.unitName, row.productCode, row.productName,
    row.contractorCode, row.contractorName, row.route, row.priority]
    .some((value) => upper(value).includes(needle));
}

/**
 * Một dòng có lọt qua bộ lọc không. `row` là bản mô tả phẳng — nơi gọi tự dựng để
 * module này không phụ thuộc hình dạng dữ liệu của từng menu.
 */
function passes(row = {}, filters = {}) {
  const f = filters.groupQuery !== undefined ? filters : normalizeFilters(filters);
  if (f.contractors.length && !f.contractors.includes(upper(row.contractorCode))) return false;
  if (f.contractorNames.length && !f.contractorNames.includes(upper(row.contractorName))) return false;
  if (f.employees.length && !f.employees.includes(upper(row.empCode))) return false;
  if (f.routes.length && !f.routes.includes(upper(row.route))) return false;
  if (f.units.length && !f.units.includes(upper(row.unitCode))) return false;
  if (f.groups.length && !f.groups.includes(groupOf(row.unitCode))) return false;
  if (f.partnerGroups.length && !f.partnerGroups.includes(partnerGroupOf(row.contractorCode))) return false;
  if (f.priorities.length && !f.priorities.includes(upper(row.priority))) return false;
  const prefix = groupQueryPrefix(f.groupQuery);
  if (prefix && groupOf(row.unitCode) !== prefix) return false;
  if (!matchesSearch(row, f.search)) return false;
  return true;
}

/** Có đang lọc chiều nào không (dùng để biết khi nào được phép giấu dòng rỗng). */
function isActive(filters = {}) {
  const f = filters.groupQuery !== undefined ? filters : normalizeFilters(filters);
  return ['contractors', 'contractorNames', 'employees', 'routes', 'units', 'groups', 'partnerGroups', 'priorities']
    .some((key) => (f[key] || []).length) || !!groupQueryPrefix(f.groupQuery) || !!text(f.search);
}

/** Ô gõ nhóm có chữ nhưng thiếu dấu chấm ⇒ nói ra, không lặng lẽ bỏ qua. */
function groupQueryNote(query) {
  const value = text(query);
  if (!value) return '';
  if (groupQueryPrefix(value)) return '';
  return `Gõ "${value}" chưa đủ để lọc nhóm — phải có dấu chấm sau số nhóm (ví dụ "033."). `
    + 'Thiếu dấu chấm thì 001 sẽ nuốt luôn 0011, nên hệ thống KHÔNG lọc theo nhóm với chuỗi này.';
}

/**
 * Bốn chiều lọc nằm trên DÒNG DOANH THU (nhà thầu · tên nhà thầu · tuyến · ưu tiên
 * C10). Đọc ở MỘT chỗ để hai menu không mỗi nơi đọc một tên trường: nguồn thật có
 * lúc ghi `contractor_code`, có lúc `CONTRACTOR_CODE`, có lúc `c4`.
 * Thiếu thì để RỖNG — không suy, không lấy mã thay tên.
 */
function dimsOfRevenueRow(row = {}) {
  const pick = (...keys) => { for (const key of keys) { const v = text(row?.[key]); if (v) return v; } return ''; };
  return {
    contractorCode: pick('contractor_code', 'contractorCode', 'CONTRACTOR_CODE', 'c4', 'C4'),
    contractorName: pick('contractor_name', 'contractorName', 'CONTRACTOR_NAME'),
    route: pick('route', 'tuyen', 'ROUTE', 'TUYEN'),
    priority: pick('c10', 'C10', 'priority', 'PRIORITY'),
  };
}

/** Gom giá trị từng chiều để dựng danh sách chọn (thu TRƯỚC khi lọc). */
function collector() {
  const sets = {
    contractors: new Set(), contractorNames: new Set(), employees: new Set(),
    routes: new Set(), units: new Set(), groups: new Set(), partnerGroups: new Set(), priorities: new Set(),
  };
  return {
    add(row = {}) {
      if (row.contractorCode) sets.contractors.add(upper(row.contractorCode));
      if (row.contractorName) sets.contractorNames.add(upper(row.contractorName));
      if (row.empCode) sets.employees.add(upper(row.empCode));
      if (row.route) sets.routes.add(upper(row.route));
      if (row.unitCode) sets.units.add(upper(row.unitCode));
      const group = groupOf(row.unitCode);
      if (group) sets.groups.add(group);
      const partner = partnerGroupOf(row.contractorCode);
      if (partner) sets.partnerGroups.add(partner);
      if (row.priority) sets.priorities.add(upper(row.priority));
    },
    result() {
      return Object.fromEntries(Object.entries(sets)
        .map(([key, set]) => [key, [...set].sort((a, b) => a.localeCompare(b, 'vi'))]));
    },
  };
}

module.exports = {
  PARTNER_GROUPS, DONA_PATTERN,
  groupOf, partnerGroupOf, normalizeFilters, groupQueryPrefix, groupQueryNote,
  matchesSearch, passes, collector, dimsOfRevenueRow, isActive,
};
