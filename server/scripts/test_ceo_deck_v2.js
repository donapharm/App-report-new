'use strict';
const assert = require('assert');
const data = require('../src/report/deckDataV2');
const html = require('../src/report/deckHtmlV2');

(async () => {
  const week = await data.build({ kind: 'week' }); const month = await data.build({ kind: 'month' });
  assert.equal(week.schemaVersion, 2); assert.equal(month.schemaVersion, 2);
  assert.notDeepEqual(week.period.current, month.period.current, 'Tuần/tháng phải có kỳ riêng');
  assert.deepEqual(week.period.current, { from: '2026-07-06', to: '2026-07-12' });
  assert.equal(week.totals.companyRevenue, 10673685281);
  assert.equal(week.quality.canCompareExactly, false);
  assert.equal(week.totals.comparisonRevenue, null, 'Không được nội suy tuần khi thiếu daily history');
  assert.equal(month.totals.companyRevenue, 16589980621);
  assert(Math.abs(month.totals.comparisonRevenue - 28403136096 * 13 / 30) < 1);
  assert(Math.abs(month.totals.deltaPct - 34.78994197840622) < 1e-6);
  const dona = month.dimensions.sourceGroup.find((x) => x.key === 'Group-Dona'); const partner = month.dimensions.sourceGroup.find((x) => x.key === 'Group-Đối tác');
  assert.equal(dona.revenue, 11398351361); assert.equal(partner.revenue, 5191629260);
  assert.equal(month.quality.mappingCoverage, 100);
  assert(month.scoreXu.totals.diemThang > 0 && month.scoreXu.totals.xuThang > 0);
  assert(month.scoreXu.rows.every((x) => !month.scoreXu.policy.excludedCodes.includes(x.empCode)));
  assert(month.cstOpportunity.units.length > 0 && month.cstOpportunity.products.length > 0 && month.cstOpportunity.untouched.length > 0);
  assert.equal(month.company.coverName, 'GROUP DONAPHARM'); assert.equal(month.company.legalName, 'CÔNG TY CỔ PHẦN DONAPHARM');
  for (const facts of [week, month]) {
    const doc = html.render(facts); assert.equal((doc.match(/data-slide=\"/g) || []).length, 32); assert(doc.includes('DRAFT V2 · CEO ONLY')); assert(doc.includes('GROUP DONAPHARM')); assert(doc.includes('CÔNG TY CỔ PHẦN DONAPHARM')); assert.equal((doc.match(/class=\"end-qr\"/g) || []).length, 1, 'QR chỉ ở end slide'); assert(!/font-size:[^;}]*v[hw]/.test(doc), 'V2 không dùng vh/vw để thu nhỏ chữ');
  }
  const wa = html.visualAssets(week), ma = html.visualAssets(month); assert(wa.coverIndex >= 1 && wa.coverIndex <= 20); assert(wa.coverIndex !== wa.endIndex); assert(ma.coverIndex !== ma.endIndex);
  console.log('OK CEO deck V2 FACTS + 32-slide HTML + weekly/monthly separation');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
