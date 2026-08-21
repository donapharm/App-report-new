'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const monitor = require('../src/eventLoopMonitor');

test('ngưỡng GC quan sát là 200ms', () => {
  assert.equal(monitor.GC_WARN_MS, 200);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('đồng hồ đo phải BẮT ĐƯỢC một cú chặn vòng lặp sự kiện', async () => {
  // Sự cố 19/08/2026: /api/health chỉ trả một object hằng, không đọc kho, không tính gì —
  // vậy mà không trả lời được nên watchdog bắn app 11 lần. Một endpoint rẻ như thế mà im
  // thì chỉ có thể là vòng lặp sự kiện bị chặn. Đây là thước đo để chứng minh điều đó, và
  // cũng là thước đo nghiệm thu bản vá sau này. Đo được thì mới nói được.
  monitor.start();
  try {
    await sleep(150); // để histogram có nền sạch trước khi chặn
    const startedAt = Date.now();
    while (Date.now() - startedAt < 400) { /* chặn CÓ CHỦ ĐÍCH 400ms */ }
    await sleep(120);
    const reading = monitor.read();
    assert.ok(reading.maxMs > 300,
      `phải thấy độ trễ > 300ms sau cú chặn 400ms, đọc được ${reading.maxMs}ms`);
  } finally {
    monitor.stop();
  }
});

test('lúc khoẻ thì đồng hồ phải IM — không bơm rác vào log', async () => {
  // Log rác đã góp phần làm đầy đĩa sáng 19/08 rồi làm app gục. Chỉ nói khi có chuyện.
  const source = fs.readFileSync(require.resolve('../src/eventLoopMonitor'), 'utf8');
  assert.match(source, /if \(current\.maxMs >= WARN_LAG_MS\)/,
    'chỉ được log khi vượt ngưỡng, không log mỗi chu kỳ');
  assert.doesNotMatch(source, /writeFileSync|appendFileSync/,
    'đồng hồ đo TUYỆT ĐỐI không được ghi file — nó chỉ đo');

  monitor.start();
  try {
    await sleep(120);
    const reading = monitor.read();
    assert.ok(reading.maxMs != null && reading.maxMs < 300,
      'máy rảnh thì độ trễ phải nhỏ');
  } finally {
    monitor.stop();
  }
});

test('đồng hồ đo phải được bật lúc khởi động, TRƯỚC vòng warm', () => {
  // Cú chặn nguy hiểm nhất nằm ngay sau restart — đúng lúc cache lạnh và warm đang chạy.
  // Bật sau vòng warm là bỏ lỡ đúng khoảnh khắc cần đo.
  const source = fs.readFileSync(require.resolve('../src/index'), 'utf8');
  const at = source.indexOf('eventLoopMonitor.start()');
  const warmAt = source.indexOf('startEmployeeCostAllWarmLoop()');
  assert.ok(at > 0, 'index.js phải bật đồng hồ đo');
  assert.ok(warmAt > 0 && at < warmAt, 'phải bật TRƯỚC vòng warm');
});

test('dừng được và bật lại được, không rò timer', () => {
  const first = monitor.start();
  const again = monitor.start();
  assert.equal(again, first, 'gọi hai lần không được tạo hai đồng hồ');
  monitor.stop();
  const third = monitor.start();
  assert.ok(third, 'dừng rồi bật lại vẫn phải chạy');
  monitor.stop();
});
