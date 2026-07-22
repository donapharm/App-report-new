const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const visibility = require('../src/employeeCostVisibility');

const roster = [
  { emp_code: 'DN001', name: 'NV chính thức', group_key: 'sale', group_label: 'NV chính thức' },
  { emp_code: 'DN002', name: 'CTV', group_key: 'ctv', group_label: 'CTV' },
  { emp_code: 'DN021', name: 'CTV đặc biệt', group_key: 'ctv_special', group_label: 'CTV đặc biệt' },
];

function memoryService(initial) {
  const files = initial ? { [visibility.STORE_FILE]: structuredClone(initial) } : {};
  const service = visibility.createService({
    persistence: {
      load: (name, fallback) => (Object.prototype.hasOwnProperty.call(files, name) ? structuredClone(files[name]) : fallback),
      save: (name, value) => { files[name] = structuredClone(value); },
    },
    now: () => new Date('2026-07-21T05:30:00.000Z'),
  });
  return { service, files };
}

test('visibility defaults safely to department off and returns no cost fields', () => {
  const { service } = memoryService();
  assert.deepEqual(service.load(), { version: 1, department: 'off', groups: {}, employees: {}, audit: [] });
  assert.deepEqual(service.decision('DN001', roster), { enabled: false, effective: 'off', source: 'department' });
  assert.deepEqual(visibility.disabledPayload(), {
    disabled: true,
    note: 'Chức năng chi phí đang tắt cho bạn.',
    columns: [],
    rows: [],
  });
});

test('department setting applies when there is no group or employee override', () => {
  const { service } = memoryService({ department: 'on' });
  assert.deepEqual(service.decision('DN001', roster), { enabled: true, effective: 'on', source: 'department' });
  const panel = service.panel(roster);
  assert.equal(panel.department.setting, 'on');
  assert.equal(panel.groups.find((group) => group.key === 'sale').effective, 'on');
});

test('group override wins over department', () => {
  const { service } = memoryService({ department: 'on', groups: { ctv: 'off' } });
  assert.deepEqual(service.decision('DN002', roster), { enabled: false, effective: 'off', source: 'group', groupKey: 'ctv' });
  assert.equal(service.decision('DN001', roster).enabled, true);
  const employee = service.panel(roster).employees.find((item) => item.emp_code === 'DN002');
  assert.equal(employee.source, 'group');
  assert.equal(employee.effective, 'off');
});

test('employee override has precedence over group and department', () => {
  const { service } = memoryService({ department: 'off', groups: { ctv: 'off' }, employees: { DN002: 'on' } });
  assert.deepEqual(service.decision('dn002', roster), { enabled: true, effective: 'on', source: 'employee' });
  assert.equal(service.decision('DN021', roster).enabled, false);
});

test('employee outside the approved roster always fails closed', () => {
  const { service } = memoryService({ department: 'on', employees: { DN999: 'on' } });
  assert.deepEqual(service.decision('DN999', roster), { enabled: false, effective: 'off', source: 'not_roster' });
});

test('OFF never executes upstream loader while admin bypass still does', async () => {
  const { service, files } = memoryService({ department: 'off' });
  let upstreamCalls = 0;
  const loadPayload = async () => { upstreamCalls += 1; return { rows: [{ sensitive: 1 }] }; };

  const disabled = await service.run({ admin: false, actor: 'DN001', role: 'sale', empCode: 'DN001', roster }, loadPayload);
  assert.deepEqual(disabled, visibility.disabledPayload());
  assert.equal(upstreamCalls, 0);
  assert.deepEqual(files[visibility.STORE_FILE].audit.at(-1), {
    at: '2026-07-21T05:30:00.000Z',
    event: 'access_denied',
    actor: 'DN001',
    role: 'sale',
    empCode: 'DN001',
    outcome: 'disabled',
    source: 'department',
    effective: 'off',
  });
  assert.doesNotMatch(JSON.stringify(files[visibility.STORE_FILE].audit.at(-1)), /sensitive|token|header|body/i);

  const adminPayload = await service.run({ admin: true, actor: 'CEO', role: 'ceo', empCode: 'DN001', roster }, loadPayload);
  assert.deepEqual(adminPayload, { rows: [{ sensitive: 1 }] });
  assert.equal(upstreamCalls, 1);
});

test('audit persistence failure still fails closed and never executes upstream', async () => {
  let upstreamCalls = 0;
  const warnings = [];
  const service = visibility.createService({
    persistence: {
      load: () => ({ department: 'off' }),
      save: () => { throw new Error('disk unavailable'); },
    },
    logger: { warn: (...args) => warnings.push(args) },
  });
  const payload = await service.run({ admin: false, actor: 'DN001', role: 'sale', empCode: 'DN001', roster }, async () => {
    upstreamCalls += 1;
    return { rows: [{ sensitive: 1 }] };
  });
  assert.deepEqual(payload, visibility.disabledPayload());
  assert.equal(upstreamCalls, 0);
  assert.equal(warnings.length, 1);
});

test('save persists inherit as override removal and audits before/after/actor/time', () => {
  const { service, files } = memoryService({
    department: 'off', groups: { ctv: 'off' }, employees: { DN002: 'off' }, audit: [],
  });
  const panel = service.save({
    department: 'on',
    groups: { ctv: 'on', sale: 'inherit' },
    employees: { DN002: 'inherit', DN001: 'off' },
  }, { actor: 'ceo', roster });

  assert.equal(panel.changed, true);
  assert.deepEqual(files[visibility.STORE_FILE].groups, { ctv: 'on' });
  assert.deepEqual(files[visibility.STORE_FILE].employees, { DN001: 'off' });
  const audit = files[visibility.STORE_FILE].audit.at(-1);
  assert.equal(audit.event, 'visibility_change');
  assert.equal(audit.actor, 'CEO');
  assert.equal(audit.at, '2026-07-21T05:30:00.000Z');
  assert.equal(audit.before.department, 'off');
  assert.equal(audit.after.department, 'on');
  assert.deepEqual(audit.changes, [
    { path: 'department', before: 'off', after: 'on' },
    { path: 'groups.ctv', before: 'off', after: 'on' },
    { path: 'employees.DN001', before: 'inherit', after: 'off' },
    { path: 'employees.DN002', before: 'off', after: 'inherit' },
  ]);
});

test('invalid values and roster keys are rejected without persisting', () => {
  const { service, files } = memoryService();
  assert.throws(() => service.save({ department: 'inherit' }, { roster }), { code: 'EMPLOYEE_COST_VISIBILITY_INVALID' });
  assert.throws(() => service.save({ groups: { unknown: 'on' } }, { roster }), { code: 'EMPLOYEE_COST_VISIBILITY_UNKNOWN_GROUP' });
  assert.throws(() => service.save({ employees: { DN999: 'off' } }, { roster }), { code: 'EMPLOYEE_COST_VISIBILITY_UNKNOWN_EMPLOYEE' });
  assert.throws(() => service.save({ employees: { DN001: 'yes' } }, { roster }), { code: 'EMPLOYEE_COST_VISIBILITY_INVALID' });
  assert.equal(files[visibility.STORE_FILE], undefined);
});

test('visibility routes are admin guarded and all upstream work is enclosed by the visibility runner', () => {
  const routes = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(routes, /router\.get\('\/employee-cost\/visibility', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(routes, /router\.post\('\/employee-cost\/visibility', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(routes, /router\.get\('\/me'[\s\S]*?employeeCostDisabled/);

  const start = routes.indexOf('async function employeeCostPayload(');
  const end = routes.indexOf("router.get('/employee-cost',", start);
  const route = routes.slice(start, end);
  const gate = route.indexOf('employeeCostVisibility.run({');
  assert.ok(gate > 0, 'route must use the tested OFF short-circuit runner');
  const runnerEnd = route.indexOf('\n  });\n}', gate);
  assert.ok(runnerEnd > gate, 'runner callback must close before response');
  for (const guardedCall of ['employeeCost.parseMonthRange', 'store.getRows', 'canonicalAssignmentSnapshot', 'employeeCost.getForSession']) {
    const index = route.indexOf(guardedCall);
    assert.ok(index > gate && index < runnerEnd, `${guardedCall} must stay inside the guarded callback`);
  }
  assert.match(route, /const admin = auth\.isAdmin[\s\S]*?employeeCostVisibility\.run\(\{[\s\S]*?admin,/);
  assert.match(routes, /router\.get\('\/employee-cost'[\s\S]*?employeeCostPayload\(req\)/);
});

test('employee-cost admin GET routes return a specific JSON error when roster building fails', async () => {
  const router = require('../src/routes');
  const rosterService = require('../src/employeeCostRoster');
  const originalBuildRoster = rosterService.buildRoster;
  rosterService.buildRoster = () => { throw new Error('forced roster failure'); };
  try {
    for (const path of ['/employee-cost/employees', '/employee-cost/visibility']) {
      const layer = router.stack.find((candidate) => candidate.route?.path === path && candidate.route?.methods?.get);
      assert.ok(layer, `missing GET ${path}`);
      const handler = layer.route.stack.at(-1).handle;
      const response = {
        headersSent: false,
        statusCode: 200,
        set() { return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; this.headersSent = true; return this; },
      };
      let nextCalled = false;
      await handler({ session: { emp_code: 'CEO', role: 'ceo' } }, response, () => { nextCalled = true; });
      assert.equal(nextCalled, false);
      assert.equal(response.statusCode, 500);
      assert.deepEqual(response.body, { error: 'forced roster failure', code: undefined });
    }
  } finally {
    rosterService.buildRoster = originalBuildRoster;
  }
});
