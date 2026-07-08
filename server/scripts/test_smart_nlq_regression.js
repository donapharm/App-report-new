#!/usr/bin/env node
/* Regression tests cho smart.answerQuestion — chống bot Telegram trả lời lạc intent.
 * Dùng kỳ CÓ THẬT (store.latestKy) nên chạy được cả trên dữ liệu mẫu lẫn server. */
const assert = require('assert');
const smart = require('../src/smart');
const store = require('../src/store');

const KY = store.latestKy();               // vd '06.2026' (mẫu) hoặc '07.2026' (server)
const M = Number(KY.slice(0, 2));          // số tháng, vd 6
const T = `tháng ${M}`;                    // "tháng 6"

async function ask(text, scope = {}) {
  const ans = await smart.answerQuestion({ text, scope });
  return [ans.text, ...(ans.lines || [])].join('\n');
}

(async () => {
  // 1) "top 10 đơn vị" -> ranking đơn vị, KHÔNG tra cứu nhầm mã "010".
  const topUnits = await ask(`có doanh thu từ những đơn vị nào nằm trong top 10 ${T}`);
  assert(/Top \d+ đơn vị có doanh thu/.test(topUnits), topUnits);
  assert(!topUnits.includes('🔎 Tra cứu'), topUnits);

  // 2) "ai dẫn đầu" -> ranking nhân viên (admin).
  const whoLead = await ask(`nhân viên nào đang dẫn đầu ${T}`);
  assert(whoLead.includes('nhân viên') && !whoLead.includes('🔎 Tra cứu'), whoLead);

  // 3) LỖI trong ảnh: "báo cáo chi tiết các mã hàng có doanh thu cao" -> breakdown sản phẩm,
  //    KHÔNG rơi vào "Chưa tìm thấy thuốc/mã QLNB".
  const reportProducts = await ask(`báo cáo chi tiết các mã hàng có doanh thu cao từ trên xuống ${T}`);
  assert(reportProducts.includes('Doanh thu theo sản phẩm'), reportProducts);
  assert(!reportProducts.includes('Chưa tìm thấy'), reportProducts);

  // 4) top sản phẩm.
  const topProducts = await ask(`top 10 sản phẩm ${T}`);
  assert(/Top \d+ sản phẩm có doanh thu/.test(topProducts), topProducts);

  // 5) Nội dung nhạy cảm bị chặn.
  const sensitive = await ask('Chi phí % total tháng này');
  assert(sensitive.includes('nội dung nhạy cảm'), sensitive);

  // 6) NV không được xem xếp hạng nhân viên.
  const nvEmpRanking = await ask(`nhân viên nào dẫn đầu ${T}`, { empCode: 'DN001' });
  assert(nvEmpRanking.includes('CEO/admin'), nvEmpRanking);

  // 7) NV không xem được doanh thu NV khác.
  const nvOther = await ask(`DN016 doanh thu bao nhiêu ${T}`, { empCode: 'DN001' });
  assert(nvOther.includes('không được xem doanh thu nhân viên khác'), nvOther);

  // 8) Hỏi tháng CHƯA có dữ liệu -> báo thẳng, KHÔNG lặng lẽ trả kỳ khác.
  const noData = await ask('doanh số từ đầu tháng 12.2030 đến hôm nay');
  assert(noData.includes('chưa có dữ liệu'), noData);

  // 9) NV xem doanh thu của CHÍNH MÌNH kỳ có thật -> ra số (không bị khóa cứng).
  const nvSelf = await ask(`doanh thu của tôi ${T}`, { empCode: 'DN001' });
  assert(nvSelf.includes('Doanh thu') && !nvSelf.includes('tạm khóa'), nvSelf);

  console.log(`OK smart NLQ regression (kỳ test = ${KY})`);
})().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
