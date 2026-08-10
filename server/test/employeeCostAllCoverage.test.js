const test = require('node:test');
const assert = require('node:assert/strict');
const employeeCostTable = require('../src/employeeCostTable');

const report = (empCode, matchedRows, totalRows, sourceOutcome) => ({
  empCode, sourceOutcome, from: '2026-07', to: '2026-07',
  periods: [{
    period: '2026-07', columns: [{ key: 'c36', label: 'CP ctv/khác (%)' }], rows: [],
    match: { matchedRows, totalRows, threshold: 90 },
    summary: { reliable: true },
  }],
});
const roster = [{ emp_code: 'DN001', name: 'A' }, { emp_code: 'DN002', name: 'B' }, { emp_code: 'DN003', name: 'C' }];

test('ALL coverage KHÔNG tính NV lỗi nguồn là "thiếu %" (khớp tab Mặt hàng thiếu %)', () => {
  const merged = employeeCostTable.mergeEmployeeReports([
    report('DN001', 600, 610, 'ok'),
    report('DN002', 649, 656, 'ok'),
    report('DN003', 0, 233, 'upstream_unavailable'),
  ], roster);
  const match = merged.periods[0].match;
  // Chỉ cộng NV lấy được nguồn → khớp đúng số của gap tool.
  assert.equal(match.matchedRows, 1249);
  assert.equal(match.totalRows, 1266);
  assert.equal(match.rate, 98.7);
  // Phần lỗi nguồn báo riêng, không trộn vào tỷ lệ thiếu %.
  assert.equal(match.unavailablePairs, 233);
  assert.equal(match.unavailableEmployeeCount, 1);
  // Còn NV chưa lấy được nguồn ⇒ tổng chưa đầy đủ ⇒ giữ trạng thái "tạm tính".
  assert.equal(merged.periods[0].summary.reliable, false);
});

test('mọi NV lấy được nguồn thì coverage đầy đủ và tổng được coi là tin cậy', () => {
  const merged = employeeCostTable.mergeEmployeeReports([
    report('DN001', 600, 610, 'ok'),
    report('DN002', 649, 656, 'ok'),
  ], roster);
  const match = merged.periods[0].match;
  assert.equal(match.unavailablePairs, 0);
  assert.equal(match.unavailableEmployeeCount, 0);
  assert.equal(merged.periods[0].summary.reliable, true);
});

/* ── Bản % cũ (`ok_stale_rates`) là SỐ DÙNG ĐƯỢC, không phải "chưa lấy được" ──
 * CEO 09/08/2026: "phần chi phí của các ô KPI khi thì kết nối đủ, khi thì báo
 * thiếu… bot cứ nhắn NV là chưa đủ dữ liệu." Gốc: lưới an toàn khôi phục bản %
 * đã lưu (`ok_stale_rates`) nhưng tầng gộp so `!== 'ok'` nên NV vừa được cứu số
 * xong vẫn bị tuyên "chưa lấy được" — màn chớp thiếu/đủ theo từng lượt gọi.   */

test('‼ ok_stale_rates được tính là CÓ SỐ — không rơi vào danh sách "chưa lấy được"', () => {
  const merged = employeeCostTable.mergeEmployeeReports([
    report('DN001', 600, 610, 'ok'),
    report('DN002', 649, 656, 'ok_stale_rates'),
  ], roster);
  const match = merged.periods[0].match;
  // NV xài bản cũ vẫn đóng góp coverage như thường.
  assert.equal(match.matchedRows, 1249);
  assert.equal(match.totalRows, 1266);
  assert.equal(match.unavailableEmployeeCount, 0, 'không được tuyên "chưa lấy được"');
  // Nhưng phải NÓI RA là số cũ — dùng được không có nghĩa là giấu.
  assert.deepEqual(match.staleEmployees, ['DN002']);
  assert.equal(match.staleEmployeeCount, 1);
  assert.equal(merged.periods[0].summary.reliable, true);
});

test('bản cũ KHÔNG được đóng dấu là chính sách hiệu lực của kỳ này', () => {
  const merged = employeeCostTable.mergeEmployeeReports([
    report('DN001', 600, 610, 'ok_stale_rates'),
  ], roster);
  // rateEffectiveFrom suy từ snapshot exact chỉ nhận outcome 'ok' thật.
  assert.equal(merged.periods[0].rateEffectiveFrom, '');
});

test('danh sách kết quả dùng được có ĐÚNG MỘT nơi định nghĩa (employeeCost.USABLE_OUTCOMES)', () => {
  const employeeCost = require('../src/employeeCost');
  // `before_go_live` vào danh sách 10/08/2026: kỳ trước 07/2026 chưa lên App Report,
  // đó là câu trả lời ĐÚNG VÀ ĐỦ chứ không phải sự cố — không được bôi đỏ NV vô can,
  // và không được kéo bộ nhớ đệm từ 6 giờ xuống 2 phút.
  assert.deepEqual([...employeeCost.USABLE_OUTCOMES], ['ok', 'ok_stale_rates', 'before_go_live']);
  assert.equal(employeeCost.isUsableOutcome('ok_stale_rates'), true);
  assert.equal(employeeCost.isUsableOutcome('before_go_live'), true);
  assert.equal(employeeCost.isUsableOutcome('upstream_unavailable'), false);
  // Tầng gộp phải hỏi qua hàm này, không tự so chuỗi.
  const fs = require('fs');
  const source = fs.readFileSync(require.resolve('../src/employeeCostTable'), 'utf8');
  assert.match(source, /employeeCost\.isUsableOutcome/);
});
