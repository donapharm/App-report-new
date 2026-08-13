'use strict';

const { safeReason } = require('./employeeCostSnapshotStore');

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function mapBounded(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor; cursor += 1;
      if (index >= items.length) return;
      try { results[index] = { ok: true, value: await worker(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, run));
  return results;
}

function sourceFailureReason(error, result) {
  const value = String(result?.reason || result?.sourceOutcome || error?.code || '').toLowerCase();
  if (value.includes('not_configured') || value.includes('not configured')) return 'not_configured';
  if (value.includes('deadline') || value.includes('timeout')) return 'deadline';
  if (value.includes('source_error')) return 'source_error';
  // DataHub understood the request but rejected it (for example HTTP 409).
  // Keep only a generic allowlisted code; never propagate response body/keys.
  if (value === 'upstream_rejected' || value === 'upstream_unauthorized' || /^upstream_4\d\d$/.test(value)) return 'upstream_rejected';
  return 'upstream_unavailable';
}

function usableResult(result) {
  if (!result || result.ok === false) return false;
  const outcome = String(result.sourceOutcome || result.report?.sourceOutcome || 'ok').toLowerCase();
  if (outcome.startsWith('upstream_')) return false;
  return !['not_configured', 'deadline', 'source_error', 'error', 'unavailable'].includes(outcome);
}

function createEmployeeCostSnapshotSync(options = {}) {
  const store = options.store;
  if (!store) throw new Error('employeeCostSnapshotSync requires store');
  const rosterProvider = options.rosterProvider;
  const fetchEmployee = options.fetchEmployee;
  const buildModel = options.buildModel;
  if (typeof rosterProvider !== 'function' || typeof fetchEmployee !== 'function' || typeof buildModel !== 'function') {
    throw new Error('employeeCostSnapshotSync requires rosterProvider/fetchEmployee/buildModel');
  }
  const dependencyIdentity = typeof options.dependencyIdentity === 'function' ? options.dependencyIdentity : async () => ({});
  const isLocked = typeof options.isLocked === 'function' ? options.isLocked : () => false;
  const now = options.now || (() => new Date());
  const concurrency = Math.max(1, Math.min(12, Number(options.concurrency || process.env.EMPLOYEE_COST_SNAPSHOT_CONCURRENCY || 4)));
  const inFlight = new Map();
  const lastRequestedAt = new Map();
  const requestMinIntervalMs = Math.max(0, Number(options.requestMinIntervalMs ?? 10_000));

  async function syncUnlocked(period, { onlyCodes = null, reason = 'manual' } = {}) {
    const rosterRows = await rosterProvider(period);
    const roster = store.normalizeRoster(rosterRows);
    if (!roster.length) throw Object.assign(new Error('Roster kỳ này đang rỗng.'), { code: 'EMPLOYEE_COST_SNAPSHOT_EMPTY_ROSTER' });
    const previousResult = store.tryReadCurrent(period, { roster });
    const missingSnapshot = previousResult.error?.cause?.code === 'ENOENT';
    if (!previousResult.ok && !missingSnapshot) {
      // A corrupt current pointer/generation is never a licence to rebuild from an
      // unverified partial state. Keep the last publication untouched and require
      // operator repair/rollback of the dedicated snapshot store.
      throw previousResult.error;
    }
    const previous = previousResult.ok ? previousResult.snapshot : null;
    if (previous?.manifest.locked && previous.manifest.complete) {
      store.writeStatus(period, { ...store.readStatus(period), state: 'locked', locked: true, complete: true, errorCode: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
      throw Object.assign(new Error('Kỳ đã khoá và snapshot đầy đủ, không được đồng bộ lại.'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
    }
    const startedAt = iso(now());
    const dependenciesBefore = await dependencyIdentity(period, { roster: rosterRows });
    store.writeStatus(period, {
      state: 'syncing', startedAt, rosterCount: roster.length,
      availableCount: previous?.employees.size || 0, complete: previous?.complete === true,
      generationId: previous?.manifest.generationId || '', fetchedAt: previous?.manifest.fetchedAt || '',
      unavailableReasons: previous?.unavailableReasons || {},
    });
    const selected = onlyCodes == null
      ? roster
      : [...new Set(onlyCodes.map((code) => store.normalizeEmployee(code)))].filter((code) => roster.includes(code));
    const results = await mapBounded(selected, concurrency, (empCode) => fetchEmployee(empCode, { period, roster: rosterRows, reason }));
    const records = new Map(previous?.employees || []);
    const unavailableReasons = {};
    let successful = 0;
    selected.forEach((empCode, index) => {
      const outcome = results[index];
      if (outcome?.ok && usableResult(outcome.value)) {
        const value = outcome.value;
        const candidate = {
          report: value.report ?? value,
          fetchedAt: iso(value.fetchedAt || now()),
          sourceRevision: String(value.sourceRevision || value.revision || ''),
        };
        const prior = records.get(empCode);
        if (prior && store.compareTuple(candidate, prior) < 0) unavailableReasons[empCode] = 'upstream_unavailable';
        else { records.set(empCode, candidate); successful += 1; }
      } else unavailableReasons[empCode] = safeReason(sourceFailureReason(outcome?.error, outcome?.value));
    });
    for (const empCode of roster) if (!records.has(empCode)) unavailableReasons[empCode] ||= 'missing';
    const periodLocked = isLocked(period) === true;
    // A closed period may be published exactly once only from a fresh, successful
    // full-roster run. LKG is still preserved for open periods, but stale employees
    // must never become an immutable financial close.
    if (periodLocked && (selected.length !== roster.length || successful !== roster.length || Object.keys(unavailableReasons).length)) {
      throw Object.assign(new Error('Kỳ đã khoá chỉ được publish khi đồng bộ tươi đủ toàn bộ roster.'), { code: 'EMPLOYEE_COST_SNAPSHOT_CLOSED_INCOMPLETE' });
    }
    const dependencies = await dependencyIdentity(period, { roster: rosterRows });
    if (store.canonicalJson(dependencies) !== store.canonicalJson(dependenciesBefore)) {
      throw Object.assign(new Error('Nguồn phụ thuộc đổi trong lúc đồng bộ; không publish generation trộn đời.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
    }
    let model;
    const rosterUnchanged = previous && previous.manifest.rosterIdentity === store.rosterIdentity(roster);
    if (successful === 0 && rosterUnchanged) model = previous.model;
    else model = await buildModel({
      period, roster: rosterRows,
      employees: new Map(roster.filter((code) => records.has(code)).map((code) => [code, records.get(code)])),
      unavailableReasons: { ...unavailableReasons }, dependencies, previousModel: previous?.model || null,
    });
    const dependenciesAfterBuild = await dependencyIdentity(period, { roster: rosterRows });
    if (store.canonicalJson(dependenciesAfterBuild) !== store.canonicalJson(dependenciesBefore)) {
      throw Object.assign(new Error('Nguồn phụ thuộc đổi trước publish; không publish generation trộn đời.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
    }
    const fetchedAt = iso(now());
    return store.publishGeneration(period, {
      roster, employees: records, model, dependencies, fetchedAt,
      unavailableReasons, periodLocked, locked: periodLocked,
    });
  }

  function dongBoKy(rawPeriod, syncOptions = {}) {
    const period = store.normalizePeriod(rawPeriod);
    const existing = inFlight.get(period);
    if (existing) return existing;
    const promise = store.withPeriodLock(period, () => syncUnlocked(period, syncOptions))
      .catch((error) => {
        const current = store.readStatus(period);
        if (error.code !== 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE') store.writeStatus(period, {
          ...current, state: 'failed', finishedAt: iso(now()), complete: false,
          errorCode: String(error.code || 'EMPLOYEE_COST_SNAPSHOT_SYNC_FAILED'),
        });
        throw error;
      })
      .finally(() => { if (inFlight.get(period) === promise) inFlight.delete(period); });
    inFlight.set(period, promise);
    return promise;
  }

  function requestSync(rawPeriod, syncOptions = {}) {
    const period = store.normalizePeriod(rawPeriod);
    const existing = inFlight.get(period);
    if (existing) return { accepted: true, singleFlight: true, period, status: store.readStatus(period) };
    const last = lastRequestedAt.get(period) || 0;
    if (Date.now() - last < requestMinIntervalMs) return { accepted: false, rateLimited: true, period, status: store.readStatus(period) };
    lastRequestedAt.set(period, Date.now());
    dongBoKy(period, syncOptions).catch((error) => {
      console.warn('[employee-cost-snapshot] sync failed', { period, code: error?.code || 'SYNC_FAILED' });
    });
    return { accepted: true, singleFlight: false, period, status: store.readStatus(period) };
  }

  function trangThaiDongBo(rawPeriod, roster = null) {
    const period = store.normalizePeriod(rawPeriod);
    const status = store.trangThaiDongBo(period, roster == null ? {} : { roster });
    return { ...status, syncing: inFlight.has(period) || status.state === 'syncing' };
  }

  return { dongBoKy, requestSync, trangThaiDongBo, inFlight, mapBounded };
}

module.exports = { createEmployeeCostSnapshotSync, mapBounded, usableResult, sourceFailureReason };
