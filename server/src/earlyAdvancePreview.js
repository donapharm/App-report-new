'use strict';
/**
 * Projection backend-owned cho hộp "Xin nhận sớm".
 *
 * Luật ngày/quota vẫn chỉ nằm trong earlyAdvancePolicy.js. Module này không tự
 * quyết eligibility; nó chỉ ghép kết quả policy với đúng số tiền của installment
 * backend đã dựng và trả chuỗi hoàn chỉnh để frontend render nguyên văn.
 */
const policy = require('./earlyAdvancePolicy');

const INSTALLMENT_KEYS = new Set(['second', 'final']);

function money(value) {
  return Number.isSafeInteger(value) && value >= 0 ? `${value.toLocaleString('vi-VN')}đ` : '—';
}

function shortDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}` : '';
}

function tableButtonLabel(quota = {}) {
  if (quota.code === 'EARLY_TOO_SOON') {
    const earliest = shortDate(quota.earliestDate);
    return earliest ? `Xin nhận sớm · từ ${earliest}` : 'Xin nhận sớm · chưa tới hạn';
  }
  if (quota.code === 'EARLY_QUOTA_USED') return 'Xin nhận sớm · đã hết lượt';
  return 'Xin nhận sớm';
}

function decorateQuotaForTable(quota = {}) {
  return { ...quota, tableButtonLabel: tableButtonLabel(quota) };
}

function unavailablePreview({ period, key, quota, message, code = 'EARLY_PREVIEW_UNAVAILABLE' }) {
  return {
    allowed: false,
    code,
    period: String(period || ''),
    key: String(key || ''),
    message: String(message || 'Chưa lấy được trạng thái xin nhận sớm.'),
    showReasons: false,
    submitDisabled: true,
    submitLabel: 'Không thể gửi xin nhận sớm',
    tableButtonLabel: tableButtonLabel(quota),
    amount: null,
    amountLabel: '—',
    quarter: policy.quarterOf(period),
    earliestDate: String(quota?.earliestDate || ''),
    usedPeriod: String(quota?.usedPeriod || ''),
    warning: null,
  };
}

function buildEarlyAdvancePreview({ period, key, installment, quota } = {}) {
  const month = String(period || '');
  const stepKey = String(key || '');
  if (!INSTALLMENT_KEYS.has(stepKey) || installment?.key !== stepKey) {
    return unavailablePreview({ period: month, key: stepKey, quota, code: 'EARLY_INSTALLMENT_INVALID', message: 'Lần nhận sớm không hợp lệ.' });
  }
  if (!quota || typeof quota !== 'object') {
    return unavailablePreview({ period: month, key: stepKey, quota, message: 'Chưa kiểm tra được lượt ưu tiên.' });
  }

  const amount = Number.isSafeInteger(installment.amount) && installment.amount >= 0 ? installment.amount : null;
  const quarter = policy.quarterOf(month);
  const base = {
    allowed: quota.allowed === true,
    code: String(quota.code || ''),
    period: month,
    key: stepKey,
    message: String(quota.message || ''),
    showReasons: quota.allowed === true,
    submitDisabled: quota.allowed !== true,
    submitLabel: quota.allowed === true
      ? 'Dùng lượt ưu tiên · gửi xin nhận sớm'
      : 'Không thể gửi xin nhận sớm',
    tableButtonLabel: tableButtonLabel(quota),
    amount,
    amountLabel: money(amount),
    quarter,
    earliestDate: String(quota.earliestDate || ''),
    usedPeriod: String(quota.usedPeriod || ''),
    warning: null,
  };

  if (quota.allowed !== true) return base;
  if (amount == null || !quarter) {
    return unavailablePreview({
      period: month,
      key: stepKey,
      quota,
      code: 'EARLY_PREVIEW_AMOUNT_UNAVAILABLE',
      message: 'Chưa lấy được số tiền của lần đang xin — đã dừng để tránh dùng lượt nhầm kỳ.',
    });
  }

  const installmentName = Number.isInteger(installment.index) ? `Lần ${installment.index}` : String(installment.label || 'Lần này');
  return {
    ...base,
    warning: {
      title: `Dùng lượt ưu tiên của quý ${quarter} — mỗi quý chỉ có 1 lượt.`,
      lines: [
        `Kỳ này ${installmentName} là ${money(amount)}.`,
        'Dùng cho kỳ này thì hết lượt cả quý: các kỳ còn lại trong quý sẽ bị chặn, phải chờ đúng hạn. Cân nhắc để dành cho kỳ có số tiền lớn hơn.',
        'Sếp từ chối thì KHÔNG mất lượt — lượt chỉ trừ khi Sếp đồng ý mở khoá.',
      ],
    },
  };
}

module.exports = {
  INSTALLMENT_KEYS,
  money,
  shortDate,
  tableButtonLabel,
  decorateQuotaForTable,
  buildEarlyAdvancePreview,
};
