#!/usr/bin/env node
/**
 * diagnose_cost_source.js — TRẢ LỜI ĐÚNG BA CÂU CEO HỎI (09/08/2026), CHỈ ĐỌC.
 *
 * CEO: *"Rốt cuộc nó đang bị ẨN, hay bị KHÔNG KÉO ĐƯỢC từ bên App Sale về App Report,
 * hay là vấn đề gì đây?"* — ba nguyên nhân đó nằm ở BA CHỖ KHÁC NHAU, và mỗi chỗ có
 * dấu vết riêng đã ghi sẵn trên máy PROD. Script này đọc dấu vết đó, KHÔNG gọi mạng,
 * KHÔNG sửa gì, nên chạy lúc nào cũng an toàn:
 *
 *   ① DOANH THU (App Sale → App Report): đếm dòng doanh thu từng kỳ trong kho slot.
 *      Có dòng ⇒ đường App Sale KHÔNG đứt, dù màn chi phí có báo thiếu.
 *   ② TỶ LỆ % CHI PHÍ (cửa chi phí DataHub): đọc nhật ký `employee_cost_audit` —
 *      mỗi lần mở màn đều ghi lại `outcome` của từng NV. Đây là BẰNG CHỨNG đã xảy ra,
 *      không phải suy đoán, và phân biệt được ba kiểu hỏng khác hẳn nhau:
 *        · upstream_unavailable / upstream_5xx → cửa chi phí KHÔNG phản hồi
 *        · ok nhưng 0 dòng                      → cửa sống, DataHub CHƯA lập bảng % kỳ đó
 *        · invalid_period_payload               → có số nhưng ĐÓNG DẤU KỲ KHÁC ⇒ App Report
 *          từ chối (đúng lỗi contract `ky` đã nêu) — đây KHÔNG phải mất kết nối
 *        · ok_stale_rates                       → đang xài BẢN CŨ đã lưu, nguồn tươi đang kẹt
 *   ③ CON MẮT CHE SỐ: không nằm ở đây. Con mắt chỉ đổi chữ số thành "•••", KHÔNG bao
 *      giờ đổi chữ thành "Chưa đủ dữ liệu chi phí". Thấy chữ đó là dữ liệu thiếu thật.
 *
 * Dùng trên máy PROD:
 *   node server/scripts/diagnose_cost_source.js               # 24 giờ gần nhất
 *   node server/scripts/diagnose_cost_source.js --hours 72
 *
 * ‼ KHÔNG in token/khoá/PII — chỉ mã NV, mã kết quả, số đếm, mốc giờ (GMT+7).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.join(__dirname, '..');
const AUTH_DIR = process.env.AUTH_DATA_DIR || path.join(SERVER_ROOT, 'data', 'auth');

// ‼ Giờ VN (GMT+7) — CEO làm việc theo giờ này; in giờ UTC là gây lệch ngày.
const vnTime = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || '—');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(',', '');
};

const readJson = (file, def) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
};

const argv = process.argv.slice(2);
const hoursFlag = argv.indexOf('--hours');
const HOURS = hoursFlag >= 0 ? Math.max(1, Number(argv[hoursFlag + 1]) || 24) : 24;

console.log('=== CHẨN ĐOÁN NGUỒN CHI PHÍ (chỉ đọc, không gọi mạng) ===');
console.log(`Cửa sổ soi   : ${HOURS} giờ gần nhất · mọi mốc giờ dưới đây là GMT+7`);
// ‼ In ĐANG ĐỌC Ở ĐÂU. Bản release đặt file khác chỗ script đoán là ra bảng rỗng
// mà không ai biết vì sao — chẩn đoán tự nói dối thì tệ hơn không chẩn đoán.
console.log(`Thư mục dữ liệu: ${AUTH_DIR}${fs.existsSync(AUTH_DIR) ? '' : '  ⛔ KHÔNG TỒN TẠI — đặt AUTH_DATA_DIR trỏ đúng chỗ rồi chạy lại'}\n`);

/* ── ① DOANH THU: App Sale → App Report có đứt không ───────────────────────── */
let store = null;
try { store = require(path.join(SERVER_ROOT, 'src', 'store')); } catch (error) {
  console.log(`⚠️  Không nạp được store: ${String(error?.message || error).slice(0, 120)}`);
}
console.log('① DOANH THU (App Sale → App Report)');
if (store) {
  let kys = [];
  try { kys = store.periodKys ? store.periodKys() : []; } catch { kys = []; }
  if (!kys.length) { try { kys = [store.latestKy()]; } catch { kys = []; } }
  for (const ky of kys.slice(-4)) {
    let count = 0;
    let revenue = 0;
    try {
      const rows = store.getRows({ ky });
      count = rows.length;
      revenue = rows.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
    } catch (error) { console.log(`   ${ky}: lỗi đọc — ${String(error?.message || error).slice(0, 90)}`); continue; }
    // Số tiền in ở đây là TỔNG doanh thu của kỳ, không phải số của người nào —
    // đủ để kết luận "có dữ liệu hay không" mà không lộ chi tiết ai bán gì.
    console.log(`   ${ky}: ${count.toLocaleString('vi-VN')} dòng · tổng doanh thu ${Math.round(revenue).toLocaleString('vi-VN')} đ`);
  }
  console.log('   ⇒ Có dòng nghĩa là đường App Sale KHÔNG đứt. Màn chi phí báo thiếu là chuyện ở ② dưới đây.\n');
} else {
  console.log('   (bỏ qua)\n');
}

/* ── ② TỶ LỆ % CHI PHÍ: cửa chi phí DataHub ────────────────────────────────── */
console.log('② TỶ LỆ % CHI PHÍ (cửa chi phí DataHub) — theo nhật ký đã ghi');
const audit = readJson(path.join(AUTH_DIR, 'employee_cost_audit.json'), []);
if (!Array.isArray(audit) || !audit.length) {
  console.log('   Nhật ký rỗng — chưa ai mở màn Chi phí trên máy này, hoặc sai AUTH_DATA_DIR.\n');
} else {
  const since = Date.now() - HOURS * 3600 * 1000;
  const recent = audit.filter((row) => new Date(row?.at).getTime() >= since);
  const rows = recent.length ? recent : audit.slice(-200);
  if (!recent.length) console.log(`   (không có bản ghi trong ${HOURS} giờ — soi 200 bản ghi gần nhất)`);
  const byRange = new Map();
  for (const row of rows) {
    const range = row?.range ? `${row.range.from}→${row.range.to}` : '(không kỳ)';
    const key = `${range}${String(row?.outcome || 'unknown')}`;
    const cur = byRange.get(key) || { range, outcome: String(row?.outcome || 'unknown'), count: 0, emps: new Set(), last: '' };
    cur.count += 1;
    if (row?.empCode) cur.emps.add(String(row.empCode));
    if (!cur.last || String(row.at) > cur.last) cur.last = String(row.at);
    byRange.set(key, cur);
  }
  const list = [...byRange.values()].sort((a, b) => a.range.localeCompare(b.range) || b.count - a.count);
  console.log('   Kỳ                 Kết quả nguồn            Lượt      Số NV   Lần cuối (GMT+7)');
  for (const item of list) {
    const mark = item.outcome === 'ok' ? '✅' : item.outcome === 'ok_stale_rates' ? '🟡' : '⛔';
    console.log(`   ${mark} ${item.range.padEnd(17)} ${item.outcome.padEnd(24)} ${String(item.count).padStart(5)}   ${String(item.emps.size).padStart(5)}   ${vnTime(item.last)}`);
  }
  // Nói NGHĨA của từng mã, vì mã tiếng Anh không giúp CEO quyết định được việc gì.
  const seen = new Set(list.map((item) => item.outcome));
  console.log('\n   Nghĩa của các mã xuất hiện ở trên:');
  const MEANING = {
    ok: 'nguồn trả lời BÌNH THƯỜNG (còn có số hay không thì xem probe).',
    ok_stale_rates: 'đang dùng BẢN % CŨ đã lưu — nguồn tươi đang kẹt, số vẫn hiện nhưng là số cũ.',
    invalid_period_payload: '‼ nguồn CÓ trả số nhưng ĐÓNG DẤU KỲ KHÁC kỳ đã hỏi ⇒ App Report từ chối để không gán nhầm kỳ. ĐÂY LÀ LỖI CONTRACT `ky` BÊN DATAHUB, không phải mất mạng.',
    upstream_unavailable: 'cửa chi phí KHÔNG phản hồi (timeout/đứt) — lỗi kết nối thật.',
    upstream_unauthorized: 'khoá gọi nguồn bị từ chối (401) — cấu hình khoá, không phải dữ liệu.',
    not_configured: 'App Report CHƯA được cấu hình để gọi nguồn chi phí.',
    scope_mismatch: 'nguồn trả về dữ liệu của NV KHÁC với NV đã hỏi — chặn lại để không lộ chéo.',
    missing_emp: 'không xác định được mã NV khi gọi.',
  };
  for (const outcome of [...seen].sort()) {
    console.log(`     · ${outcome}: ${MEANING[outcome] || (outcome.startsWith('upstream_') ? `nguồn trả mã lỗi HTTP ${outcome.replace('upstream_', '')}.` : 'chưa có diễn giải — báo Claude bổ sung.')}`);
  }
  console.log('');
}

/* ── ③ KHO % CỤC BỘ: kỳ nào đã đồng bộ ─────────────────────────────────────── */
console.log('③ KHO % CỤC BỘ (bản đã đồng bộ, dùng cho menu Thành tiền/Tổng hợp)');
const warehouse = readJson(path.join(AUTH_DIR, 'cost_rates_local.json'), {});
const periods = Object.keys(warehouse || {}).sort();
if (!periods.length) console.log('   Chưa có kỳ nào — hai menu tiền sẽ báo "CHƯA đồng bộ".');
for (const period of periods) {
  const entry = warehouse[period] || {};
  const emps = Object.keys(entry.employees || {});
  const rows = emps.reduce((sum, emp) => sum + (entry.employees[emp]?.rows?.length || 0), 0);
  console.log(`   ${period}: ${emps.length} NV · ${rows.toLocaleString('vi-VN')} dòng % · đồng bộ ${vnTime(entry.fetchedAt)} bởi ${entry.fetchedBy || '—'}`);
}

console.log('\n=== VIỆC TIẾP THEO ===');
console.log('  · Thấy nhiều `invalid_period_payload` ⇒ báo DataHub sửa contract `ky` (trả đúng kỳ đã hỏi).');
console.log('  · Thấy `upstream_*` ⇒ cửa chi phí đang chết, chờ DataHub dựng lại rồi mở màn lại.');
console.log('  · Toàn `ok` mà màn vẫn báo thiếu ⇒ nguồn sống nhưng RỖNG: chạy');
console.log('      node server/scripts/probe_datahub_cost.js --all --period 2026-08');
console.log('      node server/scripts/probe_datahub_cost.js --all --period 2026-07');
console.log('    Kỳ trước có số mà kỳ này rỗng ⇒ DataHub chưa lập bảng % kỳ đang chạy.');
