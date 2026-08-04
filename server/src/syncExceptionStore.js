'use strict';
/**
 * KHO NGOẠI LỆ "CHƯA ĐỒNG BỘ" — nơi materializer ghi ra phần bị loại của mỗi kỳ.
 *
 * Hợp đồng: mỗi lần materialize xong, bên phân loại ghi vào đây
 *   { period, runId, at, source:{amount,rows}, included:{amount,rows}, exceptions:[…] }
 * Màn hình đọc ra qua `syncExceptionReport` để kiểm bất biến rồi mới hiển thị.
 *
 * ‼ Kỳ CHƯA có bản ghi ⇒ trả `null`, KHÔNG trả rỗng. "Chưa chạy phân loại" khác
 * hẳn "đã chạy và không có dòng nào bị loại" — nhầm hai cái này là quay lại đúng
 * bệnh cũ: tưởng sạch trong khi thật ra chưa ai nhìn.
 */

const persist = require('./persist');

const FILE = 'sync_exceptions';
const MAX_PERIODS = 24;
const MAX_ROWS_PER_PERIOD = 5000;

function readAll(store = persist) {
  const rows = store.load(FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

function read(period, { store = persist } = {}) {
  const key = String(period || '').trim();
  const entry = readAll(store)[key];
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.exceptions)) return null;
  return entry;
}

function write(period, payload = {}, { store = persist, now = () => new Date().toISOString() } = {}) {
  const key = String(period || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
    throw Object.assign(new Error('Kỳ không hợp lệ'), { status: 400, code: 'SYNC_EXCEPTION_PERIOD_INVALID' });
  }
  const rows = readAll(store);
  const exceptions = Array.isArray(payload.exceptions) ? payload.exceptions.slice(0, MAX_ROWS_PER_PERIOD) : [];
  rows[key] = {
    period: key,
    runId: String(payload.runId || ''),
    at: now(),
    source: { amount: payload.source?.amount ?? null, rows: payload.source?.rows ?? null },
    included: { amount: payload.included?.amount ?? null, rows: payload.included?.rows ?? null },
    truncated: Array.isArray(payload.exceptions) && payload.exceptions.length > MAX_ROWS_PER_PERIOD,
    exceptions,
  };
  const keys = Object.keys(rows).sort();
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PERIODS))) delete rows[stale];
  store.save(FILE, rows);
  return rows[key];
}

module.exports = { FILE, MAX_PERIODS, MAX_ROWS_PER_PERIOD, read, write };
