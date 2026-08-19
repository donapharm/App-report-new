'use strict';

const os = require('os');
const zlib = require('zlib');
const catalogManagement = require('./catalogManagement');

// Máy PROD dùng chung và ít CPU. Hạ ưu tiên tiến trình phân tích LKG để health
// trên tiến trình web luôn được scheduler chạy trước, kể cả khi chỉ có một core.
try { os.setPriority(0, 19); } catch { /* best effort; correctness không phụ thuộc */ }

process.on('message', ({ id, period, projection }) => {
  try {
    const snapshot = catalogManagement.readCacheForTests(period);
    const value = projection === 'employee-cost-catalog'
      ? (snapshot ? (snapshot.catalog || snapshot.rows || []).map((row) => ({
        c5: row.c5,
        c7: row.c7,
        c10: row.c10,
        c16: row.c16,
      })) : null)
      : projection === 'catalog'
        ? (snapshot ? (snapshot.catalog || snapshot.rows || []) : null)
      : snapshot;
    // Structured-clone hàng chục nghìn object cũng làm main thread khựng lâu.
    // Chuyển một buffer nén duy nhất; giải nén chạy ở libuv threadpool phía main.
    const format = projection === 'employee-cost-catalog' && Array.isArray(value) ? 'ndjson' : 'json';
    const text = format === 'ndjson'
      ? value.map((row) => JSON.stringify(row)).join('\n')
      : JSON.stringify(value);
    const encoded = zlib.gzipSync(Buffer.from(text), { level: 1 });
    if (process.send) process.send({ id, encoded, format });
  } catch (error) {
    if (process.send) process.send({ id, error: { message: error?.message || String(error), code: error?.code || null } });
  }
});
