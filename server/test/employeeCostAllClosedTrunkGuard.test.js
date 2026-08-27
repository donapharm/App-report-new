const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = require('../src/routes');
const employeeCost = require('../src/employeeCost');

const {
  employeeCostAllPayload,
  assertEmployeeCostExportableReports,
  paymentSchedulesFromPayload,
} = router.employeeCostAllTestServices;
const req = (period) => ({
  session: { emp_code: 'CEO', role: 'admin' },
  query: { emp: 'ALL', from: period, to: period, page: '1', pageSize: '20' },
});
const roster = [{ emp_code: 'DN001', name: 'NV 1' }];

test('kỳ đã khoá không generation chặn tại thân ALL trước mapWithDeadline', async () => {
  let snapshotReads = 0;
  let mapWithDeadlineCalls = 0;
  const snapshotStore = { tryReadCurrent: () => { snapshotReads += 1; return { ok: false, error: { code: 'ABSENT' } }; } };
  const mapWithDeadlineObserver = () => { mapWithDeadlineCalls += 1; };
  const model = await employeeCostAllPayload(req('2026-07'), { snapshotStore, rosterOverride: roster, mapWithDeadlineObserver });
  assert.equal(snapshotReads, 1);
  assert.equal(mapWithDeadlineCalls, 0, 'mapWithDeadline/fan-out phải được gọi 0 lần');
  assert.equal(model.sourceOutcome, 'closed_unfinalized');
  assert.equal(model.note, require('../src/employeeCost').CLOSED_UNFINALIZED_NOTE);
  assert.equal(model.summary.periodTotal, null);
  assert.equal(model.summary.provisionalPeriodTotal, null);
});

test('kỳ đã khoá có generation đủ vẫn trả snapshot hiện hành', async () => {
  const snapshot = {
    complete: true, unavailableReasons: [],
    manifest: { generationId: 'g-test', fetchedAt: '2026-08-09T00:00:00+07:00' },
    model: { periods: [{ period: '2026-07', columns: [], rows: [], note: 'snapshot' }] },
  };
  const snapshotStore = { tryReadCurrent: () => ({ ok: true, snapshot }) };
  const model = await employeeCostAllPayload(req('2026-07'), { snapshotStore, rosterOverride: roster });
  assert.equal(model.trangThaiDongBo.generationId, 'g-test');
  assert.equal(model.periods[0].note, 'snapshot');
});

test('10 lượt kỳ đã khoá không generation giống hệt từng ký tự', async () => {
  const snapshotStore = { tryReadCurrent: () => ({ ok: false, error: { code: 'ABSENT' } }) };
  const values = [];
  for (let i = 0; i < 10; i += 1) {
    values.push(JSON.stringify(await employeeCostAllPayload(req('2026-07'), { snapshotStore, rosterOverride: roster })));
  }
  assert.equal(new Set(values).size, 1);
});

test('kỳ đang chạy không bị nhánh closed-unfinalized chặn', async () => {
  let snapshotReads = 0;
  let mapWithDeadlineCalls = 0;
  const snapshotStore = { tryReadCurrent: () => { snapshotReads += 1; return { ok: false }; } };
  const mapWithDeadlineObserver = () => { mapWithDeadlineCalls += 1; };
  const model = await employeeCostAllPayload(req('2099-01'), { snapshotStore, rosterOverride: [], mapWithDeadlineObserver });
  assert.equal(snapshotReads, 0, 'kỳ đang chạy phải tiếp tục đường fan-out cũ');
  assert.ok(mapWithDeadlineCalls > 0, 'kỳ đang chạy vẫn phải gọi mapWithDeadline');
  assert.notEqual(model.sourceOutcome, 'closed_unfinalized');
});

test('adapter getForSession bị thay không tự tắt guard kỳ đã khoá', async (t) => {
  const original = employeeCost.getForSession;
  t.after(() => { employeeCost.getForSession = original; });
  employeeCost.getForSession = async () => ({ sourceOutcome: 'stub' });
  let calls = 0;
  const model = await employeeCostAllPayload(req('2026-07'), {
    snapshotStore: { tryReadCurrent: () => ({ ok: false, error: { code: 'ABSENT' } }) },
    rosterOverride: roster,
    mapWithDeadlineObserver: () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(model.sourceOutcome, 'closed_unfinalized');
});

test('server/src không caller nào được truyền bypassClosedPeriodGuard', () => {
  const srcRoot = path.join(__dirname, '..', 'src');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  });
  walk(srcRoot);
  const offenders = files.filter((file) => /bypassClosedPeriodGuard\s*:/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, [], 'bypass chỉ được test truyền qua test service, không được có caller runtime');
});

test('export ALL kỳ đã khoá không generation không fan-out và không tạo file có tổng', async () => {
  let calls = 0;
  const model = await employeeCostAllPayload(req('2026-07'), {
    paginate: false,
    snapshotStore: { tryReadCurrent: () => ({ ok: false, error: { code: 'ABSENT' } }) },
    rosterOverride: roster,
    mapWithDeadlineObserver: () => { calls += 1; },
  });
  assert.equal(calls, 0, 'export ALL không được đi vào mapWithDeadline');
  assert.equal(model.summary.periodTotal, null);
  assert.throws(() => assertEmployeeCostExportableReports([model]), { code: 'EMPLOYEE_COST_CLOSED_UNFINALIZED' });
});

test('payment_notice kỳ đã khoá không generation không fan-out và không phát tin', async () => {
  let calls = 0;
  let sends = 0;
  const model = await employeeCostAllPayload(req('2026-07'), {
    paginate: false,
    includePaymentSchedules: true,
    snapshotStore: { tryReadCurrent: () => ({ ok: false, error: { code: 'ABSENT' } }) },
    rosterOverride: roster,
    mapWithDeadlineObserver: () => { calls += 1; },
  });
  assert.equal(calls, 0, 'payment_notice không được đi vào mapWithDeadline');
  assert.throws(() => paymentSchedulesFromPayload(model, '2026-07'), { code: 'PAYMENT_NOTICE_SCHEDULE_UNRELIABLE' });
  assert.equal(sends, 0);
});

test('export và payment_notice kỳ đang chạy vẫn fan-out như cũ', async () => {
  for (const includePaymentSchedules of [false, true]) {
    let calls = 0;
    const model = await employeeCostAllPayload(req('2099-01'), {
      paginate: false,
      includePaymentSchedules,
      snapshotStore: { tryReadCurrent: () => ({ ok: false }) },
      rosterOverride: [],
      mapWithDeadlineObserver: () => { calls += 1; },
    });
    assert.ok(calls > 0);
    assert.notEqual(model.sourceOutcome, 'closed_unfinalized');
  }
});
