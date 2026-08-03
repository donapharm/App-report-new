'use strict';
// ‼ CEO chốt 03/08/2026: tỷ lệ % là CHÍNH SÁCH ĐỨNG YÊN, tự động có hiệu lực sang
// mọi tháng sau cho tới khi CEO đổi bên DataHub. Tháng mới mở mà mất sạch số là LỖI.
const test = require('node:test');
const assert = require('node:assert/strict');
const employeeCost = require('../src/employeeCost.js');

const COLUMNS = [{ key: 'c36', pos: 36, label: 'CP ctv/khác (%)' }];
const ROWS = [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc A', c25: 'Viên', c36: 8 }];

function rangePayload(months, rowsByPeriod) {
  return {
    empCode: 'DN001', from: months[0], to: months.at(-1),
    periods: months.map((period) => ({
      empCode: 'DN001', period,
      columns: rowsByPeriod[period] ? COLUMNS : [],
      rows: rowsByPeriod[period] || [],
    })),
  };
}

test('tháng lịch trước lùi đúng, kể cả bắc qua năm', () => {
  assert.equal(employeeCost.previousMonth('2026-08'), '2026-07');
  assert.equal(employeeCost.previousMonth('2026-01'), '2025-12');
  assert.equal(employeeCost.previousMonth('bậy'), '');
});

test('tháng mới chưa có bảng % thì dùng bảng công bố gần nhất và ghi rõ nguồn', async () => {
  const asked = [];
  const fetchOne = async (emp, options) => {
    asked.push(options.from);
    return { payload: rangePayload([options.from], options.from === '2026-07' ? { '2026-07': ROWS } : {}) };
  };
  const payload = await employeeCost.applyEffectiveRates(
    rangePayload(['2026-08'], {}), 'DN001', {}, fetchOne,
  );
  assert.deepEqual(asked, ['2026-07']);
  assert.deepEqual(payload.periods[0].rows, ROWS);
  assert.equal(payload.periods[0].period, '2026-08', 'doanh thu vẫn thuộc tháng đang xem');
  assert.equal(payload.periods[0].rateEffectiveFrom, '2026-07', 'phải ghi nhãn nguồn tỷ lệ');
  assert.equal(payload.rateEffectiveFrom, '2026-07');
});

test('lùi tối đa 3 tháng rồi dừng, không dò vô hạn', async () => {
  const asked = [];
  const fetchOne = async (emp, options) => {
    asked.push(options.from);
    return { payload: rangePayload([options.from], {}) };
  };
  const payload = await employeeCost.applyEffectiveRates(rangePayload(['2026-08'], {}), 'DN001', {}, fetchOne);
  assert.deepEqual(asked, ['2026-07', '2026-06', '2026-05']);
  assert.equal(asked.length, employeeCost.RATE_EFFECTIVE_LOOKBACK_MONTHS);
  assert.equal(payload.periods[0].rows.length, 0, 'không có bảng nào thì vẫn rỗng, KHÔNG bịa');
  assert.equal(payload.periods[0].rateEffectiveFrom, undefined);
});

test('tháng đã có bảng riêng thì KHÔNG gọi thêm và KHÔNG gắn nhãn', async () => {
  let calls = 0;
  const fetchOne = async () => { calls += 1; return { payload: rangePayload(['2026-06'], {}) }; };
  const payload = await employeeCost.applyEffectiveRates(
    rangePayload(['2026-07'], { '2026-07': ROWS }), 'DN001', {}, fetchOne,
  );
  assert.equal(calls, 0, 'tháng đủ dữ liệu thì tuyệt đối không đụng tới');
  assert.equal(payload.periods[0].rateEffectiveFrom, undefined);
  assert.deepEqual(payload.periods[0].rows, ROWS);
});

test('mỗi tháng nguồn chỉ gọi một lần dù nhiều kỳ cùng thiếu', async () => {
  const asked = [];
  const fetchOne = async (emp, options) => {
    asked.push(options.from);
    return { payload: rangePayload([options.from], options.from === '2026-06' ? { '2026-06': ROWS } : {}) };
  };
  const payload = await employeeCost.applyEffectiveRates(
    rangePayload(['2026-07', '2026-08'], {}), 'DN001', {}, fetchOne,
  );
  assert.deepEqual(asked, ['2026-06', '2026-07']);
  assert.deepEqual(payload.periods.map((period) => period.rateEffectiveFrom), ['2026-06', '2026-06']);
});
