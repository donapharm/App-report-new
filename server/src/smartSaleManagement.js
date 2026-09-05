'use strict';

const crypto = require('crypto');
const analytics = require('./analytics');
const salesReport = require('./salesReport');

const KINDS = new Set(['day', 'week', 'month']);
const roundMoney = (value) => Math.round(Number(value || 0));
const percentage = (value, total) => total > 0 ? +(value / total * 100).toFixed(1) : null;

function attentionFor(item) {
  const out = [];
  if (!item.target_assigned) out.push('TARGET_MISSING');
  else if (item.target_pct != null && item.target_pct < 70) out.push('BELOW_TARGET');
  if (item.trend_pct != null && item.trend_pct <= -15) out.push('REVENUE_DROPPING');
  if (!item.channels.telegram && !item.channels.email) out.push('NO_DELIVERY_CHANNEL');
  return out;
}

async function buildPreview({ kind = 'day', ranges } = {}, deps = {}) {
  if (!KINDS.has(kind)) {
    const error = new Error('Loại bản tin không hợp lệ.');
    error.code = 'SMART_SALE_KIND_INVALID'; error.status = 400; throw error;
  }
  const report = deps.salesReport || salesReport;
  const vatDivisor = Number(deps.vatDivisor || analytics.VAT_DIVISOR || 1.05);
  const resolvedRanges = ranges || report.defaultRanges();
  const recipients = report.salesRecipients();
  if (!recipients.length) {
    const error = new Error('Danh sách nhân viên nhận báo cáo đang rỗng; chưa thể dựng bản điều hành.');
    error.code = 'SMART_SALE_ROSTER_EMPTY'; error.status = 503; throw error;
  }
  const employees = [];
  for (const recipient of recipients) {
    const data = await report.computeReport({ empCode: recipient.code, kind, ranges: resolvedRanges, includeCst: false });
    const revenueAfterVat = roundMoney(data.revenue);
    const revenueBeforeVat = roundMoney(revenueAfterVat / vatDivisor);
    const target = roundMoney(data.target);
    const item = {
      emp_code: recipient.code,
      revenue_after_vat: revenueAfterVat,
      revenue_before_vat: revenueBeforeVat,
      target,
      target_assigned: target > 0,
      target_pct: percentage(revenueBeforeVat, target),
      target_remaining: target > 0 ? Math.max(0, target - revenueBeforeVat) : null,
      trend_pct: data.prevRevenue > 0 ? +((data.revenue - data.prevRevenue) / data.prevRevenue * 100).toFixed(1) : null,
      score_pct: data.score?.ty_le_quy ?? null,
      provisional: true,
      channels: { telegram: !!recipient.telegramId, email: !!recipient.email },
      actions: [
        data.diffsUnit?.down?.[0]?.key ? `RECOVER_UNIT:${data.diffsUnit.down[0].key}` : null,
        data.topProducts?.[0]?.key ? `PROTECT_PRODUCT:${data.topProducts[0].key}` : null,
      ].filter(Boolean),
    };
    item.attention = attentionFor(item);
    employees.push(item);
  }
  employees.sort((a, b) => (a.target_pct ?? -1) - (b.target_pct ?? -1));
  const range = kind === 'day' ? resolvedRanges.dayRange : kind === 'month' ? resolvedRanges.monthRange : resolvedRanges.weekRange;
  const totalAfterVat = employees.reduce((sum, item) => sum + item.revenue_after_vat, 0);
  const totalBeforeVat = employees.reduce((sum, item) => sum + item.revenue_before_vat, 0);
  const totalTarget = employees.reduce((sum, item) => sum + item.target, 0);
  const preview = {
    schema: 'smart-sale-management-preview-v1', mode: 'shadow_read_only', send_enabled: false, schedule_applied: false,
    shadow_plan: { required_days: 3, completed_days: 0, status: 'NOT_STARTED' }, kind, range, as_of: resolvedRanges.asOf,
    money_basis: {
      revenue_after_vat: 'Doanh thu sau VAT từ nguồn App Report hiện hành',
      revenue_before_vat: `Doanh thu trước VAT = sau VAT / ${vatDivisor}`,
      target: 'Target trước VAT',
      cost_bonus_penalty: 'Chưa ghép cho tới khi nguồn chi phí đáng tin cậy trả đủ; không suy diễn số.',
    },
    ceo: {
      employee_count: employees.length, revenue_after_vat: totalAfterVat, revenue_before_vat: totalBeforeVat,
      target: totalTarget, target_pct: percentage(totalBeforeVat, totalTarget),
      attention_count: employees.filter((item) => item.attention.length > 0).length,
      reachable_count: employees.filter((item) => item.channels.telegram || item.channels.email).length,
    },
    employees,
  };
  preview.preview_digest = crypto.createHash('sha256').update(JSON.stringify(preview)).digest('hex');
  return preview;
}

module.exports = { buildPreview, attentionFor };
