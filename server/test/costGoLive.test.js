'use strict';
/**
 * MỐC GO-LIVE 01/07/2026 — CEO xác nhận 10/08/2026:
 *   *"T06.2026 chưa lên app nhé, nó chỉ chuyển dữ liệu từ Lumos qua thôi.
 *     Dữ liệu bắt đầu có Go-live từ 01/07/2026."*
 *
 * Trước mốc đó KHÔNG có bảng % chi phí và sẽ không bao giờ có. App phải trả lời
 * NGAY, không ra mạng, và nói đúng "chưa lên app" chứ không phải "nguồn hỏng".
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const employeeCost = require('../src/employeeCost');

// fetchImpl này mà bị gọi là hỏng: nghĩa là app vẫn ra mạng hỏi kỳ không tồn tại.
function forbiddenFetch() {
  throw new Error('KHÔNG được gọi mạng cho kỳ trước go-live');
}

test('kỳ trước go-live: trả lời NGAY, tuyệt đối không chạm mạng', async () => {
  const result = await employeeCost.fetchEmployeeCost('DN006', {
    from: '2026-06', to: '2026-06', fetchImpl: forbiddenFetch,
  });
  assert.equal(result.outcome, 'before_go_live');
  assert.equal(result.attempts, 0, 'không được thử lần nào');
  assert.match(result.payload.note, /chưa lên App Report/);
  assert.match(result.payload.note, /không phải lỗi nguồn/);
  assert.equal(result.payload.ratePolicy.state, 'before_go_live');
  assert.equal(result.payload.ratePolicy.goLiveMonth, '2026-07');
});

test('before_go_live là DÙNG ĐƯỢC — không bôi đỏ NV, không hạ bộ nhớ đệm xuống 2 phút', () => {
  assert.equal(employeeCost.isUsableOutcome('before_go_live'), true);
  // Đối chứng: lỗi nguồn thật thì vẫn phải bị coi là hỏng.
  assert.equal(employeeCost.isUsableOutcome('upstream_unavailable'), false);
  assert.equal(employeeCost.isUsableOutcome('not_configured'), false);
  assert.equal(employeeCost.isUsableOutcome('invalid_period_payload'), false);
});

test('mốc so sánh đúng biên: 06/2026 trước, 07/2026 KHÔNG trước', () => {
  assert.equal(employeeCost.isBeforeCostGoLive('2026-06'), true);
  assert.equal(employeeCost.isBeforeCostGoLive('2026-05'), true);
  assert.equal(employeeCost.isBeforeCostGoLive('2025-12'), true);
  assert.equal(employeeCost.isBeforeCostGoLive('2026-07'), false, 'chính tháng go-live thì có dữ liệu');
  assert.equal(employeeCost.isBeforeCostGoLive('2026-08'), false);
  assert.equal(employeeCost.isBeforeCostGoLive(''), false, 'tháng rác thì không kết luận gì');
});

test('khoảng VẮT QUA mốc thì KHÔNG chặn — phần từ 07 trở đi vẫn phải đi lấy', async () => {
  let called = false;
  const result = await employeeCost.fetchEmployeeCost('DN006', {
    from: '2026-06',
    to: '2026-07',
    fetchImpl: () => { called = true; throw new Error('stop'); },
  });
  assert.notEqual(result.outcome, 'before_go_live', '06→07 không được coi là trọn trước go-live');
  assert.equal(called || result.outcome === 'not_configured', true, 'phải đi tiếp đường bình thường');
});

test('đổi được mốc bằng biến môi trường, rác thì quay về mặc định', () => {
  const old = process.env.APP_REPORT_COST_GO_LIVE_MONTH;
  try {
    process.env.APP_REPORT_COST_GO_LIVE_MONTH = '2026-09';
    assert.equal(employeeCost.costGoLiveMonth(), '2026-09');
    assert.equal(employeeCost.isBeforeCostGoLive('2026-08'), true, 'nạp bổ sung thì mốc dời được');

    process.env.APP_REPORT_COST_GO_LIVE_MONTH = 'tháng bảy';
    assert.equal(employeeCost.costGoLiveMonth(), employeeCost.DEFAULT_COST_GO_LIVE_MONTH);
  } finally {
    if (old === undefined) delete process.env.APP_REPORT_COST_GO_LIVE_MONTH;
    else process.env.APP_REPORT_COST_GO_LIVE_MONTH = old;
  }
});
