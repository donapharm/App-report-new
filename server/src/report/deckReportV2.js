'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const deckData = require('./deckDataV2');
const deckHtml = require('./deckHtmlV2');
const { buildPptxV2 } = require('./deckPptxV2');

const OUT_DIR = path.join(__dirname, '..', '..', '..', 'artifacts', 'sales-report', 'deck-v2');
function isoWeek(value) { const d = new Date(`${value}T12:00:00`); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil((((t - start) / 86400000) + 1) / 7); }
function basename(kind, data) { const y = data.dataAsOf.slice(0, 4); const m = data.dataAsOf.slice(5, 7); return kind === 'week' ? `BAO_CAO_DOANH_SO_TUAN_W${String(isoWeek(data.period.current.to)).padStart(2, '0')}_${y}_GROUP_DONAPHARM_DRAFT_V2` : `BAO_CAO_DOANH_SO_THANG_${m}_${y}_GROUP_DONAPHARM_DRAFT_V2`; }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function buildOne(kind) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const data = await deckData.build({ kind }); const base = basename(kind, data); const htmlPath = path.join(OUT_DIR, `${base}.html`); const pptxPath = path.join(OUT_DIR, `${base}.pptx`); const manifestPath = path.join(OUT_DIR, `${base}.manifest.json`);
  fs.writeFileSync(htmlPath, deckHtml.render(data));
  const pptx = await buildPptxV2({ htmlPath, outputPath: pptxPath, title: `${data.company.coverName} — ${kind === 'week' ? 'Báo cáo tuần' : 'Báo cáo tháng'} — DRAFT V2` });
  const assets = deckHtml.visualAssets(data);
  const manifest = { schemaVersion: 2, draft: true, kind, generatedAt: new Date().toISOString(), range: data.period.current, comparison: { range: data.period.previous, method: data.period.comparisonMethod, label: data.period.comparisonLabel, valid: data.quality.comparisonValid }, totals: data.totals, quality: data.quality, scoreXuTotals: data.scoreXu.totals, sourceGroups: data.dimensions.sourceGroup.map((x) => ({ key: x.key, revenue: x.revenue, share: x.share })), slides: 32, render: { width: 1920, height: 1080 }, rotation: { coverPhotoIndex: assets.coverIndex, endPhotoIndex: assets.endIndex, libraryCount: 20 }, files: { html: { name: path.basename(htmlPath), bytes: fs.statSync(htmlPath).size, sha256: sha(htmlPath) }, pptx: { name: path.basename(pptxPath), bytes: fs.statSync(pptxPath).size, sha256: sha(pptxPath), slides: pptx.slideCount } } };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { kind, data, htmlPath, pptxPath, manifestPath, manifest };
}
async function buildAll() { return [await buildOne('week'), await buildOne('month')]; }
async function main() { const arg = process.argv.find((x) => x.startsWith('--kind='))?.split('=')[1] || 'all'; const out = arg === 'all' ? await buildAll() : [await buildOne(arg)]; console.log(JSON.stringify(out.map((x) => ({ kind: x.kind, html: x.htmlPath, pptx: x.pptxPath, manifest: x.manifestPath, total: x.data.totals.companyRevenue, slides: x.manifest.slides })), null, 2)); }
if (require.main === module) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
module.exports = { buildOne, buildAll, basename, OUT_DIR };
