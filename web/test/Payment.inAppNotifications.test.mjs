import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const employeeCost = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
const paymentPage = fs.readFileSync(new URL('../src/pages/PaymentSchedule.jsx', import.meta.url), 'utf8');
const bell = fs.readFileSync(new URL('../src/CeoNotificationBell.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('payment composer replaces prompt, has 300-char note and no amount input', () => {
  assert.doesNotMatch(employeeCost, /window\.prompt/);
  assert.match(employeeCost, /PaymentRequestComposer/);
  assert.match(employeeCost, /maxLength="300"/);
  assert.match(employeeCost, /Không nhập số tiền/);
  assert.match(employeeCost, /mode === 'early'.*mode === 'other'.*mode === 'reject'/s);
  assert.ok((employeeCost.match(/paymentRequestId\(/g) || []).length >= 4, 'request, unlock, approve/reject đều phải có mã chống gửi trùng');
  const composer = employeeCost.slice(employeeCost.indexOf('function PaymentRequestComposer'), employeeCost.indexOf('export function PaymentSchedulePanel'));
  assert.doesNotMatch(composer, /inputMode="numeric"|type="number"/);
});

test('C44 uses one amber treatment and explicit badge in all three KPI contexts', () => {
  assert.ok((employeeCost.match(/employee-cost-tone-c44/g) || []).length >= 3);
  assert.match(paymentPage, /employee-cost-tone-c44/);
  assert.ok((`${employeeCost}\n${paymentPage}`.match(/CHI T12 · KHÔNG TRONG 3 LẦN/g) || []).length >= 4);
  assert.match(styles, /\.employee-cost-tone-c44/);
});

test('bell has isolated payment tab/count, audience API, adaptive polling and deep-link', () => {
  assert.match(api, /paymentNotifications:/);
  assert.match(api, /paymentNotificationsRead:/);
  assert.match(bell, /paymentFeed/);
  assert.match(bell, /payment-bell-count/);
  assert.match(bell, /document\.hidden \? 60000 : 20000/);
  assert.match(bell, /activeSection === 'payment'/);
  assert.match(bell, /openPaymentEvent/);
  assert.match(paymentPage, /app_nav_payload/);
  assert.match(paymentPage, /focusKey/);
});
