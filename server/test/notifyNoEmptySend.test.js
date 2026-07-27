'use strict';
/**
 * CEO chốt 2026-07-27: "nếu không có tin gì thì KHÔNG gửi nhé".
 * Khoá luật này ở CẢ BA luồng, vì mỗi luồng có đường thoát riêng:
 *   1. Báo cáo doanh thu (salesReport.sendAll)   — trước đây gửi VÔ ĐIỀU KIỆN
 *   2. Tổng chi phí NV   (employeeCostNotify)
 *   3. Thưởng            (bonusNotify)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const costNotify = require('../src/employeeCostNotify');
const bonusNotify = require('../src/bonusNotify');

const SALES_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'salesReport.js'), 'utf8');
const BOT_SRC = fs.readFileSync(path.join(__dirname, '..', 'telegram-bot.js'), 'utf8');

// ── 1. Báo cáo doanh thu ────────────────────────────────────────────────────
test('doanh thu: NV không có dòng nào -> bỏ qua, không gửi tin "0đ"', () => {
  assert.match(SALES_SRC, /if \(!rep\.data\?\.rows\?\.length\) \{ skipped\.push\(\{ code: r\.code, reason: 'no_data' \}\); continue; \}/,
    'phải có chốt bỏ qua NV không có dữ liệu');
});

test('doanh thu: cả kỳ không ai có dữ liệu -> im lặng, KHÔNG gửi cả bản tổng CEO', () => {
  const guard = /if \(!anyData\) \{[\s\S]*?return \{ ok: true, skipped: 'no_data'/;
  assert.match(SALES_SRC, guard);
  // Chốt phải nằm TRƯỚC khi dựng digest CEO, nếu không vẫn tốn công và vẫn gửi.
  assert.ok(SALES_SRC.indexOf("skipped: 'no_data', key") < SALES_SRC.indexOf('renderCeoDigest({ kind, ranges })'),
    'chốt no_data phải đứng trước renderCeoDigest');
});

test('doanh thu: kỳ rỗng KHÔNG bị đánh dấu "đã gửi" -> dữ liệu về muộn vẫn gửi được', () => {
  const block = /if \(!anyData\) \{[\s\S]*?\n  \}/.exec(SALES_SRC)[0];
  assert.doesNotMatch(block, /markSent/, 'không được markSent khi chưa gửi gì');
});

// ── 2. Tổng chi phí ─────────────────────────────────────────────────────────
test('chi phí: không có số dùng được -> messageFor trả null (nơi gọi bỏ qua)', () => {
  assert.equal(costNotify.totalFromSummary({ reliable: false, periodTotal: null, provisionalPeriodTotal: null }), null);
  assert.equal(costNotify.messageFor({ kind: 'month', row: { ky: '07.2026' }, total: null }), null);
});

test('chi phí: bot phải bỏ qua khi không có số, không gửi tin rỗng', () => {
  assert.match(BOT_SRC, /if \(!total\) \{ skipped \+= 1; continue; \}/);
  assert.match(BOT_SRC, /if \(!text\) \{ skipped \+= 1; continue; \}/);
});

test('chi phí: số tạm giữ không có -> bỏ hẳn dòng, không in 0đ', () => {
  assert.equal(costNotify.annualFromSummary({ annualTotal: null, provisionalAnnualTotal: null }), null);
  const text = costNotify.messageFor({
    kind: 'month', row: { ky: '07.2026', name: 'A' },
    total: { amount: 1000, provisional: false }, annual: null,
  });
  assert.doesNotMatch(text, /tạm giữ/);
});

// ── 3. Thưởng ───────────────────────────────────────────────────────────────
test('thưởng: không qua mốc nào -> không sinh sự kiện, không có tin', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'));
  const r = bonusNotify.pendingEvents({
    ky: '07.2026',
    rows: [{ emp_code: 'DN001', name: 'A', pct: 12.5, target: 1000, achieved: 125 }],
    config: cfg,
  });
  assert.equal(r.events.length, 0);
});

test('thưởng: không có số P1/P2 hợp lệ -> monthEndMessage trả null', () => {
  assert.equal(bonusNotify.monthEndMessage({ ky: '07.2026' }, { baseAmount: null, priorityAmount: null }), null);
});

test('thưởng: bot bỏ qua khi tin rỗng hoặc thiếu nguồn', () => {
  assert.match(BOT_SRC, /if \(!res \|\| res\.sourceAvailable === false\) \{ skipped \+= 1; continue; \}/);
  assert.match(BOT_SRC, /const text = bonusNotify\.monthEndMessage[\s\S]{0,120}?if \(!text\) \{ skipped \+= 1; continue; \}/);
});

// ── Gộp tin 07:30: không có dòng nào thì không gửi ──────────────────────────
test('tin gộp 07:30: không có dòng nội dung nào -> không gửi', () => {
  assert.match(BOT_SRC, /const text = group\.lines\.filter\(Boolean\)\.join\('\\n\\n'\);\s*\n\s*if \(!text\) continue;/);
});
