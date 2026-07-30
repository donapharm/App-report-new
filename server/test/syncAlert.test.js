'use strict';
// CẢNH BÁO ĐỒNG BỘ DOANH THU (CEO chốt 29/07, yêu cầu làm ngay 30/07).
//
// CEO: "để tránh tình trạng chạy loanh quanh tìm số không khớp mãi mới ra được. Do
// không có người canh cửa nên hậu quả là chạy lòng vòng đi tìm."
//
// Test khoá 5 việc, mỗi việc đều là một cách làm sai đã từng xảy ra:
//   1. VP018 PHẢI nhận cảnh báo dù đang nằm trong notify_optout (chặn nhầm người sửa).
//   2. Không lọc qua isMuted/optout/EXCLUDE — lấy danh sách việc khác dùng cho việc
//      này đúng là lỗi đã dính 28/07.
//   3. Mỗi mục đủ 4 phần: cái gì · tiền · vì sao · AI LÀM GÌ.
//   4. Chỉ báo cái MỚI; không có gì mới thì KHÔNG GỬI.
//   5. Mỗi người nhận đúng phần mình sửa được; CEO chỉ nhận bản tổng.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const syncAlert = require('../src/syncAlert');

const ITEMS = [
  {
    ky: '07.2026', reason: 'MISA_REVENUE_DATE_NULL', orderCode: 'DH479815711',
    emp_code: 'DN010', amount: 2_399_520,
  },
  {
    ky: '07.2026', reason: 'UNIT_NOT_IN_CATALOG', unitCode: '175.BVĐK Vũng Tàu',
    amount: 275_925_600,
  },
  {
    ky: '07.2026', reason: 'SUSPECT_TEST_ORDER', orderCode: 'DH999000111', amount: 1_000_000,
  },
];

function listOf(messages) {
  return Object.fromEntries(messages.map((m) => [m.empCode, m.text]));
}

test('‼ VP018 nằm trong notify_optout nhưng VẪN PHẢI nhận cảnh báo đồng bộ', () => {
  const optout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'notify_optout.json'), 'utf8'));
  assert.ok(optout.codes.includes('VP018'), 'tiền đề: VP018 đang bị chặn thông báo hiệu suất');
  const result = syncAlert.recipients();
  assert.equal(result.ok, true);
  const codes = result.list.map((item) => item.empCode);
  assert.ok(codes.includes('VP018'), 'VP018 là NGƯỜI SỬA ngày thực giao — chặn VP018 là chặn đúng người cần biết');
  assert.ok(codes.includes('DN007'));
  assert.ok(codes.includes('CEO'));
  // Kênh bot App Sale chưa mở thì phải khai báo rõ là chưa mở, không được coi như đã báo.
  assert.equal(result.appSaleBot.enabled, false);
});

test('‼ KHÔNG lọc danh sách cảnh báo qua optout/isMuted/EXCLUDE', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'syncAlert.js'), 'utf8');
  for (const forbidden of ['isMuted', 'notify_optout', 'diemXu', 'TELEGRAM_HARD_EXCLUDED']) {
    assert.ok(!new RegExp(`${forbidden}\\s*\\(`).test(src) && !src.split('\n')
      .some((line) => line.includes(forbidden) && !line.trim().startsWith('*') && !line.trim().startsWith('//')),
    `syncAlert.js không được dùng ${forbidden} để lọc người nhận (chỉ được nhắc trong chú thích)`);
  }
  // File cấu hình phải ghi nguyên văn lời cảnh báo để người sau không hiểu nhầm.
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'config', 'sync_alert_recipients.json'), 'utf8');
  assert.match(cfg, /KHÁC HOÀN TOÀN với thông báo hiệu suất/);
  assert.match(cfg, /VP018 nằm trong optout nhưng VẪN PHẢI nhận/);
});

test('mỗi mục đủ 4 phần: cái gì · tiền · vì sao · AI LÀM GÌ', () => {
  const messages = syncAlert.buildMessages({
    ky: '07.2026', items: ITEMS, state: {}, recipientList: syncAlert.recipients().list,
  });
  const byEmp = listOf(messages);
  const fixer = byEmp.VP018;
  assert.ok(fixer, 'VP018 phải có tin');
  assert.match(fixer, /DH479815711/);                       // cái gì
  assert.match(fixer, /2\.399\.520đ/);                      // bao nhiêu tiền
  assert.match(fixer, /THIẾU NGÀY DOANH THU/);              // vì sao
  assert.match(fixer, /→ Kế toán MISA nhập ngày ghi doanh thu/); // ai làm gì
  assert.match(fixer, /175\.BVĐK Vũng Tàu/);
  assert.match(fixer, /275\.925\.600đ/);
  assert.match(fixer, /DataHub\/App Sale thêm mã đơn vị/);
  // Mọi mã lý do khai báo sẵn đều phải có đủ why + who.
  for (const [code, meta] of Object.entries(syncAlert.REASONS)) {
    assert.ok(meta.why && meta.who, `mã lý do ${code} thiếu why/who`);
  }
});

test('mỗi người nhận ĐÚNG phần mình sửa được; CEO chỉ nhận bản tổng', () => {
  const byEmp = listOf(syncAlert.buildMessages({
    ky: '07.2026', items: ITEMS, state: {}, recipientList: syncAlert.recipients().list,
  }));
  // Đơn nghi test thuộc App Sale ⇒ KHÔNG đẩy vào tin của người sửa ngày/đơn vị.
  assert.doesNotMatch(byEmp.VP018, /DH999000111/, 'việc của App Sale không được nhét vào tin VP018');
  // CEO: bản tổng, có tổng tiền và ai đang phải xử lý bao nhiêu — không liệt kê từng dòng.
  assert.match(byEmp.CEO, /mục MỚI cần xử lý/);
  assert.match(byEmp.CEO, /Tổng tiền đang mắc/);
  assert.match(byEmp.CEO, /Kế toán MISA nhập ngày ghi doanh thu: 1 mục/);
  assert.doesNotMatch(byEmp.CEO, /Lý do:/, 'CEO không cần từng dòng chi tiết');
});

test('‼ chỉ báo cái MỚI; ngoại lệ tồn 10 ngày không được nhắn 10 lần', () => {
  const list = syncAlert.recipients().list;
  const first = syncAlert.buildMessages({ ky: '07.2026', items: ITEMS, state: {}, recipientList: list });
  assert.ok(first.length > 0, 'lần đầu phải có tin');
  const state = syncAlert.markState({ items: ITEMS, state: {}, at: '2026-07-30T01:00:00Z' });

  // Chạy lại y nguyên: KHÔNG GỬI GÌ (CEO chốt 28/07 "không có tin gì thì không gửi").
  const second = syncAlert.buildMessages({ ky: '07.2026', items: ITEMS, state, recipientList: list });
  assert.deepEqual(second, [], 'không có mục mới thì tuyệt đối không gửi');

  // Thêm 1 mục mới: chỉ mục mới được kể chi tiết, mục cũ gộp một dòng.
  const withNew = [...ITEMS, { ky: '07.2026', reason: 'DELIVERY_DATE_MISSING', orderCode: 'DH123456789', amount: 50_000_000 }];
  const third = listOf(syncAlert.buildMessages({ ky: '07.2026', items: withNew, state, recipientList: list }));
  assert.match(third.VP018, /1 mục mới cần bạn xử lý/);
  assert.match(third.VP018, /DH123456789/);
  assert.doesNotMatch(third.VP018, /DH479815711/, 'mục đã nhắn rồi không kể lại chi tiết');
  assert.match(third.VP018, /Còn tồn 2 mục cũ chưa xử lý/);
});

test('xử lý xong thì báo "đã hết" đúng MỘT lần rồi thôi', () => {
  const list = syncAlert.recipients().list;
  let state = syncAlert.markState({ items: ITEMS, state: {}, at: '2026-07-30T01:00:00Z' });
  const cleared = listOf(syncAlert.buildMessages({ ky: '07.2026', items: [], state, recipientList: list }));
  assert.match(cleared.VP018, /đã xử lý xong/);
  assert.match(cleared.CEO, /đã được xử lý xong/);
  state = syncAlert.markState({ items: [], state, at: '2026-07-31T01:00:00Z' });
  assert.deepEqual(syncAlert.buildMessages({ ky: '07.2026', items: [], state, recipientList: list }), [],
    'đã báo "đã hết" rồi thì không nhắc lại nữa');
});

test('MỨC 1 KHẨN: bất biến vỡ thì gửi NGAY cho tất cả, nói rõ ĐÃ DỪNG chưa ghi slot', () => {
  const messages = syncAlert.buildMessages({
    ky: '07.2026', items: ITEMS, state: {}, recipientList: syncAlert.recipients().list,
    urgent: { invariantBroken: true, sourceTotal: 28_957_771_643, includedTotal: 28_575_193_243, excludedTotal: 0, diff: 382_578_400, detail: 'thiếu 382.578.400đ không nằm ở cả hai phía' },
  });
  assert.equal(messages.length, 3, 'khẩn thì cả 3 người nhận đều phải biết');
  for (const message of messages) {
    assert.equal(message.level, 'urgent');
    assert.match(message.text, /KHẨN/);
    assert.match(message.text, /Σ\(đưa vào\) \+ Σ\(loại\) ≠ Σ\(nguồn\)/);
    assert.match(message.text, /ĐÃ DỪNG, CHƯA GHI SLOT/);
    assert.match(message.text, /382\.578\.400đ/);
  }
});

test('mã lý do lạ vẫn hiện ra, không im lặng bỏ, và nói rõ là chưa khai báo', () => {
  const messages = syncAlert.buildMessages({
    ky: '07.2026', state: {}, recipientList: syncAlert.recipients().list,
    items: [{ ky: '07.2026', reason: 'MOT_LY_DO_LA', orderCode: 'DH000', amount: 9_000_000 }],
  });
  const fixer = listOf(messages).VP018;
  assert.ok(fixer, 'lý do lạ mặc định về nhóm đơn hàng để có người thấy');
  assert.match(fixer, /DH000/);
  assert.match(fixer, /CHƯA KHAI BÁO/);
});

test('cắt bản ghi trạng thái chỉ cắt mục ĐÃ XỬ LÝ, không bao giờ cắt mục đang tồn', () => {
  const at = '2026-07-30T01:00:00Z';
  let state = {};
  // Nhồi quá hạn mức bằng các mục đã xử lý.
  for (let i = 0; i < syncAlert.STATE_LIMIT + 50; i += 1) {
    state[`07.2026|OLD|REF${i}`] = { firstSeenAt: at, lastSeenAt: at, resolvedAt: `2026-07-01T00:00:0${i % 10}Z` };
  }
  const live = [{ ky: '07.2026', reason: 'MISA_REVENUE_DATE_NULL', orderCode: 'DHLIVE', amount: 1_000 }];
  state = syncAlert.markState({ items: live, state, at });
  assert.ok(Object.keys(state).length <= syncAlert.STATE_LIMIT);
  assert.ok(state['07.2026|MISA_REVENUE_DATE_NULL|DHLIVE'], 'mục đang tồn phải còn nguyên');
});
