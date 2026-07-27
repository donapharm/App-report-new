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
