'use strict';

const Pg = require('pg');
const { resolveCatalogVersion, fetchPartnerMirror } = require('./appSaleRevenueMirror');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function num(value) { return Number(value || 0); }
function clean(value, fallback = '') { return String(value ?? fallback ?? '').trim(); }
function empCode(value) { const code = clean(value).toUpperCase(); return /^(DN|VP)\d{3}$/.test(code) ? code : 'UNALLOCATED'; }
function dateOnly(value) {
  if (typeof value === 'string') { const match = /^(\d{4}-\d{2}-\d{2})/.exec(value); if (match) return match[1]; }
  const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((out, part) => (out[part.type] = part.value, out), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function range(period) { const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period || '')); if (!match) fail('PARTNER_REVENUE_PERIOD_INVALID');
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}`, ky: `${match[2]}.${match[1]}` }; }
function project(rawRows, period) { const scope = range(period); return rawRows.map((row) => ({ ky: scope.ky,
  date: dateOnly(row.created_at) || scope.from, source: 'APP_WEB_PARTNER', source_order: clean(row.order_code),
  source_line_id: `WEB:${row.order_item_id}`, route: clean(row.route, 'CL'), contractor_code: clean(row.contractor_code, 'PARTNER'),
  contractor_name: clean(row.contractor_name), emp_code: empCode(row.employee_code), emp_name: clean(row.employee_name), raw_emp_code: clean(row.employee_code),
  unit_code: clean(row.unit_code, 'UNKNOWN_UNIT'), unit_name: clean(row.unit_name, row.unit_code), iit_code: clean(row.qlnb_code, 'UNKNOWN_PRODUCT'),
  product_name: clean(row.product_name, row.qlnb_code), uom: clean(row.uom), bid_package: clean(row.bid_package), province: clean(row.province),
  active_ingredient: clean(row.active_ingredient), ham_luong: clean(row.strength), bid_price: row.bid_price == null ? null : num(row.bid_price),
  priority: clean(row.tech_rank), quantity: num(row.delivered_qty), revenue: Math.round(num(row.delivered_amount)), unit_price: num(row.unit_price),
  revenue_basis: 'PARTNER_DELIVERED_APP_SALE_SQL_MIRROR' })); }
function summary(rows) { return { rows: rows.length, orders: new Set(rows.map((row) => `${row.source}:${row.source_order}`)).size,
  revenue: rows.reduce((sum, row) => sum + num(row.revenue), 0) }; }
function defaultPool(env = process.env) { return new Pg.Pool(env.APPSALE_DATABASE_URL ? { connectionString: env.APPSALE_DATABASE_URL } : {
  host: env.APPSALE_PGHOST || env.PGHOST || 'localhost', port: Number(env.APPSALE_PGPORT || env.PGPORT || 5432),
  user: env.APPSALE_PGUSER || env.PGUSER, password: env.APPSALE_PGPASSWORD || env.PGPASSWORD, database: env.APPSALE_PGDATABASE || env.PGDATABASE }); }
async function load(period, { db, env = process.env } = {}) {
  const scope = range(period); const ownedPool = db ? null : defaultPool(env); const client = db || await ownedPool.connect();
  try {
    if (!db) await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const catalog = await resolveCatalogVersion(client); const mirror = await fetchPartnerMirror(catalog.versionNo, scope.from, scope.to, client);
    const rows = project(mirror.rows, period); const actual = summary(rows);
    if (actual.rows !== mirror.kpi.rows || actual.orders !== mirror.kpi.orders || actual.revenue !== mirror.kpi.revenue || Math.abs(mirror.kpi.delta) > 0.000001) {
      fail('PARTNER_REVENUE_KPI_MISMATCH');
    }
    if (!db) await client.query('COMMIT'); return Object.freeze({ rows: Object.freeze(rows), kpi: Object.freeze(mirror.kpi), catalogVersion: catalog.versionNo });
  } catch (error) { if (!db) { try { await client.query('ROLLBACK'); } catch { /* preserve original */ } } throw error; }
  finally { if (!db) { client.release(); await ownedPool.end(); } }
}

module.exports = { range, dateOnly, project, summary, load };
