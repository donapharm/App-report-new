'use strict';
// CEO SỬA ĐƯỢC CẤU HÌNH PHẠT (CEO chốt 2026-07-30).
// CEO: "Nút cấu hình chỉ mới thấy và cấu hình được phần thưởng. Còn phần cấu hình
// phần phạt hiện chưa thao tác được."
//
// Test khoá 3 hàng rào phải còn nguyên khi mở quyền sửa:
//   1. Đi qua tầng đè có preview → lưu → audit; file seed và vân tay không đổi.
//   2. Chỉ tầng chung ("Toàn bộ NV"), không có phạt riêng từng người.
//   3. KHÔNG HỒI TỐ + 4 bậc liền mạch + trần tỷ lệ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const employeeBonus = require('../src/employeeBonus');
const employeePenalty = require('../src/employeePenalty');
const employeeBonusPolicy = require('../src/employeeBonusPolicy');

const SEED = employeeBonus.loadConfig();

function tiers({ dropTo = 50, lowTo = 70, midTo = 90, lowRate = 0.3, midRate = 0.2 } = {}) {
  return [
    { tier: 'drop_c45', fromPct: null, toPct: dropTo, dropC45: true },
    { tier: 't50_70', fromExclusivePct: dropTo, toPct: lowTo, ratePct: lowRate },
    { tier: 't70_90', fromPct: lowTo, toPct: midTo, ratePct: midRate },
    { tier: 'none', fromPct: midTo, toPct: null, ratePct: 0 },
  ];
}

function check(raw, options = {}) {
  return employeePenalty.validatePenaltyOverride(raw, {
    periodMonth: '2026-08', currentMonth: '2026-08', seed: SEED, ...options,
  });
}

test('bậc phạt sửa được khi 4 bậc liền mạch và tỷ lệ trong trần', () => {
  const ok = check({ penaltyTiers: tiers({ dropTo: 55, lowTo: 75, midTo: 95, lowRate: 0.4, midRate: 0.25 }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.penaltyTiers.length, 4);
  assert.equal(ok.patch.penaltyTiers[0].toPct, 55);
  assert.equal(ok.patch.penaltyTiers[1].fromExclusivePct, 55);
  assert.equal(ok.patch.penaltyTiers[3].toPct, null);
});

test('bậc có khe hở / chồng lấn / sai thứ tự bị chặn', () => {
  assert.equal(check({ penaltyTiers: tiers({ dropTo: 50, lowTo: 70, midTo: 90 }).map((tier) => (tier.tier === 't50_70' ? { ...tier, fromExclusivePct: 52 } : tier)) }).reason, 'penalty_tier_gap');
  assert.equal(check({ penaltyTiers: tiers({ dropTo: 80, lowTo: 70, midTo: 90 }) }).reason, 'penalty_tier_order');
  assert.equal(check({ penaltyTiers: tiers().slice(0, 3) }).reason, 'penalty_tiers_count');
  assert.equal(check({ penaltyTiers: tiers().map((tier) => (tier.tier === 'none' ? { ...tier, toPct: 200 } : tier)) }).reason, 'penalty_tier_open_end');
  assert.equal(check({ penaltyTiers: tiers().map((tier) => (tier.tier === 'drop_c45' ? { ...tier, dropC45: false } : tier)) }).reason, 'penalty_tier_drop_flag');
  assert.equal(check({ penaltyTiers: tiers().map((tier) => (tier.tier === 't70_90' ? { ...tier, dropC45: true } : tier)) }).reason, 'penalty_tier_drop_flag');
});

test('tỷ lệ phạt vượt trần, hoặc bậc đạt thấp phạt nhẹ hơn bậc đạt cao, bị chặn', () => {
  assert.equal(check({ penaltyTiers: tiers({ lowRate: 5 }) }).reason, 'penalty_tier_rate');
  assert.equal(check({ penaltyTiers: tiers({ lowRate: -0.1 }) }).reason, 'penalty_tier_rate');
  assert.equal(check({ penaltyTiers: tiers({ lowRate: 0.1, midRate: 0.3 }) }).reason, 'penalty_tier_rate_order');
  assert.equal(check({ penaltyTiers: tiers().map((tier) => (tier.tier === 'none' ? { ...tier, ratePct: 0.1 } : tier)) }).reason, 'penalty_tier_rate');
});

test('KHÔNG HỒI TỐ: không lùi ngày trừ thật về tháng đã chạy; hoãn thì được', () => {
  assert.equal(check({ penaltyEffectiveFrom: '2026-07-01' }, { periodMonth: '2026-08', currentMonth: '2026-08' }).reason, 'penalty_retroactive');
  assert.equal(check({ penaltyWarnFrom: '2026-06-01', penaltyEffectiveFrom: '2026-06-01' }, { periodMonth: '2026-07', currentMonth: '2026-07' }).reason, 'penalty_retroactive');
  assert.equal(check({ penaltyEffectiveFrom: '2026-09-01' }, { periodMonth: '2026-07', currentMonth: '2026-07' }).ok, true);
  // Gửi lại ĐÚNG ngày đang áp dụng (bấm Mô phỏng mà không sửa gì) thì không bị chặn,
  // kể cả khi đã sang tháng sau — nếu chặn thì CEO không mô phỏng nổi dù chưa đổi gì.
  assert.equal(check({ penaltyEffectiveFrom: String(SEED.penaltyEffectiveFrom) }, { periodMonth: '2026-12', currentMonth: '2026-12' }).ok, true);
  // Ngày cảnh báo phải trước hoặc bằng ngày trừ thật.
  assert.equal(check({ penaltyWarnFrom: '2026-10-01', penaltyEffectiveFrom: '2026-09-01' }).reason, 'penalty_date_order');
  assert.equal(check({ penaltyWarnFrom: '01/08/2026' }).reason, 'penalty_date_invalid');
});

test('bật/tắt phạt và phạt thiếu Xu: kiểm tra kiểu và trần số tiền', () => {
  assert.equal(check({ penaltyEnabled: true }).ok, true);
  assert.equal(check({ penaltyEnabled: 'yes' }).reason, 'penalty_enabled_invalid');
  assert.equal(check({ xuPenalty: { enabled: true, perMissingXu: 300000 } }).patch.xuPenalty.perMissingXu, 300000);
  assert.equal(check({ xuPenalty: { enabled: true, perMissingXu: -1 } }).reason, 'xu_penalty_amount');
  assert.equal(check({ xuPenalty: { enabled: true, perMissingXu: 50_000_000 } }).reason, 'xu_penalty_amount');
  assert.equal(check({ xuPenalty: { enabled: 1, perMissingXu: 300000 } }).reason, 'xu_penalty_invalid');
  assert.equal(check({}).reason, 'penalty_patch_empty');
});

test('lưu qua tầng đè: có audit cũ→mới, seed và vân tay KHÔNG đổi, buildPenalty ăn số mới', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penalty-policy-'));
  const store = employeeBonusPolicy.createPolicyStore({
    policyFile: path.join(dir, 'policies.json'),
    auditFile: path.join(dir, 'audit.json'),
  });
  const seedBefore = fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8');
  const lockBefore = fs.readFileSync(path.join(__dirname, '..', 'config', 'bonus_formula_lock.json'), 'utf8');

  const preview = store.preview({
    effectiveFrom: '2026-08', previewPeriod: '2026-08', scope: { type: 'default', value: '*' },
    currentMonth: '2026-08', note: 'CEO nâng bậc nhẹ lên 0,25%',
    patch: { penaltyTiers: tiers({ midRate: 0.25 }) },
  }, 'CEO');
  assert.equal(preview.resolved.config.penaltyTiers.find((tier) => tier.tier === 't70_90').ratePct, 0.25);
  // Preview CHƯA ghi gì.
  assert.equal(store.list().length, 0);

  const saved = store.savePreview(preview, 'CEO');
  assert.equal(store.list().length, 1);
  assert.equal(saved.resolved.config.penaltyTiers.find((tier) => tier.tier === 't70_90').ratePct, 0.25);
  const event = store.audit()[0];
  assert.equal(event.actor, 'CEO');
  assert.equal(event.beforeConfig.penaltyTiers.find((tier) => tier.tier === 't70_90').ratePct, 0.2);
  assert.equal(event.afterConfig.penaltyTiers.find((tier) => tier.tier === 't70_90').ratePct, 0.25);

  // Số tiền phạt tính theo cấu hình sau khi đè, KHÔNG phải theo seed.
  const penalty = employeePenalty.buildPenalty({
    period: '2026-08', target: 1_000_000_000, achieved: 800_000_000,
    c45Amount: 10_000_000, costTotal: 50_000_000, config: saved.resolved.config,
  });
  assert.equal(penalty.mode, 'enforced');
  assert.equal(penalty.tier, 't70_90');
  assert.equal(penalty.targetAmount, Math.round(800_000_000 * 0.25 / 100));

  // Hàng rào quan trọng nhất: file gốc + vân tay không bị đụng khi CEO sửa qua UI.
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'), seedBefore);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'config', 'bonus_formula_lock.json'), 'utf8'), lockBefore);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('phạt là chính sách chung: chặn đè bậc phạt cho riêng một nhân viên', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penalty-policy-scope-'));
  const store = employeeBonusPolicy.createPolicyStore({
    policyFile: path.join(dir, 'policies.json'),
    auditFile: path.join(dir, 'audit.json'),
  });
  assert.throws(() => store.preview({
    effectiveFrom: '2026-08', scope: { type: 'employee', value: 'DN001' },
    patch: { penaltyTiers: tiers({ midRate: 0 }) },
  }, 'CEO'), (error) => error.code === 'PENALTY_POLICY_SCOPE_INVALID');
  assert.equal(employeeBonusPolicy.PENALTY_LAYERS.length, 1);
  assert.equal(employeeBonusPolicy.PENALTY_LAYERS[0], 'default');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('route cấu hình phạt: preview không ghi, lưu phải khớp preview và xoá cache', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  const previewRoute = /router\.post\('\/admin\/penalty-policies\/preview'[\s\S]*?\n\}\)\);/.exec(routes)?.[0] || '';
  const saveRoute = /router\.post\('\/admin\/penalty-policies',[\s\S]*?\n\}\);/.exec(routes)?.[0] || '';
  assert.match(previewRoute, /auth\.requireAuth, auth\.requireAdmin/);
  assert.match(previewRoute, /scope: \{ type: 'default', value: '\*' \}/, 'preview phạt luôn ở tầng chung');
  assert.doesNotMatch(previewRoute, /savePreview|save\(/, 'preview tuyệt đối không được ghi');
  assert.match(previewRoute, /before: penaltyPolicySnapshot[\s\S]*after: penaltyPolicySnapshot/, 'phải trả bậc trước→sau');
  assert.match(saveRoute, /auth\.requireAuth, auth\.requireAdmin/);
  assert.match(saveRoute, /penaltyPolicyPreviews\.get\(previewId\)/);
  assert.match(saveRoute, /preview\.actor !== actor/, 'preview phải thuộc đúng phiên');
  assert.match(saveRoute, /employeeBonusPolicy\.savePreview\(preview, actor\);\s*\n\s*clearTargetDependentCache\(\);/);
});

test('giao diện Quản target có ô nhập + nút mô phỏng/lưu cấu hình phạt', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'pages', 'Target.jsx'), 'utf8');
  const panel = /function PenaltyPolicyPanel[\s\S]*?\n}\n/.exec(page)?.[0] || '';
  assert.match(panel, /api\.adminPenaltyPolicyPreview/);
  assert.match(panel, /api\.adminPenaltyPolicySave/);
  assert.match(panel, /Mô phỏng trước khi lưu/);
  assert.match(panel, /Lưu đúng bản đã mô phỏng/);
  assert.match(panel, /Bậc trước khi sửa[\s\S]*Bậc sau khi sửa/, 'phải cho CEO đối chiếu cũ→mới trước khi lưu');
  // Không còn thẻ "không sửa được ở đây".
  assert.doesNotMatch(panel, /Vì sao không sửa được bậc phạt ở đây/);
  // Nút Lưu chỉ mở sau khi có preview — không cho lưu vo.
  assert.match(panel, /disabled=\{busy \|\| !editable \|\| !preview\?\.previewId \|\| preview\?\.saved\}/);
  // Mốc %/hậu quả trên bảng vẫn do backend sinh, frontend không tự viết.
  const table = /function PenaltyTierTable[\s\S]*?\n}\n/.exec(page)?.[0] || '';
  assert.match(table, /\{tier\.range\}/);
  assert.match(table, /\{tier\.effect\}/);
  assert.doesNotMatch(page, /Trừ 0,2% doanh thu|Trừ 0,3% doanh thu/);
});
