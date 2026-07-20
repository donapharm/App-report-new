'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const PptxGenJS = require('pptxgenjs');

const CHROME_CANDIDATES = [
  process.env.REPORT_DECK_CHROME,
  '/opt/pw-browsers/chromium',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux64/chrome',
  '/home/osboxes/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function isExecutable(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function chromePath() {
  const hit = CHROME_CANDIDATES.find(isExecutable);
  if (!hit) throw new Error('Không tìm thấy Chromium để render PPTX. Đặt REPORT_DECK_CHROME tới file executable.');
  return hit;
}
function fileUrl(file, query = '') {
  const url = pathToFileURL(path.resolve(file));
  url.search = query;
  return url.href;
}

async function screenshotsFromHtml(htmlPath, {
  width = 1280,
  height = 720,
  imageDir,
  expectedCount = 32,
  strictOverflow = true,
} = {}) {
  const input = path.resolve(htmlPath);
  if (!fs.existsSync(input)) throw new Error(`Không tìm thấy HTML deck: ${input}`);
  const outDir = imageDir || fs.mkdtempSync(path.join(os.tmpdir(), 'donapharm-deck-slides-'));
  fs.mkdirSync(outDir, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromePath(),
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files'],
    });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(fileUrl(input, 'capture=1'), { waitUntil: 'load' });
    await page.waitForFunction((count) => document.readyState === 'complete' && document.querySelectorAll('.slide').length === count, expectedCount);
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    const count = await page.locator('.slide').count();
    if (count !== expectedCount) throw new Error(`Deck HTML phải có ${expectedCount} slide, hiện có ${count}.`);

    const files = [];
    const overflowIssues = [];
    for (let i = 0; i < count; i += 1) {
      const qa = await page.evaluate((index) => {
        const slides = [...document.querySelectorAll('.slide')];
        slides.forEach((node, j) => node.classList.toggle('active', j === index));
        const controls = document.querySelector('.controls');
        if (controls) controls.style.display = 'none';
        document.documentElement.style.background = '#071F47';
        document.body.style.background = '#071F47';
        window.scrollTo(0, 0);
        const active = slides[index];
        const watched = [active, ...active.querySelectorAll('.content,.card,.chart-card,.conclusion,.toc')];
        const overflow = watched.map((node) => ({
          tag: node.className || node.tagName,
          width: [node.clientWidth, node.scrollWidth],
          height: [node.clientHeight, node.scrollHeight],
        })).filter((x) => x.width[1] > x.width[0] + 2 || x.height[1] > x.height[0] + 2);
        return { slide: index + 1, overflow };
      }, i);
      if (qa.overflow.length) overflowIssues.push(qa);
      await page.waitForTimeout(25);
      const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file, type: 'png', fullPage: false, animations: 'disabled' });
      files.push(file);
    }
    if (strictOverflow && overflowIssues.length) {
      throw new Error(`Deck có nội dung tràn ở slide: ${overflowIssues.map((x) => x.slide).join(', ')}`);
    }
    return { files, imageDir: outDir, width, height, overflowIssues, renderer: 'playwright' };
  } catch (error) {
    if (!imageDir) try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw error;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

async function buildPdfFallback({ htmlPath, outputPath } = {}) {
  const input = path.resolve(htmlPath);
  if (!fs.existsSync(input)) throw new Error(`Không tìm thấy HTML deck: ${input}`);
  const output = path.resolve(outputPath || path.join(path.dirname(input), `${path.basename(input, '.html')}.pdf`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
    const page = await browser.newPage();
    await page.goto(fileUrl(input), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: output,
      width: '13.333333in',
      height: '7.5in',
      margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
      printBackground: true,
      displayHeaderFooter: false,
    });
    if (!fs.existsSync(output) || fs.statSync(output).size < 1000) throw new Error('Chromium không tạo được PDF fallback hợp lệ.');
    return { outputPath: output, bytes: fs.statSync(output).size, format: 'pdf', fallback: true };
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

async function buildPptx({ htmlPath, outputPath, title = 'DONAPHARM — Báo cáo doanh số chuyên sâu', keepImages = false } = {}) {
  const output = path.resolve(outputPath || path.join(path.dirname(htmlPath), `${path.basename(htmlPath, '.html')}.pptx`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const rendered = await screenshotsFromHtml(htmlPath);
  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'DONAPHARM App Report';
    pptx.company = 'DONAPHARM';
    pptx.subject = 'Báo cáo doanh số chuyên sâu dành cho CEO';
    pptx.title = title;
    pptx.lang = 'vi-VN';
    pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'vi-VN' };
    for (const file of rendered.files) {
      const slide = pptx.addSlide();
      slide.background = { color: '071F47' };
      slide.addImage({ path: file, x: 0, y: 0, w: 13.333333, h: 7.5 });
    }
    await pptx.writeFile({ fileName: output });
    return {
      outputPath: output,
      slideCount: rendered.files.length,
      bytes: fs.statSync(output).size,
      renderer: rendered.renderer,
      overflowIssues: rendered.overflowIssues,
    };
  } finally {
    if (!keepImages) try { fs.rmSync(rendered.imageDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { buildPptx, buildPdfFallback, screenshotsFromHtml, chromePath };
