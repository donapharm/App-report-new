'use strict';

const { createHash } = require('crypto');

const APP_SALE_REVENUE_MIRROR_ID = 'APP_SALE_REVENUE_KPI_SQL_0E820022';
const APP_SALE_RELEASE = '0e820022814ef8a7f24d47c082446f3e40b17ebe';
const APP_SALE_SOURCE_SHA256 = '3b065456ed1e25b553c0554b97900a0ea2d89a17e9b487bfc5663fad14c220e0';
const APP_SALE_CATALOG_GUARD_SHA256 = 'eece0ab6cdd4317993578d21e910b2aafae5140be48d2c168defe3c203673bf2';
const CATALOG_REPRICE_CUTOFF = '2026-07-01';
const UNIT_PRODUCT_EMP_SYNC_SETTING_KEY = 'unit_product_employee_sync';
const UNIT_PRODUCT_EMP_MIN_PAIRS = 1_000;
const UNIT_PRODUCT_EMP_MAX_UNMAPPED_ROWS = 10;

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const number = (value) => Number(value || 0);

const LATEST_MISA_RUN_SQL = `SELECT id, run_key, period_month::text, from_date::text, to_date::text,
       pages_fetched, total_records, raw_fetched_count, started_at, finished_at, raw_summary
  FROM misa_revenue_sync_runs
 WHERE status='success'
   AND period_month=date_trunc('month',$1::date)::date
   AND from_date <= $2::date
   AND to_date >= $1::date
 ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`;

const CRM_KPI_SQL = `SELECT COUNT(*)::int rows,
       COUNT(DISTINCT sale_order_no)::int orders,
       COALESCE(SUM(invoice_export_amount),0)::numeric amount
  FROM misa_revenue_snapshot_lines
 WHERE run_id=$1
   AND sale_order_date >= $2::date
   AND sale_order_date <= $3::date
   AND revenue_bucket <> 'excluded'`;

const CRM_ROWS_SQL = `WITH nv_catalog AS (
  SELECT u.code unit_code, UPPER(BTRIM(m.qlnb_code)) qlnb_code,
         MIN(e.code) emp_code, MIN(e.name) emp_name,
         COUNT(DISTINCT e.code)::int nv_cnt
    FROM unit_qlnb_employees m
    JOIN units u ON u.id=m.unit_id
    JOIN employees e ON e.id=m.employee_id
   GROUP BY u.code,UPPER(BTRIM(m.qlnb_code))
)
SELECT l.id, l.sale_order_no, l.sale_order_date, l.invoice_date,
       l.legal_entity_bucket, l.legal_entity_code, l.legal_entity_name,
       COALESCE(NULLIF(l.route,''),'') route,
       COALESCE(NULLIF(CASE WHEN nc.nv_cnt=1 THEN nc.emp_code END,''),l.employee_code,'') employee_code,
       COALESCE(NULLIF(CASE WHEN nc.nv_cnt=1 THEN nc.emp_name END,''),l.employee_name,'') employee_name,
       l.unit_code, l.unit_name,
       l.qlnb_code, COALESCE(l.product_name,l.misa_product_name,'') product_name,
       COALESCE(NULLIF(l.uom,''),p.uom,'') uom,
       COALESCE(l.delivered_qty,l.ordered_qty,0)::numeric quantity,
       COALESCE(l.invoice_export_amount,0)::numeric revenue,
       COALESCE(l.unit_price,0)::numeric unit_price,
       COALESCE(NULLIF(p.goi_thau,''),'') bid_package,
       COALESCE(p.active_ingredient,'') active_ingredient,
       COALESCE(p.strength,'') strength,
       p.price bid_price, COALESCE(p.tech_rank,'') tech_rank,
       COALESCE(u.province,'') province,
       COALESCE(NULLIF((
         SELECT le.name FROM legal_entities le
          WHERE le.code IN (l.legal_entity_name,split_part(l.legal_entity_name,'/',1),
                            l.legal_entity_bucket,l.legal_entity_code)
          ORDER BY (le.code=l.legal_entity_name) DESC,
                   (le.code=split_part(l.legal_entity_name,'/',1)) DESC,
                   (le.code=l.legal_entity_bucket) DESC LIMIT 1
       ),''),split_part(l.legal_entity_name,'/',1),l.legal_entity_name,'') legal_full_name,
       l.revenue_bucket,l.revenue_status,l.mapping_status
  FROM misa_revenue_snapshot_lines l
  LEFT JOIN products p ON p.id=l.product_id
  LEFT JOIN units u ON u.code=l.unit_code
  LEFT JOIN nv_catalog nc ON nc.unit_code=l.unit_code AND nc.qlnb_code=l.qlnb_code
 WHERE l.run_id=$1
   AND l.sale_order_date >= $2::date
   AND l.sale_order_date <= $3::date
   AND l.revenue_bucket <> 'excluded'
 ORDER BY l.sale_order_date,l.sale_order_no,l.id`;

// Exact no-narrow-filter SQL core copied from App Sale PROD
// partnerWebOrderKpi() at OCI revision APP_SALE_RELEASE. Keep the status/date/
// response aggregation/catalog-price conditions byte-stable; the materializer
// projection below reuses this same CTE and verifies its sum against the exact KPI.
const PARTNER_COMMON_CTES = `WITH catalog_price_source AS (
  SELECT BTRIM(public_data->>'C7') unit_code,
         BTRIM(public_data->>'C5') qlnb_code,
         UPPER(BTRIM(COALESCE(public_data->>'C4',''))) contractor_code,
         CASE WHEN BTRIM(COALESCE(public_data->>'C31','')) ~ '^[0-9]+([.][0-9]+)?$'
              THEN (BTRIM(public_data->>'C31'))::numeric END price
    FROM admin_cp_total
   WHERE version_no=$1
), catalog_price_exact AS (
  SELECT unit_code,qlnb_code,contractor_code,MIN(price) price,COUNT(DISTINCT price)::int price_count
    FROM catalog_price_source WHERE price>0
   GROUP BY unit_code,qlnb_code,contractor_code
), catalog_price_uq AS (
  SELECT unit_code,qlnb_code,MIN(price) price,COUNT(DISTINCT price)::int price_count
    FROM catalog_price_source WHERE price>0
   GROUP BY unit_code,qlnb_code
), nv_catalog AS (
  SELECT u.code AS unit_code,UPPER(BTRIM(m.qlnb_code)) AS qlnb_code,
         MIN(e.code) AS emp_code,MIN(e.name) AS emp_name,
         COUNT(DISTINCT e.code) AS nv_cnt
    FROM unit_qlnb_employees m
    JOIN units u ON u.id=m.unit_id
    JOIN employees e ON e.id=m.employee_id
   GROUP BY u.code,UPPER(BTRIM(m.qlnb_code))
), line_base AS (
  SELECT o.id order_id,o.code order_code,o.status order_status,oi.id order_item_id,
         COALESCE(oi.approved_qty,oi.qty,0)::numeric ordered_qty,
         CASE WHEN o.created_at::date >= DATE '${CATALOG_REPRICE_CUTOFF}' THEN
                COALESCE(
                  CASE WHEN cpe.price_count=1 THEN cpe.price END,
                  CASE WHEN cpu.price_count=1 THEN cpu.price END,
                  COALESCE(oi.price,0)
                )
              ELSE COALESCE(oi.price,0)
         END::numeric unit_price,
         MAX(r.id) response_id,
         MAX(r.response_status) response_status,
         CASE WHEN MAX(r.id) IS NOT NULL THEN true ELSE false END has_response,
         CASE WHEN MAX(r.id) IS NOT NULL THEN
                COALESCE(MAX(r.delivered_qty),MAX(r.qty_delivered),
                         CASE WHEN MAX(r.response_status)='full' THEN COALESCE(oi.approved_qty,oi.qty,0) ELSE NULL END,0)
              ELSE 0 END::numeric delivered_qty,
         (LOWER(COALESCE(o.status,'')) LIKE '%huy%'
          OR LOWER(COALESCE(o.status,'')) LIKE '%hủy%'
          OR LOWER(COALESCE(o.status,'')) LIKE '%huỷ%'
          OR LOWER(COALESCE(o.status,'')) LIKE '%cancel%') AS is_cancelled
    FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    LEFT JOIN units u ON u.id=o.unit_id
    LEFT JOIN contractors c ON c.id=COALESCE(oi.contractor_id,o.contractor_id)
    LEFT JOIN products p ON p.id=oi.product_id
    LEFT JOIN employees e ON e.id=COALESCE(oi.employee_id,o.employee_id)
    LEFT JOIN nv_catalog nc ON nc.unit_code=u.code AND nc.qlnb_code=p.qlnb_code
    LEFT JOIN catalog_price_exact cpe ON cpe.unit_code=u.code AND cpe.qlnb_code=p.qlnb_code AND cpe.contractor_code=UPPER(COALESCE(c.code,''))
    LEFT JOIN catalog_price_uq cpu ON cpu.unit_code=u.code AND cpu.qlnb_code=p.qlnb_code
    LEFT JOIN partner_order_line_responses r ON r.order_id=o.id AND r.order_item_id=oi.id
   WHERE o.source_system='APP_SALE'
     AND o.entity_group='PARTNER'
     AND COALESCE(o.is_test,false) IS NOT TRUE
     AND COALESCE(o.status,'') <> 'DRAFT'
     AND o.created_at >= $2::date
     AND o.created_at < ($3::date + 1)
   GROUP BY o.id,o.code,o.status,oi.id,oi.price,oi.approved_qty,oi.qty,
            cpe.price_count,cpe.price,cpu.price_count,cpu.price
), line_calc AS (
  SELECT *,
         (ordered_qty*unit_price)::numeric placed_amount,
         (delivered_qty*unit_price)::numeric delivered_amount,
         (GREATEST(ordered_qty-delivered_qty,0)*unit_price)::numeric remaining_amount
    FROM line_base
), excluded AS (
  SELECT COUNT(DISTINCT order_id)::int orders,COALESCE(SUM(placed_amount),0)::numeric amount
    FROM line_calc WHERE is_cancelled
), active_lines AS (
  SELECT * FROM line_calc WHERE NOT is_cancelled
), order_calc AS (
  SELECT order_id,BOOL_OR(has_response) has_any_response,
         SUM(placed_amount)::numeric placed_amount,
         SUM(delivered_amount)::numeric delivered_amount,
         SUM(remaining_amount)::numeric remaining_amount
    FROM active_lines GROUP BY order_id
), totals AS (
  SELECT COUNT(*)::int total_orders,
         COALESCE(SUM(placed_amount),0)::numeric total_placed_amount,
         COUNT(*) FILTER (WHERE delivered_amount>0)::int delivered_orders,
         COALESCE(SUM(delivered_amount),0)::numeric delivered_amount,
         COUNT(*) FILTER (WHERE NOT has_any_response)::int no_response_orders,
         COALESCE(SUM(placed_amount) FILTER (WHERE NOT has_any_response),0)::numeric no_response_amount,
         COUNT(*) FILTER (WHERE has_any_response AND remaining_amount>0)::int debt_orders,
         COALESCE(SUM(remaining_amount) FILTER (WHERE has_any_response AND remaining_amount>0),0)::numeric debt_amount
    FROM order_calc
)`;

const PARTNER_KPI_SQL = `${PARTNER_COMMON_CTES}
SELECT t.*,e.orders excluded_cancelled_orders,e.amount excluded_cancelled_amount,
       (t.delivered_amount+t.no_response_amount+t.debt_amount)::numeric partition_total,
       (t.total_placed_amount-(t.delivered_amount+t.no_response_amount+t.debt_amount))::numeric delta
  FROM totals t CROSS JOIN excluded e`;

const PARTNER_ROWS_SQL = `${PARTNER_COMMON_CTES}
SELECT a.order_id,a.order_code,a.order_item_id,o.created_at,
       a.response_id,a.response_status,a.delivered_qty,a.unit_price,a.delivered_amount,
       COALESCE(u.route,o.route,'') route,COALESCE(u.province,'') province,
       COALESCE(c.code,'') contractor_code,
       COALESCE(NULLIF(NULLIF(le.name,''),'Đối tác khác'),NULLIF(c.name,''),'') contractor_name,
       COALESCE(NULLIF(CASE WHEN nc.nv_cnt=1 THEN nc.emp_code END,''),e.code,'') employee_code,
       COALESCE(NULLIF(CASE WHEN nc.nv_cnt=1 THEN nc.emp_name END,''),e.name,'') employee_name,
       COALESCE(u.code,'') unit_code,COALESCE(u.name,'') unit_name,
       COALESCE(p.qlnb_code,'') qlnb_code,COALESCE(p.name,'') product_name,COALESCE(p.uom,'') uom,
       COALESCE(p.goi_thau,'') bid_package,COALESCE(p.active_ingredient,'') active_ingredient,
       COALESCE(p.strength,'') strength,p.price bid_price,COALESCE(p.tech_rank,'') tech_rank
  FROM active_lines a
  JOIN orders o ON o.id=a.order_id
  JOIN order_items oi ON oi.id=a.order_item_id
  LEFT JOIN units u ON u.id=o.unit_id
  LEFT JOIN contractors c ON c.id=COALESCE(oi.contractor_id,o.contractor_id)
  LEFT JOIN legal_entities le ON le.id=c.legal_entity_id
  LEFT JOIN employees e ON e.id=COALESCE(oi.employee_id,o.employee_id)
  LEFT JOIN products p ON p.id=oi.product_id
  LEFT JOIN nv_catalog nc ON nc.unit_code=u.code AND nc.qlnb_code=p.qlnb_code
 WHERE a.delivered_amount>0
 ORDER BY o.created_at,o.id,oi.id`;

const SQL_SHA256 = Object.freeze({
  latestMisaRun: sha256(LATEST_MISA_RUN_SQL),
  crmKpi: sha256(CRM_KPI_SQL),
  crmRows: sha256(CRM_ROWS_SQL),
  partnerCommon: sha256(PARTNER_COMMON_CTES),
  partnerKpi: sha256(PARTNER_KPI_SQL),
  partnerRows: sha256(PARTNER_ROWS_SQL),
});

function safeNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validateCatalogMarker({ state, marker, canonicalPairs }) {
  if (state.versionNo == null || !state.signature || !marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
  const versionNo = safeNonNegativeInteger(marker.versionNo);
  const pairs = safeNonNegativeInteger(marker.pairs);
  const sourceRows = safeNonNegativeInteger(marker.sourceRows);
  const unmappedRows = safeNonNegativeInteger(marker.unmappedRows);
  const conflictPairs = safeNonNegativeInteger(marker.conflictPairs);
  const actualPairs = safeNonNegativeInteger(canonicalPairs);
  if ([versionNo,pairs,sourceRows,unmappedRows,conflictPairs,actualPairs].some((value) => value == null)) return null;
  if (versionNo !== state.versionNo || marker.signature !== state.signature) return null;
  if (pairs < UNIT_PRODUCT_EMP_MIN_PAIRS || sourceRows < UNIT_PRODUCT_EMP_MIN_PAIRS) return null;
  if (actualPairs !== pairs || unmappedRows > UNIT_PRODUCT_EMP_MAX_UNMAPPED_ROWS || conflictPairs !== 0) return null;
  if (pairs + unmappedRows > sourceRows || pairs/sourceRows < 0.999) return null;
  return { versionNo,pairs,sourceRows,unmappedRows,conflictPairs };
}

async function resolveCatalogVersion(db) {
  const stateRow = (await db.query(`SELECT v.version_no,COUNT(a.version_no)::text row_count,
      COALESCE(EXTRACT(EPOCH FROM MAX(a.updated_at))::text,'') max_updated_at
    FROM admin_cp_total_versions v
    LEFT JOIN admin_cp_total a ON a.version_no=v.version_no
   WHERE v.is_active
   GROUP BY v.version_no
   ORDER BY v.version_no DESC LIMIT 1`)).rows[0];
  const state = stateRow ? {
    versionNo: Number(stateRow.version_no),
    signature: `${stateRow.version_no}:${stateRow.row_count}:${stateRow.max_updated_at}`,
  } : { versionNo: null,signature: null };
  const marker = (await db.query(`SELECT value FROM system_settings WHERE key=$1`, [UNIT_PRODUCT_EMP_SYNC_SETTING_KEY])).rows[0]?.value || null;
  const canonicalPairs = Number((await db.query(`SELECT COUNT(DISTINCT (unit_id,UPPER(BTRIM(qlnb_code))))::int pairs
    FROM unit_qlnb_employees`)).rows[0]?.pairs || 0);
  const valid = validateCatalogMarker({ state,marker,canonicalPairs });
  if (!valid) throw new Error('APP_SALE_CATALOG_SYNC_GUARD_FAILED');
  return { ...valid,signature: state.signature };
}

async function latestMisaRun(from, to, db) {
  return (await db.query(LATEST_MISA_RUN_SQL, [from,to])).rows[0] || null;
}

async function fetchCrmMirror(runId, from, to, db) {
  const [kpiResult,rowsResult] = await Promise.all([
    db.query(CRM_KPI_SQL, [runId,from,to]),
    db.query(CRM_ROWS_SQL, [runId,from,to]),
  ]);
  const kpi = kpiResult.rows[0] || {};
  return {
    kpi: { rows: number(kpi.rows),orders: number(kpi.orders),revenue: number(kpi.amount) },
    rows: rowsResult.rows,
  };
}

async function fetchPartnerMirror(catalogVersionNo, from, to, db) {
  const params = [catalogVersionNo,from,to];
  const [kpiResult,rowsResult] = await Promise.all([
    db.query(PARTNER_KPI_SQL, params),
    db.query(PARTNER_ROWS_SQL, params),
  ]);
  const kpi = kpiResult.rows[0] || {};
  return {
    kpi: {
      rows: rowsResult.rows.length,
      orders: number(kpi.delivered_orders),
      revenue: number(kpi.delivered_amount),
      totalPlaced: number(kpi.total_placed_amount),
      noResponse: number(kpi.no_response_amount),
      debt: number(kpi.debt_amount),
      partition: number(kpi.partition_total),
      delta: number(kpi.delta),
      excludedCancelledOrders: number(kpi.excluded_cancelled_orders),
      excludedCancelledAmount: number(kpi.excluded_cancelled_amount),
    },
    rows: rowsResult.rows,
  };
}

function transitionEvidenceDigest(proof) {
  const canonical = {
    version: proof.version,
    mirrorId: proof.mirrorId,
    appSaleRelease: proof.appSaleRelease,
    appSaleSourceSha256: proof.appSaleSourceSha256,
    catalogGuardSha256: proof.catalogGuardSha256,
    ky: proof.ky,
    from: proof.from,
    to: proof.to,
    timeZone: proof.timeZone,
    dateFields: proof.dateFields,
    sourceRunId: String(proof.sourceRunId || ''),
    dbSnapshot: proof.dbSnapshot,
    snapshotCapturedAt: proof.snapshotCapturedAt,
    catalogVersionNo: Number(proof.catalogVersionNo),
    sqlSha256: proof.sqlSha256,
    projectionDigests: proof.projectionDigests,
    crm: proof.crm,
    partner: proof.partner,
    partnerKpi: proof.partnerKpi,
    includedTotal: proof.includedTotal,
  };
  return sha256(JSON.stringify(canonical));
}

module.exports = {
  APP_SALE_REVENUE_MIRROR_ID,
  APP_SALE_RELEASE,
  APP_SALE_SOURCE_SHA256,
  APP_SALE_CATALOG_GUARD_SHA256,
  CATALOG_REPRICE_CUTOFF,
  LATEST_MISA_RUN_SQL,
  CRM_KPI_SQL,
  CRM_ROWS_SQL,
  PARTNER_COMMON_CTES,
  PARTNER_KPI_SQL,
  PARTNER_ROWS_SQL,
  SQL_SHA256,
  validateCatalogMarker,
  resolveCatalogVersion,
  latestMisaRun,
  fetchCrmMirror,
  fetchPartnerMirror,
  transitionEvidenceDigest,
};
