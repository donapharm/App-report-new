#!/usr/bin/env node
/* Regression tests cho smart.answerQuestion — chống bot Telegram trả lời lạc intent. */
const assert = require('assert');
const smart = require('../src/smart');

async function ask(text, scope = {}) {
  const ans = await smart.answerQuestion({ text, scope });
  return [ans.text, ...(ans.lines || [])].join('\n');
}

(async () => {
  const adminTopUnits = await ask('tháng 07/2026 có doanh thu từ những đơn vị nào nằm trong top 10');
  assert(adminTopUnits.includes('Top 10 đơn vị có doanh thu kỳ 07.2026'), adminTopUnits);
  assert(!adminTopUnits.includes('Doanh thu: 0đ'), adminTopUnits);
  assert(!adminTopUnits.includes('010.BV Quân Y 7B\n• Doanh thu: 0đ'), adminTopUnits);

  const adminTopEmp = await ask('nhân viên nào đang dẫn đầu trong t07.2026');
  assert(adminTopEmp.includes('Top 5 nhân viên') && adminTopEmp.includes('07.2026'), adminTopEmp);
  assert(!adminTopEmp.includes('Tra cứu'), adminTopEmp);

  const adminWhoLead = await ask('ai dẫn đầu tháng 7');
  assert(adminWhoLead.includes('Top 5 nhân viên') && adminWhoLead.includes('07.2026'), adminWhoLead);

  const adminByEmp = await ask('doanh thu theo nhân viên tháng 7');
  assert(adminByEmp.includes('Doanh thu theo nhân viên kỳ 07.2026'), adminByEmp);

  const adminEmpRevenue = await ask('DN016 doanh thu bao nhiêu tháng 7');
  assert(adminEmpRevenue.includes('DN016') && adminEmpRevenue.includes('Doanh thu'), adminEmpRevenue);

  const adminSensitive = await ask('Chi phí % total tháng này');
  assert(adminSensitive.includes('nội dung nhạy cảm'), adminSensitive);

  const adminTopProducts = await ask('top 10 sản phẩm tháng 7');
  assert(adminTopProducts.includes('Top 10 sản phẩm có doanh thu kỳ 07.2026'), adminTopProducts);
  assert(!adminTopProducts.includes('231 tỷ'), adminTopProducts);

  const nvRevenue = await ask('Doanh số tháng 7 của tôi bao nhiêu', { empCode: 'DN001' });
  assert(nvRevenue.includes('tạm khóa trả số'), nvRevenue);
  assert(!nvRevenue.includes('Tra cứu'), nvRevenue);

  const nvTopUnits = await ask('tháng 07/2026 có doanh thu từ những đơn vị nào nằm trong top 10', { empCode: 'DN001' });
  assert(nvTopUnits.includes('tạm khóa trả số'), nvTopUnits);
  assert(!nvTopUnits.includes('010.BV Quân Y 7B'), nvTopUnits);

  const nvEmpRanking = await ask('nhân viên nào dẫn đầu tháng 7', { empCode: 'DN001' });
  assert(nvEmpRanking.includes('xếp hạng nhân viên thuộc quyền CEO/admin'), nvEmpRanking);

  const nvOtherEmpRevenue = await ask('DN016 doanh thu bao nhiêu tháng 7', { empCode: 'DN001' });
  assert(nvOtherEmpRevenue.includes('không được xem doanh thu nhân viên khác'), nvOtherEmpRevenue);

  const nvByUnit = await ask('báo cáo theo từng đơn vị tháng 7', { empCode: 'DN001' });
  assert(nvByUnit.includes('tạm khóa trả số'), nvByUnit);

  console.log('OK smart NLQ regression');
})().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
