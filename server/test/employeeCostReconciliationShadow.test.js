'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checksum } = require('../src/appSaleReconShadowV3');
const { projectEmployeeCostRows } = require('../src/employeeCostReconciliationShadow');

function matched(overrides = {}) {
  const row = {
    reconciliation_line_id: 'r1', row_ordinal: 1, period: '2026-07', contractor_code: 'NT1', unit_code: 'U',
    product_code: 'P', product_name: null, uom: null, confirmation_id: 'confirm-1', confirmed_by: 'VP018',
    confirmed_at: '2026-08-09T00:00:00.987Z', confirmation_provenance: 'ACCOUNTING_RECON_IMMUTABLE_CONFIRMATION',
    match_status: 'MATCHED', match_reason: 'EXACT', source_system: 'sale', immutable_order_id: 'i1',
    immutable_order_code: 'SO-1', immutable_source_line_id: 'line-1', canonical_employee_code: 'VP018',
    identity_candidate_count: 1, reverse_candidate_count: 1, quantity: '12.5', matched_order_quantity: '13', quantity_delta: '-0.5',
    unit_price: '10', source_amount: '105', source_amount_basis: 'INCLUDING_VAT', amount_excluding_vat: '100',
    amount_including_vat: '105', quantity_price_amount_delta: '0', amount_validation_status: 'OK', amount_rounding_tolerance: '0.01',
    currency: 'VND', rounding_mode: 'HALF_AWAY_FROM_ZERO_2DP', vat_basis: 'INCLUDING_VAT', vat_rate: '5', vat_divisor: '1.05',
    vat_source: 'invoice.vat', vat_missing_reason: null, cost_candidate_status: 'READY', cost_candidate_reason: 'EXACT_POLICY',
    cost_policy_version: 4, cost_policy_checksum: 'b'.repeat(64), c32_base_amount: '100', c47_total_candidate_amount: '14',
  };
  for (let code = 33; code <= 46; code += 1) row[`c${code}_candidate_amount`] = '1';
  return { ...row, ...overrides };
}
function envelope(rows) {
  const sum = checksum(rows);
  const contractorCode = rows[0]?.contractor_code || 'NT1';
  return {
    contract: 'app-sale-reconciliation-shadow-v3', shadow_only: true, effective_values_changed: false,
    period: '2026-07', contractor_code: contractorCode, reconciliation_version: 7, reconciliation_rows_checksum_v2: 'a'.repeat(64), shadow_snapshot_version: 2,
    shadow_snapshot_checksum: sum, immutable_version: 2, immutable_checksum: sum, rows,
  };
}
const source = { sourceLineId: 'line-1', orderCode: 'SO-1', employeeCode: 'VP018', rowMonthlyTotal: 99, c33: 1, revenue: 500 };

test('exact immutable one-to-one match projects exactly two additive values', () => {
  const [row] = projectEmployeeCostRows([source], envelope([matched()]));
  assert.equal(row.shadowReconciledQuantity, 12.5);
  assert.equal(row.shadowQuantityDelta, -0.5);
  assert.equal(row.rowMonthlyTotal, 99);
  assert.equal(row.c33, 1);
  assert.equal(row.revenue, 500);
  assert.deepEqual(Object.keys(row).filter((key) => key.startsWith('shadow')), ['shadowReconciledQuantity', 'shadowQuantityDelta']);
  assert.equal(JSON.stringify(row).includes('candidate'), false);
  assert.equal(JSON.stringify(row).includes('policyChecksum'), false);
});

test('unmatched, ambiguous, duplicate or partial identities fail closed without name guessing', () => {
  for (const bad of [
    matched({ match_status: 'UNMATCHED' }), matched({ match_status: 'AMBIGUOUS' }), matched({ match_status: 'MISMATCH' }),
    matched({ immutable_source_line_id: null }), matched({ identity_candidate_count: 2 }), matched({ reverse_candidate_count: 2 }),
  ]) assert.equal(projectEmployeeCostRows([source], envelope([bad]))[0].shadowReconciledQuantity, null);
  const duplicate = [matched(), matched({ reconciliation_line_id: 'r2', row_ordinal: 2 })];
  assert.equal(projectEmployeeCostRows([source], envelope(duplicate))[0].shadowReconciledQuantity, null);
  assert.equal(projectEmployeeCostRows([source, { ...source, employeeName: 'same name' }], envelope([matched()]))[0].shadowReconciledQuantity, null);
  assert.equal(projectEmployeeCostRows([{ ...source, employeeCode: '', employeeName: 'VP018' }], envelope([matched()]))[0].shadowReconciledQuantity, null);
});

test('invalid envelope and checksum mismatch fail closed', () => {
  for (const bad of [
    { shadow_only: false }, { effective_values_changed: true }, { reconciliation_version: 0 },
    { immutable_version: 3 }, { immutable_checksum: 'c'.repeat(64) }, { shadow_snapshot_checksum: 'd'.repeat(64) },
  ]) assert.equal(projectEmployeeCostRows([source], { ...envelope([matched()]), ...bad })[0].shadowReconciledQuantity, null);
});

test('real employee-cost path deduplicates each scope, projects exact matches and preserves financial outputs', async () => {
  const employeeCost = require('../src/employeeCost');
  const shadow = require('../src/employeeCostReconciliationShadow');
  shadow.resetCacheForTests();
  const revenueRows = [
    { emp_code: 'VP018', unit_code: 'U', iit_code: 'P', revenue: 105, quantity: 13, order_code: 'SO-1', source_line_id: 'line-1', contractor_code: '20.hđs' },
    { emp_code: 'VP018', unit_code: 'U', iit_code: 'P', revenue: 210, quantity: 20, order_code: 'SO-2', source_line_id: 'line-2', contractor_code: '20.HĐS' },
  ];
  const costPayload = {
    empCode: 'VP018', columns: [{ key: 'c36', pos: 36, label: 'Cost' }],
    rows: [{ c5: 'P', c7: 'U', c16: 'Product', c25: 'Box', c36: 10 }],
  };
  const common = {
    baseUrl: 'http://hub.test', assignmentKey: 'assignment-service-key', employeeCostKeys: 'VP018=employee-secret-key-vp018',
    backoffMs: [], period: '07.2026', catalogRows: [{ c5: 'P', c7: 'U', c16: 'Product' }], revenueRows,
    auditImpl: () => {}, fetchImpl: async () => ({ ok: true, status: 200, json: async () => costPayload }),
  };
  const session = { scope: { empCode: 'VP018' }, session: { emp_code: 'VP018', role: 'sale' } };
  const baseline = await employeeCost.getForSession(session, common);
  let calls = 0;
  const snapshot = envelope([
    matched({ contractor_code: '20.HĐS' }),
    matched({ contractor_code: '20.HĐS', reconciliation_line_id: 'r2', row_ordinal: 2, immutable_order_id: 'i2', immutable_order_code: 'SO-2', immutable_source_line_id: 'line-2', quantity: '20', matched_order_quantity: '20', quantity_delta: '0' }),
  ]);
  const actual = await employeeCost.getForSession(session, {
    ...common,
    reconciliationShadow: {
      baseUrl: 'https://sale.invalid', key: 'secondary-credential-value', cacheTtlMs: 60_000,
      loadSnapshotImpl: async ({ period, contractorCode }) => {
        calls += 1;
        assert.equal(period, '2026-07');
        assert.equal(contractorCode, '20.HĐS');
        return snapshot;
      },
    },
  });
  assert.equal(calls, 1, 'two report rows in one period+contractor use one pinned snapshot');
  assert.deepEqual(actual.rows.map((row) => [row.shadowReconciledQuantity, row.shadowQuantityDelta]), [[12.5, -0.5], [20, 0]]);
  /* `remoteProvenance` là LAI LỊCH của gói lấy qua mạng (bot audit đợt 17), không phải
   * số tiền: nó ghi version/checksum/confirmed_at của đúng những gói đã dùng để tính, để
   * lượt mở con dấu sau soi lại được. Nguồn đổi 12,5 → 9,5 mà không file nào trên đĩa
   * nhúc nhích thì đây là thứ DUY NHẤT phát hiện ra. Loại khỏi phép so "không được sửa
   * số", rồi kiểm riêng ngay bên dưới — bỏ qua im lặng mới là nới lỏng. */
  const boSieuDuLieu = (payload) => JSON.parse(JSON.stringify(payload), (key, value) => (
    key.startsWith('shadow') || key === 'remoteProvenance' || key === 'remoteProvenanceFailures' ? undefined : value));
  assert.deepEqual(boSieuDuLieu(actual), boSieuDuLieu(baseline), 'connector cannot mutate costs, summaries, KPI or revenue');
  assert.ok(Array.isArray(actual.remoteProvenance),
    'phải GHI LẠI lai lịch gói từ xa — thiếu trường này thì `isSealable` fail-closed và không kỳ nào đóng dấu được');
  for (const dong of actual.remoteProvenance) {
    assert.match(String(dong), /^[^:]+:[^:]+:rv=\d+:rc=[a-f0-9]{64}:ca=\S+:av=(\d+|khong-co):ac=([a-f0-9]{64}|khong-co)$/,
      `lai lịch phải đủ version + checksum + confirmed_at để so lại được, đang là: ${dong}`);
  }
});

test('real path leaves nulls on upstream failure and ambiguous identity without breaking the report', async () => {
  const employeeCost = require('../src/employeeCost');
  const shadow = require('../src/employeeCostReconciliationShadow');
  const revenueRows = [{ emp_code: 'VP018', unit_code: 'U', iit_code: 'P', revenue: 105, order_code: 'SO-1', source_line_id: 'line-1', contractor_code: 'NT1' }];
  const options = {
    baseUrl: '', period: '07.2026', catalogRows: [{ c5: 'P', c7: 'U' }], revenueRows, auditImpl: () => {},
    reconciliationShadow: { baseUrl: 'https://sale.invalid', key: 'secondary-credential-value', errorTtlMs: 100 },
  };
  const subject = { scope: { empCode: 'VP018' }, session: { emp_code: 'VP018', role: 'sale' } };
  shadow.resetCacheForTests();
  const failed = await employeeCost.getForSession(subject, {
    ...options, reconciliationShadow: { ...options.reconciliationShadow, loadSnapshotImpl: async () => { throw new Error('upstream down'); } },
  });
  assert.equal(failed.rows.length, 1);
  assert.equal(failed.rows[0].shadowReconciledQuantity, null);
  shadow.resetCacheForTests();
  const duplicate = [matched(), matched({ reconciliation_line_id: 'r2', row_ordinal: 2 })];
  const ambiguous = await employeeCost.getForSession(subject, {
    ...options, reconciliationShadow: { ...options.reconciliationShadow, loadSnapshotImpl: async () => envelope(duplicate) },
  });
  assert.equal(ambiguous.rows[0].shadowReconciledQuantity, null);
  assert.equal(ambiguous.rows[0].shadowQuantityDelta, null);

  shadow.resetCacheForTests();
  const missingImmutableLine = await employeeCost.getForSession(subject, {
    ...options,
    revenueRows: [{ ...revenueRows[0], source_line_id: undefined }],
    reconciliationShadow: { ...options.reconciliationShadow, loadSnapshotImpl: async () => envelope([matched()]) },
  });
  assert.equal(missingImmutableLine.rows[0].sourceLineId, 'line-1', 'display fallback remains stable');
  assert.equal(missingImmutableLine.rows[0].shadowReconciledQuantity, null, 'synthetic display id is never trusted as immutable identity');
});


test('scope loader deduplicates in-flight/cache entries and bounds independent upstream calls', async () => {
  const shadow = require('../src/employeeCostReconciliationShadow');
  shadow.resetCacheForTests();
  let calls = 0;
  let active = 0;
  let peak = 0;
  const options = {
    baseUrl: 'https://sale.invalid', key: 'secondary-credential-value', concurrency: 2, cacheTtlMs: 60_000,
    loadSnapshotImpl: async ({ contractorCode }) => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      const rows = [matched({ contractor_code: contractorCode })];
      return { ...envelope(rows), contractor_code: contractorCode };
    },
  };
  const scopes = ['NT1', 'NT1', 'NT2', 'NT3'].map((contractorCode) => ({ period: '2026-07', contractorCode }));
  const [first, concurrent] = await Promise.all([
    shadow.loadScopes(scopes, options),
    shadow.loadScopes([{ period: '2026-07', contractorCode: 'NT1' }], options),
  ]);
  assert.equal(first.size, 3);
  assert.equal(concurrent.size, 1);
  assert.equal(calls, 3, 'one upstream load per unique period+contractor across overlapping calls');
  assert.ok(peak <= 2, `bounded concurrency exceeded: ${peak}`);
  await shadow.loadScopes(scopes, options);
  assert.equal(calls, 3, 'successful pinned snapshots are reused from bounded TTL cache');
});

test('missing upstream scope records only safe period, scope and allowlisted reason', async () => {
  const shadow = require('../src/employeeCostReconciliationShadow');
  shadow.resetCacheForTests();
  const diagnostics = new Map();
  const result = await shadow.loadScopes([{ period: '2026-07', contractorCode: '03.TUE.N' }], {
    baseUrl: 'https://sale.invalid', key: 'secondary-credential-value', diagnostics,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ privatePayload: 'must-not-leak' }) }),
    loadSnapshotImpl: async ({ fetchImpl }) => {
      const response = await fetchImpl('https://sale.invalid/private');
      if (!response.ok) throw new Error('private upstream body must not persist');
      return null;
    },
  });
  assert.equal(result.get('2026-07\u001f03.TUE.N'), null);
  assert.deepEqual([...diagnostics], [['2026-07\u001f03.TUE.N', 'upstream_not_found']]);
  assert.doesNotMatch(JSON.stringify([...diagnostics]), /private|must-not-leak|sale\.invalid/);
});
