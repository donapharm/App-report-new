/**
 * KÊNH THỨ HAI XÁC NHẬN ĐĂNG NHẬP (CEO yêu cầu 09/08/2026)
 *
 * CEO: *"otp đang trả về cho bot loginreportdonapharm mà không có thêm kênh gửi về
 * cho tin nhắn bot report — khắc phục ngay cho tôi thêm cách gửi này."*
 *
 * ‼ Luật bất di bất dịch khi thêm kênh: THÊM ĐƯỜNG ĐI, KHÔNG THÊM DANH TÍNH.
 * Telegram cấp một user id dùng chung mọi bot, nên bot nào chuyển mã về cũng ra
 * đúng một nhân viên. Mọi hàng rào cũ phải còn nguyên.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '../src/auth.js'), 'utf8');
const confirmBody = SOURCE.slice(SOURCE.indexOf('function telegramConfirm('), SOURCE.indexOf('/* ===================== MIDDLEWARE'));

test('bot chưa cấu hình đủ (thiếu username HOẶC secret) KHÔNG được hiện và KHÔNG được nhận', () => {
  // Mời người dùng vào một cửa chết còn tệ hơn không có cửa đó.
  assert.match(SOURCE, /\.filter\(\(bot\) => bot\.username && bot\.secret\)/);
  // Secret rỗng không bao giờ khớp — chốt nằm ngay trong hàm so sánh.
  assert.match(SOURCE, /if \(!b\.length \|\| a\.length !== b\.length\) return false/);
});

test('‼ so secret theo kiểu hằng-thời-gian — không rò rỉ qua thời gian phản hồi', () => {
  assert.match(SOURCE, /crypto\.timingSafeEqual\(a, b\)/);
  // Không được quay lại kiểu so chuỗi thẳng với một secret duy nhất.
  assert.doesNotMatch(confirmBody, /secret_bot !== TG_SECRET/);
});

test('nhận secret của BẤT KỲ bot nào đã cấu hình, sai hết thì 403', () => {
  assert.match(confirmBody, /const via = loginBots\(\)\.find\(\(bot\) => secretMatches\(secret_bot, bot\.secret\)\)/);
  assert.match(confirmBody, /if \(!via\) \{/);
  assert.match(confirmBody, /e\.status = 403/);
});

test('‼ MỌI hàng rào cũ còn nguyên: mã hết hạn · dùng một lần · phải map · chặn khoá', () => {
  assert.match(confirmBody, /entry\.expires_at <= now\(\)/, 'mã hết hạn vẫn bị chặn');
  assert.match(confirmBody, /entry\.status === 'confirmed'/, 'mã đã dùng không được dùng lại');
  assert.match(confirmBody, /const m = resolveTelegram\(telegram_id\)/, 'vẫn phải là telegram_id đã map');
  assert.match(confirmBody, /accessPolicy\.isLoginBlocked\(user\.emp_code\)/, 'tài khoản bị khoá vẫn chặn');
});

test('audit ghi rõ BOT NÀO đã xác nhận — có hai đường thì phải truy được đường nào', () => {
  assert.match(confirmBody, /logAudit\('telegram_confirm', \{ emp_code: user\.emp_code, telegram_id: String\(telegram_id\), via: via\.key \}\)/);
  // Tuyệt đối không ghi GIÁ TRỊ secret vào audit. Soi ĐÚNG lời gọi logAudit — cắt
  // rộng hơn sẽ nuốt luôn câu lỗi "secret_bot không hợp lệ" (tên trường, không phải
  // giá trị) rồi báo động giả.
  const badCall = confirmBody.match(/logAudit\('telegram_confirm_bad_secret'[^;]*;/)[0];
  assert.doesNotMatch(badCall, /secret_bot/, 'không được ghi secret vào nhật ký');
});

test('telegramStart trả danh sách bot cho màn login, vẫn giữ bot_link cho bản web cũ', () => {
  const startBody = SOURCE.slice(SOURCE.indexOf('function telegramStart('), SOURCE.indexOf('// Trình duyệt poll'));
  assert.match(startBody, /bots = loginBots\(\)/);
  assert.match(startBody, /link: `https:\/\/t\.me\/\$\{bot\.username\}\?start=\$\{code\}`/);
  assert.match(startBody, /bot_link, bots \}/);
});

test('còn ít nhất MỘT bot cấu hình đủ thì đăng nhập Telegram vẫn bật', () => {
  assert.match(SOURCE, /telegramConfigured: \(\) => !!TG_TOKEN && loginBots\(\)\.some\(\(bot\) => bot\.username && bot\.secret\)/);
});

test('bot 2 dùng biến môi trường RIÊNG — không xài chung secret với bot 1', () => {
  assert.match(SOURCE, /TELEGRAM_BOT2_SECRET/);
  assert.match(SOURCE, /TELEGRAM_BOT2_USERNAME/);
  // Secret của hai bot đọc từ hai biến khác nhau, không gán chéo.
  assert.match(SOURCE, /const TG_BOT2_SECRET = process\.env\.TELEGRAM_BOT2_SECRET \|\| ''/);
});
