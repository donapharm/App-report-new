'use strict';

const REVENUE_PARTNER_POLICY_ID = 'PARTNER_TOKEN_INVOICE_V1';
const PARTNER_EXCLUSION_REASONS = Object.freeze({
  MANUAL_ZALO_CHUA_XAC_NHAN: 'MANUAL_ZALO_CHUA_XAC_NHAN',
  CHUA_XAC_NHAN_DOI_TAC: 'CHUA_XAC_NHAN_DOI_TAC',
  CHUA_XUAT_HOA_DON: 'CHUA_XUAT_HOA_DON',
});

function monthOrdinal(ky, label = 'KY') {
  const match = String(ky || '').trim().match(/^(0[1-9]|1[0-2])\.(\d{4})$/);
  if (!match) throw new Error(`INVALID_${label}:${ky || ''}`);
  return Number(match[2]) * 12 + Number(match[1]) - 1;
}

function partnerConfirmationRuleActive(periodKy, effectiveFrom) {
  if (!String(effectiveFrom || '').trim()) {
    throw new Error('MISSING_REVENUE_RULE_EFFECTIVE_FROM');
  }
  return monthOrdinal(periodKy, 'REVENUE_PERIOD')
    >= monthOrdinal(effectiveFrom, 'REVENUE_RULE_EFFECTIVE_FROM');
}

function cleanInvoiceNo(value) {
  return String(value || '').trim();
}

function invoiceIdentity(value) {
  return cleanInvoiceNo(value).replace(/\s+/g, '').toUpperCase();
}

function matchingMonthlyInvoiceDate(invoiceNo, monthlyInvoices = []) {
  const identity = invoiceIdentity(invoiceNo);
  if (!identity) return null;
  const dates = monthlyInvoices
    .filter((invoice) => invoiceIdentity(invoice?.invoiceNo) === identity)
    .map((invoice) => String(invoice?.invoiceDate || '').trim())
    .filter(Boolean)
    .sort();
  return dates.at(-1) || null;
}

// App Sale can persist invoice numbers on the response line, an item-mapped
// invoice header, or an order-level header. Header evidence is valid only when
// it belongs to the exact token of the latest partner response.
function partnerInvoiceNumber(row) {
  const lineInvoice = cleanInvoiceNo(row?.invoiceNo);
  if (lineInvoice) return lineInvoice;
  if (row?.tokenId == null) return '';
  const tokenId = String(row.tokenId);
  for (const invoice of [...(row?.itemInvoices || []), ...(row?.orderInvoices || [])]) {
    if (invoice?.tokenId != null && String(invoice.tokenId) === tokenId) {
      const invoiceNo = cleanInvoiceNo(invoice.invoiceNo);
      if (invoiceNo) return invoiceNo;
    }
  }
  return '';
}

// Pure mirror of the SQL eligibility gate, kept for fixture-based regression tests.
// Before the configured effective month, the legacy materializer behavior is frozen.
function partnerRevenueEligible(row, { periodKy, effectiveFrom }) {
  if (Number(row?.deliveredQty || 0) <= 0) return false;
  if (!partnerConfirmationRuleActive(periodKy, effectiveFrom)) return true;
  return partnerRevenueExclusionReason(row, { periodKy, effectiveFrom }) === null;
}

function partnerRevenueExclusionReason(row, { periodKy, effectiveFrom }) {
  if (Number(row?.deliveredQty || 0) <= 0) return null;
  if (!partnerConfirmationRuleActive(periodKy, effectiveFrom)) return null;
  if (String(row?.responseSource || '').trim().toLowerCase() === 'manual_zalo') {
    return PARTNER_EXCLUSION_REASONS.MANUAL_ZALO_CHUA_XAC_NHAN;
  }
  if (row?.tokenId == null) return PARTNER_EXCLUSION_REASONS.CHUA_XAC_NHAN_DOI_TAC;
  if (partnerInvoiceNumber(row) === '') return PARTNER_EXCLUSION_REASONS.CHUA_XUAT_HOA_DON;
  return null;
}

function partnerRevenueEffectiveDate(row, { periodKy, effectiveFrom }) {
  const ruleActive = partnerConfirmationRuleActive(periodKy, effectiveFrom);
  const hasInvoice = ruleActive
    ? partnerInvoiceNumber(row) !== ''
    : cleanInvoiceNo(row?.invoiceNo) !== '';
  if (hasInvoice) {
    const invoiceDate = ruleActive
      ? matchingMonthlyInvoiceDate(partnerInvoiceNumber(row), row?.monthlyInvoices)
      : row?.monthlyInvoiceDate || null;
    return invoiceDate || row?.respondedDate || row?.updatedDate || null;
  }
  if (row?.hasResponse) return row?.respondedDate || row?.updatedDate || null;
  if (Number(row?.monthlyDeliveredQty || 0) > 0) return row?.monthlyInvoiceDate || null;
  return null;
}

module.exports = {
  REVENUE_PARTNER_POLICY_ID,
  PARTNER_EXCLUSION_REASONS,
  monthOrdinal,
  partnerConfirmationRuleActive,
  invoiceIdentity,
  matchingMonthlyInvoiceDate,
  partnerInvoiceNumber,
  partnerRevenueEligible,
  partnerRevenueExclusionReason,
  partnerRevenueEffectiveDate,
};
