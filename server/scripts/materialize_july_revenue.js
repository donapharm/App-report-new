#!/usr/bin/env node
/**
 * Materialize current-period revenue for App Report New from 2 App Sale sources:
 *  - CRM MISA snapshot read-model: invoice_export_amount, buckets official+pending
 *  - APP WEB partner delivered: latest partner response delivered_qty * order item price
 * Read-only against App Sale DB; writes only App Report New server/data upload slot.
 */
const fs = require('fs');
const path = require('path');

const REPORT_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPORT_ROOT, 'server', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const APPSALE_ROOT = process.env.APPSALE_ROOT || '/home/osboxes/.openclaw/workspace-main/projects/appsale-donapharm-claude/source/appsale-donapharm';
const Pg = require(path.join(APPSALE_ROOT, 'node_modules', 'pg'));

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv(path.join(APPSALE_ROOT, '.env'));
const pool = new Pg.Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});
const readJson = (p, def) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def;
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8');
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
  return `rev_2src_${PERIOD.ky.replace('.', '')}_${stamp}`;
}

async function latestRun() {
  return (await pool.query(`SELECT id, finished_at, raw_summary FROM misa_revenue_sync_runs WHERE status='success' AND finished_at IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT 1`)).rows[0] || null;
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
       AND o.status <> 'HOLD_GOLIVE'
       AND (COALESCE(o.is_test,false) IS NOT TRUE OR partner.responded_at IS NOT NULL)
       -- PA-A / app cũ: kỳ WEB partner theo kỳ đơn đặt; đơn T06 giao sang T07
       -- vẫn thuộc nhóm theo dõi/còn nợ kỳ trước, không cộng vào doanh thu T07.
       AND o.created_at >= ($1::date::text || ' 00:00:00+07')::timestamptz
       AND o.created_at < (($2::date + INTERVAL '1 day')::date::text || ' 00:00:00+07')::timestamptz
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
  fs.mkdirSync(UP_DIR, { recursive: true });
  const run = await latestRun();
  if (!run) throw new Error('NO_MISA_SUCCESS_SNAPSHOT');
  const misa = await fetchMisa(run.id);
  const partner = await fetchPartner();
  const rows = [...misa, ...partner];
  const total = rows.reduce((s, r) => s + num(r.revenue), 0);
  const bySource = rows.reduce((m, r) => { const x = m[r.source] ||= { rows: 0, orders: new Set(), revenue: 0 }; x.rows++; x.orders.add(r.source_order); x.revenue += num(r.revenue); return m; }, {});
  const summaryBySource = Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, { rows: v.rows, orders: v.orders.size, revenue: v.revenue }]));
  const slotId = process.env.JULY_SLOT_ID || buildSlotId();
  const file = path.join(UP_DIR, `${slotId}.json`);
  writeJson(file, rows);
  const slotsPath = path.join(DATA_DIR, 'upload_slots.json');
  const slots = readJson(slotsPath, []);
  for (const s of slots) if (s.ky === PERIOD.ky) s.active = false;
  slots.push({
    id: slotId,
    ky: PERIOD.ky,
    dateFrom: PERIOD.from, dateTo: PERIOD.to,
    totalRows: rows.length, totalRevenue: total,
    empCount: new Set(rows.map((r) => r.emp_code).filter(Boolean)).size,
    filename: `${slotId}.json`, uploadedBy: 'SYSTEM', uploadedByName: 'CRM MISA + APP WEB materializer',
    uploadedAt: new Date().toISOString(), active: true,
    source: 'CRM_MISA_PLUS_APP_WEB',
    sourceRunId: String(run.id), sourceSnapshotFinishedAt: run.finished_at,
    sourceSummary: summaryBySource, data_as_of: process.env.REVENUE_DATA_AS_OF || new Date().toISOString(),
  });
  writeJson(slotsPath, slots);
  const artifact = {
    generatedAt: new Date().toISOString(), dataAsOf: process.env.REVENUE_DATA_AS_OF || new Date().toISOString(), slotId, file, ky: PERIOD.ky, latestMisaRun: { id: String(run.id), finished_at: run.finished_at, raw_summary: run.raw_summary },
    summary: { rows: rows.length, totalRevenue: total, bySource: summaryBySource, empCount: new Set(rows.map((r) => r.emp_code).filter(Boolean)).size },
    samples: { misa: misa.slice(0, 10), partner: partner.slice(0, 10) },
  };
  const artDir = path.join(REPORT_ROOT, 'artifacts'); fs.mkdirSync(artDir, { recursive: true });
  writeJson(path.join(artDir, `revenue_2source_materialize_${PERIOD.ky.replace('.', '')}.json`), artifact);
  const md = [`# Revenue — CRM MISA + APP WEB`, '', `Generated: ${artifact.generatedAt}`, '', `MISA run: #${run.id}, finished_at=${run.finished_at}`, '', '| Source | Rows | Orders | Revenue |', '|---|---:|---:|---:|'];
  for (const [k, v] of Object.entries(summaryBySource)) md.push(`| ${k} | ${v.rows} | ${v.orders} | ${v.revenue} |`);
  md.push(`| TOTAL | ${rows.length} | — | ${total} |`, '', 'Rules:', '- CRM MISA: latest successful `misa_revenue_snapshot_lines`, `revenue_bucket in (official,pending)`, period `revenue_date`, amount `invoice_export_amount`.', '- APP WEB partner PA-A: latest `partner_order_line_responses` per order_item, period effective date, period order creation date, `delivered_qty * price`, non-test, exclude HOLD_GOLIVE.', '- PA-A trace: excludes carried-over Partner order `DT-260630-0115` (`1.960.000đ`) so WEB = `550.673.600đ`, matching old app snapshot #27.', '- Closed periods stay frozen; this script only creates/replaces active slot for the requested/current period.', '');
  fs.writeFileSync(path.join(artDir, `revenue_2source_materialize_${PERIOD.ky.replace('.', '')}.md`), md.join('\n'));
  console.log(JSON.stringify({ slotId, total, bySource: summaryBySource, rows: rows.length }, null, 2));
  await pool.end();
}

// Cho phép require lại (tool đối soát) mà KHÔNG chạy materialize; chỉ chạy khi gọi trực tiếp.
module.exports = { main, fetchMisa, fetchPartner, latestRun, kyToRange, dateOnly, pool, PERIOD };

if (require.main === module) {
  main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
}
