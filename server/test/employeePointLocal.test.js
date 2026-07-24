const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pointLocal = require('../src/employeePointLocal');
const persist = require('../src/persist');

const persistDir = persist.DIR;
const parityPath = path.join(persistDir, 'employee_point_parity_gate.json');
const dqPath = path.join(persistDir, 'employee_point_local_dq.json');

function resetPersist() {
  for (const file of [parityPath, dqPath]) {
    try { fs.unlinkSync(file); } catch {}
  }
}

test.beforeEach(() => resetPersist());
test.afterEach(() => resetPersist());

test('config exposes explicit version/defaults from local JSON', () => {
  const cfg = pointLocal.loadConfig();
  assert.equal(cfg.version, 'point-local-2026-05-r1');
  assert.equal(cfg.effective_from, '2026-05');
  assert.equal(cfg.default, 1);
  assert.equal(cfg.by_route.CL, 2);
  assert.equal(cfg.by_route.NT, 2);
  assert.deepEqual(cfg.ncl_units_2x, ['025', '026', '027', '028']);
});

test('point multiplier follows route/unit rules and defaults safely', () => {
  const cfg = pointLocal.loadConfig();
  assert.equal(pointLocal.pointMultiplier({ route: 'CL', unit_code: '001.BV' }, cfg), 2);
  assert.equal(pointLocal.pointMultiplier({ route: 'NT', unit_code: '001.BV' }, cfg), 2);
  assert.equal(pointLocal.pointMultiplier({ route: 'NCL', unit_code: '025.PK' }, cfg), 2);
  assert.equal(pointLocal.pointMultiplier({ route: 'NCL', unit_code: '099.PK' }, cfg), 1);
  assert.equal(pointLocal.pointMultiplier({ route: '', unit_code: '099.PK' }, cfg), 1);
});

test('buildLocalPointPayload computes month/quarter points from scoped App Report rows and rounds 2 decimals', () => {
  const original = pointLocal.__getStore ? pointLocal.__getStore() : null;
  const fakeRows = {
    '07.2026': [
      { ky: '07.2026', emp_code: 'DN001', revenue: 100_000_000, route: 'CL', unit_code: '001.BV' },
      { ky: '07.2026', emp_code: 'DN001', revenue: 50_000_000, route: 'NCL', unit_code: '025.PK' },
      { ky: '07.2026', emp_code: 'DN001', revenue: 25_000_000, route: 'NCL', unit_code: '099.PK' },
      { ky: '07.2026', emp_code: 'DN021', revenue: 900_000_000, route: 'CL', unit_code: '001.BV' },
    ],
    '08.2026': [
      { ky: '08.2026', emp_code: 'DN001', revenue: 50_000_000, route: 'NT', unit_code: '001.BV' },
    ],
    '09.2026': [
      { ky: '09.2026', emp_code: 'DN001', revenue: 10_000_000, route: 'NCL', unit_code: '028.TY' },
    ],
  };
  const store = require('../src/store');
  const originalFn = store.getRowsRange;
  store.getRowsRange = ({ kys }) => (kys || []).flatMap((ky) => fakeRows[ky] || []);
  try {
    const payload = pointLocal.buildLocalPointPayload({ empCode: 'DN001', period: '2026-07' });
    assert.equal(payload.point_month, 3.25);
    assert.equal(payload.point_quarter, 4.45);
    assert.equal(payload.dq_warning_count, 0);
    assert.equal(payload.point_rule_version, 'point-local-2026-05-r1');
    assert.equal(payload.quarter_label, 'Q3/2026');
  } finally {
    store.getRowsRange = originalFn;
  }
});

test('unknown route/unit fallback stays local, counts DQ, and stores no row leakage/PII', () => {
  const store = require('../src/store');
  const originalFn = store.getRowsRange;
  store.getRowsRange = ({ kys }) => {
    if ((kys || []).length === 1 && kys[0] === '07.2026') {
      return [{ ky: '07.2026', emp_code: 'DN001', revenue: 100_000_000, route: '', unit_code: '001.BV', iit_code: 'QL1' }];
    }
    return [
      { ky: '07.2026', emp_code: 'DN001', revenue: 100_000_000, route: '', unit_code: '001.BV', iit_code: 'QL1' },
      { ky: '08.2026', emp_code: 'DN001', revenue: 50_000_000, route: 'NCL', unit_code: '', unit_name: 'Không mã', iit_code: 'QL2' },
    ];
  };
  try {
    const payload = pointLocal.buildLocalPointPayload({ empCode: 'DN001', period: '2026-07' });
    assert.equal(payload.point_month, 1);
    assert.equal(payload.point_quarter, 1.5);
    assert.equal(payload.dq_warning_count >= 2, true);
    const rows = persist.load('employee_point_local_dq', []);
    assert.equal(rows.length >= 2, true);
    assert.equal(JSON.stringify(rows).includes('100000000'), false);
    assert.equal(JSON.stringify(rows).includes('Không mã'), true);
  } finally {
    store.getRowsRange = originalFn;
  }
});

test('parity gate stays closed until exact-zero artifact + matching rule + employee match', () => {
  resetPersist();
  let parity = pointLocal.parityStatus({ empCode: 'DN001', period: '2026-09', pointRuleVersion: 'point-local-2026-05-r1' });
  assert.equal(parity.available, false);
  assert.equal(parity.status, 'đang đối soát');

  persist.save('employee_point_parity_gate', {
    exact_zero_parity: true,
    point_rule_version: 'point-local-2026-05-r1',
    period: '2026-09',
    required_employees: ['DN001'],
    artifact: 'parity-2026q3.txt',
    checked_at: '2026-07-24T09:00:00.000Z',
  });
  parity = pointLocal.parityStatus({ empCode: 'DN001', period: '2026-09', pointRuleVersion: 'point-local-2026-05-r1' });
  assert.equal(parity.available, true);
  assert.equal(parity.status, 'chốt quý — cấn trừ');

  const wrongPeriod = pointLocal.parityStatus({ empCode: 'DN001', period: '2026-07', pointRuleVersion: 'point-local-2026-05-r1' });
  assert.equal(wrongPeriod.available, false);
  assert.equal(wrongPeriod.periodMatch, false);
  assert.equal(wrongPeriod.status, 'đang đối soát');

  const wrongRule = pointLocal.parityStatus({ empCode: 'DN001', period: '2026-09', pointRuleVersion: 'point-local-2026-06-r2' });
  assert.equal(wrongRule.available, false);
  assert.equal(wrongRule.pointRuleVersionMatch, false);
});
