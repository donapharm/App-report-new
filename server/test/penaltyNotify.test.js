'use strict';
// TIN NHẮN PHẠT CHO NHÂN VIÊN (CEO duyệt 2026-07-30, việc 4).
//
// CEO: "Việc số 4 đồng ý duyệt tin nhắn phạt để nv nhận được."
// Bối cảnh: T08 là tháng TRỪ TIỀN THẬT; DN018 chỉ còn cách mốc mất trắng C45
// 3.550.175đ. Mất tiền vì không được nhắc là điều CEO nói "đau lắm".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const penaltyNotify = require('../src/penaltyNotify');
const employeePenalty = require('../src/employeePenalty');
const employeeCost = require('../src/employeeCost');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'));

const ROW = { emp_code: 'DN018', name: 'NV Sale 18', ky: '07.2026' };

function penaltyFor({ period = '2026-08', achieved = 780_000_000, target = 1_000_000_000, c45Amount = 7_599_706, today = '2026-08-20' } = {}) {
  const out = employeePenalty.buildPenalty({
    period, target, achieved, c45Amount, costTotal: 42_834_991,
    closed: employeeCost.isPeriodClosed(period, today),
    closeLabel: employeeCost.periodCloseNote(period, today),
    config: CONFIG,
  });
  // Đính nhãn C45 như routes.js làm, để test đúng thứ NV thật sẽ nhận.
  return { ...out, c45Label: 'C45 (Lương tăng thêm)', modeText: 'Kỳ này TRỪ THẬT tại C45 (Lương tăng thêm).' };
}

test('bậc bị trừ: tin nêu đủ % đạt · số tiền bị trừ · TÊN CỘT · ĐƯỜNG THOÁT', () => {
  const text = penaltyNotify.messageFor({ row: ROW, ky: '08.2026', penalty: penaltyFor() });
  assert.ok(text, 'đang ở bậc bị phạt thì phải có tin');
  assert.match(text, /PHẠT tại C45 \(Lương tăng thêm\)/);
  assert.match(text, /Đang đạt 78%/);
  assert.match(text, /bị trừ 1\.560\.000đ ở C45 \(Lương tăng thêm\)/);
  // Đường thoát là phần quan trọng nhất: tin chỉ báo mất tiền mà không nói cách
  // thoát là tin vô ích.
  assert.match(text, /Cách thoát: tăng thêm [\d.]+đ giá trị đơn hàng \(trước VAT\)/);
  assert.match(text, /mốc 90%/);
  assert.match(text, /Chi phí của tôi/);
});

test('bậc mất trắng: nói rõ MẤT TRẮNG bao nhiêu và mốc phải VƯỢT', () => {
  const text = penaltyNotify.messageFor({ row: ROW, ky: '08.2026', penalty: penaltyFor({ achieved: 450_000_000 }) });
  assert.match(text, /MẤT TRẮNG 7\.599\.706đ ở C45 \(Lương tăng thêm\)/);
  assert.match(text, /vượt mốc 50%/);
});

test('‼ kỳ chạy thử: phải nói CHƯA TRỪ TIỀN, không được để NV tưởng đã bị trừ', () => {
  const warn = penaltyFor({ period: '2026-07', achieved: 450_000_000, today: '2026-07-30' });
  const text = penaltyNotify.messageFor({ row: ROW, ky: '07.2026', penalty: { ...warn, modeText: 'Kỳ này CHỈ CẢNH BÁO, chưa trừ một đồng nào; từ 01/08/2026 mới trừ thật.' } });
  assert.match(text, /CẢNH BÁO PHẠT \(chưa trừ tiền\)/);
  assert.match(text, /Nếu áp dụng, bạn sẽ MẤT TRẮNG/);
  assert.match(text, /chưa trừ một đồng nào/);
  assert.match(text, /01\/08\/2026 mới trừ thật/);
  assert.doesNotMatch(text, /^⚠ \[Tháng 07\][^\n]*PHẠT tại/m, 'kỳ chạy thử không được dùng câu khẳng định đã phạt');
});

test('‼ KHÔNG có việc gì thì KHÔNG GỬI', () => {
  // Đạt mốc không phạt.
  assert.equal(penaltyNotify.messageFor({ row: ROW, ky: '08.2026', penalty: penaltyFor({ achieved: 1_200_000_000 }) }), null);
  // Chính sách chưa áp dụng cho kỳ.
  assert.equal(penaltyNotify.messageFor({ row: ROW, ky: '06.2026', penalty: penaltyFor({ period: '2026-06' }) }), null);
  // Không có payload phạt.
  assert.equal(penaltyNotify.messageFor({ row: ROW, ky: '08.2026', penalty: null }), null);
  // Chưa giao target ⇒ không nhắc tiền (nhắc là hứa con số mình không có).
  assert.equal(penaltyNotify.messageFor({ row: ROW, ky: '08.2026', penalty: penaltyFor({ target: 0 }) }), null);
  // C45 chưa về ⇒ không có số để nói.
  const noC45 = penaltyFor({ c45Amount: null });
  assert.equal(noC45.penaltyStatus, 'c45_unavailable');
  assert.equal(penaltyNotify.messageFor({ row: ROW, ky: '08.2026', penalty: noC45 }), null);
});

test('khoá chống gửi trùng theo kỳ + BẬC: đổi bậc là tin mới, cùng bậc thì không nhắc lại', () => {
  const mid = penaltyFor({ achieved: 780_000_000 });
  const worse = penaltyFor({ achieved: 450_000_000 });
  const keyMid = penaltyNotify.notifyKey({ ky: '08.2026', penalty: mid });
  const keyWorse = penaltyNotify.notifyKey({ ky: '08.2026', penalty: worse });
  assert.notEqual(keyMid, keyWorse, 'tụt bậc là tin MỚI vì số tiền và đường thoát đều khác');
  assert.equal(keyMid, penaltyNotify.notifyKey({ ky: '08.2026', penalty: penaltyFor({ achieved: 800_000_000 }) }),
    'cùng bậc trong cùng kỳ thì không nhắc lại');
  assert.match(keyMid, /^penalty\|08\.2026\|t70_90\|enforced$/);
});

test('mọi số trong tin đều là số backend đã tính, module không tự tính lại', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'penaltyNotify.js'), 'utf8');
  // Không được có phép tính tiền/tỷ lệ nào trong module dựng chữ.
  assert.doesNotMatch(src, /ratePct\s*\/\s*100|\*\s*0\.00|achieved\s*\*/, 'module dựng chữ tuyệt đối không tính lại tiền');
  assert.doesNotMatch(src, /require\('\.\/employeePenalty'\)/, 'không tự gọi engine phạt — nhận payload từ nơi gọi');
  assert.match(src, /penalty\.warning\?\.revenueGap/, 'số cần thêm lấy từ cảnh báo sớm backend đã tính');
});

test('tiêu đề thư nêu đúng tháng và mã NV', () => {
  assert.equal(penaltyNotify.subjectFor(ROW, '08.2026'), 'DONAPHARM — Cảnh báo phạt tháng 08 (DN018)');
});
