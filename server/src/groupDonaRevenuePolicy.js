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
  // Từ T09, doanh thu thực Group-Dona chỉ đến từ hóa đơn đã hiện diện trong
  // App Công nợ. CRM là nguồn đối soát/cảnh báo, không được fallback hay cộng.
  return String(row.source || '').trim().toUpperCase() === 'DEBTS_INVOICE_SHADOW';
}
function enforce(rows = [], period) {
  if (!Array.isArray(rows)) throw Object.assign(new Error('REVENUE_ROWS_INVALID'), { code: 'REVENUE_ROWS_INVALID' });
  const accepted = []; const rejected = [];
  for (const row of rows) (sourceAllowed(row, period) ? accepted : rejected).push(row);
  return Object.freeze({ accepted: Object.freeze(accepted), rejected: Object.freeze(rejected) });
}

module.exports = { CUTOVER_PERIOD, normalizePeriod, entityOf, isGroupDona, isCutoverPeriod, sourceAllowed, enforce };
