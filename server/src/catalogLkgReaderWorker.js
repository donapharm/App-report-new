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
    // ‼ KHÔNG chép tay danh sách trường ở đây. Bản trước tự liệt {c5,c7,c10,c16}
    // nên bỏ rơi c25/uom — 29 dòng T07 mất đơn vị tính mà mọi chỉ báo vẫn xanh.
    // Danh sách sống ở catalogManagement.EMPLOYEE_COST_CATALOG_PROJECTION_KEYS,
    // có ca kiểm quét alias giữ đồng bộ với enrichWithRevenue.
    const value = projection === 'employee-cost-catalog'
      ? (snapshot ? (snapshot.catalog || snapshot.rows || [])
        .map(catalogManagement.projectEmployeeCostCatalogRow) : null)
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
