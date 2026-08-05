import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNotificationPollingLoop,
  notificationFailureFromSettled,
  notificationPollFailure,
  NOTIFICATION_POLL_AUTH_MESSAGE,
  NOTIFICATION_POLL_FORBIDDEN_MESSAGE,
  NOTIFICATION_POLL_PERMANENT_MESSAGE,
} from '../src/notificationPolling.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function httpError(status, message = `HTTP ${status}`) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function fakeClock() {
  const queue = [];
  return {
    queue,
    setTimeoutFn(callback, delayMs) {
      const item = { callback, delayMs, cleared: false };
      queue.push(item);
      return item;
    },
    clearTimeoutFn(item) {
      if (item) item.cleared = true;
    },
    active() {
      return queue.filter((item) => !item.cleared);
    },
    async next() {
      let item;
      while ((item = queue.shift()) && item.cleared) { /* bỏ timer đã huỷ */ }
      assert.ok(item, 'phải có lần gọi đã lên lịch');
      await item.callback();
      return item;
    },
  };
}

test('401/403 dừng hẳn, không có lần gọi thứ hai và hiện câu tĩnh', async () => {
  for (const [status, expected] of [[401, NOTIFICATION_POLL_AUTH_MESSAGE], [403, NOTIFICATION_POLL_FORBIDDEN_MESSAGE]]) {
    const clock = fakeClock();
    let calls = 0;
    let permanent;
    const polling = createNotificationPollingLoop({
      refresh: async () => { calls += 1; throw httpError(status); },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      onPermanentError: (message, _error, meta) => { permanent = { message, meta }; },
    });
    await polling.start();
    assert.equal(calls, 1);
    assert.equal(polling.isStopped(), true);
    assert.equal(clock.active().length, 0);
    assert.equal(permanent.message, expected);
    assert.equal(permanent.meta.canRetry, false);
    await polling.runNow();
    assert.equal(calls, 1);
  }
});

test('5xx + 403 đồng thời: quét toàn bộ kết quả và 403 thắng để dừng', () => {
  const failure = notificationFailureFromSettled([
    { status: 'rejected', reason: httpError(503) },
    { status: 'rejected', reason: httpError(403) },
  ]);
  assert.equal(failure.status, 403);
  assert.equal(notificationPollFailure(failure).retry, false);
});

test("status = '403' dạng chuỗi vẫn dừng, không rơi vào retry", () => {
  const failure = notificationPollFailure(httpError('403'));
  assert.equal(failure.retry, false);
  assert.equal(failure.message, NOTIFICATION_POLL_FORBIDDEN_MESSAGE);
});

test('thành công hẹn đúng 60s', async () => {
  const clock = fakeClock();
  const polling = createNotificationPollingLoop({
    refresh: async () => {},
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  await polling.start();
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delayMs, 60_000);
  polling.stop();
});

test('lỗi tạm thời giãn 20s→40s→80s; thành công sau 80s quay về 60s', async () => {
  const clock = fakeClock();
  const outcomes = [httpError(503), httpError(502), httpError(500), null];
  const polling = createNotificationPollingLoop({
    refresh: async () => { const outcome = outcomes.shift(); if (outcome) throw outcome; },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  await polling.start();
  assert.equal(clock.active().at(-1).delayMs, 20_000);
  await clock.next();
  assert.equal(clock.active().at(-1).delayMs, 40_000);
  await clock.next();
  assert.equal(clock.active().at(-1).delayMs, 80_000);
  await clock.next();
  assert.equal(clock.active().at(-1).delayMs, 60_000);
  polling.stop();
});

test('backoff không vượt trần 5 phút', async () => {
  const clock = fakeClock();
  const polling = createNotificationPollingLoop({
    refresh: async () => { throw httpError(0); },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    maxConsecutiveFailures: 8,
  });
  const delays = [];
  await polling.start();
  for (let i = 0; i < 6; i += 1) {
    delays.push(clock.active().at(-1).delayMs);
    await clock.next();
  }
  assert.deepEqual(delays, [20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  polling.stop();
});

test('error không có status retry nhưng dừng đúng lần hỏng thứ 5 và cho thử lại tay', async () => {
  const clock = fakeClock();
  let calls = 0;
  let permanent;
  let recover = false;
  const polling = createNotificationPollingLoop({
    refresh: async () => { calls += 1; if (!recover) throw new Error('Hệ thống phản hồi quá lâu'); },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onPermanentError: (message, _error, meta) => { permanent = { message, meta }; },
  });
  await polling.start();
  for (let failure = 1; failure < 5; failure += 1) await clock.next();
  assert.equal(calls, 5);
  assert.equal(polling.isStopped(), true);
  assert.equal(clock.active().length, 0);
  assert.equal(permanent.message, NOTIFICATION_POLL_PERMANENT_MESSAGE);
  assert.equal(permanent.meta.canRetry, true);
  assert.equal(permanent.meta.consecutiveFailures, 5);
  recover = true;
  await polling.retryNow();
  assert.equal(calls, 6);
  assert.equal(polling.isStopped(), false);
  assert.equal(clock.active()[0].delayMs, 60_000);
  polling.stop();
});

test("status null/''/false và numeric/string 0 đều retry có trần, không bị coi là 403", () => {
  for (const status of [null, '', false, 0, '0']) {
    const failure = notificationPollFailure(httpError(status));
    assert.equal(failure.retry, true, `status ${String(status)} phải retry`);
    assert.notEqual(failure.message, NOTIFICATION_POLL_FORBIDDEN_MESSAGE);
  }
});

test('4xx khác dừng ngay và không cho manual retry', async () => {
  for (const status of [400, 404, 409, 429]) {
    const clock = fakeClock();
    let meta;
    const polling = createNotificationPollingLoop({
      refresh: async () => { throw httpError(status); },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      onPermanentError: (_message, _error, value) => { meta = value; },
    });
    await polling.start();
    assert.equal(polling.isStopped(), true);
    assert.equal(clock.active().length, 0);
    assert.equal(meta.canRetry, false);
  }
});

test('runNow/visibility đồng thời không tạo request/timer trùng hoặc unhandledRejection', async () => {
  const clock = fakeClock();
  let calls = 0;
  let release;
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    const pending = new Promise((resolve) => { release = resolve; });
    const polling = createNotificationPollingLoop({
      refresh: async () => { calls += 1; await pending; },
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });
    const first = polling.start();
    const concurrent = polling.runNow();
    assert.equal(calls, 1);
    release();
    await Promise.all([first, concurrent]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(clock.active().length, 1);
    assert.equal(clock.active()[0].delayMs, 60_000);
    assert.deepEqual(unhandled, []);
    polling.stop();
  } finally {
    process.off('unhandledRejection', listener);
  }
});

test('CeoNotificationBell nối allSettled qua classifier và có nút Thử lại tay', () => {
  const source = fs.readFileSync(path.join(HERE, '../src/CeoNotificationBell.jsx'), 'utf8');
  assert.match(source, /await Promise\.allSettled\(requests\)/);
  assert.match(source, /notificationFailureFromSettled\(results\)/);
  assert.match(source, /if \(!result\.ok\) throw result\.error/);
  assert.match(source, /pollingRef\.current\?\.retryNow\(\)/);
  assert.match(source, />Thử lại<\/button>/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});
