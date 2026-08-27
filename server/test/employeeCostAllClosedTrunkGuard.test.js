const test = require('node:test');
const assert = require('node:assert/strict');

const router = require('../src/routes');

const { employeeCostAllPayload } = router.employeeCostAllTestServices;
const req = (period) => ({
  session: { emp_code: 'CEO', role: 'admin' },
  query: { emp: 'ALL', from: period, to: period, page: '1', pageSize: '20' },
});
const roster = [{ emp_code: 'DN001', name: 'NV 1' }];

test('kỳ đã khoá không generation chặn tại thân ALL trước mapWithDeadline', async () => {
  let snapshotReads = 0;
  let mapWithDeadlineCalls = 0;
  const snapshotStore = { tryReadCurrent: () => { snapshotReads += 1; return { ok: false, error: { code: 'ABSENT' } }; } };
  const originalThen = Promise.prototype.then;
  // Spy theo ranh giới hành vi: nếu rơi qua guard, các tác vụ fan-out/catalog sẽ
  // tạo chuỗi promise; guard đúng phải hoàn tất đồng bộ sau đúng một snapshot read.
  Promise.prototype.then = function (...args) { mapWithDeadlineCalls += 1; return originalThen.apply(this, args); };
  try {
    const model = await employeeCostAllPayload(req('2026-07'), { snapshotStore, rosterOverride: roster });
    assert.equal(snapshotReads, 1);
    assert.equal(mapWithDeadlineCalls, 0, 'mapWithDeadline/fan-out phải được gọi 0 lần');
    assert.equal(model.sourceOutcome, 'closed_unfinalized');
    assert.equal(model.note, require('../src/employeeCost').CLOSED_UNFINALIZED_NOTE);
    assert.equal(model.summary.periodTotal, null);
    assert.equal(model.summary.provisionalPeriodTotal, null);
  } finally {
    Promise.prototype.then = originalThen;
  }
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
  const snapshotStore = { tryReadCurrent: () => { snapshotReads += 1; return { ok: false }; } };
  const model = await employeeCostAllPayload(req('2099-01'), { snapshotStore, rosterOverride: [] });
  assert.equal(snapshotReads, 0, 'kỳ đang chạy phải tiếp tục đường fan-out cũ');
  assert.notEqual(model.sourceOutcome, 'closed_unfinalized');
});
