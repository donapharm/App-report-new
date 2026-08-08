/**
 * VÁ LỖ HỔNG RESTORE (SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08/2026)
 * Kẹt KIỂU GÌ cũng phải rơi về bản tỷ lệ đã lưu — kể cả `not_configured`.
 * Vụ thật 08/08: nguồn chết diện rộng, màn Chi phí trắng 0/21 NV.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'employeeCost.js'), 'utf8');

test('mọi outcome kẹt đều thử restore — không còn nhánh nào bị loại trừ', () => {
  const rememberAt = SOURCE.indexOf("try { rateSnapshot.remember(empCode, result.payload, snapshotOptions); }");
  assert.ok(rememberAt >= 0, 'không tìm thấy nhánh remember');
  const block = SOURCE.slice(rememberAt, rememberAt + 1200);
  assert.match(block, /\} else if \(hasRange\) \{/, 'nhánh restore phải là else-if(hasRange) trần, không kèm điều kiện loại trừ');
  assert.doesNotMatch(block, /outcome !== 'not_configured'/,
    "bản cũ loại trừ not_configured ⇒ deploy hỏng cấu hình là màn trắng ngay dù kho còn số tốt");
  assert.match(block, /ok_stale_rates/);
});

test('restore không giấu gì: luôn gắn nhãn stale + mốc giờ (hợp đồng của rateSnapshot)', () => {
  const snapshotSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'employeeCostRateSnapshot.js'), 'utf8');
  assert.match(snapshotSource, /period\.rateStale = true;/);
  assert.match(snapshotSource, /period\.rateFetchedAt = kept\.fetchedAt;/);
  assert.match(snapshotSource, /rateStaleNote/);
});
