/**
 * ĐỐI SOÁT DOANH THU MÀN ALL (CEO 10/08/2026)
 *
 * CEO: *"Doanh thu thực tế của T07.2026 đâu phải số này, tại sao nó cứ nhảy như
 * điên vậy, và giờ nó đang nằm ở đâu?"* — câu hỏi đúng, và trước đây màn không trả
 * lời được. Phép cân: tổng kỳ = đang hiện + của NV chưa lấy được % + dòng chưa gán NV.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const recon = require('../src/employeeCostRevenueRecon');

const row = (emp, revenue) => ({ emp_code: emp, revenue });

test('tổng đang hiện lấy từ chính toàn bộ dòng ALL trước phân trang', () => {
  assert.equal(recon.sumShownRevenue([
    { period: '2026-06', rows: [row('DN001', 100), { empCode: 'DN002', TONG_TIEN: 250 }] },
    { period: '2026-07', rows: [{ emp_code: 'DN003', tong_tien: 650 }] },
  ]), 1000);
  assert.equal(recon.sumShownRevenue([]), 0);
});

test('route không được đọc merged.summary trước transform — summary chưa tồn tại ở bước đó', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
  assert.match(source, /shownRevenue: employeeCostRevenueRecon\.sumShownRevenue\(merged\.periods\)/);
  assert.match(source, /shownRows: employeeCostRevenueRecon\.shownRowsOf\(merged\.periods\)/);
  assert.doesNotMatch(source, /shownRevenue: merged\.summary\?\.revenueTotal/);
});

test('Allocation V4 giữ dòng NV thiếu nguồn ⇒ không cộng doanh thu của NV đó lần hai', () => {
  const rows = [row('DN001', 1000), row('DN003', 300)];
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'], revenueRowsOf: () => rows, unavailable: ['DN003'],
    shownRevenue: 1300, shownRows: rows,
  });
  assert.equal(result.missingByUnavailable, 0);
  assert.deepEqual(result.unavailableEmployees, []);
  assert.equal(result.gap, 0);
  assert.equal(result.balanced, true);
});

test('NV thiếu nguồn chỉ thiếu MỘT PHẦN trên bảng ⇒ phép cân lấy đúng phần còn thiếu', () => {
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'],
    revenueRowsOf: () => [row('DN001', 1000), row('DN003', 300), row('DN003', 200)],
    unavailable: ['DN003'], shownRevenue: 1200,
    shownRows: [row('DN001', 1000), row('DN003', 200)],
  });
  assert.equal(result.missingByUnavailable, 300);
  assert.deepEqual(result.unavailableEmployees, [{ empCode: 'DN003', revenue: 300 }]);
  assert.equal(result.gap, 0);
  assert.equal(result.balanced, true);
});

test('dòng chưa gán nhưng V4 đã giữ trên bảng cũng không được cộng lần hai', () => {
  const rows = [row('DN001', 1000), row('', 200)];
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'], revenueRowsOf: () => rows, unavailable: [],
    shownRevenue: 1200, shownRows: rows,
  });
  assert.equal(result.missingUnassigned, 0);
  assert.equal(result.gap, 0);
  assert.equal(result.balanced, true);
});

test('‼ phép cân ĐÚNG: tổng kỳ = đang hiện + NV thiếu % + dòng chưa gán', () => {
  const rows = [row('DN001', 1000), row('DN002', 500), row('DN003', 300), row('', 200)];
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'],
    revenueRowsOf: () => rows,
    unavailable: ['DN003'],
    shownRevenue: 1500, // DN001 + DN002
  });
  assert.equal(result.total, 2000);
  assert.equal(result.shown, 1500);
  assert.equal(result.missingByUnavailable, 300);
  assert.equal(result.missingUnassigned, 200);
  assert.equal(result.gap, 0);
  assert.equal(result.balanced, true);
});

test('nêu ĐÍCH DANH từng NV thiếu bao nhiêu tiền, xếp số lớn trước', () => {
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'],
    revenueRowsOf: () => [row('DN003', 300), row('DN012', 900), row('DN001', 100)],
    unavailable: ['DN003', 'DN012'],
    shownRevenue: 100,
  });
  assert.deepEqual(result.unavailableEmployees, [
    { empCode: 'DN012', revenue: 900 },
    { empCode: 'DN003', revenue: 300 },
  ]);
});

test('‼ cân KHÔNG khớp thì NÓI RA, không làm tròn cho đẹp', () => {
  // Chênh 400 không giải thích được ⇒ balanced=false. Một phép cân không cân được
  // mà im lặng là đúng thứ đã khiến CEO mất niềm tin vào cả màn hình.
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'],
    revenueRowsOf: () => [row('DN001', 1000)],
    unavailable: [],
    shownRevenue: 600,
  });
  assert.equal(result.gap, 400);
  assert.equal(result.balanced, false);
});

test('dòng chưa gán NV tách RIÊNG, không trộn vào phần "NV thiếu %"', () => {
  // Hai nguyên nhân khác hẳn nhau, cách xử lý cũng khác: một bên đồng bộ lại %,
  // một bên phải đi gán nhân viên cho dòng.
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'],
    revenueRowsOf: () => [row('', 700), row('DN003', 300)],
    unavailable: ['DN003'],
    shownRevenue: 0,
  });
  assert.equal(result.missingUnassigned, 700);
  assert.equal(result.missingByUnavailable, 300);
});

test('nhiều kỳ thì cộng dồn, và đếm luôn số dòng nguồn', () => {
  const byPeriod = { '2026-06': [row('DN001', 100)], '2026-07': [row('DN001', 250)] };
  const result = recon.buildRevenueRecon({
    periods: ['2026-06', '2026-07'],
    revenueRowsOf: (period) => byPeriod[period],
    unavailable: [],
    shownRevenue: 350,
  });
  assert.equal(result.total, 350);
  assert.equal(result.rowCount, 2);
  assert.equal(result.balanced, true);
});

test('chưa biết số đang hiện ⇒ gap/balanced là null (KHÔNG BIẾT), không phải "cân"', () => {
  const result = recon.buildRevenueRecon({
    periods: ['2026-07'], revenueRowsOf: () => [row('DN001', 100)], unavailable: [], shownRevenue: null,
  });
  assert.equal(result.shown, null);
  assert.equal(result.gap, null);
  assert.equal(result.balanced, null);
});
