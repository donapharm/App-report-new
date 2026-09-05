import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/Target.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');

test('CEO notification dashboard loads read-only smart-sale day/week/month previews', () => {
  assert.match(api, /smartSalePreview: \(kind = 'day'\) => req\('GET', `\/admin\/smart-sale\/preview/);
  assert.match(page, /Trợ lý điều hành Sale · Shadow read-only/);
  assert.match(page, /\['day', 'week', 'month'\]/);
  assert.match(page, /Doanh thu sau VAT/);
  assert.match(page, /Doanh thu trước VAT/);
  assert.match(page, /shadow 0\/3 ngày/);
  assert.match(page, /Chi phí\/thưởng\/phạt chưa ghép/);
  assert.match(page, /smartSale\.employees\.map/);
  assert.doesNotMatch(page, /smartSale\.employees\.slice/);
});
