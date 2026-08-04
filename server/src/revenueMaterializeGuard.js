const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const {
  REVENUE_PARTNER_POLICY_ID,
  PARTNER_EXCLUSION_REASONS,
  invoiceIdentity,
  partnerRevenueExclusionReason,
} = require('./revenuePartnerEligibility');
const {
  APP_SALE_REVENUE_MIRROR_ID,
  APP_SALE_RELEASE,
  APP_SALE_SOURCE_SHA256,
  APP_SALE_CATALOG_GUARD_SHA256,
  SQL_SHA256: APP_SALE_SQL_SHA256,
  transitionEvidenceDigest,
} = require('./appSaleRevenueMirror');

const DEFAULT_MIN_TOTAL_RATIO = 0.70;
const REQUIRED_SOURCES = ['CRM_MISA', 'APP_WEB_PARTNER'];
const APPROVED_RULE_TRANSITIONS = Object.freeze({
  VIEC0C_T08_2026_LIVE_PARTITION_V1: Object.freeze({
    id: 'VIEC0C_T08_2026_LIVE_PARTITION_V1',
    ky: '08.2026',
    policyId: REVENUE_PARTNER_POLICY_ID,
    proofVersion: 1,
    frozenPeriods: Object.freeze({
      '06.2026': Object.freeze({
        activeSlotId: 'legacy_062026_mr26j8nb',
        manifestSha256: 'e3c532333693c944984b7521906fb9e3f55843b391676fe99e27db70ab40d45e',
        totalRows: 2001,
        totalRevenue: 28403136096,
        payloadSha256: '39d5f22b894f09aa95ea1ee1794dc8bf4dc9d16f07114653c1e3c0be758532ae',
      }),
      '07.2026': Object.freeze({
        activeSlotId: 'rev_2src_072026_20260731103017_2059764_3bdc83af-5bd4-4b51-b335-16a48c6fa62a',
        manifestSha256: '4533a8ae009773cbba8169f8d754cdf59d5e6412d1579986806e2aacb57849e7',
        totalRows: 2016,
        totalRevenue: 30917892673,
        payloadSha256: 'fd4a01e4e248f685ec6f2dfc23e53ee66213ea55a4deacd7be3d09b496f65ca7',
      }),
    }),
  }),
  // Recovery-only id after V1 was consumed by a successful materialization
  // whose deployment wrapper then rolled the active manifest back. V2 keeps
  // the exact approved policy, period, proof schema and frozen-period pins;
  // only the one-shot claim identity changes.
  VIEC0C_T08_2026_LIVE_PARTITION_V2: Object.freeze({
    id: 'VIEC0C_T08_2026_LIVE_PARTITION_V2',
    ky: '08.2026',
    policyId: REVENUE_PARTNER_POLICY_ID,
    proofVersion: 1,
    frozenPeriods: Object.freeze({
      '06.2026': Object.freeze({
        activeSlotId: 'legacy_062026_mr26j8nb',
        manifestSha256: 'e3c532333693c944984b7521906fb9e3f55843b391676fe99e27db70ab40d45e',
        totalRows: 2001,
        totalRevenue: 28403136096,
        payloadSha256: '39d5f22b894f09aa95ea1ee1794dc8bf4dc9d16f07114653c1e3c0be758532ae',
      }),
      '07.2026': Object.freeze({
        activeSlotId: 'rev_2src_072026_20260731103017_2059764_3bdc83af-5bd4-4b51-b335-16a48c6fa62a',
        manifestSha256: '4533a8ae009773cbba8169f8d754cdf59d5e6412d1579986806e2aacb57849e7',
        totalRows: 2016,
        totalRevenue: 30917892673,
        payloadSha256: 'fd4a01e4e248f685ec6f2dfc23e53ee66213ea55a4deacd7be3d09b496f65ca7',
      }),
    }),
  }),
  VIEC0D_T08_2026_APP_SALE_SQL_MIRROR_V1: Object.freeze({
    id: 'VIEC0D_T08_2026_APP_SALE_SQL_MIRROR_V1',
    kind: 'APP_SALE_SQL_MIRROR',
    ky: '08.2026',
    previousPolicyId: REVENUE_PARTNER_POLICY_ID,
    mirrorId: APP_SALE_REVENUE_MIRROR_ID,
    appSaleRelease: APP_SALE_RELEASE,
    appSaleSourceSha256: APP_SALE_SOURCE_SHA256,
    catalogGuardSha256: APP_SALE_CATALOG_GUARD_SHA256,
    sqlSha256: APP_SALE_SQL_SHA256,
    proofVersion: 1,
    frozenPeriods: Object.freeze({
      '06.2026': Object.freeze({
        activeSlotId: 'legacy_062026_mr26j8nb',
        manifestSha256: 'e3c532333693c944984b7521906fb9e3f55843b391676fe99e27db70ab40d45e',
        totalRows: 2001,
        totalRevenue: 28403136096,
        payloadSha256: '39d5f22b894f09aa95ea1ee1794dc8bf4dc9d16f07114653c1e3c0be758532ae',
      }),
      '07.2026': Object.freeze({
        activeSlotId: 'rev_2src_072026_20260731103017_2059764_3bdc83af-5bd4-4b51-b335-16a48c6fa62a',
        manifestSha256: '4533a8ae009773cbba8169f8d754cdf59d5e6412d1579986806e2aacb57849e7',
        totalRows: 2016,
        totalRevenue: 30917892673,
        payloadSha256: 'fd4a01e4e248f685ec6f2dfc23e53ee66213ea55a4deacd7be3d09b496f65ca7',
      }),
    }),
  }),
});
const EXCLUDED_ROW_KEYS = [
  'date', 'employeeCode', 'orderCode', 'productCode',
  'reason', 'revenue', 'sourceLineId', 'unitCode',
].sort();
const PARTNER_EVIDENCE_KEYS = [
  'sourceLineId', 'orderId', 'orderItemId', 'orderCode', 'responseId',
  'responseOrderItemId', 'tokenId', 'responseRevisionNo', 'responseSource',
  'respondedAt', 'responseUpdatedAt', 'invoiceId', 'invoiceRevisionNo',
  'invoiceSource', 'invoiceNo', 'invoiceIdentity', 'invoiceCreatedAt',
  'invoiceUpdatedAt', 'deliveredQty', 'quantity', 'unitPrice', 'date',
  'revenue', 'eligible', 'reason', 'employeeCode', 'productCode', 'unitCode',
].sort();
const INVOICE_SOURCES = new Set(['RESPONSE_LINE', 'ITEM_HEADER', 'ORDER_HEADER', 'NONE']);
const ALLOWED_EXCLUSION_REASONS = new Set(Object.values(PARTNER_EXCLUSION_REASONS));

function number(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function isFiniteNumeric(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function sourceStat(summary, source) {
  const value = summary?.[source] || {};
  return { rows: number(value.rows), orders: number(value.orders), revenue: number(value.revenue) };
}

function ratio(current, previous) {
  return previous > 0 ? current / previous : null;
}

function resolveApprovedRuleTransition(id, effectiveFrom) {
  const transitionId = String(id || '').trim();
  if (!transitionId) return null;
  const transition = APPROVED_RULE_TRANSITIONS[transitionId];
  if (!transition) throw new Error(`INVALID_REVENUE_RULE_TRANSITION_ID:${transitionId}`);
  if (String(effectiveFrom || '').trim() !== transition.ky) {
    throw new Error(`REVENUE_RULE_TRANSITION_EFFECTIVE_PERIOD_MISMATCH:${transitionId}`);
  }
  return transition;
}

function partitionStat(value) {
  return {
    rows: number(value?.rows),
    orders: number(value?.orders),
    revenue: number(value?.revenue),
  };
}

function validPartitionStat(value) {
  return isFiniteNumeric(value?.rows) && Number.isInteger(number(value.rows)) && number(value.rows) >= 0
    && isFiniteNumeric(value?.orders) && Number.isInteger(number(value.orders)) && number(value.orders) >= 0
    && number(value.orders) <= number(value.rows)
    && isFiniteNumeric(value?.revenue);
}

function normalizeExcludedRow(row) {
  return {
    sourceLineId: String(row?.sourceLineId || ''),
    orderCode: String(row?.orderCode || ''),
    productCode: String(row?.productCode || ''),
    unitCode: String(row?.unitCode || ''),
    employeeCode: String(row?.employeeCode || ''),
    date: String(row?.date || ''),
    revenue: number(row?.revenue),
    reason: String(row?.reason || ''),
  };
}

function excludedRowsDigest(rows) {
  const canonical = (Array.isArray(rows) ? rows : [])
    .map(normalizeExcludedRow)
    .sort((a, b) => a.sourceLineId.localeCompare(b.sourceLineId));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function partnerEvidenceDigest(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function exactKeys(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

function validIsoOrBlank(value) {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function evidencePartitionStat(rows) {
  return {
    rows: rows.length,
    orders: new Set(rows.map((row) => row.orderCode)).size,
    revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
  };
}

function validPartnerEvidenceRow(row, transition) {
  if (!exactKeys(row, PARTNER_EVIDENCE_KEYS)) return false;
  const stringKeys = [
    'sourceLineId', 'orderId', 'orderItemId', 'orderCode', 'responseId',
    'responseOrderItemId', 'tokenId', 'responseSource', 'invoiceId',
    'invoiceSource', 'invoiceNo', 'invoiceIdentity', 'date', 'reason',
    'employeeCode', 'productCode', 'unitCode',
  ];
  if (!stringKeys.every((key) => typeof row[key] === 'string' && row[key] === row[key].trim())) return false;
  if (!['responseRevisionNo', 'invoiceRevisionNo'].every((key) => Number.isInteger(row[key]) && row[key] >= 0)) return false;
  if (!['deliveredQty', 'quantity', 'unitPrice', 'revenue'].every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]))) return false;
  if (typeof row.eligible !== 'boolean'
    || !validIsoOrBlank(row.respondedAt) || !validIsoOrBlank(row.responseUpdatedAt)
    || !validIsoOrBlank(row.invoiceCreatedAt) || !validIsoOrBlank(row.invoiceUpdatedAt)) return false;
  const period = expectedPeriodRange(transition.ky);
  if (!/^WEB:\d+$/.test(row.sourceLineId)
    || !/^\d+$/.test(row.orderId) || !/^\d+$/.test(row.orderItemId)
    || row.sourceLineId !== `WEB:${row.orderItemId}` || !row.orderCode
    || (row.responseId !== '' && !/^\d+$/.test(row.responseId))
    || (row.responseOrderItemId !== '' && row.responseOrderItemId !== row.orderItemId)
    || (row.invoiceId !== '' && !/^\d+$/.test(row.invoiceId))
    || !INVOICE_SOURCES.has(row.invoiceSource)
    || row.deliveredQty <= 0 || row.quantity !== row.deliveredQty || row.unitPrice < 0
    || row.revenue !== Math.round(row.quantity * row.unitPrice)
    || row.date < period.dateFrom || row.date > period.dateTo
    || invoiceIdentity(row.invoiceNo) !== row.invoiceIdentity) return false;
  const hasResponse = row.responseId !== '';
  if (hasResponse !== (row.responseOrderItemId !== '')
    || (!hasResponse && (row.tokenId !== '' || row.responseRevisionNo !== 0 || row.responseSource !== ''
      || row.respondedAt !== '' || row.responseUpdatedAt !== ''))
    || (hasResponse && (row.responseRevisionNo <= 0 || row.respondedAt === ''))) return false;
  if ((row.invoiceSource === 'NONE') !== (row.invoiceNo === '')) return false;
  if (row.invoiceSource === 'NONE'
    && (row.invoiceId !== '' || row.invoiceIdentity !== '' || row.invoiceRevisionNo !== 0
      || row.invoiceCreatedAt !== '' || row.invoiceUpdatedAt !== '')) return false;
  if (row.invoiceSource === 'RESPONSE_LINE'
    && (!hasResponse || row.invoiceId !== '' || row.invoiceRevisionNo !== row.responseRevisionNo
      || row.invoiceCreatedAt !== row.respondedAt || row.invoiceUpdatedAt !== row.responseUpdatedAt)) return false;
  if ((row.invoiceSource === 'ITEM_HEADER' || row.invoiceSource === 'ORDER_HEADER')
    && (row.invoiceId === '' || row.tokenId === '' || row.invoiceRevisionNo <= 0
      || row.invoiceCreatedAt === '' || row.invoiceUpdatedAt === '')) return false;
  const expectedReason = partnerRevenueExclusionReason({
    deliveredQty: row.deliveredQty,
    tokenId: row.tokenId === '' ? null : row.tokenId,
    responseSource: row.responseSource,
    invoiceNo: row.invoiceNo,
  }, { periodKy: transition.ky, effectiveFrom: transition.ky }) || '';
  return row.reason === expectedReason && row.eligible === (expectedReason === '')
    && (row.reason === '' || ALLOWED_EXCLUSION_REASONS.has(row.reason));
}

function validLivePartitionProof(current, transition) {
  const proof = current?.ruleTransitionProof;
  if (!proof || proof.version !== transition.proofVersion
    || proof.policyId !== transition.policyId
    || proof.ky !== transition.ky
    || String(proof.sourceRunId || '') !== current.sourceRunId
    || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(String(proof.dbSnapshot || ''))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(proof.snapshotCapturedAt || ''))
    || !proof.projectionDigests
    || !['misa', 'rawPartner', 'eligiblePartner', 'includedTotal', 'partnerEvidence'].every((key) => /^[a-f0-9]{64}$/.test(String(proof.projectionDigests[key] || '')))) return false;
  if (!validPartitionStat(proof.misa) || !validPartitionStat(proof.includedTotal)
    || !validPartitionStat(proof.rawPartner) || !validPartitionStat(proof.eligiblePartner)
    || !validPartitionStat(proof.excludedPartner)) return false;
  const misa = partitionStat(proof.misa);
  const includedTotal = partitionStat(proof.includedTotal);
  const raw = partitionStat(proof.rawPartner);
  const eligible = partitionStat(proof.eligiblePartner);
  const excluded = partitionStat(proof.excludedPartner);
  const candidateMisa = sourceStat(current.sourceSummary, 'CRM_MISA');
  const candidatePartner = sourceStat(current.sourceSummary, 'APP_WEB_PARTNER');
  if (candidateMisa.rows !== misa.rows || candidateMisa.orders !== misa.orders || candidateMisa.revenue !== misa.revenue
    || candidatePartner.rows !== eligible.rows || candidatePartner.orders !== eligible.orders || candidatePartner.revenue !== eligible.revenue
    || current.totalRows !== includedTotal.rows || current.totalRevenue !== includedTotal.revenue
    || includedTotal.rows !== misa.rows + eligible.rows || includedTotal.orders !== misa.orders + eligible.orders
    || includedTotal.revenue !== misa.revenue + eligible.revenue) return false;
  if (!Array.isArray(proof.partnerEvidenceRows) || proof.partnerEvidenceRows.length !== raw.rows
    || !/^[a-f0-9]{64}$/.test(String(proof.partnerEvidenceDigest || ''))
    || proof.projectionDigests.partnerEvidence !== proof.partnerEvidenceDigest
    || partnerEvidenceDigest(proof.partnerEvidenceRows) !== proof.partnerEvidenceDigest) return false;
  const seen = new Set();
  let previousSourceLineId = '';
  for (const row of proof.partnerEvidenceRows) {
    if (!validPartnerEvidenceRow(row, transition) || seen.has(row.sourceLineId)
      || (previousSourceLineId && previousSourceLineId.localeCompare(row.sourceLineId) > 0)) return false;
    seen.add(row.sourceLineId);
    previousSourceLineId = row.sourceLineId;
  }
  const eligibleEvidence = proof.partnerEvidenceRows.filter((row) => row.eligible);
  const excludedEvidence = proof.partnerEvidenceRows.filter((row) => !row.eligible);
  if (JSON.stringify(evidencePartitionStat(proof.partnerEvidenceRows)) !== JSON.stringify(raw)
    || JSON.stringify(evidencePartitionStat(eligibleEvidence)) !== JSON.stringify(eligible)
    || JSON.stringify(evidencePartitionStat(excludedEvidence)) !== JSON.stringify(excluded)
    || raw.rows !== eligible.rows + excluded.rows || raw.revenue !== eligible.revenue + excluded.revenue
    || excluded.rows <= 0 || excluded.revenue <= 0) return false;
  const expectedExcludedRows = excludedEvidence.map((row) => normalizeExcludedRow(row));
  if (!Array.isArray(proof.excludedRows) || proof.excludedRows.length !== excluded.rows
    || JSON.stringify(proof.excludedRows) !== JSON.stringify(expectedExcludedRows)) return false;
  return proof.excludedRows.every((row) => exactKeys(row, EXCLUDED_ROW_KEYS));
}

function liveApprovedTransition(previous, current, transition) {
  return Boolean(transition)
    && previous?.ky === transition.ky
    && current?.ky === transition.ky
    && !previous.revenueRulePolicy
    && current.revenueRulePolicy === transition.policyId
    && validLivePartitionProof(current, transition);
}

function validAppSaleMirrorProof(current, transition) {
  const proof = current?.ruleTransitionProof;
  if (!proof || transition?.kind !== 'APP_SALE_SQL_MIRROR'
    || proof.version !== transition.proofVersion
    || proof.mirrorId !== transition.mirrorId
    || proof.appSaleRelease !== transition.appSaleRelease
    || proof.appSaleSourceSha256 !== transition.appSaleSourceSha256
    || proof.catalogGuardSha256 !== transition.catalogGuardSha256
    || proof.ky !== transition.ky
    || proof.from !== expectedPeriodRange(transition.ky)?.dateFrom
    || proof.to !== expectedPeriodRange(transition.ky)?.dateTo
    || proof.timeZone !== 'Asia/Bangkok'
    || proof.dateFields?.crm !== 'misa_revenue_snapshot_lines.sale_order_date'
    || proof.dateFields?.partner !== 'orders.created_at'
    || String(proof.sourceRunId || '') !== current.sourceRunId
    || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(String(proof.dbSnapshot || ''))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(proof.snapshotCapturedAt || ''))
    || !Number.isSafeInteger(Number(proof.catalogVersionNo)) || Number(proof.catalogVersionNo) <= 0
    || JSON.stringify(proof.sqlSha256) !== JSON.stringify(transition.sqlSha256)
    || !exactKeys(proof.projectionDigests, ['includedTotal', 'misa', 'partner'])
    || Object.values(proof.projectionDigests).some((digest) => !/^[a-f0-9]{64}$/.test(String(digest || '')))
    || !/^[a-f0-9]{64}$/.test(String(proof.transitionEvidenceDigest || ''))
    || transitionEvidenceDigest(proof) !== proof.transitionEvidenceDigest) return false;
  if (!validPartitionStat(proof.crm) || !validPartitionStat(proof.partner)
    || !validPartitionStat(proof.includedTotal)) return false;
  const crm = partitionStat(proof.crm);
  const partner = partitionStat(proof.partner);
  const included = partitionStat(proof.includedTotal);
  const candidateCrm = sourceStat(current.sourceSummary, 'CRM_MISA');
  const candidatePartner = sourceStat(current.sourceSummary, 'APP_WEB_PARTNER');
  if (JSON.stringify(crm) !== JSON.stringify(candidateCrm)
    || JSON.stringify(partner) !== JSON.stringify(candidatePartner)
    || included.rows !== crm.rows + partner.rows
    || included.revenue !== crm.revenue + partner.revenue
    || included.rows !== current.totalRows
    || included.revenue !== current.totalRevenue) return false;
  return proof.partnerKpi
    && Number(proof.partnerKpi.revenue) === partner.revenue
    && Number(proof.partnerKpi.rows) === partner.rows
    && Number(proof.partnerKpi.orders) === partner.orders
    && Math.abs(Number(proof.partnerKpi.delta || 0)) <= 0.000001;
}

function liveApprovedAppSaleMirrorTransition(previous, current, transition) {
  return Boolean(transition)
    && transition.kind === 'APP_SALE_SQL_MIRROR'
    && previous?.ky === transition.ky
    && current?.ky === transition.ky
    && previous.revenueRulePolicy === transition.previousPolicyId
    && current.revenueRulePolicy === ''
    && current.revenueSourceMirror === transition.mirrorId
    && validAppSaleMirrorProof(current, transition);
}

function expectedPeriodRange(ky) {
  const match = String(ky || '').match(/^(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    key: `${match[1]}${match[2]}`,
    dateFrom: `${match[2]}-${match[1]}-01`,
    dateTo: `${match[2]}-${match[1]}-${String(lastDay).padStart(2, '0')}`,
  };
}

const LEGACY_PLACEHOLDER_KEYS = [
  'active', 'data_as_of', 'dateFrom', 'dateTo', 'empCount', 'filename', 'id', 'ky',
  'source', 'sourceRunId', 'sourceSnapshotFinishedAt', 'sourceSummary', 'totalRevenue',
  'totalRows', 'uploadedAt', 'uploadedBy', 'uploadedByName',
].sort();
const LEGACY_PLACEHOLDER_STRING_FIELDS = [
  'data_as_of', 'dateFrom', 'dateTo', 'filename', 'id', 'ky', 'source', 'sourceRunId',
  'sourceSnapshotFinishedAt', 'uploadedAt', 'uploadedBy', 'uploadedByName',
];

function isCanonicalUtcMillis(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

// Legacy pre-period placeholders were generated before the target month and
// contain no business rows. Keep this signature deliberately narrow: an
// inactive real/manual/corrupt slot must continue to trip MISSING_ACTIVE_SLOT.
function isEmptyMaterializerPlaceholder(slot) {
  if (!slot || Object.getPrototypeOf(slot) !== Object.prototype || slot.active !== false) return false;
  if (JSON.stringify(Object.keys(slot).sort()) !== JSON.stringify(LEGACY_PLACEHOLDER_KEYS)) return false;
  if (LEGACY_PLACEHOLDER_STRING_FIELDS.some((field) => typeof slot[field] !== 'string')) return false;
  const period = expectedPeriodRange(slot.ky);
  const id = String(slot.id || '');
  if (!period) return false;
  const idMatch = id.match(new RegExp(`^rev_2src_${period.key}_(\\d{14})$`));
  if (!idMatch || String(slot.filename || '') !== `${id}.json`) return false;
  if (String(slot.dateFrom || '') !== period.dateFrom || String(slot.dateTo || '') !== period.dateTo) return false;
  if (String(slot.uploadedBy || '') !== 'SYSTEM'
    || String(slot.uploadedByName || '') !== 'CRM MISA + APP WEB materializer'
    || String(slot.source || '') !== 'CRM_MISA_PLUS_APP_WEB') return false;
  if (typeof slot.sourceRunId !== 'string' || !/^[1-9]\d*$/.test(slot.sourceRunId)) return false;
  if (typeof slot.totalRows !== 'number' || slot.totalRows !== 0
    || typeof slot.totalRevenue !== 'number' || slot.totalRevenue !== 0
    || typeof slot.empCount !== 'number' || slot.empCount !== 0) return false;
  if (!slot.sourceSummary || Object.getPrototypeOf(slot.sourceSummary) !== Object.prototype
    || Object.keys(slot.sourceSummary).length !== 0) return false;
  if (!isCanonicalUtcMillis(slot.uploadedAt) || !isCanonicalUtcMillis(slot.sourceSnapshotFinishedAt)) return false;
  const uploadedAt = new Date(slot.uploadedAt);
  const sourceFinishedAt = new Date(slot.sourceSnapshotFinishedAt);
  const periodStartVn = new Date(`${period.dateFrom}T00:00:00+07:00`);
  const uploadedStamp = slot.uploadedAt.replace(/[-:T.Z]/g, '').slice(0, 14);
  if (uploadedStamp !== idMatch[1] || uploadedAt >= periodStartVn
    || sourceFinishedAt >= periodStartVn || sourceFinishedAt >= uploadedAt) return false;
  if (slot.data_as_of !== `${period.dateFrom}T07:30:00+07:00`) return false;
  return true;
}

function noFollowOpenFlag(constants = fs.constants) {
  const flag = constants?.O_NOFOLLOW;
  return Number.isInteger(flag) && flag > 0 ? flag : null;
}

function invalidSlotPeriods(slots) {
  if (!Array.isArray(slots)) return [{ index: -1, id: null, kyType: typeof slots, ky: null }];
  const invalid = [];
  slots.forEach((slot, index) => {
    const ky = slot?.ky;
    if (typeof ky !== 'string' || !expectedPeriodRange(ky)) {
      invalid.push({ index, id: typeof slot?.id === 'string' ? slot.id : null, kyType: typeof ky, ky: typeof ky === 'string' ? ky : null });
    }
  });
  return invalid;
}

function selectCanonicalPeriodSlots(slots, ky) {
  const invalidSlots = invalidSlotPeriods(slots);
  if (invalidSlots.length > 0 || typeof ky !== 'string' || !expectedPeriodRange(ky)) {
    const error = new Error('INVALID_SLOT_PERIOD_METADATA');
    error.code = 'INVALID_SLOT_PERIOD_METADATA';
    error.invalidSlots = invalidSlots;
    throw error;
  }
  return slots.filter((slot) => slot.ky === ky);
}

function periodSlotsSnapshot(slots, ky) {
  if (!Array.isArray(slots) || typeof ky !== 'string') return '[]';
  return JSON.stringify(slots.filter((slot) => typeof slot?.ky === 'string' && slot.ky === ky));
}

function canBootstrapFromInactivePlaceholders({ slots, uploadsDir } = {}) {
  if (!Array.isArray(slots) || slots.length === 0 || !uploadsDir) return false;
  const noFollow = noFollowOpenFlag();
  if (noFollow === null) return false;
  try {
    const root = fs.realpathSync(path.resolve(String(uploadsDir)));
    return slots.every((slot) => {
      if (!isEmptyMaterializerPlaceholder(slot)) return false;
      const file = path.resolve(root, String(slot.filename));
      if (path.dirname(file) !== root) return false;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) return false;
      const realFile = fs.realpathSync(file);
      if (path.dirname(realFile) !== root) return false;
      const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
      try {
        if (!fs.fstatSync(fd).isFile()) return false;
        const payload = JSON.parse(fs.readFileSync(fd, 'utf8'));
        return Array.isArray(payload) && payload.length === 0;
      } finally {
        fs.closeSync(fd);
      }
    });
  } catch {
    return false;
  }
}

/**
 * Fail-closed gate for a candidate current-period revenue slot.
 *
 * A materializer run is rejected when a source that existed in the active slot
 * disappears, the aggregate rows/revenue suddenly fall below 70%, or an older
 * MISA snapshot attempts to replace a newer active slot. The previous slot is
 * left untouched so a transient source race cannot become production data.
 */
function evaluateRevenueCandidate({ previousSlot, candidate, minTotalRatio = DEFAULT_MIN_TOTAL_RATIO, approvedTransition = null } = {}) {
  const sourceRunId = String(candidate?.sourceRunId || '');
  const sourceRunIdAfterRead = candidate && Object.prototype.hasOwnProperty.call(candidate, 'sourceRunIdAfterRead')
    ? String(candidate.sourceRunIdAfterRead || '')
    : sourceRunId;
  const current = {
    ky: String(candidate?.ky || ''),
    totalRows: number(candidate?.totalRows),
    totalRevenue: number(candidate?.totalRevenue),
    sourceRunId,
    sourceRunIdAfterRead,
    sourceSummary: candidate?.sourceSummary || {},
    revenueRulePolicy: String(candidate?.revenueRulePolicy || ''),
    revenueSourceMirror: String(candidate?.revenueSourceMirror || ''),
    ruleTransitionProof: candidate?.ruleTransitionProof || null,
  };
  const previous = previousSlot ? {
    id: String(previousSlot.id || ''),
    ky: String(previousSlot.ky || ''),
    totalRows: number(previousSlot.totalRows),
    totalRevenue: number(previousSlot.totalRevenue),
    sourceRunId: String(previousSlot.sourceRunId || ''),
    sourceSummary: previousSlot.sourceSummary || {},
    revenueRulePolicy: String(previousSlot.revenueRulePolicy || ''),
    revenueSourceMirror: String(previousSlot.revenueSourceMirror || ''),
    appliedTransitionId: String(previousSlot.materializeGuard?.transition?.id || ''),
  } : null;
  const reasons = [];

  if (!current.ky || !isFiniteNumeric(candidate?.totalRows) || number(candidate?.totalRows) < 0 || !Number.isInteger(number(candidate?.totalRows)) || !isFiniteNumeric(candidate?.totalRevenue)) {
    reasons.push({ code: 'CANDIDATE_TOTALS_INVALID', totalRows: candidate?.totalRows, totalRevenue: candidate?.totalRevenue });
  }
  const sourceValues = Object.values(current.sourceSummary);
  const sourceRows = sourceValues.reduce((sum, value) => sum + number(value?.rows), 0);
  const sourceRevenue = sourceValues.reduce((sum, value) => sum + number(value?.revenue), 0);
  const malformedSource = sourceValues.some((value) => !isFiniteNumeric(value?.rows) || number(value?.rows) < 0 || !Number.isInteger(number(value?.rows)) || !isFiniteNumeric(value?.revenue));
  if (malformedSource || sourceRows !== current.totalRows || sourceRevenue !== current.totalRevenue) {
    reasons.push({ code: 'SOURCE_SUMMARY_INCONSISTENT', sourceRows, totalRows: current.totalRows, sourceRevenue, totalRevenue: current.totalRevenue });
  }
  if (current.sourceRunId && !current.sourceRunIdAfterRead) {
    reasons.push({ code: 'SOURCE_SNAPSHOT_RECHECK_MISSING', selected: current.sourceRunId });
  } else if (current.sourceRunId && current.sourceRunIdAfterRead !== current.sourceRunId) {
    reasons.push({ code: 'SOURCE_SNAPSHOT_CHANGED_DURING_READ', selected: current.sourceRunId, latestAfterRead: current.sourceRunIdAfterRead });
  }

  // A new period may legitimately begin at zero or with only one source, but a
  // configured one-time migration may never bootstrap without its legacy active
  // baseline or spill into another period.
  if (!previous || previous.ky !== current.ky) {
    if (approvedTransition) {
      reasons.push({
        code: current.ky === approvedTransition.ky
          ? 'APPROVED_TRANSITION_BASELINE_MISSING'
          : 'APPROVED_TRANSITION_PERIOD_MISMATCH',
        transitionId: approvedTransition.id,
        expectedKy: approvedTransition.ky,
        candidateKy: current.ky,
      });
    }
    return { ok: reasons.length === 0, reasons, previous, candidate: current, thresholds: { minTotalRatio } };
  }

  const previousRun = Number(previous.sourceRunId);
  const currentRun = Number(current.sourceRunId);
  if (Number.isFinite(previousRun) && previousRun > 0 && Number.isFinite(currentRun) && currentRun > 0 && currentRun < previousRun) {
    reasons.push({ code: 'STALE_MISA_RUN', previous: previous.sourceRunId, candidate: current.sourceRunId });
  }

  for (const source of REQUIRED_SOURCES) {
    const before = sourceStat(previous.sourceSummary, source);
    const after = sourceStat(current.sourceSummary, source);
    if (before.rows > 0 && after.rows <= 0) {
      reasons.push({ code: 'SOURCE_DISAPPEARED', source, previous: before, candidate: after });
    }
  }

  const revenueRatio = ratio(current.totalRevenue, previous.totalRevenue);
  if (revenueRatio != null && revenueRatio < minTotalRatio) {
    reasons.push({
      code: 'TOTAL_REVENUE_ABRUPT_DROP',
      previous: previous.totalRevenue,
      candidate: current.totalRevenue,
      ratio: revenueRatio,
      minimum: minTotalRatio,
    });
  }

  const rowRatio = ratio(current.totalRows, previous.totalRows);
  if (rowRatio != null && rowRatio < minTotalRatio) {
    reasons.push({
      code: 'TOTAL_ROWS_ABRUPT_DROP',
      previous: previous.totalRows,
      candidate: current.totalRows,
      ratio: rowRatio,
      minimum: minTotalRatio,
    });
  }

  const policyChanged = previous.revenueRulePolicy !== current.revenueRulePolicy;
  const mirrorChanged = previous.revenueSourceMirror !== current.revenueSourceMirror;
  let transition = null;
  if (approvedTransition?.kind === 'APP_SALE_SQL_MIRROR') {
    if (previous.appliedTransitionId === approvedTransition.id) {
      reasons.push({ code: 'APPROVED_TRANSITION_ALREADY_APPLIED', transitionId: approvedTransition.id });
    } else if (!liveApprovedAppSaleMirrorTransition(previous, current, approvedTransition)) {
      reasons.push({ code: 'APPROVED_TRANSITION_SIGNATURE_MISMATCH', transitionId: approvedTransition.id });
    } else {
      const proof = current.ruleTransitionProof;
      transition = {
        id: approvedTransition.id,
        status: 'APPROVED_APP_SALE_SQL_MIRROR_TRANSITION',
        kind: approvedTransition.kind,
        ky: approvedTransition.ky,
        previousPolicyId: approvedTransition.previousPolicyId,
        mirrorId: approvedTransition.mirrorId,
        appSaleRelease: approvedTransition.appSaleRelease,
        appSaleSourceSha256: approvedTransition.appSaleSourceSha256,
        previous: {
          slotId: previous.id,
          sourceRunId: previous.sourceRunId,
          totalRows: previous.totalRows,
          totalRevenue: previous.totalRevenue,
        },
        candidate: {
          sourceRunId: current.sourceRunId,
          totalRows: current.totalRows,
          totalRevenue: current.totalRevenue,
        },
        sourceSnapshot: {
          dbSnapshot: proof.dbSnapshot,
          capturedAt: proof.snapshotCapturedAt,
          transitionEvidenceDigest: proof.transitionEvidenceDigest,
          sqlSha256: proof.sqlSha256,
          catalogVersionNo: proof.catalogVersionNo,
        },
        projectionSummary: {
          crm: proof.crm,
          partner: proof.partner,
          includedTotal: proof.includedTotal,
        },
      };
    }
  } else {
    if (mirrorChanged && previous.revenueSourceMirror) {
      reasons.push({
        code: 'REVENUE_SOURCE_MIRROR_MISMATCH',
        previousMirror: previous.revenueSourceMirror,
        candidateMirror: current.revenueSourceMirror,
      });
    }
    if (approvedTransition && previous.appliedTransitionId === approvedTransition.id) {
      reasons.push({ code: 'APPROVED_TRANSITION_ALREADY_APPLIED', transitionId: approvedTransition.id });
    } else if (previous.revenueRulePolicy) {
      if (policyChanged) {
        reasons.push({
          code: 'REVENUE_RULE_POLICY_MISMATCH',
          previousPolicy: previous.revenueRulePolicy,
          candidatePolicy: current.revenueRulePolicy,
        });
      } else if (approvedTransition) {
        reasons.push({ code: 'APPROVED_TRANSITION_ALREADY_APPLIED', transitionId: approvedTransition.id });
      }
    } else if (current.revenueRulePolicy) {
      if (!approvedTransition) {
        reasons.push({
          code: 'REVENUE_RULE_TRANSITION_REQUIRED',
          candidatePolicy: current.revenueRulePolicy,
        });
      } else if (!liveApprovedTransition(previous, current, approvedTransition)) {
        reasons.push({
          code: 'APPROVED_TRANSITION_SIGNATURE_MISMATCH',
          transitionId: approvedTransition.id,
        });
      } else {
        // VIỆC 0C changes only the partner eligibility policy. It may waive an
        // aggregate drop or complete disappearance of eligible partner rows, but
        // never a missing CRM source, stale/mixed snapshot, malformed totals or
        // any manifest/slot race checked by the orchestrator.
        for (let index = reasons.length - 1; index >= 0; index -= 1) {
          const reason = reasons[index];
          const waivable = reason.code === 'TOTAL_REVENUE_ABRUPT_DROP'
            || reason.code === 'TOTAL_ROWS_ABRUPT_DROP'
            || (reason.code === 'SOURCE_DISAPPEARED' && reason.source === 'APP_WEB_PARTNER');
          if (waivable) reasons.splice(index, 1);
        }
        const proof = current.ruleTransitionProof;
        transition = {
          id: approvedTransition.id,
          status: 'APPROVED_LIVE_PARTITION_RULE_TRANSITION',
          ky: approvedTransition.ky,
          policyId: approvedTransition.policyId,
          previous: {
            slotId: previous.id,
            sourceRunId: previous.sourceRunId,
            totalRows: previous.totalRows,
            totalRevenue: previous.totalRevenue,
          },
          candidate: {
            sourceRunId: current.sourceRunId,
            totalRows: current.totalRows,
            totalRevenue: current.totalRevenue,
          },
          sourceSnapshot: {
            dbSnapshot: proof.dbSnapshot,
            capturedAt: proof.snapshotCapturedAt,
            projectionDigests: proof.projectionDigests,
          },
          projectionSummary: {
            misa: proof.misa,
            includedTotal: proof.includedTotal,
          },
          partnerPartition: {
            raw: proof.rawPartner,
            eligible: proof.eligiblePartner,
            excluded: proof.excludedPartner,
            partnerEvidenceDigest: proof.partnerEvidenceDigest,
          },
        };
      }
    } else if (approvedTransition) {
      reasons.push({
        code: 'APPROVED_TRANSITION_SIGNATURE_MISMATCH',
        transitionId: approvedTransition.id,
      });
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    previous,
    candidate: current,
    metrics: { revenueRatio, rowRatio },
    thresholds: { minTotalRatio },
    transition,
  };
}

module.exports = {
  // Xuất ra để `scripts/verify_frozen_periods.js` đọc thẳng số ghim kỳ đã khoá sổ,
  // KHÔNG phải chép tay sang chỗ khác (chép tay là có ngày hai nơi lệch rồi cãi nhau).
  APPROVED_RULE_TRANSITIONS,
  DEFAULT_MIN_TOTAL_RATIO,
  REQUIRED_SOURCES,
  evaluateRevenueCandidate,
  isEmptyMaterializerPlaceholder,
  canBootstrapFromInactivePlaceholders,
  noFollowOpenFlag,
  invalidSlotPeriods,
  selectCanonicalPeriodSlots,
  periodSlotsSnapshot,
  resolveApprovedRuleTransition,
  excludedRowsDigest,
  partnerEvidenceDigest,
};
