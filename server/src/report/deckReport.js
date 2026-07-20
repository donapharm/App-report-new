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
function deliveryKey(kind, data, { draft = false } = {}) { return draft ? `deck:draft:${kind}:${data.range.from}:${data.range.to}` : periodKey(kind, data); }
function loadLog() { return persist.load(SENT_LOG, []); }
function sentEntry(kind, data, options = {}) { const key = deliveryKey(kind, data, options); return loadLog().find((x) => x.key === key) || null; }
function alreadySent(kind, data, options = {}) {
  const entry = sentEntry(kind, data, options);
  return !!(entry && entry.status !== 'partial' && entry.ok !== false);
}
function saveProgress(kind, data, patch = {}, options = {}) {
  const key = deliveryKey(kind, data, options), log = loadLog();
  const index = log.findIndex((x) => x.key === key);
  const current = index >= 0 ? log[index] : { key, kind, draft: !!options.draft, from: data.range.from, to: data.range.to };
  const next = { ...current, ...patch, key, kind, draft: !!options.draft, updatedAt: new Date().toISOString() };
  if (index >= 0) log[index] = next; else log.push(next);
  persist.save(SENT_LOG, log.slice(-300));
  return next;
}
function markSent(kind, data, meta = {}, options = {}) {
  const key = deliveryKey(kind, data, options);
  saveProgress(kind, data, { ...meta, ok: true, status: 'sent', sentAt: new Date().toISOString() }, options);
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
  const html = deckHtml.write(data, htmlPath, { draft });
  if (html.slideCount !== 32) throw new Error(`HTML deck không đủ 32 slide (${html.slideCount}).`);
  let pptx = null, pdf = null, renderWarning = '';
  try {
    pptx = await deckPptx.buildPptx({ htmlPath, outputPath: pptxPath, title: `${draft ? '[DRAFT] ' : ''}Báo cáo doanh số ${kind === 'month' ? 'tháng' : 'tuần'} DONAPHARM`, keepImages: keepSlideImages });
    if (pptx.slideCount !== 32) throw new Error(`PPTX deck không đủ 32 slide (${pptx.slideCount}).`);
  } catch (error) {
    renderWarning = `Không tạo được PPTX: ${error.message}. Đã tạo PDF fallback.`;
    const pdfPath = path.join(outputDir, `${stem}.pdf`);
    pdf = await deckPptx.buildPdfFallback({ htmlPath, outputPath: pdfPath });
  }
  const files = {
    html: { name: path.basename(htmlPath), bytes: fs.statSync(htmlPath).size, sha256: sha256(htmlPath) },
  };
  if (pptx) files.pptx = { name: path.basename(pptxPath), bytes: fs.statSync(pptxPath).size, sha256: sha256(pptxPath) };
  if (pdf) files.pdf = { name: path.basename(pdf.outputPath), bytes: fs.statSync(pdf.outputPath).size, sha256: sha256(pdf.outputPath), fallback: true };
  const manifest = {
    ...summary(data),
    draft,
    slideCount: 32,
    renderer: pptx?.renderer || 'chromium-pdf-fallback',
    renderWarning: renderWarning || null,
    files,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { kind, draft, key: deliveryKey(kind, data, { draft }), data, summary: summary(data), htmlPath, pptxPath: pptx ? pptxPath : null, pdfPath: pdf?.outputPath || null, manifestPath, slideCount: 32, manifest };
}

async function sendCeo(built, { approved = false, force = false, notifyChannels = notify, recipientProvider = salesReport.ceoRecipient } = {}) {
  if (!approved) throw new Error(`Chưa có xác nhận CEO cho phép gửi ${built?.draft ? 'DRAFT' : 'bản chính thức'}.`);
  if (!built?.data || built.data.scope !== 'CEO') throw new Error('Chỉ được gửi deck CEO scope.');
  if (!force && alreadySent(built.kind, built.data, { draft: built.draft })) return { ok: true, skipped: 'duplicate', key: built.key };
  const recipient = recipientProvider();
  if (String(recipient?.code || '').toUpperCase() !== 'CEO') throw new Error('Deck toàn công ty chỉ được giao cho mã CEO.');
  const email = notifyChannels.emailFor('CEO', recipient.user?.email) || process.env.CEO_EMAIL || '';
  const telegramId = recipient.telegramId || '';
  const kindName = built.kind === 'month' ? 'THÁNG' : 'TUẦN';
  const rangeText = `${built.data.range.from} → ${built.data.range.to}`;
  const prefix = built.draft ? '[DRAFT — CHỜ CEO DUYỆT] ' : '';
  const subject = `${prefix}BÁO CÁO DOANH SỐ ${kindName} DONAPHARM · ${rangeText}`;
  const fileSpecs = [
    { key: 'html', path: built.htmlPath, contentType: 'text/html; charset=utf-8', label: 'HTML deck 32 slide' },
    built.pptxPath
      ? { key: 'pptx', path: built.pptxPath, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint 32 slide' }
      : { key: 'pdf', path: built.pdfPath, contentType: 'application/pdf', label: 'PDF fallback 32 trang' },
  ].filter((x) => x.path);
  const formatText = fileSpecs.map((x) => x.key.toUpperCase()).join(' + ');
  const text = built.draft
    ? `${subject}\n\nĐính kèm ${formatText}. Chỉ dành cho CEO duyệt; chưa phải bản phát hành chính thức.`
    : `${subject}\n\nĐính kèm ${formatText}. Báo cáo chính thức chỉ gửi CEO.`;
  const attachments = fileSpecs.map((x) => ({ filename: path.basename(x.path), path: x.path, contentType: x.contentType }));
  const options = { draft: built.draft };
  let progress = force ? null : sentEntry(built.kind, built.data, options);
  if (force) progress = saveProgress(built.kind, built.data, { ok: false, status: 'partial', channels: {} }, options);
  const channels = progress?.channels || {};
  const emailResult = channels.email?.ok
    ? { ...channels.email, resumed: true }
    : await notifyChannels.sendEmail(email, subject, text, null, attachments);
  progress = saveProgress(built.kind, built.data, { ok: false, status: 'partial', channels: { ...channels, email: emailResult } }, options);
  const telegram = { ...(progress.channels?.telegram || {}) };
  for (const file of fileSpecs) {
    if (telegram[file.key]?.ok && !force) telegram[file.key] = { ...telegram[file.key], resumed: true };
    else telegram[file.key] = await notifyChannels.sendDocument(telegramId, file.path, `${subject}\n${file.label}`);
    progress = saveProgress(built.kind, built.data, { ok: false, status: 'partial', channels: { ...progress.channels, telegram: { ...telegram } } }, options);
  }
  const ok = !!(emailResult.ok && Object.values(telegram).every((x) => x.ok));
  if (ok) markSent(built.kind, built.data, { email, telegramId, files: attachments.map((x) => x.filename), channels: progress.channels }, options);
  return { ok, key: built.key, email: emailResult, telegram, recipient: { code: 'CEO', emailConfigured: !!email, telegramConfigured: !!telegramId } };
}

function parseArgs(argv) {
  const out = { kind: 'week', send: '', approved: false, force: false, draft: true };
  for (const arg of argv) {
    if (arg.startsWith('--kind=')) out.kind = arg.split('=')[1];
    else if (arg.startsWith('--send=')) out.send = arg.split('=')[1];
    else if (arg === '--approved') out.approved = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--official' || arg === '--draft=false') out.draft = false;
    else if (arg === '--draft' || arg === '--draft=true') out.draft = true;
  }
  return out;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const built = await build({ kind: args.kind, draft: args.draft });
  const result = { ok: true, kind: built.kind, draft: built.draft, key: built.key, slideCount: built.slideCount, summary: built.summary, renderWarning: built.manifest.renderWarning, files: { html: built.htmlPath, pptx: built.pptxPath, pdf: built.pdfPath, manifest: built.manifestPath } };
  if (args.send) {
    if (args.send !== 'ceo') throw new Error('Deck chuyên sâu chỉ được gửi cho CEO.');
    result.delivery = await sendCeo(built, { approved: args.approved, force: args.force });
    result.ok = result.delivery.ok;
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { build, sendCeo, alreadySent, markSent, sentEntry, periodKey, deliveryKey, fileStem, summary, parseArgs, OUT_DIR };
