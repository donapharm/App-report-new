import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const target = fs.readFileSync(new URL('../src/pages/Target.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');

test('Target admin exposes versioned Thưởng v3 editor, all layers and C10-only wording', () => {
  assert.match(target, /Cấu hình Thưởng v3/);
  for (const layer of ['default', 'productGroup', 'route', 'unit', 'employee']) assert.match(target, new RegExp(`value="${layer}"`));
  for (const group of ['H.A\\*', 'H.A', 'H.B', 'H.C', 'H.D']) assert.match(target, new RegExp(`'${group}'`));
  assert.match(target, /Toàn bộ NV \(mức chung\)/);
  assert.match(target, /Chỉ dự kiến\/tham khảo, không payroll/);
  assert.doesNotMatch(target, /tech_rank/);
});

test('editor captures group target tri-state and warns when group total exceeds employee total target', () => {
  assert.match(target, /Target nhóm \(VND\)/);
  assert.match(target, /Trống = kế thừa/);
  assert.match(target, /Chưa giao target nhóm \(P2 = 0\)/);
  assert.match(target, /const priorityTargets = targetPatch\(\)/);
  assert.match(target, /Object\.keys\(priorityTargets\)\.length/);
  assert.match(target, /patch: configPatch\(\)/);
  assert.match(target, /Tổng target nhóm/);
  assert.match(target, /đang nhập/);
  assert.match(target, /targetScopeMetadata/);
});

test('preview renders month and quarter detail for revenue, target, excess, rate and P2 group', () => {
  assert.match(target, /Chi tiết P2 tháng/);
  assert.match(target, /target quý = tổng 3 tháng/);
  for (const label of ['Doanh thu trước VAT', 'Target nhóm', 'Phần vượt', 'Rate', 'P2 nhóm', 'Tổng P2']) assert.match(target, new RegExp(label));
  assert.match(target, /P2 = Σ max\(0, doanh thu C10 nhóm − target nhóm\) × rate/);
});

test('save stays disabled until canonical server preview and API uses one-time preview id', () => {
  assert.match(target, /Mô phỏng trước khi lưu/);
  assert.match(target, /disabled=\{busy \|\| closed \|\| !preview\?\.previewId\}/);
  assert.match(target, /adminBonusPolicySave\(\{ previewId: preview\.previewId \}\)/);
  assert.match(api, /adminBonusPolicyPreview/);
  assert.match(api, /adminBonusPolicySave/);
});

test('editor keeps P1 tiers, 101 gate, rates and optional total cap', () => {
  assert.match(target, /\+ Thêm bậc/);
  assert.match(target, />Xóa<\/button>/);
  assert.match(target, /Ngưỡng P2/);
  assert.match(target, /Cap tổng/);
  assert.match(target, /P1 — cơ bản/);
  assert.match(target, /P1 .* \+ P2 phần vượt/);
});
