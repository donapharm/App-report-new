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
  if (value.includes('stale_rates')) return 'stale_rates';
  if (value.includes('not_configured') || value.includes('not configured')) return 'not_configured';
  if (value.includes('deadline') || value.includes('timeout')) return 'deadline';
  if (value.includes('source_error')) return 'source_error';
  if (value === 'upstream_busy') return 'upstream_busy';
  // DataHub understood the request but rejected it (for example HTTP 409).
  // Keep only a generic allowlisted code; never propagate response body/keys.
  if (value === 'upstream_rejected' || value === 'upstream_unauthorized' || /^upstream_4\d\d$/.test(value)) return 'upstream_rejected';
  return 'upstream_unavailable';
}

function usableResult(result) {
  if (!result || result.ok === false) return false;
  const outcome = String(result.sourceOutcome || result.report?.sourceOutcome || 'ok').toLowerCase();
  if (outcome.startsWith('upstream_')) return false;
  return !['ok_stale_rates', 'not_configured', 'deadline', 'source_error', 'error', 'unavailable'].includes(outcome);
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
  const lockedSnapshotProvider = typeof options.lockedSnapshotProvider === 'function' ? options.lockedSnapshotProvider : null;
  const validateClosedRepair = typeof options.validateClosedRepair === 'function' ? options.validateClosedRepair : async () => true;
  const auditClosedRepair = typeof options.auditClosedRepair === 'function' ? options.auditClosedRepair : () => {};
  const now = options.now || (() => new Date());
  const concurrency = Math.max(1, Math.min(12, Number(options.concurrency || process.env.EMPLOYEE_COST_SNAPSHOT_CONCURRENCY || 4)));
  const inFlight = new Map();
  const lastRequestedAt = new Map();
  const requestMinIntervalMs = Math.max(0, Number(options.requestMinIntervalMs ?? 10_000));

  function lockedError(code, message) {
    return Object.assign(new Error(message), { code, snapshotReason: 'locked' });
  }

  function assertReadablePrevious(period, roster = null) {
    const previousResult = store.tryReadCurrent(period, roster == null ? {} : { roster });
    const missingSnapshot = previousResult.error?.cause?.code === 'ENOENT';
    if (!previousResult.ok && !missingSnapshot) throw previousResult.error;
    const previous = previousResult.ok ? previousResult.snapshot : null;
    if (previous?.manifest.locked && previous.manifest.complete) {
      store.writeStatus(period, { ...store.readStatus(period), state: 'locked', locked: true, complete: true, errorCode: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
      throw Object.assign(new Error('Kỳ đã khoá và snapshot đầy đủ, không được đồng bộ lại.'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
    }
    return previous;
  }

  async function syncLockedPeriod(period, { reason = 'manual' } = {}) {
    assertReadablePrevious(period);
    const startedAt = iso(now());
    store.writeStatus(period, {
      state: 'syncing', startedAt, locked: true, complete: false,
      unavailableReasons: { SNAPSHOT: 'locked' },
    });
    if (!lockedSnapshotProvider) {
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_MISSING', 'Kỳ đã khoá nhưng chưa có dấu đóng hợp lệ.');
    }
    let sealed;
    try { sealed = await lockedSnapshotProvider(period, { reason }); }
    catch (error) {
      if (error?.code === 'EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_MISSING'
        || error?.code === 'EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_INVALID') throw error;
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_INVALID', 'Không xác thực được dấu đóng của kỳ đã khoá.');
    }
    if (!sealed) throw lockedError('EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_MISSING', 'Kỳ đã khoá nhưng chưa có dấu đóng hợp lệ.');
    if (isLocked(period) !== true) {
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT', 'Trạng thái khoá kỳ đổi trong lúc đọc dấu.');
    }
    const roster = store.normalizeRoster(sealed.roster || sealed.model?.employees);
    if (!roster.length || !sealed.model || !/^[a-f0-9]{64}$/.test(String(sealed.sealIdentity || ''))) {
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_INVALID', 'Dấu đóng thiếu roster/model/căn cước hợp lệ.');
    }
    return store.publishGeneration(period, {
      source: 'seal', sealIdentity: sealed.sealIdentity,
      roster, employees: new Map(), model: sealed.model,
      dependencies: sealed.dependencies || {}, fetchedAt: iso(sealed.fetchedAt || now()),
      unavailableReasons: {}, periodLocked: true, locked: true,
    });
  }

  async function syncUnlocked(period, {
    onlyCodes = null,
    reason = 'manual',
    requireComplete = false,
    expectedDependencies = null,
    watcherSuccessKey = '',
    sourceGeneration = '',
    concurrency: requestedConcurrency = concurrency,
  } = {}) {
    if (isLocked(period) === true) return syncLockedPeriod(period, { reason });
    const rosterRows = await rosterProvider(period);
    if (isLocked(period) === true) return syncLockedPeriod(period, { reason });
    const roster = store.normalizeRoster(rosterRows);
    if (!roster.length) throw Object.assign(new Error('Roster kỳ này đang rỗng.'), { code: 'EMPLOYEE_COST_SNAPSHOT_EMPTY_ROSTER' });
    // A corrupt current pointer/generation is never a licence to rebuild from an
    // unverified partial state. Keep the last publication untouched and require
    // operator repair/rollback of the dedicated snapshot store.
    const previous = assertReadablePrevious(period, roster);
    const startedAt = iso(now());
    const dependenciesBefore = await dependencyIdentity(period, { roster: rosterRows });
    if (expectedDependencies != null
      && store.canonicalJson(dependenciesBefore) !== store.canonicalJson(expectedDependencies)) {
      throw Object.assign(new Error('Generation nguồn đã đổi sau probe; không bắt đầu đồng bộ.'), {
        code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT',
      });
    }
    store.writeStatus(period, {
      state: 'syncing', startedAt, rosterCount: roster.length,
      availableCount: previous?.employees.size || 0, complete: previous?.complete === true,
      generationId: previous?.manifest.generationId || '', fetchedAt: previous?.manifest.fetchedAt || '',
      unavailableReasons: previous?.unavailableReasons || {},
    });
    const selected = onlyCodes == null
      ? roster
      : [...new Set(onlyCodes.map((code) => store.normalizeEmployee(code)))].filter((code) => roster.includes(code));
    // The period can close while we await local dependencies. Never begin employee
    // fan-out once that happens; the closed path is seal-only.
    if (isLocked(period) === true) return syncLockedPeriod(period, { reason });
    const cycleConcurrency = Math.max(1, Math.min(12, Number(requestedConcurrency) || 1));
    const results = await mapBounded(selected, cycleConcurrency, (empCode) => fetchEmployee(empCode, { period, roster: rosterRows, reason }));
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
    if (requireComplete) {
      const fullRosterSelected = selected.length === roster.length && selected.every((code) => roster.includes(code));
      const failedCodes = roster.filter((code) => unavailableReasons[code] || !records.has(code));
      if (!fullRosterSelected || successful !== roster.length || failedCodes.length) {
        throw Object.assign(new Error('Nguồn chưa đủ toàn bộ roster; không publish generation tạm.'), {
          code: 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE',
          unavailableEmployees: failedCodes,
          unavailableReasons: { ...unavailableReasons },
        });
      }
    }
    const periodLocked = isLocked(period) === true;
    // A run that started while open must never publish fetched data after the period
    // closes. A later sync will use only the independently verified closed seal.
    if (periodLocked) {
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT', 'Kỳ đã khoá trong lúc fan-out; không publish dữ liệu mạng.');
    }
    if (isLocked(period) === true) {
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT', 'Kỳ đã khoá sau fan-out; không dựng model từ dữ liệu mạng.');
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
    if (isLocked(period) === true) {
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT', 'Kỳ đã khoá trong lúc dựng model; không publish dữ liệu mạng.');
    }
    const dependenciesAfterBuild = await dependencyIdentity(period, { roster: rosterRows });
    if (store.canonicalJson(dependenciesAfterBuild) !== store.canonicalJson(dependenciesBefore)) {
      throw Object.assign(new Error('Nguồn phụ thuộc đổi trước publish; không publish generation trộn đời.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
    }
    if (isLocked(period) === true) {
      throw lockedError('EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT', 'Kỳ đã khoá trước publish; không publish dữ liệu mạng.');
    }
    const fetchedAt = iso(now());
    return store.publishGeneration(period, {
      source: 'network', roster, employees: records, model, dependencies, fetchedAt,
      unavailableReasons, watcherSuccessKey, sourceGeneration, periodLocked: false, locked: false,
    });
  }

  function dongBoKy(rawPeriod, syncOptions = {}) {
    const period = store.normalizePeriod(rawPeriod);
    const existing = inFlight.get(period);
    if (existing) return existing;
    const promise = store.withPeriodLock(period, () => syncUnlocked(period, syncOptions))
      .catch((error) => {
        const current = store.readStatus(period);
        if (error.code !== 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE') {
          const lockedFailure = error?.snapshotReason === 'locked'
            || String(error?.code || '').startsWith('EMPLOYEE_COST_SNAPSHOT_CLOSED_SEAL_')
            || error?.code === 'EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT';
          store.writeStatus(period, {
            ...current, state: lockedFailure ? 'locked' : 'failed', finishedAt: iso(now()), complete: false,
            locked: lockedFailure, unavailableReasons: lockedFailure ? { SNAPSHOT: 'locked' } : current.unavailableReasons,
            errorCode: String(error.code || 'EMPLOYEE_COST_SNAPSHOT_SYNC_FAILED'),
          });
        }
        throw error;
      })
      .finally(() => { if (inFlight.get(period) === promise) inFlight.delete(period); });
    inFlight.set(period, promise);
    return promise;
  }

  async function rebuildIncompleteClosedGeneration(rawPeriod, { actor = '', reason = 'manual_closed_repair' } = {}) {
    const period = store.normalizePeriod(rawPeriod);
    if (period !== '2026-07') {
      throw Object.assign(new Error('Kỳ này không được phép dựng lại generation tiền.'), { code: 'EMPLOYEE_COST_SNAPSHOT_REPAIR_PERIOD_DENIED' });
    }
    return store.withPeriodLock(period, async () => {
      if (isLocked(period) !== true) {
        throw Object.assign(new Error('Chỉ dựng lại generation của kỳ đã khoá.'), { code: 'EMPLOYEE_COST_SNAPSHOT_REPAIR_PERIOD_OPEN' });
      }
      const rosterRows = await rosterProvider(period);
      const roster = store.normalizeRoster(rosterRows);
      const before = store.tryReadCurrent(period, { roster });
      if (!before.ok || before.snapshot.complete || before.snapshot.employees.size >= roster.length) {
        throw Object.assign(new Error('Generation hiện tại không thiếu đội hình.'), { code: 'EMPLOYEE_COST_SNAPSHOT_REPAIR_NOT_NEEDED' });
      }
      const beforeId = before.snapshot.manifest.generationId;
      const dependenciesBefore = await dependencyIdentity(period, { roster: rosterRows });
      const results = await mapBounded(roster, concurrency, (empCode) => fetchEmployee(empCode, { period, roster: rosterRows, reason, requireFresh: true }));
      const employees = new Map();
      const missing = [];
      roster.forEach((empCode, index) => {
        const outcome = results[index];
        if (!outcome?.ok || !usableResult(outcome.value)) { missing.push(empCode); return; }
        const value = outcome.value;
        employees.set(empCode, { report: value.report ?? value, fetchedAt: iso(value.fetchedAt || now()), sourceRevision: String(value.sourceRevision || value.revision || '') });
      });
      if (missing.length) {
        auditClosedRepair({ outcome: 'rejected_incomplete', actor, period, beforeGenerationId: beforeId, beforeCount: before.snapshot.employees.size, afterCount: employees.size, missing });
        throw Object.assign(new Error('Nguồn chưa đủ toàn bộ roster; giữ nguyên generation cũ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE', unavailableEmployees: missing });
      }
      const dependenciesMid = await dependencyIdentity(period, { roster: rosterRows });
      if (store.canonicalJson(dependenciesMid) !== store.canonicalJson(dependenciesBefore)) {
        auditClosedRepair({ outcome: 'rejected_dependency_drift', actor, period, beforeGenerationId: beforeId, beforeCount: before.snapshot.employees.size, afterCount: 0 });
        throw Object.assign(new Error('Nguồn đổi trong lúc dựng; giữ nguyên generation cũ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
      }
      const model = await buildModel({ period, roster: rosterRows, employees, unavailableReasons: {}, dependencies: dependenciesBefore, previousModel: before.snapshot.model });
      try { await validateClosedRepair({ period, roster, employees, model, dependencies: dependenciesBefore }); }
      catch (error) {
        auditClosedRepair({ outcome: 'rejected_validation', actor, period, beforeGenerationId: beforeId, beforeCount: before.snapshot.employees.size, afterCount: employees.size });
        throw error;
      }
      const dependenciesAfter = await dependencyIdentity(period, { roster: rosterRows });
      if (store.canonicalJson(dependenciesAfter) !== store.canonicalJson(dependenciesBefore)) {
        auditClosedRepair({ outcome: 'rejected_dependency_drift', actor, period, beforeGenerationId: beforeId, beforeCount: before.snapshot.employees.size, afterCount: 0 });
        throw Object.assign(new Error('Nguồn đổi trước publish; giữ nguyên generation cũ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
      }
      if (isLocked(period) !== true) {
        throw Object.assign(new Error('Trạng thái kỳ đổi trước publish; giữ nguyên generation cũ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT' });
      }
      let published;
      try {
        published = store.publishClosedRepairGeneration(period, {
          expectedGenerationId: beforeId, roster, employees, model, dependencies: dependenciesBefore,
          fetchedAt: iso(now()), unavailableReasons: {},
        });
      } catch (error) {
        auditClosedRepair({ outcome: 'rejected_publish', actor, period, beforeGenerationId: beforeId, beforeCount: before.snapshot.employees.size, afterCount: 0 });
        throw error;
      }
      auditClosedRepair({ outcome: 'published', actor, period, beforeGenerationId: beforeId, afterGenerationId: published.manifest.generationId, beforeCount: before.snapshot.employees.size, afterCount: published.employees.size, checksum: published.pointer.manifestChecksum });
      return published;
    });
  }

  async function createInitialClosedGeneration(rawPeriod, { actor = '', reason = 'manual_closed_initial' } = {}) {
    const period = store.normalizePeriod(rawPeriod);
    if (period !== '2026-07') {
      throw Object.assign(new Error('Kỳ này không được phép tạo generation gốc.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_PERIOD_DENIED' });
    }
    return store.withPeriodLock(period, async () => {
      if (isLocked(period) !== true) {
        throw Object.assign(new Error('Chỉ tạo generation gốc cho kỳ đã khoá.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_PERIOD_OPEN' });
      }
      const rosterRows = await rosterProvider(period);
      const roster = store.normalizeRoster(rosterRows);
      const before = store.tryReadCurrent(period, { roster });
      if (before.ok) {
        throw Object.assign(new Error('Kỳ này đã có generation.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_ALREADY_EXISTS' });
      }
      const missingCurrent = before.error?.cause?.code === 'ENOENT' || before.error?.code === 'ENOENT';
      if (!missingCurrent) throw before.error;
      const dependenciesBefore = await dependencyIdentity(period, { roster: rosterRows });
      const results = await mapBounded(roster, concurrency, (empCode) => fetchEmployee(empCode, { period, roster: rosterRows, reason, requireFresh: true }));
      const employees = new Map();
      const missing = [];
      roster.forEach((empCode, index) => {
        const outcome = results[index];
        if (!outcome?.ok || !usableResult(outcome.value)) { missing.push(empCode); return; }
        const value = outcome.value;
        employees.set(empCode, { report: value.report ?? value, fetchedAt: iso(value.fetchedAt || now()), sourceRevision: String(value.sourceRevision || value.revision || '') });
      });
      if (missing.length || employees.size !== roster.length) {
        auditClosedRepair({ outcome: 'initial_rejected_incomplete', actor, period, source: 'network', beforeCount: 0, afterCount: employees.size, missing });
        throw Object.assign(new Error('Nguồn chưa đủ toàn bộ roster; không tạo generation gốc.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INCOMPLETE', unavailableEmployees: missing });
      }
      const dependenciesMid = await dependencyIdentity(period, { roster: rosterRows });
      if (store.canonicalJson(dependenciesMid) !== store.canonicalJson(dependenciesBefore)) {
        auditClosedRepair({ outcome: 'initial_rejected_dependency_drift', actor, period, source: 'network', beforeCount: 0, afterCount: 0 });
        throw Object.assign(new Error('Nguồn đổi trong lúc dựng; không tạo generation gốc.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
      }
      const model = await buildModel({ period, roster: rosterRows, employees, unavailableReasons: {}, dependencies: dependenciesBefore, previousModel: null });
      await validateClosedRepair({ period, roster, employees, model, dependencies: dependenciesBefore });
      const dependenciesAfter = await dependencyIdentity(period, { roster: rosterRows });
      if (store.canonicalJson(dependenciesAfter) !== store.canonicalJson(dependenciesBefore)) {
        auditClosedRepair({ outcome: 'initial_rejected_dependency_drift', actor, period, source: 'network', beforeCount: 0, afterCount: 0 });
        throw Object.assign(new Error('Nguồn đổi trước publish; không tạo generation gốc.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_DRIFT' });
      }
      if (isLocked(period) !== true) {
        throw Object.assign(new Error('Trạng thái kỳ đổi trước publish.'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_STATE_DRIFT' });
      }
      const published = store.publishInitialClosedGeneration(period, {
        roster, employees, model, dependencies: dependenciesBefore, fetchedAt: iso(now()), unavailableReasons: {},
      });
      auditClosedRepair({ outcome: 'initial_published', actor, period, source: 'network', beforeCount: 0, afterCount: published.employees.size, afterGenerationId: published.manifest.generationId, checksum: published.pointer.manifestChecksum });
      return published;
    });
  }

  function requestClosedRepair(rawPeriod, repairOptions = {}) {
    const period = store.normalizePeriod(rawPeriod);
    if (inFlight.has(period)) return { accepted: true, singleFlight: true, period, status: store.readStatus(period) };
    const current = store.tryReadCurrent(period);
    auditClosedRepair({ outcome: 'requested', actor: repairOptions.actor || '', period,
      beforeGenerationId: current.ok ? current.snapshot.manifest.generationId : '',
      beforeCount: current.ok ? current.snapshot.employees.size : 0, afterCount: 0 });
    const promise = rebuildIncompleteClosedGeneration(period, repairOptions)
      .catch((error) => {
        store.writeStatus(period, { ...store.readStatus(period), state: 'failed', finishedAt: iso(now()), errorCode: String(error.code || 'EMPLOYEE_COST_SNAPSHOT_REPAIR_FAILED') });
        throw error;
      })
      .finally(() => { if (inFlight.get(period) === promise) inFlight.delete(period); });
    inFlight.set(period, promise);
    promise.catch((error) => console.warn('[employee-cost-snapshot] closed repair failed', { period, code: error?.code || 'REPAIR_FAILED' }));
    return { accepted: true, singleFlight: false, period, status: store.readStatus(period) };
  }

  function requestInitialClosedGeneration(rawPeriod, initialOptions = {}) {
    const period = store.normalizePeriod(rawPeriod);
    if (inFlight.has(period)) return { accepted: true, singleFlight: true, period, status: store.readStatus(period) };
    auditClosedRepair({ outcome: 'initial_requested', actor: initialOptions.actor || '', period, source: 'network', beforeCount: 0, afterCount: 0 });
    const promise = createInitialClosedGeneration(period, initialOptions)
      .catch((error) => {
        const evidence = error?.statusEvidence || {};
        const validation = error?.validation || {};
        const unavailableReasons = {};
        for (const code of validation.unavailableEmployees || []) unavailableReasons[code] = 'upstream_unavailable';
        for (const code of validation.staleEmployees || []) unavailableReasons[code] = 'stale_rates';
        store.writeStatus(period, {
          ...store.readStatus(period), state: 'failed', finishedAt: iso(now()),
          rosterCount: Number(evidence.rosterCount || 0), availableCount: Number(evidence.availableCount || 0),
          unavailableReasons, errorCode: String(error.code || 'EMPLOYEE_COST_SNAPSHOT_INITIAL_FAILED'),
        });
        auditClosedRepair({
          outcome: 'initial_rejected_validation', actor: initialOptions.actor || '', period, source: 'network',
          beforeCount: 0, afterCount: Number(evidence.availableCount || 0),
          rosterCount: Number(evidence.rosterCount || 0), errorCode: String(error.code || 'EMPLOYEE_COST_SNAPSHOT_INITIAL_FAILED'),
          validation: {
            identityValid: validation.identityValid === true,
            coverageValid: validation.coverageValid === true,
            freshnessValid: validation.freshnessValid === true,
            reconciliationValid: validation.reconciliationValid === true,
            provenancePresent: validation.provenancePresent === true,
            provenanceComplete: validation.provenanceComplete === true,
          },
          unavailableEmployees: validation.unavailableEmployees || [], staleEmployees: validation.staleEmployees || [],
          provenanceFailures: Array.isArray(validation.provenanceFailures) ? validation.provenanceFailures : [],
        });
        throw error;
      })
      .finally(() => { if (inFlight.get(period) === promise) inFlight.delete(period); });
    inFlight.set(period, promise);
    promise.catch((error) => console.warn('[employee-cost-snapshot] initial generation failed', { period, code: error?.code || 'INITIAL_FAILED' }));
    return { accepted: true, singleFlight: false, period, status: store.readStatus(period) };
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

  return { dongBoKy, requestSync, requestClosedRepair, requestInitialClosedGeneration, trangThaiDongBo, rebuildIncompleteClosedGeneration, createInitialClosedGeneration, inFlight, mapBounded };
}

module.exports = { createEmployeeCostSnapshotSync, mapBounded, usableResult, sourceFailureReason };
