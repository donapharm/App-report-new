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

test('phải thấy lỗi HAI vòng liên tiếp mới báo — một cú timeout lẻ thì im', async () => {
  // CEO 09/08: nguồn chập chờn làm danh sách NV lỗi đổi mỗi vòng warm, `changed`
  // luôn đúng nên dedup theo chữ ký vô hiệu và tin bắn liên tục. Nay lỗi phải được
  // XÁC NHẬN qua hai vòng mới tính.
  const sent = [];
  const sendImpl = async (text) => { sent.push(text); return { sent: 1 }; };
  const now = Date.now();
  const first = await alert.checkAndNotify(payloadWith(['DN007'], 186), 'A1.2026', { now, sendImpl });
  assert.equal(first.skipped, 'no_issue', 'lần đầu chỉ ghi nhận, chưa báo');
  assert.equal(sent.length, 0);
  const second = await alert.checkAndNotify(payloadWith(['DN007'], 186), 'A1.2026', { now: now + 1000, sendImpl });
  assert.equal(second.alerted, true, 'thấy lại ở vòng hai ⇒ báo');
  assert.equal(sent.length, 1);
});

test('lỗi nhấp nháy một vòng rồi hết ⇒ KHÔNG báo gì cả', async () => {
  const sent = [];
  const sendImpl = async (text) => { sent.push(text); return { sent: 1 }; };
  const now = Date.now();
  await alert.checkAndNotify(payloadWith(['DN007'], 50), 'A2.2026', { now, sendImpl });
  await alert.checkAndNotify(payloadWith([], 0), 'A2.2026', { now: now + 1000, sendImpl });
  await alert.checkAndNotify(payloadWith([], 0), 'A2.2026', { now: now + 2000, sendImpl });
  assert.equal(sent.length, 0, 'không ai bị làm phiền vì một cú timeout lẻ');
});

test('danh sách đổi liên tục KHÔNG được bắn tin mỗi vòng — có giới hạn nhịp 1 giờ', async () => {
  // Đúng cảnh đêm 09/08: 13 NV lúc 00:32 rồi 15 NV lúc 02:03, chồng chéo nhưng khác nhau.
  const sent = [];
  const sendImpl = async (text) => { sent.push(text); return { sent: 1 }; };
  const now = Date.now();
  const list1 = ['DN002', 'DN008', 'DN009'];
  const list2 = ['DN002', 'DN008', 'DN009', 'DN016'];
  await alert.checkAndNotify(payloadWith(list1, 100), 'A3.2026', { now, sendImpl });
  await alert.checkAndNotify(payloadWith(list1, 100), 'A3.2026', { now: now + 1000, sendImpl });
  assert.equal(sent.length, 1);
  // Danh sách đổi ngay sau đó → vẫn trong 1 giờ ⇒ KHÔNG gửi thêm.
  await alert.checkAndNotify(payloadWith(list2, 120), 'A3.2026', { now: now + 2000, sendImpl });
  const soon = await alert.checkAndNotify(payloadWith(list2, 120), 'A3.2026', { now: now + 3000, sendImpl });
  assert.equal(soon.skipped, 'rate_limited');
  assert.equal(sent.length, 1, 'vẫn chỉ MỘT tin trong giờ đầu');
});

test('nguồn chập chờn thì tin NÓI RA, không liệt kê danh sách như sự thật cố định', async () => {
  const sent = [];
  const sendImpl = async (text) => { sent.push(text); return { sent: 1 }; };
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  // Bốn lần danh sách thô đổi trong cửa sổ 2 giờ ⇒ đủ ngưỡng chập chờn.
  await alert.checkAndNotify(payloadWith(['DN002'], 10), 'A4.2026', { now, sendImpl });
  await alert.checkAndNotify(payloadWith(['DN002', 'DN008'], 20), 'A4.2026', { now: now + 1000, sendImpl });
  await alert.checkAndNotify(payloadWith(['DN002'], 10), 'A4.2026', { now: now + 2000, sendImpl });
  await alert.checkAndNotify(payloadWith(['DN002', 'DN009'], 20), 'A4.2026', { now: now + 3000, sendImpl });
  const later = await alert.checkAndNotify(payloadWith(['DN002', 'DN009'], 20), 'A4.2026', { now: now + hour + 4000, sendImpl });
  assert.equal(later.flapping, true);
  assert.match(sent.at(-1), /ĐANG ĐỔI LIÊN TỤC/);
  assert.match(sent.at(-1), /đừng truy từng mã NV/);
});

test('báo khôi phục khi HAI vòng liên tiếp sạch, rồi im lặng nếu vẫn ổn', async () => {
  const sent = [];
  const sendImpl = async (text) => { sent.push(text); return { sent: 1 }; };
  const now = Date.now();
  await alert.checkAndNotify(payloadWith(['DN009'], 50), '08.2026', { now, sendImpl });
  await alert.checkAndNotify(payloadWith(['DN009'], 50), '08.2026', { now: now + 1000, sendImpl });
  assert.equal(sent.length, 1);
  // Một vòng sạch chưa đủ — tránh cảnh "đã đủ / lại thiếu" nhấp nháy suốt đêm.
  const pending = await alert.checkAndNotify(payloadWith([], 0), '08.2026', { now: now + 2000, sendImpl });
  assert.equal(pending.skipped, 'awaiting_confirm');
  const recovered = await alert.checkAndNotify(payloadWith([], 0), '08.2026', { now: now + 3000, sendImpl });
  assert.equal(recovered.recovered, true);
  assert.match(sent.at(-1), /khôi phục/);
  const quiet = await alert.checkAndNotify(payloadWith([], 0), '08.2026', { now: now + 4000, sendImpl });
  assert.equal(quiet.skipped, 'no_issue');
});

// Blocker#3 (bot review): hai recovery check ĐỒNG THỜI cùng kỳ không được gửi ĐÚP.
test('hai recovery check song song cùng kỳ → chỉ gửi 1 tin (tuần tự hóa theo kỳ)', async () => {
  let sends = 0;
  // sendImpl chậm (nhường lượt) để phơi bày race nếu không có khóa.
  const sendImpl = async () => { sends += 1; await new Promise((r) => setImmediate(r)); return { sent: 1 }; };
  const now = Date.now();
  // Gây lỗi ĐÃ XÁC NHẬN (hai vòng) rồi mới thử hai check khôi phục song song.
  await alert.checkAndNotify(payloadWith(['DN007'], 50), 'CC.2026', { now, sendImpl });
  await alert.checkAndNotify(payloadWith(['DN007'], 50), 'CC.2026', { now: now + 500, sendImpl });
  await alert.checkAndNotify(payloadWith([], 0), 'CC.2026', { now: now + 600, sendImpl }); // vòng sạch thứ nhất
  sends = 0;
  const [r1, r2] = await Promise.all([
    alert.checkAndNotify(payloadWith([], 0), 'CC.2026', { now: now + 1000, sendImpl }),
    alert.checkAndNotify(payloadWith([], 0), 'CC.2026', { now: now + 1000, sendImpl }),
  ]);
  assert.equal(sends, 1); // CHỈ 1 tin khôi phục dù 2 check song song
  assert.equal([r1, r2].filter((r) => r.recovered).length, 1);
  assert.equal([r1, r2].filter((r) => r.skipped === 'no_issue').length, 1);
});
