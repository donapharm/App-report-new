/**
 * SÀN KỲ + CÔNG TẮC CHỦ CHO TIN NHẮC THANH TOÁN (CEO chốt 08/08/2026)
 *
 * Hai lớp chặn, mỗi lớp đủ sức tự đứng một mình:
 *  ① Sàn kỳ: chỉ nhắc từ T07.2026 — kỳ đầu tiên có dữ liệu App Sale bài bản.
 *    CEO: *"bỏ qua T05 và T06 vì hai tháng này chưa xây bài bản, chỉ có số liệu
 *    Lumos chuyển vào."* Sổ kỳ legacy chưa ai ghi nhận trả ⇒ app tưởng chưa trả
 *    ⇒ bắn tin "QUÁ HẠN" SAI cho toàn đội. Tin gửi rồi không rút lại được.
 *  ② Công tắc chủ `PAYMENT_NOTICE_ENABLED`: mặc định TẮT, phải bật tường minh.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');

// Bản sao thuần của bộ lọc kỳ — kiểm luật lọc mà không phải dựng cả server.
function periodsFor(today, periods, firstPeriod = '2026-07') {
  const now = new Date(`${today}T00:00:00Z`);
  return periods.filter((period) => {
    if (String(period) < String(firstPeriod)) return false;
    const [year, month] = period.split('-').map(Number);
    const end = new Date(Date.UTC(year, month, 0));
    const age = Math.floor((now - end) / 86_400_000);
    return age >= 45 && age <= 105;
  });
}

const ALL = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

test('sàn kỳ khoá đúng T07.2026 và chặn TRƯỚC khi tính tuổi kỳ', () => {
  assert.match(ROUTES_SOURCE, /const PAYMENT_NOTICE_FIRST_PERIOD = '2026-07';/);
  const fn = ROUTES_SOURCE.slice(ROUTES_SOURCE.indexOf('function paymentNoticePeriods'));
  const floorAt = fn.indexOf('String(period) < String(firstPeriod)');
  const ageAt = fn.indexOf('age >= 45');
  assert.ok(floorAt >= 0 && ageAt > floorAt, 'sàn kỳ phải chặn trước phép tính tuổi kỳ');
});

test('T04/T05/T06 (số Lumos) KHÔNG BAO GIỜ bị nhắc, dù rơi đúng cửa sổ tuổi kỳ', () => {
  // 08/08/2026: T04 (100 ngày) và T05 (69 ngày) đều nằm trong cửa sổ 45–105 ngày.
  assert.deepEqual(periodsFor('2026-08-08', ALL, '1900-01'), ['2026-04', '2026-05'],
    'không có sàn thì đúng hai kỳ legacy này bị nhắc — đây là thứ phải chặn');
  assert.deepEqual(periodsFor('2026-08-08', ALL), [], 'có sàn thì không kỳ nào bị nhắc');
  // 14/08/2026 là ngày T06 lọt vào cửa sổ (30/06 + 45 ngày); cùng lúc T04 quá 105
  // ngày nên tự rơi ra — cửa sổ TRƯỢT chứ không cộng dồn. Sàn phải chặn tiếp.
  assert.deepEqual(periodsFor('2026-08-14', ALL, '1900-01'), ['2026-05', '2026-06']);
  assert.deepEqual(periodsFor('2026-08-14', ALL), []);
});

test('T07 trở đi vẫn nhắc bình thường khi tới hạn — sàn không giết luôn tính năng', () => {
  // T07 hết kỳ 31/07, vào cửa sổ từ 14/09/2026.
  assert.deepEqual(periodsFor('2026-09-13', ALL), []);
  assert.deepEqual(periodsFor('2026-09-14', ALL), ['2026-07']);
  assert.deepEqual(periodsFor('2026-10-15', ALL), ['2026-07', '2026-08']);
});

test('công tắc chủ mặc định TẮT và chặn trước khi dựng sổ/gọi nguồn', () => {
  assert.match(ROUTES_SOURCE, /PAYMENT_NOTICE_ENABLED/);
  const fn = ROUTES_SOURCE.slice(ROUTES_SOURCE.indexOf('async function paymentSchedulesForNotify'));
  const gateAt = fn.indexOf('if (!paymentNoticeEnabled()) return [];');
  const sessionAt = fn.indexOf('store.findUserByCode');
  assert.ok(gateAt >= 0 && sessionAt > gateAt, 'công tắc phải chặn trước mọi thao tác dựng sổ');
  // Mặc định tắt: biến môi trường trống ⇒ không bật.
  const enabled = (value) => /^(1|true|yes|on)$/i.test(String(value || ''));
  assert.equal(enabled(undefined), false);
  assert.equal(enabled(''), false);
  assert.equal(enabled('0'), false);
  assert.equal(enabled('off'), false);
  assert.equal(enabled('1'), true);
  assert.equal(enabled('true'), true);
});
