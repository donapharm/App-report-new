'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(serverRoot, 'scripts', 'materialize_july_revenue.js'), 'utf8');
const mirrorSource = fs.readFileSync(path.join(serverRoot, 'src', 'appSaleRevenueMirror.js'), 'utf8');
const transitionSafetySource = fs.readFileSync(path.join(serverRoot, 'src', 'revenueTransitionSafety.js'), 'utf8');
const uploadSource = fs.readFileSync(path.join(serverRoot, 'src', 'upload.js'), 'utf8');
const legacySource = fs.readFileSync(path.join(serverRoot, 'scripts', 'import_legacy.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));

test('revenue materializer owns its PostgreSQL dependency and no App Sale checkout dependency', () => {
  assert.match(source, /require\(['"]pg['"]\)/);
  assert.ok(pkg.dependencies?.pg, 'server/package.json must declare pg');
  assert.doesNotMatch(source, /workspace-(?:main|sale-dev|datahub-dev)/);
  assert.doesNotMatch(source, /node_modules['"], ['"]pg/);
  assert.match(source, /APPSALE_(?:DATABASE_URL|PGHOST)/);
});

test('fail-closed guard runs before payload write and active-slot replacement', () => {
  const guardAt = source.indexOf('const materializeGuard = evaluateRevenueCandidate');
  const fileWriteAt = source.indexOf('writeJson(file, rows)', guardAt);
  const deactivateAt = source.indexOf('s.active = false', guardAt);
  assert.ok(guardAt >= 0 && fileWriteAt > guardAt && deactivateAt > guardAt);
  assert.match(source, /revenue_2source_rejected_/);
  assert.match(source, /REVENUE_MATERIALIZE_GUARD_REJECTED/);
  assert.match(source, /acquireMaterializeLock\(\)/);
  assert.match(source, /ACTIVE_SLOT_CHANGED_DURING_MATERIALIZE/);
  assert.match(source, /selectCanonicalPeriodSlots\(baselineSlots, PERIOD\.ky\)/);
  assert.doesNotMatch(source, /baselineSlots\.filter\(\(s\) => s\.ky === PERIOD\.ky\)/);
  assert.match(source, /INVALID_SLOT_PERIOD_METADATA_DURING_MATERIALIZE/);
  assert.match(source, /PERIOD_SLOTS_CHANGED_DURING_MATERIALIZE/);
  assert.match(source, /PLACEHOLDER_CHANGED_DURING_MATERIALIZE/);
  assert.match(source, /SLOT_ID_COLLISION/);
  assert.match(source, /writeJson = writeJsonAtomic/);
});

test('materialization path removes VIỆC 0C token/invoice/manual_zalo eligibility', () => {
  assert.doesNotMatch(source, /revenuePartnerEligibility/);
  assert.doesNotMatch(source, /REVENUE_PARTNER_POLICY_ID/);
  assert.doesNotMatch(source, /partnerConfirmationRuleActive/);
  assert.doesNotMatch(source, /partnerRevenueExclusionReason/);
  assert.doesNotMatch(source, /partnerEligibilityAudit/);
  assert.doesNotMatch(mirrorSource, /partner_order_response_invoices/);
  assert.doesNotMatch(mirrorSource, /partner_order_response_invoice_items/);
  assert.doesNotMatch(mirrorSource, /manual_zalo/);
  assert.doesNotMatch(mirrorSource, /token_id/);
});

test('CRM mirror uses exact App Sale sale_order_date and invoice-export KPI semantics', () => {
  assert.match(mirrorSource, /period_month=date_trunc\('month',\$1::date\)::date/);
  assert.match(mirrorSource, /from_date <= \$2::date/);
  assert.match(mirrorSource, /to_date >= \$1::date/);
  assert.match(mirrorSource, /sale_order_date >= \$2::date/);
  assert.match(mirrorSource, /sale_order_date <= \$3::date/);
  assert.match(mirrorSource, /revenue_bucket <> 'excluded'/);
  assert.match(mirrorSource, /SUM\(invoice_export_amount\)/);
  assert.doesNotMatch(mirrorSource, /revenue_date/);
  assert.doesNotMatch(mirrorSource, /COALESCE\(l\.invoice_export_amount,l\.official_amount/);
  assert.match(source, /dateFields: \{ crm: 'misa_revenue_snapshot_lines\.sale_order_date', partner: 'orders\.created_at' \}/);
});

test('partner mirror uses exact App Sale created_at, status and response quantity semantics', () => {
  assert.match(mirrorSource, /o\.source_system='APP_SALE'/);
  assert.match(mirrorSource, /o\.entity_group='PARTNER'/);
  assert.match(mirrorSource, /COALESCE\(o\.is_test,false\) IS NOT TRUE/);
  assert.match(mirrorSource, /COALESCE\(o\.status,''\) <> 'DRAFT'/);
  assert.match(mirrorSource, /o\.created_at >= \$2::date/);
  assert.match(mirrorSource, /o\.created_at < \(\$3::date \+ 1\)/);
  assert.match(mirrorSource, /LIKE '%huy%'/);
  assert.match(mirrorSource, /LIKE '%hủy%'/);
  assert.match(mirrorSource, /LIKE '%huỷ%'/);
  assert.match(mirrorSource, /LIKE '%cancel%'/);
  assert.doesNotMatch(mirrorSource, /status[^\n]*<>[^\n]*HOLD_GOLIVE/);
  assert.match(mirrorSource, /COALESCE\(MAX\(r\.delivered_qty\),MAX\(r\.qty_delivered\),[\s\S]*MAX\(r\.response_status\)='full'/);
  assert.match(mirrorSource, /LEFT JOIN partner_order_line_responses r ON r\.order_id=o\.id AND r\.order_item_id=oi\.id/);
  assert.match(mirrorSource, /COALESCE\(SUM\(delivered_amount\),0\)::numeric delivered_amount/);
});

test('partner mirror pins App Sale C31 pricing and exact fallback order from 01/07/2026', () => {
  assert.match(mirrorSource, /public_data->>'C31'/);
  assert.match(mirrorSource, /CATALOG_REPRICE_CUTOFF = '2026-07-01'/);
  assert.match(mirrorSource, /DATE '\$\{CATALOG_REPRICE_CUTOFF\}'/);
  assert.match(mirrorSource, /CASE WHEN cpe\.price_count=1 THEN cpe\.price END,[\s\S]*CASE WHEN cpu\.price_count=1 THEN cpu\.price END,[\s\S]*COALESCE\(oi\.price,0\)/);
  assert.match(mirrorSource, /cpe\.contractor_code=UPPER\(COALESCE\(c\.code,''\)\)/);
  assert.match(mirrorSource, /COUNT\(DISTINCT price\)::int price_count/);
  assert.match(source, /resolveCatalogVersion\(client\)/);
  assert.match(source, /catalogVersionNo: catalog\.versionNo/);
});

test('CRM and partner projections reconcile to exact KPI aggregates inside one repeatable-read snapshot', () => {
  const snapshotAt = source.indexOf('async function readSourceSnapshot()');
  const mainAt = source.indexOf('async function main()', snapshotAt);
  const snapshotSource = source.slice(snapshotAt, mainAt);
  assert.match(snapshotSource, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(snapshotSource, /txid_current_snapshot\(\)/);
  assert.match(snapshotSource, /const catalog = await resolveCatalogVersion\(client\)/);
  assert.match(snapshotSource, /const run = await latestRun\(client\)/);
  assert.match(snapshotSource, /fetchMisa\(run\.id, client\)/);
  assert.match(snapshotSource, /fetchPartnerPartition\(catalog\.versionNo, client\)/);
  assert.match(snapshotSource, /transitionEvidenceDigest\(sourceMirrorProof\)/);
  assert.match(snapshotSource, /await client\.query\('COMMIT'\)/);
  assert.match(snapshotSource, /const sourceRunAfterRead = await latestRun\(pool\)/);
  assert.match(source, /APP_SALE_CRM_KPI_PROJECTION_MISMATCH/);
  assert.match(source, /APP_SALE_PARTNER_KPI_PROJECTION_MISMATCH/);
  assert.match(source, /APP_SALE_PARTNER_KPI_PARTITION_DELTA/);
  assert.match(source, /APP_SALE_MIRROR_TOTAL_INVARIANT_FAILED/);
});

test('App Sale provenance and mirror proof are persisted without VIỆC 0C policy metadata', () => {
  assert.match(source, /revenueSourceMirror: APP_SALE_REVENUE_MIRROR_ID/);
  assert.match(source, /revenueSourceMirrorEvidence:/);
  assert.match(source, /appSaleRelease: APP_SALE_RELEASE/);
  assert.match(source, /appSaleSourceSha256: APP_SALE_SOURCE_SHA256/);
  assert.match(source, /catalogGuardSha256: APP_SALE_CATALOG_GUARD_SHA256/);
  assert.match(source, /sqlSha256: APP_SALE_SQL_SHA256/);
  assert.match(source, /transitionEvidenceDigest: sourceMirrorProof\.transitionEvidenceDigest/);
  const slotAt = source.indexOf('commitSlots.push({');
  const slotEnd = source.indexOf('writeJson(slotsPath, commitSlots)', slotAt);
  const slotSource = source.slice(slotAt, slotEnd);
  assert.doesNotMatch(slotSource, /revenueRulePolicy:/);
  assert.doesNotMatch(slotSource, /partnerEligibilityAudit:/);
});

test('approved SQL-mirror transition is explicit, one-shot and before any slot write', () => {
  const resolveAt = source.indexOf('const approvedRuleTransition = resolveApprovedRuleTransition');
  const guardAt = source.indexOf('const materializeGuard = evaluateRevenueCandidate');
  const fileWriteAt = source.indexOf('writeJson(file, rows)', guardAt);
  const identityAt = source.indexOf('const identity = await equivalentToActiveSlot', guardAt);
  const verifyAt = source.indexOf('verifiedActivePayloadFingerprint(previousSlot, UP_DIR)', identityAt);
  const claimAt = source.indexOf('createTransitionClaim({', verifyAt);
  assert.ok(resolveAt >= 0 && guardAt > resolveAt && identityAt > guardAt && verifyAt > identityAt && claimAt > verifyAt && fileWriteAt > claimAt);
  assert.match(source, /process\.env\.REVENUE_RULE_TRANSITION_ID/);
  assert.match(source, /approvedTransition: approvedRuleTransition/);
  assert.match(source, /PERIOD_SLOTS_CHANGED_BEFORE_TRANSITION_CLAIM/);
  assert.match(source, /FROZEN_PERIOD_CHANGED_BEFORE_TRANSITION_CLAIM/);
  assert.match(transitionSafetySource, /O_EXCL/);
  assert.match(transitionSafetySource, /O_NOFOLLOW/);
  assert.match(transitionSafetySource, /REVENUE_RULE_TRANSITION_ID_ALREADY_CONSUMED/);
});

test('frozen periods use the current baseline and are blocked before any source read', () => {
  const guardAt = source.indexOf('assertPeriodOpenForMaterialization(PERIOD.ky)');
  const sourceReadAt = source.indexOf('await readSourceSnapshot()');
  assert.ok(guardAt >= 0 && sourceReadAt > guardAt, 'frozen-period guard must run before App Sale source reads');
  assert.match(source, /CURRENT_FROZEN_PERIOD_PINS/);
  assert.match(source, /frozenPeriodFingerprints\(\s*baselineSlots,\s*CURRENT_FROZEN_PERIOD_PINS/s);
  assert.match(source, /frozenPeriodFingerprints\(commitSlots, CURRENT_FROZEN_PERIOD_PINS/);
  assert.match(source, /frozenPeriodFingerprints\(\s*preClaimSlots,\s*CURRENT_FROZEN_PERIOD_PINS/s);
});

test('attribution quarantine is total-preserving and does not alter source KPI proof', () => {
  assert.match(source, /const sourceRows = \[\.\.\.misa, \.\.\.partner\]/);
  assert.match(source, /quarantineRosterConflicts\(sourceRows, roster/);
  assert.match(source, /ATTRIBUTION_GUARD_CHANGED_TOTAL/);
  assert.match(source, /ROSTER_CONFLICT_TO_UNALLOCATED_NO_REMAP/);
  assert.match(source, /không đổi tổng và không remap sang NV khác/);
});

test('all slot writers share the same lock and atomic JSON writer', () => {
  for (const [label, text] of [['manual upload', uploadSource], ['legacy import', legacySource]]) {
    assert.match(text, /revenue_materialize\.lock/, `${label} must use the shared lock path`);
    assert.match(text, /acquireFileLock/, `${label} must acquire the shared lock`);
    assert.match(text, /writeJsonAtomic/, `${label} must write JSON atomically`);
  }
});
