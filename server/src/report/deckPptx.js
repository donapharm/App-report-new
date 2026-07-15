'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const PptxGenJS = require('pptxgenjs');

const CHROME_CANDIDATES = [
  process.env.REPORT_DECK_CHROME,
  '/home/osboxes/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  const hit = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!hit) throw new Error('Không tìm thấy Chromium để render PPTX.');
  return hit;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPage(port) {
  let last;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((x) => x.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch (e) { last = e; }
    await delay(100);
  }
  throw new Error(`Chromium CDP không sẵn sàng${last ? `: ${last.message}` : ''}`);
}

function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
    else resolve(msg.result || {});
  });
  const call = async (method, params = {}) => {
    await opened;
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { call, close: () => socket.close() };
}

async function screenshotsFromHtml(htmlPath, { width = 1280, height = 720, imageDir, expectedCount = 32 } = {}) {
  const input = path.resolve(htmlPath);
  if (!fs.existsSync(input)) throw new Error(`Không tìm thấy HTML deck: ${input}`);
  const outDir = imageDir || fs.mkdtempSync(path.join(os.tmpdir(), 'donapharm-deck-slides-'));
  fs.mkdirSync(outDir, { recursive: true });
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'donapharm-deck-chrome-'));
  const chrome = spawn(chromePath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let client;
  try {
    const page = await waitForPage(port);
    client = cdp(page.webSocketDebuggerUrl);
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const url = `file://${input}?capture=1`;
    await client.call('Page.navigate', { url });
    let count = 0;
    for (let i = 0; i < 100; i += 1) {
      await delay(100);
      const r = await client.call('Runtime.evaluate', { expression: `document.readyState === 'complete' ? document.querySelectorAll('.slide').length : 0`, returnByValue: true });
      count = Number(r.result?.value || 0);
      if (count) break;
    }
    if (count !== expectedCount) throw new Error(`Deck HTML phải có ${expectedCount} slide, hiện có ${count}.`);
    const files = [];
    for (let i = 0; i < count; i += 1) {
      await client.call('Runtime.evaluate', {
        expression: `(()=>{const a=[...document.querySelectorAll('.slide')];a.forEach((x,j)=>x.classList.toggle('active',j===${i}));const c=document.querySelector('.controls');if(c)c.style.display='none';document.documentElement.style.background='#071F47';document.body.style.background='#071F47';window.scrollTo(0,0)})()`,
        returnByValue: true,
      });
      await delay(25);
      const shot = await client.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      files.push(file);
    }
    return { files, imageDir: outDir, width, height };
  } finally {
    try { client?.close(); } catch { /* ignore */ }
    try { chrome.kill('SIGTERM'); } catch { /* ignore */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function buildPptx({ htmlPath, outputPath, title = 'DONAPHARM — Báo cáo doanh số chuyên sâu', keepImages = false } = {}) {
  const output = path.resolve(outputPath || path.join(path.dirname(htmlPath), `${path.basename(htmlPath, '.html')}.pptx`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const rendered = await screenshotsFromHtml(htmlPath);
  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'DONAPHARM App Report New';
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
    return { outputPath: output, slideCount: rendered.files.length, bytes: fs.statSync(output).size };
  } finally {
    if (!keepImages) try { fs.rmSync(rendered.imageDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { buildPptx, screenshotsFromHtml, chromePath };
