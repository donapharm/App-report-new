import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composePaymentRequestNote, normalizePaymentRequestReasons, paymentReasonDetailMaxLength } from '../src/paymentRequestReasons.js';

const config = JSON.parse(fs.readFileSync(new URL('../../server/config/payment_request_reasons.json', import.meta.url), 'utf8'));
const payload = normalizePaymentRequestReasons(config);

test('frontend chỉ dùng danh sách backend/config, không dựng lại nhãn', () => {
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.early.length, 5);
  assert.equal(payload.reject.length, 4);
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  for (const option of [...payload.early, ...payload.reject]) {
    assert.equal(page.includes(option.label), false, `frontend không được hard-code: ${option.label}`);
  }
});

test('lý do chuẩn đi nguyên văn vào note', () => {
  const selected = payload.early[0];
  assert.deepEqual(composePaymentRequestNote(payload.early, selected.id, ''), {
    ok: true, note: selected.label, error: '',
  });
});

test('chỉ Khác cần nhập và bắt buộc ít nhất 5 ký tự', () => {
  const custom = payload.early.find((option) => option.requiresDetail);
  assert.equal(composePaymentRequestNote(payload.early, custom.id, 'abcd').ok, false);
  assert.deepEqual(composePaymentRequestNote(payload.early, custom.id, '  abcde  '), {
    ok: true, note: `${custom.label}: abcde`, error: '',
  });
  const maxLength = paymentReasonDetailMaxLength(custom);
  assert.equal(composePaymentRequestNote(payload.early, custom.id, 'x'.repeat(maxLength)).note.length, 300);
  assert.equal(composePaymentRequestNote(payload.early, custom.id, 'x'.repeat(maxLength + 1)).ok, false,
    'UI không được cho ghi note vượt trần 300 của backend');
  assert.equal(composePaymentRequestNote(payload.early, '', 'abcde').ok, false, 'phải chọn đúng một lý do');
});
