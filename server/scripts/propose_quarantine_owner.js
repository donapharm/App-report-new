#!/usr/bin/env node
'use strict';
/**
 * V1 — TRA CHỦ CHO DÒNG BỊ CÁCH LY, in ra MỘT cái tên đề xuất kèm căn cứ.
 *
 * Chạy trên máy chủ App Report (nơi có đường vào DB App Sale):
 *
 *   node server/scripts/propose_quarantine_owner.js
 *   node server/scripts/propose_quarantine_owner.js --unit=120.HTNT-PHARMACITY \
 *        --order=DH479816174 --from=2026-06-01 --to=2026-08-31
 *   node server/scripts/propose_quarantine_owner.js --json
 *
 * Mã thoát:
 *   0 = có đề xuất rõ ràng (CEO gật là gán)
 *   1 = KHÔNG xác định được / hai nguồn chỏi nhau ⇒ cần người quyết
 *   2 = chưa đọc được dữ liệu (chưa kết luận được gì)
 *
 * ‼ CHỈ ĐỌC. Script này không UPDATE, không INSERT, không đổi phân công. Việc gán
 * thật do App Sale làm sau khi CEO gật — App Report không có quyền ghi vào đó.
 */

const fs = require('fs');
const path = require('path');
const { proposeOwner, formatProposal, diagnoseOrderPair } = require('../src/quarantineOwnerProposal');
const { LATEST_MISA_RUN_SQL } = require('../src/appSaleRevenueMirror');

const REPORT_ROOT = path.join(__dirname, '..', '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const arg = (name, fallback = '') => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// Mặc định đúng dòng CEO đang hỏi (LENH_05082026.md §V1). Đổi được qua tham số.
const UNIT = arg('unit', '120.HTNT-PHARMACITY');
const ORDER = arg('order', 'DH479816174');
const FROM = arg('from', '2026-06-01');
const TO = arg('to', '2026-08-31');

/**
 * Doanh thu của ĐÚNG đơn vị này, mọi trạng thái — kể cả dòng đang cách ly.
 *
 * ‼ SỬA 06/08 09:30 — bản đầu KHÔNG lọc `run_id`, nên gộp nhiều lần đồng bộ MISA vào
 * cùng một kết quả. Bot phát hiện bằng SQL thật: đơn `DH479816174` mặt hàng
 * `G1.GE.QĐ139.1104.N2.162` xuất hiện ở **run 330 (0đ) · run 331 (1.795.600đ) ·
 * run 364 (1.795.600đ)** ⇒ khối ③ cộng ra "3 dòng · 3.591.200đ" trong khi sự thật
 * theo run mới nhất (364) chỉ là **1 dòng · 1.795.600đ** — đúng bằng ô KPI.
 *
 * Nếu cứ thế giao cho App Sale thì họ thêm cặp phân công dựa trên con số GẤP ĐÔI.
 * Nay chỉ lấy **lần đồng bộ thành công MỚI NHẤT của TỪNG THÁNG**, đúng cách
 * `misa_pending_detail.js` đang làm.
 */
const UNIT_LINES_SQL = `SELECT l.sale_order_no, l.sale_order_date::text, l.unit_code, l.unit_name,
       l.qlnb_code, COALESCE(l.product_name, l.misa_product_name, '') product_name,
       COALESCE(l.employee_code,'') employee_code, COALESCE(l.employee_name,'') employee_name,
       COALESCE(l.invoice_export_amount,0)::numeric invoice_export_amount,
       l.run_id, l.revenue_bucket, l.revenue_status, l.mapping_status
  FROM misa_revenue_snapshot_lines l
 WHERE l.unit_code = $1
   AND l.sale_order_date >= $2::date
   AND l.sale_order_date <= $3::date
   AND l.run_id = ANY($4::bigint[])
 ORDER BY l.sale_order_date, l.sale_order_no, l.id`;

/** Các tháng chạm vào khoảng ngày đang tra, dạng 'YYYY-MM-01'. */
function monthsBetween(from, to) {
  const out = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  while (year * 12 + month <= last) {
    out.push(`${year}-${String(month).padStart(2, '0')}-01`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

const lastDayOfMonth = (firstDay) => new Date(Date.UTC(Number(firstDay.slice(0, 4)), Number(firstDay.slice(5, 7)), 0))
  .toISOString().slice(0, 10);

/** Bảng phân công chính thức của đơn vị (đúng CTE nv_catalog mà App Sale đang dùng). */
const UNIT_CATALOG_SQL = `SELECT u.code unit_code, p.qlnb_code,
       MIN(e.code) emp_code, MIN(e.name) emp_name, COUNT(DISTINCT e.code)::int nv_cnt
  FROM unit_product_employees upe
  JOIN units u ON u.id = upe.unit_id
  JOIN products p ON p.id = upe.product_id
  JOIN employees e ON e.id = upe.employee_id
 WHERE u.code = $1
 GROUP BY u.code, p.qlnb_code
 ORDER BY p.qlnb_code`;

async function main() {
  loadEnv(path.join(REPORT_ROOT, '.env'));
  let pool;
  try {
    const Pg = require('pg');
    pool = new Pg.Pool(process.env.APPSALE_DATABASE_URL ? { connectionString: process.env.APPSALE_DATABASE_URL } : {
      host: process.env.APPSALE_PGHOST || process.env.PGHOST || 'localhost',
      port: Number(process.env.APPSALE_PGPORT || process.env.PGPORT || 5432),
      user: process.env.APPSALE_PGUSER || process.env.PGUSER,
      password: process.env.APPSALE_PGPASSWORD || process.env.PGPASSWORD,
      database: process.env.APPSALE_PGDATABASE || process.env.PGDATABASE,
    });
  } catch (error) {
    console.error(`⏭  Không mở được kết nối DB App Sale: ${error.message}`);
    console.error('   CHƯA kết luận được gì — đây KHÔNG phải "không tra ra ai".');
    process.exit(2);
  }

  let lines = [];
  let catalogRows = [];
  const runs = [];
  const missingRuns = [];
  try {
    // ‼ Lấy lần đồng bộ THÀNH CÔNG MỚI NHẤT của từng tháng. Tháng nào không có thì
    // KỂ TÊN ra, không im lặng bỏ qua — thiếu một tháng là thiếu bằng chứng.
    for (const monthStart of monthsBetween(FROM, TO)) {
      const monthEnd = lastDayOfMonth(monthStart);
      const run = (await pool.query(LATEST_MISA_RUN_SQL, [monthStart, monthEnd])).rows[0];
      if (run) runs.push({ month: monthStart.slice(0, 7), id: Number(run.id), key: run.run_key || '' });
      else missingRuns.push(monthStart.slice(0, 7));
    }
    if (!runs.length) {
      console.error(`⏭  Không tháng nào trong ${FROM}…${TO} có lần đồng bộ MISA thành công — CHƯA kết luận được gì.`);
      await pool.end().catch(() => {});
      process.exit(2);
    }
    const [linesResult, catalogResult] = await Promise.all([
      pool.query(UNIT_LINES_SQL, [UNIT, FROM, TO, runs.map((run) => run.id)]),
      pool.query(UNIT_CATALOG_SQL, [UNIT]),
    ]);
    lines = linesResult.rows || [];
    catalogRows = catalogResult.rows || [];
  } catch (error) {
    console.error(`⏭  Truy vấn hỏng: ${error.message}`);
    console.error('   CHƯA kết luận được gì.');
    await pool.end().catch(() => {});
    process.exit(2);
  }
  await pool.end().catch(() => {});

  // ‼ Không có dòng nào ⇒ chưa chắc là "không ai bán đơn vị này"; có thể sai mã đơn
  // vị hoặc sai khoảng ngày. Nói rõ để người đọc kiểm lại tham số, đừng kết luận vội.
  if (!lines.length && !catalogRows.length) {
    console.error(`⏭  Đơn vị ${UNIT} không có dòng doanh thu nào trong ${FROM}…${TO}, cũng không có trong bảng phân công.`);
    console.error('   Kiểm lại mã đơn vị và khoảng ngày trước khi kết luận.');
    process.exit(2);
  }

  const result = proposeOwner({ unitCode: UNIT, orderCode: ORDER, lines, catalogRows });
  // ‼ Chỉ thẳng CẶP cần sửa, để App Sale khỏi phải tra thêm vòng nữa (hạn 08/08).
  result.pair = diagnoseOrderPair({ orderCode: ORDER, unitCode: UNIT, lines, catalogRows });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ unit: UNIT, order: ORDER, from: FROM, to: TO, runs, missingRuns, ...result }, null, 2));
  } else {
    console.log(formatProposal(result));
    console.log('');
    console.log(`(đã đọc ${lines.length} dòng doanh thu · ${catalogRows.length} dòng phân công · ${FROM}…${TO})`);
    console.log(`(chỉ lấy lần đồng bộ MISA mới nhất mỗi tháng: ${runs.map((run) => `${run.month}→run ${run.id}`).join(' · ')})`);
    if (missingRuns.length) console.log(`⚠ Tháng KHÔNG có lần đồng bộ thành công: ${missingRuns.join(', ')} — số dưới đây thiếu các tháng này.`);
  }
  process.exit(result.decision === 'PROPOSE' ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exit(2); });
}
