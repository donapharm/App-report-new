'use strict';
/**
 * TIN NHẮN THEO QUY TRÌNH — CEO chốt 04/08/2026 21:55: mỗi lần NV gửi đề nghị thì
 * nhắn CEO; CEO duyệt thì nhắn lại NV; xin ứng sớm, duyệt sớm, từ chối… đều nhắn.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { flowNotice, sendFlowNotice, AUDIENCE } = require('../src/paymentFlowNotify');

const base = {
  empCode: 'DN006', employeeName: 'Nguyễn Trọng Hiếu', period: '2026-07', key: 'second',
  amount: 236_077_399, dueDate: '2026-09-14', graceDate: '2026-09-29',
};

test('‼ NV làm gì thì báo CEO; CEO làm gì thì báo NV', () => {
  assert.equal(flowNotice({ ...base, from: 'plan', to: 'requested' }).audience, 'ceo');
  assert.equal(flowNotice({ ...base, from: 'plan', to: 'unlock_requested' }).audience, 'ceo');
  assert.equal(flowNotice({ ...base, from: 'requested', to: 'approved' }).audience, 'employee');
  assert.equal(flowNotice({ ...base, from: 'unlock_requested', to: 'unlocked' }).audience, 'employee');
  assert.equal(flowNotice({ ...base, from: 'requested', to: 'plan' }).audience, 'employee');
});

test('tin gửi CEO phải đủ để quyết mà không cần mở app', () => {
  const notice = flowNotice({ ...base, from: 'plan', to: 'requested' });
  assert.match(notice.text, /DN006 · Nguyễn Trọng Hiếu/);
  assert.match(notice.text, /Lần 2 kỳ 07\/2026: 236\.077\.399đ/);
  assert.match(notice.text, /Hạn 14\/09\/2026/);
  assert.match(notice.text, /còn nhận được tới 29\/09\/2026/);
  assert.match(notice.text, /DUYỆT hoặc TỪ CHỐI/);
});

test('‼ xin nhận sớm phải kèm LÝ DO cho CEO đọc', () => {
  const notice = flowNotice({ ...base, from: 'plan', to: 'unlock_requested', note: 'con nhập viện' });
  assert.equal(notice.audience, 'ceo');
  assert.match(notice.text, /XIN NHẬN SỚM/);
  assert.match(notice.text, /“con nhập viện”/);
  assert.match(notice.text, /MỞ KHOÁ hoặc TỪ CHỐI/);
});

test('‼ từ chối phải nói rõ NV ĐỀ NGHỊ LẠI được, kèm lý do', () => {
  const notice = flowNotice({ ...base, from: 'requested', to: 'plan', note: 'chờ thu tiền về' });
  assert.match(notice.text, /SẾP CHƯA DUYỆT/);
  assert.match(notice.text, /“chờ thu tiền về”/);
  assert.match(notice.text, /ĐỀ NGHỊ LẠI được/);
});

test('‼ đứng yên ở "kế hoạch" thì KHÔNG nhắn — tránh tin rác', () => {
  assert.equal(flowNotice({ ...base, from: 'plan', to: 'plan' }), null);
  assert.equal(flowNotice({ ...base, from: '', to: 'plan' }), null);
});

test('duyệt xong phải nói rõ CHƯA phải đã nhận tiền', () => {
  const notice = flowNotice({ ...base, from: 'requested', to: 'approved' });
  assert.match(notice.text, /Đang chờ chuyển tiền/);
  assert.match(notice.text, /sẽ nhận thêm một tin nữa/);
});

test('các việc khác cũng nhắn: đã trả · gỡ ghi nhận · đổi số Lần 2', () => {
  assert.match(flowNotice({ ...base, from: 'approved', to: 'paid', dueDate: '2026-09-16' }).text, /ĐÃ CHUYỂN/);
  assert.match(flowNotice({ ...base, from: 'paid', to: 'undone' }).text, /GỠ GHI NHẬN/);
  assert.match(flowNotice({ ...base, from: 'plan', to: 'second_changed' }).text, /ĐỔI SỐ Lần 2/);
});

test('Lần 3 gọi đúng tên, không gọi trơ "final"', () => {
  assert.match(flowNotice({ ...base, key: 'final', from: 'plan', to: 'requested' }).text, /Lần 3 · tất toán/);
});

test('nấc lạ thì không nhắn bừa', () => {
  assert.equal(flowNotice({ ...base, from: 'plan', to: 'nấc_lạ' }), null);
  assert.equal(Object.keys(AUDIENCE).includes('nấc_lạ'), false);
});

/* ── Gửi thật: hỏng cũng KHÔNG được làm hỏng việc ghi sổ ────────────────────── */

test('‼ Telegram lỗi thì NUỐT lỗi, không ném ra ngoài', async () => {
  const notice = flowNotice({ ...base, from: 'plan', to: 'requested' });
  const result = await sendFlowNotice(notice, {
    resolve: () => ({ telegramId: '123' }),
    deliver: async () => { throw new Error('telegram 500'); },
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'error');
});

test('không tìm ra người nhận thì báo rõ, không giả vờ đã gửi', async () => {
  const notice = flowNotice({ ...base, from: 'plan', to: 'requested' });
  assert.equal((await sendFlowNotice(notice, { resolve: () => null, deliver: async () => ({ ok: true }) })).reason, 'no_recipient');
  assert.equal((await sendFlowNotice(notice, {})).reason, 'not_configured');
});

test('gửi được thì báo đã gửi', async () => {
  const sent = [];
  const notice = flowNotice({ ...base, from: 'plan', to: 'requested' });
  const result = await sendFlowNotice(notice, {
    resolve: (audience) => ({ telegramId: audience === 'ceo' ? 'CEO_CHAT' : 'NV_CHAT' }),
    deliver: async (payload) => { sent.push(payload); return { ok: true }; },
  });
  assert.equal(result.sent, true);
  assert.equal(sent[0].telegramId, 'CEO_CHAT', 'đề nghị của NV phải bay tới CEO');
  assert.match(sent[0].text, /ĐỀ NGHỊ NHẬN/);
});
