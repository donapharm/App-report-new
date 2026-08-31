const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-deadline-recovery-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-deadline-recovery-no-lkg.json');
process.env.EMPLOYEE_COST_ALL_WARM_DISABLED = '1';

const router = require('../src/routes');
const {
  employeeCostAllHasDeadline,
  scheduleEmployeeCostDeadlineRecoveryWarm,
} = router.employeeCostAllTestServices;

const payload = (reasons = {}) => ({ periods: [{ match: { unavailableReasons: reasons } }] });

test('chỉ deadline mới kích hoạt recovery warm', () => {
  assert.equal(employeeCostAllHasDeadline(payload({ DN018: 'deadline' })), true);
  assert.equal(employeeCostAllHasDeadline(payload({ DN018: 'upstream_unavailable' })), false);
  assert.equal(employeeCostAllHasDeadline(payload({})), false);
  assert.equal(employeeCostAllHasDeadline({}), false);
});

test('deadline recovery warm single-flight theo kỳ và nhả khóa sau khi xong', async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const warm = async (ky, reason) => {
    calls += 1;
    assert.equal(ky, '08.2026');
    assert.equal(reason, 'request_deadline_recovery');
    await pending;
    return true;
  };

  assert.equal(scheduleEmployeeCostDeadlineRecoveryWarm('08.2026', warm), true);
  assert.equal(scheduleEmployeeCostDeadlineRecoveryWarm('08.2026', warm), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduleEmployeeCostDeadlineRecoveryWarm('08.2026', async () => true), true);
});

