'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const deckHtml = require('../src/report/deckHtml');
const deckReport = require('../src/report/deckReport');

const money = (v) => `${Math.round(Number(v || 0)).toLocaleString('vi-VN')}đ`;
const short = (v) => {
  const n = Number(v || 0), a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} tỷ`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} tr`;
  return money(n);
};
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function slide(html, number) {
  const m = html.match(new RegExp(`<section class="slide[^>]*data-slide="${number}"[\\s\\S]*?<\\/section>`));
  assert.ok(m, `Missing slide ${number}`);
  return m[0];
}
function assertPptx(file) {
  assert.ok(fs.statSync(file).size > 100000, `PPTX too small: ${file}`);
  execFileSync('unzip', ['-t', file], { stdio: 'pipe' });
  const entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n');
  assert.equal(entries.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length, 32, 'PPTX slide count');
  assert.equal(entries.filter((x) => /^ppt\/media\/image-\d+-1\.png$/.test(x)).length, 32, 'PPTX full-slide image count');
}
async function checkKind(kind) {
  const built = await deckReport.build({ kind, draft: true });
  const data = built.data;
  const html = fs.readFileSync(built.htmlPath, 'utf8');
  assert.equal((html.match(/<section class="slide/g) || []).length, 32);
  assert.ok(html.includes('[DRAFT — CHỜ CEO DUYỆT]'));
  assert.ok(!deckHtml.render(data, { draft: false }).includes('[DRAFT — CHỜ CEO DUYỆT]'), 'Official render leaked DRAFT label');
  assert.ok(!/\b(?:undefined|NaN|Infinity)\b/.test(html));
  assert.ok(!html.includes('26.889.828.492'), 'Sample-specific revenue leaked');
  for (const code of data.scorePolicy.excludedEmployeeCodes) assert.ok(!html.includes(`>${code}<`), `Excluded employee leaked: ${code}`);

  assert.ok(slide(html, 5).includes(money(data.totalRevenue)), 'Slide 5 total mismatch');
  assert.ok(slide(html, 5).includes(money(data.previousRevenue)), 'Slide 5 previous mismatch');
  const dailyTotal = data.dailyBars.reduce((s, x) => s + x.revenue, 0);
  assert.equal(dailyTotal, data.totalRevenue, 'Slide 6 daily facts do not reconcile');
  if (data.routeBreakdown[0]) {
    assert.ok(slide(html, 8).includes(data.routeBreakdown[0].key));
    assert.ok(slide(html, 8).includes(money(data.routeBreakdown[0].revenue)));
  }
  if (data.sourceBreakdown[0]) assert.ok(slide(html, 10).includes(money(data.sourceBreakdown[0].revenue)));
  if (data.topEmployees[0]) {
    assert.ok(slide(html, 16).includes(data.topEmployees[0].key));
    assert.ok(slide(html, 16).includes(short(data.topEmployees[0].revenue)));
  }
  if (data.topUnits[0]) assert.ok(slide(html, 20).includes(money(data.topUnits[0].revenue)));
  if (data.topProducts[0]) assert.ok(slide(html, 23).includes(money(data.topProducts[0].revenue)));
  const totalPoints = data.scores.reduce((s, x) => s + Number(x.diem_quy || 0), 0);
  assert.ok(slide(html, 26).includes(totalPoints.toLocaleString('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })));

  assert.ok(built.htmlPath && built.pptxPath && built.manifestPath, `Missing built ${kind} artifacts`);
  const htmlPath = built.htmlPath, pptxPath = built.pptxPath;
  const htmlName = path.basename(htmlPath), pptxName = path.basename(pptxPath);
  const manifest = JSON.parse(fs.readFileSync(built.manifestPath));
  assert.equal(manifest.slideCount, 32);
  assert.equal(manifest.scope, 'CEO');
  assert.equal(manifest.totalRevenue, data.totalRevenue);
  assert.equal(manifest.renderer, 'playwright');
  assert.equal(manifest.renderWarning, null);
  assert.equal(manifest.files.html.sha256, sha(htmlPath));
  assert.equal(manifest.files.pptx.sha256, sha(pptxPath));
  assertPptx(pptxPath);
  return { kind, totalRevenue: data.totalRevenue, html: htmlName, pptx: pptxName, htmlBytes: fs.statSync(htmlPath).size, pptxBytes: fs.statSync(pptxPath).size };
}
(async () => {
  const results = [];
  for (const kind of ['week', 'month']) results.push(await checkKind(kind));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
