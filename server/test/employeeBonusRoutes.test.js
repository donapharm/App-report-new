'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../src/employeeBonus.js'), 'utf8');

test('bonus policy list, preview and save routes are CEO/admin-only', () => {
  assert.match(routes, /router\.get\('\/admin\/bonus-policies', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(routes, /router\.post\('\/admin\/bonus-policies\/preview', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(routes, /router\.post\('\/admin\/bonus-policies', auth\.requireAuth, auth\.requireAdmin/);
});

test('save requires one-time same-actor preview and consumes it before writing', () => {
  assert.match(routes, /preview\.actor !== actor/);
  assert.match(routes, /BONUS_POLICY_PREVIEW_REQUIRED/);
  assert.match(routes, /bonusPolicyPreviews\.delete\(previewId\);\n  const result = employeeBonusPolicy\.save/);
});

test('bonus engine reads only catalog C10 and explicitly never reads App Sale priority or tech rank', () => {
  assert.match(engine, /Never reads App Sale's `priority`\/`tech_rank`/);
  assert.match(engine, /row\.c10 \?\? row\.C10/);
  assert.doesNotMatch(engine, /row\.priority/);
  assert.doesNotMatch(engine, /row\.tech_rank/);
});
