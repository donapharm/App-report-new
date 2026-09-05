'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildPreview, attentionFor } = require('../src/smartSaleManagement');

const ranges = {
  asOf: '2026-09-05', dayRange: { from: '2026-09-05', to: '2026-09-05' },
  weekRange: { from: '2026-09-01', to: '2026-09-05' }, monthRange: { from: '2026-09-01', to: '2026-09-05' },
};

function fakeReport() {
  return {
    defaultRanges: () => ranges,
    salesRecipients: () => [
      { code: 'DN001', telegramId: 'masked', email: '' },
      { code: 'DN002', telegramId: '', email: 'masked@example.test' },
    ],
    computeReport: async ({ empCode }) => empCode === 'DN001'
      ? { revenue: 1050, prevRevenue: 2100, target: 2000, score: { ty_le_quy: 80 }, diffsUnit: { down: [{ key: '001' }] }, topProducts: [{ key: 'P01' }] }
      : { revenue: 2100, prevRevenue: 1050, target: 1000, score: { ty_le_quy: 110 }, diffsUnit: { down: [] }, topProducts: [] },
  };
}

test('smart-sale preview separates VAT bases, ranks attention and never enables sending', async () => {
  const calls = [];
  const report = fakeReport();
  const compute = report.computeReport;
  report.computeReport = async (options) => { calls.push(options); return compute(options); };
  const value = await buildPreview({ kind: 'day', ranges }, { salesReport: report, vatDivisor: 1.05 });
  assert.equal(value.mode, 'shadow_read_only');
  assert.equal(value.send_enabled, false);
  assert.equal(value.schedule_applied, false);
  assert.deepEqual(value.shadow_plan, { required_days: 3, completed_days: 0, status: 'NOT_STARTED' });
  assert.equal(value.ceo.revenue_after_vat, 3150);
  assert.equal(value.ceo.revenue_before_vat, 3000);
  assert.equal(value.employees.find((x) => x.emp_code === 'DN001').revenue_before_vat, 1000);
  assert.deepEqual(value.employees.find((x) => x.emp_code === 'DN001').attention, ['BELOW_TARGET', 'REVENUE_DROPPING']);
  assert.match(value.money_basis.cost_bonus_penalty, /không suy diễn số/i);
  assert.match(value.preview_digest, /^[a-f0-9]{64}$/);
  assert.equal(calls.every((call) => call.includeCst === false), true);
});

test('employee preview contains code-only operational identity and only its own metrics', async () => {
  const value = await buildPreview({ kind: 'week', ranges }, { salesReport: fakeReport(), vatDivisor: 1.05 });
  assert.deepEqual(value.employees.map((x) => x.emp_code).sort(), ['DN001', 'DN002']);
  assert.equal(value.employees.some((x) => Object.hasOwn(x, 'name')), false);
  assert.equal(value.employees.every((x) => Object.hasOwn(x, 'target_remaining')), true);
});

test('invalid preview kind fails closed', async () => {
  await assert.rejects(() => buildPreview({ kind: 'quarter' }, { salesReport: fakeReport() }), (error) => error.code === 'SMART_SALE_KIND_INVALID' && error.status === 400);
});

test('empty recipient roster fails closed instead of publishing a zero-company dashboard', async () => {
  const report = fakeReport(); report.salesRecipients = () => [];
  await assert.rejects(() => buildPreview({ kind: 'day', ranges }, { salesReport: report }), (error) => error.code === 'SMART_SALE_ROSTER_EMPTY' && error.status === 503);
});

test('attention flags unreachable employees without exposing recipient details', () => {
  assert.deepEqual(attentionFor({ target_assigned: true, target_pct: 100, trend_pct: 0, channels: { telegram: false, email: false } }), ['NO_DELIVERY_CHANNEL']);
});

test('smart-sale route is CEO-only GET and exposes no send endpoint', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(source, /router\.get\('\/admin\/smart-sale\/preview', auth\.requireAuth, auth\.requireCeo/);
  assert.doesNotMatch(source, /router\.(post|put|patch|delete)\('\/admin\/smart-sale/);
  assert.match(source, /Cache-Control', 'no-store'/);
});
