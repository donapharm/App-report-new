import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const target = fs.readFileSync(new URL('../src/pages/Target.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');

test('Target admin exposes versioned Thưởng v3 editor, all layers and C10-only wording', () => {
  // Số hiệu công thức chỉ có MỘT nguồn (backend). Ghi cứng ở đây thì mỗi lần nâng
  // version lại phải sửa tay chính test này — đọc từ employeeBonus.FORMULA_VERSION.
  const backend = fs.readFileSync(new URL('../../server/src/employeeBonus.js', import.meta.url), 'utf8');
  const backendVersion = /const FORMULA_VERSION = '([^']+)'/.exec(backend)?.[1];
  assert.ok(backendVersion, 'không đọc được FORMULA_VERSION ở backend');
  assert.match(target, new RegExp(`BONUS_FORMULA_VERSION_FALLBACK = '${backendVersion.replace('.', '\\.')}'`));
  assert.match(target, /Cấu hình Thưởng \{bonusFv\}/);
  for (const layer of ['default', 'productGroup', 'route', 'unit', 'employee']) assert.match(target, new RegExp(`value="${layer}"`));
  for (const group of ['H.A\\*', 'H.A', 'H.B', 'H.C', 'H.D']) assert.match(target, new RegExp(`'${group}'`));
  assert.match(target, /Toàn bộ NV \(mức chung\)/);
  assert.match(target, /Chỉ dự kiến\/tham khảo, không payroll/);
  assert.doesNotMatch(target, /tech_rank/);
});

test('editor defaults auto target on, captures manual override/clear and warns on manual group total', () => {
  assert.match(target, /Target nhóm manual \(\{fv\} KHÔNG dùng\)/);
  assert.match(target, /Trống = kế thừa manual \/ dùng auto/);
  assert.match(target, /Xóa manual tại tầng này → dùng auto/);
  assert.match(target, /Tự suy target nhóm khi chưa có manual \(mặc định bật\)/);
  assert.match(target, /patch\.autoGroupTargets = form\.autoGroupTargets/);
  assert.match(target, /const priorityTargets = targetPatch\(\)/);
  assert.match(target, /Object\.keys\(priorityTargets\)\.length/);
  assert.match(target, /patch: configPatch\(\)/);
  assert.match(target, /Tổng target nhóm/);
  assert.match(target, /đang nhập/);
  assert.match(target, /targetScopeMetadata/);
});

test('preview renders month and quarter detail for revenue, target, excess, rate and P2 group', () => {
  assert.match(target, /Chi tiết P2 tháng/);
  assert.match(target, /Target quý = trung bình các tháng đã giao/);
  for (const label of ['Doanh thu trước VAT', 'Target nhóm', 'Tỷ trọng C10', 'Phần vượt', 'Rate', 'P2 nhóm', 'Tổng P2']) assert.match(target, new RegExp(label));
  assert.match(target, /auto · tự suy/);
  assert.match(target, /manual · CEO nhập/);
  assert.match(target, /phần vượt = tổng doanh thu C10 − tổng target/);
});

test('save stays disabled until canonical server preview and API uses one-time preview id', () => {
  assert.match(target, /Mô phỏng trước khi lưu/);
  assert.match(target, /disabled=\{busy \|\| closed \|\| !preview\?\.previewId \|\| preview\?\.saved\}/);
  assert.match(target, /adminBonusPolicySave\(\{ previewId: preview\.previewId \}\)/);
  assert.match(api, /adminBonusPolicyPreview/);
  assert.match(api, /adminBonusPolicySave/);
});

test('bonus modal keeps saved preview state while parent KPI reloads', () => {
  const modalAt = target.indexOf('function TargetAdminModal');
  const panelAt = target.indexOf('function TargetAdminPanel');
  assert.ok(modalAt >= 0 && modalAt < panelAt, 'TargetAdminModal must have stable module-level identity');
  assert.doesNotMatch(target.slice(panelAt, target.indexOf('const bonusFv', panelAt)), /const Modal\s*=/);
  assert.match(target, /<TargetAdminModal open=\{tool === 'bonus'\}/);
  assert.match(target, /setPreview\(\{ \.\.\.\(await api\.adminBonusPolicyPreview\(payload\(\)\)\), saved: true \}\)/);
  assert.match(target, /await onSaved\?\.\(\)/);
  assert.match(target, /ĐÃ LƯU — số đang áp dụng/);
});

test('editor keeps P1 tiers, 101 gate, rates and optional total cap', () => {
  assert.match(target, /\+ Thêm bậc/);
  assert.match(target, />Xóa<\/button>/);
  assert.match(target, /Ngưỡng P2/);
  assert.match(target, /Cap tổng/);
  assert.match(target, /P1 — cơ bản/);
  assert.match(target, /P1 .* \+ P2 phần vượt/);
});
