'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APP_SALE_REVENUE_MIRROR_ID,
  APP_SALE_RELEASE,
  APP_SALE_SOURCE_SHA256,
  APP_SALE_CATALOG_GUARD_SHA256,
  SQL_SHA256,
  LATEST_MISA_RUN_SQL,
  CRM_KPI_SQL,
  CRM_ROWS_SQL,
  PARTNER_KPI_SQL,
  PARTNER_ROWS_SQL,
  validateCatalogMarker,
  latestMisaRun,
  fetchCrmMirror,
  fetchPartnerMirror,
  transitionEvidenceDigest,
} = require('../src/appSaleRevenueMirror');

const EXPECTED_SQL_SHA256 = Object.freeze({
  latestMisaRun: '886111ffbc8f051b46505b4a87575c2e199a16dbeefc846a821caa59dcc6536e',
  crmKpi: 'cc7cc1b4770a042216b7ddaace096d117b8694816ce06abcd9f625db3e115d8e',
  crmRows: '37e90ec4770253968be8ac607c1326495f200dcc88a22fa5a322ba919af888e5',
  partnerCommon: '63933894cc84cc3713c59e90bed95e94491d401509c73a3b17ec5069aaa51e3e',
  partnerKpi: 'fb7564348fcef05fad6f4581e0c9e6422f28b5bed676d3e377f804daa570097f',
  partnerRows: '720a82d3fde1aec90727465b1e97ffd7c7d5b4673bb50648dd96a28584695e2d',
});

test('App Sale PROD provenance and exact SQL digests are pinned', () => {
  assert.equal(APP_SALE_REVENUE_MIRROR_ID, 'APP_SALE_REVENUE_KPI_SQL_0E820022');
  assert.equal(APP_SALE_RELEASE, '0e820022814ef8a7f24d47c082446f3e40b17ebe');
  assert.equal(APP_SALE_SOURCE_SHA256, '3b065456ed1e25b553c0554b97900a0ea2d89a17e9b487bfc5663fad14c220e0');
  assert.equal(APP_SALE_CATALOG_GUARD_SHA256, 'eece0ab6cdd4317993578d21e910b2aafae5140be48d2c168defe3c203673bf2');
  assert.deepEqual(SQL_SHA256, EXPECTED_SQL_SHA256);
});

test('latest MISA run mirrors App Sale month coverage and date parameter ordering', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 337 }] }; } };
  const run = await latestMisaRun('2026-08-01', '2026-08-03', db);
  assert.equal(run.id, 337);
  assert.deepEqual(calls, [{ sql: LATEST_MISA_RUN_SQL, params: ['2026-08-01', '2026-08-03'] }]);
  assert.match(LATEST_MISA_RUN_SQL, /period_month=date_trunc\('month',\$1::date\)::date/);
  assert.match(LATEST_MISA_RUN_SQL, /from_date <= \$2::date/);
  assert.match(LATEST_MISA_RUN_SQL, /to_date >= \$1::date/);
});

test('CRM KPI and projection use the same run and date scope', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql === CRM_KPI_SQL) return { rows: [{ rows: 2, orders: 1, amount: '150' }] };
    if (sql === CRM_ROWS_SQL) return { rows: [{ id: 1 }, { id: 2 }] };
    throw new Error('unexpected SQL');
  } };
  const out = await fetchCrmMirror(337, '2026-08-01', '2026-08-03', db);
  assert.deepEqual(out.kpi, { rows: 2, orders: 1, revenue: 150 });
  assert.equal(out.rows.length, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(call.params, [337, '2026-08-01', '2026-08-03']);
});

test('partner KPI and row projection share one catalog version/date scope', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql === PARTNER_KPI_SQL) return { rows: [{
      delivered_orders: 1, delivered_amount: '90', total_placed_amount: '120',
      no_response_amount: '20', debt_amount: '10', partition_total: '120', delta: '0',
      excluded_cancelled_orders: 2, excluded_cancelled_amount: '30',
    }] };
    if (sql === PARTNER_ROWS_SQL) return { rows: [{ order_item_id: 1 }, { order_item_id: 2 }] };
    throw new Error('unexpected SQL');
  } };
  const out = await fetchPartnerMirror(31, '2026-08-01', '2026-08-03', db);
  assert.deepEqual(out.kpi, {
    rows: 2, orders: 1, revenue: 90, totalPlaced: 120, noResponse: 20, debt: 10,
    partition: 120, delta: 0, excludedCancelledOrders: 2, excludedCancelledAmount: 30,
  });
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(call.params, [31, '2026-08-01', '2026-08-03']);
});

test('catalog marker validation is fail-closed for drift, ambiguity and low coverage', () => {
  const state = { versionNo: 31, signature: '31:5000:epoch' };
  const marker = { versionNo: 31, signature: state.signature, pairs: 2000, sourceRows: 2001, unmappedRows: 1, conflictPairs: 0 };
  assert.deepEqual(validateCatalogMarker({ state, marker, tablePairs: 2000 }), {
    versionNo: 31, pairs: 2000, sourceRows: 2001, unmappedRows: 1, conflictPairs: 0,
  });
  for (const bad of [
    { marker: { ...marker, versionNo: 30 }, tablePairs: 2000 },
    { marker: { ...marker, signature: 'tampered' }, tablePairs: 2000 },
    { marker: { ...marker, pairs: 999, sourceRows: 999 }, tablePairs: 999 },
    { marker: { ...marker, conflictPairs: 1 }, tablePairs: 2000 },
    { marker: { ...marker, unmappedRows: 11 }, tablePairs: 2000 },
    { marker, tablePairs: 1999 },
  ]) assert.equal(validateCatalogMarker({ state, ...bad }), null);
});

test('transition evidence digest binds App Sale provenance, SQL, date axes and full partner KPI', () => {
  const proof = {
    version: 1,
    mirrorId: APP_SALE_REVENUE_MIRROR_ID,
    appSaleRelease: APP_SALE_RELEASE,
    appSaleSourceSha256: APP_SALE_SOURCE_SHA256,
    catalogGuardSha256: APP_SALE_CATALOG_GUARD_SHA256,
    ky: '08.2026', from: '2026-08-01', to: '2026-08-31', timeZone: 'Asia/Bangkok',
    dateFields: { crm: 'misa_revenue_snapshot_lines.sale_order_date', partner: 'orders.created_at' },
    sourceRunId: '337', dbSnapshot: '100:100:', snapshotCapturedAt: '2026-08-03T09:33:56.632Z',
    catalogVersionNo: 31, sqlSha256: SQL_SHA256,
    projectionDigests: { misa: '1'.repeat(64), partner: '2'.repeat(64), includedTotal: '3'.repeat(64) },
    crm: { rows: 210, orders: 53, revenue: 1340385772 },
    partner: { rows: 74, orders: 41, revenue: 743639000 },
    partnerKpi: { rows: 74, orders: 41, revenue: 743639000, totalPlaced: 1, noResponse: 2, debt: 3, partition: 6, delta: 0 },
    includedTotal: { rows: 284, orders: 94, revenue: 2084024772 },
  };
  const base = transitionEvidenceDigest(proof);
  assert.match(base, /^[a-f0-9]{64}$/);
  for (const mutation of [
    { from: '2026-08-02' },
    { appSaleSourceSha256: '0'.repeat(64) },
    { sqlSha256: { ...SQL_SHA256, partnerKpi: '0'.repeat(64) } },
    { projectionDigests: { ...proof.projectionDigests, partner: '0'.repeat(64) } },
    { partnerKpi: { ...proof.partnerKpi, debt: 4 } },
    { includedTotal: { ...proof.includedTotal, revenue: proof.includedTotal.revenue + 1 } },
  ]) assert.notEqual(transitionEvidenceDigest({ ...proof, ...mutation }), base);
});
