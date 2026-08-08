'use strict';

const crypto = require('node:crypto');

const CONTRACT_PATH_PREFIX = '/api/reconciliation';
const AUTH_HEADER = 'x-datahub-key';
const DEFAULT_TIMEOUT_MS = 1500;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_OFFSET = 1_000_000;
const ROW_KEYS = Object.freeze([
  'ma_don_vi', 'ma_qlnb', 'ten_hang', 'dvt', 'so_luong', 'don_gia', 'thanh_tien',
]);
const TOP_LEVEL_KEYS = new Set([
  'ky', 'ma_nha_thau', 'ten_nha_thau', 'trang_thai', 'phien_ban', 'rows_checksum',
  'rows', 'offset', 'con_nua', 'tong_dong',
]);

function reconError(message, code, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function boundedTimeout(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 250 && number <= 10_000
    ? number
    : DEFAULT_TIMEOUT_MS;
}

function cleanKey() {
  const key = String(process.env.APP_SALE_RECON_KEY ?? '').trim();
  if (!key) throw reconError('App Sale reconciliation is disabled.', 'APP_SALE_RECON_DISABLED', 503);
  if (key.length > 4096 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw reconError('App Sale reconciliation configuration is invalid.', 'APP_SALE_RECON_CONFIG_INVALID', 503);
  }
  return key;
}

function baseUrl() {
  const raw = String(process.env.APP_SALE_RECON_BASE_URL ?? '').trim();
  if (!raw) throw reconError('App Sale reconciliation is disabled.', 'APP_SALE_RECON_DISABLED', 503);
  let url;
  try { url = new URL(raw); }
  catch { throw reconError('App Sale reconciliation configuration is invalid.', 'APP_SALE_RECON_CONFIG_INVALID', 503); }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && !loopback)
    || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw reconError('App Sale reconciliation configuration is invalid.', 'APP_SALE_RECON_CONFIG_INVALID', 503);
  }
  return url.origin;
}

function period(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw reconError('Invalid reconciliation period.', 'APP_SALE_RECON_INPUT_INVALID', 400);
  }
  return text;
}

function contractor(value) {
  const text = String(value ?? '').trim();
  // The live contract defines this only as one path-segment string. Preserve its
  // exact case and encode it below; reject controls/separators instead of silently
  // rewriting an upstream identifier.
  if (!text || text.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(text)) {
    throw reconError('Invalid reconciliation contractor.', 'APP_SALE_RECON_INPUT_INVALID', 400);
  }
  return text;
}

function positiveInteger(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) throw reconError(`Invalid ${field}.`, 'APP_SALE_RECON_INPUT_INVALID', 400);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw reconError(`Invalid ${field}.`, 'APP_SALE_RECON_INPUT_INVALID', 400);
  return number;
}

function offsetInteger(value = 0) {
  const text = String(value ?? '').trim();
  if (!/^(0|[1-9]\d*)$/.test(text)) throw reconError('Invalid offset.', 'APP_SALE_RECON_INPUT_INVALID', 400);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number > MAX_OFFSET) {
    throw reconError('Invalid offset.', 'APP_SALE_RECON_INPUT_INVALID', 400);
  }
  return number;
}

function buildRequest({ ky, maNhaThau, phienBan, offset = 0 } = {}) {
  const normalized = {
    ky: period(ky),
    maNhaThau: contractor(maNhaThau),
    phienBan: positiveInteger(phienBan, 'phien_ban', { optional: true }),
    offset: offsetInteger(offset),
  };
  const url = new URL(`${CONTRACT_PATH_PREFIX}/${encodeURIComponent(normalized.ky)}/${encodeURIComponent(normalized.maNhaThau)}`, `${baseUrl()}/`);
  if (normalized.phienBan !== null) url.searchParams.set('phien_ban', String(normalized.phienBan));
  url.searchParams.set('offset', String(normalized.offset));
  return { url, normalized };
}

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function requiredText(value, field, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw reconError(`Invalid App Sale reconciliation ${field}.`, 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  return value;
}

function nullableText(value, field, max = 500) {
  if (value === null) return null;
  return requiredText(value, field, max);
}

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw reconError(`Invalid App Sale reconciliation ${field}.`, 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  return value;
}

function normalizeRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).length !== ROW_KEYS.length
    || !ROW_KEYS.every((key) => Object.hasOwn(row, key))) {
    throw reconError(`Invalid App Sale reconciliation row ${index + 1}.`, 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  return {
    ma_don_vi: requiredText(row.ma_don_vi, `rows[${index}].ma_don_vi`, 120),
    ma_qlnb: requiredText(row.ma_qlnb, `rows[${index}].ma_qlnb`, 180),
    ten_hang: nullableText(row.ten_hang, `rows[${index}].ten_hang`, 500),
    dvt: nullableText(row.dvt, `rows[${index}].dvt`, 120),
    so_luong: finiteNumber(row.so_luong, `rows[${index}].so_luong`),
    don_gia: finiteNumber(row.don_gia, `rows[${index}].don_gia`),
    thanh_tien: finiteNumber(row.thanh_tien, `rows[${index}].thanh_tien`),
  };
}

function rowsChecksum(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function validatePayload(payload, expected) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !exactKeys(payload, TOP_LEVEL_KEYS)) {
    throw reconError('Invalid App Sale reconciliation response.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const version = positiveInteger(payload.phien_ban, 'response phien_ban');
  const rows = Array.isArray(payload.rows) ? payload.rows.map(normalizeRow) : null;
  if (!rows) throw reconError('Invalid App Sale reconciliation rows.', 'APP_SALE_RECON_CONTRACT_INVALID');
  const checksum = String(payload.rows_checksum ?? '');
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw reconError('Invalid App Sale reconciliation checksum.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  if (payload.ky !== expected.ky || payload.ma_nha_thau !== expected.maNhaThau
    || (expected.phienBan !== null && version !== expected.phienBan)) {
    throw reconError('App Sale reconciliation response does not match the request.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }

  const paginationKeys = ['offset', 'con_nua', 'tong_dong'];
  const paginationCount = paginationKeys.filter((key) => Object.hasOwn(payload, key)).length;
  if (paginationCount !== 0 && paginationCount !== paginationKeys.length) {
    throw reconError('Invalid App Sale reconciliation pagination.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  let pagination = {};
  if (paginationCount) {
    if (!Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset !== expected.offset
      || typeof payload.con_nua !== 'boolean'
      || !Number.isSafeInteger(payload.tong_dong) || payload.tong_dong < payload.offset + rows.length) {
      throw reconError('Invalid App Sale reconciliation pagination.', 'APP_SALE_RECON_CONTRACT_INVALID');
    }
    pagination = { offset: payload.offset, con_nua: payload.con_nua, tong_dong: payload.tong_dong };
  } else if (expected.offset !== 0 || rowsChecksum(rows) !== checksum) {
    throw reconError('App Sale reconciliation checksum cannot be verified.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }

  return {
    ky: payload.ky,
    ma_nha_thau: payload.ma_nha_thau,
    ten_nha_thau: nullableText(payload.ten_nha_thau, 'ten_nha_thau', 500),
    trang_thai: requiredText(payload.trang_thai, 'trang_thai', 120),
    phien_ban: version,
    rows_checksum: checksum,
    rows,
    ...pagination,
  };
}

async function readBoundedJson(response, controller) {
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw reconError('App Sale reconciliation returned an invalid response.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    controller.abort();
    throw reconError('App Sale reconciliation response is too large.', 'APP_SALE_RECON_RESPONSE_TOO_LARGE');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw reconError('App Sale reconciliation returned an invalid response.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        controller.abort();
        throw reconError('App Sale reconciliation response is too large.', 'APP_SALE_RECON_RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw reconError('App Sale reconciliation returned malformed JSON.', 'APP_SALE_RECON_CONTRACT_INVALID'); }
}

async function fetchReconciliation(input = {}) {
  let key = '';
  try {
    key = cleanKey();
    const { url, normalized } = buildRequest(input);
    const timeoutMs = boundedTimeout(process.env.APP_SALE_RECON_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'application/json', [AUTH_HEADER]: key },
        });
      } catch (cause) {
        if (controller.signal.aborted || cause?.name === 'AbortError') {
          throw reconError('App Sale reconciliation timed out.', 'APP_SALE_RECON_TIMEOUT', 504);
        }
        throw reconError('App Sale reconciliation is unavailable.', 'APP_SALE_RECON_TRANSPORT', 502);
      }
      if (response.status === 401 || response.status === 403) {
        throw reconError('App Sale reconciliation authentication failed.', 'APP_SALE_RECON_AUTH_FAILED', 502);
      }
      if (response.status === 404) {
        throw reconError('App Sale reconciliation was not found.', 'APP_SALE_RECON_NOT_FOUND', 404);
      }
      if (response.status >= 300 && response.status < 400) {
        throw reconError('App Sale reconciliation redirect is forbidden.', 'APP_SALE_RECON_REDIRECT', 502);
      }
      if (!response.ok) {
        throw reconError('App Sale reconciliation is unavailable.', 'APP_SALE_RECON_UPSTREAM', 502);
      }
      let payload;
      try { payload = await readBoundedJson(response, controller); }
      catch (cause) {
        if (controller.signal.aborted && cause?.code !== 'APP_SALE_RECON_RESPONSE_TOO_LARGE') {
          throw reconError('App Sale reconciliation timed out.', 'APP_SALE_RECON_TIMEOUT', 504);
        }
        throw cause;
      }
      return validatePayload(payload, normalized);
    } finally {
      clearTimeout(timer);
    }
  } catch (cause) {
    if (cause?.code && String(cause.code).startsWith('APP_SALE_RECON_')) throw cause;
    // Never relay fetch/parser messages: they can contain a URL, credential, or upstream body.
    throw reconError('App Sale reconciliation is unavailable.', 'APP_SALE_RECON_UNAVAILABLE', 502);
  } finally {
    key = '';
  }
}

module.exports = {
  CONTRACT_PATH_PREFIX,
  AUTH_HEADER,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_OFFSET,
  ROW_KEYS,
  buildRequest,
  rowsChecksum,
  validatePayload,
  fetchReconciliation,
};
