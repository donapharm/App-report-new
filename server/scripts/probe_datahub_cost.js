#!/usr/bin/env node
/**
 * probe_datahub_cost.js — DÒ SỨC KHOẺ CỬA CHI PHÍ CỦA DATAHUB (CHỈ ĐỌC, không ghi gì).
 *
 * Vì sao cần: DataHub có NHIỀU CỬA, sống chết độc lập nhau —
 *   · cửa DANH MỤC   `/api/integrations/app-report/assignments/...`  ← huy hiệu xanh
 *     "Data Hub · Đã kết nối" trên màn Danh mục QL đọc cửa NÀY
 *   · cửa CHI PHÍ    `/api/integrations/app-report/employee-cost`    ← chỗ chết 19×503
 *     hôm 08/08 làm màn Chi phí trắng 0/21
 * Nhìn huy hiệu xanh mà kết luận "chi phí đã sống" là sai — script này hỏi ĐÚNG cửa chi phí.
 *
 * Dùng trên máy PROD (nơi có .env thật):
 *   node server/scripts/probe_datahub_cost.js            # dò 3 NV đầu roster
 *   node server/scripts/probe_datahub_cost.js DN001 DN002
 *   node server/scripts/probe_datahub_cost.js --all      # dò đủ roster (21 NV, tuần tự)
 *   node server/scripts/probe_datahub_cost.js --period 2026-08
 *
 * ‼ KHÔNG in khoá/token/PII: chỉ in mã NV, kết quả gọi, số dòng, danh sách TÊN CỘT.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.join(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return true;
}
loadEnv(path.join(SERVER_ROOT, '.env'));

const employeeCost = require(path.join(SERVER_ROOT, 'src', 'employeeCost'));
const employeeCostTemplates = require(path.join(SERVER_ROOT, 'src', 'employeeCostTemplates'));

function vnMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}`;
}

(async () => {
  const argv = process.argv.slice(2);
  const periodFlag = argv.indexOf('--period');
  const period = periodFlag >= 0 ? argv[periodFlag + 1] : vnMonth();
  const wantAll = argv.includes('--all');
  const explicit = argv.filter((item) => /^(DN|VP)\d{3}$/i.test(item)).map((item) => item.toUpperCase());

  const roster = [...employeeCost.parseEmployeeCostKeys(process.env.APP_REPORT_EMPLOYEE_COST_KEYS).keys()].sort();
  const baseUrl = employeeCost.resolveDataHubBaseUrl();

  console.log('=== DÒ CỬA CHI PHÍ DATAHUB (chỉ đọc) ===');
  console.log(`Kỳ dò          : ${period}  (giờ VN, GMT+7)`);
  console.log(`Cấu hình nguồn : baseUrl ${baseUrl ? 'CÓ' : 'THIẾU'} · assignment key ${process.env.DATA_HUB_ASSIGNMENT_KEY ? 'CÓ' : 'THIẾU'} · roster ${roster.length} NV`);
  if (!baseUrl || !roster.length) {
    console.log('\n⛔ THIẾU CẤU HÌNH — không phải lỗi DataHub. Kiểm .env (KHÔNG dán nội dung ra ngoài).');
    process.exit(2);
  }

  const targets = explicit.length ? explicit : wantAll ? roster : roster.slice(0, 3);
  console.log(`Sẽ dò          : ${targets.length} NV — ${targets.join(', ')}\n`);

  const results = [];
  // Gọi TUẦN TỰ: DataHub từng kẹt vì dồn tải, dò mà làm nguồn ngã thì phản tác dụng.
  for (const empCode of targets) {
    const startedAt = Date.now();
    let outcome = 'exception';
    let rowCount = 0;
    let columns = [];
    let message = '';
    try {
      const result = await employeeCost.fetchRawEmployeeCost(empCode, { from: period, to: period, timeoutMs: 20000 });
      outcome = String(result?.outcome || 'unknown');
      const periodPayload = (result?.payload?.periods || []).find((item) => item.period === period);
      rowCount = periodPayload?.rows?.length || 0;
      columns = (periodPayload?.columns || []).map((column) => String(column?.key || '').toLowerCase()).filter(Boolean);
    } catch (error) {
      message = String(error?.message || error).slice(0, 160);
    }
    const ms = Date.now() - startedAt;
    results.push({ empCode, outcome, rowCount, columns, ms });
    const mark = outcome === 'ok' && rowCount > 0 ? '✅' : outcome === 'ok' ? '⚠️ ' : '⛔';
    console.log(`${mark} ${empCode.padEnd(6)} ${outcome.padEnd(22)} ${String(rowCount).padStart(5)} dòng  ${String(ms).padStart(6)}ms  ${columns.length ? `cột: ${columns.join(',')}` : ''}${message ? `  ${message}` : ''}`);
  }

  const alive = results.filter((item) => item.outcome === 'ok' && item.rowCount > 0);
  const emptyOk = results.filter((item) => item.outcome === 'ok' && item.rowCount === 0);
  const dead = results.filter((item) => item.outcome !== 'ok');

  console.log('\n=== KẾT LUẬN ===');
  console.log(`Sống (có dòng) : ${alive.length}/${results.length}`);
  if (emptyOk.length) console.log(`Trả rỗng       : ${emptyOk.length} — nguồn trả lời nhưng KHÔNG có dòng nào cho kỳ này`);
  if (dead.length) {
    const byOutcome = {};
    for (const item of dead) byOutcome[item.outcome] = (byOutcome[item.outcome] || 0) + 1;
    console.log(`Hỏng           : ${dead.length} — ${Object.entries(byOutcome).map(([k, v]) => `${v}×${k}`).join(', ')}`);
  }

  if (alive.length) {
    // Có % thật thì kiểm luôn: nguồn đã trả C38/C42 chưa (CEO yêu cầu thêm 2 cột này
    // vào phân quyền 08/08). Thiếu ⇒ cột hiện '—', phải xin DataHub bổ sung.
    const seen = new Set(alive.flatMap((item) => item.columns));
    const template = employeeCostTemplates.resolveTemplate(alive[0].empCode);
    const missingCalc = template.costColumns.filter((key) => !seen.has(key));
    console.log(`\nCột nguồn trả  : ${[...seen].sort().join(', ') || '(không có)'}`);
    console.log(`Cột tính tiền  : ${missingCalc.length ? `⚠️  THIẾU ${missingCalc.join(', ')}` : '✅ đủ'}`);
    for (const key of template.viewOnlyColumns) {
      console.log(`Cột chỉ-để-xem : ${key.toUpperCase()} ${seen.has(key) ? '✅ nguồn có trả' : '⚠️  nguồn CHƯA trả — cột sẽ hiện "—", cần xin DataHub bổ sung'}`);
    }
  }

  console.log('\nBước tiếp theo:');
  if (alive.length === results.length) {
    console.log('  → Cửa chi phí ĐANG SỐNG và CÓ SỐ. CEO bấm "Đồng bộ % chi phí" (Danh mục QL) một lần để kho có bản đầu.');
  } else if (alive.length) {
    console.log('  → Có số MỘT PHẦN. Nút Đồng bộ là all-or-nothing nên sẽ BÁO LỖI và giữ nguyên bản cũ.');
    console.log('     Báo DataHub đúng danh sách NV chưa có số ở trên.');
  } else if (dead.length) {
    console.log('  → Cửa chi phí KHÔNG PHẢN HỒI. Huy hiệu xanh trên Danh mục QL là cửa DANH MỤC, không phải cửa này.');
  } else {
    console.log('  → Nguồn TRẢ LỜI BÌNH THƯỜNG nhưng KHÔNG NV nào có dòng cho kỳ này.');
    console.log('     Đây KHÔNG phải lỗi kết nối. Hai khả năng, phải phân biệt trước khi báo lỗi DataHub:');
    console.log(`       ① Kỳ ${period} bên DataHub CHƯA lập bảng % (bình thường với kỳ đang chạy).`);
    console.log('       ② Bảng % có nhưng không trả sang được (lỗi thật bên nguồn).');
    console.log('     ⇒ Chạy lại với kỳ TRƯỚC để phân biệt:  --all --period <kỳ trước>');
    console.log('       Kỳ trước CÓ số ⇒ ① (chờ DataHub lập bảng kỳ này). Kỳ trước cũng rỗng ⇒ ②.');
  }
  // ‼ Mã thoát nói về DỮ LIỆU DÙNG ĐƯỢC, không phải "gọi được hay không".
  // Bản đầu trả 0 khi mọi NV `ok` nhưng rỗng — đọc nhầm thành "đã khoẻ" (bot bắt được 08/08).
  //   0 = mọi NV có số · 1 = có NV không phản hồi · 2 = gọi được nhưng KHÔNG NV nào có số
  if (dead.length) process.exit(1);
  process.exit(alive.length === results.length ? 0 : 2);
})().catch((error) => {
  console.error('Lỗi chạy script:', String(error?.message || error));
  process.exit(3);
});
