const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Cách ly + bật Telegram giả lập TRƯỚC khi require (notifyChannels đọc token lúc load).
process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-emp-notice-'));
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
const auth = require('../src/auth');
const alert = require('../src/employeeCostSourceAlert');

const payloadWith = (employees, pairs) => ({
  periods: [{ match: { unavailableEmployees: employees, unavailablePairs: pairs } }],
});
const withTelegramMap = async (entries, fn) => {
  const orig = auth.listTelegramMap;
  auth.listTelegramMap = () => entries;
  try { return await fn(); } finally { auth.listTelegramMap = orig; }
};

test('tin mềm NV: trấn an · KHÔNG số tiền · KHÔNG lộ mã NV nào · KHÔNG quy trách nhiệm', () => {
  const down = alert.buildEmployeeMessage({ ky: '07.2026', recovered: false });
  assert.match(down, /TẠM TÍNH/);
  assert.match(down, /không cần làm gì/i);
  assert.doesNotMatch(down, /[\d.]+\s*đ(?![a-zA-ZÀ-ỹ])/); // không tiền
  assert.doesNotMatch(down, /\bVND\b/i);
  assert.doesNotMatch(down, /\bDN\d{3}\b/);               // không lộ mã NV (mình hay người khác)
  assert.doesNotMatch(down, /\bC(?:3[3-9]|4[0-7])\b/i);   // không cột chi phí
  const up = alert.buildEmployeeMessage({ ky: '07.2026', recovered: true });
  assert.match(up, /cập nhật đủ|đầy đủ/);
});

test('NV bị ảnh hưởng CÓ Telegram → nhận tin mềm; NV KHÔNG link → bỏ qua (không ép)', async () => {
  await withTelegramMap([{ emp_code: 'DN007', telegram_id: '111' }], async () => {
    const empSends = [];
    const sendEmployeeImpl = async (chatId, text) => { empSends.push({ chatId, text }); return { ok: true }; };
    const sendImpl = async () => ({ sent: 1 });
    const now = Date.now();
    // Lỗi phải được xác nhận qua hai vòng mới báo (chống rung, CEO 09/08).
    await alert.checkAndNotify(payloadWith(['DN007', 'DN012'], 100), '09.2026', { now, sendImpl, sendEmployeeImpl });
    const res = await alert.checkAndNotify(payloadWith(['DN007', 'DN012'], 100), '09.2026', {
      now: now + 1000, sendImpl, sendEmployeeImpl,
    });
    assert.equal(res.alerted, true);
    assert.equal(res.employeeNotified.targeted, 1); // chỉ DN007 có link, DN012 bỏ qua
    assert.equal(res.employeeNotified.sent, 1);
    assert.equal(empSends.length, 1);
    assert.equal(empSends[0].chatId, '111');
    assert.match(empSends[0].text, /TẠM TÍNH/);
  });
});

test('nhắc lại 6h (trạng thái KHÔNG đổi) → admin được nhắc, NV KHÔNG bị spam tin mềm', async () => {
  await withTelegramMap([{ emp_code: 'DN007', telegram_id: '111' }], async () => {
    const empSends = [];
    const sendEmployeeImpl = async (chatId, text) => { empSends.push(text); return { ok: true }; };
    const sendImpl = async () => ({ sent: 1 });
    const now = Date.now();
    await alert.checkAndNotify(payloadWith(['DN007'], 50), '10.2026', { now, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(['DN007'], 50), '10.2026', { now: now + 1000, sendImpl, sendEmployeeImpl });
    assert.equal(empSends.length, 1);
    const remind = await alert.checkAndNotify(payloadWith(['DN007'], 50), '10.2026', {
      now: now + 6 * 60 * 60 * 1000 + 2000, sendImpl, sendEmployeeImpl,
    });
    assert.equal(remind.alerted, true);   // admin bị nhắc lại (quá 6h)
    assert.equal(empSends.length, 1);     // NV KHÔNG nhận thêm
  });
});

test('khôi phục → NV trước đó bị ảnh hưởng nhận tin "đã cập nhật đủ"', async () => {
  await withTelegramMap([{ emp_code: 'DN007', telegram_id: '111' }], async () => {
    const empSends = [];
    const sendEmployeeImpl = async (chatId, text) => { empSends.push(text); return { ok: true }; };
    const sendImpl = async () => ({ sent: 1 });
    const now = Date.now();
    await alert.checkAndNotify(payloadWith(['DN007'], 50), '11.2026', { now, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(['DN007'], 50), '11.2026', { now: now + 1000, sendImpl, sendEmployeeImpl });
    empSends.length = 0;
    await alert.checkAndNotify(payloadWith([], 0), '11.2026', { now: now + 2000, sendImpl, sendEmployeeImpl });
    const rec = await alert.checkAndNotify(payloadWith([], 0), '11.2026', { now: now + 3000, sendImpl, sendEmployeeImpl });
    assert.equal(rec.recovered, true);
    assert.equal(rec.employeeNotified.sent, 1);
    assert.match(empSends[0], /cập nhật đủ|đầy đủ/);
  });
});

test('‼ danh sách XOAY VÒNG không được nhắn lại cùng một NV (CEO báo gấp 09/08)', async () => {
  // Lỗi cũ: dedup tính theo "NV này có trong danh sách LẦN TRƯỚC không". Nguồn chập
  // chờn làm DN007 rơi ra rồi quay lại ⇒ lần nào quay lại cũng bị coi là "mới bị ảnh
  // hưởng" ⇒ nhắn lặp. Nay tính theo TỪNG NGƯỜI: mỗi người tối đa 1 tin/24h.
  await withTelegramMap([
    { emp_code: 'DN007', telegram_id: '111' },
    { emp_code: 'DN012', telegram_id: '222' },
  ], async () => {
    const empSends = [];
    const sendEmployeeImpl = async (chatId) => { empSends.push(chatId); return { ok: true }; };
    const sendImpl = async () => ({ sent: 1 });
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const both = ['DN007', 'DN012'];
    await alert.checkAndNotify(payloadWith(both, 100), 'E1.2026', { now, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(both, 100), 'E1.2026', { now: now + 1000, sendImpl, sendEmployeeImpl });
    assert.deepEqual(empSends.sort(), ['111', '222']);
    empSends.length = 0;
    // DN007 rơi ra rồi QUAY LẠI ở các vòng sau, cách nhau hơn 1 giờ để qua giới hạn nhịp.
    await alert.checkAndNotify(payloadWith(['DN012'], 50), 'E1.2026', { now: now + hour + 1000, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(['DN012'], 50), 'E1.2026', { now: now + hour + 2000, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(both, 100), 'E1.2026', { now: now + 2 * hour + 1000, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(both, 100), 'E1.2026', { now: now + 2 * hour + 2000, sendImpl, sendEmployeeImpl });
    assert.deepEqual(empSends, [], 'KHÔNG ai bị nhắn lại trong 24 giờ, dù danh sách xoay vòng');
  });
});

test('qua 24 giờ mà vẫn hỏng thì NV được nhắn lại một lần — không im luôn mãi', async () => {
  await withTelegramMap([{ emp_code: 'DN007', telegram_id: '111' }], async () => {
    const empSends = [];
    const sendEmployeeImpl = async (chatId) => { empSends.push(chatId); return { ok: true }; };
    const sendImpl = async () => ({ sent: 1 });
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await alert.checkAndNotify(payloadWith(['DN007'], 50), 'E2.2026', { now, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(['DN007'], 50), 'E2.2026', { now: now + 1000, sendImpl, sendEmployeeImpl });
    assert.equal(empSends.length, 1);
    await alert.checkAndNotify(payloadWith(['DN007'], 50), 'E2.2026', { now: now + day + 1000, sendImpl, sendEmployeeImpl });
    assert.equal(empSends.length, 2);
  });
});

test('khôi phục CHỈ báo cho NV đã thực sự nhận tin lỗi, không làm phiền người khác', async () => {
  await withTelegramMap([
    { emp_code: 'DN007', telegram_id: '111' },
    { emp_code: 'DN012', telegram_id: '222' },
  ], async () => {
    const empSends = [];
    const sendEmployeeImpl = async (chatId) => { empSends.push(chatId); return { ok: true }; };
    const sendImpl = async () => ({ sent: 1 });
    const now = Date.now();
    // Chỉ DN007 từng bị xác nhận lỗi; DN012 chỉ thoáng qua một vòng, chưa từng bị nhắn.
    await alert.checkAndNotify(payloadWith(['DN007'], 50), 'E3.2026', { now, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith(['DN007', 'DN012'], 60), 'E3.2026', { now: now + 1000, sendImpl, sendEmployeeImpl });
    assert.deepEqual(empSends, ['111']);
    empSends.length = 0;
    await alert.checkAndNotify(payloadWith([], 0), 'E3.2026', { now: now + 2000, sendImpl, sendEmployeeImpl });
    await alert.checkAndNotify(payloadWith([], 0), 'E3.2026', { now: now + 3000, sendImpl, sendEmployeeImpl });
    assert.deepEqual(empSends, ['111'], 'chỉ người từng bị làm phiền mới được báo đã xong');
  });
});
