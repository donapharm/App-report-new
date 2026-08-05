#!/usr/bin/env node
'use strict';
/**
 * V2 — IN BẢNG KÊ KHOẢN MISA "ĐỀ NGHỊ GHI" ĐỂ KẾ TOÁN CHỈ TRẢ LỜI GHI / HUỶ.
 *
 *   node server/scripts/misa_pending_detail.js
 *   node server/scripts/misa_pending_detail.js --period=2026-07 --amount=3995000
 *   node server/scripts/misa_pending_detail.js --status="pending | Đề nghị ghi | "
 *   node server/scripts/misa_pending_detail.js --json
 *
 * Mã thoát:
 *   0 = in được bảng, tổng khớp số cần đối chiếu → dán cho kế toán
 *   1 = không tìm ra nhóm trạng thái khớp số, hoặc tổng lệch ⇒ ĐÃ IN BẢNG PHÂN NHÓM,
 *       chọn đúng trạng thái rồi chạy lại. KHÔNG gửi gì cho kế toán ở trạng thái này.
 *   2 = chưa đọc được dữ liệu
 *
 * ‼ CHỈ ĐỌC. Không ghi doanh số, không đổi trạng thái — việc ghi/huỷ do kế toán làm
 * trong MISA sau khi trả lời.
 */

const fs = require('fs');
const path = require('path');
const { groupByStatus, findGroupsMatching, buildDetail, auditTotals, formatGroups, formatDetail, statusKeyOf } = require('../src/misaPendingLedger');
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

const PERIOD = arg('period', '2026-07');            // kỳ đang treo khoản này
const AMOUNT = Number(arg('amount', '3995000'));    // số CEO đang hỏi
const STATUS = arg('status', '');                   // ép chọn nhóm khi đã biết tên
const lastDayOf = (period) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0))
  .toISOString().slice(0, 10);

/**
 * ‼ KHÔNG lọc `revenue_bucket <> 'excluded'` như bản mirror doanh thu.
 * Cả điểm của việc này là nhìn thấy các dòng ĐANG BỊ LOẠI — lọc mất là không còn gì
 * để hỏi kế toán.
 */
const ALL_LINES_SQL = `SELECT l.sale_order_no, l.sale_order_date::text, l.invoice_date::text,
       l.unit_code, l.unit_name, l.qlnb_code,
       COALESCE(l.product_name, l.misa_product_name, '') product_name,
       COALESCE(l.employee_code,'') employee_code, COALESCE(l.employee_name,'') employee_name,
       COALESCE(l.invoice_export_amount,0)::numeric invoice_export_amount,
       l.revenue_bucket, l.revenue_status, l.mapping_status
  FROM misa_revenue_snapshot_lines l
 WHERE l.run_id = $1
   AND l.sale_order_date >= $2::date
   AND l.sale_order_date <= $3::date
 ORDER BY l.sale_order_date, l.sale_order_no, l.id`;

async function main() {
  loadEnv(path.join(REPORT_ROOT, '.env'));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(PERIOD)) { console.error(`Kỳ không hợp lệ: ${PERIOD}`); process.exit(2); }
  const from = `${PERIOD}-01`;
  const to = lastDayOf(PERIOD);

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
    process.exit(2);
  }

  let lines = [];
  try {
    const run = (await pool.query(LATEST_MISA_RUN_SQL, [from, to])).rows[0];
    if (!run) {
      console.error(`⏭  Kỳ ${PERIOD} chưa có lần đồng bộ MISA nào thành công — chưa đọc được gì.`);
      await pool.end().catch(() => {}); process.exit(2);
    }
    lines = (await pool.query(ALL_LINES_SQL, [run.id, from, to])).rows || [];
    if (!process.argv.includes('--json')) {
      console.log(`Nguồn: misa_revenue_sync_runs #${run.id} (${run.run_key || '—'}) · ${run.total_records || '?'} bản ghi · ${lines.length} dòng trong kỳ\n`);
    }
  } catch (error) {
    console.error(`⏭  Truy vấn hỏng: ${error.message}`);
    await pool.end().catch(() => {}); process.exit(2);
  }
  await pool.end().catch(() => {});

  const groups = groupByStatus(lines);
  // Đã biết tên trạng thái thì dùng thẳng; chưa biết thì TÌM nhóm cộng đúng ra số.
  const chosen = STATUS
    ? groups.filter((group) => group.key === STATUS)
    : findGroupsMatching(groups, AMOUNT);

  if (chosen.length !== 1) {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ period: PERIOD, expected: AMOUNT, matched: chosen.length, groups }, null, 2));
    } else {
      if (chosen.length > 1) console.log(`⚠ Có ${chosen.length} nhóm cùng cộng ra ${AMOUNT.toLocaleString('vi-VN')}đ — phải chỉ đúng một.\n`);
      console.log(formatGroups(groups, AMOUNT));
    }
    process.exit(1);
  }

  const group = chosen[0];
  const rows = buildDetail(lines.filter((line) => statusKeyOf(line) === group.key), PERIOD);
  const audit = auditTotals(rows, STATUS ? group.amount : AMOUNT);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ period: PERIOD, group, audit, rows }, null, 2));
  } else {
    console.log(formatDetail({ rows, group, audit, period: PERIOD }));
  }
  process.exit(audit.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exit(2); });
}
