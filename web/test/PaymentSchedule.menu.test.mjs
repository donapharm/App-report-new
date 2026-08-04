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
  assert.match(page, /import \{[^}]*PaymentSchedulePanel[^}]*PaymentTeamPanel[^}]*\} from '\.\/EmployeeCost\.jsx'/);
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

/* ── CEO báo 04/08 19:30 ────────────────────────────────────────────────────── */

test('‼ tab "Chi phí của tôi" KHÔNG được dựng lại sổ thanh toán — đã có menu riêng', () => {
  // CEO: "ở tab chi phí của tôi đâu cần hiển thị mấy mục Thanh toán CP… chỉ làm rối".
  assert.doesNotMatch(costPage, /<PaymentSchedulePanel/, 'trang Chi phí không được render sổ cá nhân');
  assert.doesNotMatch(costPage, /<PaymentTeamPanel/, 'trang Chi phí không được render bảng toàn đội');
  // Nhưng vẫn phải EXPORT để trang riêng dùng chung một bản dựng.
  assert.match(costPage, /export function PaymentSchedulePanel/);
  assert.match(costPage, /export function PaymentTeamPanel/);
});

test('‼ ô chọn nhân viên phải kèm TÊN, không trơ mã', () => {
  // Roster trả trường `name`; viết `emp_name` thì ô chọn chỉ hiện "DN009 — ".
  // Bỏ chú thích rồi mới soi — lời cảnh báo trong file không bị tính là vi phạm.
  const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.doesNotMatch(pageCode, /emp_name/, 'roster không có trường emp_name');
  assert.match(page, /employeeOptionLabel\(employee\)/, 'phải dùng lại helper của trang Chi phí');
  assert.match(costPage, /export const employeeOptionLabel/);
  assert.match(costPage, /employee\.emp_code\} · \$\{employee\.name\}/, 'nhãn phải gồm mã VÀ tên');
});

/* ── CEO chốt 04/08 21:30–21:45 ─────────────────────────────────────────────── */

test('‼ NV chỉ BẤM đề nghị, KHÔNG có ô nhập số tiền ở luồng đề nghị', () => {
  const flowBlock = costPage.slice(costPage.indexOf('employee-cost-flow-actions'), costPage.indexOf('employee-cost-flow-actions') + 2200);
  assert.match(flowBlock, /Đề nghị nhận/);
  assert.match(flowBlock, /Xin nhận sớm/);
  assert.doesNotMatch(flowBlock, /draft\.amount/, 'luồng đề nghị không được dính ô nhập tiền');
});

test('‼ Mở khoá · Duyệt · Từ chối chỉ hiện với CEO', () => {
  for (const label of ['Mở khoá', 'Duyệt', 'Từ chối']) {
    const at = costPage.indexOf(`>\n                  ${label}\n`);
    const near = costPage.slice(Math.max(0, at - 700), at);
    assert.match(near, /canRecord &&/, `nút "${label}" phải nằm sau canRecord`);
  }
});

test('từ chối và xin nhận sớm đều phải hỏi LÝ DO', () => {
  assert.match(costPage, /Lý do xin nhận sớm hơn hạn/);
  assert.match(costPage, /Lý do từ chối \(NV sẽ đọc, và đề nghị lại được\)/);
});

test('‼ kỳ chưa hết tháng phải nói rõ vì sao chưa có sổ', () => {
  assert.match(costPage, /period_not_ended: 'Kỳ chưa hết tháng/);
});

/* ── CEO chốt 04/08 22:40–22:45 ─────────────────────────────────────────────── */

test('‼ kỳ ĐANG CHẠY thì KHÔNG gọi API chi phí — biết trước kết quả, gọi làm gì', () => {
  // Trước đây vẫn kéo cả 21 NV từ DataHub chỉ để kết luận "chưa tới lúc".
  assert.match(page, /const periodEnded = month < currentMonthValueVN\(\)/);
  assert.match(page, /if \(!periodEnded\) \{ setPayload\(null\); setLoading\(false\); setError\(''\); return undefined; \}/);
  assert.match(page, /\{periodEnded && <PaymentSchedulePanel/);
  assert.match(page, /\{periodEnded && <PaymentTeamPanel/);
});

test('kỳ đang chạy phải nói MỘT câu, chỉ rõ mốc giờ VN mở sổ', () => {
  assert.match(page, /chưa kết thúc — chưa có sổ thanh toán/);
  assert.match(page, /00:01 ngày 01\//);
  assert.match(page, /giờ VN/);
  assert.match(page, /bấm <b>Làm mới<\/b>/);
});

test('‼ F5 phải quay lại ĐÚNG THÁNG ĐANG XEM, không nhảy về tháng hiện tại', () => {
  // CEO 04/08 23:25: "vẫn cứ trả về tháng hiện tại, không phải tháng đang xem/liền kề".
  assert.match(page, /useState\(\(\) => paymentStartMonth\(/);
  assert.doesNotMatch(page, /useState\(currentMonthValueVN\(\)\)/, 'không được mặc định vào tháng đang chạy');
  assert.match(page, /writePaymentPrefs\(window\.localStorage, \{ month \}\)/, 'phải nhớ tháng đang xem');
});

test('paymentStartMonth: nhớ tháng đang xem, kẹp trần ở tháng liền trước', async () => {
  const model = await import('../src/employeeCostModel.js');
  const now = new Date('2026-08-04T23:25:00+07:00');
  const box = (value) => ({ getItem: () => value });
  assert.equal(model.paymentStartMonth(box(null), now), '2026-07', 'chưa xem gì ⇒ tháng liền trước');
  assert.equal(model.paymentStartMonth(box(JSON.stringify({ month: '2026-06' })), now), '2026-06', 'F5 quay lại đúng chỗ');
  // ‼ Bộ nhớ còn lưu tháng đang chạy (bản cũ, hoặc vừa sang tháng mới) ⇒ KẸP xuống.
  assert.equal(model.paymentStartMonth(box(JSON.stringify({ month: '2026-08' })), now), '2026-07');
  assert.equal(model.paymentStartMonth(box(JSON.stringify({ month: '2026-12' })), now), '2026-07', 'tháng tương lai cũng kẹp');
  // Bộ nhớ hỏng/rác thì không được nổ.
  for (const junk of ['không phải json', '{}', JSON.stringify({ month: 'bậy' })]) {
    assert.equal(model.paymentStartMonth(box(junk), now), '2026-07');
  }
});

test('lastEndedMonthVN: lùi đúng một tháng, bắc cầu sang năm trước', async () => {
  const model = await import('../src/employeeCostModel.js');
  assert.equal(model.lastEndedMonthVN(new Date('2026-08-04T12:00:00+07:00')), '2026-07');
  // 00:01 ngày 01/09 giờ VN ⇒ T08 vừa đủ điều kiện, tự trỏ sang, không ai chỉnh gì.
  assert.equal(model.lastEndedMonthVN(new Date('2026-09-01T00:01:00+07:00')), '2026-08');
  assert.equal(model.lastEndedMonthVN(new Date('2027-01-05T09:00:00+07:00')), '2026-12');
  // ‼ Đầu tháng 1 giờ VN vẫn còn 31/12 giờ UTC — lấy giờ máy là lùi nhầm sang 11.
  assert.equal(model.lastEndedMonthVN(new Date('2027-01-01T06:30:00+07:00')), '2026-12');
});
