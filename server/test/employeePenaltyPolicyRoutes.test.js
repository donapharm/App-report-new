'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
const store = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'web', 'src', 'api.js'), 'utf8');
const target = fs.readFileSync(path.join(root, 'web', 'src', 'pages', 'Target.jsx'), 'utf8');

test('penalty policy routes are admin-read and exact CEO-write only', () => {
  assert.match(routes, /router\.get\('\/admin\/penalty-policies', auth\.requireAuth, auth\.requireAdmin/);
  assert.match(routes, /router\.post\('\/admin\/penalty-policies\/preview', auth\.requireAuth, auth\.requireAdmin, requireCeoPenaltyFormula/);
  assert.match(routes, /router\.post\('\/admin\/penalty-policies', auth\.requireAuth, auth\.requireAdmin, requireCeoPenaltyFormula, asyncJsonRoute/);
  // ‼ SỬA 05/08 — trước đây ghim nguyên câu so chuỗi tại chỗ. Câu đó chỉ nhận
  // `emp_code === 'CEO'`, nên đúng với tài khoản PROD nhưng lại là bản chép thứ tư
  // của cùng một luật. Nay dùng bản chung `auth.isCeoActor`; ý nghĩa không đổi —
  // chỉ CEO ghi được, admin khác vẫn trượt (xem `ceoIdentityGate.test.js`).
  const at = routes.indexOf('const requireCeoPenaltyFormula =');
  assert.ok(at > 0, 'thiếu requireCeoPenaltyFormula');
  assert.match(routes.slice(at, at + 260), /auth\.isCeoActor\(req\.session\)/);
  assert.match(routes, /code: 'PENALTY_POLICY_CEO_REQUIRED'/);
});

test('canonical preview is short-lived, actor/session-bound and save accepts previewId only', () => {
  assert.match(routes, /const sessionKey = String\(req\.session\.th \|\| actor\)/);
  assert.match(routes, /expiresInSeconds: 900/);
  assert.match(routes, /Date\.now\(\) - preview\.at > 15 \* 60 \* 1000/);
  assert.match(routes, /preview\.actor !== actor \|\| preview\.sessionKey !== sessionKey/);
  assert.match(routes, /dataSignature: store\.employeeCostDataSignature\(\)/);
  assert.match(routes, /preview\.dataSignature !== store\.employeeCostDataSignature\(\)/);
  assert.match(routes, /code: 'PENALTY_POLICY_PREVIEW_DATA_CHANGED'/);
  assert.match(routes, /employeePenaltyPolicy\.savePreview\(preview, actor\)/);
  const saveRoute = /router\.post\('\/admin\/penalty-policies',[\s\S]*?\n\}\)\);/.exec(routes)?.[0] || '';
  assert.match(saveRoute, /req\.body\.previewId/);
  assert.doesNotMatch(saveRoute, /req\.body\.parameters|employeePenaltyPolicy\.save\(/);
});

test('preview impact is backend-only, full roster and never reduced in frontend', () => {
  assert.match(routes, /const roster = actionableRosterRows\(\)/);
  assert.match(routes, /employeePenaltyAggregate\.aggregatePenaltySummaries\(currentReports\)/);
  assert.match(routes, /employeePenaltyAggregate\.aggregatePenaltySummaries\(reports\)/);
  assert.match(routes, /suppressAudit: true/);
  assert.match(target, /impact\.candidate/);
  assert.doesNotMatch(target, /\.reduce\([^\n]*(penalty|targetAmount|appliedAmount)/i);
});

test('save invalidates target/employee-cost memo and policy/Xu files participate in data signature', (t) => {
  const saveRoute = /router\.post\('\/admin\/penalty-policies',[\s\S]*?\n\}\)\);/.exec(routes)?.[0] || '';
  assert.match(saveRoute, /clearTargetDependentCache\(\)/);
  assert.match(store, /EMPLOYEE_PENALTY_POLICY_FILE/);
  assert.match(store, /employee_penalty_policies\.json/);
  assert.match(store, /process\.env\.VAT_DB_PATH/);
  assert.match(store, /vat-db-xu-wal/);
  assert.match(store, /vat-db-xu-journal/);

  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'penalty-vat-signature-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const previous = process.env.VAT_DB_PATH;
  const vatDb = path.join(dir, 'vat.db');
  process.env.VAT_DB_PATH = vatDb;
  t.after(() => { if (previous == null) delete process.env.VAT_DB_PATH; else process.env.VAT_DB_PATH = previous; });
  fs.writeFileSync(vatDb, 'db-v1');
  const storeModule = require('../src/store');
  const first = storeModule.employeeCostDataSignature();
  fs.appendFileSync(vatDb, '-v2');
  const second = storeModule.employeeCostDataSignature();
  fs.writeFileSync(`${vatDb}-wal`, 'wal-v1');
  const third = storeModule.employeeCostDataSignature();
  assert.notEqual(second, first);
  assert.notEqual(third, second);
});

test('GET/preview/save are no-store and API/UI expose exact three approval actions', () => {
  assert.match(routes, /router\.get\('\/admin\/penalty-policies'[\s\S]*?Cache-Control', 'private, no-store'/);
  assert.match(routes, /router\.post\('\/admin\/penalty-policies\/preview'[\s\S]*?Cache-Control', 'private, no-store'/);
  assert.match(routes, /router\.post\('\/admin\/penalty-policies'[\s\S]*?Cache-Control', 'private, no-store'/);
  assert.match(api, /adminPenaltyPolicies/);
  assert.match(api, /adminPenaltyPolicyPreview/);
  assert.match(api, /adminPenaltyPolicySave/);
  const panel = /function PenaltyPolicyPanel[\s\S]*?\n}\n\n\/\/ Phải là component cấp module\./.exec(target)?.[0] || '';
  assert.equal((panel.match(/>✅ Duyệt<\/button>/g) || []).length, 1);
  assert.equal((panel.match(/>❌ Không duyệt<\/button>/g) || []).length, 1);
  assert.equal((panel.match(/>📝 Ý kiến khác<\/button>/g) || []).length, 1);
  assert.match(panel, /Mô phỏng toàn đội trước khi lưu/);
  assert.match(panel, /Dùng lại/);
  assert.match(routes, /minEffectiveMonth: \[employeePenaltyPolicy\.MIN_EFFECTIVE_MONTH, employeeCost\.currentMonth\(\)\]/);
  assert.match(panel, /min=\{data\?\.minEffectiveMonth \|\| ''\}/);
  assert.match(panel, /data\?\.minEffectiveMonth > selectedMonth/);
  assert.match(panel, /formulaChanged \? \{ copiedFromVersion: null \}/);
  assert.match(panel, /Object\.prototype\.hasOwnProperty\.call\(patch, 'copiedFromVersion'\)/);
});

test('runtime resolves penalty policy independently by report period and exposes metadata', () => {
  assert.match(routes, /employeePenaltyPolicy\.resolve\(\{ period: range\.to \}\)/);
  assert.match(routes, /const activePenaltyConfig = penaltyConfig \|\| currentPenaltyConfig/);
  assert.match(routes, /formulaVersion: employeeBonus\.FORMULA_VERSION/);
  assert.match(routes, /engineVersion: resolvedPenaltyPolicy\.engineVersion/);
  assert.match(routes, /afterPenaltyTotal: payload\.summary\?\.periodTotal == null \|\| penalty\.appliedAmount == null/);
});
