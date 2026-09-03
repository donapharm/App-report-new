'use strict';

const CUTOVER_PERIOD = '2026-09';
const GROUP_DONA_ENTITIES = new Set(['DONA', 'AFP', '01.DONA', '02.AFP']);

function normalizePeriod(value) {
  const raw = String(value || '').trim();
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (iso) return raw;
  const ui = /^(0[1-9]|1[0-2])\.(\d{4})$/.exec(raw);
  return ui ? `${ui[2]}-${ui[1]}` : '';
}
function entityOf(row = {}) {
  return String(row.legal_entity || row.source_legal_entity_code || row.contractor_code || '').trim().toUpperCase();
}
function isGroupDona(row) { return GROUP_DONA_ENTITIES.has(entityOf(row)); }
function isCutoverPeriod(period) {
  const normalized = normalizePeriod(period);
  return Boolean(normalized && normalized >= CUTOVER_PERIOD);
}
function sourceAllowed(row = {}, period) {
  if (!isCutoverPeriod(period) || !isGroupDona(row)) return true;
  // T09 mở phải giữ cùng định nghĩa "Đã thực hiện" với App Sale:
  // CRM đã xuất hóa đơn + App Web đã xuất/giao. Debts chỉ là nguồn đối chứng
  // cho tới khi có một parity attestation riêng; không được âm thầm thay số CRM.
  return String(row.source || '').trim().toUpperCase() === 'CRM_MISA';
}
function enforce(rows = [], period) {
  if (!Array.isArray(rows)) throw Object.assign(new Error('REVENUE_ROWS_INVALID'), { code: 'REVENUE_ROWS_INVALID' });
  const accepted = []; const rejected = [];
  for (const row of rows) (sourceAllowed(row, period) ? accepted : rejected).push(row);
  return Object.freeze({ accepted: Object.freeze(accepted), rejected: Object.freeze(rejected) });
}

module.exports = { CUTOVER_PERIOD, normalizePeriod, entityOf, isGroupDona, isCutoverPeriod, sourceAllowed, enforce };
