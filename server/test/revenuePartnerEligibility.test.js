const test = require('node:test');
const assert = require('node:assert/strict');

const {
  partnerConfirmationRuleActive,
  invoiceIdentity,
  matchingMonthlyInvoiceDate,
  partnerInvoiceNumber,
  partnerRevenueEligible,
  partnerRevenueExclusionReason,
  partnerRevenueEffectiveDate,
  PARTNER_EXCLUSION_REASONS,
} = require('../src/revenuePartnerEligibility');

const effectiveFrom = '08.2026';

test('partner confirmation rule starts exactly at T08/2026', () => {
  assert.equal(partnerConfirmationRuleActive('06.2026', effectiveFrom), false);
  assert.equal(partnerConfirmationRuleActive('07.2026', effectiveFrom), false);
  assert.equal(partnerConfirmationRuleActive('08.2026', effectiveFrom), true);
  assert.equal(partnerConfirmationRuleActive('09.2026', effectiveFrom), true);
});

test('missing or malformed effective-from config fails closed', () => {
  assert.throws(
    () => partnerConfirmationRuleActive('08.2026', ''),
    /MISSING_REVENUE_RULE_EFFECTIVE_FROM/,
  );
  assert.throws(
    () => partnerConfirmationRuleActive('08.2026', '2026-08'),
    /INVALID_REVENUE_RULE_EFFECTIVE_FROM/,
  );
});

test('T08 excludes unconfirmed manual_zalo rows without pinning a stale live total', () => {
  const context = { periodKy: '08.2026', effectiveFrom };
  const row = { deliveredQty: 1, revenue: 11_840_400, tokenId: null, responseSource: 'manual_zalo', invoiceNo: '' };
  assert.equal(partnerRevenueEligible(row, context), false);
  assert.equal(partnerRevenueExclusionReason(row, context),
    PARTNER_EXCLUSION_REASONS.MANUAL_ZALO_CHUA_XAC_NHAN);
});

test('T08 accepts only direct partner-token confirmation with invoice evidence from that same token', () => {
  const context = { periodKy: '08.2026', effectiveFrom };
  assert.equal(partnerRevenueExclusionReason({ deliveredQty: 2, tokenId: null, responseSource: null }, context),
    PARTNER_EXCLUSION_REASONS.CHUA_XAC_NHAN_DOI_TAC);
  assert.equal(partnerRevenueExclusionReason({ deliveredQty: 2, tokenId: 92, responseSource: null, invoiceNo: '' }, context),
    PARTNER_EXCLUSION_REASONS.CHUA_XUAT_HOA_DON);
  assert.equal(partnerRevenueEligible({ deliveredQty: 2, tokenId: 91, responseSource: null, invoiceNo: 'HD-01' }, context), true);
  assert.equal(partnerRevenueEligible({ deliveredQty: 2, tokenId: null, responseSource: 'manual_zalo', invoiceNo: 'HD-02' }, context), false);
  assert.equal(partnerRevenueEligible({ deliveredQty: 2, tokenId: 92, responseSource: null, invoiceNo: '' }, context), false);
  assert.equal(partnerRevenueEligible({ deliveredQty: 0, tokenId: 93, responseSource: null, invoiceNo: 'HD-03' }, context), false);

  const crossToken = {
    deliveredQty: 2,
    tokenId: 102,
    responseSource: null,
    itemInvoices: [{ tokenId: 101, invoiceNo: 'OLD-HD' }],
    orderInvoices: [{ tokenId: 100, invoiceNo: 'OLDER-HD' }],
  };
  assert.equal(partnerInvoiceNumber(crossToken), '');
  assert.equal(partnerRevenueEligible(crossToken, context), false,
    'a latest response must never inherit invoice evidence from an older token');

  assert.equal(partnerRevenueEligible({
    ...crossToken,
    itemInvoices: [{ tokenId: 102, invoiceNo: 'ITEM-HD' }],
  }, context), true);
  assert.equal(partnerRevenueEligible({
    ...crossToken,
    orderInvoices: [{ tokenId: 102, invoiceNo: 'ORDER-HD' }],
  }, context), true);
});

test('invoice-date axis accepts only the same normalized invoice identity', () => {
  const base = {
    tokenId: 77,
    itemInvoices: [{ tokenId: 77, invoiceNo: ' hd - 77 ' }],
    hasResponse: true,
    respondedDate: '2026-08-05',
    updatedDate: '2026-08-06',
  };
  assert.equal(invoiceIdentity(' hd - 77 '), 'HD-77');
  assert.equal(matchingMonthlyInvoiceDate('HD-77', [
    { invoiceNo: 'OLD-HD', invoiceDate: '2026-07-31' },
    { invoiceNo: ' hd - 77 ', invoiceDate: '2026-08-03' },
  ]), '2026-08-03');
  assert.equal(partnerRevenueEffectiveDate({ ...base, monthlyInvoices: [
    { invoiceNo: 'OLD-HD', invoiceDate: '2026-07-31' },
    { invoiceNo: 'HD-77', invoiceDate: '2026-08-03' },
  ] }, { periodKy: '08.2026', effectiveFrom }), '2026-08-03');
  assert.equal(partnerRevenueEffectiveDate({ ...base, monthlyInvoices: [
    { invoiceNo: 'OLD-HD', invoiceDate: '2026-08-01' },
  ] }, { periodKy: '08.2026', effectiveFrom }), '2026-08-05',
  'a different/old-token invoice date must never be borrowed; confirmation date is the fallback');
  assert.equal(partnerRevenueEffectiveDate(base, {
    periodKy: '08.2026', effectiveFrom,
  }), '2026-08-05', 'App Sale invoice headers have no invoice_date, so confirmation date is the approved fallback');
});

test('T07 and T06 freeze their exact legacy totals before the effective month', () => {
  const fixtures = {
    '07.2026': [
      { deliveredQty: 1, revenue: 2_152_974_290, tokenId: null, responseSource: 'manual_zalo', invoiceNo: '' },
      { deliveredQty: 1, revenue: 28_764_918_383, tokenId: null, responseSource: null, invoiceNo: '' },
    ],
    '06.2026': [
      { deliveredQty: 1, revenue: 28_403_136_096, tokenId: null, responseSource: 'manual_zalo', invoiceNo: '' },
    ],
  };
  const expected = { '07.2026': 30_917_892_673, '06.2026': 28_403_136_096 };
  for (const [periodKy, rows] of Object.entries(fixtures)) {
    const total = rows
      .filter((row) => partnerRevenueEligible(row, { periodKy, effectiveFrom }))
      .reduce((sum, row) => sum + row.revenue, 0);
    assert.equal(total, expected[periodKy]);
  }
});
