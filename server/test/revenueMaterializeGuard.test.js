const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRevenueCandidate } = require('../src/revenueMaterializeGuard');

const goodSlot = {
  id: 'rev-good',
  active: true,
  ky: '07.2026',
  totalRows: 1847,
  totalRevenue: 28457691443,
  sourceRunId: '262',
  sourceSummary: {
    CRM_MISA: { rows: 1310, orders: 495, revenue: 19075894863 },
    APP_WEB_PARTNER: { rows: 537, orders: 318, revenue: 9381796580 },
  },
};

function candidate(patch = {}) {
  return {
    ky: '07.2026',
    totalRows: 1859,
    totalRevenue: 28575193243,
    sourceRunId: '270',
    sourceSummary: {
      CRM_MISA: { rows: 1319, orders: 501, revenue: 19171667663 },
      APP_WEB_PARTNER: { rows: 540, orders: 320, revenue: 9403525580 },
    },
    ...patch,
  };
}

const codes = (result) => result.reasons.map((reason) => reason.code);

test('first materialization is allowed without a comparable active slot', () => {
  assert.equal(evaluateRevenueCandidate({ previousSlot: null, candidate: candidate() }).ok, true);
  assert.equal(evaluateRevenueCandidate({ previousSlot: null, candidate: {
    ky: '08.2026', totalRows: 0, totalRevenue: 0, sourceRunId: '300', sourceSummary: {},
  } }).ok, true, 'a new period may legitimately start with no sales');
});

test('candidate totals and source summary must be internally consistent even without a baseline', () => {
  const malformed = evaluateRevenueCandidate({
    previousSlot: null,
    candidate: { ky: '08.2026', totalRows: 'bad', totalRevenue: 10, sourceRunId: '300', sourceSummary: {} },
  });
  assert.equal(malformed.ok, false);
  assert.deepEqual(codes(malformed), ['CANDIDATE_TOTALS_INVALID', 'SOURCE_SUMMARY_INCONSISTENT']);
});

test('normal growth and a small correction remain allowed', () => {
  assert.equal(evaluateRevenueCandidate({ previousSlot: goodSlot, candidate: candidate() }).ok, true);
  assert.equal(evaluateRevenueCandidate({ previousSlot: goodSlot, candidate: candidate({
    totalRows: 1800,
    totalRevenue: 28000000000,
    sourceSummary: {
      CRM_MISA: { rows: 1265, orders: 490, revenue: 18600000000 },
      APP_WEB_PARTNER: { rows: 535, orders: 316, revenue: 9400000000 },
    },
  }) }).ok, true);
});

test('reproduces 29/07 13:00 race and rejects the candidate when CRM MISA disappears', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: 537,
      totalRevenue: 9381796580,
      sourceRunId: '263',
      sourceSummary: {
        APP_WEB_PARTNER: { rows: 537, orders: 318, revenue: 9381796580 },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), [
    'SOURCE_DISAPPEARED',
    'TOTAL_REVENUE_ABRUPT_DROP',
    'TOTAL_ROWS_ABRUPT_DROP',
  ]);
  assert.equal(result.reasons[0].source, 'CRM_MISA');
});

test('source disappearance is rejected even if another source masks the total drop', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: 1900,
      totalRevenue: 29000000000,
      sourceSummary: {
        APP_WEB_PARTNER: { rows: 1900, orders: 900, revenue: 29000000000 },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['SOURCE_DISAPPEARED']);
});

test('abrupt aggregate revenue or row loss is rejected at the 70% boundary', () => {
  const lowRevenue = goodSlot.totalRevenue * 0.69;
  const revenueDrop = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRevenue: lowRevenue,
      sourceSummary: {
        CRM_MISA: { rows: 1319, orders: 501, revenue: lowRevenue - 9403525580 },
        APP_WEB_PARTNER: { rows: 540, orders: 320, revenue: 9403525580 },
      },
    }),
  });
  const lowRows = Math.floor(goodSlot.totalRows * 0.69);
  const rowDrop = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: lowRows,
      sourceSummary: {
        CRM_MISA: { rows: lowRows - 540, orders: 300, revenue: 19171667663 },
        APP_WEB_PARTNER: { rows: 540, orders: 320, revenue: 9403525580 },
      },
    }),
  });
  assert.deepEqual(codes(revenueDrop), ['TOTAL_REVENUE_ABRUPT_DROP']);
  assert.deepEqual(codes(rowDrop), ['TOTAL_ROWS_ABRUPT_DROP']);
});

test('snapshot changing during source reads is rejected', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({ sourceRunId: '270', sourceRunIdAfterRead: '271' }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['SOURCE_SNAPSHOT_CHANGED_DURING_READ']);
});

test('a present source with rows and zero net revenue is not treated as disappeared', () => {
  const result = evaluateRevenueCandidate({
    previousSlot: goodSlot,
    candidate: candidate({
      totalRows: 1900,
      totalRevenue: 29000000000,
      sourceSummary: {
        CRM_MISA: { rows: 1300, orders: 480, revenue: 0 },
        APP_WEB_PARTNER: { rows: 600, orders: 350, revenue: 29000000000 },
      },
    }),
  });
  assert.equal(result.ok, true);
});

test('an older MISA run cannot replace a newer active slot', () => {
  const result = evaluateRevenueCandidate({ previousSlot: goodSlot, candidate: candidate({ sourceRunId: '261' }) });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['STALE_MISA_RUN']);
});
