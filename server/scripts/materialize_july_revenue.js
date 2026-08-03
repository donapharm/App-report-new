#!/usr/bin/env node
/**
 * Materialize current-period revenue by mirroring the exact App Sale PROD KPI SQL:
 *  - CRM invoice exported: sale_order_date, invoice_export_amount, official + pending
 *  - Partner delivered: orders.created_at, App Sale response aggregation and C31 price
 * Read-only against App Sale DB; writes only App Report server/data upload slot.
 */
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

const REPORT_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPORT_ROOT, 'server', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const ROSTER_FILE = process.env.CATALOG_MANAGEMENT_CACHE_FILE || path.join(DATA_DIR, 'catalog_management_lkg.json');
const { quarantineRosterConflicts } = require('../src/revenueAttributionGuard');
const {
  evaluateRevenueCandidate,
  canBootstrapFromInactivePlaceholders,
  invalidSlotPeriods,
  selectCanonicalPeriodSlots,
  periodSlotsSnapshot,
  resolveApprovedRuleTransition,
} = require('../src/revenueMaterializeGuard');
const { REVENUE_SEMANTIC_VERSION, equivalentToActiveSlot } = require('../src/revenuePayloadIdentity');
const { atomicWriteFile, writeJsonAtomic, acquireFileLock } = require('../src/materializeFileSafety');
const {
  safePayloadSha256,
  frozenPeriodFingerprints,
  createTransitionClaim,
  verifiedActivePayloadFingerprint,
} = require('../src/revenueTransitionSafety');
const {
  APP_SALE_REVENUE_MIRROR_ID,
  APP_SALE_RELEASE,
  APP_SALE_SOURCE_SHA256,
  APP_SALE_CATALOG_GUARD_SHA256,
  SQL_SHA256: APP_SALE_SQL_SHA256,
  resolveCatalogVersion,
  latestMisaRun,
  fetchCrmMirror,
  fetchPartnerMirror,
  transitionEvidenceDigest,
} = require('../src/appSaleRevenueMirror');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
// App Report owns its PostgreSQL driver and production connection settings.
// Do not depend on an App Sale source checkout/node_modules path: deployments may
// replace or remove that tree while the App Sale database remains healthy.
loadEnv(path.join(REPORT_ROOT, '.env'));
const Pg = require('pg');
const pool = new Pg.Pool(process.env.APPSALE_DATABASE_URL ? {
  connectionString: process.env.APPSALE_DATABASE_URL,
} : {
  host: process.env.APPSALE_PGHOST || process.env.PGHOST || 'localhost',
  port: Number(process.env.APPSALE_PGPORT || process.env.PGPORT || 5432),
  user: process.env.APPSALE_PGUSER || process.env.PGUSER,
  password: process.env.APPSALE_PGPASSWORD || process.env.PGPASSWORD,
  database: process.env.APPSALE_PGDATABASE || process.env.PGDATABASE,
});
const readJson = (p, def) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def;
const writeJson = writeJsonAtomic;
function acquireMaterializeLock() {
  return acquireFileLock(path.join(DATA_DIR, 'revenue_materialize.lock'));
}
const num = (v) => Number(v || 0);
const validEmp = (v) => /^(DN|VP)\d{3}$/.test(String(v || '').trim().toUpperCase());
function cleanCode(v, fallback = '') { return String(v || fallback || '').trim(); }
function empCode(v) { const s = String(v || '').trim().toUpperCase(); return validEmp(s) ? s : 'UNALLOCATED'; }
// Lấy NGÀY BÁN theo giờ VN (Asia/Bangkok, +07). TUYỆT ĐỐI KHÔNG dùng toISOString()
// (quy đổi UTC): đơn/doanh thu mốc 00:00 ngày 01/07 (+07) = 30/06 17:00Z → toISOString().slice
// sẽ trả 30/06, kéo TOÀN BỘ đơn đầu ngày lùi 1 ngày (đây là gốc lỗi "01/07 rớt xuống 30/06").
function dateOnly(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  return `${p.year}-${p.month}-${p.day}`;
}
function timestampIso(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
function pad(n) { return String(n).padStart(2, '0'); }
function kyToRange(ky) {
  const [mm, yyyy] = String(ky || '').split('.').map(Number);
  if (!mm || !yyyy) throw new Error(`INVALID_KY:${ky}`);
  const from = `${yyyy}-${pad(mm)}-01`;
  const last = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  return { ky: `${pad(mm)}.${yyyy}`, from, to: `${yyyy}-${pad(mm)}-${pad(last)}` };
}
function defaultKy() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(now).reduce((m, p) => (m[p.type] = p.value, m), {});
  return `${parts.month}.${parts.year}`;
}
const PERIOD = kyToRange(process.env.REVENUE_REFRESH_KY || process.env.MATERIALIZE_KY || defaultKy());
function buildSlotId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `rev_2src_${PERIOD.ky.replace('.', '')}_${stamp}_${process.pid}_${randomUUID()}`;
}
function rosterPeriod(ky) {
  const [mm, yyyy] = String(ky || '').split('.');
  return `${yyyy}-${mm}`;
}
function currentRosterSnapshot(period) {
  const value = readJson(ROSTER_FILE, null);
  const snapshot = value?.snapshots?.[period]
    || (value?.period === period && Array.isArray(value?.rows) ? value : null);
  if (!snapshot) throw new Error(`NO_CURRENT_ROSTER_SNAPSHOT:${period}`);
  return snapshot;
}

async function latestRun(db = pool) {
  return latestMisaRun(PERIOD.from, PERIOD.to, db);
}

function mapMisaMirrorRows(rawRows) {
  return rawRows.map((r) => ({
    ky: PERIOD.ky,
    date: dateOnly(r.sale_order_date) || PERIOD.from,
    source: 'CRM_MISA',
    source_order: cleanCode(r.sale_order_no, ''),
    source_line_id: `MISA:${r.id}`,
    route: cleanCode(r.route, 'CL'),
    contractor_code: r.legal_entity_bucket || r.legal_entity_code || 'MISA',
    contractor_name: cleanCode(r.legal_full_name, r.legal_entity_name),
    emp_code: empCode(r.employee_code),
    emp_name: r.employee_name || '',
    raw_emp_code: r.employee_code || '',
    unit_code: cleanCode(r.unit_code, 'UNKNOWN_UNIT'),
    unit_name: cleanCode(r.unit_name, r.unit_code),
    iit_code: cleanCode(r.qlnb_code, 'UNKNOWN_PRODUCT'),
    product_name: cleanCode(r.product_name, r.qlnb_code),
    uom: r.uom || '',
    bid_package: r.bid_package || '',
    province: cleanCode(r.province, ''),
    active_ingredient: cleanCode(r.active_ingredient, ''),
    ham_luong: cleanCode(r.strength, ''),
    bid_price: r.bid_price != null ? num(r.bid_price) : null,
    priority: cleanCode(r.tech_rank, ''),
    quantity: num(r.quantity),
    revenue: Math.round(num(r.revenue)),
    unit_price: num(r.unit_price),
    revenue_basis: 'MISA_INVOICE_EXPORTED',
    revenue_bucket: r.revenue_bucket,
    revenue_status: r.revenue_status,
    mapping_status: r.mapping_status || '',
  }));
}

async function fetchMisa(runId, db = pool) {
  const mirror = await fetchCrmMirror(runId, PERIOD.from, PERIOD.to, db);
  const rows = mapMisaMirrorRows(mirror.rows);
  const projection = projectionSummary(rows);
  if (projection.rows !== mirror.kpi.rows
    || projection.orders !== mirror.kpi.orders
    || projection.revenue !== mirror.kpi.revenue) {
    throw new Error(`APP_SALE_CRM_KPI_PROJECTION_MISMATCH:${JSON.stringify({ kpi: mirror.kpi, projection })}`);
  }
  return { rows, kpi: mirror.kpi };
}

function mapPartnerMirrorRows(rawRows) {
  return rawRows.map((r) => ({
    ky: PERIOD.ky,
    date: dateOnly(r.created_at) || PERIOD.from,
    source: 'APP_WEB_PARTNER',
    source_order: String(r.order_code || ''),
    source_line_id: `WEB:${r.order_item_id}`,
    route: cleanCode(r.route, 'CL'),
    contractor_code: r.contractor_code || 'PARTNER',
    contractor_name: r.contractor_name || '',
    emp_code: empCode(r.employee_code),
    emp_name: r.employee_name || '',
    raw_emp_code: r.employee_code || '',
    unit_code: cleanCode(r.unit_code, 'UNKNOWN_UNIT'),
    unit_name: cleanCode(r.unit_name, r.unit_code),
    iit_code: cleanCode(r.qlnb_code, 'UNKNOWN_PRODUCT'),
    product_name: cleanCode(r.product_name, r.qlnb_code),
    uom: r.uom || '',
    bid_package: r.bid_package || '',
    province: cleanCode(r.province, ''),
    active_ingredient: cleanCode(r.active_ingredient, ''),
    ham_luong: cleanCode(r.strength, ''),
    bid_price: r.bid_price != null ? num(r.bid_price) : null,
    priority: cleanCode(r.tech_rank, ''),
    quantity: num(r.delivered_qty),
    revenue: Math.round(num(r.delivered_amount)),
    unit_price: num(r.unit_price),
    revenue_basis: 'PARTNER_DELIVERED_APP_SALE_SQL_MIRROR',
  }));
}

async function fetchPartnerPartition(catalogVersionNo, db = pool) {
  const mirror = await fetchPartnerMirror(catalogVersionNo, PERIOD.from, PERIOD.to, db);
  const sourceRows = mapPartnerMirrorRows(mirror.rows);
  const projection = projectionSummary(sourceRows);
  if (projection.rows !== mirror.kpi.rows
    || projection.orders !== mirror.kpi.orders
    || projection.revenue !== mirror.kpi.revenue) {
    throw new Error(`APP_SALE_PARTNER_KPI_PROJECTION_MISMATCH:${JSON.stringify({ kpi: mirror.kpi, projection })}`);
  }
  if (Math.abs(mirror.kpi.delta) > 0.000001) {
    throw new Error(`APP_SALE_PARTNER_KPI_PARTITION_DELTA:${mirror.kpi.delta}`);
  }
  return {
    sourceRows,
    includedRows: sourceRows,
    exactKpi: mirror.kpi,
    projection,
    projectionDigest: projectionDigest(sourceRows),
  };
}

async function fetchPartner(db = pool) {
  const catalog = await resolveCatalogVersion(db);
  return (await fetchPartnerPartition(catalog.versionNo, db)).includedRows;
}

function projectionDigest(rows) {
  const canonical = [...rows].map((row) => ({
    sourceLineId: String(row.source_line_id || ''),
    date: String(row.date || ''),
    revenue: num(row.revenue),
  })).sort((a, b) => a.sourceLineId.localeCompare(b.sourceLineId));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function projectionSummary(rows) {
  return {
    rows: rows.length,
    orders: new Set(rows.map((row) => `${row.source || ''}:${row.source_order || ''}`)).size,
    revenue: rows.reduce((sum, row) => sum + num(row.revenue), 0),
  };
}

async function readSourceSnapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotResult = await client.query(`
      SELECT txid_current_snapshot()::text db_snapshot,
             transaction_timestamp() snapshot_captured_at`);
    const catalog = await resolveCatalogVersion(client);
    const run = await latestRun(client);
    if (!run) throw new Error('NO_MISA_SUCCESS_SNAPSHOT_FOR_APP_SALE_DATE_SCOPE');
    const misaMirror = await fetchMisa(run.id, client);
    const partnerPartition = await fetchPartnerPartition(catalog.versionNo, client);
    const misa = misaMirror.rows;
    const partner = partnerPartition.includedRows;
    const includedTotal = projectionSummary([...misa, ...partner]);
    const snapshotCapturedAtValue = snapshotResult.rows[0]?.snapshot_captured_at;
    const snapshotCapturedAt = snapshotCapturedAtValue instanceof Date
      ? snapshotCapturedAtValue.toISOString()
      : String(snapshotCapturedAtValue || '');
    const dbSnapshot = String(snapshotResult.rows[0]?.db_snapshot || '');
    const projectionDigests = {
      misa: projectionDigest(misa),
      partner: partnerPartition.projectionDigest,
      includedTotal: projectionDigest([...misa, ...partner]),
    };
    const sourceMirrorProof = {
      version: 1,
      mirrorId: APP_SALE_REVENUE_MIRROR_ID,
      appSaleRelease: APP_SALE_RELEASE,
      appSaleSourceSha256: APP_SALE_SOURCE_SHA256,
      catalogGuardSha256: APP_SALE_CATALOG_GUARD_SHA256,
      ky: PERIOD.ky,
      from: PERIOD.from,
      to: PERIOD.to,
      timeZone: 'Asia/Bangkok',
      dateFields: { crm: 'misa_revenue_snapshot_lines.sale_order_date', partner: 'orders.created_at' },
      sourceRunId: String(run.id),
      dbSnapshot,
      snapshotCapturedAt,
      catalogVersionNo: catalog.versionNo,
      sqlSha256: APP_SALE_SQL_SHA256,
      projectionDigests,
      crm: misaMirror.kpi,
      partner: partnerPartition.projection,
      partnerKpi: partnerPartition.exactKpi,
      includedTotal,
    };
    sourceMirrorProof.transitionEvidenceDigest = transitionEvidenceDigest(sourceMirrorProof);
    await client.query('COMMIT');
    const sourceRunAfterRead = await latestRun(pool);
    return {
      run,
      catalog,
      misa,
      partnerPartition,
      sourceRunAfterRead,
      dbSnapshot,
      snapshotCapturedAt,
      sourceMirrorProof,
      projectionDigests,
      projectionSummaries: {
        misa: misaMirror.kpi,
        partner: partnerPartition.projection,
        includedTotal,
      },
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const releaseLock = acquireMaterializeLock();
  try {
  fs.mkdirSync(UP_DIR, { recursive: true });
  const slotsPath = path.join(DATA_DIR, 'upload_slots.json');
  const approvedRuleTransition = resolveApprovedRuleTransition(
    process.env.REVENUE_RULE_TRANSITION_ID,
    process.env.REVENUE_RULE_EFFECTIVE_FROM,
  );
  const baselineSlots = readJson(slotsPath, []);
  const baselinePeriodSlots = selectCanonicalPeriodSlots(baselineSlots, PERIOD.ky);
  const baselinePeriodSnapshot = periodSlotsSnapshot(baselineSlots, PERIOD.ky);
  const frozenPeriodsBaseline = approvedRuleTransition
    ? frozenPeriodFingerprints(baselineSlots, approvedRuleTransition.frozenPeriods, UP_DIR)
    : null;
  const baselineActiveSlots = baselinePeriodSlots.filter((s) => s.active);
  const baselineActiveIds = baselineActiveSlots.map((s) => String(s.id)).sort();
  const previousSlot = baselineActiveSlots.at(-1) || null;
  const bootstrapFromInactivePlaceholders = baselineActiveIds.length === 0
    && canBootstrapFromInactivePlaceholders({ slots: baselinePeriodSlots, uploadsDir: UP_DIR });
  const {
    run,
    catalog,
    misa,
    partnerPartition,
    sourceRunAfterRead,
    dbSnapshot,
    snapshotCapturedAt,
    sourceMirrorProof,
    projectionDigests,
    projectionSummaries,
  } = await readSourceSnapshot();
  const partner = partnerPartition.includedRows;
  const sourceRows = [...misa, ...partner];
  // Không remap sang NV khác. Dòng nguồn xung đột roster hiện hành được cách ly
  // về UNALLOCATED để chặn lộ doanh thu sai cho NV cho đến khi App Sale sửa export.
  const roster = currentRosterSnapshot(rosterPeriod(PERIOD.ky));
  const guarded = quarantineRosterConflicts(sourceRows, roster, rosterPeriod(PERIOD.ky));
  const rows = guarded.rows;
  const total = rows.reduce((s, r) => s + num(r.revenue), 0);
  const sourceTotal = sourceRows.reduce((s, r) => s + num(r.revenue), 0);
  if (total !== sourceTotal) throw new Error(`ATTRIBUTION_GUARD_CHANGED_TOTAL:${sourceTotal}:${total}`);
  if (sourceMirrorProof.includedTotal.revenue !== total
    || sourceMirrorProof.crm.revenue + sourceMirrorProof.partner.revenue !== total) {
    throw new Error(`APP_SALE_MIRROR_TOTAL_INVARIANT_FAILED:${JSON.stringify({ proof: sourceMirrorProof.includedTotal, total })}`);
  }
  const bySource = rows.reduce((m, r) => { const x = m[r.source] ||= { rows: 0, orders: new Set(), revenue: 0 }; x.rows++; x.orders.add(r.source_order); x.revenue += num(r.revenue); return m; }, {});
  const summaryBySource = Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, { rows: v.rows, orders: v.orders.size, revenue: v.revenue }]));
  const requestedSlotId = String(process.env.JULY_SLOT_ID || '').trim().replace(/[^0-9A-Za-z._-]+/g, '-');
  const slotId = requestedSlotId ? `${requestedSlotId}_${process.pid}_${randomUUID()}` : buildSlotId();
  const candidate = {
    ky: PERIOD.ky,
    totalRows: rows.length,
    totalRevenue: total,
    sourceRunId: String(run.id),
    sourceRunIdAfterRead: String(sourceRunAfterRead?.id || ''),
    sourceSummary: summaryBySource,
    revenueRulePolicy: null,
    revenueSourceMirror: APP_SALE_REVENUE_MIRROR_ID,
    ruleTransitionProof: sourceMirrorProof,
  };
  const materializeGuard = evaluateRevenueCandidate({ previousSlot, candidate, approvedTransition: approvedRuleTransition });
  if (baselinePeriodSlots.length > 0 && baselineActiveIds.length === 0 && !bootstrapFromInactivePlaceholders) {
    materializeGuard.ok = false;
    materializeGuard.reasons.push({ code: 'MISSING_ACTIVE_SLOT', periodSlotIds: baselinePeriodSlots.map((s) => String(s.id)).sort() });
  }
  if (baselineActiveIds.length > 1) {
    materializeGuard.ok = false;
    materializeGuard.reasons.push({ code: 'MULTIPLE_ACTIVE_SLOTS', activeSlotIds: baselineActiveIds });
  }
  // Re-read the complete period state after the slow source queries. Active IDs
  // alone are insufficient: an inactive real/corrupt slot or a changed legacy
  // placeholder must also stop the commit.
  const commitSlots = readJson(slotsPath, []);
  const commitInvalidPeriods = invalidSlotPeriods(commitSlots);
  if (commitInvalidPeriods.length > 0) {
    materializeGuard.ok = false;
    materializeGuard.reasons.push({ code: 'INVALID_SLOT_PERIOD_METADATA_DURING_MATERIALIZE', invalidSlots: commitInvalidPeriods });
  }
  const commitPeriodSlots = commitSlots.filter((s) => s.ky === PERIOD.ky);
  if (approvedRuleTransition) {
    try {
      const frozenPeriodsCommit = frozenPeriodFingerprints(commitSlots, approvedRuleTransition.frozenPeriods, UP_DIR);
      if (JSON.stringify(frozenPeriodsCommit) !== JSON.stringify(frozenPeriodsBaseline)) {
        materializeGuard.ok = false;
        materializeGuard.reasons.push({
          code: 'FROZEN_PERIOD_CHANGED_DURING_MATERIALIZE',
          baseline: frozenPeriodsBaseline,
          latest: frozenPeriodsCommit,
        });
      }
    } catch (error) {
      materializeGuard.ok = false;
      materializeGuard.reasons.push({ code: 'FROZEN_PERIOD_RECHECK_FAILED', message: String(error.message || error) });
    }
  }
  if (periodSlotsSnapshot(commitSlots, PERIOD.ky) !== baselinePeriodSnapshot) {
    materializeGuard.ok = false;
    materializeGuard.reasons.push({
      code: 'PERIOD_SLOTS_CHANGED_DURING_MATERIALIZE',
      selectedSlotIds: baselinePeriodSlots.map((s) => String(s.id)).sort(),
      latestSlotIds: commitPeriodSlots.map((s) => String(s.id)).sort(),
    });
  }
  if (bootstrapFromInactivePlaceholders
    && !canBootstrapFromInactivePlaceholders({ slots: commitPeriodSlots, uploadsDir: UP_DIR })) {
    materializeGuard.ok = false;
    materializeGuard.reasons.push({ code: 'PLACEHOLDER_CHANGED_DURING_MATERIALIZE' });
  }
  const file = path.join(UP_DIR, `${slotId}.json`);
  if (commitSlots.some((s) => String(s.id) === slotId) || fs.existsSync(file)) {
    materializeGuard.ok = false;
    materializeGuard.reasons.push({ code: 'SLOT_ID_COLLISION', slotId, fileExists: fs.existsSync(file) });
  }
  const commitActiveIds = commitSlots.filter((s) => s.active && s.ky === PERIOD.ky).map((s) => String(s.id)).sort();
  if (JSON.stringify(commitActiveIds) !== JSON.stringify(baselineActiveIds)) {
    materializeGuard.ok = false;
    materializeGuard.reasons.push({
      code: 'ACTIVE_SLOT_CHANGED_DURING_MATERIALIZE',
      selectedBaseline: baselineActiveIds,
      latestBaseline: commitActiveIds,
    });
  }
  const artDir = path.join(REPORT_ROOT, 'artifacts');
  if (!materializeGuard.ok) {
    fs.mkdirSync(artDir, { recursive: true });
    const rejectedFile = path.join(artDir, `revenue_2source_rejected_${slotId}.json`);
    const rejection = {
      generatedAt: new Date().toISOString(),
      dataAsOf: process.env.REVENUE_DATA_AS_OF || new Date().toISOString(),
      slotId,
      latestMisaRun: { id: String(run.id), finished_at: run.finished_at },
      guard: materializeGuard,
    };
    writeJson(rejectedFile, rejection);
    const reasonCodes = materializeGuard.reasons.map((reason) => reason.code).join(',');
    console.error('[revenue-materialize-guard] rejected', JSON.stringify({ slotId, reasonCodes, rejectedFile, previous: materializeGuard.previous, candidate: materializeGuard.candidate }));
    const error = new Error(`REVENUE_MATERIALIZE_GUARD_REJECTED:${reasonCodes}`);
    error.code = 'REVENUE_MATERIALIZE_GUARD_REJECTED';
    error.auditFile = rejectedFile;
    throw error;
  }

  // Guard and active-slot race checks have passed. If the candidate business
  // payload is semantically identical, keep the current slot authoritative and
  // avoid another large upload/manifest/artifact generation. The scheduler's
  // run state remains a successful heartbeat and records this explicit skip.
  const identity = await equivalentToActiveSlot({ rows, activeSlot: previousSlot, uploadsDir: UP_DIR });
  if (identity.equivalent && !materializeGuard.transition) {
    // One-time metadata backfill means subsequent scheduler slots only stream-
    // verify the active bytes; they never parse the giant active JSON again.
    const committedActive = commitSlots.find((slot) => slot.active && String(slot.id) === String(previousSlot.id));
    if (committedActive && (!committedActive.payloadSha256
      || !committedActive.payloadSemanticSha256
      || Number(committedActive.payloadSemanticVersion) !== REVENUE_SEMANTIC_VERSION)) {
      committedActive.payloadSha256 = identity.activeSha256;
      committedActive.payloadSemanticSha256 = identity.activeSemanticSha256;
      committedActive.payloadSemanticVersion = REVENUE_SEMANTIC_VERSION;
      writeJson(slotsPath, commitSlots);
    }
    const unchanged = {
      ok: true,
      skipped: 'unchanged',
      activeSlotId: String(previousSlot.id),
      candidateSlotId: slotId,
      ky: PERIOD.ky,
      summary: {
        rows: rows.length,
        totalRevenue: total,
        bySource: summaryBySource,
        empCount: new Set(rows.map((row) => row.emp_code).filter(Boolean)).size,
        attributionConflicts: guarded.summary,
      },
      payloadSha256: identity.candidateSha256,
      payloadSemanticSha256: identity.candidateSemanticSha256,
      sourceRunId: String(run.id),
      checkedAt: new Date().toISOString(),
      materializeGuard: { status: 'passed', previousSlotId: previousSlot.id, metrics: materializeGuard.metrics || null },
    };
    console.log(JSON.stringify(unchanged, null, 2));
    await pool.end();
    return unchanged;
  }

  if (materializeGuard.transition) {
    // Consume the one-shot transition only after the active baseline bytes have
    // been parsed and independently matched to both byte and semantic metadata.
    const verifiedPayload = verifiedActivePayloadFingerprint(previousSlot, UP_DIR);
    const preClaimSlots = readJson(slotsPath, []);
    if (periodSlotsSnapshot(preClaimSlots, PERIOD.ky) !== baselinePeriodSnapshot) {
      throw new Error('PERIOD_SLOTS_CHANGED_BEFORE_TRANSITION_CLAIM');
    }
    const frozenPeriodsPreClaim = frozenPeriodFingerprints(
      preClaimSlots,
      approvedRuleTransition.frozenPeriods,
      UP_DIR,
    );
    if (JSON.stringify(frozenPeriodsPreClaim) !== JSON.stringify(frozenPeriodsBaseline)) {
      throw new Error('FROZEN_PERIOD_CHANGED_BEFORE_TRANSITION_CLAIM');
    }
    const claimFile = createTransitionClaim({
      transition: materializeGuard.transition,
      claimsDir: path.join(DATA_DIR, 'revenue_rule_transition_claims'),
      previousSlot,
      previousFingerprint: {
        slotMetadataSha256: createHash('sha256').update(JSON.stringify(previousSlot)).digest('hex'),
        ...verifiedPayload,
      },
      candidate,
      candidateSha256: identity.candidateSha256,
      candidateSemanticSha256: identity.candidateSemanticSha256,
      semanticVersion: REVENUE_SEMANTIC_VERSION,
      frozenPeriods: frozenPeriodsBaseline,
    });
    materializeGuard.transition.claim = {
      file: path.relative(REPORT_ROOT, claimFile),
      status: 'CONSUMED_AFTER_PAYLOAD_VERIFICATION_BEFORE_SLOT_WRITE',
    };
    materializeGuard.transition.frozenPeriods = frozenPeriodsBaseline;
  }

  // Chỉ ghi file và đổi active slot SAU KHI guard đã pass. Nếu nguồn đang race/
  // mất dữ liệu, exception ở trên giữ nguyên slot tốt gần nhất trong production.
  fs.mkdirSync(artDir, { recursive: true });
  writeJson(file, rows);
  for (const s of commitSlots) if (s.ky === PERIOD.ky) s.active = false;
  commitSlots.push({
    id: slotId,
    ky: PERIOD.ky,
    dateFrom: PERIOD.from,
    dateTo: PERIOD.to,
    totalRows: rows.length,
    totalRevenue: total,
    empCount: new Set(rows.map((r) => r.emp_code).filter(Boolean)).size,
    filename: `${slotId}.json`,
    uploadedBy: 'SYSTEM',
    uploadedByName: 'CRM MISA + APP WEB materializer',
    payloadSha256: identity.candidateSha256,
    payloadSemanticSha256: identity.candidateSemanticSha256,
    payloadSemanticVersion: REVENUE_SEMANTIC_VERSION,
    uploadedAt: new Date().toISOString(),
    active: true,
    source: 'CRM_MISA_PLUS_APP_WEB',
    sourceRunId: String(run.id),
    sourceSnapshotFinishedAt: run.finished_at,
    sourceSummary: summaryBySource,
    data_as_of: process.env.REVENUE_DATA_AS_OF || new Date().toISOString(),
    revenueSourceMirror: APP_SALE_REVENUE_MIRROR_ID,
    revenueSourceMirrorEvidence: {
      appSaleRelease: APP_SALE_RELEASE,
      appSaleSourceSha256: APP_SALE_SOURCE_SHA256,
      catalogGuardSha256: APP_SALE_CATALOG_GUARD_SHA256,
      catalogVersionNo: catalog.versionNo,
      from: PERIOD.from,
      to: PERIOD.to,
      timeZone: 'Asia/Bangkok',
      dateFields: sourceMirrorProof.dateFields,
      sqlSha256: APP_SALE_SQL_SHA256,
      dbSnapshot,
      snapshotCapturedAt,
      transitionEvidenceDigest: sourceMirrorProof.transitionEvidenceDigest,
      projections: projectionSummaries,
      partnerKpi: partnerPartition.exactKpi,
    },
    attributionPolicy: 'ROSTER_CONFLICT_TO_UNALLOCATED_NO_REMAP',
    attributionConflictRows: guarded.summary.rows,
    attributionConflictUnits: guarded.summary.units,
    attributionConflictRevenue: guarded.summary.revenue,
    rosterSource: roster.meta?.source || 'data-hub-lkg',
    rosterVersion: roster.meta?.version || null,
    rosterChecksum: roster.meta?.checksum || null,
    materializeGuard: {
      status: 'passed',
      previousSlotId: previousSlot?.id || null,
      bootstrapMode: bootstrapFromInactivePlaceholders ? 'empty_system_placeholders' : null,
      metrics: materializeGuard.metrics || null,
      thresholds: materializeGuard.thresholds,
      transition: materializeGuard.transition || null,
    },
  });
  writeJson(slotsPath, commitSlots);
  const artifact = {
    generatedAt: new Date().toISOString(),
    dataAsOf: process.env.REVENUE_DATA_AS_OF || new Date().toISOString(),
    slotId,
    file,
    ky: PERIOD.ky,
    latestMisaRun: { id: String(run.id),finished_at: run.finished_at,raw_summary: run.raw_summary },
    summary: {
      rows: rows.length,
      totalRevenue: total,
      bySource: summaryBySource,
      empCount: new Set(rows.map((r) => r.emp_code).filter(Boolean)).size,
      attributionConflicts: guarded.summary,
    },
    revenueSourceMirror: APP_SALE_REVENUE_MIRROR_ID,
    revenueSourceMirrorEvidence: {
      ...sourceMirrorProof,
      projectionDigests,
      partnerKpi: partnerPartition.exactKpi,
      invariant: {
        crmRevenue: projectionSummaries.misa.revenue,
        partnerRevenue: projectionSummaries.partner.revenue,
        includedRevenue: total,
      },
    },
    materializeGuard: {
      status: 'passed',
      previousSlotId: previousSlot?.id || null,
      bootstrapMode: bootstrapFromInactivePlaceholders ? 'empty_system_placeholders' : null,
      metrics: materializeGuard.metrics || null,
      thresholds: materializeGuard.thresholds,
      transition: materializeGuard.transition || null,
    },
    attributionConflicts: guarded.conflicts,
    samples: { misa: misa.slice(0,10),partner: partner.slice(0,10) },
  };
  writeJson(path.join(artDir, `revenue_2source_materialize_${PERIOD.ky.replace('.', '')}.json`), artifact);
  const md = [
    '# Revenue — exact App Sale SQL mirror',
    '',
    `Generated: ${artifact.generatedAt}`,
    '',
    `App Sale release: ${APP_SALE_RELEASE}`,
    `App Sale source SHA-256: ${APP_SALE_SOURCE_SHA256}`,
    `Mirror: ${APP_SALE_REVENUE_MIRROR_ID}`,
    `MISA run: #${run.id}, finished_at=${run.finished_at}`,
    `Date scope: ${PERIOD.from}..${PERIOD.to} (Asia/Bangkok)`,
    '',
    '| Source | Rows | Orders | Revenue |',
    '|---|---:|---:|---:|',
  ];
  for (const [k,v] of Object.entries(summaryBySource)) md.push(`| ${k} | ${v.rows} | ${v.orders} | ${v.revenue} |`);
  md.push(
    `| TOTAL MIRRORED | ${rows.length} | — | ${total} |`,
    '',
    `Exact KPI invariant: ${projectionSummaries.misa.revenue} + ${projectionSummaries.partner.revenue} = ${total} (PASS).`,
    `Snapshot: DB ${dbSnapshot}; captured ${snapshotCapturedAt}; catalog version ${catalog.versionNo}.`,
    `Transition evidence digest: ${sourceMirrorProof.transitionEvidenceDigest}.`,
    '',
    `Materialize guard: PASS; baseline=${previousSlot?.id || 'none'}; revenueRatio=${materializeGuard.metrics?.revenueRatio ?? 'n/a'}; rowRatio=${materializeGuard.metrics?.rowRatio ?? 'n/a'}.`,
    '',
    `Attribution guard: ${guarded.summary.rows} dòng / ${guarded.summary.units} đơn vị / ${guarded.summary.revenue}đ được đưa về UNALLOCATED; không đổi tổng và không remap sang NV khác.`,
    '',
    'Rules:',
    '- CRM: App Sale `sale_order_date`, official + pending (`revenue_bucket <> excluded`), `invoice_export_amount`.',
    '- Partner: App Sale `orders.created_at`, APP_SALE + PARTNER + non-test + non-DRAFT, include HOLD_GOLIVE, exclude huy/hủy/huỷ/cancel.',
    '- Partner delivered quantity and C31 catalog pricing are the exact App Sale `partnerWebOrderKpi()` CTE semantics.',
    '- No token, invoice number or manual_zalo eligibility exists in the App Report materialization path.',
    '- Closed T06/T07 periods remain frozen; only the active requested/current period can change.',
    '',
  );
  const latestArtifactBase = `revenue_2source_materialize_${PERIOD.ky.replace('.', '')}`;
  atomicWriteFile(path.join(artDir, `${latestArtifactBase}.md`), md.join('\n'));
  writeJson(path.join(artDir, `${latestArtifactBase}_${slotId}.json`), artifact);
  atomicWriteFile(path.join(artDir, `${latestArtifactBase}_${slotId}.md`), md.join('\n'));
  console.log(JSON.stringify({
    slotId,
    total,
    bySource: summaryBySource,
    rows: rows.length,
    revenueSourceMirror: APP_SALE_REVENUE_MIRROR_ID,
    sourceMirrorEvidence: {
      appSaleRelease: APP_SALE_RELEASE,
      catalogVersionNo: catalog.versionNo,
      sqlSha256: APP_SALE_SQL_SHA256,
      transitionEvidenceDigest: sourceMirrorProof.transitionEvidenceDigest,
    },
    attributionConflicts: guarded.summary,
    materializeGuard: {
      status: 'passed',
      previousSlotId: previousSlot?.id || null,
      metrics: materializeGuard.metrics || null,
      transition: materializeGuard.transition || null,
    },
  }, null, 2));
  await pool.end();
  } finally {
    releaseLock();
  }
}

// Cho phép require lại (tool đối soát) mà KHÔNG chạy materialize; chỉ chạy khi gọi trực tiếp.
module.exports = { main, fetchMisa, fetchPartner, fetchPartnerPartition, latestRun, readSourceSnapshot, projectionDigest, projectionSummary, kyToRange, dateOnly, pool, PERIOD };

if (require.main === module) {
  main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
}
