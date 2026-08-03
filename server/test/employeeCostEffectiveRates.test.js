'use strict';
// CEO chốt 03/08/2026: tỷ lệ % là chính sách có hiệu lực liên tục. Bản công bố
// gần nhất chỉ được kế thừa sang tháng sau, không hồi tố và không đoán provenance.
const test = require('node:test');
const assert = require('node:assert/strict');
const employeeCost = require('../src/employeeCost.js');

const COLUMNS = [{ key: 'c36', pos: 36, label: 'CP ctv/khác (%)' }];
const ROWS = [{ c5: 'QL1', c7: 'U1', c16: 'Thuốc A', c25: 'Viên', c36: 8 }];

function rangePayload(months, rowsByPeriod = {}) {
  return {
    empCode: 'DN001', from: months[0], to: months.at(-1),
    periods: months.map((period) => ({
      empCode: 'DN001', period,
      columns: rowsByPeriod[period] ? COLUMNS : [],
      rows: rowsByPeriod[period] || [],
    })),
  };
}

function latestResult({ period = '2026-07', rows = ROWS, outcome = 'ok', sourceRange } = {}) {
  return {
    outcome,
    attempts: 1,
    sourceRange: sourceRange === undefined ? { from: period, to: period } : sourceRange,
    payload: { empCode: 'DN001', columns: COLUMNS, rows },
  };
}

test('provenance kỳ chỉ nhận from/to hợp lệ và không đảo chiều', () => {
  assert.deepEqual(employeeCost.sourcePeriodRangeOf({ from: '2026-07', to: '07.2026' }), { from: '2026-07', to: '2026-07' });
  assert.equal(employeeCost.sourcePeriodRangeOf({ from: '2026-08', to: '2026-07' }), null);
  assert.equal(employeeCost.sourcePeriodRangeOf({ from: 'bậy', to: '2026-07' }), null);
  assert.equal(employeeCost.sourcePeriodRangeOf({}), null);
});

test('T08 dùng policy mới nhất T07, giữ kỳ doanh thu và ghi provenance', async () => {
  let calls = 0;
  const payload = await employeeCost.applyEffectiveRates(
    rangePayload(['2026-08']), 'DN001', { from: '2026-08', to: '2026-08' },
    async (emp, options) => {
      calls += 1;
      assert.equal(emp, 'DN001');
      assert.equal(options.from, undefined, 'lookup policy mới nhất không truyền range');
      assert.equal(options.to, undefined, 'lookup policy mới nhất không truyền range');
      return latestResult();
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(payload.periods[0].rows, ROWS);
  assert.equal(payload.periods[0].period, '2026-08', 'doanh thu vẫn thuộc đúng tháng đang xem');
  assert.equal(payload.periods[0].rateEffectiveFrom, '2026-07');
  assert.equal(payload.rateEffectiveFrom, '2026-07');
  assert.deepEqual(payload.ratePolicy, {
    state: 'available', lookupOutcome: 'ok', effectiveFrom: '2026-07', appliedPeriods: 1, unresolvedPeriods: 0,
  });
});

test('policy tiếp tục hiệu lực vô thời hạn tới khi có bản mới, chỉ một lookup', async () => {
  let calls = 0;
  const payload = await employeeCost.applyEffectiveRates(
    rangePayload(['2026-11']), 'DN001', {}, async () => { calls += 1; return latestResult({ period: '2026-07' }); },
  );
  assert.equal(calls, 1);
  assert.equal(payload.periods[0].rateEffectiveFrom, '2026-07');
  assert.deepEqual(payload.periods[0].rows, ROWS);
});

test('cấm hồi tố: policy T07 không được áp cho T06', async () => {
  const payload = await employeeCost.applyEffectiveRates(
    rangePayload(['2026-06']), 'DN001', {}, async () => latestResult({ period: '2026-07' }),
  );
  assert.equal(payload.periods[0].rows.length, 0);
  assert.equal(payload.periods[0].rateEffectiveFrom, undefined);
  assert.deepEqual(payload.ratePolicy, {
    state: 'not_applicable', lookupOutcome: 'ok', effectiveFrom: '2026-07', appliedPeriods: 0, unresolvedPeriods: 1,
  });
});

test('kỳ đã có bảng riêng thì không gọi policy mới nhất và không thay bytes', async () => {
  let calls = 0;
  const payload = rangePayload(['2026-07'], { '2026-07': ROWS });
  const before = JSON.stringify(payload);
  const result = await employeeCost.applyEffectiveRates(payload, 'DN001', {}, async () => { calls += 1; return latestResult(); });
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(result), before);
});

test('range nhiều tháng chỉ lấp tháng sau; tháng trước ngày hiệu lực vẫn fail closed', async () => {
  const payload = await employeeCost.applyEffectiveRates(
    rangePayload(['2026-06', '2026-07', '2026-08'], { '2026-07': ROWS }),
    'DN001', {}, async () => latestResult({ period: '2026-07' }),
  );
  assert.deepEqual(payload.periods.map((item) => item.rows.length), [0, 1, 1]);
  assert.deepEqual(payload.periods.map((item) => item.rateEffectiveFrom || ''), ['', '', '2026-07']);
  assert.equal(payload.ratePolicy.state, 'partial');
  assert.equal(payload.ratePolicy.unresolvedPeriods, 1);
});

test('nguồn latest lỗi/rỗng/mơ hồ đều giữ rỗng và nêu đúng trạng thái', async () => {
  for (const [expected, result] of [
    ['unavailable', latestResult({ outcome: 'upstream_unavailable' })],
    ['missing', latestResult({ rows: [] })],
    ['ambiguous', latestResult({ sourceRange: { from: '2026-06', to: '2026-07' } })],
  ]) {
    const payload = await employeeCost.applyEffectiveRates(rangePayload(['2026-08']), 'DN001', {}, async () => result);
    assert.equal(payload.periods[0].rows.length, 0);
    assert.equal(payload.ratePolicy.state, expected);
  }
});

// Kiểm ĐƯỜNG MẠNG THUẦN: provenance sai thì xoá sạch, không đoán. Từ 04/08 hàm
// này là `fetchRawEmployeeCost` — `fetchEmployeeCost` đã bọc thêm kế thừa tỷ lệ.
test('range có tỷ lệ nhưng provenance thiếu/sai kỳ bị xóa và fail-closed', async () => {
  for (const raw of [
    { empCode: 'DN001', columns: COLUMNS, rows: ROWS },
    { empCode: 'DN001', from: '2026-07', to: '2026-07', columns: COLUMNS, rows: ROWS },
    { empCode: 'DN001', from: '2026-08', to: '2026-07', columns: COLUMNS, rows: ROWS },
  ]) {
    const result = await employeeCost.fetchRawEmployeeCost('DN001', {
      from: '2026-08', to: '2026-08', baseUrl: 'http://hub.test', assignmentKey: 'assignment-key-1234',
      employeeCostKeys: 'DN001=employee-cost-key-1234', backoffMs: [],
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => raw }),
    });
    assert.equal(result.outcome, 'invalid_period_payload');
    assert.equal(result.payload.periods[0].rows.length, 0);
  }
});

test('T08 gắn nhầm rows T07 không được coi exact; chỉ dùng lại qua latest có provenance', async () => {
  const urls = [];
  const wrongExactRows = [{ ...ROWS[0], c36: 99 }];
  const payload = await employeeCost.getForSession({
    session: { emp_code: 'CEO', role: 'admin' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN001',
  }, {
    from: '2026-08', to: '2026-08', baseUrl: 'http://hub.test', assignmentKey: 'assignment-key-1234',
    employeeCostKeys: 'DN001=employee-cost-key-1234', auditImpl: () => {},
    fetchImpl: async (url) => {
      urls.push(String(url));
      const ranged = String(url).includes('from=2026-08');
      return { ok: true, status: 200, json: async () => ranged
        ? { empCode: 'DN001', from: '2026-07', to: '2026-07', columns: COLUMNS, rows: wrongExactRows }
        : { empCode: 'DN001', from: '2026-07', to: '2026-07', columns: COLUMNS, rows: ROWS } };
    },
  });
  assert.equal(urls.length, 2);
  assert.deepEqual(payload.periods[0].rows, ROWS, 'discard wrong-range rows before latest lookup');
  assert.equal(payload.periods[0].rateEffectiveFrom, '2026-07');
  assert.equal(payload.ratePolicy.state, 'available');
  assert.equal(payload.sourceOutcome, 'ok');
});

test('getForSession T08 gọi range trước rồi latest no-range, audit đủ kỳ/provenance', async () => {
  const urls = [];
  const audits = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const ranged = String(url).includes('from=2026-08');
    return {
      ok: true, status: 200,
      json: async () => ranged
        ? { empCode: 'DN001', from: '2026-08', to: '2026-08', columns: COLUMNS, rows: [] }
        : { empCode: 'DN001', from: '2026-07', to: '2026-07', columns: COLUMNS, rows: ROWS },
    };
  };
  const payload = await employeeCost.getForSession({
    session: { emp_code: 'CEO', role: 'admin' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN001',
  }, {
    from: '2026-08', to: '2026-08', baseUrl: 'http://hub.test', assignmentKey: 'assignment-key-1234',
    employeeCostKeys: 'DN001=employee-cost-key-1234', fetchImpl, auditImpl: (entry) => audits.push(entry),
  });
  assert.equal(urls.length, 2);
  assert.match(urls[0], /from=2026-08&to=2026-08/);
  assert.equal(urls[1], 'http://hub.test/api/integrations/app-report/employee-cost?emp=DN001');
  assert.deepEqual(payload.periods[0].rows, ROWS);
  assert.equal(payload.periods[0].rateEffectiveFrom, '2026-07');
  assert.equal(payload.sourceOutcome, 'ok');
  assert.deepEqual(audits[0].range, { from: '2026-08', to: '2026-08', months: ['2026-08'] });
  assert.equal(audits[0].ratePolicy.effectiveFrom, '2026-07');
});

// ‼ 04/08/2026 — BẤT BIẾN: ô KPI và tab "Mặt hàng thiếu %" phải thấy ĐÚNG một
// bảng tỷ lệ. Trước đây KPI đi qua `getForSession` (có kế thừa T07 → khớp 20/20)
// còn `employeeCostGaps.js` gọi thẳng hàm mạng (chỉ đọc exact T08 → báo thiếu
// 20/20). Hai màn ra hai con số, UI phải fail-closed, CEO không xem được gì.
test('mọi đường lấy chi phí đều nhận cùng một bảng tỷ lệ đang hiệu lực', async () => {
  const credentials = {
    baseUrl: 'http://hub.test', assignmentKey: 'assignment-key-1234',
    employeeCostKeys: 'DN001=employee-cost-key-1234', backoffMs: [],
  };
  // DataHub chỉ có bảng của T07: hỏi đích danh T08 thì rỗng, hỏi "bảng mới nhất"
  // (không kèm kỳ) thì trả bảng T07 kèm provenance 2026-07.
  const fetchImpl = async (url) => {
    const askedT08 = String(url).includes('from=2026-08');
    return { ok: true, status: 200, json: async () => (askedT08
      ? { empCode: 'DN001', from: '2026-08', to: '2026-08', columns: [], rows: [] }
      : { empCode: 'DN001', from: '2026-07', to: '2026-07', columns: COLUMNS, rows: ROWS }) };
  };
  const options = { from: '2026-08', to: '2026-08', ...credentials, fetchImpl };

  // Đường KPI (qua getForSession) và đường badge "thiếu %" (gọi fetchEmployeeCost
  // trực tiếp, đúng như employeeCostGaps.js làm).
  const kpi = await employeeCost.getForSession({
    session: { emp_code: 'CEO', role: 'admin' }, scope: { empCode: 'DN001' }, requestedEmp: 'DN001',
  }, { ...options, auditImpl: () => {} });
  const badge = await employeeCost.fetchEmployeeCost('DN001', options);

  assert.deepEqual(badge.payload.periods[0].rows, kpi.periods[0].rows,
    'badge thiếu % và KPI phải đọc cùng một bảng tỷ lệ');
  assert.equal(badge.payload.periods[0].rateEffectiveFrom, '2026-07');
  assert.equal(kpi.periods[0].rateEffectiveFrom, '2026-07');
  assert.ok(badge.payload.periods[0].rows.length > 0, 'không được rỗng khi đã có policy hiệu lực');
});
