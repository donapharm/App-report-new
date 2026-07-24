'use strict';

const crypto = require('crypto');
const persist = require('./persist');

const PREVIEW_FILE = 'employee_point_notification_preview';
const AUDIT_FILE = 'employee_point_notification_audit';
const AUDIT_LIMIT = 5000;

function normEmp(value) {
  return String(value || '').trim().toUpperCase();
}

function safeText(value, max = 300) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function money(value) {
  const number = Number(value || 0);
  return `${Math.round(number).toLocaleString('vi-VN')}đ`;
}

function num(value) {
  const number = Number(value || 0);
  return number.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

function hashActor(actor) {
  return crypto.createHash('sha256').update(String(actor || '')).digest('hex');
}

function buildMessages({ empCode, empName, period, quarterLabel, pointMonth, pointQuarter, xuMonth, xuQuarterTotal, missingQuarter, penaltyDisplay, pointRuleVersion, xuRuleVersion, quarterStatus, monthsToQuarterEnd, strict }) {
  const employee = [normEmp(empCode), safeText(empName, 120)].filter(Boolean).join(' · ');
  const severity = strict ? 'CẢNH BÁO NGHIÊM KHẮC' : 'THÔNG BÁO';
  const formulaPoint = `Điểm = Σ(doanh thu × hệ số ÷ 100.000.000), làm tròn 2 số.`;
  const formulaXu = 'Xu = tiền bill ÷ 500.000 × tỷ lệ; target xu quý = điểm doanh thu quý; carry 1 quý.';
  const formulaPenalty = 'Phạt = floor(điểm thiếu quý ÷ 2) × 600.000đ.';
  const metrics = `Kỳ ${period} / ${quarterLabel}: điểm tháng ${num(pointMonth)}, điểm quý ${num(pointQuarter)}, xu tháng ${num(xuMonth)}, xu quý ${num(xuQuarterTotal)}, thiếu quý ${num(missingQuarter)}, phạt dự kiến ${money(penaltyDisplay)}.`;
  const timeline = monthsToQuarterEnd > 0
    ? `Còn ${monthsToQuarterEnd} tháng tới cuối quý để khắc phục.`
    : `Đang ở tháng chốt quý: ${quarterStatus}.`;
  const telegram = `${severity}\n${employee}\n${metrics}\n${formulaPoint}\nQuy tắc hệ số: CL/NT/NCL 025-028 = 2.0; còn lại 1.0. Rule điểm: ${pointRuleVersion}.\n${formulaXu} Rule xu: ${xuRuleVersion || 'App VAT'}.\n${formulaPenalty}\nTrạng thái: ${quarterStatus}. ${timeline}`;
  const emailSubject = `${severity} thiếu xu quý ${quarterLabel} — ${normEmp(empCode)}`;
  const emailText = `${telegram}\n\nLưu ý: App Report chỉ preview/thông báo, chưa gửi thật và không tự ghi payroll/DataHub.`;
  return { telegram, emailSubject, emailText };
}

function createPreview({ actor, role, empCode, empName, channel = 'telegram+email', period, quarterLabel, pointMonth, pointQuarter, xuMonth, xuQuarterTotal, missingQuarter, penaltyDisplay, pointRuleVersion, xuRuleVersion, quarterStatus, monthsToQuarterEnd, strict = true }) {
  const preview = {
    id: `epn_${crypto.randomUUID()}`,
    created_at: new Date().toISOString(),
    actor_hash: hashActor(actor),
    actor_role: safeText(role, 32).toLowerCase(),
    emp_code: normEmp(empCode),
    channel: safeText(channel, 40),
    period: safeText(period, 20),
    quarter_label: safeText(quarterLabel, 20),
    outcome: 'preview_only_send_disabled',
    messages: buildMessages({ empCode, empName, period, quarterLabel, pointMonth, pointQuarter, xuMonth, xuQuarterTotal, missingQuarter, penaltyDisplay, pointRuleVersion, xuRuleVersion, quarterStatus, monthsToQuarterEnd, strict }),
    meta: {
      point_month: Number(pointMonth || 0),
      point_quarter: Number(pointQuarter || 0),
      xu_month: Number(xuMonth || 0),
      xu_quarter_total: Number(xuQuarterTotal || 0),
      missing_quarter: Number(missingQuarter || 0),
      penalty_display: Number(penaltyDisplay || 0),
      point_rule_version: safeText(pointRuleVersion, 120),
      xu_rule_version: safeText(xuRuleVersion, 120),
      quarter_status: safeText(quarterStatus, 80),
    },
  };
  const rows = persist.load(PREVIEW_FILE, []);
  rows.push(preview);
  persist.save(PREVIEW_FILE, rows.slice(-500));
  const audit = persist.load(AUDIT_FILE, []);
  audit.push({
    at: preview.created_at,
    actor_hash: preview.actor_hash,
    emp_code: preview.emp_code,
    channel: preview.channel,
    period: preview.period,
    outcome: preview.outcome,
  });
  persist.save(AUDIT_FILE, audit.slice(-AUDIT_LIMIT));
  return preview;
}

module.exports = {
  createPreview,
  hashActor,
};
