'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const reasons = require('../src/paymentRequestReasons');
const auth = require('../src/auth');
const router = require('../src/routes');

const EARLY = [
  'Cần trả chi phí cho đơn vị/khách đúng cam kết',
  'Việc gia đình đột xuất, cần tiền gấp',
  'Chứng từ kỳ này đã đủ, xin tất toán sớm',
  'Chi phí kỳ này lớn, cần xoay vòng',
  'Khác (ghi rõ)',
];
const REJECT = [
  'Chưa tới hạn — chờ đúng lịch',
  'Đã hết lượt ưu tiên của quý này',
  'Cần bổ sung chứng từ trước',
  'Khác (ghi rõ)',
];

test('config backend trả đúng danh sách CEO chốt và chỉ Khác yêu cầu tối thiểu 5 ký tự', () => {
  reasons.resetCache();
  const payload = reasons.readFromFile();
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(payload.early.map((row) => row.label), EARLY);
  assert.deepEqual(payload.reject.map((row) => row.label), REJECT);
  for (const group of ['early', 'reject']) {
    assert.equal(payload[group].filter((row) => row.requiresDetail).length, 1);
    assert.equal(payload[group].find((row) => row.requiresDetail).label, 'Khác (ghi rõ)');
    assert.equal(payload[group].find((row) => row.requiresDetail).minLength, 5);
  }
});

test('config sai schema hoặc không có đúng một lựa chọn Khác thì fail-closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-reasons-'));
  const file = path.join(dir, 'reasons.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, early: [], reject: [] }));
  assert.throws(() => reasons.readFromFile(file), (error) => error.status === 503 && error.code === 'PAYMENT_REQUEST_REASONS_UNAVAILABLE');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    early: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    reject: [{ id: 'a', label: 'A' }, { id: 'other', label: 'Khác', requiresDetail: true, minLength: 5 }],
  }));
  assert.throws(() => reasons.readFromFile(file), (error) => error.reason === 'early_custom_invalid');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    early: [
      { id: 'regular', label: 'Lý do thường', requiresDetail: true, minLength: 5 },
      { id: 'other', label: 'Khác' },
    ],
    reject: [{ id: 'a', label: 'A' }, { id: 'other', label: 'Khác', requiresDetail: true, minLength: 5 }],
  }));
  assert.throws(() => reasons.readFromFile(file), (error) => error.reason === 'early_custom_invalid',
    'phải khóa chính id=other là lựa chọn duy nhất cần ghi rõ');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('route backend trả danh sách chỉ cho phiên đã đăng nhập và luôn no-store', () => {
  const layer = router.stack.find((item) => item.route?.path === '/employee-cost/payment/request-reasons' && item.route.methods.get);
  assert.ok(layer, 'thiếu route request-reasons');
  assert.ok(layer.route.stack.map((item) => item.handle).includes(auth.requireAuth), 'route phải requireAuth');
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const start = source.indexOf("router.get('/employee-cost/payment/request-reasons'");
  assert.match(source.slice(start, start + 500), /private, no-store/);
  assert.match(source.slice(start, start + 500), /paymentRequestReasons\.readFromFile\(\)/);
});
