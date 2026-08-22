'use strict';

/**
 * Đọc/JSON.parse/kiểm hợp đồng catalog LKG ở worker thread.
 *
 * File production hiện hơn 400 MB. Làm việc này trên main thread từng khiến
 * /api/health im lặng hàng chục giây và watchdog restart cả app. Một worker dùng
 * chung cho cả chùm kỳ để file lớn chỉ được parse một lần; snapshot từng kỳ được
 * gửi về main thread, còn bản monolith được worker tự thả theo TTL sẵn có.
 */
const path = require('path');
const { fork } = require('child_process');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');
const runtimeActivity = require('./runtimeActivity');

let worker = null;
let nextId = 1;
let idleTimer = null;
const pending = new Map();
const STAT_INTERVAL_MS = Math.max(0, Number(process.env.CATALOG_LKG_STAT_INTERVAL_MS || 10_000));
const values = new Map();
const reloads = new Map();
let readOverrideForTests = null;
let lastStatAt = 0;
let lastIdentity = null;
const DECODE_CHUNK_BYTES = Math.max(16 * 1024, Number(process.env.CATALOG_LKG_DECODE_CHUNK_BYTES || 64 * 1024));
const DECODE_TURN_BUDGET_MS = Math.max(5, Math.min(45, Number(process.env.CATALOG_LKG_DECODE_TURN_BUDGET_MS || 25)));

const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));

async function parseChunkedNdjson(decoded, format, { now = () => Date.now(), onTurn = null } = {}) {
  runtimeActivity.beginParentDecode(decoded.length);
  try {
    const decoder = new StringDecoder('utf8');
    let carry = '';
    let turnStarted = now();
    let maxTurnMs = 0;
    const array = [];
    let snapshot = null;

    const consume = (line) => {
    if (!line) return;
    const record = JSON.parse(line);
    if (format === 'array-ndjson-v1') array.push(record);
    else if (record.kind === 'header') snapshot = { ...record.value, rows: [], catalog: [], history: [] };
    else {
      if (!snapshot) throw new Error('Catalog LKG snapshot stream has no header');
      if (record.kind === 'row') snapshot.rows.push(record.value);
      else if (record.kind === 'catalog') snapshot.catalog.push(record.value);
      else if (record.kind === 'history') snapshot.history.push(record.value);
      else throw new Error(`Unknown Catalog LKG record kind: ${record.kind}`);
    }
    };

    for (let offset = 0; offset < decoded.length; offset += DECODE_CHUNK_BYTES) {
    runtimeActivity.parentDecoded(Math.min(decoded.length, offset + DECODE_CHUNK_BYTES));
    carry += decoder.write(decoded.subarray(offset, Math.min(decoded.length, offset + DECODE_CHUNK_BYTES)));
    let newline;
    while ((newline = carry.indexOf('\n')) !== -1) {
      consume(carry.slice(0, newline));
      carry = carry.slice(newline + 1);
      const elapsed = now() - turnStarted;
      if (elapsed >= DECODE_TURN_BUDGET_MS) {
        maxTurnMs = Math.max(maxTurnMs, elapsed);
        if (onTurn) onTurn(elapsed);
        await yieldTurn();
        turnStarted = now();
      }
    }
    }
    carry += decoder.end();
    consume(carry);
    const finalTurnMs = now() - turnStarted;
    maxTurnMs = Math.max(maxTurnMs, finalTurnMs);
    if (onTurn) onTurn(finalTurnMs);
    return { value: format === 'array-ndjson-v1' ? array : snapshot, maxTurnMs };
  } finally {
    runtimeActivity.endParentDecode();
  }
}

function fileIdentity() {
  const now = Date.now();
  if (now - lastStatAt < STAT_INTERVAL_MS) return lastIdentity;
  lastStatAt = now;
  try {
    const stat = require('fs').statSync(process.env.CATALOG_MANAGEMENT_CACHE_FILE
      || path.join(__dirname, '..', 'data', 'catalog_management_lkg.json'), { bigint: true });
    lastIdentity = stat.isFile()
      ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}` : null;
  } catch { lastIdentity = null; }
  return lastIdentity;
}

function armIdleStop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size || !worker) return;
    const old = worker;
    worker = null;
    old.kill('SIGTERM');
  }, 20_000);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

function rejectAll(error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function rejectWorker(spawned, error) {
  for (const [id, entry] of pending.entries()) {
    if (entry.worker !== spawned) continue;
    pending.delete(id);
    entry.reject(error);
  }
}

function getWorker() {
  if (worker && worker.connected && !worker.killed) return worker;
  worker = null;
  const spawned = fork(path.join(__dirname, 'catalogLkgReaderWorker.js'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
    env: { ...process.env, CATALOG_LKG_READER_WORKER: '1' },
  });
  worker = spawned;
  spawned.on('message', ({ id, encoded, format, error }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) {
      entry.reject(Object.assign(new Error(error.message), { code: error.code }));
      armIdleStop();
      return;
    }
    zlib.gunzip(Buffer.from(encoded), async (zipError, decoded) => {
      if (zipError) entry.reject(zipError);
      else {
        try {
          if (format === 'array-ndjson-v1' || format === 'snapshot-ndjson-v1') {
            entry.resolve((await parseChunkedNdjson(decoded, format)).value);
          } else entry.resolve(JSON.parse(decoded.toString('utf8')));
        }
        catch (parseError) { entry.reject(parseError); }
      }
      armIdleStop();
    });
  });
  spawned.on('error', (error) => {
    rejectWorker(spawned, error);
    if (worker === spawned) worker = null;
  });
  spawned.on('exit', (code) => {
    if (worker === spawned) worker = null;
    rejectWorker(spawned, new Error(`Catalog LKG worker exited ${code}`));
  });
  spawned.unref();
  return spawned;
}

function readFromWorker(period, projection = 'snapshot') {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    pending.set(id, { resolve, reject, worker: activeWorker });
    try {
      activeWorker.send({ id, period, projection }, (error) => {
        if (!error) return;
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        if (worker === activeWorker) worker = null;
        entry.reject(error);
      });
    } catch (error) {
      pending.delete(id);
      if (worker === activeWorker) worker = null;
      reject(error);
    }
  });
}

function markReloading(value, identity) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return value;
  return { ...value, meta: { ...value.meta, stale: true, catalogReloading: true,
    catalogFileIdentity: identity, message: 'Danh mục trên đĩa đã đổi; đang dựng bản mới ở tiến trình phụ và tạm phục vụ bản cũ.' } };
}

/**
 * Parent keeps the extracted period projection without a clock expiry. Every
 * ten seconds it performs one cheap stat. An unchanged inode/size/mtime never
 * starts the worker. A changed file starts one background rebuild while the
 * last verified projection remains immediately available.
 */
async function read(period, projection = 'snapshot') {
  const key = `${projection}|${period || ''}`;
  const identity = fileIdentity();
  const cached = values.get(key);
  if (cached && cached.identity === identity) return cached.value;
  if (!reloads.has(key)) {
    const task = (readOverrideForTests || readFromWorker)(period, projection)
      .then((value) => { values.set(key, { identity: fileIdentity(), value }); return value; })
      .finally(() => reloads.delete(key));
    reloads.set(key, task);
  }
  if (cached) return markReloading(cached.value, identity);
  return reloads.get(key);
}

module.exports = {
  read,
  _parseChunkedNdjsonForTests: parseChunkedNdjson,
  _setReadOverrideForTests: (value) => { readOverrideForTests = value; },
  _resetForTests: () => { values.clear(); reloads.clear(); lastStatAt = 0; lastIdentity = null; readOverrideForTests = null; },
};
