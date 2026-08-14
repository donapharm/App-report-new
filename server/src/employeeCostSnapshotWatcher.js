'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CEO_TELEGRAM_ID = '1748199545';
const WATCH_PERIOD = '2026-08';
const EXPECTED_ROSTER_COUNT = 21;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(canonical(value), null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function safeCode(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32); }
function safeTimestamp(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) ? text : '';
}
function effectiveRange(result = {}) {
  const source = result.sourceRange || result.effectiveRange || {};
  return { from: String(source.from || result.effectiveFrom || ''), to: String(source.to || result.effectiveTo || '') };
}
function outcomeReason(result = {}) {
  const value = String(result.sourceOutcome || result.outcome || result.reason || '').toLowerCase();
  if (value.includes('stale')) return 'stale_rates';
  if (value.includes('409') || value.includes('rejected')) return 'upstream_rejected';
  if (value.includes('deadline') || value.includes('timeout')) return 'deadline';
  return 'upstream_unavailable';
}
function evaluateProbe({ period = WATCH_PERIOD, roster = [], results = [], dependencyStart, dependencyEnd }) {
  const codes = [...new Set(roster.map(safeCode).filter(Boolean))].sort();
  const byCode = new Map(results.map((entry) => [safeCode(entry.empCode), entry]));
  const unavailable = {};
  const observations = {};
  const generations = new Set();
  for (const code of codes) {
    const result = byCode.get(code) || {};
    const range = effectiveRange(result);
    const valid = result.ok !== false
      && String(result.sourceOutcome || result.outcome || 'ok').toLowerCase() === 'ok'
      && range.from === period && range.to === period
      && result.stale !== true;
    if (!valid) unavailable[code] = outcomeReason(result);
    observations[code] = {
      reason: valid ? 'ok' : unavailable[code],
      effectiveFrom: range.from,
      effectiveTo: range.to,
      sourceEffectiveAt: safeTimestamp(result.sourceEffectiveAt || result.effectiveAt || result.fetchedAt),
    };
    const generation = String(result.sourceGeneration || result.generation || '');
    if (valid && generation) generations.add(generation);
    if (valid && !generation) unavailable[code] = 'upstream_unavailable';
  }
  const dependencyStable = digest(dependencyStart || {}) === digest(dependencyEnd || {});
  const ready = codes.length === EXPECTED_ROSTER_COUNT
    && byCode.size === EXPECTED_ROSTER_COUNT
    && Object.keys(unavailable).length === 0
    && generations.size === 1
    && dependencyStable;
  return {
    ready, period, rosterCount: codes.length, availableCount: ready ? codes.length : codes.length - Object.keys(unavailable).length,
    unavailableEmployees: Object.keys(unavailable).sort(), unavailableReasons: unavailable,
    observations, sourceGeneration: generations.size === 1 ? [...generations][0] : '',
    dependencyDigest: digest(dependencyStart || {}), dependencyStable,
    sameGeneration: generations.size === 1,
  };
}

function viTimestamp(value) {
  const timestamp = safeTimestamp(value);
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(timestamp));
}
function notificationText(payload) {
  if (payload.event === 't07_source_ready') return 'T07 exact-range đã mở đủ 21/21 cùng generation — ưu tiên tạo seal/snapshot nguồn tươi (chưa tự chạy).';
  if (payload.state === 'ready') return `Snapshot T08 đã ghim đủ 21/21. generation=${payload.generationId}; digest=${payload.manifestDigest}`;
  const stale = payload.staleSources.map((item) => `${item.empCode}: bản tỷ lệ lưu ${viTimestamp(item.sourceEffectiveAt) || 'chưa có mốc nguồn'}`);
  const missing = payload.unavailableEmployees.filter((code) => !payload.staleSources.some((item) => item.empCode === code));
  return [`[BLOCKED — nguồn 3A3 thiếu ${payload.unavailableEmployees.length}/21]`, stale.length ? `Tỷ lệ cũ: ${stale.join('; ')}` : '', missing.length ? `Nguồn chưa hợp lệ: ${missing.join(', ')}` : ''].filter(Boolean).join('\n');
}
function createCeoOutbox({ root, enabled = false, recipient = CEO_TELEGRAM_ID, now = () => new Date() } = {}) {
  function enqueue(event) {
    if (!enabled) return { queued: false, reason: 'disabled' };
    if (String(recipient) !== CEO_TELEGRAM_ID) return { queued: false, reason: 'recipient_refused' };
    const probe = event.probe || {};
    const unavailableEmployees = (event.unavailableEmployees || probe.unavailableEmployees || []).map(safeCode).filter(Boolean).sort();
    const observations = probe.observations || event.observations || {};
    const staleSources = unavailableEmployees.filter((code) => probe.unavailableReasons?.[code] === 'stale_rates')
      .map((code) => ({
        empCode: code,
        effectiveFrom: String(observations[code]?.effectiveFrom || '').slice(0, 7),
        effectiveTo: String(observations[code]?.effectiveTo || '').slice(0, 7),
        sourceEffectiveAt: safeTimestamp(observations[code]?.sourceEffectiveAt),
      }));
    const payload = {
      schemaVersion: 1, recipient: CEO_TELEGRAM_ID, channel: 'telegram',
      createdAt: now().toISOString(), event: String(event.type || 'watcher_status').slice(0, 64),
      period: String(event.period || '').slice(0, 7), state: String(event.state || '').slice(0, 32),
      code: String(event.code || '').replace(/[^A-Z0-9_:-]/gi, '').slice(0, 80),
      generationId: String(event.generationId || '').replace(/[^a-f0-9]/g, '').slice(0, 64),
      manifestDigest: String(event.manifestDigest || '').replace(/[^a-f0-9]/g, '').slice(0, 64),
      unavailableEmployees, staleSources,
    };
    payload.text = notificationText(payload);
    const signature = digest({ ...payload, createdAt: undefined, text: undefined });
    const signatureFile = path.join(root, '.last-signatures.json');
    let signatures = {};
    try { signatures = JSON.parse(fs.readFileSync(signatureFile, 'utf8')); } catch { signatures = {}; }
    if (signatures[payload.event]?.signature === signature) return { queued: false, reason: 'duplicate' };
    const id = `${payload.createdAt.replace(/[^0-9]/g, '')}-${signature.slice(0, 16)}.json`;
    atomicJson(path.join(root, id), payload);
    signatures[payload.event] = { signature, queuedAt: payload.createdAt };
    atomicJson(signatureFile, signatures);
    return { queued: true, file: id };
  }
  return { enqueue };
}

function createSnapshotWatcher(options = {}) {
  const period = options.period || WATCH_PERIOD;
  const now = options.now || (() => new Date());
  const mode = options.mode === 'sync' ? 'sync' : 'probe';
  const statusFile = options.statusFile;
  const stateFile = options.stateFile;
  const rosterProvider = options.rosterProvider;
  const probeEmployee = options.probeEmployee;
  const dependencyIdentity = options.dependencyIdentity;
  const readActiveJobs = options.readActiveJobs || (() => []);
  const syncOnce = options.syncOnce;
  const readCurrent = options.readCurrent;
  const cleanupFailedTarget = options.cleanupFailedTarget || (() => {});
  const outbox = options.outbox || { enqueue: () => ({ queued: false }) };
  if (![rosterProvider, probeEmployee, dependencyIdentity].every((fn) => typeof fn === 'function')) throw new Error('watcher dependencies missing');

  function saveStatus(status) { if (statusFile) atomicJson(statusFile, status); return status; }
  function waiting(code, detail = {}) {
    const status = { schemaVersion: 1, at: now().toISOString(), period, state: 'waiting', code, serveChanged: false, ...detail };
    saveStatus(status); outbox.enqueue({ type: 'snapshot_waiting', ...status }); return status;
  }

  async function run() {
    const active = (await readActiveJobs()).map((item) => String(item).toLowerCase());
    const conflicts = active.filter((item) => /snapshot|cron|warm/.test(item));
    if (conflicts.length) return waiting('WATCHER_OVERLAP_REFUSED', { conflicts: [...new Set(conflicts)].sort() });
    const rosterRows = await rosterProvider(period);
    const roster = rosterRows.map((row) => safeCode(typeof row === 'string' ? row : row.emp_code || row.empCode)).filter(Boolean);
    const dependencyStart = await dependencyIdentity(period);
    const results = [];
    for (const empCode of roster) {
      try { results.push({ empCode, ...await probeEmployee(empCode, { period, probeOnly: true, roster: rosterRows }) }); }
      catch { results.push({ empCode, ok: false, sourceOutcome: 'upstream_unavailable' }); }
    }
    const dependencyEnd = await dependencyIdentity(period);
    const pinnedDependencyGeneration = digest(dependencyStart || {});
    const pinnedResults = results.map((result) => ({
      ...result, sourceGeneration: result.sourceGeneration || pinnedDependencyGeneration,
    }));
    const probe = evaluateProbe({ period, roster, results: pinnedResults, dependencyStart, dependencyEnd });
    if (!probe.ready) return waiting('WATCHER_SOURCE_NOT_READY', { probe });
    const successKey = digest({ period, sourceGeneration: probe.sourceGeneration, dependencyDigest: probe.dependencyDigest });
    let prior = {};
    try { prior = stateFile ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {}; } catch { prior = {}; }
    if (prior.successKey === successKey) return saveStatus({ schemaVersion: 1, at: now().toISOString(), period, state: 'ready', idempotent: true, successKey, serveChanged: false });
    if (mode !== 'sync') return waiting('WATCHER_PROBE_READY_GATE2_REQUIRED', { probe, successKey });
    if (typeof syncOnce !== 'function' || typeof readCurrent !== 'function') return waiting('WATCHER_SYNC_ADAPTER_MISSING', { probe });
    // Crash-safe idempotency: publication is the durable truth. If the process died
    // after atomic publish but before writing watcher state, do not sync this pinned
    // dependency generation a second time.
    try {
      const existing = await readCurrent(period, roster);
      const manifest = existing?.manifest || {};
      if (existing?.complete === true && manifest.roster?.length === EXPECTED_ROSTER_COUNT
        && manifest.dependencyIdentity === probe.dependencyDigest
        && manifest.watcherSuccessKey === successKey
        && /^[a-f0-9]{64}$/.test(String(manifest.generationId || ''))) {
        const recovered = {
          schemaVersion: 1, period, successKey, sourceGeneration: probe.sourceGeneration,
          generationId: manifest.generationId, manifestDigest: digest(manifest),
          completedAt: now().toISOString(), recoveredFromPublication: true,
        };
        if (stateFile) atomicJson(stateFile, recovered);
        return saveStatus({ ...recovered, state: 'ready', idempotent: true, serveChanged: false });
      }
    } catch { /* no valid current: continue to the single real sync */ }
    const publicationState = typeof options.capturePublicationState === 'function'
      ? await options.capturePublicationState(period) : null;
    let published = null;
    try {
      published = await syncOnce(period, {
        reason: 'watcher', requireComplete: true, expectedDependencies: dependencyStart,
        watcherSuccessKey: successKey, concurrency: 1,
      });
      const current = await readCurrent(period, roster);
      const manifest = current?.manifest || published?.manifest || {};
      const valid = current?.complete === true && manifest.roster?.length === EXPECTED_ROSTER_COUNT
        && manifest.dependencyIdentity === probe.dependencyDigest
        && manifest.watcherSuccessKey === successKey
        && /^[a-f0-9]{64}$/.test(String(manifest.generationId || ''))
        && /^[a-f0-9]{64}$/.test(String(manifest.model?.checksum || ''));
      if (!valid) throw Object.assign(new Error('post-publish verification failed'), { code: 'WATCHER_POST_PUBLISH_INVALID' });
      const state = { schemaVersion: 1, period, successKey, sourceGeneration: probe.sourceGeneration, generationId: manifest.generationId, manifestDigest: digest(manifest), completedAt: now().toISOString() };
      if (stateFile) atomicJson(stateFile, state);
      const status = saveStatus({ ...state, state: 'ready', idempotent: false, serveChanged: false });
      outbox.enqueue({ type: 'snapshot_ready', ...status });
      return status;
    } catch (error) {
      const failedGenerationId = String(published?.manifest?.generationId || '');
      if (/^[a-f0-9]{64}$/.test(failedGenerationId)) {
        await cleanupFailedTarget(period, publicationState, failedGenerationId);
      }
      return waiting('WATCHER_SYNC_FAILED', { errorCode: String(error?.code || 'WATCHER_SYNC_FAILED').replace(/[^A-Z0-9_:-]/gi, '').slice(0, 80), probe });
    }
  }
  return { run };
}

module.exports = { CEO_TELEGRAM_ID, WATCH_PERIOD, EXPECTED_ROSTER_COUNT, createSnapshotWatcher, createCeoOutbox, evaluateProbe, digest };
