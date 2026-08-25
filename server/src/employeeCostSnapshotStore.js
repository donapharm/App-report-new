'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMP_RE = /^[A-Z0-9_-]{1,32}$/;
const SAFE_REASONS = new Set([
  'not_configured', 'upstream_unavailable', 'upstream_rejected', 'upstream_busy', 'deadline', 'source_error', 'missing',
  'stale_rates', 'roster_added', 'roster_changed', 'corrupt_snapshot', 'sync_failed', 'locked',
]);

function normalizePeriod(value) {
  const period = String(value || '').trim();
  if (!PERIOD_RE.test(period)) throw Object.assign(new Error('Kỳ snapshot phải đúng YYYY-MM.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INVALID_PERIOD' });
  return period;
}

function normalizeEmployee(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!EMP_RE.test(code)) throw Object.assign(new Error('Mã nhân viên snapshot không hợp lệ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INVALID_EMPLOYEE' });
  return code;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function envelope(kind, payload) {
  const canonicalPayload = canonicalize(payload);
  return { schemaVersion: SCHEMA_VERSION, kind, checksum: sha256(canonicalJson(canonicalPayload)), payload: canonicalPayload };
}

function validateEnvelope(value, kind) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || value.kind !== kind || !value.payload || typeof value.payload !== 'object') {
    throw Object.assign(new Error(`Snapshot ${kind} sai schema.`), { code: 'EMPLOYEE_COST_SNAPSHOT_SCHEMA_INVALID' });
  }
  const actual = sha256(canonicalJson(value.payload));
  if (actual !== value.checksum) throw Object.assign(new Error(`Snapshot ${kind} sai checksum.`), { code: 'EMPLOYEE_COST_SNAPSHOT_CHECKSUM_INVALID' });
  return value.payload;
}

function normalizeRoster(roster) {
  return [...new Set((roster || []).map((item) => normalizeEmployee(item?.emp_code || item?.empCode || item)))].sort();
}

function rosterIdentity(roster) {
  return sha256(canonicalJson(normalizeRoster(roster)));
}

function safeReason(reason, fallback = 'upstream_unavailable') {
  const value = String(reason || '').trim().toLowerCase();
  return SAFE_REASONS.has(value) ? value : fallback;
}

function safeUnavailableReasons(value) {
  const result = {};
  for (const [rawCode, rawReason] of Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {})) {
    try { result[normalizeEmployee(rawCode)] = safeReason(rawReason); } catch { /* privacy-safe drop */ }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const SAFE_PROVENANCE_FAILURE_REASONS = new Set(['not_configured', 'invalid_scope', 'upstream_not_found', 'upstream_unavailable', 'invalid_snapshot']);
function safeProvenanceFailures(value) {
  const result = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const scope = String(item?.scope || '').trim();
    const reason = String(item?.reason || '').trim().toLowerCase();
    if (!/^\d{4}-(0[1-9]|1[0-2]):[^:\r\n]{1,80}$/.test(scope) || !SAFE_PROVENANCE_FAILURE_REASONS.has(reason)) continue;
    result.set(`${scope}\u001f${reason}`, { scope, reason });
  }
  return [...result.values()].sort((a, b) => a.scope.localeCompare(b.scope));
}

function sealModelMatchesRoster(model, period, roster) {
  if (!model || model.allEmployees !== true || model.from !== period || model.to !== period) return false;
  let modelRoster;
  try { modelRoster = normalizeRoster(model.employees); } catch { return false; }
  if (canonicalJson(modelRoster) !== canonicalJson(roster)) return false;
  if (!Array.isArray(model.periods) || !model.periods.length) return false;
  if (!model.periods.every((item) => item?.period === period
    && Number(item?.match?.unavailableEmployeeCount || 0) === 0
    && (!Array.isArray(item?.match?.unavailableEmployees) || item.match.unavailableEmployees.length === 0)
    && Number(item?.match?.staleEmployeeCount || 0) === 0
    && (!Array.isArray(item?.match?.staleEmployees) || item.match.staleEmployees.length === 0))) return false;
  if (!model.revenueRecon || model.revenueRecon.unavailable === true || model.revenueRecon.balanced !== true) return false;
  return Array.isArray(model.remoteProvenance)
    && !model.remoteProvenance.some((item) => String(item).endsWith(':THIEU'));
}

function closedRepairModelValidation(model, period, roster, options = {}) {
  const normalizedPeriod = normalizePeriod(period);
  const normalizedRoster = normalizeRoster(roster);
  let modelRoster = [];
  try { modelRoster = normalizeRoster(model?.employees); } catch { /* reported below */ }
  const periods = Array.isArray(model?.periods) ? model.periods : [];
  const unavailableEmployees = [...new Set(periods.flatMap((item) => (
    Array.isArray(item?.match?.unavailableEmployees) ? item.match.unavailableEmployees : []
  )).map((item) => {
    try { return normalizeEmployee(item); } catch { return ''; }
  }).filter(Boolean))].sort();
  const staleEmployees = [...new Set(periods.flatMap((item) => (
    Array.isArray(item?.match?.staleEmployees) ? item.match.staleEmployees : []
  )).map((item) => {
    try { return normalizeEmployee(item); } catch { return ''; }
  }).filter(Boolean))].sort();
  const identityValid = !!model && model.allEmployees === true
    && model.from === normalizedPeriod && model.to === normalizedPeriod
    && canonicalJson(modelRoster) === canonicalJson(normalizedRoster);
  const coverageValid = periods.length > 0 && periods.every((item) => item?.period === normalizedPeriod
    && Number(item?.match?.unavailableEmployeeCount || 0) === 0
    && (!Array.isArray(item?.match?.unavailableEmployees) || item.match.unavailableEmployees.length === 0));
  const freshnessValid = periods.length > 0 && periods.every((item) => Number(item?.match?.staleEmployeeCount || 0) === 0
    && (!Array.isArray(item?.match?.staleEmployees) || item.match.staleEmployees.length === 0));
  const reconciliationValid = !!model?.revenueRecon
    && model.revenueRecon.unavailable !== true && model.revenueRecon.balanced === true;
  const provenanceRecorded = Array.isArray(model?.remoteProvenance);
  const provenancePresent = provenanceRecorded && model.remoteProvenance.length > 0;
  const provenanceComplete = provenanceRecorded
    && (provenancePresent || options.allowExplicitNoRemoteProvenance === true)
    && !model.remoteProvenance.some((item) => String(item).endsWith(':THIEU'));
  const provenanceFailures = safeProvenanceFailures(model?.remoteProvenanceFailures);
  return {
    valid: identityValid && coverageValid && freshnessValid && reconciliationValid && provenanceComplete,
    identityValid, coverageValid, freshnessValid, reconciliationValid,
    provenanceRecorded, provenancePresent, provenanceComplete, provenanceFailures, unavailableEmployees, staleEmployees,
  };
}

function tupleOf(record = {}) {
  return [
    String(record.fetchedAt || ''),
    String(record.sourceRevision || ''),
    String(record.checksum || ''),
  ];
}

function compareTuple(a, b) {
  const aa = tupleOf(a); const bb = tupleOf(b);
  for (let i = 0; i < aa.length; i += 1) {
    const compared = aa[i].localeCompare(bb[i]);
    if (compared) return compared;
  }
  return 0;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function createEmployeeCostSnapshotStore(options = {}) {
  const closedRepairCapability = Symbol('employee-cost-closed-repair');
  const closedInitialCapability = Symbol('employee-cost-closed-initial');
  const root = path.resolve(options.root || process.env.EMPLOYEE_COST_SNAPSHOT_ROOT || path.join(__dirname, '..', 'data', 'employee_cost_snapshots'));
  const now = options.now || (() => new Date());
  const crashHook = typeof options.crashHook === 'function' ? options.crashHook : () => {};
  const lockStaleMs = Math.max(5_000, Number(options.lockStaleMs || 10 * 60_000));
  const lockWaitMs = Math.max(0, Number(options.lockWaitMs ?? 15_000));

  function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* fail at the actual write if unusable */ }
  }
  function fsyncDir(dir) {
    let fd;
    try { fd = fs.openSync(dir, fs.constants.O_RDONLY); fs.fsyncSync(fd); } finally { if (fd != null) fs.closeSync(fd); }
  }
  function atomicWrite(file, body, boundary = 'write') {
    ensureDir(path.dirname(file));
    const unique = `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    const temp = path.join(path.dirname(file), unique);
    let fd;
    try {
      fd = fs.openSync(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeFileSync(fd, body, 'utf8');
      crashHook(`${boundary}:after-write`, { file, temp });
      fs.fsyncSync(fd);
      crashHook(`${boundary}:after-file-fsync`, { file, temp });
      fs.closeSync(fd); fd = null;
      fs.renameSync(temp, file);
      crashHook(`${boundary}:after-rename`, { file, temp });
      fsyncDir(path.dirname(file));
      crashHook(`${boundary}:after-dir-fsync`, { file, temp });
    } catch (error) {
      if (fd != null) try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.unlinkSync(temp); } catch { /* ignore */ }
      throw error;
    }
  }
  function writeEnvelope(file, kind, payload, boundary) {
    const value = envelope(kind, payload);
    atomicWrite(file, `${canonicalJson(value)}\n`, boundary);
    return value;
  }
  function readEnvelope(file, kind) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { throw Object.assign(new Error(`Không đọc được snapshot ${kind}.`), { code: 'EMPLOYEE_COST_SNAPSHOT_CORRUPT', cause: error }); }
    return validateEnvelope(parsed, kind);
  }
  function periodDir(period) { return path.join(root, normalizePeriod(period)); }
  function currentFile(period) { return path.join(periodDir(period), 'current.json'); }
  function statusFile(period) { return path.join(periodDir(period), 'status.json'); }
  function lockFile(period) { return path.join(periodDir(period), '.sync.lock'); }

  async function acquireLock(period, { waitMs = lockWaitMs } = {}) {
    const normalized = normalizePeriod(period);
    const file = lockFile(normalized);
    ensureDir(path.dirname(file));
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
        fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`);
        fs.fsyncSync(fd); fs.closeSync(fd); fsyncDir(path.dirname(file));
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try { fs.unlinkSync(file); fsyncDir(path.dirname(file)); } catch { /* lock expired/removed */ }
        };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const stat = fs.statSync(file);
          if (Date.now() - stat.mtimeMs > lockStaleMs) { fs.unlinkSync(file); continue; }
        } catch (statError) { if (statError.code === 'ENOENT') continue; }
        if (Date.now() >= deadline) throw Object.assign(new Error('Đồng bộ kỳ này đang chạy ở tiến trình khác.'), { code: 'EMPLOYEE_COST_SNAPSHOT_LOCKED' });
        await sleep(Math.min(100, Math.max(10, deadline - Date.now())));
      }
    }
  }

  async function withPeriodLock(period, task, lockOptions) {
    const release = await acquireLock(period, lockOptions);
    try { return await task(); } finally { release(); }
  }

  function isPeriodBusy(period) {
    const normalized = normalizePeriod(period);
    try { if (fs.statSync(lockFile(normalized)).isFile()) return true; } catch (error) { if (error.code !== 'ENOENT') return true; }
    return readStatus(normalized).state === 'syncing';
  }

  function readStatus(period) {
    const normalized = normalizePeriod(period);
    try {
      const payload = readEnvelope(statusFile(normalized), 'status');
      return {
        period: normalized,
        state: ['idle', 'syncing', 'ready', 'partial', 'failed', 'locked'].includes(payload.state) ? payload.state : 'failed',
        generationId: String(payload.generationId || ''),
        fetchedAt: String(payload.fetchedAt || ''),
        startedAt: String(payload.startedAt || ''),
        finishedAt: String(payload.finishedAt || ''),
        rosterCount: Number(payload.rosterCount || 0),
        availableCount: Number(payload.availableCount || 0),
        complete: payload.complete === true,
        locked: payload.locked === true,
        unavailableReasons: safeUnavailableReasons(payload.unavailableReasons),
        errorCode: String(payload.errorCode || ''),
      };
    } catch { return { period: normalized, state: 'idle', generationId: '', fetchedAt: '', rosterCount: 0, availableCount: 0, complete: false, locked: false, unavailableReasons: {} }; }
  }

  function writeStatus(period, status = {}) {
    const normalized = normalizePeriod(period);
    const payload = {
      period: normalized,
      state: ['idle', 'syncing', 'ready', 'partial', 'failed', 'locked'].includes(status.state) ? status.state : 'failed',
      generationId: String(status.generationId || ''),
      fetchedAt: String(status.fetchedAt || ''),
      startedAt: String(status.startedAt || ''),
      finishedAt: String(status.finishedAt || ''),
      rosterCount: Math.max(0, Number(status.rosterCount || 0)),
      availableCount: Math.max(0, Number(status.availableCount || 0)),
      complete: status.complete === true,
      locked: status.locked === true,
      unavailableReasons: safeUnavailableReasons(status.unavailableReasons),
      errorCode: String(status.errorCode || '').replace(/[^A-Z0-9_:-]/gi, '').slice(0, 80),
    };
    writeEnvelope(statusFile(normalized), 'status', payload, 'status');
    return payload;
  }

  function readCurrent(period, { roster = null } = {}) {
    const normalized = normalizePeriod(period);
    const pointer = readEnvelope(currentFile(normalized), 'current'); // pin once
    if (pointer.period !== normalized || !/^[a-f0-9]{64}$/.test(String(pointer.generationId || ''))) {
      throw Object.assign(new Error('Current snapshot không hợp lệ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_POINTER_INVALID' });
    }
    const generationDir = path.join(periodDir(normalized), 'generations', pointer.generationId);
    const manifest = readEnvelope(path.join(generationDir, 'manifest.json'), 'manifest');
    if (manifest.period !== normalized || manifest.generationId !== pointer.generationId || pointer.manifestChecksum !== sha256(canonicalJson(manifest))) {
      throw Object.assign(new Error('Manifest snapshot không khớp current.'), { code: 'EMPLOYEE_COST_SNAPSHOT_MANIFEST_INVALID' });
    }
    const model = readEnvelope(path.join(generationDir, manifest.model.file), 'model');
    if (sha256(canonicalJson(model)) !== manifest.model.checksum) throw Object.assign(new Error('Model snapshot không khớp manifest.'), { code: 'EMPLOYEE_COST_SNAPSHOT_MODEL_INVALID' });
    const employees = new Map();
    for (const item of manifest.employees || []) {
      const code = normalizeEmployee(item.empCode);
      const record = readEnvelope(path.join(generationDir, item.file), 'employee');
      if (record.empCode !== code || sha256(canonicalJson(record)) !== item.checksum) throw Object.assign(new Error('Employee snapshot không khớp manifest.'), { code: 'EMPLOYEE_COST_SNAPSHOT_EMPLOYEE_INVALID' });
      employees.set(code, record);
    }
    const manifestRoster = Array.isArray(manifest.roster) ? manifest.roster.map(normalizeEmployee) : [];
    if (manifestRoster.some((code, index) => code !== manifest.roster[index]) || manifest.rosterIdentity !== rosterIdentity(manifestRoster)) {
      throw Object.assign(new Error('Roster snapshot không khớp manifest.'), { code: 'EMPLOYEE_COST_SNAPSHOT_ROSTER_INVALID' });
    }
    if (!manifest.model || !/^[a-f0-9]{64}$/.test(String(manifest.model.checksum || ''))
      || !/^[a-f0-9]{64}$/.test(String(manifest.dependencyIdentity || ''))
      || manifest.dependencyIdentity !== sha256(canonicalJson(manifest.dependencies || {}))) {
      throw Object.assign(new Error('Dependency/model snapshot không khớp manifest.'), { code: 'EMPLOYEE_COST_SNAPSHOT_DEPENDENCY_INVALID' });
    }
    const source = manifest.source == null ? 'network' : String(manifest.source);
    if (!['network', 'seal'].includes(source)) {
      throw Object.assign(new Error('Nguồn snapshot không hợp lệ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_SOURCE_INVALID' });
    }
    if (source === 'seal' && (!/^[a-f0-9]{64}$/.test(String(manifest.sealIdentity || ''))
      || employees.size !== 0 || manifest.complete !== true || manifest.locked !== true
      || !sealModelMatchesRoster(model, normalized, manifestRoster))) {
      throw Object.assign(new Error('Snapshot từ dấu đóng không đủ bằng chứng.'), { code: 'EMPLOYEE_COST_SNAPSHOT_SEAL_INVALID' });
    }
    const currentRoster = roster == null ? manifestRoster : normalizeRoster(roster);
    const added = currentRoster.filter((code) => !manifestRoster.includes(code));
    const removed = manifestRoster.filter((code) => !currentRoster.includes(code));
    const unavailableReasons = {
      ...safeUnavailableReasons(manifest.refreshUnavailableReasons),
      ...safeUnavailableReasons(manifest.unavailableReasons),
    };
    for (const code of added) unavailableReasons[code] = 'roster_added';
    if (removed.length) unavailableReasons.ROSTER = 'roster_changed';
    const complete = manifest.complete === true && !added.length && !removed.length;
    return { period: normalized, pointer, manifest, model, employees, complete, rosterChanged: !!(added.length || removed.length), unavailableReasons: safeUnavailableReasons(unavailableReasons) };
  }

  function tryReadCurrent(period, options) {
    try { return { ok: true, snapshot: readCurrent(period, options) }; }
    catch (error) { return { ok: false, error }; }
  }

  function publishGeneration(period, input = {}) {
    const normalized = normalizePeriod(period);
    const source = input.source == null ? 'network' : String(input.source);
    if (!['network', 'seal'].includes(source)) {
      throw Object.assign(new Error('Nguồn snapshot không hợp lệ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_SOURCE_INVALID' });
    }
    const sealIdentity = String(input.sealIdentity || '');
    const closedRepair = input.closedRepairCapability === closedRepairCapability;
    const closedInitial = input.closedInitialCapability === closedInitialCapability;
    if (input.locked === true && source !== 'seal' && !closedRepair && !closedInitial) {
      throw Object.assign(new Error('Kỳ khoá chỉ được publish từ dấu đóng hợp lệ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_SEAL_INVALID' });
    }
    if (source === 'seal' && (!/^[a-f0-9]{64}$/.test(sealIdentity)
      || input.periodLocked !== true || input.locked !== true)) {
      throw Object.assign(new Error('Snapshot kỳ khoá thiếu căn cước dấu.'), { code: 'EMPLOYEE_COST_SNAPSHOT_SEAL_INVALID' });
    }
    // Closed-period policy must be enforced by this persistence boundary too;
    // callers cannot bypass immutability by forgetting to set `locked`.
    if (input.periodLocked === true && input.locked !== true && !closedRepair && !closedInitial) {
      throw Object.assign(new Error('Kỳ đã khoá; chỉ được publish generation đầy đủ đã đóng dấu.'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
    }
    const roster = normalizeRoster(input.roster);
    const records = source === 'seal'
      ? new Map()
      : input.employees instanceof Map ? input.employees : new Map(Object.entries(input.employees || {}));
    const previous = tryReadCurrent(normalized);
    if (previous.ok && previous.snapshot.manifest.locked && previous.snapshot.manifest.complete) {
      throw Object.assign(new Error('Kỳ đã khoá và có snapshot đầy đủ; không được thay đổi.'), { code: 'EMPLOYEE_COST_SNAPSHOT_PERIOD_IMMUTABLE' });
    }
    if (closedRepair) {
      const expected = String(input.expectedGenerationId || '');
      if (normalized !== '2026-07') {
        throw Object.assign(new Error('Chỉ cho phép sửa generation tiền T07.2026.'), { code: 'EMPLOYEE_COST_SNAPSHOT_REPAIR_PERIOD_DENIED' });
      }
      if (!previous.ok || previous.snapshot.complete || previous.snapshot.manifest.generationId !== expected) {
        throw Object.assign(new Error('Generation hiện tại đã đổi hoặc không còn thiếu đội hình.'), { code: 'EMPLOYEE_COST_SNAPSHOT_REPAIR_CAS_MISMATCH' });
      }
      if (source !== 'network' || input.periodLocked !== true || input.locked !== true) {
        throw Object.assign(new Error('Generation sửa kỳ khoá thiếu ràng buộc.'), { code: 'EMPLOYEE_COST_SNAPSHOT_REPAIR_INVALID' });
      }
    }
    if (closedInitial) {
      if (normalized !== '2026-07') {
        throw Object.assign(new Error('Chỉ cho phép tạo generation gốc T07.2026.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_PERIOD_DENIED' });
      }
      if (previous.ok) {
        throw Object.assign(new Error('Kỳ này đã có generation; từ chối tạo generation gốc lần hai.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_ALREADY_EXISTS' });
      }
      const missingCurrent = previous.error?.cause?.code === 'ENOENT' || previous.error?.code === 'ENOENT';
      if (!missingCurrent || source !== 'network' || input.periodLocked !== true || input.locked !== true) {
        throw Object.assign(new Error('Trạng thái generation gốc không hợp lệ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_INITIAL_INVALID' });
      }
    }
    const normalizedRecords = [];
    for (const code of roster) {
      const raw = records.get(code) || records.get(code.toLowerCase());
      const old = source === 'seal' ? null : previous.ok ? previous.snapshot.employees.get(code) : null;
      // A failed/missing fetch must never erase this employee's last-known-good.
      if (!raw) { if (old) normalizedRecords.push(old); continue; }
      const report = canonicalize(raw.report ?? raw.payload ?? raw);
      const record = {
        empCode: code,
        fetchedAt: String(raw.fetchedAt || input.fetchedAt || now().toISOString()),
        sourceRevision: String(raw.sourceRevision || ''),
        report,
        checksum: sha256(canonicalJson(report)),
      };
      normalizedRecords.push(old && compareTuple(record, old) < 0 ? old : record);
    }
    const attemptedReasons = safeUnavailableReasons(input.unavailableReasons);
    const unavailableReasons = {};
    // LKG keeps the model stable during an outage. It remains available, but status
    // still reports that the newest refresh failed for that employee.
    const refreshUnavailableReasons = { ...attemptedReasons };
    if (source === 'network') {
      for (const code of roster) if (!normalizedRecords.some((record) => record.empCode === code)) unavailableReasons[code] = attemptedReasons[code] || 'missing';
    }
    const model = canonicalize(input.model || {});
    const complete = source === 'seal'
      ? roster.length > 0 && Object.keys(attemptedReasons).length === 0 && sealModelMatchesRoster(model, normalized, roster)
      : roster.length > 0 && roster.every((code) => normalizedRecords.some((record) => record.empCode === code));
    if (source === 'seal' && !complete) {
      throw Object.assign(new Error('Model từ dấu không chứng minh đủ roster/kỳ khoá.'), { code: 'EMPLOYEE_COST_SNAPSHOT_SEAL_INVALID' });
    }
    const fetchedAt = String(input.fetchedAt || now().toISOString());
    const dependencies = canonicalize(input.dependencies || {});
    const watcherSuccessKey = /^[a-f0-9]{64}$/.test(String(input.watcherSuccessKey || ''))
      ? String(input.watcherSuccessKey) : '';
    const sourceGeneration = typeof input.sourceGeneration === 'string' && input.sourceGeneration
      && input.sourceGeneration === input.sourceGeneration.trim() && input.sourceGeneration.length <= 160
      ? input.sourceGeneration : '';
    const generationSeed = { period: normalized, source, sealIdentity: source === 'seal' ? sealIdentity : '', roster, employees: normalizedRecords.map((record) => ({ empCode: record.empCode, ...tupleOf(record) })), dependencies, model, fetchedAt, watcherSuccessKey, sourceGeneration, locked: input.locked === true && complete };
    const generationId = sha256(canonicalJson(generationSeed));
    const generationDir = path.join(periodDir(normalized), 'generations', generationId);
    ensureDir(path.join(generationDir, 'employees'));
    const employeeRefs = [];
    for (const record of normalizedRecords) {
      const relative = `employees/${record.empCode}.json`;
      writeEnvelope(path.join(generationDir, relative), 'employee', record, `employee:${record.empCode}`);
      employeeRefs.push({ empCode: record.empCode, file: relative, checksum: sha256(canonicalJson(record)), tuple: tupleOf(record) });
    }
    writeEnvelope(path.join(generationDir, 'model.json'), 'model', model, 'model');
    const manifest = {
      period: normalized, generationId, fetchedAt, roster, rosterIdentity: rosterIdentity(roster),
      source, sealIdentity: source === 'seal' ? sealIdentity : '', watcherSuccessKey, sourceGeneration,
      dependencies, dependencyIdentity: sha256(canonicalJson(dependencies)),
      employees: employeeRefs, model: { file: 'model.json', checksum: sha256(canonicalJson(model)) },
      complete, unavailableReasons, refreshUnavailableReasons, locked: input.locked === true && complete,
    };
    writeEnvelope(path.join(generationDir, 'manifest.json'), 'manifest', manifest, 'manifest');
    fsyncDir(generationDir);
    const pointer = { period: normalized, generationId, manifestChecksum: sha256(canonicalJson(manifest)), publishedAt: fetchedAt };
    writeEnvelope(currentFile(normalized), 'current', pointer, 'current');
    writeStatus(normalized, {
      state: manifest.locked ? 'locked' : complete ? 'ready' : 'partial', generationId, fetchedAt,
      finishedAt: fetchedAt, rosterCount: roster.length, availableCount: source === 'seal' ? roster.length : normalizedRecords.length,
      complete, locked: manifest.locked, unavailableReasons: { ...unavailableReasons, ...refreshUnavailableReasons },
    });
    return readCurrent(normalized, { roster });
  }

  function publishClosedRepairGeneration(period, input = {}) {
    return publishGeneration(period, { ...input, closedRepairCapability, source: 'network', periodLocked: true, locked: true });
  }

  function publishInitialClosedGeneration(period, input = {}) {
    return publishGeneration(period, { ...input, closedInitialCapability, source: 'network', periodLocked: true, locked: true });
  }

  function closedRepairModelMatchesRoster(model, period, roster) {
    return sealModelMatchesRoster(model, normalizePeriod(period), normalizeRoster(roster));
  }

  function capturePublicationState(period) {
    const normalized = normalizePeriod(period);
    let pointer = null;
    try { pointer = readEnvelope(currentFile(normalized), 'current'); } catch (error) {
      if (error?.cause?.code !== 'ENOENT' && error?.code !== 'ENOENT') throw error;
    }
    const generationsDir = path.join(periodDir(normalized), 'generations');
    let generations = [];
    try { generations = fs.readdirSync(generationsDir).filter((name) => /^[a-f0-9]{64}$/.test(name)).sort(); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { period: normalized, pointer, generations };
  }

  function restorePublicationState(period, captured = {}, failedGenerationId = '') {
    const normalized = normalizePeriod(period);
    const failed = String(failedGenerationId || '');
    if (captured.period !== normalized || !Array.isArray(captured.generations)
      || !/^[a-f0-9]{64}$/.test(failed) || captured.generations.includes(failed)) {
      throw Object.assign(new Error('Trạng thái snapshot rollback không hợp lệ.'), { code: 'EMPLOYEE_COST_SNAPSHOT_RESTORE_INVALID' });
    }
    // Never overwrite a newer publisher. Restoration is legal only while current
    // still points to the exact failed generation created by this invocation.
    const livePointer = readEnvelope(currentFile(normalized), 'current');
    if (livePointer.generationId !== failed) {
      throw Object.assign(new Error('Snapshot current đã đổi; từ chối rollback đè generation khác.'), { code: 'EMPLOYEE_COST_SNAPSHOT_RESTORE_DRIFT' });
    }
    if (captured.pointer) {
      const generationDir = path.join(periodDir(normalized), 'generations', captured.pointer.generationId);
      const manifest = readEnvelope(path.join(generationDir, 'manifest.json'), 'manifest');
      if (captured.pointer.period !== normalized || manifest.generationId !== captured.pointer.generationId
        || captured.pointer.manifestChecksum !== sha256(canonicalJson(manifest))) {
        throw Object.assign(new Error('Snapshot rollback pointer không khớp manifest.'), { code: 'EMPLOYEE_COST_SNAPSHOT_RESTORE_INVALID' });
      }
      writeEnvelope(currentFile(normalized), 'current', captured.pointer, 'current');
    } else {
      try { fs.unlinkSync(currentFile(normalized)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const generationsDir = path.join(periodDir(normalized), 'generations');
    fs.rmSync(path.join(generationsDir, failed), { recursive: true, force: true });
    fsyncDir(periodDir(normalized));
    return true;
  }

  function docSnapshot(period, options) { return readCurrent(period, options); }
  function trangThaiDongBo(period, options = {}) {
    const status = readStatus(period);
    const result = tryReadCurrent(period, options);
    if (!result.ok) return { ...status, state: status.state === 'syncing' ? 'syncing' : 'failed', complete: false, errorCode: result.error?.code || 'EMPLOYEE_COST_SNAPSHOT_MISSING', unavailableReasons: { ...status.unavailableReasons, SNAPSHOT: 'corrupt_snapshot' } };
    return { ...status, generationId: result.snapshot.manifest.generationId, fetchedAt: result.snapshot.manifest.fetchedAt, complete: result.snapshot.complete, locked: result.snapshot.manifest.locked, unavailableReasons: result.snapshot.unavailableReasons, rosterCount: (options.roster ? normalizeRoster(options.roster) : result.snapshot.manifest.roster).length, availableCount: result.snapshot.manifest.source === 'seal' ? result.snapshot.manifest.roster.length : result.snapshot.employees.size, state: result.snapshot.manifest.locked ? 'locked' : result.snapshot.complete ? 'ready' : 'partial' };
  }

  return {
    root, normalizePeriod, normalizeEmployee, normalizeRoster, rosterIdentity, canonicalJson, sha256,
    compareTuple, safeReason, safeUnavailableReasons, acquireLock, withPeriodLock, isPeriodBusy,
    readStatus, writeStatus, readCurrent, tryReadCurrent, publishGeneration, publishClosedRepairGeneration, publishInitialClosedGeneration, closedRepairModelMatchesRoster, closedRepairModelValidation,
    capturePublicationState, restorePublicationState, docSnapshot, trangThaiDongBo,
    _test: { envelope, validateEnvelope, atomicWrite, currentFile, statusFile, periodDir },
  };
}

module.exports = { createEmployeeCostSnapshotStore, normalizePeriod, normalizeEmployee, normalizeRoster, rosterIdentity, canonicalJson, sha256, compareTuple, safeReason, safeUnavailableReasons, SCHEMA_VERSION };
