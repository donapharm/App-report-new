import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

const source = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

const payload = (over = {}) => ({
  empCode: 'DN001', period: '07.2026',
  paymentSchedule: {
    available: true, period: '2026-07', reason: null,
    total: 200_000_000, received: 50_000_000, outstanding: 150_000_000,
    twoInstalmentsOnly: false, invariantOk: true, warnings: [],
    c44: { amount: 15_176_446, note: 'Khoản riêng · cộng dồn · chi trả T12' },
    installments: [
      { index: 1, key: 'advance', label: 'Lần 1 · Ứng', amount: 50_000_000, dueDate: '2026-07-31', gapNote: '', status: 'paid', source: 'app_salary', editable: false, daysFromToday: -4 },
      { index: 2, key: 'second', label: 'Lần 2 · Ứng', amount: 90_000_000, dueDate: '2026-09-14', gapNote: 'cách Lần 1 khoảng 45 ngày (±15)', status: 'plan', source: 'app_report', editable: true, daysFromToday: 41 },
      { index: 3, key: 'final', label: 'Lần 3 · Tất toán', amount: 60_000_000, dueDate: '2026-09-29', gapNote: 'cách Lần 2 khoảng 15 ngày · tổng 60 ngày từ Lần 1', status: 'plan', source: 'app_report', editable: false, daysFromToday: 56 },
    ],
    ...over,
  },
});

test('view model giữ nguyên sổ backend trả, không tự cộng trừ lại', () => {
  const model = employeeCostViewModel(payload());
  const book = model.paymentSchedule;
  assert.equal(book.available, true);
  assert.deepEqual(book.installments.map((i) => i.amount), [50_000_000, 90_000_000, 60_000_000]);
  assert.equal(book.received, 50_000_000);
  assert.equal(book.outstanding, 150_000_000);
  assert.equal(book.c44.amount, 15_176_446);
  assert.equal(book.installments.reduce((s, i) => s + i.amount, 0), book.total, 'tổng các lần phải bằng tổng kỳ');
});

test('thiếu nguồn ⇒ giữ nguyên lý do, KHÔNG dựng sổ rỗng', () => {
  const model = employeeCostViewModel(payload({
    available: false, reason: 'first_advance_unavailable', total: null,
    received: null, outstanding: null, installments: [], c44: null,
  }));
  assert.equal(model.paymentSchedule.available, false);
  assert.equal(model.paymentSchedule.reason, 'first_advance_unavailable');
  assert.equal(model.paymentSchedule.total, null, 'không được thành 0');
  assert.deepEqual(model.paymentSchedule.installments, []);
});

test('không có sổ trong payload ⇒ null, màn không vẽ gì', () => {
  assert.equal(employeeCostViewModel({ empCode: 'DN001', period: '07.2026' }).paymentSchedule, null);
});

test('màn: sổ chỉ hiện khi chọn 1 NV, có cảnh báo khi sổ chưa cân, nói rõ lý do thiếu nguồn', () => {
  assert.match(source, /function PaymentSchedulePanel/);
  assert.match(source, /if \(allEmployees\) return null;/, 'chế độ Tất cả NV không dựng sổ (self-scope)');
  assert.match(source, /Sổ chưa cân/, 'phải cảnh báo khi bất biến gãy');
  assert.match(source, /first_advance_unavailable: 'Chưa lấy được số ứng lần 1 từ App Salary'/);
  assert.match(source, /chưa ai ghi nhận đã trả thì vẫn là kế hoạch/, 'không được để hiểu nhầm là đã nhận');
  assert.match(source, /còn \$\{days\} ngày/, 'phải ghi "còn N ngày" cho NV khỏi tự nhẩm');
});
