'use strict';
// KHOÁ SỔ KỲ: HẾT NGÀY 8 THÁNG SAU (CEO chốt 2026-07-30).
//
// CEO: "dữ liệu từ ngày 05 tháng sau đổ về trước thì dùng từ DỰ KIẾN vì còn cập nhật
// lại doanh thu... đẹp nhất là trước ngày 08 cho rộng rãi để chốt" + "Phạt sẽ chốt
// sau ngày 08 tháng sau, khi đó câu tạm tính/dự kiến chuyển thành chính thức/chốt kỳ".
//
// Test khoá 4 việc:
//   1. Biên chính xác: hết ngày 8 vẫn CHƯA chốt, sang ngày 9 mới chốt.
//   2. Tính theo GIỜ VIỆT NAM, không theo giờ máy (server chạy UTC).
//   3. Không còn chỗ nào suy "đã chốt" bằng cách so tháng (lỗi cũ: chốt từ ngày 01).
//   4. Nhãn: trước khoá là DỰ KIẾN kèm ngày; sau khoá là SỐ CHÍNH THỨC; và phạt chỉ
//      `finalized` khi vừa trừ thật vừa đã khoá sổ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const employeeCost = require('../src/employeeCost');
const employeePenalty = require('../src/employeePenalty');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'));

test('ngày khoá sổ là ngày 8 tháng sau, kể cả kỳ tháng 12', () => {
  assert.equal(employeeCost.PERIOD_CLOSE_DAY, 8);
  assert.equal(employeeCost.periodCloseDate('2026-07'), '2026-08-08');
  assert.equal(employeeCost.periodCloseDate('2026-12'), '2027-01-08');
  assert.equal(employeeCost.periodCloseDate('07.2026'), '2026-08-08');
  assert.equal(employeeCost.periodCloseDate('rác'), '');
});

test('‼ biên khoá sổ: hết ngày 8 CHƯA chốt, sang ngày 9 MỚI chốt', () => {
  // Trong kỳ.
  assert.equal(employeeCost.isPeriodClosed('2026-07', '2026-07-30'), false);
  // Sang tháng mới nhưng chưa tới ngày khoá — LỖI CŨ chốt ngay tại đây.
  assert.equal(employeeCost.isPeriodClosed('2026-07', '2026-08-01'), false);
  assert.equal(employeeCost.isPeriodClosed('2026-07', '2026-08-05'), false);
  // Đúng ngày khoá vẫn còn cho cập nhật (hết ngày 8).
  assert.equal(employeeCost.isPeriodClosed('2026-07', '2026-08-08'), false);
  // Qua ngày khoá.
  assert.equal(employeeCost.isPeriodClosed('2026-07', '2026-08-09'), true);
  assert.equal(employeeCost.isPeriodClosed('2026-07', '2026-09-01'), true);
  // Vắt năm.
  assert.equal(employeeCost.isPeriodClosed('2026-12', '2027-01-08'), false);
  assert.equal(employeeCost.isPeriodClosed('2026-12', '2027-01-09'), true);
});

test('ngày tính theo giờ Việt Nam, không theo giờ UTC của máy', () => {
  // 23:30 ngày 08/08 giờ VN = 16:30 UTC cùng ngày ⇒ CHƯA chốt.
  assert.equal(employeeCost.vnToday(new Date('2026-08-08T16:30:00Z')), '2026-08-08');
  // 00:30 ngày 09/08 giờ VN = 17:30 UTC ngày 08/08 ⇒ theo giờ VN đã sang ngày 9.
  // Nếu lấy giờ UTC thì vẫn là ngày 8 và kỳ bị coi là chưa chốt — sai một ngày.
  assert.equal(employeeCost.vnToday(new Date('2026-08-08T17:30:00Z')), '2026-08-09');
  assert.equal(employeeCost.isPeriodClosed('2026-07', employeeCost.vnToday(new Date('2026-08-08T17:30:00Z'))), true);
  assert.equal(employeeCost.isPeriodClosed('2026-07', employeeCost.vnToday(new Date('2026-08-08T16:59:00Z'))), false);
});

test('nhãn: trước khoá là DỰ KIẾN kèm ngày, sau khoá là SỐ CHÍNH THỨC', () => {
  const before = employeeCost.periodCloseLabel('2026-07', '2026-08-05');
  assert.match(before, /^DỰ KIẾN/);
  assert.match(before, /08\/08\/2026/);
  assert.match(before, /còn cập nhật/);
  const after = employeeCost.periodCloseLabel('2026-07', '2026-08-09');
  assert.match(after, /^ĐÃ CHỐT KỲ/);
  assert.match(after, /chính thức/);
  // `periodCloseNote` KHÔNG mang tiền tố, để nơi gọi tự ghép — tránh lặp
  // "DỰ KIẾN — DỰ KIẾN —" như bản nháp đầu.
  assert.doesNotMatch(employeeCost.periodCloseNote('2026-07', '2026-08-05'), /DỰ KIẾN|ĐÃ CHỐT/);
});

test('‼ không còn chỗ nào suy "đã chốt kỳ" bằng cách so tháng', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(routes, /const closed = employeeCost\.isPeriodClosed\(range\.to\)/);
  assert.doesNotMatch(routes, /closed = range\.to < employeeCost\.currentMonth\(\)/,
    'lỗi cũ: so tháng nên 00:00 ngày 01 đã coi là ĐÃ CHỐT dù doanh thu còn về tới ngày 8');
  assert.match(routes, /periodClose: \{/, 'payload phải trả trạng thái khoá sổ cho giao diện');
  assert.match(routes, /closeLabel: employeeCost\.periodCloseNote\(range\.to\)/);
});

test('phạt: DỰ KIẾN trước khoá sổ, CHÍNH THỨC sau khoá sổ, finalized đúng điều kiện', () => {
  const build = (period, today) => {
    const closed = employeeCost.isPeriodClosed(period, today);
    return employeePenalty.buildPenalty({
      period, target: 1_000_000_000, achieved: 780_000_000,
      c45Amount: 7_599_706, costTotal: 42_834_991, closed,
      closeLabel: employeeCost.periodCloseNote(period, today), config: CONFIG,
    });
  };
  // Kỳ T08 (đã trừ thật) nhưng chưa khoá sổ ⇒ số vẫn là DỰ KIẾN, chưa finalized.
  const running = build('2026-08', '2026-08-20');
  assert.equal(running.mode, 'enforced');
  assert.equal(running.closed, false);
  assert.equal(running.finalized, false);
  assert.equal(running.penaltyStatus, 'provisional');
  assert.match(running.label, /^DỰ KIẾN/);
  assert.match(running.label, /08\/09\/2026/, 'phải nói rõ còn cập nhật đến ngày nào');

  // Đúng ngày khoá sổ vẫn chưa chốt.
  assert.equal(build('2026-08', '2026-09-08').finalized, false);

  // Qua ngày khoá sổ ⇒ số chính thức.
  const done = build('2026-08', '2026-09-09');
  assert.equal(done.closed, true);
  assert.equal(done.finalized, true);
  assert.equal(done.penaltyStatus, 'final');
  assert.match(done.label, /^ĐÃ CHỐT KỲ/);
  assert.match(done.label, /chính thức/);
  assert.doesNotMatch(done.label, /DỰ KIẾN/, 'sau khoá sổ không được còn chữ dự kiến');

  // Kỳ T07 chỉ cảnh báo: giữ nguyên câu chưa trừ tiền, không bị nhãn khoá sổ ghi đè.
  const july = build('2026-07', '2026-08-09');
  assert.equal(july.mode, 'warn_only');
  assert.equal(july.finalized, false, 'kỳ chỉ cảnh báo thì không bao giờ là số phạt chính thức');
  assert.match(july.label, /CHỈ CẢNH BÁO/);
  assert.equal(july.appliedAmount, 0);
});

test('giao diện tách rõ hai nhãn: "dự kiến" (chưa khoá sổ) và "tạm tính" (thiếu %)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'pages', 'EmployeeCost.jsx'), 'utf8');
  assert.match(page, /model\.periodClose\.closed \? '' : ' · dự kiến'/);
  assert.match(page, /provisionalTotals \? ' · tạm tính' : ''/);
  assert.match(page, /model\.periodClose\.note/);
  const model = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'employeeCostModel.js'), 'utf8');
  assert.match(model, /periodClose: \{/);
  assert.match(model, /closed: payload\.periodClose\?\.closed === true/);
  // Frontend không được tự tính ngày khoá sổ.
  assert.doesNotMatch(model, /PERIOD_CLOSE_DAY\s*=|closeDay\s*=\s*8/);
});
