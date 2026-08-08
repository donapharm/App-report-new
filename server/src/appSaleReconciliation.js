'use strict';

const CONTRACT = 'app-sale.app-report-reconciliation.v1';
const CONTRACT_PATH = '/api/integrations/app-report/reconciliation';
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_RETRIES = 1;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RANGE_DAYS = 366;

let lastProbe = null;

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function enabled() {
  return String(process.env.APP_SALE_RECON_ENABLED || '').trim() === '1';
}

function secret() {
  const value = String(process.env.APP_SALE_RECON_KEY || '').trim();
  if (!value) throw reconError('App Sale reconciliation key is not configured.', 'APP_SALE_RECON_CONFIG_MISSING', 503);
  if (value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw reconError('App Sale reconciliation key is invalid.', 'APP_SALE_RECON_CONFIG_INVALID', 503);
  }
  return value;
}

function endpoint() {
  const raw = String(process.env.APP_SALE_RECON_BASE_URL || '').trim();
  if (!raw) throw reconError('App Sale reconciliation base URL is not configured.', 'APP_SALE_RECON_CONFIG_MISSING', 503);
  let url;
  try { url = new URL(raw); }
  catch { throw reconError('App Sale reconciliation base URL is invalid.', 'APP_SALE_RECON_CONFIG_INVALID', 503); }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback)
    || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw reconError('App Sale reconciliation base URL is not an allowed service origin.', 'APP_SALE_RECON_CONFIG_INVALID', 503);
  }
  return new URL(CONTRACT_PATH, `${url.origin}/`);
}

function reconError(message, code = 'APP_SALE_RECON_UNAVAILABLE', status = 502, retryable = false) {
  return Object.assign(new Error(message), { code, status, retryable });
}

function safeError(error, key = '') {
  let message = String(error?.message || 'App Sale reconciliation is unavailable.');
  if (key) message = message.split(key).join('[redacted]');
  message = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  return reconError(message || 'App Sale reconciliation is unavailable.', error?.code, error?.status, error?.retryable);
}

function isoDate(value, field) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw reconError(`${field} must use YYYY-MM-DD.`, 'APP_SALE_RECON_RANGE_INVALID', 400);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw reconError(`${field} is not a valid date.`, 'APP_SALE_RECON_RANGE_INVALID', 400);
  }
  return { text, date };
}

function validateRange(fromInput, toInput) {
  const from = isoDate(fromInput, 'from');
  const to = isoDate(toInput, 'to');
  const days = Math.floor((to.date - from.date) / 86_400_000) + 1;
  if (days < 1 || days > MAX_RANGE_DAYS) {
    throw reconError(`Reconciliation range must contain 1-${MAX_RANGE_DAYS} days.`, 'APP_SALE_RECON_RANGE_INVALID', 400);
  }
  return { from: from.text, to: to.text };
}

function decimalVnd(value, field) {
  const text = String(value ?? '');
  if (!/^(0|[1-9]\d*)$/.test(text)) throw reconError(`${field} must be a non-negative integer VND string.`, 'APP_SALE_RECON_CONTRACT_INVALID');
  return text;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw reconError(`${field} must be a non-negative safe integer.`, 'APP_SALE_RECON_CONTRACT_INVALID');
  return value;
}

function cleanSource(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw reconError(`sources[${index}] must be an object.`, 'APP_SALE_RECON_CONTRACT_INVALID');
  const source = String(raw.source || '').trim();
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(source)) throw reconError(`sources[${index}].source is invalid.`, 'APP_SALE_RECON_CONTRACT_INVALID');
  return {
    source,
    revenueVnd: decimalVnd(raw.revenueVnd, `sources[${index}].revenueVnd`),
    rowCount: nonNegativeInteger(raw.rowCount, `sources[${index}].rowCount`),
    orderCount: nonNegativeInteger(raw.orderCount, `sources[${index}].orderCount`),
  };
}

function validatePayload(payload, expectedRange) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.contract !== CONTRACT) {
    throw reconError('App Sale reconciliation contract is invalid.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const range = payload.range;
  if (!range || range.from !== expectedRange.from || range.to !== expectedRange.to
    || range.timezone !== 'Asia/Ho_Chi_Minh' || range.filterSemantics !== 'APP_SALE_UI_DAY_FILTER') {
    throw reconError('App Sale reconciliation range/provenance does not match the request.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const snapshot = payload.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !/^[A-Za-z0-9._:-]{8,160}$/.test(String(snapshot.id || ''))
    || Number.isNaN(Date.parse(String(snapshot.generatedAt || '')))) {
    throw reconError('App Sale reconciliation snapshot provenance is invalid.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const summary = payload.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw reconError('App Sale reconciliation summary is invalid.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const sources = Array.isArray(payload.sources) && payload.sources.length >= 1 && payload.sources.length <= 16
    ? payload.sources.map(cleanSource) : null;
  if (!sources) throw reconError('App Sale reconciliation sources are invalid.', 'APP_SALE_RECON_CONTRACT_INVALID');
  if (new Set(sources.map((item) => item.source)).size !== sources.length) {
    throw reconError('App Sale reconciliation sources contain duplicates.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  const cleanSummary = {
    revenueVnd: decimalVnd(summary.revenueVnd, 'summary.revenueVnd'),
    rowCount: nonNegativeInteger(summary.rowCount, 'summary.rowCount'),
    orderCount: nonNegativeInteger(summary.orderCount, 'summary.orderCount'),
  };
  const revenueSum = sources.reduce((sum, item) => sum + BigInt(item.revenueVnd), 0n).toString();
  const rowSum = sources.reduce((sum, item) => sum + item.rowCount, 0);
  const orderSum = sources.reduce((sum, item) => sum + item.orderCount, 0);
  if (revenueSum !== cleanSummary.revenueVnd || rowSum !== cleanSummary.rowCount || orderSum !== cleanSummary.orderCount) {
    throw reconError('App Sale reconciliation summary does not equal its source partitions.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  return {
    contract: CONTRACT,
    range: { from: range.from, to: range.to, timezone: range.timezone, filterSemantics: range.filterSemantics },
    snapshot: { id: String(snapshot.id), generatedAt: new Date(snapshot.generatedAt).toISOString() },
    summary: cleanSummary,
    sources,
  };
}

async function readBoundedJson(response, controller) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    controller.abort();
    throw reconError('App Sale reconciliation response is too large.', 'APP_SALE_RECON_RESPONSE_TOO_LARGE');
  }
  if (!String(response.headers?.get?.('content-type') || '').toLowerCase().startsWith('application/json')) {
    throw reconError('App Sale reconciliation response is not JSON.', 'APP_SALE_RECON_CONTRACT_INVALID');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw reconError('App Sale reconciliation response stream is missing.', 'APP_SALE_RECON_CONTRACT_INVALID');
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

async function attempt(range, key, timeoutMs) {
  const url = endpoint();
  url.searchParams.set('from', range.from);
  url.searchParams.set('to', range.to);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json', authorization: `Bearer ${key}` },
      });
    } catch (cause) {
      if (controller.signal.aborted || cause?.name === 'AbortError') {
        throw reconError(`App Sale reconciliation timeout after ${timeoutMs}ms.`, 'APP_SALE_RECON_TIMEOUT', 504, true);
      }
      throw reconError('App Sale reconciliation transport is unavailable.', 'APP_SALE_RECON_TRANSPORT', 502, true);
    }
    if (response.status === 401 || response.status === 403) {
      throw reconError('App Sale rejected the reconciliation credential.', 'APP_SALE_RECON_AUTH_FAILED', 502, false);
    }
    if (response.status >= 300 && response.status < 400) {
      throw reconError(`App Sale reconciliation redirect HTTP ${response.status} is forbidden.`, 'APP_SALE_RECON_REDIRECT', 502, false);
    }
    if (!response.ok) {
      throw reconError(`App Sale reconciliation HTTP ${response.status}.`, 'APP_SALE_RECON_UPSTREAM_HTTP', 502, response.status === 429 || response.status >= 500);
    }
    return validatePayload(await readBoundedJson(response, controller), range);
  } catch (cause) {
    if (controller.signal.aborted && !String(cause?.code || '').startsWith('APP_SALE_RECON_')) {
      throw reconError(`App Sale reconciliation timeout after ${timeoutMs}ms.`, 'APP_SALE_RECON_TIMEOUT', 504, true);
    }
    throw cause;
  } finally { clearTimeout(timer); }
}

async function fetchReconciliation({ from, to } = {}) {
  if (!enabled()) throw reconError('App Sale reconciliation connector is disabled.', 'APP_SALE_RECON_DISABLED', 503);
  const range = validateRange(from, to);
  let key = '';
  try {
    key = secret();
    endpoint();
    const timeoutMs = boundedInteger(process.env.APP_SALE_RECON_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 50, 10_000);
    const retries = boundedInteger(process.env.APP_SALE_RECON_RETRIES, DEFAULT_RETRIES, 0, 2);
    let failure;
    for (let attemptNo = 0; attemptNo <= retries; attemptNo += 1) {
      try {
        const value = await attempt(range, key, timeoutMs);
        lastProbe = { status: 'ready', at: new Date().toISOString(), code: null };
        return value;
      } catch (cause) {
        failure = safeError(cause, key);
        if (!failure.retryable || attemptNo === retries) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(100 * (attemptNo + 1), 250)));
      }
    }
    throw failure;
  } catch (cause) {
    const failure = safeError(cause, key);
    lastProbe = { status: 'unavailable', at: new Date().toISOString(), code: failure.code || 'APP_SALE_RECON_UNAVAILABLE' };
    throw failure;
  }
}

function diagnostics() {
  if (!enabled()) return { enabled: false, status: 'disabled', lastProbe: null };
  let configStatus = 'configured_not_probed';
  try { endpoint(); secret(); }
  catch { configStatus = 'misconfigured'; }
  return {
    enabled: true,
    status: lastProbe?.status || configStatus,
    lastProbe: lastProbe ? { ...lastProbe } : null,
  };
}

function resetForTests() { lastProbe = null; }

module.exports = {
  CONTRACT,
  CONTRACT_PATH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRIES,
  MAX_RESPONSE_BYTES,
  MAX_RANGE_DAYS,
  enabled,
  validateRange,
  validatePayload,
  fetchReconciliation,
  diagnostics,
  resetForTests,
};
