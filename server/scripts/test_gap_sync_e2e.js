'use strict';

// E2E khớp cho nút "Đồng bộ worklist thiếu % sang DataHub".
// - Mặc định: dựng MOCK receiver (mô phỏng đúng cửa nhận DataHub theo contract
//   HANDOFF_DATAHUB_COST_GAP_RECEIVER.md) rồi chạy sync() qua HTTP thật.
// - Khi DataHub lên endpoint thật: chạy với REAL_DATAHUB=1 (đọc DATA_HUB_BASE_URL
//   + DATA_HUB_ASSIGNMENT_KEY từ env) để đóng E2E hai đầu bằng cùng bộ assertion.
//
//   node scripts/test_gap_sync_e2e.js
//   REAL_DATAHUB=1 DATA_HUB_BASE_URL=https://datahub… DATA_HUB_ASSIGNMENT_KEY=… node scripts/test_gap_sync_e2e.js

const http = require('http');
const assert = require('assert');

const ENDPOINT_PATH = '/api/integrations/app-report/cost-gap-worklist';
const KEY = 'e2e-test-key';
// Cột chi phí/PII cấm tuyệt đối trong gói nhận (đối xứng với assert bên gửi).
const FORBIDDEN_KEY = /(^|_)(c3[2-9]|c4[0-7]|cost|margin|percent|phantram|payout|hoahong|thuong|luong|salary|bonus|price|gia|cccd|cmnd|phone|sdt|email|dob|birth|address|diachi)(_|$)/i;

function hasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_KEY.test(String(key).replace(/[^a-z0-9_]/gi, '')) || hasForbiddenKey(child));
}

// ─── MOCK receiver: bản mẫu tham chiếu cho DataHub (idempotent theo checksum) ───
function startMockReceiver() {
  const store = new Map(); // key: `${from}|${to}|${checksum}` → { id, received }
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
      const dedupeKey = `${body.from}|${body.to}|${body.worklist_checksum}`;
      const existing = store.get(dedupeKey);
      if (existing) return send(200, { ok: true, worklist_id: existing.id, received: existing.received, deduped: true });
      seq += 1;
      const record = { id: `wl_${seq}`, received: body.items.length, actor: body.headers, body };
      store.set(dedupeKey, record);
      server.__lastBody = body; // để test soi payload nhận được
      server.__lastActor = req.headers['x-app-report-actor'];
      return send(200, { ok: true, worklist_id: record.id, received: record.received, deduped: false });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Server 404-tất-cả để thử đường "DataHub chưa mở cửa nhận".
function start404Server() {
  const server = http.createServer((req, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no route"}'); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function samplePayload() {
  return {
    from: '2026-06',
    to: '2026-07',
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

async function main() {
  const real = process.env.REAL_DATAHUB === '1';
  const sync = require('../src/employeeCostGapSync');
  process.env.DATA_HUB_TIMEOUT_MS = process.env.DATA_HUB_TIMEOUT_MS || '4000';

  let mock = null; let server404 = null;
  if (real) {
    console.log('== E2E gap-sync: REAL DataHub ==');
    assert(sync.configured(), 'Thiếu DATA_HUB_BASE_URL / DATA_HUB_ASSIGNMENT_KEY cho REAL_DATAHUB=1');
  } else {
    console.log('== E2E gap-sync: MOCK receiver ==');
    mock = await startMockReceiver();
    server404 = await start404Server();
    process.env.DATA_HUB_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
    process.env.DATA_HUB_ASSIGNMENT_KEY = KEY;
  }
  const session = { emp_code: 'CEO', role: 'ceo', name: 'App Report CEO' };

  await check('1) sync gửi thành công + trả {ok, sent, checksum}', async () => {
    const out = await sync.sync(samplePayload(), session);
    assert.strictEqual(out.ok, true, 'ok phải true');
    assert.strictEqual(out.sent, 2, `sent phải =2, nhận ${out.sent}`);
    assert.strictEqual(out.from, '2026-06'); assert.strictEqual(out.to, '2026-07');
    assert(out.checksum && out.checksum.length === 64, 'checksum sha256 64 hex');
    assert(out.datahub && out.datahub.worklist_id, 'DataHub trả worklist_id');
  });

  if (!real) {
    await check('2) receiver nhận đúng field whitelist, KHÔNG cột cấm', async () => {
      const body = mock.__lastBody;
      assert(body, 'receiver phải nhận body');
      assert(!hasForbiddenKey(body), 'body không được chứa cột cấm');
      const keys = Object.keys(body.items[0]).sort().join(',');
      assert.strictEqual(keys, 'doanh_thu_anh_huong,don_vi_anh_huong,ly_do,ma_catalog_goi_y,ma_qlnb,so_don_vi,so_nv,ten_hang', `item keys sai: ${keys}`);
      assert.deepStrictEqual(body.coverage, { matched_pairs: 171, total_pairs: 184 }, 'coverage sai');
    });
    await check('3) header actor đi kèm (x-app-report-actor)', async () => {
      assert.strictEqual(mock.__lastActor, 'CEO', `actor sai: ${mock.__lastActor}`);
    });
  }

  await check('4) idempotent: gửi lại cùng kỳ+checksum → dedupe, không nhân đôi', async () => {
    const first = await sync.sync(samplePayload(), session);
    const second = await sync.sync(samplePayload(), session);
    assert.strictEqual(first.checksum, second.checksum, 'checksum phải trùng');
    if (!real) assert.strictEqual(second.datahub.deduped, true, 'lần 2 phải deduped=true');
    if (!real) assert.strictEqual(first.datahub.worklist_id, second.datahub.worklist_id, 'worklist_id phải giữ nguyên');
  });

  await check('5) sai x-assignment-key → bị từ chối (không ghi)', async () => {
    const saved = process.env.DATA_HUB_ASSIGNMENT_KEY;
    process.env.DATA_HUB_ASSIGNMENT_KEY = real ? `${saved}-wrong` : 'wrong-key';
    try {
      await sync.sync(samplePayload(), session);
      throw new Error('đáng lẽ phải bị từ chối');
    } catch (error) {
      assert(error.status === 401 || error.status === 403, `mong 401/403, nhận ${error.status}`);
    } finally { process.env.DATA_HUB_ASSIGNMENT_KEY = saved; }
  });

  await check('6) chèn cột cấm (c47) → assert fail-closed TRƯỚC khi gửi', async () => {
    try {
      sync.assertNoForbiddenKeys({ items: [{ ma_qlnb: 'X', c47: 1 }] });
      throw new Error('đáng lẽ chặn c47');
    } catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_FORBIDDEN_FIELD'); }
  });

  await check('7) items rỗng → GAP_SYNC_EMPTY, không gọi mạng', async () => {
    try { await sync.sync({ from: '2026-07', to: '2026-07', items: [] }, session); throw new Error('đáng lẽ chặn rỗng'); }
    catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_EMPTY'); }
  });

  if (!real) {
    await check('8) DataHub chưa mở cửa nhận (404) → dormant, không vỡ', async () => {
      const saved = process.env.DATA_HUB_BASE_URL;
      process.env.DATA_HUB_BASE_URL = `http://127.0.0.1:${server404.address().port}`;
      try { await sync.sync(samplePayload(), session); throw new Error('đáng lẽ dormant'); }
      catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_RECEIVER_ABSENT'); assert.strictEqual(error.status, 503); assert.strictEqual(error.dormant, true); }
      finally { process.env.DATA_HUB_BASE_URL = saved; }
    });
    await check('9) chưa cấu hình DataHub → GAP_SYNC_NOT_CONFIGURED dormant', async () => {
      const base = process.env.DATA_HUB_BASE_URL; const key = process.env.DATA_HUB_ASSIGNMENT_KEY;
      delete process.env.DATA_HUB_BASE_URL; delete process.env.DATA_HUB_ASSIGNMENT_KEY;
      try { await sync.sync(samplePayload(), session); throw new Error('đáng lẽ dormant'); }
      catch (error) { assert.strictEqual(error.code, 'GAP_SYNC_NOT_CONFIGURED'); assert.strictEqual(error.dormant, true); }
      finally { process.env.DATA_HUB_BASE_URL = base; process.env.DATA_HUB_ASSIGNMENT_KEY = key; }
    });
  }

  if (mock) mock.close();
  if (server404) server404.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` · ${failed.length} FAIL` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error('E2E lỗi không mong đợi:', error); process.exit(1); });
