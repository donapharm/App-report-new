'use strict';
// GIẢI THÍCH PHẠT CHO NHÂN VIÊN + RÀO CHẮN GÕ SAI TỶ LỆ (CEO chốt 2026-07-30).
//
// CEO: "yêu cầu thêm cột c45 (lương tăng thêm) để nv biết rõ, họ không biết cột c45
// là cột gì. phần giải thích khi bấm ra phải rõ hơn để nv hình dung được các ngữ
// cảnh có thể bị phạt nếu không cố gắng."
//
// Khoá 3 việc:
//   1. Mọi chỗ nhắc C45 dùng TÊN CỘT lấy từ backend, không ghi chữ ở JSX.
//   2. Bảng 4 ngữ cảnh sinh TỪ CẤU HÌNH đang áp dụng ⇒ CEO sửa bậc là chữ đổi theo.
//   3. Tỷ lệ phạt có trần an toàn: gõ "30" thay vì "0,3" phải bị chặn.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const penaltyDisplay = require('../src/penaltyDisplay');
const employeePenaltyPolicy = require('../src/employeePenaltyPolicy');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'));

test('bảng 4 ngữ cảnh sinh từ config, kèm tên cột C45 và ví dụ tiền của chính NV', () => {
  const tiers = penaltyDisplay.tierTable(CONFIG, { activeTier: 't70_90', achieved: 1_000_000_000, c45Amount: 5_000_000 });
  assert.equal(tiers.length, 4);
  assert.deepEqual(tiers.map((tier) => tier.tier), ['none', 't70_90', 't50_70', 'drop_c45']);
  assert.equal(tiers.filter((tier) => tier.active).length, 1, 'chỉ một bậc được đánh dấu đang đứng');
  assert.match(tiers.find((tier) => tier.tier === 'drop_c45').effect, /Lương tăng thêm/);
  assert.match(tiers.find((tier) => tier.tier === 't70_90').effect, /Lương tăng thêm/);
  assert.match(tiers.find((tier) => tier.tier === 'drop_c45').range, /Bằng hoặc dưới 50%/);
  assert.match(tiers.find((tier) => tier.tier === 't50_70').range, /Trên 50% đến dưới 70%/);
  assert.match(tiers.find((tier) => tier.tier === 't70_90').range, /Từ 70% đến dưới 90%/);
  assert.match(tiers.find((tier) => tier.tier === 'none').range, /Từ 90% trở lên/);
  // Ví dụ tiền chỉ hiện ở bậc đang đứng, và là 0,2% × doanh thu THẬT.
  assert.match(tiers.find((tier) => tier.tier === 't70_90').example, /2\.000\.000đ/);
  assert.equal(tiers.find((tier) => tier.tier === 'none').example, '');
});

test('CEO sửa mốc/tỷ lệ thì chữ trên màn hình đổi theo, không phải sửa JSX', () => {
  const moved = penaltyDisplay.tierTable({
    ...CONFIG,
    // Đổi mốc phải đổi CẢ HAI đầu để 4 bậc còn liền mạch — nếu để hở, normalizeConfig
    // fail-closed và bảng trả rỗng (đúng: thà không hiện còn hơn hiện bảng có khe hở).
    penaltyTiers: CONFIG.penaltyTiers.map((tier) => {
      if (tier.tier === 't70_90') return { ...tier, toPct: 95, ratePct: 0.25 };
      if (tier.tier === 'none') return { ...tier, fromPct: 95 };
      return tier;
    }),
  }, {});
  const tier = moved.find((item) => item.tier === 't70_90');
  assert.match(tier.range, /đến dưới 95%/);
  assert.match(tier.effect, /0,25%/);
  // Cấu hình thiếu bậc ⇒ trả rỗng, KHÔNG bịa bảng mặc định.
  assert.deepEqual(penaltyDisplay.tierTable({ penaltyTiers: [] }, {}), []);
});

test('câu trạng thái nói rõ kỳ này trừ thật hay chỉ cảnh báo', () => {
  assert.match(penaltyDisplay.modeText({ mode: 'warn_only', effectiveFrom: '2026-08-01' }), /CHỈ CẢNH BÁO[\s\S]*01\/08\/2026/);
  assert.match(penaltyDisplay.modeText({ mode: 'enforced', effectiveFrom: '2026-08-01' }), /TRỪ THẬT/);
  assert.match(penaltyDisplay.modeText({ mode: 'off' }), /chưa áp dụng/i);
});

test('payload phạt self-scoped được đính nhãn C45 + bảng bậc từ cấu hình ĐANG áp dụng', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(routes, /c45Label: penaltyExplain\.C45_LABEL/);
  assert.match(routes, /tiers: penaltyExplain\.tierTable\(config, \{/);
  assert.match(routes, /withPenaltyExplain\(buildPenaltyForConfig\(activePenaltyConfig\), activePenaltyConfig\)/,
    'bảng bậc phải sinh từ policy đã resolve cho kỳ, không phải từ seed');
});

test('giao diện dùng nhãn + bảng của backend, không tự viết mốc %', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'pages', 'EmployeeCost.jsx'), 'utf8');
  const modal = /function PenaltyDetailModal[\s\S]*?\n}\n/.exec(page)?.[0] || '';
  assert.match(modal, /const c45Label = penalty\.c45Label \|\| 'C45 \(Lương tăng thêm\)'/);
  assert.match(modal, /Chi tiết cách tính phạt · \{c45Label\}/);
  assert.match(modal, /Phạt trừ ở đâu\?/);
  assert.match(modal, /cột lương tăng thêm hằng tháng của bạn/);
  assert.match(modal, /Khi nào bị phạt\? \(4 ngữ cảnh\)/);
  assert.match(modal, /\{tier\.range\}/);
  assert.match(modal, /\{tier\.effect\}/);
  assert.match(modal, /BẠN ĐANG Ở ĐÂY/);
  assert.doesNotMatch(modal, /<span>C45 gốc/, 'không còn nhãn trần "C45 gốc"');
  assert.doesNotMatch(modal, /0,2%|0,3%|90%|70%|50%/, 'mốc %/tỷ lệ không được ghi thẳng vào JSX');
  const styles = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'styles.css'), 'utf8');
  assert.match(styles, /\.employee-cost-penalty-tier\.is-active/);
  assert.match(styles, /\.employee-cost-penalty-c45-note/);
});

test('‼ trần tỷ lệ phạt: gõ 30 thay vì 0,3 bị chặn, trên 1% phải cảnh báo', () => {
  assert.equal(employeePenaltyPolicy.MAX_RATE_PCT, 5);
  assert.equal(employeePenaltyPolicy.RATE_WARN_PCT, 1);
  const base = employeePenaltyPolicy.parametersFromConfig(CONFIG);
  assert.throws(() => employeePenaltyPolicy.normalizeParameters({ ...base, lowerRatePct: 30 }),
    (error) => error.code === 'PENALTY_POLICY_NUMBER_INVALID', 'gõ 30% phải bị chặn cứng');
  assert.throws(() => employeePenaltyPolicy.normalizeParameters({ ...base, upperRatePct: 100 }),
    (error) => error.code === 'PENALTY_POLICY_NUMBER_INVALID');
  // Trong trần thì vẫn cho, quyền quyết vẫn của CEO.
  assert.equal(employeePenaltyPolicy.normalizeParameters({ ...base, lowerRatePct: 2 }).lowerRatePct, 2);
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(routes, /rateWarnings: policyPreview\.rateWarnings \|\| \[\]/, 'preview phải trả cảnh báo ra UI');
  const target = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'pages', 'Target.jsx'), 'utf8');
  assert.match(target, /Kiểm tra lại tỷ lệ phạt/);
  assert.match(target, /preview\.rateWarnings\?\.length/);
});

test('cảnh báo tỷ lệ nói rõ cao gấp mấy lần mức đang áp dụng', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penalty-rate-warn-'));
  const store = employeePenaltyPolicy.createPolicyStore({
    policyFile: path.join(dir, 'policies.json'),
    auditFile: path.join(dir, 'audit.json'),
    now: () => new Date('2026-08-05T00:00:00Z'),
  });
  const base = employeePenaltyPolicy.parametersFromConfig(CONFIG);
  const clean = store.preview({ effectiveFrom: '2026-08', parameters: base }, 'CEO');
  assert.deepEqual(clean.rateWarnings, [], 'mức đang dùng thì không cảnh báo');
  const risky = store.preview({ effectiveFrom: '2026-08', parameters: { ...base, lowerRatePct: 3 } }, 'CEO');
  assert.equal(risky.rateWarnings.length, 1);
  assert.match(risky.rateWarnings[0], /3%/);
  assert.match(risky.rateWarnings[0], /cao gấp 10 lần/);
  assert.match(risky.rateWarnings[0], /dấu phẩy/);
  fs.rmSync(dir, { recursive: true, force: true });
});
