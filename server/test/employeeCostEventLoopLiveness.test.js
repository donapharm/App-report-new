'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const employeeCostCpu = require('../src/employeeCostCpu');
const { mapWithDeadline } = require('../src/requestDeadline');

function healthServer() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('C2: health vẫn trả lời trong khi ALL enrich nhiều dòng ở CPU worker', async (t) => {
  const server = await healthServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const revenueRows = Array.from({ length: 12_000 }, (_, index) => ({
    unit_code: `U${index % 30}`,
    c5: `P${index % 400}`,
    c16: `SP ${index % 400}`,
    orderCode: `O${index}`,
    revenue: 110,
    revenue_before_vat: 100,
    quantity: 1,
    date: '2026-08-01',
  }));
  const catalog = Array.from({ length: 12_000 }, (_, index) => ({
    c5: `P${index % 400}`, c7: `U${index % 30}`, c10: 'A', c16: `SP ${index % 400}`,
  }));
  const payload = {
    empCode: 'DN001', from: '2026-08', to: '2026-08',
    periods: [{ period: '2026-08', columns: [{ key: 'c33' }], rows: [{ c5: 'P1', c7: 'U1', c16: 'SP 1', c33: 1 }] }],
  };
  const build = employeeCostCpu.enrichRangePayload(payload, {
    revenueRowsByPeriod: { '2026-08': revenueRows },
    catalogRowsByPeriod: { '2026-08': catalog },
  });
  let probes = 0;
  let failures = 0;
  while (await Promise.race([build.then(() => false), new Promise((resolve) => setTimeout(() => resolve(true), 25))])) {
    probes += 1;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
      if (!response.ok) failures += 1;
    } catch { failures += 1; }
  }
  const result = await build;
  assert.equal(result.periods[0].rows.length, revenueRows.length);
  assert.ok(probes >= 2, `expected multiple health probes, got ${probes}`);
  assert.equal(failures, 0);
});

test('C2: fan-out nhả event loop giữa hai nhân viên mà không đổi concurrency/deadline', async () => {
  let immediateTicks = 0;
  const ticker = setInterval(() => { immediateTicks += 1; }, 0);
  const rows = Array.from({ length: 8 }, (_, index) => ({ emp_code: `DN${index}` }));
  const result = await mapWithDeadline(rows, 2, async (employee) => employee.emp_code, {
    deadlineAt: Date.now() + 5_000,
    onSkip: () => 'skip',
    yieldBetween: true,
  });
  clearInterval(ticker);
  assert.deepEqual(result, rows.map((row) => row.emp_code));
  assert.ok(immediateTicks > 0, 'event loop must be yielded during fan-out');
});
