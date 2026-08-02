#!/usr/bin/env node
/**
 * Materialize current-period revenue for App Report from 2 App Sale sources:
 *  - CRM MISA snapshot read-model: invoice_export_amount, buckets official+pending
 *  - APP WEB partner delivered: latest partner response delivered_qty * order item price
 * Read-only against App Sale DB; writes only App Report server/data upload slot.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

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
} = require('../src/revenueMaterializeGuard');
const { REVENUE_SEMANTIC_VERSION, equivalentToActiveSlot } = require('../src/revenuePayloadIdentity');
const { atomicWriteFile, writeJsonAtomic, acquireFileLock } = require('../src/materializeFileSafety');

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

async function latestRun() {
  return (await pool.query(`SELECT id, finished_at, raw_summary FROM misa_revenue_sync_runs WHERE status='success' AND finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT 1`)).rows[0] || null;
}
async function fetchMisaDataQualityWarnings(runId) {
  const q = await pool.query(`
    SELECT l.id, l.sale_order_no, l.revenue_date, l.sale_order_date,
           l.employee_code, l.employee_name, l.unit_code, l.unit_name,
           COALESCE(l.invoice_export_amount,l.official_amount,0)::numeric amount,
           l.revenue_bucket, l.revenue_status, l.mapping_status
      FROM misa_revenue_snapshot_lines l
     WHERE l.run_id=$1
       AND l.revenue_bucket = ANY(ARRAY['official','pending']::text[])
       AND COALESCE(l.is_test_suspected,false) IS NOT TRUE
       AND l.revenue_date IS NULL
       AND COALESCE(l.invoice_export_amount,l.official_amount,0) <> 0
     ORDER BY l.sale_order_no, l.id`, [runId]);
  const items = q.rows.map((r) => ({
    source: 'CRM_MISA',
    source_line_id: `MISA:${r.id}`,
    sale_order_no: cleanCode(r.sale_order_no, ''),
    amount: Math.round(num(r.amount)),
    emp_code: cleanCode(r.employee_code, ''),
    emp_name: cleanCode(r.employee_name, ''),
    unit_code: cleanCode(r.unit_code, ''),
    unit_name: cleanCode(r.unit_name, ''),
    revenue_bucket: r.revenue_bucket,
    revenue_status: r.revenue_status,
    mapping_status: r.mapping_status || '',
    issue: 'MISA_REVENUE_DATE_NULL',
    action: 'Sửa revenue_date ở nguồn MISA/App Sale; App Report không tự lấy ngày đặt thay ngày doanh thu.',
  }));
  return { rows: items.length, totalAmount: items.reduce((sum, r) => sum + Number(r.amount || 0), 0), items };
}

async function fetchMisa(runId) {
  const q = await pool.query(`
    SELECT l.id, l.sale_order_no, l.revenue_date, l.sale_order_date, l.invoice_date,
           l.legal_entity_bucket, l.legal_entity_code, l.legal_entity_name,
           COALESCE(NULLIF(l.route,''),'') route,
           l.employee_code, l.employee_name,
           l.unit_code, l.unit_name,
           l.qlnb_code, COALESCE(l.product_name,l.misa_product_name,'') product_name,
           COALESCE(NULLIF(l.uom,''), p.uom, '') uom,
           COALESCE(l.delivered_qty,l.ordered_qty,0)::numeric quantity,
           COALESCE(l.invoice_export_amount,l.official_amount,0)::numeric revenue,
           COALESCE(l.unit_price,0)::numeric unit_price,
           COALESCE(NULLIF(p.goi_thau,''),'') bid_package,
           COALESCE(p.active_ingredient,'') active_ingredient, COALESCE(p.strength,'') strength,
           p.price bid_price, COALESCE(p.tech_rank,'') tech_rank,
           COALESCE(u.province,'') province,
           -- Tên pháp nhân ĐẦY ĐỦ: MISA dùng mã 01.DONA/02.AFP, còn legal_entities.code là DONAPHARM/AFP.
           -- Không có 1 khoá duy nhất -> dò le.code theo cả name/bucket/code (subquery LIMIT 1, tránh nhân đôi).
           COALESCE(NULLIF((
             SELECT le.name FROM legal_entities le
              WHERE le.code IN (l.legal_entity_name, split_part(l.legal_entity_name,'/',1),
                                l.legal_entity_bucket, l.legal_entity_code)
              ORDER BY (le.code = l.legal_entity_name) DESC,
                       (le.code = split_part(l.legal_entity_name,'/',1)) DESC,
                       (le.code = l.legal_entity_bucket) DESC LIMIT 1
           ),''), split_part(l.legal_entity_name,'/',1), l.legal_entity_name, '') legal_full_name,
           l.revenue_bucket, l.revenue_status, l.mapping_status
      FROM misa_revenue_snapshot_lines l
      LEFT JOIN products p ON p.id=l.product_id
      LEFT JOIN units u ON u.code = l.unit_code
     WHERE l.run_id=$1
       AND l.revenue_bucket = ANY(ARRAY['official','pending']::text[])
       AND COALESCE(l.is_test_suspected,false) IS NOT TRUE
       AND l.revenue_date >= $2::date
       AND l.revenue_date <= $3::date
       AND COALESCE(l.invoice_export_amount,l.official_amount,0) <> 0
     ORDER BY l.revenue_date, l.sale_order_no, l.id`, [runId, PERIOD.from, PERIOD.to]);
  return q.rows.map((r) => ({
    ky: PERIOD.ky, date: dateOnly(r.revenue_date) || PERIOD.from,
    source: 'CRM_MISA', source_order: r.sale_order_no, source_line_id: `MISA:${r.id}`,
    route: cleanCode(r.route, 'CL'), contractor_code: r.legal_entity_bucket || r.legal_entity_code || 'MISA',
    contractor_name: cleanCode(r.legal_full_name, r.legal_entity_name),
    emp_code: empCode(r.employee_code), emp_name: r.employee_name || '', raw_emp_code: r.employee_code || '',
    unit_code: cleanCode(r.unit_code, 'UNKNOWN_UNIT'), unit_name: cleanCode(r.unit_name, r.unit_code),
    iit_code: cleanCode(r.qlnb_code, 'UNKNOWN_PRODUCT'), product_name: cleanCode(r.product_name, r.qlnb_code),
    uom: r.uom || '', bid_package: r.bid_package || '', province: cleanCode(r.province, ''),
    active_ingredient: cleanCode(r.active_ingredient, ''), ham_luong: cleanCode(r.strength, ''),
    bid_price: (r.bid_price != null ? num(r.bid_price) : null), priority: cleanCode(r.tech_rank, ''),
    quantity: num(r.quantity), revenue: Math.round(num(r.revenue)), unit_price: num(r.unit_price),
    revenue_basis: 'MISA_INVOICE_EXPORTED', revenue_bucket: r.revenue_bucket, revenue_status: r.revenue_status,
    mapping_status: r.mapping_status || '',
  }));
}
async function fetchPartner() {
  const q = await pool.query(`
    WITH latest_response AS (
      SELECT r.*, row_number() OVER (PARTITION BY r.order_item_id ORDER BY r.responded_at DESC NULLS LAST, r.id DESC) rn
        FROM partner_order_line_responses r
    ), response_one AS (SELECT * FROM latest_response WHERE rn=1),
    monthly_recon AS (
      SELECT x.order_item_id::bigint order_item_id, SUM(COALESCE(l.sl_giao,0))::numeric delivered_qty,
             MAX(l.invoice_date) invoice_date, MAX(l.invoice_no) invoice_no
        FROM partner_monthly_reconciliation_lines l
        CROSS JOIN LATERAL unnest(l.order_item_ids) AS x(order_item_id)
       GROUP BY x.order_item_id
    ), partner AS (
      SELECT oi.id order_item_id, resp.invoice_no,
             CASE WHEN NULLIF(resp.invoice_no,'') IS NOT NULL THEN monthly.invoice_date ELSE NULL END invoice_date,
             resp.responded_at, resp.updated_at response_updated_at,
             COALESCE(resp.delivered_qty, resp.qty_delivered, monthly.delivered_qty, 0)::numeric delivered_qty,
             CASE
               WHEN NULLIF(resp.invoice_no,'') IS NOT NULL THEN COALESCE(monthly.invoice_date, (resp.responded_at AT TIME ZONE 'Asia/Bangkok')::date, (resp.updated_at AT TIME ZONE 'Asia/Bangkok')::date)
               WHEN resp.order_item_id IS NOT NULL THEN COALESCE((resp.responded_at AT TIME ZONE 'Asia/Bangkok')::date, (resp.updated_at AT TIME ZONE 'Asia/Bangkok')::date)
               WHEN COALESCE(monthly.delivered_qty, 0) > 0 THEN monthly.invoice_date
               ELSE NULL
             END effective_date
        FROM order_items oi
        LEFT JOIN response_one resp ON resp.order_item_id=oi.id
        LEFT JOIN monthly_recon monthly ON monthly.order_item_id=oi.id
    )
    SELECT oi.id order_item_id, o.id order_id, o.code order_no, o.created_at,
           COALESCE(partner.effective_date, (o.created_at AT TIME ZONE 'Asia/Bangkok')::date) revenue_date,
           COALESCE(u.route,o.route,'') route, COALESCE(u.province,'') province,
           COALESCE(c.code,'') contractor_code,
           -- Partner: le.name thường là nhóm rác "Đối tác khác" -> ưu tiên TÊN ĐỐI TÁC thật (c.name);
           -- chỉ dùng le.name khi nó là pháp nhân thật (không phải bucket "Đối tác khác").
           COALESCE(NULLIF(NULLIF(le.name,''),'Đối tác khác'), NULLIF(c.name,''), '') contractor_name,
           COALESCE(e.code,'') employee_code, COALESCE(e.name,'') employee_name,
           COALESCE(u.code,'') unit_code, COALESCE(u.name,'') unit_name,
           COALESCE(p.qlnb_code,'') qlnb_code, COALESCE(p.name,'') product_name, COALESCE(p.uom,'') uom,
           COALESCE(p.goi_thau,'') bid_package,
           COALESCE(p.active_ingredient,'') active_ingredient, COALESCE(p.strength,'') strength,
           p.price bid_price, COALESCE(p.tech_rank,'') tech_rank,
           COALESCE(oi.price,0)::numeric unit_price,
           COALESCE(partner.delivered_qty,0)::numeric delivered_qty,
           COALESCE(partner.delivered_qty,0)*COALESCE(oi.price,0)::numeric revenue
      FROM orders o
      JOIN order_items oi ON oi.order_id=o.id
      LEFT JOIN partner ON partner.order_item_id=oi.id
      LEFT JOIN units u ON u.id=o.unit_id
      LEFT JOIN contractors c ON c.id=COALESCE(oi.contractor_id,o.contractor_id)
      LEFT JOIN legal_entities le ON le.id=c.legal_entity_id
      LEFT JOIN employees e ON e.id=COALESCE(oi.employee_id,o.employee_id)
      LEFT JOIN products p ON p.id=oi.product_id
     WHERE o.source_system='APP_SALE'
       AND COALESCE(o.entity_group, oi.entity_group, '')='PARTNER'
       AND (COALESCE(o.is_test,false) IS NOT TRUE OR partner.responded_at IS NOT NULL)
       -- HOLD_GOLIVE là cờ kỹ thuật soft-launch/quota audit; nếu đối tác đã phản hồi
       -- và có SL giao thực thì vẫn là doanh thu đã giao. Không dùng cst_quota đang
       -- thiếu dữ liệu làm căn cứ loại doanh thu của nhân viên.
       -- Quy kỳ theo MỘT mốc ngày duy nhất: ngày quy kỳ/effective_date.
       -- Không lọc kép theo ngày đặt o.created_at; nếu không đơn đặt cuối T06 giao/phản hồi T07
       -- sẽ rơi khỏi cả hai kỳ và làm mất doanh thu.
       AND COALESCE(partner.effective_date, (o.created_at AT TIME ZONE 'Asia/Bangkok')::date) >= $1::date
       AND COALESCE(partner.effective_date, (o.created_at AT TIME ZONE 'Asia/Bangkok')::date) <= $2::date
       AND COALESCE(partner.delivered_qty,0) > 0
     ORDER BY COALESCE(partner.effective_date, (o.created_at AT TIME ZONE 'Asia/Bangkok')::date), o.id, oi.id`, [PERIOD.from, PERIOD.to]);
  return q.rows.map((r) => ({
    ky: PERIOD.ky, date: dateOnly(r.revenue_date) || PERIOD.from,
    source: 'APP_WEB_PARTNER', source_order: r.order_no, source_line_id: `WEB:${r.order_item_id}`,
    route: cleanCode(r.route, 'CL'), contractor_code: r.contractor_code || 'PARTNER', contractor_name: r.contractor_name || '',
    emp_code: empCode(r.employee_code), emp_name: r.employee_name || '', raw_emp_code: r.employee_code || '',
    unit_code: cleanCode(r.unit_code, 'UNKNOWN_UNIT'), unit_name: cleanCode(r.unit_name, r.unit_code),
    iit_code: cleanCode(r.qlnb_code, 'UNKNOWN_PRODUCT'), product_name: cleanCode(r.product_name, r.qlnb_code),
    uom: r.uom || '', bid_package: r.bid_package || '', province: cleanCode(r.province, ''),
    active_ingredient: cleanCode(r.active_ingredient, ''), ham_luong: cleanCode(r.strength, ''),
    bid_price: (r.bid_price != null ? num(r.bid_price) : null), priority: cleanCode(r.tech_rank, ''),
    quantity: num(r.delivered_qty), revenue: Math.round(num(r.revenue)), unit_price: num(r.unit_price),
    revenue_basis: 'PARTNER_DELIVERED',
  }));
}
async function main() {
  const releaseLock = acquireMaterializeLock();
  try {
  fs.mkdirSync(UP_DIR, { recursive: true });
  const slotsPath = path.join(DATA_DIR, 'upload_slots.json');
  const baselineSlots = readJson(slotsPath, []);
  const baselinePeriodSlots = selectCanonicalPeriodSlots(baselineSlots, PERIOD.ky);
  const baselinePeriodSnapshot = periodSlotsSnapshot(baselineSlots, PERIOD.ky);
  const baselineActiveSlots = baselinePeriodSlots.filter((s) => s.active);
  const baselineActiveIds = baselineActiveSlots.map((s) => String(s.id)).sort();
  const previousSlot = baselineActiveSlots.at(-1) || null;
  const bootstrapFromInactivePlaceholders = baselineActiveIds.length === 0
    && canBootstrapFromInactivePlaceholders({ slots: baselinePeriodSlots, uploadsDir: UP_DIR });
  const run = await latestRun();
  if (!run) throw new Error('NO_MISA_SUCCESS_SNAPSHOT');
  const misaDataQuality = await fetchMisaDataQualityWarnings(run.id);
  const misa = await fetchMisa(run.id);
  const partner = await fetchPartner();
  const sourceRunAfterRead = await latestRun();
  const sourceRows = [...misa, ...partner];
  // Không remap sang NV khác. Dòng nguồn xung đột roster hiện hành được cách ly
  // về UNALLOCATED để chặn lộ doanh thu sai cho NV cho đến khi App Sale sửa export.
  const roster = currentRosterSnapshot(rosterPeriod(PERIOD.ky));
  const guarded = quarantineRosterConflicts(sourceRows, roster, rosterPeriod(PERIOD.ky));
  const rows = guarded.rows;
  const total = rows.reduce((s, r) => s + num(r.revenue), 0);
  const sourceTotal = sourceRows.reduce((s, r) => s + num(r.revenue), 0);
  if (total !== sourceTotal) throw new Error(`ATTRIBUTION_GUARD_CHANGED_TOTAL:${sourceTotal}:${total}`);
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
  };
  const materializeGuard = evaluateRevenueCandidate({ previousSlot, candidate });
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
  if (identity.equivalent) {
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

  // Chỉ ghi file và đổi active slot SAU KHI guard đã pass. Nếu nguồn đang race/
  // mất dữ liệu, exception ở trên giữ nguyên slot tốt gần nhất trong production.
  fs.mkdirSync(artDir, { recursive: true });
  writeJson(file, rows);
  for (const s of commitSlots) if (s.ky === PERIOD.ky) s.active = false;
  commitSlots.push({
    id: slotId,
    ky: PERIOD.ky,
    dateFrom: PERIOD.from, dateTo: PERIOD.to,
    totalRows: rows.length, totalRevenue: total,
    empCount: new Set(rows.map((r) => r.emp_code).filter(Boolean)).size,
    filename: `${slotId}.json`, uploadedBy: 'SYSTEM', uploadedByName: 'CRM MISA + APP WEB materializer',
    payloadSha256: identity.candidateSha256,
    payloadSemanticSha256: identity.candidateSemanticSha256,
    payloadSemanticVersion: REVENUE_SEMANTIC_VERSION,
    uploadedAt: new Date().toISOString(), active: true,
    source: 'CRM_MISA_PLUS_APP_WEB',
    sourceRunId: String(run.id), sourceSnapshotFinishedAt: run.finished_at,
    sourceSummary: summaryBySource, data_as_of: process.env.REVENUE_DATA_AS_OF || new Date().toISOString(),
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
    },
    dataQualityWarnings: {
      misaMissingRevenueDate: misaDataQuality,
    },
  });
  writeJson(slotsPath, commitSlots);
  const artifact = {
    generatedAt: new Date().toISOString(), dataAsOf: process.env.REVENUE_DATA_AS_OF || new Date().toISOString(), slotId, file, ky: PERIOD.ky, latestMisaRun: { id: String(run.id), finished_at: run.finished_at, raw_summary: run.raw_summary },
    summary: { rows: rows.length, totalRevenue: total, bySource: summaryBySource, empCount: new Set(rows.map((r) => r.emp_code).filter(Boolean)).size, attributionConflicts: guarded.summary },
    materializeGuard: { status: 'passed', previousSlotId: previousSlot?.id || null, bootstrapMode: bootstrapFromInactivePlaceholders ? 'empty_system_placeholders' : null, metrics: materializeGuard.metrics || null, thresholds: materializeGuard.thresholds },
    dataQualityWarnings: { misaMissingRevenueDate: misaDataQuality },
    attributionConflicts: guarded.conflicts,
    samples: { misa: misa.slice(0, 10), partner: partner.slice(0, 10) },
  };
  writeJson(path.join(artDir, `revenue_2source_materialize_${PERIOD.ky.replace('.', '')}.json`), artifact);
  const md = [`# Revenue — CRM MISA + APP WEB`, '', `Generated: ${artifact.generatedAt}`, '', `MISA run: #${run.id}, finished_at=${run.finished_at}`, '', '| Source | Rows | Orders | Revenue |', '|---|---:|---:|---:|'];
  for (const [k, v] of Object.entries(summaryBySource)) md.push(`| ${k} | ${v.rows} | ${v.orders} | ${v.revenue} |`);
  md.push(`| TOTAL | ${rows.length} | — | ${total} |`, '', `Materialize guard: PASS; baseline=${previousSlot?.id || 'none'}; revenueRatio=${materializeGuard.metrics?.revenueRatio ?? 'n/a'}; rowRatio=${materializeGuard.metrics?.rowRatio ?? 'n/a'}.`, '', `Attribution guard: ${guarded.summary.rows} dòng / ${guarded.summary.units} đơn vị / ${guarded.summary.revenue}đ được đưa về UNALLOCATED do emp_code nguồn xung đột roster hoặc thuộc vai trò không được phân bổ doanh thu. Không remap sang NV khác.`, '', 'Rules:', '- CRM MISA: latest successful `misa_revenue_snapshot_lines`, `revenue_bucket in (official,pending)`, period `revenue_date`, amount `invoice_export_amount`.', '- APP WEB partner PA-A: latest `partner_order_line_responses` per order_item, period effective date only, `delivered_qty * price`, non-test, includes delivered `HOLD_GOLIVE` rows because HOLD_GOLIVE is a soft-launch/quota audit flag, not proof of undelivered goods.', '- PA-A trace: excludes carried-over Partner order `DT-260630-0115` (`1.960.000đ`) so WEB = `550.673.600đ`, matching old app snapshot #27.', '- Closed periods stay frozen; this script only creates/replaces active slot for the requested/current period.', '');
  const latestArtifactBase = `revenue_2source_materialize_${PERIOD.ky.replace('.', '')}`;
  atomicWriteFile(path.join(artDir, `${latestArtifactBase}.md`), md.join('\n'));
  writeJson(path.join(artDir, `${latestArtifactBase}_${slotId}.json`), artifact);
  atomicWriteFile(path.join(artDir, `${latestArtifactBase}_${slotId}.md`), md.join('\n'));
  console.log(JSON.stringify({ slotId, total, bySource: summaryBySource, rows: rows.length, attributionConflicts: guarded.summary, dataQualityWarnings: { misaMissingRevenueDate: { rows: misaDataQuality.rows, totalAmount: misaDataQuality.totalAmount } }, materializeGuard: { status: 'passed', previousSlotId: previousSlot?.id || null, metrics: materializeGuard.metrics || null } }, null, 2));
  await pool.end();
  } finally {
    releaseLock();
  }
}

// Cho phép require lại (tool đối soát) mà KHÔNG chạy materialize; chỉ chạy khi gọi trực tiếp.
module.exports = { main, fetchMisa, fetchMisaDataQualityWarnings, fetchPartner, latestRun, kyToRange, dateOnly, pool, PERIOD };

if (require.main === module) {
  main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
}
