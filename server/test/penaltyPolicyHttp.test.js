'use strict';
// HTTP THẬT cho 3 route cấu hình phạt (bổ sung theo review 2026-07-30).
//
// Review đúng một điểm: `penaltyPolicyEditable.test.js` phần route chỉ đọc mã nguồn
// bằng regex — nó chứng minh "mã có viết đúng câu đó", KHÔNG chứng minh "gọi thật
// thì chặn thật". File này gọi qua HTTP với middleware quyền thật để khoá 4 việc:
//   1. Chỉ CEO/admin vào được; NV thường bị 403; không token bị 401.
//   2. Preview KHÔNG ghi gì.
//   3. previewId dùng MỘT LẦN; lần hai phải 409.
//   4. previewId của phiên người khác KHÔNG dùng được (session binding).
// Ghi vào file tạm qua biến môi trường, không đụng dữ liệu tầng đè thật.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'penalty-http-'));
process.env.EMPLOYEE_BONUS_POLICY_FILE = path.join(DIR, 'policies.json');
process.env.EMPLOYEE_BONUS_POLICY_AUDIT_FILE = path.join(DIR, 'audit.json');

const express = require('express');
const auth = require('../src/auth');
const routes = require('../src/routes');
const employeeBonusPolicy = require('../src/employeeBonusPolicy');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', routes);
const server = http.createServer(app);
let base = '';

function tokenFor(empCode, role) {
  // Phát token thật qua auth để đi đúng middleware requireAuth/requireAdmin.
  return auth.issueToken({ emp_code: empCode, role, name: empCode });
}

async function call(method, url, { token = '', body = null } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text };
}

const TIERS = [
  { tier: 'drop_c45', fromPct: null, toPct: 50, dropC45: true },
  { tier: 't50_70', fromExclusivePct: 50, toPct: 70, ratePct: 0.32 },
  { tier: 't70_90', fromPct: 70, toPct: 90, ratePct: 0.2 },
  { tier: 'none', fromPct: 90, toPct: null, ratePct: 0 },
];
const PERIOD = '08.2026';
const previewBody = (patch = { penaltyTiers: TIERS }) => ({ period: PERIOD, effectiveFrom: PERIOD, patch, note: 'http test' });

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => {
  server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('không token / NV thường KHÔNG chạm được cấu hình phạt', async () => {
  const salesToken = tokenFor('DN001', 'sale');
  for (const [method, url, body] of [
    ['GET', `/admin/bonus-policies?period=${PERIOD}`, null],
    ['POST', '/admin/penalty-policies/preview', previewBody()],
    ['POST', '/admin/penalty-policies', { previewId: 'x', period: PERIOD }],
  ]) {
    assert.equal((await call(method, url, { body })).status, 401, `${url} phải 401 khi không có token`);
    assert.equal((await call(method, url, { token: salesToken, body })).status, 403, `${url} phải 403 với NV sale`);
  }
});

test('GET trả bảng bậc + giới hạn sửa cho CEO', async () => {
  const result = await call('GET', `/admin/bonus-policies?period=${PERIOD}`, { token: tokenFor('CEO', 'ceo') });
  assert.equal(result.status, 200);
  const penalty = result.json.penalty;
  assert.equal(penalty.c45Label, 'C45 (Lương tăng thêm)');
  assert.equal(penalty.tiers.length, 4);
  assert.deepEqual(penalty.layers, ['default']);
  assert.match(String(penalty.earliestEffectiveFrom), /^\d{4}-\d{2}-01$/);
  assert.match(String(result.json.formulaVersion), /^v\d+\.\d+$/);
});

test('preview KHÔNG ghi gì và trả bậc trước→sau', async () => {
  const before = employeeBonusPolicy.list().length;
  const result = await call('POST', '/admin/penalty-policies/preview', { token: tokenFor('CEO', 'ceo'), body: previewBody() });
  assert.equal(result.status, 200);
  assert.ok(result.json.previewId);
  assert.equal(result.json.saved, false);
  assert.match(result.json.before.tiers.find((tier) => tier.tier === 't50_70').effect, /0,3%/);
  assert.match(result.json.after.tiers.find((tier) => tier.tier === 't50_70').effect, /0,32%/);
  assert.equal(employeeBonusPolicy.list().length, before, 'preview không được ghi thêm bản nào');
});

test('preview dùng MỘT LẦN: lưu lần hai bằng cùng previewId phải 409', async () => {
  const token = tokenFor('CEO', 'ceo');
  const preview = await call('POST', '/admin/penalty-policies/preview', { token, body: previewBody() });
  const previewId = preview.json.previewId;
  const first = await call('POST', '/admin/penalty-policies', { token, body: { previewId, period: PERIOD } });
  assert.equal(first.status, 200);
  assert.equal(first.json.saved, true);
  assert.match(first.json.after.tiers.find((tier) => tier.tier === 't50_70').effect, /0,32%/);
  const second = await call('POST', '/admin/penalty-policies', { token, body: { previewId, period: PERIOD } });
  assert.equal(second.status, 409, 'previewId đã dùng thì không được dùng lại');
  assert.equal(second.json.code, 'PENALTY_POLICY_PREVIEW_REQUIRED');
});

test('previewId của người khác / của phiên khác KHÔNG lưu được', async () => {
  const ceoToken = tokenFor('CEO', 'ceo');
  const otherAdminToken = tokenFor('ADMIN', 'admin');
  const preview = await call('POST', '/admin/penalty-policies/preview', { token: ceoToken, body: previewBody() });
  const stolen = await call('POST', '/admin/penalty-policies', {
    token: otherAdminToken, body: { previewId: preview.json.previewId, period: PERIOD },
  });
  assert.equal(stolen.status, 409, 'admin khác không được lưu preview của CEO');
  // Phiên KHÁC của CHÍNH CEO cũng không lưu được: buộc theo phiên, không chỉ theo mã.
  const ceoOtherSession = tokenFor('CEO', 'ceo');
  const otherSession = await call('POST', '/admin/penalty-policies', { token: ceoOtherSession, body: { previewId: preview.json.previewId, period: PERIOD } });
  assert.equal(otherSession.status, 409, 'phiên khác của cùng người dùng cũng phải bị chặn');
  // Và preview gốc KHÔNG bị "đốt" oan bởi lần gọi sai — chủ của nó vẫn lưu được.
  const own = await call('POST', '/admin/penalty-policies', { token: ceoToken, body: { previewId: preview.json.previewId, period: PERIOD } });
  assert.equal(own.status, 200, 'người lạ gọi sai không được làm mất preview hợp lệ của CEO');
});

test('lưu xong GET phải trả NGAY bậc mới (đã xoá cache)', async () => {
  const token = tokenFor('CEO', 'ceo');
  const patch = { penaltyTiers: TIERS.map((tier) => (tier.tier === 't70_90' ? { ...tier, ratePct: 0.21 } : tier)) };
  const preview = await call('POST', '/admin/penalty-policies/preview', { token, body: previewBody(patch) });
  await call('POST', '/admin/penalty-policies', { token, body: { previewId: preview.json.previewId, period: PERIOD } });
  const after = await call('GET', `/admin/bonus-policies?period=${PERIOD}`, { token });
  assert.match(after.json.penalty.tiers.find((tier) => tier.tier === 't70_90').effect, /0,21%/);
});

test('HTTP cũng chặn hồi tố và bậc sai — không chỉ chặn ở tầng hàm', async () => {
  const token = tokenFor('CEO', 'ceo');
  const retro = await call('POST', '/admin/penalty-policies/preview', {
    token, body: previewBody({ penaltyWarnFrom: '2026-06-01', penaltyEffectiveFrom: '2026-06-01' }),
  });
  assert.equal(retro.status, 400);
  assert.equal(retro.json.code, 'PENALTY_POLICY_PENALTY_RETROACTIVE');
  const gap = await call('POST', '/admin/penalty-policies/preview', {
    token, body: previewBody({ penaltyTiers: TIERS.map((tier) => (tier.tier === 't50_70' ? { ...tier, fromExclusivePct: 55 } : tier)) }),
  });
  assert.equal(gap.status, 400);
  assert.equal(gap.json.code, 'PENALTY_POLICY_PENALTY_TIER_GAP');
});

test('mỗi lần lưu ghi audit cũ→mới, không ghi đè bản trước', async () => {
  const rows = employeeBonusPolicy.audit();
  assert.ok(rows.length >= 3, `phải còn đủ lịch sử các lần lưu, đang có ${rows.length}`);
  assert.equal(rows[0].action, 'bonus_policy_saved');
  assert.ok(rows[0].beforeConfig.penaltyTiers.length, 'audit phải giữ cấu hình TRƯỚC khi sửa');
  assert.ok(rows[0].afterConfig.penaltyTiers.length, 'audit phải giữ cấu hình SAU khi sửa');
  const versions = rows.map((row) => row.version);
  assert.equal(new Set(versions).size, versions.length, 'mỗi lần lưu là một version riêng');
});
