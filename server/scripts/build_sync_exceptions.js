#!/usr/bin/env node
/**
 * BẬT SỐNG MÀN "CHƯA ĐỒNG BỘ" — script RIÊNG, KHÔNG đụng materializer
 * (LENH_06082026.md §V-C · SPEC_REVENUE_SYNC_EXCEPTIONS.md)
 *
 *   node scripts/build_sync_exceptions.js --period 2026-07          # dry-run, chỉ in
 *   node scripts/build_sync_exceptions.js --period 2026-07 --write  # cân mới ghi store
 *
 * Nguyên tắc:
 *  1. CHỈ ĐỌC nguồn (App Sale DB) — không UPDATE/INSERT gì bên nguồn.
 *  2. Universe = TOÀN BỘ dòng của lần đồng bộ MISA thành công mới nhất của kỳ
 *     (KHÔNG lọc `revenue_bucket <> 'excluded'`, KHÔNG lọc ngày) + toàn bộ dòng
 *     đơn đối tác tạo trong kỳ (KỂ CẢ đơn huỷ / chưa phản hồi / giao 0 — chính là
 *     những dòng materializer không bao giờ nhìn thấy).
 *  3. `includedLineIds` lấy từ SLOT ACTIVE của kỳ (dữ liệu materializer đã ghi) —
 *     không tự tính lại "được nhận hay không".
 *  4. Bất biến: Σ(đưa vào) + Σ(loại) == Σ(nguồn) (tiền và số dòng). LỆCH ⇒ DỪNG,
 *     thoát mã 1, KHÔNG ghi store.
 *  5. Mã lý do CHỈ lấy từ `syncExceptionCatalog` qua classifier — script không đặt
 *     mã mới. Dòng không khớp luật nào ra `KHONG_RO` (cố ý lộ ra, không giấu).
 *  6. Kỳ ĐÃ KHOÁ SỔ: universe MISA neo theo run của slot (không hồi tố). Riêng phía
 *     ĐỐI TÁC truy vấn sống — nếu sau khoá sổ có phản hồi giao hàng mới thì tổng
 *     có thể lệch với slot ⇒ script DỪNG không ghi. Đó là script nói thật "nguồn
 *     đã trôi sau khoá sổ", không phải bug; kỳ đang chạy không gặp vì slot dựng
 *     lại mỗi 30 phút.
 *     Ghi chú: đơn đối tác BỊ HUỶ nhưng từng giao hàng sẽ ra `KHONG_RO` vì catalog
 *     chưa có mã "đơn huỷ" — đó là quyết định catalog/CEO, script không tự chế.
 *
 * Cơ sở tiền:
 *  - MISA: Math.round(invoice_export_amount) từng dòng — trùng cách materializer ghi slot.
 *  - Đối tác: Math.round(delivered_amount) từng dòng (cơ sở THỰC GIAO — đúng cơ sở
 *    doanh thu App Report dùng). Dòng chưa giao/chưa phản hồi có amount 0: vẫn hiện
 *    ra ĐỦ DÒNG với lý do, chỉ là không mang tiền theo cơ sở thực giao.
 */
const fs = require('fs');
const path = require('path');

const REPORT_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPORT_ROOT, 'server', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');

const { LATEST_MISA_RUN_SQL, PARTNER_COMMON_CTES, resolveCatalogVersion } = require('../src/appSaleRevenueMirror');
const { classifySyncExceptions } = require('../src/syncExceptionClassifier');
const syncCatalog = require('../src/syncExceptionCatalog');
const { buildSyncExceptionReport } = require('../src/syncExceptionReport');
const syncExceptionStore = require('../src/syncExceptionStore');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const PERIOD = arg('period', '');
const WRITE = process.argv.includes('--write');

const lastDayOf = (period) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0))
  .toISOString().slice(0, 10);
const round = (v) => Math.round(Number(v) || 0);
const vn = (v) => Number(v || 0).toLocaleString('vi-VN');

// ‼ TOÀN BỘ dòng của run — không lọc bucket, không lọc ngày. Dòng thiếu ngày /
// ngoài kỳ chính là thứ classifier phải nhìn thấy (MISA_THIEU_NGAY_DOANH_THU…).
const MISA_UNIVERSE_SQL = `SELECT l.id, l.sale_order_no, l.sale_order_date::text, l.invoice_date::text,
       l.unit_code, l.unit_name, l.qlnb_code,
       COALESCE(l.product_name, l.misa_product_name, '') product_name,
       COALESCE(l.employee_code,'') employee_code,
       COALESCE(l.invoice_export_amount,0)::numeric invoice_export_amount,
       l.revenue_bucket, l.revenue_status, l.mapping_status
  FROM misa_revenue_snapshot_lines l
 WHERE l.run_id = $1
 ORDER BY l.sale_order_date NULLS FIRST, l.sale_order_no, l.id`;

// Lấy run theo id (run mà slot đã dùng) — vẫn đòi status='success' cho chắc.
const RUN_BY_ID_SQL = `SELECT id, run_key, period_month::text, from_date::text, to_date::text,
       total_records, started_at, finished_at
  FROM misa_revenue_sync_runs
 WHERE id = $1::bigint AND status='success' LIMIT 1`;

// Universe đối tác: line_calc = MỌI dòng đơn PARTNER tạo trong kỳ, kể cả đơn huỷ
// (materializer chỉ thấy active_lines có delivered_amount>0). Các điều kiện cấu trúc
// source_system/entity_group/is_test/DRAFT nằm sẵn trong CTE dùng chung của App Sale
// — giữ nguyên byte để không tự chế nghĩa "đơn của kỳ".
const PARTNER_UNIVERSE_SQL = `${PARTNER_COMMON_CTES}
SELECT lc.order_id, lc.order_code, lc.order_item_id, o.created_at::text,
       lc.order_status, lc.is_cancelled, lc.has_response, lc.response_status,
       lc.ordered_qty, lc.delivered_qty, lc.unit_price,
       lc.placed_amount, lc.delivered_amount,
       COALESCE(u.code,'') unit_code, COALESCE(u.name,'') unit_name,
       COALESCE(p.qlnb_code,'') qlnb_code, COALESCE(p.name,'') product_name,
       COALESCE(e.code,'') employee_code
  FROM line_calc lc
  JOIN orders o ON o.id=lc.order_id
  JOIN order_items oi ON oi.id=lc.order_item_id
  LEFT JOIN units u ON u.id=o.unit_id
  LEFT JOIN products p ON p.id=oi.product_id
  LEFT JOIN employees e ON e.id=COALESCE(oi.employee_id,o.employee_id)
 ORDER BY o.created_at,o.id,oi.id`;

const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);

// Phần THUẦN (không DB) — tách riêng để test được: phân loại + phép cân.
function buildExceptionPayload({ period, sourceRows, slotRows, includedLineIds }) {
  const included = includedLineIds instanceof Set
    ? includedLineIds
    : new Set(slotRows.map((r) => String(r.source_line_id || '')).filter(Boolean));
  const exceptions = classifySyncExceptions({ period, sourceRows, includedLineIds: included });

  // Dòng nhóm NOTE (vd MISA_NGAY_NGOAI_KY — tiền thuộc kỳ khác) vẫn LIỆT KÊ để theo
  // dõi, nhưng không thuộc "nguồn của kỳ" nên đứng ngoài phép cân — nếu tính vào thì
  // kỳ nào có hoá đơn tháng khác lẫn trong run cũng vĩnh viễn không cân được.
  const noteLineIds = new Set(exceptions
    .filter((e) => syncCatalog.describe(e.code).group === syncCatalog.GROUPS.NOTE)
    .map((e) => String(e.lineId)));
  const balanceRows = sourceRows.filter((r) => !noteLineIds.has(String(r.source_line_id)));

  const sum = (rows, pick) => rows.reduce((acc, r) => acc + pick(r), 0);
  const sourceTotals = { amount: sum(balanceRows, (r) => round(r.revenue)), rows: balanceRows.length };
  const includedTotals = { amount: sum(slotRows, (r) => round(r.revenue)), rows: slotRows.length };
  const report = buildSyncExceptionReport({ period, source: sourceTotals, included: includedTotals, exceptions });
  return { exceptions, source: sourceTotals, included: includedTotals, report };
}

// Slot active của kỳ — nguồn sự thật cho "dòng nào ĐÃ được đưa vào doanh thu".
function activeSlotOf(ky) {
  const slots = readJson(path.join(DATA_DIR, 'upload_slots.json'), []).filter((s) => s.active && s.ky === ky);
  if (!slots.length) return null;
  // Nhiều slot active cùng kỳ là bất thường của store — báo chứ không đoán.
  if (slots.length > 1) throw new Error(`NHIEU_SLOT_ACTIVE_CUNG_KY:${ky}:${slots.map((s) => s.id).join(',')}`);
  const slot = slots[0];
  const rows = readJson(path.join(UP_DIR, `${slot.id}.json`), null);
  if (!Array.isArray(rows)) throw new Error(`SLOT_KHONG_DOC_DUOC:${slot.id}`);
  return { slot, rows };
}

async function main() {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(PERIOD)) {
    console.error('Cách dùng: node scripts/build_sync_exceptions.js --period YYYY-MM [--write]');
    process.exit(2);
  }
  const from = `${PERIOD}-01`;
  const to = lastDayOf(PERIOD);
  const ky = `${PERIOD.slice(5, 7)}.${PERIOD.slice(0, 4)}`;

  const slotData = activeSlotOf(ky);
  if (!slotData) {
    console.error(`⏭  Kỳ ${PERIOD} (ky=${ky}) chưa có slot active — chưa có "đưa vào" để đối chiếu. Chạy materialize trước.`);
    process.exit(2);
  }
  const slotRows = slotData.rows;
  const includedLineIds = new Set(slotRows.map((r) => String(r.source_line_id || '')).filter(Boolean));
  if (includedLineIds.size !== slotRows.length) {
    console.error(`⛔ Slot ${slotData.slot.id} có ${slotRows.length - includedLineIds.size} dòng thiếu/trùng source_line_id — không đối chiếu được. DỪNG.`);
    process.exit(1);
  }

  loadEnv(path.join(REPORT_ROOT, '.env'));
  const Pg = require('pg');
  const pool = new Pg.Pool(process.env.APPSALE_DATABASE_URL ? { connectionString: process.env.APPSALE_DATABASE_URL } : {
    host: process.env.APPSALE_PGHOST || process.env.PGHOST || 'localhost',
    port: Number(process.env.APPSALE_PGPORT || process.env.PGPORT || 5432),
    user: process.env.APPSALE_PGUSER || process.env.PGUSER,
    password: process.env.APPSALE_PGPASSWORD || process.env.PGPASSWORD,
    database: process.env.APPSALE_PGDATABASE || process.env.PGDATABASE,
  });

  // ‼ Universe MISA lấy theo ĐÚNG RUN slot đã dùng, KHÔNG phải run mới nhất.
  // Mã dòng `MISA:<id>` thuộc từng run — so slot run cũ với nguồn run mới là so hai
  // bộ mã khác nhau, kiểu gì cũng "lệch" giả. Với kỳ ĐÃ KHOÁ SỔ (vd T07 ghim từ run
  // #299, sau đó nguồn có #300/#301) tuyệt đối KHÔNG materialize lại (không hồi tố);
  // run mới chỉ in cảnh báo để biết, không phải lý do dừng. (Sửa 06/08 sau khi bot
  // chạy T07 bị chặn oan bởi bản đầu đòi "run mới nhất".)
  const slotRunId = String(slotData.slot.sourceRunId || slotData.slot.meta?.sourceRunId || '');
  let run; let latest; let misaRows; let webRows;
  try {
    latest = (await pool.query(LATEST_MISA_RUN_SQL, [from, to])).rows[0];
    if (slotRunId) {
      run = (await pool.query(RUN_BY_ID_SQL, [slotRunId])).rows[0];
      if (!run) {
        console.error(`⛔ Slot ghi dựng từ run #${slotRunId} nhưng run này không còn/không success trong nguồn — không đối chiếu được. DỪNG.`);
        process.exit(1);
      }
    } else {
      run = latest;
    }
    if (!run) {
      console.error(`⏭  Kỳ ${PERIOD} chưa có lần đồng bộ MISA thành công nào.`);
      process.exit(2);
    }
    if (latest && String(latest.id) !== String(run.id)) {
      console.log(`⚠ Nguồn đã có run mới #${latest.id} SAU khi slot dựng (#${run.id}). Phân loại theo đúng run #${run.id} của slot — kỳ đã khoá sổ thì KHÔNG hồi tố, kỳ đang chạy thì lần materialize kế sẽ tự bắt run mới.`);
    }
    const catalog = await resolveCatalogVersion(pool);
    [misaRows, webRows] = await Promise.all([
      pool.query(MISA_UNIVERSE_SQL, [run.id]).then((r) => r.rows),
      pool.query(PARTNER_UNIVERSE_SQL, [catalog.versionNo, from, to]).then((r) => r.rows),
    ]);
  } finally {
    await pool.end().catch(() => {});
  }

  // Map về đúng các trường classifier đọc; source_line_id trùng format slot ('MISA:<id>' / 'WEB:<item>').
  const sourceRows = [
    ...misaRows.map((r) => ({
      source: 'CRM_MISA',
      source_line_id: `MISA:${r.id}`,
      sale_order_no: r.sale_order_no,
      sale_order_date: r.sale_order_date,
      unit_code: r.unit_code,
      qlnb_code: r.qlnb_code,
      employee_code: r.employee_code,
      revenue: round(r.invoice_export_amount),
      invoice_export_amount: round(r.invoice_export_amount),
      revenue_bucket: r.revenue_bucket,
      revenue_status: r.revenue_status,
      mapping_status: r.mapping_status,
    })),
    ...webRows.map((r) => ({
      source: 'APP_WEB',
      source_line_id: `WEB:${r.order_item_id}`,
      order_code: r.order_code,
      created_at: r.created_at,
      date: String(r.created_at || '').slice(0, 10),
      status: r.order_status,
      entity_group: 'PARTNER',
      has_response: r.has_response === true,
      delivered_qty: Number(r.delivered_qty || 0),
      unit_code: r.unit_code,
      qlnb_code: r.qlnb_code,
      employee_code: r.employee_code,
      // Cơ sở THỰC GIAO: đơn huỷ từng giao vẫn mang tiền — đúng thứ cần lộ ra.
      revenue: round(r.delivered_amount),
      amount: round(r.delivered_amount),
      placed_amount: round(r.placed_amount),
    })),
  ];

  const { exceptions, source, included, report } = buildExceptionPayload({
    period: PERIOD, sourceRows, slotRows, includedLineIds,
  });

  console.log(`Kỳ ${PERIOD} · run MISA #${run.id} (${run.run_key || '—'}) · slot ${slotData.slot.id}`);
  console.log(`Nguồn:    ${vn(source.rows)} dòng · ${vn(source.amount)}đ  (MISA ${vn(misaRows.length)} + Web ${vn(webRows.length)})`);
  console.log(`Đưa vào:  ${vn(included.rows)} dòng · ${vn(included.amount)}đ`);
  console.log(`Bị loại:  ${vn(report.totals.excludedRows)} dòng · ${vn(report.totals.excludedAmount)}đ · thiếu thông tin: ${vn(report.totals.incompleteRows)} dòng · ghi chú: ${vn(report.totals.noteRows)} dòng`);
  console.log('');
  for (const entry of report.byCode) {
    console.log(`  ${entry.code.padEnd(28)} ${String(vn(entry.rows)).padStart(7)} dòng  ${String(vn(entry.amount)).padStart(16)}đ  · ${entry.meaning} · ${entry.owner} · ${entry.action}`);
  }
  if (report.unknownCodes.length) {
    console.log(`\n⚠ Mã ngoài catalog (phải khai báo thêm, KHÔNG tự chế trong script): ${report.unknownCodes.join(', ')}`);
  }

  if (report.balanced !== true) {
    console.error(`\n⛔ KHÔNG CÂN: lệch tiền ${vn(report.totals.amountDiff)}đ · lệch dòng ${vn(report.totals.rowDiff)}. Có dòng rơi ở chỗ chưa khai báo — DỪNG, KHÔNG ghi store.`);
    process.exit(1);
  }
  console.log(`\n✅ CÂN: Σ(đưa vào) + Σ(loại) == Σ(nguồn) — cả tiền lẫn số dòng.`);

  if (!WRITE) {
    console.log('Dry-run: chưa ghi gì. Thêm --write để ghi vào sync_exceptions store.');
    return;
  }
  const saved = syncExceptionStore.write(PERIOD, { runId: run.id, source, included, exceptions });
  console.log(`💾 Đã ghi ${saved.exceptions.length} dòng ngoại lệ cho kỳ ${PERIOD} (truncated=${saved.truncated}). Mở màn "Chưa đồng bộ" để kiểm.`);
}

if (require.main === module) {
  main().catch((error) => { console.error(`⛔ ${error.stack || error.message}`); process.exit(1); });
}

module.exports = { MISA_UNIVERSE_SQL, PARTNER_UNIVERSE_SQL, RUN_BY_ID_SQL, activeSlotOf, buildExceptionPayload };
