'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const monitor = require('../src/eventLoopMonitor');
const runtimeActivity = require('../src/runtimeActivity');
const { createSlowRequestTelemetry } = require('../src/slowRequestTelemetry');

test('lag giả chụp hiện trường ngay lúc phát hiện', () => {
  runtimeActivity.resetForTests();
  const request = runtimeActivity.beginRequest();
  const finishTask = runtimeActivity.beginBackground('employee-cost-warm:interval');
  const lines = [];
  const reporter = monitor.createAttributionReporter({
    warnMs: 1000,
    timestamp: () => '2026-08-22 07:00:01 GMT+7',
    warn: (label, record) => lines.push({ label, record }),
  });

  reporter.observe({ maxMs: 1200, p99Ms: 20, meanMs: 21 });
  request.finish();
  finishTask();

  assert.equal(lines.length, 1);
  assert.equal(lines[0].label, '[event-loop-attribution] NGHẼN');
  assert.deepEqual(lines[0].record.requestIds, [request.id]);
  assert.deepEqual(lines[0].record.backgroundTasks, ['employee-cost-warm:interval']);
  assert.equal(lines[0].record.windowMs, 1000);
});

test('yêu cầu 600ms được ghi theo route đã khớp; 100ms thì im', () => {
  let ns = 0n;
  const lines = [];
  const telemetry = createSlowRequestTelemetry({
    nowNs: () => ns,
    nowMs: () => 0,
    timestamp: () => '2026-08-22 07:00:01 GMT+7',
    warn: (label, record) => lines.push({ label, record }),
    autoFlush: false,
  });
  const sensitiveRequest = {
    method: 'GET', route: { path: '/employee-cost' },
    originalUrl: '/employee-cost?employee=DN001&customer=SECRET',
    query: { employee: 'DN001' }, session: { token: 'SECRET' },
  };

  const slow = telemetry.begin(sensitiveRequest);
  ns = 600_000_000n;
  slow.finish();
  const fast = telemetry.begin(sensitiveRequest);
  ns += 100_000_000n;
  fast.finish();

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    label: '[slow-request]',
    record: {
      at: '2026-08-22 07:00:01 GMT+7', method: 'GET',
      route: '/employee-cost', durationMs: 600,
    },
  });
  const serialized = JSON.stringify(lines);
  assert.doesNotMatch(serialized, /originalUrl|query|DN001|SECRET|customer/);
});

test('vượt trần mỗi phút thì gộp đúng một dòng đếm cho từng luồng', () => {
  let now = 0;
  const eventLines = [];
  const reporter = monitor.createAttributionReporter({
    detailLimitPerMinute: 2,
    nowMs: () => now,
    timestamp: () => '2026-08-22 07:00:01 GMT+7',
    activitySnapshot: () => ({ requestIds: [], backgroundTasks: [] }),
    warn: (label, record) => eventLines.push({ label, record }),
  });
  reporter.observe({ maxMs: 1200, p99Ms: 20, meanMs: 21 });
  reporter.observe({ maxMs: 1300, p99Ms: 20, meanMs: 21 });
  reporter.observe({ maxMs: 1400, p99Ms: 20, meanMs: 21 });
  now = 60_000;
  reporter.flush();
  assert.equal(eventLines.filter((x) => x.label === '[event-loop-attribution] NGHẼN').length, 2);
  assert.equal(eventLines.filter((x) => x.label === '[event-loop-attribution-suppressed]').length, 1);
  assert.equal(eventLines.at(-1).record.suppressedCount, 1);

  let ns = 0n;
  now = 0;
  const requestLines = [];
  const telemetry = createSlowRequestTelemetry({
    detailLimitPerMinute: 2,
    nowNs: () => ns,
    nowMs: () => now,
    timestamp: () => '2026-08-22 07:00:01 GMT+7',
    warn: (label, record) => requestLines.push({ label, record }),
    autoFlush: false,
  });
  for (let i = 0; i < 3; i += 1) {
    const request = telemetry.begin({ method: 'GET', route: { path: '/safe' } });
    ns += 600_000_000n;
    request.finish();
  }
  now = 60_000;
  telemetry.flush();
  assert.equal(requestLines.filter((x) => x.label === '[slow-request]').length, 2);
  assert.equal(requestLines.filter((x) => x.label === '[slow-request-suppressed]').length, 1);
  assert.equal(requestLines.at(-1).record.suppressedCount, 1);
});
