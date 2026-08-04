'use strict';
/**
 * KHO LƯỢT ƯU TIÊN ỨNG SỚM — mỗi NV 1 lượt / quý (CEO chốt 04/08/2026 22:45).
 *
 * ‼ Lượt được TIÊU khi CEO ĐỒNG Ý MỞ KHOÁ, không phải lúc NV bấm xin. Nếu tiêu ngay
 * lúc xin thì CEO từ chối là NV mất trắng lượt của cả quý — vô lý, và NV sẽ không
 * dám bấm nữa. Xin mà bị từ chối thì vẫn còn nguyên lượt.
 */

const persist = require('./persist');
const policy = require('./earlyAdvancePolicy');

const FILE = 'payment_early_quota';
const MAX_RECORDS = 2000;

const keyOf = (empCode) => String(empCode || '').trim().toUpperCase();

function readAll(store = persist) {
  const rows = store.load(FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

/** Các lượt đã dùng của một NV: [{ period, quarter, at, by }]. */
function usedBy(empCode, { store = persist } = {}) {
  const rows = readAll(store)[keyOf(empCode)];
  return Array.isArray(rows) ? rows.filter((row) => row && row.period) : [];
}

/** Kiểm quyền — thuần đọc, không ghi. Dùng cả cho nút trên màn lẫn cho route. */
function check(empCode, period, today, { store = persist } = {}) {
  return policy.checkEarlyRequest({ period, today, used: usedBy(empCode, { store }) });
}

/**
 * Tiêu một lượt. Trả `null` nếu quý đó đã tiêu rồi (không tiêu chồng).
 * Ghi cả `by` để sau còn truy ai duyệt.
 */
function consume(empCode, period, { actor, now = () => new Date().toISOString(), store = persist } = {}) {
  const code = keyOf(empCode);
  const quarter = policy.quarterOf(period);
  if (!code || !quarter) return null;
  const rows = readAll(store);
  const list = Array.isArray(rows[code]) ? rows[code] : [];
  if (list.some((row) => policy.quarterOf(row?.period) === quarter)) return null;
  const record = { period: String(period), quarter, at: now(), by: String(actor || '').toUpperCase() };
  rows[code] = [...list, record].slice(-24);
  const codes = Object.keys(rows);
  if (codes.length > MAX_RECORDS) for (const stale of codes.slice(0, codes.length - MAX_RECORDS)) delete rows[stale];
  store.save(FILE, rows);
  return record;
}

module.exports = { FILE, keyOf, usedBy, check, consume };
