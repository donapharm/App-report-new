#!/usr/bin/env node
'use strict';
/**
 * SOÁT ĐẾM TRÙNG ĐƠN GIỮA CÁC KỲ — chạy trên dữ liệu THẬT (CEO chốt 30/07, việc 3).
 *
 * Dùng: node scripts/check_cross_period_duplicates.js 06.2026 07.2026
 *       node scripts/check_cross_period_duplicates.js            (mặc định: kỳ mới nhất + kỳ trước)
 *
 * CHỈ ĐỌC — không sửa, không ghi slot. Thoát mã 1 nếu có dòng trùng để dùng được
 * trong quy trình trước khi khoá sổ (ngày 8 tháng sau).
 */
const store = require('../src/store');
const crossPeriodDuplicates = require('../src/crossPeriodDuplicates');
const reconcile = require('../src/reconcile');

function main() {
  const args = process.argv.slice(2).filter(Boolean);
  let kys = args;
  if (!kys.length) {
    const latest = store.latestKy();
    const prev = (store.previousKys([latest]) || [])[0];
    kys = [prev, latest].filter(Boolean);
  }
  if (kys.length < 2) {
    console.error('❌ Cần ít nhất 2 kỳ để soát trùng chéo. Ví dụ: node scripts/check_cross_period_duplicates.js 06.2026 07.2026');
    process.exit(2);
  }
  // Đọc DÒNG GỐC của slot (có source_line_id), không dùng store.getRows vì bản đã
  // chuẩn hoá rụng mất khoá nhận dạng ⇒ guard sẽ tưởng mọi dòng đều không nhận dạng được.
  const rowsByKy = {};
  for (const ky of kys) {
    const slots = reconcile.activeSlotsForKy(ky) || [];
    rowsByKy[ky] = slots.flatMap((slot) => reconcile.rawSlotRows(slot) || []);
    if (!slots.length) console.error(`⚠ Kỳ ${ky}: không có slot active — không soát được kỳ này.`);
  }
  const result = crossPeriodDuplicates.scan(rowsByKy);

  console.log(`\n=== SOÁT ĐẾM TRÙNG CHÉO KỲ: ${kys.join(' · ')} ===`);
  for (const [ky, info] of Object.entries(result.perKy)) {
    console.log(`  ${ky}: ${info.rows.toLocaleString('vi-VN')} dòng · ${Math.round(info.revenue).toLocaleString('vi-VN')}đ`
      + `${info.unidentifiable ? ` · ⚠ ${info.unidentifiable} dòng không có khoá nhận dạng` : ''}`);
  }
  console.log('');
  console.log(crossPeriodDuplicates.summaryText(result));
  console.log('');
  console.log(JSON.stringify({
    kys: result.kys,
    status: result.status,
    duplicateCount: result.duplicateCount,
    doubleCountedRevenue: result.doubleCountedRevenue,
    unidentifiableCount: result.unidentifiableCount,
    // In tối đa 50 dòng để dán vào báo cáo mà không tràn.
    duplicates: result.duplicates.slice(0, 50),
  }, null, 2));
  // status 'unverifiable' KHÔNG được coi là pass: còn dòng chưa chứng minh được.
  process.exit(result.status === 'clean' ? 0 : 1);
}

main();
