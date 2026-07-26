const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Cách ly state alert khỏi dữ liệu thật + bật Telegram giả LẬP TRƯỚC khi require
// (notifyChannels đọc token lúc load module).
process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-state-'));
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
const alert = require('../src/employeeCostSourceAlert');

const payloadWith = (employees, pairs) => ({
  periods: [{ match: { unavailableEmployees: employees, unavailablePairs: pairs } }],
});

test('tin cảnh báo nêu ĐÍCH DANH NV, số cặp, và KHÔNG chứa tiền/%', () => {
  const text = alert.buildMessage({ employees: ['DN007', 'DN012'], pairs: 186, ky: '07.2026' });
  assert.match(text, /DN007, DN012/);
  assert.match(text, /186/);
  assert.match(text, /TẠM TÍNH/);
  assert.match(text, /DataHub/);
  // Không được lộ SỐ TIỀN (vd 1.234.567đ / VND) hay cột tỷ lệ chi phí C33-C46.
  assert.doesNotMatch(text, /[\d.]+\s*đ(?![a-zA-ZÀ-ỹ])/);
  assert.doesNotMatch(text, /\bVND\b/i);
  assert.doesNotMatch(text, /\bC(?:3[3-9]|4[0-7])\b/i);
});

test('chỉ gửi khi trạng thái ĐỔI, không spam mỗi vòng warm', async () => {
  const sent = [];
  const sendImpl = async (text) => { sent.push(text); return { sent: 1 }; };
  const now = Date.now();
  const first = await alert.checkAndNotify(payloadWith(['DN007'], 186), '07.2026', { now, sendImpl });
  assert.equal(first.alerted, true);
  // Cùng trạng thái, chưa tới hạn nhắc lại → bỏ qua.
  const second = await alert.checkAndNotify(payloadWith(['DN007'], 186), '07.2026', { now: now + 1000, sendImpl });
  assert.equal(second.skipped, 'deduped');
  // Thêm NV lỗi → trạng thái đổi → gửi lại.
  const third = await alert.checkAndNotify(payloadWith(['DN007', 'DN012'], 300), '07.2026', { now: now + 2000, sendImpl });
  assert.equal(third.alerted, true);
  assert.equal(sent.length, 2);
});

test('báo cả khi ĐÃ KHÔI PHỤC, rồi im lặng nếu vẫn ổn', async () => {
  const sent = [];
  const sendImpl = async (text) => { sent.push(text); return { sent: 1 }; };
  const now = Date.now();
  await alert.checkAndNotify(payloadWith(['DN009'], 50), '08.2026', { now, sendImpl });
  const recovered = await alert.checkAndNotify(payloadWith([], 0), '08.2026', { now: now + 1000, sendImpl });
  assert.equal(recovered.recovered, true);
  assert.match(sent.at(-1), /khôi phục/);
  // Đã ổn rồi thì không nhắc nữa.
  const quiet = await alert.checkAndNotify(payloadWith([], 0), '08.2026', { now: now + 2000, sendImpl });
  assert.equal(quiet.skipped, 'no_issue');
});
