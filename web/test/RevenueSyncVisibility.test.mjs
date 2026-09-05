import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overview = fs.readFileSync(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');
const revenue = fs.readFileSync(new URL('../src/pages/Revenue.jsx', import.meta.url), 'utf8');

test('Overview and Revenue distinguish timestamps and say explicitly when job and activation coincide', () => {
  for (const page of [overview, revenue]) {
    assert.match(page, /Dữ liệu đến ngày/);
    assert.match(page, /Job chạy lúc/);
    assert.match(page, /Slot kích hoạt lúc/);
    assert.match(page, /Job chạy và slot kích hoạt cùng lúc/);
    assert.match(page, /Lần gần nhất/);
    assert.match(page, /Nguồn \{sourceName\}/);
    assert.match(page, /↻ Đồng bộ ngay/);
  }
});

test('Revenue manual sync warns before the write path and exposes error code', () => {
  assert.match(revenue, /window\.confirm/);
  assert.match(revenue, /readiness|cổng nguồn/);
  assert.match(revenue, /e\.code \|\| e\.message/);
});
