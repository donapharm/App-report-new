'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  stableWebIdentity,
  inspectActiveSlots,
  inspectOtherActiveSlots,
  evaluateExistingActivePeriods,
  evaluateCandidateAgainstActivePeriods,
} = require('../src/revenueCrossPeriodWebGuard');

function tempUploads() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-cross-period-web-'));
}

function writeSlot(uploadsDir, { id, ky, rows, active = true }) {
  const bytes = Buffer.from(`${JSON.stringify(rows, null, 2)}\n`);
  fs.writeFileSync(path.join(uploadsDir, `${id}.json`), bytes);
  return {
    id,
    ky,
    active,
    totalRows: rows.length,
    payloadSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

test('canonical WEB identity is numeric and MISA identities are outside this guard', () => {
  assert.equal(stableWebIdentity({ source_line_id: 'web:000382' }), 'WEB:382');
  assert.equal(stableWebIdentity({ source_line_id: 'MISA:382' }), null);
  assert.equal(stableWebIdentity({ source_line_id: 'WEB:not-a-number' }), null);
});

test('HOLD_GOLIVE response/status change cannot move the same WEB order item from active T07 into candidate T08', () => {
  const uploadsDir = tempUploads();
  try {
    const t07Rows = [{
      source: 'APP_WEB_PARTNER',
      source_line_id: 'WEB:382',
      source_order: 'DH-HOLD-382',
      order_status: 'HOLD_GOLIVE',
      response_status: 'waiting',
      revenue: 12_500_000,
    }];
    const t07 = writeSlot(uploadsDir, { id: 'active-t07', ky: '07.2026', rows: t07Rows });
    const before = fs.readFileSync(path.join(uploadsDir, 'active-t07.json'));
    const inspection = inspectOtherActiveSlots({ slots: [t07], candidateKy: '08.2026', uploadsDir });
    const result = evaluateCandidateAgainstActivePeriods({
      candidateKy: '08.2026',
      activeInspection: inspection,
      rows: [{
        source: 'APP_WEB_PARTNER',
        source_line_id: 'WEB:382',
        source_order: 'DH-HOLD-382',
        order_status: 'APPROVED',
        response_status: 'delivered',
        revenue: 12_500_000,
      }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'cross_period_web_duplicate');
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.duplicates[0].identity, 'WEB:382');
    assert.equal(result.duplicates[0].activeKy, '07.2026');
    assert.equal(result.duplicates[0].candidateKy, '08.2026');
    assert.match(result.decision, /REJECT_CANDIDATE_KEEP_EXISTING_PERIOD_AUTHORITATIVE_DO_NOT_AUTO_SELECT/);
    assert.deepEqual(fs.readFileSync(path.join(uploadsDir, 'active-t07.json')), before, 'audit guard never changes authoritative T07');
    assert.deepEqual(fs.readdirSync(uploadsDir), ['active-t07.json'], 'rejected T08 creates no payload');
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('candidate may retain its current-period WEB identity when no other active period contains it', () => {
  const uploadsDir = tempUploads();
  try {
    const current = writeSlot(uploadsDir, {
      id: 'active-t08', ky: '08.2026',
      rows: [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:88', revenue: 100 }],
    });
    const inspection = inspectActiveSlots({ slots: [current], candidateKy: '08.2026', uploadsDir });
    const result = evaluateCandidateAgainstActivePeriods({
      rows: [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:88', revenue: 100 }],
      candidateKy: '08.2026',
      activeInspection: inspection,
    });
    assert.equal(result.ok, true);
    assert.equal(result.checkedActiveSlots, 0);
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('an already duplicated WEB identity in two active periods stops every materialization without choosing a period', () => {
  const uploadsDir = tempUploads();
  try {
    const t06 = writeSlot(uploadsDir, {
      id: 'active-t06', ky: '06.2026',
      rows: [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:77', revenue: 100 }],
    });
    const t07 = writeSlot(uploadsDir, {
      id: 'active-t07', ky: '07.2026',
      rows: [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:77', revenue: 100 }],
    });
    const inspection = inspectActiveSlots({
      slots: [t06, t07], candidateKy: '08.2026', uploadsDir,
    });
    const result = evaluateExistingActivePeriods(inspection);
    assert.equal(result.ok, false);
    assert.equal(result.duplicateCount, 1);
    assert.deepEqual(result.duplicates[0].periods, ['06.2026', '07.2026']);
    assert.match(result.decision, /STOP_AND_REPORT_DO_NOT_AUTO_SELECT_PERIOD/);
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('same numeric ID in MISA is preserved and does not trigger the WEB-only guard', () => {
  const uploadsDir = tempUploads();
  try {
    const slot = writeSlot(uploadsDir, {
      id: 'active-t07',
      ky: '07.2026',
      rows: [{ source: 'CRM_MISA', source_line_id: 'MISA:382', revenue: 100 }],
    });
    const inspection = inspectOtherActiveSlots({ slots: [slot], candidateKy: '08.2026', uploadsDir });
    const result = evaluateCandidateAgainstActivePeriods({
      rows: [{ source: 'CRM_MISA', source_line_id: 'MISA:382', revenue: 100 }],
      candidateKy: '08.2026',
      activeInspection: inspection,
    });
    assert.equal(result.ok, true);
    assert.equal(result.candidateWebRows, 0);
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('malformed active slot payload fails closed instead of claiming no cross-period WEB duplicate', () => {
  const uploadsDir = tempUploads();
  try {
    fs.writeFileSync(path.join(uploadsDir, 'broken-t07.json'), '{ definitely not JSON');
    assert.throws(
      () => inspectOtherActiveSlots({
        slots: [{ id: 'broken-t07', ky: '07.2026', active: true }],
        candidateKy: '08.2026',
        uploadsDir,
      }),
      (error) => error.code === 'CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_JSON_INVALID'
        && error.details.slotId === 'broken-t07'
        && error.details.ky === '07.2026',
    );
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('missing/unreadable active slot payload fails closed with slot and period details', () => {
  const uploadsDir = tempUploads();
  try {
    assert.throws(
      () => inspectOtherActiveSlots({
        slots: [{ id: 'missing-t07', ky: '07.2026', active: true }],
        candidateKy: '08.2026',
        uploadsDir,
      }),
      (error) => error.code === 'CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_UNREADABLE'
        && error.details.slotId === 'missing-t07'
        && error.details.ky === '07.2026',
    );
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('active payload hash mismatch is unverifiable and fails closed', () => {
  const uploadsDir = tempUploads();
  try {
    const slot = writeSlot(uploadsDir, {
      id: 'active-t07',
      ky: '07.2026',
      rows: [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:10' }],
    });
    slot.payloadSha256 = '0'.repeat(64);
    assert.throws(
      () => inspectOtherActiveSlots({ slots: [slot], candidateKy: '08.2026', uploadsDir }),
      (error) => error.code === 'CROSS_PERIOD_WEB_ACTIVE_PAYLOAD_HASH_MISMATCH',
    );
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('payload change during slow source read produces a different verified active-slot snapshot', () => {
  const uploadsDir = tempUploads();
  try {
    const slot = writeSlot(uploadsDir, {
      id: 'active-t07',
      ky: '07.2026',
      rows: [{ source: 'APP_WEB_PARTNER', source_line_id: 'WEB:10', revenue: 100 }],
    });
    // Simulate a legacy slot without a pinned payload hash. The guard still hashes
    // actual bytes in both snapshots, so an out-of-band replacement is detected.
    delete slot.payloadSha256;
    const before = inspectOtherActiveSlots({ slots: [slot], candidateKy: '08.2026', uploadsDir });
    fs.writeFileSync(path.join(uploadsDir, 'active-t07.json'), `${JSON.stringify([
      { source: 'APP_WEB_PARTNER', source_line_id: 'WEB:11', revenue: 100 },
    ], null, 2)}\n`);
    const after = inspectOtherActiveSlots({ slots: [slot], candidateKy: '08.2026', uploadsDir });
    assert.notEqual(after.snapshotSha256, before.snapshotSha256);
    assert.notDeepEqual(after.snapshot, before.snapshot);
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('materializer runs cross-period guard before unchanged return, candidate write, and active-slot deactivation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'materialize_july_revenue.js'), 'utf8');
  const baselineSnapshotAt = source.indexOf('baselineCrossPeriodWebInspection = inspectActiveSlots');
  const slowReadAt = source.indexOf('} = await readSourceSnapshot()');
  const recheckAt = source.indexOf('const commitCrossPeriodWebInspection = inspectActiveSlots');
  const existingGuardAt = source.indexOf('const existingActiveGuard = evaluateExistingActivePeriods');
  const candidateGuardAt = source.indexOf('const crossPeriodWebGuard = evaluateCandidateAgainstActivePeriods');
  const rejectAt = source.indexOf('if (!materializeGuard.ok)', candidateGuardAt);
  const unchangedGateAt = source.indexOf('const identity = await equivalentToActiveSlot', candidateGuardAt);
  const unchangedReturnAt = source.indexOf('return unchanged', unchangedGateAt);
  const payloadWriteAt = source.indexOf('writeJson(file, rows)', candidateGuardAt);
  const deactivateAt = source.indexOf('s.active = false', candidateGuardAt);

  assert.ok(baselineSnapshotAt >= 0 && baselineSnapshotAt < slowReadAt, 'other active periods are snapshotted before slow source read');
  assert.ok(recheckAt > slowReadAt && existingGuardAt > recheckAt && candidateGuardAt > existingGuardAt,
    'all active periods are re-read, checked against each other, then candidate-compared after source read');
  assert.ok(rejectAt > candidateGuardAt && unchangedGateAt > rejectAt, 'cross-period rejection happens before unchanged evaluation');
  assert.ok(unchangedReturnAt > unchangedGateAt, 'unchanged return remains explicit');
  assert.ok(payloadWriteAt > unchangedReturnAt, 'no candidate payload write can precede cross-period guard or unchanged return');
  assert.ok(deactivateAt > payloadWriteAt, 'active slot deactivation occurs only after guarded candidate payload write');
  assert.match(source, /CROSS_PERIOD_WEB_EXISTING_ACTIVE_DUPLICATE/);
  assert.match(source, /CROSS_PERIOD_WEB_IDENTITY_DUPLICATE/);
  assert.match(source, /decision: crossPeriodWebGuard\.decision/);
});
