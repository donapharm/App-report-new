import fs from 'fs';
const outDir = 'verification-screenshots/final-0703-nav-back-reload';
fs.mkdirSync(outDir, { recursive: true });
const pages = await fetch('http://127.0.0.1:18800/json/list').then(r => r.json());
const page = pages.find(p => p.url?.includes('reportnew.donapharm.asia') && p.type === 'page') || pages.find(p => p.type === 'page');
if (!page?.webSocketDebuggerUrl) throw new Error('Không tìm thấy tab reportnew/CDP ws');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
function send(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, (m) => m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result))); }
async function evalJs(expression) { return send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64')); }
async function waitFor(expression, ms = 9000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const r = await evalJs(`Boolean(${expression})`);
    if (r.result.value) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Timeout: ${expression}`);
}
await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
await evalJs(`document.querySelector('button.logout') ? true : location.reload()`);
await waitFor(`document.querySelector('button.logout')`);
await evalJs(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes('💰Doanh thu')) || [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Doanh thu'))?.click()`);
await waitFor(`document.body.innerText.includes('Tổng nhân viên') && document.querySelectorAll('.revenue-detail-card').length > 0`); await shot('01-revenue-root');
await evalJs(`([...document.querySelectorAll('.revenue-detail-card')].find(c=>c.innerText.includes('DN006')) || document.querySelector('.revenue-detail-card'))?.click()`);
await waitFor(`document.body.innerText.includes('Tổng đơn vị') && document.querySelectorAll('.revenue-detail-card').length > 0 && [...document.querySelectorAll('.drill-crumbs button')].length===2`); await shot('02-drill-employee-dn006');
await evalJs(`document.querySelector('.revenue-detail-card')?.click()`);
await waitFor(`document.body.innerText.includes('Tổng sản phẩm') && [...document.querySelectorAll('.drill-crumbs button')].length===3`); await shot('03-drill-unit-product');
await evalJs(`window.history.back()`);
await waitFor(`document.body.innerText.includes('Tổng đơn vị') && [...document.querySelectorAll('.drill-crumbs button')].length===2`); await shot('04-browser-back-to-unit-list');
await evalJs(`document.querySelector('.drill-nav .reload')?.click()`);
await waitFor(`document.body.innerText.includes('Tổng đơn vị') && [...document.querySelectorAll('.drill-crumbs button')].length===2 && !document.querySelector('.drill-nav .reload')?.textContent.includes('Đang')`); await shot('05-reload-keeps-filter-drill');
const summary = await evalJs(`(() => ({
  crumbs:[...document.querySelectorAll('.drill-crumbs button')].map(b=>b.textContent.trim()),
  backDisabled:document.querySelector('.drill-nav button')?.disabled,
  reloadText:document.querySelector('.drill-nav .reload')?.textContent.trim(),
  totalLine:document.body.innerText.split(String.fromCharCode(10)).find(t=>t.includes('Tổng đơn vị')) || '',
  filterLine:document.body.innerText.split(String.fromCharCode(10)).find(t=>t.includes('Xoá lọc')) || '',
  body:document.body.innerText.slice(0,1600)
}))()`);
const summaryValue = summary.result?.value || { error: summary.exceptionDetails?.text || 'summary evaluate failed' };
fs.writeFileSync(`${outDir}/summary.json`, JSON.stringify(summaryValue, null, 2));
ws.close();
console.log(JSON.stringify({ outDir, page: page.url, summary: summaryValue }, null, 2));
