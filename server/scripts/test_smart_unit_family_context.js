#!/usr/bin/env node
'use strict';
const assert = require('assert');
const smart = require('../src/smart');
const store = require('../src/store');

const KY = store.latestKy();
const MONTH = Number(String(KY).slice(0, 2));
const CEO = { role: 'ceo' };
const SALE = (emp) => ({ role: 'sale', emp_code: emp });
async function ask(text, scope = {}, session = CEO, context = null) {
  return smart.answerQuestion({ text, scope, session, context });
}

(async () => {
  const all001 = store.getRows({ ky: KY, scope: {} }).filter((r) => /^001(?:\.|-|$)/i.test(String(r.unit_code || '')));
  const allCodes = [...new Set(all001.map((r) => r.unit_code))].sort((a, b) => String(a).localeCompare(String(b), 'vi'));
  assert(allCodes.length >= 3, `Cần dữ liệu test nhóm 001, hiện có ${allCodes.length} mã`);

  const first = await ask(`doanh thu mã đơn vị 001 tháng ${MONTH}`);
  assert(first.context?.kind === 'unit_family' && first.context.familyCode === '001', first.text);
  assert(first.text.includes(`Em tìm thấy ${allCodes.length} mã đơn vị`), first.text);
  assert(first.text.includes('Phương án 3'), first.text);
  allCodes.forEach((code) => assert(first.text.includes(code), `Thiếu mã ${code}`));

  const combined = await ask('phương án 2', {}, CEO, first.context);
  const expectedTotal = all001.reduce((s, r) => s + Number(r.revenue || 0), 0).toLocaleString('vi-VN');
  assert(combined.text.includes(expectedTotal), combined.text);
  assert(!combined.text.includes('\n1. 001.'), combined.text);

  const breakdown = await ask('phương án 3', {}, CEO, first.context);
  assert(breakdown.text.includes(expectedTotal), breakdown.text);
  allCodes.forEach((code) => assert(breakdown.text.includes(code), `Phân tích thiếu ${code}`));
  assert(!breakdown.text.includes('[MISA]') && !breakdown.text.includes('[WEB]'), breakdown.text);

  const second = await ask('mã thứ 2', {}, CEO, first.context);
  assert(second.text.includes(allCodes[1]) && !second.text.includes('Em tìm thấy'), second.text);

  const exact = await ask(`doanh thu mã đơn vị ${allCodes[1]} tháng ${MONTH}`);
  assert(exact.text.includes(allCodes[1]) && !exact.text.includes('Phương án 3'), exact.text);

  // DN009 hiện chỉ có một mã 001: trả thẳng và không được tiết lộ hai mã còn lại.
  const dn009Codes = [...new Set(store.getRows({ ky: KY, scope: { empCode: 'DN009' } }).filter((r) => /^001(?:\.|-|$)/i.test(String(r.unit_code || ''))).map((r) => r.unit_code))];
  assert.strictEqual(dn009Codes.length, 1, `DN009 phải có đúng 1 mã 001 để test, hiện ${dn009Codes.length}`);
  const dn009 = await ask(`doanh thu mã đơn vị 001 tháng ${MONTH}`, { empCode: 'DN009' }, SALE('DN009'));
  assert(dn009.text.includes(dn009Codes[0]) && !dn009.text.includes('Em tìm thấy'), dn009.text);
  allCodes.filter((x) => x !== dn009Codes[0]).forEach((code) => assert(!dn009.text.includes(code), `Lộ mã ngoài quyền ${code}`));

  // Context CEO bị sửa/gửi lại trong phiên NV vẫn phải scope lại backend.
  const forged = await ask('phương án 3', { empCode: 'DN009' }, SALE('DN009'), first.context);
  assert(forged.text.includes(dn009Codes[0]), forged.text);
  allCodes.filter((x) => x !== dn009Codes[0]).forEach((code) => assert(!forged.text.includes(code), `Context giả làm lộ ${code}`));

  // DN001 thấy nhiều hơn một mã nhưng chỉ được gợi ý đúng các mã trong scope của DN001.
  const dn001Codes = [...new Set(store.getRows({ ky: KY, scope: { empCode: 'DN001' } }).filter((r) => /^001(?:\.|-|$)/i.test(String(r.unit_code || ''))).map((r) => r.unit_code))].sort();
  const dn001 = await ask(`doanh thu mã đơn vị 001 tháng ${MONTH}`, { empCode: 'DN001' }, SALE('DN001'));
  assert(dn001.text.includes(`Em tìm thấy ${dn001Codes.length} mã đơn vị`), dn001.text);
  dn001Codes.forEach((code) => assert(dn001.text.includes(code), `DN001 thiếu mã thuộc quyền ${code}`));
  allCodes.filter((x) => !dn001Codes.includes(x)).forEach((code) => assert(!dn001.text.includes(code), `DN001 bị lộ ${code}`));

  const anomaly = await ask('kiểm tra đơn bị lỗi do tổng tiền chưa đúng', {}, CEO, breakdown.context);
  assert(anomaly.text.startsWith('Kiểm tra tính nhất quán tổng tiền đơn hàng'), anomaly.text);
  const expectedOrders = new Set(all001.map((r) => r.source_order).filter(Boolean)).size;
  assert(anomaly.text.includes(`${expectedOrders} đơn / ${all001.length} dòng hàng`), anomaly.text);
  assert(!anomaly.text.includes('Doanh thu theo đơn hàng'), anomaly.text);

  const genericOrders = await ask(`liệt kê đơn hàng tháng ${MONTH}`);
  assert(genericOrders.text.includes('Doanh thu theo đơn hàng'), genericOrders.text);

  console.log(`OK smart unit-family/context/scope regression (${KY})`);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
