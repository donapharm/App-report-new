const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');

test('employee-cost heavy badge summaries coalesce identical cache misses', () => {
  assert.match(routes, /routeName === 'employee-cost-all' \|\| routeName === 'employee-cost-gaps-summary'[\s\S]*?employeeCostDataSignature/);
  assert.match(routes, /protectedRouteBuild\(req, 'employee-cost-gaps-summary',[\s\S]*?employeeCostGapPayload/);
  assert.match(routes, /protectedRouteBuild\(req, 'employee-cost-dq-summary',[\s\S]*?employeeCostDqPayload/);
});

test('ten identical DQ summary misses retain exactly one builder', async () => {
  const router = require('../src/routes');
  let builds = 0;
  const requests = Array.from({ length: 10 }, () => Object.assign(new EventEmitter(), {
    session: { role: 'admin', emp_code: 'CEO' },
    query: { from: '2026-07', to: '2026-07' },
    aborted: false,
  }));
  const results = await Promise.all(requests.map((req) => router.protectedRouteBuild(
    req,
    'employee-cost-dq-summary',
    async () => { builds += 1; await new Promise((resolve) => setTimeout(resolve, 15)); return { ok: true }; },
  )));
  assert.equal(builds, 1);
  assert.equal(results.length, 10);
  assert.ok(results.every((result) => result.ok === true));
});
