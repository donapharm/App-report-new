'use strict';
// Khoá KHUNG GIỜ (CEO chốt 2026-07-27). Đọc thẳng mã nguồn bot thay vì chạy bot,
// vì bot mở kết nối Telegram khi require. Mục tiêu: đổi giờ là test phải đỏ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'telegram-bot.js'), 'utf8');

function slotBlock(name) {
  const m = new RegExp(`const ${name} = \\{([^}]*)\\}`).exec(SRC);
  assert.ok(m, `không tìm thấy khai báo ${name}`);
  // Bỏ phần trong dấu nháy trước khi đọc số, kẻo nhãn "12:30 thứ 7" bị hiểu thành cặp key:value.
  const fields = m[1].replace(/'[^']*'/g, "''");
  return Object.fromEntries([...fields.matchAll(/(\w+):\s*(\d+)/g)].map(([, k, v]) => [k, Number(v)]));
}

test('tin HẰNG NGÀY đã dời 18:00 -> 07:30', () => {
  const daily = /\{ type: 'daily', hour: (\d+), minute: (\d+)/.exec(SRC);
  assert.ok(daily, 'không tìm thấy slot daily');
  assert.equal(Number(daily[1]), 7);
  assert.equal(Number(daily[2]), 30);
  assert.doesNotMatch(SRC, /type: 'daily', hour: 18/, 'không được còn sót khung 18:00 hằng ngày');
});

test('khung thứ 7 13:00 GIỮ NGUYÊN', () => {
  const weekly = /\{ type: 'weekly', dow: (\d+), hour: (\d+), minute: (\d+)/.exec(SRC);
  assert.deepEqual(weekly.slice(1, 4).map(Number), [6, 13, 0]);
});

test('báo cáo doanh thu NGÀY chạy 07:30', () => {
  const s = slotBlock('SALES_DAILY_SLOT');
  assert.deepEqual(s, { hour: 7, minute: 30 });
  assert.match(SRC, /dailyEnabled && hh === SALES_DAILY_SLOT\.hour && mm === SALES_DAILY_SLOT\.minute/);
});

test('báo cáo THÁNG cố tình GIỮ buổi chiều 18:00 (dời sáng thì chốt sổ khi tháng chưa xong)', () => {
  assert.match(SRC, /if \(hh === 18 && mm === 0\) \{[\s\S]{0,200}?isMonthEnd/, 'nhánh tháng phải còn ở 18:00');
});

test('tổng chi phí: 12:30 thứ 7 và 17:30 ngày cuối tháng', () => {
  assert.deepEqual(slotBlock('COST_WEEKLY_SLOT'), { dow: 6, hour: 12, minute: 30 });
  assert.deepEqual(slotBlock('COST_MONTH_END_SLOT'), { hour: 17, minute: 30 });
});

test('tổng thưởng tháng: 17:40 ngày cuối tháng — sau chi phí 17:30, trước báo cáo tháng 18:00', () => {
  const bonus = slotBlock('BONUS_MONTH_END_SLOT');
  assert.deepEqual(bonus, { hour: 17, minute: 40 });
  const cost = slotBlock('COST_MONTH_END_SLOT');
  const mins = (s) => s.hour * 60 + s.minute;
  assert.ok(mins(cost) < mins(bonus), 'chi phí phải trước thưởng');
  assert.ok(mins(bonus) < 18 * 60, 'thưởng phải trước báo cáo tháng 18:00');
});

test('cả 3 luồng mới đều fail-closed: chỉ chạy khi cờ đúng "1"', () => {
  assert.match(SRC, /process\.env\.EMP_COST_NOTIFY !== '1'/);
  assert.match(SRC, /process\.env\.BONUS_NOTIFY !== '1'/);
  assert.match(SRC, /process\.env\.BONUS_NOTIFY === '1'/);
  assert.match(SRC, /process\.env\.EMP_COST_NOTIFY === '1'/);
});

test('mốc target + mốc thưởng GỘP 1 tin/người, không bắn 2 tin cùng phút', () => {
  assert.match(SRC, /const byEmp = new Map\(\)/);
  assert.match(SRC, /group\.lines\.filter\(Boolean\)\.join\('\\n\\n'\)/);
  // Chỉ đánh dấu đã gửi khi gửi THÀNH CÔNG, cho cả hai loại sự kiện.
  assert.match(SRC, /if \(r\.ok\) \{ sent\.push\(\.\.\.group\.target\); bonusSent\.push\(\.\.\.group\.bonus\); \}/);
  assert.match(SRC, /bonusNotify\.markSent\(bonusSent\)/);
});

test('bộ lịch mới được khởi động cùng các bộ lịch cũ', () => {
  assert.match(SRC, /startCostBonusScheduler\(\);/);
});

test('‼ bản tin 07:30 phải báo số NGÀY HÔM QUA, không phải hôm nay', () => {
  // Chạy 07:30 mà lấy dữ liệu của chính hôm đó thì luôn rỗng -> với chốt
  // "không có dữ liệu thì không gửi", luồng báo cáo ngày sẽ câm vĩnh viễn.
  assert.match(SRC, /const ranges = salesReport\.defaultRanges\(previousDay\(day\)\);/,
    'nhánh báo cáo ngày phải dùng previousDay(day)');
  assert.doesNotMatch(SRC, /dailyEnabled[\s\S]{0,400}?defaultRanges\(day\)\);/,
    'không được còn sót defaultRanges(day) trong nhánh hằng ngày');
});

test('previousDay nhảy đúng qua đầu tháng và đầu năm', () => {
  const m = /function previousDay\(iso\) \{[\s\S]*?\n\}/.exec(SRC);
  assert.ok(m, 'thiếu hàm previousDay');
  // eslint-disable-next-line no-new-func
  const previousDay = new Function(`${m[0]}; return previousDay;`)();
  assert.equal(previousDay('2026-07-28'), '2026-07-27');
  assert.equal(previousDay('2026-08-01'), '2026-07-31', 'qua đầu tháng');
  assert.equal(previousDay('2027-01-01'), '2026-12-31', 'qua đầu năm');
  assert.equal(previousDay('2026-03-01'), '2026-02-28', 'tháng 2');
});

test('báo cáo TUẦN và THÁNG vẫn dùng ngày chạy, KHÔNG lùi 1 ngày', () => {
  const weekly = /getUTCDay\(\) === 6 && hh === 13[\s\S]{0,120}?defaultRanges\((\w+)\)/.exec(SRC);
  assert.equal(weekly[1], 'day', 'tuần giữ nguyên mốc chạy');
});

test('log SalesReport phân biệt "không có dữ liệu" với "gửi CEO thất bại"', () => {
  const m = /function salesReportDoneLine[\s\S]*?\n\}/.exec(SRC);
  assert.ok(m, 'thiếu salesReportDoneLine');
  // eslint-disable-next-line no-new-func
  const line = new Function(`${m[0]}; return salesReportDoneLine;`)();

  const empty = line('day', { skipped: 'no_data', skippedRecipients: new Array(17) }, 'k');
  assert.match(empty, /KHÔNG GỬI/);
  assert.match(empty, /Đúng thiết kế, không phải lỗi/);
  assert.doesNotMatch(empty, /ceo=fail/, 'bỏ qua vì rỗng KHÔNG được đọc thành lỗi');

  const broken = line('day', { sent: [], failed: new Array(2), ceoResult: { ok: false } }, 'k');
  assert.match(broken, /ceo=fail/, 'hỏng thật thì vẫn phải báo fail');
  assert.match(broken, /failed=2/);
});

test('log mốc 07:30 đếm RIÊNG mốc target và mốc thưởng', () => {
  // Bản trước chỉ in sent.length (chỉ mốc target) -> tin thưởng gửi hay không đều vô hình.
  assert.match(SRC, /mốc target \$\{sent\.length\}, mốc thưởng \$\{bonusSent\.length\}/);
  assert.match(SRC, /BONUS_NOTIFY đang TẮT/, 'phải nói rõ khi cờ thưởng đang tắt');
});

test('‼ chặn thông báo dùng ĐÚNG MỘT nguồn: notify_optout + no_auto_notify', () => {
  // Từng vá sai: lấy diemXu.EXCLUDE (danh sách "không tính điểm xu") làm danh sách
  // chặn thông báo. Nó có DN022 — người CEO chốt 28/07 PHẢI nhận thông báo.
  // Chỉ cấm DÙNG THẬT; chú thích giải thích vì sao không dùng thì phải giữ lại.
  assert.doesNotMatch(SRC, /require\('\.\/src\/diemXu'\)/, 'bot không được nạp diemXu');
  assert.doesNotMatch(SRC, /diemXu\.\w+\(/, 'bot không được gọi hàm nào của diemXu');
  const fn = /function autoNotifyRecipients\(\) \{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /targetNotify\.isMuted/);
});

test('danh sách chặn thông báo khớp với 2 phạm vi CEO đã duyệt, và KHÔNG có DN022', () => {
  const optout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'notify_optout.json'), 'utf8'));
  assert.deepEqual([...optout.codes].sort(), ['DN021', 'DN023', 'VP004', 'VP018'],
    'phải khớp dormantFeedback.TELEGRAM_HARD_EXCLUDED và filteredEmployeeDelivery.EXCLUDED_EMP_CODES');
  assert.ok(!optout.codes.includes('DN022'), 'DN022 nhận thông báo như NV chính thức (CEO chốt 28/07)');
  assert.ok(optout.codes.includes('VP018'), 'VP018 từng lọt vì thiếu ở đây');
});

test('báo cáo doanh thu lọc người nhận bằng isMuted, KHÔNG bằng diemXu.EXCLUDE', () => {
  const sales = fs.readFileSync(path.join(__dirname, '..', 'src', 'salesReport.js'), 'utf8');
  const fn = /function salesRecipients\(\) \{[\s\S]*?\n\}/.exec(sales)[0];
  assert.match(fn, /targetNotify\.isMuted/);
  assert.doesNotMatch(fn, /EXCLUDED\.has/, 'không được lọc bằng danh sách điểm xu nữa');
});

test('diemXu.EXCLUDE GIỮ NGUYÊN cho việc tính điểm xu — không đụng', () => {
  const diemXu = require('../src/diemXu');
  assert.equal(diemXu.isExcluded('DN022'), true, 'DN022 vẫn KHÔNG tính điểm xu');
  assert.deepEqual([...diemXu.EXCLUDE].sort(), ['DN021', 'DN022', 'DN023', 'VP004', 'VP018']);
});
