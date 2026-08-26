const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accessPolicy = require('../src/accessPolicy');
const store = require('../src/store');
const routes = require('../src/routes');

test('routes tách reporting roster 21 khỏi actionable roster 19', (t) => {
  const codes = [
    'DN001', 'DN002', 'DN003', 'DN004', 'DN005', 'DN006', 'DN007', 'DN008', 'DN009', 'DN010',
    'DN011', 'DN012', 'DN016', 'DN017', 'DN018', 'DN019', 'DN021', 'DN022', 'DN023', 'DN024', 'VP004',
  ];
  const original = store.targetRoster;
  store.targetRoster = () => codes.map((emp_code) => ({ emp_code, name: emp_code }));
  t.after(() => { store.targetRoster = original; });
  const reporting = routes.ceoAggregateRosterRows();
  const actionable = routes.actionableRosterRows();
  assert.equal(reporting.length, 21);
  assert.equal(actionable.length, 19);
  assert.deepEqual(reporting.filter((row) => ['DN021', 'DN023'].includes(row.emp_code)).map((row) => row.emp_code), ['DN021', 'DN023']);
  assert.equal(actionable.some((row) => ['DN021', 'DN023'].includes(row.emp_code)), false);
  assert.equal(accessPolicy.isLoginBlocked('DN021'), true);
  assert.equal(accessPolicy.isLoginBlocked('DN023'), true);
  for (const code of ['DN016', 'DN018', 'DN024', 'VP004']) assert.equal(accessPolicy.isLoginBlocked(code), false, code);
});

test('routes chặn trực tiếp nhận tin và ghi sổ thanh toán cho DN021/DN023', () => {
  for (const code of ['DN021', 'DN023']) {
    assert.equal(routes.resolveFlowRecipient('employee', code), null);
    assert.equal(routes.flowNotifyReach('employee', code).reachable, false);
    assert.throws(() => routes.paymentTarget({
      body: { emp_code: code, period: '2026-07' }, session: { emp_code: 'CEO' },
    }), { code: 'PAYMENT_EMP_NOT_IN_ROSTER' });
  }
});

test('login block và các cổng gửi ngoài khác vẫn độc lập với roster CEO', () => {
  const delivery = fs.readFileSync(path.join(__dirname, '../src/filteredEmployeeDelivery.js'), 'utf8');
  const sourceAlert = fs.readFileSync(path.join(__dirname, '../src/employeeCostSourceAlert.js'), 'utf8');
  for (const code of ['DN021', 'DN023']) {
    assert.equal(accessPolicy.isLoginBlocked(code), true, `${code} vẫn bị khóa đăng nhập`);
    assert.match(delivery, new RegExp(`EXCLUDED_EMP_CODES[^\\n]*${code}`), `${code} vẫn bị chặn gửi báo cáo`);
  }
  assert.match(sourceAlert, /accessPolicy\.isLoginBlocked/, 'cảnh báo nguồn vẫn lọc người bị khóa đăng nhập');
});

/* Claude review 26/08 — KHOÁ GIẢ. Test ở trên khẳng định `resolveFlowRecipient`
 * trả `null` cho DN021/DN023. Nhưng trong môi trường test KHÔNG có bản đồ Telegram,
 * hàm này trả `null` cho MỌI NGƯỜI — kể cả DN001 vốn nằm trong roster hành động.
 * Claude đo trực tiếp: bỏ bản vá roster ra thì câu assert đó VẪN XANH, vì cái làm
 * nó xanh là thiếu bản đồ Telegram chứ không phải hàng rào roster.
 *
 * Test này gắn bản đồ Telegram cho CẢ HAI rồi mới đo — lúc đó DN001 nhận được tin,
 * còn DN021/DN023 vẫn bị chặn. Có đối chứng dương thì khoá mới là khoá thật. */
test('hàng rào roster mới là thứ chặn tin — có đối chứng dương, không phải khoá giả', (t) => {
  const auth = require('../src/auth');
  // ‼ PHẢI cấy roster trước. Kho mẫu không có DN021/DN023, nên nếu chỉ cấy bản đồ
  // Telegram thì cả hai roster đều rỗng hai mã đó và phép kiểm lại vô nghĩa lần nữa
  // — Claude viết hụt đúng chỗ này ở lượt đầu, phát hiện bằng cách tự gỡ hàng rào ra
  // xem test có đỏ không. Nó không đỏ. Nay cấy đủ cả hai.
  const codes = [
    'DN001', 'DN002', 'DN003', 'DN004', 'DN005', 'DN006', 'DN007', 'DN008', 'DN009', 'DN010',
    'DN011', 'DN012', 'DN016', 'DN017', 'DN018', 'DN019', 'DN021', 'DN022', 'DN023', 'DN024', 'VP004',
  ];
  const rosterGoc = store.targetRoster;
  store.targetRoster = () => codes.map((emp_code) => ({ emp_code, name: emp_code }));
  t.after(() => { store.targetRoster = rosterGoc; });
  const goc = auth.listTelegramMap;
  auth.listTelegramMap = () => [
    { emp_code: 'DN001', telegram_id: '111' },
    { emp_code: 'DN021', telegram_id: '222' },
    { emp_code: 'DN023', telegram_id: '333' },
  ];
  t.after(() => { auth.listTelegramMap = goc; });

  // ĐỐI CHỨNG DƯƠNG: người trong roster hành động PHẢI nhận được tin. Thiếu câu này
  // thì mọi khẳng định "bị chặn" bên dưới đều vô nghĩa.
  const trongRoster = routes.resolveFlowRecipient('employee', 'DN001');
  assert.ok(trongRoster && trongRoster.telegramId,
    'DN001 phải nhận được tin — nếu không, phép kiểm bên dưới không chứng minh được gì');
  assert.equal(routes.flowNotifyReach('employee', 'DN001').reachable, true);

  // Có bản đồ Telegram hẳn hoi mà VẪN bị chặn ⇒ đúng là roster chặn, không phải
  // thiếu cấu hình.
  for (const code of ['DN021', 'DN023']) {
    assert.equal(routes.resolveFlowRecipient('employee', code), null,
      `${code} có Telegram nhưng vẫn phải bị roster chặn`);
    assert.equal(routes.flowNotifyReach('employee', code).reachable, false);
  }
});
