'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const policy = require('../src/earlyAdvancePolicy');
const preview = require('../src/earlyAdvancePreview');

const installment = (overrides = {}) => ({
  index: 2,
  key: 'second',
  label: 'Lần 2 · Ứng',
  amount: 67_012_345,
  ...overrides,
});

test('A · EARLY_TOO_SOON: T07 tại 05/08 không hiện lý do, tắt gửi và đeo mốc 31/08', () => {
  const quota = policy.checkEarlyRequest({ period: '2026-07', today: '2026-08-05', used: [] });
  const result = preview.buildEarlyAdvancePreview({ period: '2026-07', key: 'second', installment: { key: 'second' }, quota });
  assert.equal(quota.code, 'EARLY_TOO_SOON');
  assert.equal(result.allowed, false);
  assert.equal(result.showReasons, false);
  assert.equal(result.submitDisabled, true);
  assert.equal(result.warning, null);
  assert.equal(result.earliestDate, '2026-08-31');
  assert.equal(result.tableButtonLabel, 'Xin nhận sớm · từ 31/08');
  assert.match(result.message, /31\/08\/2026 \(còn 26 ngày\)/);
});

test('B · EARLY_QUOTA_USED: không hiện lý do và giữ nguyên tên kỳ đã dùng từ policy', () => {
  const quota = policy.checkEarlyRequest({ period: '2026-09', today: '2026-11-01', used: [{ period: '2026-07' }] });
  const result = preview.buildEarlyAdvancePreview({ period: '2026-09', key: 'second', installment: { key: 'second' }, quota });
  assert.equal(result.code, 'EARLY_QUOTA_USED');
  assert.equal(result.allowed, false);
  assert.equal(result.showReasons, false);
  assert.equal(result.submitDisabled, true);
  assert.equal(result.usedPeriod, '2026-07');
  assert.equal(result.tableButtonLabel, 'Xin nhận sớm · đã hết lượt');
  assert.match(result.message, /đã dùng cho kỳ 07\/2026/);
});

test('C · OK: cảnh báo backend có đúng tiền, quý kỳ bán hàng và cam kết từ chối không mất lượt', () => {
  const quota = policy.checkEarlyRequest({ period: '2026-07', today: '2026-08-31', used: [] });
  const result = preview.buildEarlyAdvancePreview({ period: '2026-07', key: 'second', installment: installment(), quota });
  assert.equal(result.allowed, true);
  assert.equal(result.showReasons, true);
  assert.equal(result.submitDisabled, false);
  assert.equal(result.amount, 67_012_345);
  assert.equal(result.amountLabel, '67.012.345đ');
  assert.equal(result.quarter, '2026-Q3');
  assert.equal(result.warning.title, 'Dùng lượt ưu tiên của quý 2026-Q3 — mỗi quý chỉ có 1 lượt.');
  assert.match(result.warning.lines[0], /Lần 2 là 67\.012\.345đ/);
  assert.match(result.warning.lines[1], /để dành cho kỳ có số tiền lớn hơn/);
  assert.match(result.warning.lines[2], /Sếp từ chối thì KHÔNG mất lượt/);
  assert.equal(result.submitLabel, 'Dùng lượt ưu tiên · gửi xin nhận sớm');
});

test('OK nhưng backend thiếu số tiền thì fail closed, không mở lý do', () => {
  const quota = policy.checkEarlyRequest({ period: '2026-07', today: '2026-08-31', used: [] });
  const result = preview.buildEarlyAdvancePreview({ period: '2026-07', key: 'second', installment: installment({ amount: null }), quota });
  assert.equal(result.code, 'EARLY_PREVIEW_AMOUNT_UNAVAILABLE');
  assert.equal(result.allowed, false);
  assert.equal(result.showReasons, false);
  assert.equal(result.submitDisabled, true);
  assert.match(result.message, /đã dừng/);
});

test('mốc đối chiếu giữ nguyên policy: T07 31/08 · T08 01/10 · T09 31/10', () => {
  assert.equal(policy.earliestRequestDate('2026-07'), '2026-08-31');
  assert.equal(policy.earliestRequestDate('2026-08'), '2026-10-01');
  assert.equal(policy.earliestRequestDate('2026-09'), '2026-10-31');
});

test('route preview là read-only/self-scope; route gửi thật vẫn chặn policy bằng 422', () => {
  const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const previewAt = source.indexOf("router.post('/employee-cost/payment/request-unlock-preview'");
  const requestAt = source.indexOf("router.post('/employee-cost/payment/request-unlock'", previewAt + 1);
  const previewBlock = source.slice(previewAt, requestAt);
  assert.ok(previewAt > 0);
  assert.match(previewBlock, /selfPaymentTarget\(req\)/);
  assert.match(previewBlock, /earlyAdvanceQuota\.check\(empCode, period, employeeCost\.vnToday\(\)\)/);
  assert.match(previewBlock, /suppressAudit: true/);
  assert.match(previewBlock, /buildEarlyAdvancePreview/);
  assert.doesNotMatch(previewBlock, /earlyAdvanceQuota\.consume|requestUnlock\(/);

  const requestBlock = source.slice(requestAt, requestAt + 1200);
  assert.match(requestBlock, /earlyAdvanceQuota\.check\(empCode, period, employeeCost\.vnToday\(\)\)/);
  assert.match(requestBlock, /return res\.status\(422\)/);
  assert.match(requestBlock, /code: quota\.code/);
});
