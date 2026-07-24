import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const target = fs.readFileSync(new URL('../src/pages/Target.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');

test('Target admin exposes versioned Thưởng v2 editor with all layers and C10-only wording', () => {
  assert.match(target, /Cấu hình Thưởng v2/);
  for (const layer of ['default', 'productGroup', 'route', 'unit', 'employee']) assert.match(target, new RegExp(`value="${layer}"`));
  for (const group of ['H.A\\*', 'H.A', 'H.B', 'H.C', 'H.D']) assert.match(target, new RegExp(`'${group}'`));
  assert.match(target, /không sửa mapping C10/);
  assert.match(target, /không payroll\/không gửi thưởng/);
  assert.doesNotMatch(target, /tech_rank/);
});

test('save stays disabled until server preview and API uses one-time preview id', () => {
  assert.match(target, /Mô phỏng trước khi lưu/);
  assert.match(target, /disabled=\{busy \|\| !preview\?\.previewId\}/);
  assert.match(target, /adminBonusPolicySave\(\{ previewId: preview\.previewId \}\)/);
  assert.match(api, /adminBonusPolicyPreview/);
  assert.match(api, /adminBonusPolicySave/);
});

test('editor supports add/remove base tiers, priority threshold, rates and optional total cap', () => {
  assert.match(target, /\+ Thêm bậc/);
  assert.match(target, />Xóa<\/button>/);
  assert.match(target, /Ngưỡng cộng phần 2/);
  assert.match(target, /Cap tổng/);
  assert.match(target, /Rate phần 2/);
  assert.match(target, /Phần 1 .* \+ Phần 2/);
});
