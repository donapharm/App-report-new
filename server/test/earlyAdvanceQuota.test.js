'use strict';
/**
 * QUYỀN ƯU TIÊN ỨNG SỚM LẦN 2 — CEO chốt 04/08/2026 22:45.
 * 1 lượt/quý · không sớm hơn 30 ngày sau khi hết tháng bán hàng (= 15 ngày trước hạn).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/earlyAdvancePolicy');
const quota = require('../src/earlyAdvanceQuota');
const { buildPaymentSchedule } = require('../src/paymentSchedule');

const memStore = () => ({ data: {}, load(n, d) { return this.data[n] ?? d; }, save(n, v) { this.data[n] = v; } });

test('‼ CEO đính chính: kỳ T08.2026 phải là 01/10, không phải 30/09', () => {
  assert.equal(policy.periodEndDate('2026-08'), '2026-08-31');
  assert.equal(policy.earliestRequestDate('2026-08'), '2026-10-01', 'phải QUA ĐỦ 30 ngày ⇒ ngày thứ 31');
  assert.equal(policy.quarterOf('2026-08'), '2026-Q3');
});

test('mốc sớm nhất luôn cách hạn Lần 2 đúng 14 ngày, mọi tháng kể cả tháng 2', () => {
  for (const period of ['2026-07', '2026-08', '2026-09', '2026-12', '2027-02']) {
    const due = buildPaymentSchedule({
      period, totalAfterPenalty: 100_000_000, firstAdvanceAmount: 1_000_000,
    }).installments[1].dueDate;
    const gap = Math.round((new Date(due) - new Date(policy.earliestRequestDate(period))) / 86_400_000);
    assert.equal(gap, 14, `kỳ ${period}: lệch ${gap} ngày`);
    // Và phải đúng bằng ngày cuối tháng + 31.
    assert.equal(
      Math.round((new Date(policy.earliestRequestDate(period)) - new Date(policy.periodEndDate(period))) / 86_400_000),
      31, `kỳ ${period}: không phải ngày thứ 31`,
    );
  }
});

test('‼ chưa tới ngày sớm nhất thì CHẶN và nói rõ còn mấy ngày', () => {
  const result = policy.checkEarlyRequest({ period: '2026-08', today: '2026-09-15', used: [] });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'EARLY_TOO_SOON');
  assert.match(result.message, /Sớm nhất là 01\/10\/2026 \(còn 16 ngày\)/);
  assert.match(result.message, /qua đủ 30 ngày kể từ khi hết tháng bán hàng/);
});

test('đúng ngày sớm nhất trở đi thì được', () => {
  // ‼ Ngày 30/09 là CHƯA đủ — mới tròn 30 ngày, phải QUA nó.
  assert.equal(policy.checkEarlyRequest({ period: '2026-08', today: '2026-09-30', used: [] }).allowed, false);
  for (const today of ['2026-10-01', '2026-10-05']) {
    assert.equal(policy.checkEarlyRequest({ period: '2026-08', today, used: [] }).allowed, true, today);
  }
});

test('‼ hết lượt trong quý ⇒ CHẶN, kèm tên kỳ đã dùng', () => {
  const result = policy.checkEarlyRequest({ period: '2026-09', today: '2026-11-01', used: [{ period: '2026-08' }] });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'EARLY_QUOTA_USED');
  assert.equal(result.usedPeriod, '2026-08');
  assert.match(result.message, /hết lượt dùng quyền ưu tiên/);
  assert.match(result.message, /đã dùng cho kỳ 08\/2026/);
});

test('‼ lượt tính theo QUÝ CỦA KỲ BÁN HÀNG, không theo ngày bấm nút', () => {
  // Nếu tính theo ngày bấm thì NV bấm muộn vài ngày là nhảy quý và được thêm lượt.
  assert.equal(policy.quarterOf('2026-08'), '2026-Q3');
  assert.equal(policy.quarterOf('2026-09'), '2026-Q3');
  assert.equal(policy.quarterOf('2026-10'), '2026-Q4');
  // Dùng lượt cho T09 (Q3) rồi, bấm vào tháng 12 xin cho T09 vẫn CHẶN.
  const late = policy.checkEarlyRequest({ period: '2026-09', today: '2026-12-20', used: [{ period: '2026-07' }] });
  assert.equal(late.allowed, false, 'T07 và T09 cùng Q3 ⇒ đã hết lượt');
});

test('sang quý mới thì có lượt mới', () => {
  assert.equal(policy.checkEarlyRequest({ period: '2026-10', today: '2026-12-01', used: [{ period: '2026-08' }] }).allowed, true);
});

/* ── Kho lượt ───────────────────────────────────────────────────────────────── */

test('‼ tiêu lượt rồi thì quý đó hết, quý sau vẫn còn', () => {
  const store = memStore();
  assert.ok(quota.consume('DN001', '2026-08', { actor: 'CEO', store }));
  assert.equal(quota.check('DN001', '2026-09', '2026-11-01', { store }).allowed, false);
  assert.equal(quota.check('DN001', '2026-10', '2026-12-01', { store }).allowed, true);
  // NV khác không bị ảnh hưởng.
  assert.equal(quota.check('DN002', '2026-09', '2026-11-01', { store }).allowed, true);
});

test('‼ tiêu hai lần cùng quý thì lần sau KHÔNG tiêu chồng', () => {
  const store = memStore();
  assert.ok(quota.consume('DN001', '2026-08', { actor: 'CEO', store }));
  assert.equal(quota.consume('DN001', '2026-09', { actor: 'CEO', store }), null, 'cùng Q3 ⇒ không ghi thêm');
  assert.equal(quota.usedBy('DN001', { store }).length, 1);
});

test('lượt có ghi ai duyệt và lúc nào', () => {
  const store = memStore();
  const record = quota.consume('DN001', '2026-08', { actor: 'ceo', now: () => '2026-09-30T10:00:00Z', store });
  assert.equal(record.by, 'CEO');
  assert.equal(record.quarter, '2026-Q3');
  assert.equal(record.at, '2026-09-30T10:00:00Z');
});

/* ── Nối vào route ─────────────────────────────────────────────────────────── */

test('‼ backend phải CHẶN THẲNG, không chỉ ẩn nút trên màn', () => {
  const source = require('fs').readFileSync(require.resolve('../src/routes'), 'utf8');
  const at = source.indexOf("/employee-cost/payment/request-unlock'");
  const block = source.slice(at, at + 900);
  assert.match(block, /earlyAdvanceQuota\.check\(empCode, period, employeeCost\.vnToday\(\)\)/);
  assert.match(block, /return res\.status\(422\)/, 'hết lượt phải trả lỗi nghiệp vụ, không im lặng cho qua');
});

test('‼ lượt TIÊU lúc CEO mở khoá, KHÔNG tiêu lúc NV bấm xin', () => {
  const source = require('fs').readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(source, /if \(action === 'grantUnlock'\) earlyAdvanceQuota\.consume\(empCode, period, \{ actor \}\)/);
  // Chỗ NV bấm xin chỉ được KIỂM, không được TIÊU.
  const at = source.indexOf("/employee-cost/payment/request-unlock'");
  assert.doesNotMatch(source.slice(at, at + 900), /earlyAdvanceQuota\.consume/,
    'tiêu lúc xin thì CEO từ chối là NV mất trắng lượt cả quý');
});
