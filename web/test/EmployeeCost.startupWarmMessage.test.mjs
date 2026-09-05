import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('màn Chi phí hiển thị lời nhắc startup warm tiếng Việt, không hiện mã lỗi trần', () => {
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(api, /data\.error \|\| `Lỗi máy chủ/,
    'API phải ưu tiên lời giải thích tiếng Việt do backend trả về');
  assert.match(page, /setError\(requestError\.message \|\| 'Không thể tải dữ liệu'\)/,
    'màn Chi phí phải hiển thị lời giải thích thay vì mã lỗi');
});
