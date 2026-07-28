#!/usr/bin/env node
'use strict';
/**
 * DIỄN TẬP KHÔ tin Chi phí & Thưởng — CHẠY TRÊN SERVER THẬT, KHÔNG GỬI GÌ.
 *
 * VÌ SAO CẦN:
 *   Hai đường lấy số cho tin cuối tháng (`employeeCostSummaryForNotify` và
 *   `employeeBonusSummaryForNotify`) CHỈ chạy lúc 12:30 T7 / 17:30 / 17:40.
 *   Tính tới giờ chúng CHƯA HỀ chạy lần nào với dữ liệu thật. Nếu chúng ném lỗi,
 *   bộ lịch nuốt lỗi rồi bỏ qua NV đó — nghĩa là ĐÚNG NGÀY CHỐT THÁNG, cả công ty
 *   không nhận được gì mà không ai biết cho tới khi đã muộn.
 *   Script này chạy y hệt đường đó và IN RA TIN SẼ GỬI, nhưng không gửi.
 *
 * DÙNG:
 *   node scripts/test_notify_dryrun.js            # 3 NV đầu trong roster
 *   node scripts/test_notify_dryrun.js DN001      # đúng 1 NV
 *   node scripts/test_notify_dryrun.js --all      # toàn bộ roster
 *
 * TUYỆT ĐỐI KHÔNG gọi notifyChannels — không có đường nào gửi tin từ script này.
 */
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const p = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
})();

const store = require('../src/store');
const targetNotify = require('../src/targetNotify');
const bonusNotify = require('../src/bonusNotify');
const costNotify = require('../src/employeeCostNotify');

// Dịch mã lý do sang tiếng người + nói rõ phải làm gì.
const COST_SKIP_WHY = {
  no_session: 'không dựng được phiên cho mã NV này (sai mã, hoặc mã thuộc tài khoản quản trị — tin chi phí chỉ dành cho NV sale).',
  no_payload: 'không dựng được dữ liệu chi phí (lỗi nguồn hoặc kỳ không hợp lệ).',
  visibility_off: 'CÔNG TẮC "Chi phí của tôi" đang TẮT cho NV này -> đúng thiết kế, NV không được nhận tin. Muốn nhận thì bật công tắc trong app.',
};

function todayIso() { return new Date().toISOString().slice(0, 10); }

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const picked = args.filter((a) => /^(DN|VP)\d{3}$/i.test(a)).map((a) => a.toUpperCase());

  const services = require('../src/routes').notifyServices;
  if (!services) { console.error('❌ routes.notifyServices không có — sai bản code.'); process.exit(1); }

  const day = todayIso();
  const monthKey = day.slice(0, 7);
  const ky = `${monthKey.slice(5, 7)}.${monthKey.slice(0, 4)}`;
  const ev = targetNotify.evaluate({ ky });
  const rowByEmp = new Map(ev.rows.map((r) => [r.emp_code, r]));

  let codes = picked.length ? picked : ev.rows.map((r) => r.emp_code);
  if (!picked.length && !all) codes = codes.slice(0, 3);

  console.log('═'.repeat(72));
  console.log(`DIỄN TẬP KHÔ — KHÔNG GỬI TIN NÀO. Kỳ ${ky} · mốc ${day} · ${codes.length} NV`);
  console.log('═'.repeat(72));

  const problems = [];
  for (const code of codes) {
    console.log(`\n──────── ${code} ────────`);
    const row = { ...(rowByEmp.get(code) || { emp_code: code, name: code }), ky, from: `${monthKey}-01`, to: day };

    // 1) Tin tổng chi phí (bản CUỐI THÁNG — có thêm dòng số tạm giữ)
    try {
      const res = await services.employeeCostSummaryForNotify(code, { from: monthKey, to: monthKey });
      if (res?.skipped) {
        console.log(`  [CHI PHÍ] → BỎ QUA (${res.skipped}): ${COST_SKIP_WHY[res.skipped] || 'chưa rõ nguyên nhân'}`);
      } else if (!res) {
        console.log('  [CHI PHÍ] → bỏ qua: hàm trả rỗng ngoài dự kiến.');
      } else if (res.sourceAvailable === false) {
        console.log('  [CHI PHÍ] → gửi tin BÁO LỖI NGUỒN (không nêu số):');
        console.log('    ' + costNotify.unavailableMessageFor(row).replace(/\n/g, '\n    '));
      } else {
        const total = costNotify.totalFromSummary(res.summary);
        const annual = costNotify.annualFromSummary(res.summary);
        const t = Number(res.match?.totalRows); const m = Number(res.match?.matchedRows);
        const pairs = Number.isFinite(t) && Number.isFinite(m) ? t - m : null;
        const text = costNotify.messageFor({ kind: 'month', row, total, gaps: { pairs }, annual });
        if (!text) {
          console.log('  [CHI PHÍ] → KHÔNG GỬI: không có số dùng được (đúng thiết kế, không gửi 0đ).');
        } else {
          console.log('  [CHI PHÍ] tin sẽ gửi:');
          console.log('    ' + text.replace(/\n/g, '\n    '));
        }
      }
    } catch (e) {
      problems.push(`${code} CHI PHÍ: ${e.message}`);
      console.log(`  [CHI PHÍ] ❌ NÉM LỖI: ${e.message}`);
    }

    // 2) Tin tổng thưởng cuối tháng
    try {
      const res = await services.employeeBonusSummaryForNotify(code, ky);
      if (res?.skipped) {
        console.log(`  [THƯỞNG] → BỎ QUA (${res.skipped}): ${COST_SKIP_WHY[res.skipped] || 'chưa rõ nguyên nhân'}`);
      } else if (!res) {
        console.log('  [THƯỞNG] → bỏ qua: hàm trả rỗng ngoài dự kiến.');
      } else if (res.sourceAvailable === false) {
        console.log('  [THƯỞNG] → KHÔNG GỬI: thiếu nguồn chi phí, không hứa tiền.');
      } else {
        const text = bonusNotify.monthEndMessage(row, res.bonus);
        if (!text) console.log('  [THƯỞNG] → KHÔNG GỬI: chưa có số P1/P2 hợp lệ.');
        else {
          console.log('  [THƯỞNG] tin sẽ gửi:');
          console.log('    ' + text.replace(/\n/g, '\n    '));
        }
      }
    } catch (e) {
      problems.push(`${code} THƯỞNG: ${e.message}`);
      console.log(`  [THƯỞNG] ❌ NÉM LỖI: ${e.message}`);
    }
  }

  console.log('\n' + '═'.repeat(72));
  if (problems.length) {
    console.log(`❌ CÓ ${problems.length} LỖI — đường lấy số hỏng, ngày chốt tháng sẽ KHÔNG gửi được:`);
    for (const p of problems) console.log('   • ' + p);
    process.exitCode = 1;
  } else {
    console.log('✅ Không có lỗi. Đường lấy số chạy được — ngày chốt tháng sẽ gửi được.');
  }
  console.log('Nhắc lại: script này KHÔNG gửi tin nào.');
  console.log('═'.repeat(72));
}

main().catch((e) => { console.error('❌ Diễn tập lỗi:', e.stack || e.message); process.exit(1); });
