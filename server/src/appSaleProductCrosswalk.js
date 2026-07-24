'use strict';

const crypto = require('node:crypto');

/**
 * Read-only App Sale S2S client for the product/master UOM crosswalk.
 * This module intentionally has no database access and no disk fallback: an
 * unavailable or invalid provider disables only the UOM DQ rule for that
 * request instead of letting App Report guess.
 */

const CONTRACT_PATH = '/api/integrations/app-report/product-master-crosswalk';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_LKG_TTL_MS = 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

let memory = null;
let inflight = null;

function safeText(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function configuredEndpoint() {
  const raw = safeText(process.env.APP_SALE_PRODUCT_CROSSWALK_URL, 2000);
  if (!raw) throw new Error('Thiếu APP_SALE_PRODUCT_CROSSWALK_URL.');
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('APP_SALE_PRODUCT_CROSSWALK_URL không hợp lệ.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== CONTRACT_PATH || url.search || url.hash) {
    throw new Error(`APP_SALE_PRODUCT_CROSSWALK_URL phải trỏ đúng ${CONTRACT_PATH}.`);
  }
  return url.toString();
}

function configuredToken() {
  const raw = String(process.env.APP_SALE_PRODUCT_CROSSWALK_TOKEN ?? '');
  const token = raw.trim();
  if (!token) throw new Error('Thiếu APP_SALE_PRODUCT_CROSSWALK_TOKEN.');
  if (token.length > 4000 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error('APP_SALE_PRODUCT_CROSSWALK_TOKEN không hợp lệ.');
  }
  return token;
}

function normalizeRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Crosswalk dòng ${index + 1} không phải object.`);
  const requiredTextFields = ['sub_code', 'master_code', 'sub_uom', 'master_uom', 'relation'];
  if (!requiredTextFields.every((field) => typeof row[field] === 'string')) {
    throw new Error(`Crosswalk dòng ${index + 1} thiếu trường bắt buộc.`);
  }
  const subCode = safeText(row.sub_code, 180).toUpperCase();
  const masterCode = safeText(row.master_code, 180).toUpperCase();
  const subUom = safeText(row.sub_uom, 100);
  const masterUom = safeText(row.master_uom, 100);
  const relation = safeText(row.relation, 80).toLowerCase();
  const rawFactor = row.convert_factor;
  const convertFactor = Number(rawFactor);
  if (!subCode || !masterCode || !subUom || !masterUom || !relation) {
    throw new Error(`Crosswalk dòng ${index + 1} thiếu trường bắt buộc.`);
  }
  if (rawFactor == null || rawFactor === '' || !['number', 'string'].includes(typeof rawFactor) || !Number.isFinite(convertFactor)) {
    throw new Error(`Crosswalk dòng ${index + 1} có convert_factor không hợp lệ.`);
  }
  return {
    sub_code: subCode,
    master_code: masterCode,
    sub_uom: subUom,
    master_uom: masterUom,
    relation,
    convert_factor: convertFactor,
  };
}

function snapshotSha256ForRows(rows = []) {
  const canonicalRows = [...rows]
    .sort((left, right) => (left.sub_code < right.sub_code ? -1 : (left.sub_code > right.sub_code ? 1 : 0)))
    .map((row) => ({
      sub_code: row.sub_code,
      master_code: row.master_code,
      sub_uom: row.sub_uom,
      master_uom: row.master_uom,
      relation: row.relation,
      convert_factor: row.convert_factor,
    }));
  return crypto.createHash('sha256').update(JSON.stringify(canonicalRows), 'utf8').digest('hex');
}

function validateSnapshot(payload) {
  const snapshot = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : payload;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.rows)) {
    throw new Error('Crosswalk không có snapshot rows hợp lệ.');
  }
  if (!snapshot.rows.length) throw new Error('Crosswalk snapshot rỗng.');
  const versionNo = Number(snapshot.version_no);
  if (!Number.isSafeInteger(versionNo) || versionNo <= 0) throw new Error('Crosswalk thiếu version_no hợp lệ.');
  const signature = safeText(snapshot.snapshot_sha256, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error('Crosswalk thiếu snapshot_sha256 hợp lệ.');
  if (snapshot.total != null && (!Number.isSafeInteger(Number(snapshot.total)) || Number(snapshot.total) !== snapshot.rows.length)) {
    throw new Error('Crosswalk total không khớp số dòng.');
  }
  const rows = snapshot.rows.map(normalizeRow);
  const bySubCode = new Map();
  for (const row of rows) {
    if (bySubCode.has(row.sub_code)) throw new Error(`Crosswalk có sub_code trùng/xung đột: ${row.sub_code}.`);
    bySubCode.set(row.sub_code, row);
  }
  for (const row of rows.filter((item) => item.relation === 'phu_convert')) {
    const master = bySubCode.get(row.master_code);
    if (row.sub_code === row.master_code || !master || master.sub_code !== master.master_code || master.relation !== 'goc'
      || master.sub_uom.toUpperCase() !== row.master_uom.toUpperCase()) {
      throw new Error(`Crosswalk ${row.sub_code} thiếu mã gốc/ĐVT gốc hợp lệ.`);
    }
  }
  const computedSignature = snapshotSha256ForRows(rows);
  if (computedSignature !== signature) throw new Error('Crosswalk snapshot_sha256 không khớp canonical rows.');
  return {
    status: 'ready',
    source: 'app_sale_s2s',
    endpoint: CONTRACT_PATH,
    snapshotAt: safeText(snapshot.snapshot_at || snapshot.generated_at || snapshot.updated_at, 80) || null,
    version: String(versionNo),
    signature,
    rowCount: rows.length,
    rows,
    message: null,
  };
}

function unavailable(cause) {
  return {
    status: 'source_unavailable',
    source: 'app_sale_s2s',
    endpoint: CONTRACT_PATH,
    snapshotAt: null,
    version: null,
    signature: null,
    rowCount: 0,
    rows: [],
    message: `Không thể kiểm tra quy đổi ĐVT từ App Sale: ${safeText(cause?.message || cause, 300) || 'nguồn không sẵn sàng'}`,
  };
}

async function remoteSnapshot() {
  const endpoint = configuredEndpoint();
  const token = configuredToken();
  const timeoutMs = boundedNumber(process.env.APP_SALE_PRODUCT_CROSSWALK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 250, 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status >= 300 && response.status < 400) throw new Error(`App Sale từ chối redirect HTTP ${response.status}.`);
    if (!response.ok) throw new Error(`App Sale crosswalk HTTP ${response.status}.`);
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error('App Sale crosswalk vượt giới hạn kích thước.');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('App Sale crosswalk vượt giới hạn kích thước.');
    let body;
    try { body = JSON.parse(text); }
    catch { throw new Error('App Sale crosswalk trả JSON không hợp lệ.'); }
    return validateSnapshot(body);
  } catch (cause) {
    if (cause?.name === 'AbortError') throw new Error(`App Sale crosswalk timeout sau ${timeoutMs}ms.`);
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

async function getSnapshot({ force = false } = {}) {
  const ttlMs = boundedNumber(process.env.APP_SALE_PRODUCT_CROSSWALK_TTL_MS, DEFAULT_TTL_MS, 1000, 24 * 60 * 60 * 1000);
  const lkgTtlMs = boundedNumber(process.env.APP_SALE_PRODUCT_CROSSWALK_LKG_TTL_MS, DEFAULT_LKG_TTL_MS, ttlMs, 24 * 60 * 60 * 1000);
  if (!force && memory && Date.now() - memory.at < ttlMs) return memory.value;
  if (!force && inflight) return inflight;
  const load = (async () => {
    let value;
    try { value = await remoteSnapshot(); }
    catch (cause) { value = unavailable(cause); }
    if (value.status === 'ready') {
      memory = { at: Date.now(), value };
      return value;
    }
    // A previously validated RAM-only snapshot may serve as bounded LKG.
    // Once that short window expires, the UOM rule becomes source_unavailable.
    if (memory && Date.now() - memory.at < lkgTtlMs) {
      return {
        ...memory.value,
        cache: 'lkg',
        message: 'Đang dùng snapshot quy đổi ĐVT gần nhất đã kiểm chứng do App Sale tạm thời không sẵn sàng.',
      };
    }
    return value;
  })();
  if (!force) inflight = load;
  try { return await load; }
  finally { if (inflight === load) inflight = null; }
}

function publicSource(snapshot = {}) {
  return {
    status: snapshot.status === 'ready' ? 'ready' : 'source_unavailable',
    source: safeText(snapshot.source, 80) || 'app_sale_s2s',
    endpoint: CONTRACT_PATH,
    snapshotAt: snapshot.snapshotAt || null,
    version: safeText(snapshot.version, 160) || null,
    signature: /^[a-f0-9]{64}$/i.test(safeText(snapshot.signature, 80)) ? safeText(snapshot.signature, 80).toLowerCase() : null,
    rowCount: Number.isFinite(Number(snapshot.rowCount)) ? Number(snapshot.rowCount) : 0,
    cache: snapshot.cache === 'lkg' ? 'lkg' : 'fresh',
    message: safeText(snapshot.message, 400) || null,
  };
}

function resetForTests() {
  memory = null;
  inflight = null;
}

module.exports = {
  CONTRACT_PATH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TTL_MS,
  DEFAULT_LKG_TTL_MS,
  snapshotSha256ForRows,
  validateSnapshot,
  getSnapshot,
  publicSource,
  resetForTests,
};
