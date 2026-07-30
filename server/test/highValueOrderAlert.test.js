'use strict';
// ĐƠN GIÁ TRỊ CAO — NHẮN CHỦ ĐỘNG (CEO chốt 2026-07-30, việc 5.2).
//
// CEO: "tất cả các đơn, với những đơn giá trị cao trên 50 triệu thì chủ động nhắn
// tin telegram cho nhân viên có đơn đó, cho vp018, cho ceo nắm rõ."
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const hvo = require('../src/highValueOrderAlert');

const BIG = { order_code: 'DH777', emp_code: 'DN001', unit_name: '175.BVĐK Vũng Tàu', amount: 275_925_600, ky: '07.2026', date: '2026-07-11' };
const SMALL = { order_code: 'DH888', emp_code: 'DN002', amount: 12_000_000, ky: '07.2026' };

test('ngưỡng 50 triệu nằm ở CONFIG, không ghi cứng trong code', () => {
  const config = hvo.loadConfig();
  assert.equal(config.ok, true);
  assert.equal(config.thresholdAmount, 50_000_000);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'highValueOrderAlert.js'), 'utf8');
  assert.doesNotMatch(src, /50_000_000|50000000/, 'ngưỡng phải đọc từ config, không ghi thẳng vào code');
});

test('đơn trên ngưỡng: nhắn NV có đơn + VP018 + CEO; đơn dưới ngưỡng thì im', () => {
  const out = hvo.build({ orders: [BIG, SMALL], state: {} });
  assert.equal(out.freshCount, 1);
  assert.deepEqual([...new Set(out.messages.map((m) => m.empCode))], ['DN001', 'VP018', 'CEO']);
  const text = out.messages[0].text;
  assert.match(text, /275\.925\.600đ/);
  assert.match(text, /trên ngưỡng 50\.000\.000đ/);
  assert.match(text, /DH777/);
  assert.match(text, /175\.BVĐK Vũng Tàu/);
  assert.match(text, /ngày 11\/07\/2026/);
  assert.match(text, /kiểm ngày thực giao/);
  assert.ok(!out.messages.some((m) => m.orderCode === 'DH888'), 'đơn 12 triệu không được nhắn');
});

test('‼ không lọc người nhận qua optout — VP018 nằm trong optout nhưng là người theo đơn', () => {
  const optout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'notify_optout.json'), 'utf8'));
  assert.ok(optout.codes.includes('VP018'));
  const out = hvo.build({ orders: [BIG], state: {} });
  assert.ok(out.messages.some((m) => m.empCode === 'VP018'), 'VP018 vẫn phải nhận');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'highValueOrderAlert.js'), 'utf8');
  for (const forbidden of ['isMuted', 'diemXu', 'notify_optout']) {
    assert.ok(!src.split('\n').some((line) => line.includes(forbidden) && !line.trim().startsWith('*') && !line.trim().startsWith('//')),
      `không được dùng ${forbidden} để lọc (chỉ nhắc trong chú thích)`);
  }
});

test('mỗi đơn nhắn MỘT LẦN; đơn đổi tiền đáng kể mới là tin mới', () => {
  const state = hvo.markState({ orders: [BIG], state: {} });
  assert.equal(hvo.build({ orders: [BIG], state }).freshCount, 0, 'đã nhắn rồi thì không nhắn lại');
  // Đổi tiền đáng kể (khác bậc triệu) ⇒ tin mới, vì con số NV cần nhớ đã khác.
  const changed = { ...BIG, amount: 300_000_000 };
  assert.equal(hvo.build({ orders: [changed], state }).freshCount, 1);
  // Lệch vài nghìn thì KHÔNG nhắn lại.
  assert.equal(hvo.build({ orders: [{ ...BIG, amount: BIG.amount + 400 }], state }).freshCount, 0);
});

test('thiếu mã đơn hoặc thiếu tiền: KHÔNG nhắn nhưng phải đếm ra', () => {
  const out = hvo.build({ orders: [{ emp_code: 'DN003', amount: 99_000_000, ky: '07.2026' }, { order_code: 'DH999', emp_code: 'DN004', ky: '07.2026' }], state: {} });
  assert.equal(out.freshCount, 0);
  assert.equal(out.skipped.length, 2);
  assert.match(out.skipped[0].reason, /không nhắn để tránh báo sai/);
});

test('config hỏng thì fail-closed và nêu lý do, không âm thầm dùng ngưỡng mặc định', () => {
  const bad = hvo.loadConfig('/duong/dan/khong/ton/tai.json');
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'config_unreadable');
  const out = hvo.build({ orders: [BIG], state: {}, config: bad });
  assert.equal(out.ok, false);
  assert.deepEqual(out.messages, []);
});
