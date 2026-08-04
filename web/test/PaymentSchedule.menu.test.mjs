import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ‼ 04/08/2026 — CEO mở app, KHÔNG TÌM THẤY mục "Thanh toán CP của tôi", trong khi
// Claude đã báo "đã có trên app". Cả hai đều đúng: khối sổ thanh toán CÓ tồn tại,
// nhưng nằm lẫn trong trang "Chi phí của tôi" và còn `return null` khi đang ở chế độ
// "Tất cả NV" — đúng chế độ mặc định của tài khoản CEO. Không menu, không thông báo.
// Test này khoá cả hai lỗi lại.
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/PaymentSchedule.jsx', import.meta.url), 'utf8');
const costPage = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('‼ phải có MENU RIÊNG "Thanh toán CP của tôi", không nấp trong trang khác', () => {
  assert.match(app, /import PaymentSchedule from '\.\/pages\/PaymentSchedule\.jsx'/);
  const entry = app.split('\n').find((line) => line.includes("key: 'paymentSchedule'"));
  assert.ok(entry, 'thiếu mục menu paymentSchedule trong TABS');
  assert.match(entry, /Thanh toán CP của tôi/, 'tên đầy đủ phải đúng chữ CEO đi tìm');
  assert.match(entry, /C: PaymentSchedule/);
  assert.doesNotMatch(entry, /hidden: true/, 'menu bị ẩn thì CEO vẫn không thấy');
});

test('menu này khoá quyền y hệt "Chi phí của tôi" — ai bị tắt chi phí thì cũng không thấy tiền', () => {
  const entry = app.split('\n').find((line) => line.includes("key: 'paymentSchedule'"));
  assert.match(entry, /employeeCostControlled: true/);
});

test('‼ chế độ "Tất cả NV" KHÔNG được trả null — phải chỉ đường cho người dùng', () => {
  const start = costPage.indexOf('export function PaymentSchedulePanel');
  assert.ok(start > 0, 'panel phải được export để trang riêng dùng chung một bản dựng');
  const body = costPage.slice(start, start + 2600);
  assert.doesNotMatch(body, /if \(allEmployees\) return null;/,
    'trả null ở chế độ Tất cả NV chính là lý do CEO không tìm thấy mục này');
  assert.match(body, /Chọn 1 nhân viên/, 'phải nói rõ cần chọn NV nào mới có sổ');
});

test('‼ thiếu số thì nói thiếu, cấm dựng sổ rỗng trông như đã trả hết', () => {
  const start = costPage.indexOf('export function PaymentSchedulePanel');
  const body = costPage.slice(start, start + 2600);
  assert.doesNotMatch(body, /if \(!schedule\) return null;/);
  assert.match(body, /Chưa dựng được sổ thanh toán/);
  const teamStart = costPage.indexOf('export function PaymentTeamPanel');
  const teamBody = costPage.slice(teamStart, teamStart + 1200);
  assert.doesNotMatch(teamBody, /if \(!team\) return null;/);
});

test('trang riêng dùng LẠI panel của trang Chi phí, không dựng bản thứ hai', () => {
  assert.match(page, /import \{ PaymentSchedulePanel, PaymentTeamPanel \} from '\.\/EmployeeCost\.jsx'/);
  assert.doesNotMatch(page, /function PaymentSchedulePanel/, 'dựng lại lần hai là hai màn sẽ lệch số');
});

test('‼ chỉ CEO mới ghi được đã trả — trang riêng không được nới lỏng', () => {
  assert.match(page, /canRecord=\{String\(me\?\.role \|\| ''\)\.toLowerCase\(\) === 'ceo'\}/);
});

test('tháng mặc định lấy theo giờ Việt Nam, không lấy giờ máy', () => {
  assert.match(page, /currentMonthValueVN\(\)/);
  assert.doesNotMatch(page, /toISOString\(\)\.slice/, 'toISOString ra ngày UTC ⇒ 00:00–07:00 giờ VN là lùi một ngày');
});

test('hỏng nguồn thì báo lỗi, không im lặng để màn trắng', () => {
  assert.match(page, /setError\(/);
  assert.match(page, /role="alert"/);
});

test('‼ không NV nào có sổ ⇒ CẤM hiện "0đ" như thể đã trả hết', () => {
  const start = costPage.indexOf('export function PaymentTeamPanel');
  const body = costPage.slice(start, start + 2000);
  assert.match(body, /if \(!totals\.employees\) return/, 'phải chặn trước khi vẽ ô KPI');
  assert.match(body, /Chưa NV nào dựng được sổ/);
  assert.match(body, /không phải "đã trả hết"/);
});
