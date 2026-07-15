'use strict';

process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const deckData = require('./deckData');
const deckHtml = require('./deckHtml');
const deckPptx = require('./deckPptx');
const notify = require('../notifyChannels');
const salesReport = require('../salesReport');
const persist = require('../persist');

const OUT_DIR = path.join(__dirname, '..', '..', '..', 'artifacts', 'sales-report', 'deck');
const SENT_LOG = 'ceo_deck_sent_log';
const VALID_KINDS = new Set(['week', 'month']);
const pad2 = (n) => String(n).padStart(2, '0');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function isoWeek(dateValue) {
  const d = new Date(`${String(dateValue).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
function fileStem(kind, data, { draft = true } = {}) {
  const [year, month] = String(data.range.to).split('-');
  const period = kind === 'month' ? `THANG_${month}_${year}` : `TUAN_W${pad2(isoWeek(data.range.to))}_${year}`;
  return `BAO_CAO_DOANH_SO_${period}_DONAPHARM${draft ? '_DRAFT' : ''}`;
}
function periodKey(kind, data) { return `deck:${kind}:${data.range.from}:${data.range.to}`; }
function loadLog() { return persist.load(SENT_LOG, []); }
function alreadySent(kind, data) { const key = periodKey(kind, data); return loadLog().some((x) => x.key === key); }
function markSent(kind, data, meta = {}) {
  const key = periodKey(kind, data), log = loadLog();
  if (!log.some((x) => x.key === key)) log.push({ key, kind, from: data.range.from, to: data.range.to, sentAt: new Date().toISOString(), ...meta });
  persist.save(SENT_LOG, log.slice(-300));
  return key;
}
function summary(data) {
  return {
    schemaVersion: data.schemaVersion,
    scope: data.scope,
    kind: data.kind,
    generatedAt: data.generatedAt,
    dataAsOf: data.dataAsOf,
    range: data.range,
    previousRange: data.ranges.prevRange,
    comparison: data.comparisonMeta,
    rowCounts: data.rowCounts,
    totalRevenue: data.totalRevenue,
    previousRevenue: data.previousRevenue,
    deltaRevenue: data.deltaRevenue,
    deltaPct: data.deltaPct,
    employeeCount: data.groupRows.employee.length,
    unitCount: data.groupRows.unit.length,
    productCount: data.groupRows.product.length,
    scoreRows: data.scores.length,
    scoreWarnings: data.scoreWarnings.length,
    scorePolicy: data.scorePolicy,
    disclaimers: data.disclaimers,
  };
}

async function build({ kind = 'week', ranges, draft = true, outputDir = OUT_DIR, keepSlideImages = false } = {}) {
  if (!VALID_KINDS.has(kind)) throw new Error(`Unsupported deck kind: ${kind}`);
  const data = await deckData.build({ kind, ranges });
  if (data.scope !== 'CEO') throw new Error('Deck toàn công ty bắt buộc dùng CEO scope.');
  fs.mkdirSync(outputDir, { recursive: true });
  const stem = fileStem(kind, data, { draft });
  const htmlPath = path.join(outputDir, `${stem}.html`);
  const pptxPath = path.join(outputDir, `${stem}.pptx`);
  const manifestPath = path.join(outputDir, `${stem}.manifest.json`);
  const html = deckHtml.write(data, htmlPath);
  if (html.slideCount !== 32) throw new Error(`HTML deck không đủ 32 slide (${html.slideCount}).`);
  const pptx = await deckPptx.buildPptx({ htmlPath, outputPath: pptxPath, title: `${draft ? '[DRAFT] ' : ''}Báo cáo doanh số ${kind === 'month' ? 'tháng' : 'tuần'} DONAPHARM`, keepImages: keepSlideImages });
  if (pptx.slideCount !== 32) throw new Error(`PPTX deck không đủ 32 slide (${pptx.slideCount}).`);
  const manifest = {
    ...summary(data),
    draft,
    slideCount: 32,
    files: {
      html: { name: path.basename(htmlPath), bytes: fs.statSync(htmlPath).size, sha256: sha256(htmlPath) },
      pptx: { name: path.basename(pptxPath), bytes: fs.statSync(pptxPath).size, sha256: sha256(pptxPath) },
    },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { kind, draft, key: periodKey(kind, data), data, summary: summary(data), htmlPath, pptxPath, manifestPath, slideCount: 32, manifest };
}

async function sendCeo(built, { approved = false, force = false } = {}) {
  if (!approved) throw new Error('Chưa có xác nhận CEO cho phép gửi DRAFT.');
  if (!built?.data || built.data.scope !== 'CEO') throw new Error('Chỉ được gửi deck CEO scope.');
  if (!force && alreadySent(built.kind, built.data)) return { ok: true, skipped: 'duplicate', key: built.key };
  const recipient = salesReport.ceoRecipient();
  const email = notify.emailFor('CEO', recipient.user?.email) || process.env.CEO_EMAIL || '';
  const telegramId = recipient.telegramId || '';
  const kindName = built.kind === 'month' ? 'THÁNG' : 'TUẦN';
  const rangeText = `${built.data.range.from} → ${built.data.range.to}`;
  const subject = `[DRAFT — CHỜ CEO DUYỆT] BÁO CÁO DOANH SỐ ${kindName} DONAPHARM · ${rangeText}`;
  const text = `${subject}\n\nĐính kèm HTML + PowerPoint 32 slide. Chỉ dành cho CEO duyệt; chưa phải bản phát hành chính thức.`;
  const attachments = [
    { filename: path.basename(built.htmlPath), path: built.htmlPath, contentType: 'text/html; charset=utf-8' },
    { filename: path.basename(built.pptxPath), path: built.pptxPath, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  ];
  const emailResult = await notify.sendEmail(email, subject, text, null, attachments);
  const telegramHtml = await notify.sendDocument(telegramId, built.htmlPath, `${subject}\nHTML deck 32 slide`);
  const telegramPptx = await notify.sendDocument(telegramId, built.pptxPath, `${subject}\nPowerPoint 32 slide`);
  const ok = !!(emailResult.ok && telegramHtml.ok && telegramPptx.ok);
  if (ok) markSent(built.kind, built.data, { draft: built.draft, email, telegramId, files: attachments.map((x) => x.filename) });
  return { ok, key: built.key, email: emailResult, telegram: { html: telegramHtml, pptx: telegramPptx }, recipient: { code: 'CEO', emailConfigured: !!email, telegramConfigured: !!telegramId } };
}

function parseArgs(argv) {
  const out = { kind: 'week', send: '', approved: false, force: false };
  for (const arg of argv) {
    if (arg.startsWith('--kind=')) out.kind = arg.split('=')[1];
    else if (arg.startsWith('--send=')) out.send = arg.split('=')[1];
    else if (arg === '--approved') out.approved = true;
    else if (arg === '--force') out.force = true;
  }
  return out;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const built = await build({ kind: args.kind, draft: true });
  const result = { ok: true, kind: built.kind, key: built.key, slideCount: built.slideCount, summary: built.summary, files: { html: built.htmlPath, pptx: built.pptxPath, manifest: built.manifestPath } };
  if (args.send) {
    if (args.send !== 'ceo') throw new Error('Deck chuyên sâu chỉ được gửi cho CEO.');
    result.delivery = await sendCeo(built, { approved: args.approved, force: args.force });
    result.ok = result.delivery.ok;
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { build, sendCeo, alreadySent, markSent, periodKey, fileStem, summary, OUT_DIR };
