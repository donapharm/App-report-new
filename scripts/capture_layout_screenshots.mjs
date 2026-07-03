import fs from 'node:fs/promises';

const wsUrl = 'ws://127.0.0.1:18800/devtools/page/B907AA30E3A9959B743CBACC7E9B5AAC';
const outDir = new URL('../verification-screenshots/', import.meta.url);
await fs.mkdir(outDir, { recursive: true });

let id = 0;
const ws = new WebSocket(wsUrl);
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
function cdp(method, params = {}) {
  const cur = ++id;
  ws.send(JSON.stringify({ id: cur, method, params }));
  return new Promise((resolve, reject) => pending.set(cur, { resolve, reject }));
}
async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function evalJs(expression) {
  return cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result?.value);
}
async function setViewport(width, height, mobile = false) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await wait(300);
}
async function openTab(label) {
  await evalJs(`(()=>{const btn=[...document.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(label)})); if(!btn) return 'NO '+${JSON.stringify(label)}; btn.click(); return btn.innerText;})()`);
  await wait(1800);
}
async function shot(name, scrollY) {
  await evalJs(`window.scrollTo(0, ${scrollY});`);
  await wait(500);
  const data = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  const path = new URL(`${name}.png`, outDir);
  await fs.writeFile(path, Buffer.from(data.data, 'base64'));
  const check = await evalJs(`(()=>{const de=document.documentElement; const txt=document.body.innerText; const grids=[...document.querySelectorAll('.list-grid,.unit-rollup-grid,.alerts-grid')].map(g=>getComputedStyle(g).gridTemplateColumns.split(' ').length); return {overflow:de.scrollWidth>de.clientWidth+1, hasFull:txt.includes('2.668.987.096đ'), badMain:/\\n\\d+(,\\d+)? tỷ\\n/.test(txt), cols:grids.slice(0,8), tab:[...document.querySelectorAll('button.active')].map(b=>b.innerText).join('|')};})()`);
  return { path: path.pathname, ...check };
}
const tabs = [
  ['Tổng quan','overview',0],
  ['Doanh thu','revenue',520],
  ['DT đầy đủ','revenue-full',520],
  ['Sản phẩm','products',520],
  ['Phân tích','analysis',760],
  ['Cơ số thầu','cst',820],
  ['Target','target',360],
  ['Hỏi nhanh','ai',0],
  ['Upload','upload',0],
];
const results = [];
await cdp('Page.enable');
await cdp('Runtime.enable');
for (const mode of [{prefix:'pc', w:1440, h:1100, mobile:false}, {prefix:'mobile', w:390, h:844, mobile:true}]) {
  await setViewport(mode.w, mode.h, mode.mobile);
  for (const [label, slug, scroll] of tabs) {
    await openTab(label);
    // CST default opens unit rollup; click first unit on scrolled screenshot if not open enough.
    if (slug === 'cst') await evalJs(`document.querySelector('.unit-rollup-head')?.click();`), await wait(700);
    const y = mode.prefix === 'mobile' ? scroll : Math.max(0, scroll - 180);
    results.push({ mode: mode.prefix, label, ...(await shot(`${mode.prefix}-${slug}`, y)) });
  }
}
await fs.writeFile(new URL('manifest.json', outDir), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
ws.close();
