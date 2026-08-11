const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailySales, sourceFreshness } = require('../src/dailySales');

const refresh = { weekday: '07:30-18:00', sat: '07:30-13:00', sun: 'off', minutes: 60 };

test('tính doanh số đúng ngày và giữ doanh số thật cả trong ngày nghỉ', () => {
  const result = buildDailySales({
    rows: [
      { date: '2026-07-11', revenue: 125000 },
      { date: '2026-07-10', revenue: 999999 },
    ],
    now: new Date('2026-07-11T09:00:00+07:00'),
    sourceUpdatedAt: '2026-07-11T08:30:00+07:00',
    isAdmin: true,
    refresh,
    holidays: [{ date: '2026-07-11', name: 'Ngày nghỉ thử nghiệm' }],
  });
  assert.equal(result.revenue, 125000);
  assert.equal(result.rowCount, 1);
  assert.equal(result.status, 'has_sales');
  assert.equal(result.isDayOff, true);
});

test('ngày nghỉ không có số dùng đúng thông báo ngày nghỉ', () => {
  const result = buildDailySales({
    now: new Date('2026-07-12T09:00:00+07:00'),
    sourceUpdatedAt: '2026-07-11T13:00:00+07:00',
    refresh,
    holidays: [],
  });
  assert.equal(result.status, 'day_off');
  assert.match(result.note, /ngày nghỉ/);
});

test('ngày làm việc không có số phân biệt CEO và nhân viên', () => {
  const common = {
    now: new Date('2026-07-16T07:43:00+07:00'),
    sourceUpdatedAt: '2026-07-16T07:30:01+07:00',
    refresh,
    holidays: [],
  };
  const ceo = buildDailySales({ ...common, isAdmin: true });
  const employee = buildDailySales({ ...common, isAdmin: false });
  assert.equal(ceo.status, 'no_sales');
  assert.match(ceo.note, /toàn công ty/);
  assert.match(employee.note, /Anh\/Chị/);
});

test('CEO đang lọc không bị thông báo nhầm là toàn công ty chưa bán', () => {
  const result = buildDailySales({
    now: new Date('2026-07-16T07:43:00+07:00'),
    sourceUpdatedAt: '2026-07-16T07:30:01+07:00',
    refresh,
    holidays: [],
    isAdmin: true,
    isFiltered: true,
  });
  assert.equal(result.status, 'no_sales');
  assert.match(result.note, /phạm vi đang lọc/);
  assert.doesNotMatch(result.note, /toàn công ty/);
});

test('nguồn trễ thì không kết luận chưa có doanh số', () => {
  const result = buildDailySales({
    now: new Date('2026-07-16T09:00:00+07:00'),
    sourceUpdatedAt: '2026-07-16T07:30:01+07:00',
    refresh,
    holidays: [],
  });
  assert.equal(result.status, 'stale');
  assert.match(result.note, /chưa thể kết luận/);
});

test('trước khung cập nhật đầu ngày ở trạng thái chờ, không báo chưa bán', () => {
  const result = buildDailySales({
    now: new Date('2026-07-16T07:00:00+07:00'),
    sourceUpdatedAt: '2026-07-15T18:00:00+07:00',
    refresh,
    holidays: [],
  });
  assert.equal(result.status, 'pending');
  assert.match(result.note, /07:30/);
});

test('freshness có 15 phút ân hạn cho slot đang chạy', () => {
  assert.equal(sourceFreshness({
    now: new Date('2026-07-16T08:40:00+07:00'),
    sourceUpdatedAt: '2026-07-16T07:30:01+07:00',
    refresh,
  }).stale, false);
  assert.equal(sourceFreshness({
    now: new Date('2026-07-16T08:46:00+07:00'),
    sourceUpdatedAt: '2026-07-16T07:30:01+07:00',
    refresh,
  }).stale, true);
});

/* ── CEO báo 11/08/2026 08:46 ────────────────────────────────────────────────
 * Ô "Doanh số trong ngày" khẳng định *"toàn công ty chưa phát sinh doanh số"* cho
 * ngày 11/08, trong khi băng ngay phía trên ghi *"Dữ liệu tới 10/08/26"*.
 * Nguyên nhân: ô này chỉ nhìn `sourceUpdatedAt` (nguồn vừa chạy lúc 08:45) mà KHÔNG
 * nhìn dữ liệu có chạm tới hôm nay chưa. Lẫn "chưa có dữ liệu" với "bằng 0".
 */
test('nguồn vừa cập nhật NHƯNG dữ liệu mới tới hôm qua ⇒ KHÔNG được kết luận "chưa có doanh số"', () => {
  const rows = [
    { date: '2026-08-09', revenue: 3_000_000 },
    { date: '2026-08-10', revenue: 5_000_000 },
  ];
  const out = buildDailySales({
    rows,
    now: new Date('2026-08-11T01:46:00Z'),          // 08:46 giờ VN, thứ Ba
    sourceUpdatedAt: '2026-08-11T01:45:00Z',        // nguồn vừa chạy 08:45 — CÒN TƯƠI
    isAdmin: true,
  });
  assert.equal(out.status, 'no_data_today');
  assert.equal(out.newestDataDate, '2026-08-10');
  assert.match(out.note, /tới ngày 10\/08\/2026/);
  assert.match(out.note, /chưa thể kết luận/);
  assert.doesNotMatch(out.note, /chưa phát sinh doanh số/,
    'TUYỆT ĐỐI không được nói "chưa phát sinh doanh số" khi chỉ là chưa có dữ liệu');
});

test('dữ liệu ĐÃ chạm hôm nay mà tổng bằng 0 ⇒ mới được nói "chưa phát sinh doanh số"', () => {
  const rows = [
    { date: '2026-08-10', revenue: 5_000_000 },
    { date: '2026-08-11', revenue: 0 },            // hôm nay CÓ dòng, nhưng 0đ
  ];
  const out = buildDailySales({
    rows,
    now: new Date('2026-08-11T01:46:00Z'),
    sourceUpdatedAt: '2026-08-11T01:45:00Z',
    isAdmin: true,
  });
  assert.equal(out.status, 'no_sales');
  assert.match(out.note, /chưa phát sinh doanh số/);
});

test('có doanh số hôm nay thì vẫn báo bình thường, không đụng nhánh mới', () => {
  const rows = [{ date: '2026-08-11', revenue: 12_000_000 }];
  const out = buildDailySales({
    rows,
    now: new Date('2026-08-11T01:46:00Z'),
    sourceUpdatedAt: '2026-08-11T01:45:00Z',
    isAdmin: true,
  });
  assert.equal(out.status, 'has_sales');
  assert.equal(out.revenue, 12_000_000);
});

test('kho rỗng hoàn toàn ⇒ giữ nguyên hành vi cũ, không bịa ngày', () => {
  const out = buildDailySales({
    rows: [],
    now: new Date('2026-08-11T01:46:00Z'),
    sourceUpdatedAt: '2026-08-11T01:45:00Z',
    isAdmin: true,
  });
  assert.equal(out.newestDataDate, null);
  assert.equal(out.status, 'no_sales');
});
