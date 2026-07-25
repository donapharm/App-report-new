'use strict';

// E2E khớp cho nút "Đồng bộ worklist thiếu % sang DataHub".
// - Mặc định (MOCK): dựng receiver mô phỏng đúng cửa nhận DataHub (contract
//   HANDOFF_DATAHUB_COST_GAP_RECEIVER.md) + test module + test ROUTE thật (403/gate).
// - REAL_DATAHUB=1: chạy AN TOÀN với endpoint thật — chỉ kiểm cấu hình + dựng gói
//   khô (KHÔNG POST, KHÔNG gửi sai key). Muốn thật sự gửi 1 gói test-marked thì
//   đặt thêm REAL_DATAHUB_ALLOW_WRITE=1 (dùng có chủ đích, gói đánh dấu E2E).
//
//   node scripts/test_gap_sync_e2e.js
//   REAL_DATAHUB=1 DATA_HUB_BASE_URL=… DATA_HUB_ASSIGNMENT_KEY=… node scripts/test_gap_sync_e2e.js

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { spawn } = require('child_process');

const ENDPOINT_PATH = '/api/integrations/app-report/cost-gap-worklist';
const KEY = 'e2e-test-key';
const FORBIDDEN_KEY = /(^|_)(c3[2-9]|c4[0-7]|cost|margin|percent|phantram|payout|hoahong|thuong|luong|salary|bonus|price|gia|cccd|cmnd|phone|sdt|email|dob|birth|address|diachi)(_|$)/i;

function hasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_KEY.test(String(key).replace(/[^a-z0-9_]/gi, '')) || hasForbiddenKey(child));
}

// ─── MOCK receiver: bản mẫu tham chiếu cho DataHub (idempotent theo checksum) ───
function startMockReceiver() {
  const store = new Map();
  let seq = 0;
  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || req.url !== ENDPOINT_PATH) return send(404, { error: 'not found' });
    if (req.headers['x-assignment-key'] !== KEY) return send(401, { error: 'sai x-assignment-key' });
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(400, { error: 'json không hợp lệ' }); }
      if (hasForbiddenKey(body)) return send(422, { error: 'gói chứa cột cấm (cost/%/C32-C47/PII)' });
      if (!Array.isArray(body.items) || !body.items.length) return send(400, { error: 'items rỗng' });
      server.__lastBody = body;
      server.__lastActor = req.headers['x-app-report-actor'];
      if (server.__emptyOnce) { server.__emptyOnce = false; return send(200, {}); } // test blocker 3
      const dedupeKey = `${body.from}|${body.to}|${body.worklist_checksum}`;
      const existing = store.get(dedupeKey);
      if (existing) return send(200, { ok: true, worklist_id: existing.id, received: existing.received, deduped: true });
      seq += 1;
      const record = { id: `wl_${seq}`, received: body.items.length };
      store.set(dedupeKey, record);
      return send(200, { ok: true, worklist_id: record.id, received: record.received, deduped: false });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function start404Server() {
  const server = http.createServer((req, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no route"}'); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function samplePayload() {
  return {
    from: '2026-06', to: '2026-07',
    coverage: { matchedPairs: 171, totalPairs: 184 },
    items: [
      { productCode: 'QĐ123.ABC', productName: 'Valgesic 500mg', unitLabels: ['Vũng Tàu', 'Đồng Nai'], unitCount: 2, employeeCount: 1, revenueAffected: 12345678, reason: 'qd_mismatch', suggestedCatalogCode: 'QĐ123.ABC.X' },
      { productCode: 'ZZZ001', productName: 'Hàng thiếu hẳn', unitLabels: ['HCM'], unitCount: 1, employeeCount: 1, revenueAffected: 5000, reason: 'missing', suggestedCatalogCode: null },
    ],
  };
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✅ ${name}`); }
  catch (error) { results.push({ name, ok: false, error }); console.log(`  ❌ ${name}\n       ${error.message}`); }
}
const CEO = { emp_code: 'CEO', role: 'ceo', name: 'App Report CEO' };

// ─────────────────────────── Test module (sync.*) ───────────────────────────
async function moduleTests(sync, mock, server404) {
  await check('1) sync gửi thành công + trả {ok, sent, checksum}', async () => {
    const out = await sync.sync(samplePayload(), CEO, { confirmed: true });
    assert.strictEqual(out.ok, true); assert.strictEqual(out.sent, 2);
    assert.strictEqual(out.from, '2026-06'); assert.strictEqual(out.to, '2026-07');
    assert(out.checksum && out.checksum.length === 64, 'checksum sha256 64 hex');
    assert(out.datahub && out.datahub.worklist_id, 'DataHub trả worklist_id');
  });
  await check('2) receiver nhận đúng field whitelist, KHÔNG cột cấm', async () => {
    const body = mock.__lastBody; assert(body);
    assert(!hasForbiddenKey(body), 'body không được chứa cột cấm');
    const keys = Object.keys(body.items[0]).sort().join(',');
    assert.strictEqual(keys, 'doanh_thu_anh_huong,don_vi_anh_huong,ly_do,ma_catalog_goi_y,ma_qlnb,so_don_vi,so_nv,ten_hang', `item keys sai: ${keys}`);
  });
  await check('3) header actor đi kèm (x-app-report-actor)', async () => {
    assert.strictEqual(mock.__lastActor, 'CEO', `actor sai: ${mock.__lastActor}`);
  });
  await check('4) idempotent: gửi lại cùng kỳ+checksum → dedupe', async () => {
    const first = await sync.sync(samplePayload(), CEO, { confirmed: true });
    const second = await sync.sync(samplePayload(), CEO, { confirmed: true });
    assert.strictEqual(first.checksum, second.checksum);
    assert.strictEqual(second.datahub.deduped, true);
    assert.strictEqual(first.datahub.worklist_id, second.datahub.worklist_id);
  });
  await check('4b) checksum CANONICAL: đảo thứ tự items → cùng checksum (blocker 4)', async () => {
    const a = sync.buildWorklist(samplePayload(), { actor: 'CEO' });
    const shuffled = samplePayload(); shuffled.items.reverse();
    shuffled.items[shuffled.items.findIndex((i) => i.productCode === 'QĐ123.ABC')].unitLabels = ['Đồng Nai', 'Vũng Tàu'];
    const b = sync.buildWorklist(shuffled, { actor: 'CEO' });
    assert.strictEqual(a.worklist_checksum, b.worklist_checksum, 'checksum phải độc lập thứ tự');
  });
  await check('5) DataHub 2xx nhưng {} → GAP_SYNC_BAD_RESPONSE (blocker 3)', async () => {
    mock.__emptyOnce = true;
    try { await sync.sync({ ...samplePayload(), from: '2026-05', to: '2026-05' }, CEO, { confirmed: true }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_BAD_RESPONSE'); }
  });
  await check('6) chèn cột cấm (c47) → assert fail-closed', async () => {
    try { sync.assertNoForbiddenKeys({ items: [{ ma_qlnb: 'X', c47: 1 }] }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_FORBIDDEN_FIELD'); }
  });
  await check('7) chưa Duyệt (confirmed=false) → GAP_SYNC_NOT_CONFIRMED (blocker 2)', async () => {
    try { await sync.sync(samplePayload(), CEO, { confirmed: false }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_NOT_CONFIRMED'); assert.strictEqual(error.status, 400); }
  });
  await check('8) items rỗng → GAP_SYNC_EMPTY', async () => {
    try { await sync.sync({ from: '2026-07', to: '2026-07', items: [] }, CEO, { confirmed: true }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_EMPTY'); }
  });
  await check('9) quá nhiều items → GAP_SYNC_TOO_MANY_ITEMS (blocker 6)', async () => {
    const big = { from: '2026-07', to: '2026-07', items: [] };
    for (let i = 0; i <= sync.MAX_ITEMS; i += 1) big.items.push({ productCode: `M${i}`, productName: 'x', unitLabels: ['U'], unitCount: 1, employeeCount: 1, revenueAffected: 1, reason: 'missing' });
    try { await sync.sync(big, CEO, { confirmed: true }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_TOO_MANY_ITEMS'); assert.strictEqual(error.status, 413); }
  });
  await check('10) 📝 recordNote: trống → NOTE_EMPTY, có nội dung → noted', async () => {
    try { sync.recordNote({ from: '2026-07', to: '2026-07', note: '  ' }, CEO); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_NOTE_EMPTY'); }
    const out = sync.recordNote({ from: '2026-07', to: '2026-07', note: 'rà mã QĐ trước' }, CEO);
    assert.strictEqual(out.noted, true);
  });
  await check('11) sai x-assignment-key → bị từ chối, không ghi', async () => {
    const saved = process.env.DATA_HUB_ASSIGNMENT_KEY; process.env.DATA_HUB_ASSIGNMENT_KEY = 'wrong-key';
    try { await sync.sync({ ...samplePayload(), from: '2026-04', to: '2026-04' }, CEO, { confirmed: true }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert(error.status === 401 || error.status === 403, `mong 401/403, nhận ${error.status}`); }
    finally { process.env.DATA_HUB_ASSIGNMENT_KEY = saved; }
  });
  await check('12) DataHub 404 (chưa mở cửa nhận) → dormant', async () => {
    const saved = process.env.DATA_HUB_BASE_URL; process.env.DATA_HUB_BASE_URL = `http://127.0.0.1:${server404.address().port}`;
    try { await sync.sync(samplePayload(), CEO, { confirmed: true }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_RECEIVER_ABSENT'); assert.strictEqual(error.dormant, true); }
    finally { process.env.DATA_HUB_BASE_URL = saved; }
  });
  await check('13) chưa cấu hình DataHub → dormant', async () => {
    const base = process.env.DATA_HUB_BASE_URL; const key = process.env.DATA_HUB_ASSIGNMENT_KEY;
    delete process.env.DATA_HUB_BASE_URL; delete process.env.DATA_HUB_ASSIGNMENT_KEY;
    try { await sync.sync(samplePayload(), CEO, { confirmed: true }); throw new Error('đáng lẽ chặn'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_NOT_CONFIGURED'); assert.strictEqual(error.dormant, true); }
    finally { process.env.DATA_HUB_BASE_URL = base; process.env.DATA_HUB_ASSIGNMENT_KEY = key; }
  });
}

// ─────────── Test ROUTE thật (403 NV, gate confirm, 📝) qua HTTP ───────────
function waitHealth(port, tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => { res.resume(); resolve(); });
      req.on('error', () => { if (n <= 0) return reject(new Error('server không lên')); setTimeout(() => tick(n - 1), 250); });
    };
    tick(tries);
  });
}
async function api(port, method, url, token, body) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function routeTests() {
  const port = 3900 + Math.floor((process.pid % 90));
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gapsync-e2e-'));
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), ALLOW_DEMO_LOGIN: '1', AUTH_DATA_DIR: authDir, DATA_HUB_BASE_URL: '', DATA_HUB_ASSIGNMENT_KEY: '' },
    stdio: 'ignore',
  });
  try {
    await waitHealth(port);
    const ceo = (await api(port, 'POST', '/api/auth/login', null, { emp_code: 'CEO' })).data.token;
    const dn = (await api(port, 'POST', '/api/auth/login', null, { emp_code: 'DN001' })).data.token;
    await check('R1) NV (DN001) POST sync → 403 (requireAdmin)', async () => {
      const r = await api(port, 'POST', '/api/employee-cost/gaps/sync-datahub?from=2026-07&to=2026-07', dn, { confirm: true });
      assert.strictEqual(r.status, 403, `nhận ${r.status}`);
    });
    await check('R2) CEO POST không confirm → 400 (gate xác nhận)', async () => {
      const r = await api(port, 'POST', '/api/employee-cost/gaps/sync-datahub?from=2026-07&to=2026-07', ceo, {});
      assert.strictEqual(r.status, 400, `nhận ${r.status}`);
    });
    await check('R3) CEO 📝 action=note → 200 noted (không gửi DataHub)', async () => {
      const r = await api(port, 'POST', '/api/employee-cost/gaps/sync-datahub?from=2026-07&to=2026-07', ceo, { action: 'note', note: 'rà mã trước' });
      assert.strictEqual(r.status, 200, `nhận ${r.status}`); assert.strictEqual(r.data.noted, true);
    });
    await check('R4) NV 📝 action=note → 403 (vẫn requireAdmin)', async () => {
      const r = await api(port, 'POST', '/api/employee-cost/gaps/sync-datahub?from=2026-07&to=2026-07', dn, { action: 'note', note: 'x' });
      assert.strictEqual(r.status, 403, `nhận ${r.status}`);
    });
  } finally {
    child.kill('SIGKILL');
    try { fs.rmSync(authDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ─────────────────────── REAL mode: an toàn (blocker 8) ───────────────────────
async function realTests(sync) {
  console.log('== E2E gap-sync: REAL DataHub (chế độ AN TOÀN) ==');
  await check('REAL-1) cấu hình đủ (base+key)', async () => { assert(sync.configured(), 'thiếu DATA_HUB_BASE_URL/DATA_HUB_ASSIGNMENT_KEY'); });
  await check('REAL-2) dựng gói khô hợp lệ, không cột cấm (KHÔNG POST)', async () => {
    const wl = sync.buildWorklist(samplePayload(), { actor: 'E2E-DRYRUN' });
    assert(wl.items.length === 2 && wl.worklist_checksum.length === 64);
    assert(!hasForbiddenKey(wl), 'gói không được chứa cột cấm');
  });
  if (process.env.REAL_DATAHUB_ALLOW_WRITE === '1') {
    await check('REAL-3) gửi 1 gói TEST-MARKED (có chủ đích) + idempotent', async () => {
      const marked = { from: '2000-01', to: '2000-01', coverage: {}, items: [{ productCode: 'E2E-TEST-DELETE-ME', productName: 'E2E marker — bỏ qua', unitLabels: ['E2E'], unitCount: 1, employeeCount: 0, revenueAffected: 0, reason: 'missing', suggestedCatalogCode: null }] };
      const a = await sync.sync(marked, { emp_code: 'E2E-DRYRUN', role: 'ceo' }, { confirmed: true });
      const b = await sync.sync(marked, { emp_code: 'E2E-DRYRUN', role: 'ceo' }, { confirmed: true });
      assert.strictEqual(a.checksum, b.checksum);
    });
  } else {
    console.log('  ⏭  REAL-3 gửi thật: BỎ QUA (đặt REAL_DATAHUB_ALLOW_WRITE=1 nếu muốn gửi gói test-marked). Không gửi sai key lên prod.');
  }
}

async function main() {
  const sync = require('../src/employeeCostGapSync');
  process.env.DATA_HUB_TIMEOUT_MS = process.env.DATA_HUB_TIMEOUT_MS || '4000';
  if (process.env.REAL_DATAHUB === '1') {
    await realTests(sync);
  } else {
    console.log('== E2E gap-sync: MOCK receiver + ROUTE ==');
    const mock = await startMockReceiver();
    const server404 = await start404Server();
    process.env.DATA_HUB_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
    process.env.DATA_HUB_ASSIGNMENT_KEY = KEY;
    await moduleTests(sync, mock, server404);
    mock.close(); server404.close();
    delete process.env.DATA_HUB_BASE_URL; delete process.env.DATA_HUB_ASSIGNMENT_KEY;
    await routeTests();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` · ${failed.length} FAIL` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error('E2E lỗi không mong đợi:', error); process.exit(1); });
