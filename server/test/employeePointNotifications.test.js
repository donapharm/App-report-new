const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notifications = require('../src/employeePointNotifications');
const persist = require('../src/persist');

const persistDir = persist.DIR;
const previewPath = path.join(persistDir, 'employee_point_notification_preview.json');
const auditPath = path.join(persistDir, 'employee_point_notification_audit.json');

function cleanup() {
  for (const file of [previewPath, auditPath]) {
    try { fs.unlinkSync(file); } catch {}
  }
}

test.beforeEach(() => cleanup());
test.afterEach(() => cleanup());

test('preview creates Telegram+email content, stores preview-only audit, and excludes recipient/body from audit log', () => {
  const preview = notifications.createPreview({
    actor: 'DN001',
    role: 'admin',
    empCode: 'DN016',
    empName: 'Trần Thị Ngọc Ánh',
    period: '2026-09',
    quarterLabel: 'Q3/2026',
    pointMonth: 1.5,
    pointQuarter: 4.5,
    xuMonth: 1,
    xuQuarterTotal: 3,
    missingQuarter: 1.5,
    penaltyDisplay: 0,
    pointRuleVersion: 'point-local-2026-05-r1',
    xuRuleVersion: 'xu-v2026-05-r1',
    quarterStatus: 'đang đối soát',
    monthsToQuarterEnd: 0,
    strict: true,
  });
  assert.equal(preview.outcome, 'preview_only_send_disabled');
  assert.match(preview.messages.telegram, /CẢNH BÁO NGHIÊM KHẮC/);
  assert.match(preview.messages.telegram, /Điểm = Σ\(doanh thu × hệ số ÷ 100\.000\.000\)/);
  assert.match(preview.messages.telegram, /Rule điểm: point-local-2026-05-r1/);
  assert.match(preview.messages.emailText, /chưa gửi thật/);
  const audit = persist.load('employee_point_notification_audit', []);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].emp_code, 'DN016');
  assert.equal(typeof audit[0].actor_hash, 'string');
  assert.equal(audit[0].actor_hash.length > 10, true);
  assert.equal(JSON.stringify(audit[0]).includes('Trần Thị Ngọc Ánh'), false);
  assert.equal(JSON.stringify(audit[0]).includes('CẢNH BÁO'), false);
});
