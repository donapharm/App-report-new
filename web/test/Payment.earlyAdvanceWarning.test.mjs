import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

const employeeCost = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const composer = employeeCost.slice(
  employeeCost.indexOf('function PaymentRequestComposer'),
  employeeCost.indexOf('export function PaymentSchedulePanel'),
);
const openPreviewStart = employeeCost.indexOf('const openEarlyComposer');
const openPreview = employeeCost.slice(
  openPreviewStart,
  employeeCost.indexOf('  return <div className="card">', openPreviewStart),
);

test('mở Xin nhận sớm gọi đúng một preview backend và không gửi amount từ frontend', () => {
  assert.equal((employeeCost.match(/api\.paymentEarlyPreview\(/g) || []).length, 1);
  assert.match(openPreview, /api\.paymentEarlyPreview\(\{ emp: empCode, period: schedule\.period, key: item\.key \}\)/);
  assert.match(openPreview, /previewInFlightRef\.current/);
  assert.match(api, /paymentEarlyPreview: \(\{ emp, period, key \} = \{\}\) => req\('POST', '\/employee-cost\/payment\/request-unlock-preview'/);
  const apiPreview = api.slice(api.indexOf('paymentEarlyPreview:'), api.indexOf('// Quy trình đề nghị nhận', api.indexOf('paymentEarlyPreview:')));
  assert.doesNotMatch(apiPreview, /amount/);
});

test('loading/A/B đều fail-closed: chưa có preview hoặc bị chặn thì không render lý do và không gửi', () => {
  assert.match(composer, /const earlyAllowed = mode !== 'early' \|\| earlyPreview\?\.allowed === true/);
  assert.match(composer, /previewLoading && <div[^>]+role="status"/);
  assert.match(composer, /!previewLoading && !!previewError/);
  assert.match(composer, /earlyAllowed && !!options\.length && <fieldset className="payment-reason-options">/);
  assert.match(composer, /!previewLoading && !previewError && !earlyAllowed/);
  assert.match(composer, /earlyPreview\?\.message/);
  assert.match(composer, /earlyPreview\?\.submitDisabled !== false/);
  assert.match(openPreview, /previewLoading: true/);
  assert.match(openPreview, /previewLoading: false/);
});

test('C · cảnh báo backend đứng trước danh sách lý do và nút gửi dùng nguyên nhãn backend', () => {
  const warningAt = composer.indexOf('className="payment-early-warning"');
  const reasonsAt = composer.indexOf('className="payment-reason-options"');
  assert.ok(warningAt > 0 && warningAt < reasonsAt, 'cảnh báo phải đứng trước radio lý do trong DOM');
  assert.match(composer, /earlyPreview\.warning\.title/);
  assert.match(composer, /earlyPreview\.warning\.lines/);
  assert.match(composer, /earlyPreview\?\.submitLabel/);
  assert.match(styles, /\.payment-early-warning/);
});

test('frontend early flow chỉ render: không tự trừ ngày, tính quý, đếm lượt hoặc format số tiền', () => {
  const earlyFlow = `${composer}\n${openPreview}`;
  for (const forbidden of [/new Date/, /Date\.UTC/, /daysBetween/, /quarterOf/, /86_400_000/, /86400000/, /used\.length/, /usedPeriod\.length/, /earliestDate\.split/, /amount\.toLocaleString/, /formatEmployeeCostCell\(earlyPreview/]) {
    assert.doesNotMatch(earlyFlow, forbidden);
  }
  assert.match(composer, /earlyPreview\.warning\.lines/);
  assert.match(employeeCost, /earlyQuota\?\.tableButtonLabel/);
});

test('view model allowlist earlyQuota nhưng không diễn giải lại trạng thái backend', () => {
  const model = employeeCostViewModel({
    earlyQuota: {
      allowed: false,
      code: 'EARLY_TOO_SOON',
      message: 'Sớm nhất là 31/08/2026',
      earliestDate: '2026-08-31',
      quarter: '2026-Q3',
      usedPeriod: '',
      tableButtonLabel: 'Xin nhận sớm · từ 31/08',
    },
  });
  assert.deepEqual(model.earlyQuota, {
    allowed: false,
    code: 'EARLY_TOO_SOON',
    message: 'Sớm nhất là 31/08/2026',
    earliestDate: '2026-08-31',
    quarter: '2026-Q3',
    usedPeriod: '',
    tableButtonLabel: 'Xin nhận sớm · từ 31/08',
  });
});
