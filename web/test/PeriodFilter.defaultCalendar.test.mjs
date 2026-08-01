import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/PeriodFilter.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const pad =');
const end = source.indexOf('export default function PeriodFilter');
assert.ok(start >= 0 && end > start, 'Không tách được các helper PeriodFilter');
const helperSource = `${source.slice(start, end).replaceAll('export function ', 'function ')}\nexport { currentKyVN, defaultPeriodSelection, periodParams };`;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`);
const { currentKyVN, defaultPeriodSelection, periodParams } = helpers;

const period = (ky, extra = {}) => ({ ky, ...extra });

test('ranh giới tháng theo Asia/Bangkok, không theo tháng UTC', () => {
  assert.equal(currentKyVN(new Date('2026-07-31T16:59:59.999Z')), '07.2026');
  assert.equal(currentKyVN(new Date('2026-07-31T17:00:00.000Z')), '08.2026');
  assert.equal(currentKyVN(new Date('2026-08-31T17:00:00.000Z')), '09.2026');
});

test('mặc định chọn tháng lịch VN dù latest có dữ liệu ở tháng trước hoặc tháng sau', () => {
  const now = new Date('2026-08-15T03:00:00.000Z');
  const periods = [period('07.2026'), period('08.2026', { noData: true }), period('09.2026')];
  assert.equal(defaultPeriodSelection(periods, '07.2026', now).ky, '08.2026');
  assert.equal(defaultPeriodSelection(periods, '09.2026', now).ky, '08.2026');
});

test('tháng hiện tại chưa có dữ liệu vẫn được chọn; nếu server chưa mở kỳ thì lùi an toàn', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const withEmptyCurrent = [period('07.2026'), period('08.2026', { noData: true, dayCovered: 0 })];
  assert.equal(defaultPeriodSelection(withEmptyCurrent, '07.2026', now).ky, '08.2026');
  assert.equal(defaultPeriodSelection([period('07.2026')], '07.2026', now).ky, '07.2026');
});

test('tháng người dùng chọn rõ ràng được giữ nguyên trong tham số API', () => {
  const explicit = { mode: 'month', ky: '05.2026', from: '05.2026', to: '05.2026' };
  assert.deepEqual(periodParams(explicit), { ky: '05.2026' });
  assert.equal(explicit.ky, '05.2026');
});

test('tham số thiếu hoặc malformed không làm vỡ bộ lọc và không phát sinh ky rác', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  assert.deepEqual(periodParams(null), {});
  assert.deepEqual(periodParams({ mode: 'month' }), {});
  assert.equal(defaultPeriodSelection(undefined, undefined, now).ky, '');
  assert.equal(defaultPeriodSelection({ ky: '08.2026' }, '08.2026', now).ky, '');
  assert.equal(defaultPeriodSelection([null, {}, period('13.2026'), period('07.2026')], 123, now).ky, '07.2026');
});
