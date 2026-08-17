'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const SCHEMA_VERSION = 1;
const PROJECTION_VERSION = 1;
const SENSITIVE_COLUMNS = Object.freeze(Array.from({ length: 16 }, (_, index) => `c${index + 32}`));
const SENSITIVE_SET = new Set(SENSITIVE_COLUMNS);
const FULL_COLUMNS = Object.freeze(Array.from({ length: 52 }, (_, index) => `c${index + 1}`));
const SAFE_COLUMNS = Object.freeze(FULL_COLUMNS.filter((column) => !SENSITIVE_SET.has(column)));
const COST_COLUMNS = Object.freeze([...SENSITIVE_COLUMNS]);
const DEFAULT_GRACE_MS = 15 * 60 * 1000;

class Catalog52Error extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'Catalog52Error';
    this.code = code;
    this.status = details.status || 422;
    this.details = Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'status'));
  }
}

function fail(code, details) { throw new Catalog52Error(code, details); }
function cleanText(value, max = 240) { return String(value ?? '').normalize('NFC').trim().slice(0, max); }
function upper(value, max) { return cleanText(value, max).toUpperCase(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function stableValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => [key, stableValue(value[key])]));
}
function canonicalJson(value) { return JSON.stringify(stableValue(value)); }
function checksum(value) { return `sha256:${sha256(value)}`; }

function periodValue(value) {
  const period = cleanText(value, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail('CATALOG52_PERIOD_INVALID');
  return period;
}

function digestValue(value, code) {
  const digest = cleanText(value, 80).toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(code);
  return digest;
}

function safeSegment(value, code) {
  const segment = cleanText(value, 180);
  if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..') fail(code);
  return segment;
}

function normalizedRow(source, index) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('CATALOG52_ROW_INVALID', { index });
  const sourceLineId = cleanText(source.sourceLineId ?? source.source_line_id ?? source.lineId, 240);
  if (!sourceLineId) fail('CATALOG52_LINE_ID_MISSING', { index });
  const row = { sourceLineId };
  for (const column of FULL_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(source, column)) fail('CATALOG52_COLUMN_MISSING', { index, column });
    row[column] = source[column];
  }
  return Object.freeze(row);
}

function assertNoSensitive(value, location = 'catalogSafe') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSensitive(item, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_SET.has(String(key).toLowerCase())) fail('CATALOG52_SENSITIVE_FIELD_LEAK', { location, field: String(key).toLowerCase() });
    assertNoSensitive(child, `${location}.${key}`);
  }
}

function projectRows(rows, { period, sourceVersion, sourceVersionNo } = {}) {
  const canonicalPeriod = periodValue(period);
  const safe = [];
  const mapping = [];
  const cost = [];
  const seen = new Set();
  const mappingCandidates = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = normalizedRow(rows[index], index);
    if (seen.has(row.sourceLineId)) fail('CATALOG52_DUPLICATE_LINE_ID', { sourceLineId: row.sourceLineId });
    seen.add(row.sourceLineId);
    safe.push(Object.freeze(Object.fromEntries(['sourceLineId', ...SAFE_COLUMNS].map((key) => [key, row[key]]))));
    const unitCode = upper(row.c7, 180);
    const qlnbCode = upper(row.c5, 180);
    const employeeCode = upper(row.c6, 80);
    const uom = upper(row.c25, 100) || null;
    if (!unitCode || !qlnbCode || !employeeCode) fail('CATALOG52_MAPPING_REQUIRED_VALUE_MISSING', { sourceLineId: row.sourceLineId });
    const mappingKey = `${unitCode}\u001f${qlnbCode}`;
    const candidates = mappingCandidates.get(mappingKey) || new Map();
    const candidateKey = `${employeeCode}\u001f${uom || ''}`;
    candidates.set(candidateKey, { employeeCode, uom, sourceLineId: row.sourceLineId });
    mappingCandidates.set(mappingKey, candidates);
    cost.push(Object.freeze(Object.fromEntries([
      ['sourceLineId', row.sourceLineId], ['period', canonicalPeriod],
      ...COST_COLUMNS.map((key) => [key, row[key]]),
    ])));
  }
  for (const [key, candidates] of [...mappingCandidates].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const [unitCode, qlnbCode] = key.split('\u001f');
    const values = [...candidates.values()].sort((a, b) => `${a.employeeCode}|${a.uom}`.localeCompare(`${b.employeeCode}|${b.uom}`, 'en'));
    mapping.push(Object.freeze({
      unitCode,
      qlnbCode,
      candidates: Object.freeze(values),
      employeeConflict: new Set(values.map((item) => item.employeeCode)).size > 1,
      uomConflict: new Set(values.map((item) => item.uom || '')).size > 1,
    }));
  }
  assertNoSensitive(safe);
  const projectionMeta = (name, projectionRows) => Object.freeze({
    name,
    projectionVersion: PROJECTION_VERSION,
    period: canonicalPeriod,
    sourceVersion: cleanText(sourceVersion, 180),
    sourceVersionNo: Number(sourceVersionNo),
    rowCount: projectionRows.length,
    internalIdentityHash: checksum(canonicalJson(projectionRows)),
  });
  return Object.freeze({
    catalogSafe: Object.freeze(safe), employeeMapping: Object.freeze(mapping), costRestricted: Object.freeze(cost),
    metadata: Object.freeze({
      catalogSafe: projectionMeta('catalogSafe', safe),
      employeeMapping: projectionMeta('employeeMapping', mapping),
      costRestricted: projectionMeta('costRestricted', cost),
    }),
  });
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeFileDurable(file, content, mode = 0o600) {
  const fd = fs.openSync(file, 'wx', mode);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  try {
    writeFileDurable(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function jsonLines(rows) { return `${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`; }

// Bounded synchronous JSONL reader: pagination must not read the whole full-52
// object into the API process.  It stops as soon as the requested page is full.
function readJsonLinesPage(file, start, end) {
  const fd = fs.openSync(file, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const rows = [];
  let pending = ''; let lineNo = 0;
  const consume = (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (lineNo >= start && lineNo < end && line) rows.push(JSON.parse(line));
      lineNo += 1;
      if (lineNo >= end) return true;
    }
    return false;
  };
  try {
    while (lineNo < end) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) { consume(decoder.end()); break; }
      if (consume(decoder.write(buffer.subarray(0, bytes)))) break;
    }
    return rows;
  } finally { fs.closeSync(fd); }
}

function lockOwner(token) {
  return { schemaVersion: 1, token, pid: process.pid, host: os.hostname(), boot: cleanText(process.env.APP_REPORT_BOOT_ID || 'unknown', 120), heartbeatAt: Date.now() };
}

function createStore({ root, lockTtlMs = 5 * 60 * 1000, readerGraceMs = DEFAULT_GRACE_MS, now = () => Date.now() } = {}) {
  const storeRoot = path.resolve(String(root || path.join(__dirname, '..', 'data', 'catalog52-snapshots')));
  const objectsRoot = path.join(storeRoot, 'objects');
  const pointersRoot = path.join(storeRoot, 'pointers');
  const locksRoot = path.join(storeRoot, 'locks');
  const pinsRoot = path.join(storeRoot, 'pins');
  const auditRoot = path.join(storeRoot, 'audit');

  function ensureRoots() {
    for (const directory of [storeRoot, objectsRoot, pointersRoot, locksRoot, pinsRoot, auditRoot]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
    }
  }
  function writeAudit(period, action, fields = {}) {
    ensureRoots();
    const at = new Date(now()).toISOString();
    const id = `${at.replace(/[^0-9]/g, '')}-${crypto.randomBytes(8).toString('hex')}`;
    const directory = path.join(auditRoot, periodValue(period));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
    writeFileDurable(path.join(directory, `${id}.json`), `${JSON.stringify({ schemaVersion: 1, at, action, ...fields })}\n`);
    fsyncDirectory(directory);
  }
  function pointerFile(period) { return path.join(pointersRoot, `${periodValue(period)}.json`); }
  function readPointer(period) {
    try { return JSON.parse(fs.readFileSync(pointerFile(period), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; fail('CATALOG52_POINTER_INVALID', { period: periodValue(period) }); }
  }
  function manifestPath(period, manifestId) { return path.join(objectsRoot, periodValue(period), safeSegment(manifestId, 'CATALOG52_MANIFEST_ID_INVALID'), 'manifest.json'); }
  function readManifest(period, manifestId) {
    const file = manifestPath(period, manifestId);
    let value;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('CATALOG52_MANIFEST_INVALID', { period, manifestId }); }
    if (value.manifestId !== manifestId || value.period !== periodValue(period)) fail('CATALOG52_MANIFEST_IDENTITY_MISMATCH');
    return value;
  }
  function acquireLock(period, action) {
    ensureRoots();
    const key = periodValue(period);
    const file = path.join(locksRoot, `${key}.json`);
    const token = crypto.randomBytes(24).toString('hex');
    function attempt() {
      try { writeFileDurable(file, `${JSON.stringify({ ...lockOwner(token), action })}\n`); return; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner = null;
        try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* invalid is stale after TTL based on mtime */ }
        const stat = fs.statSync(file);
        const heartbeat = Number(owner?.heartbeatAt || stat.mtimeMs || 0);
        const sameHostAlive = owner?.host === os.hostname() && Number.isSafeInteger(owner?.pid) && (() => {
          try { process.kill(owner.pid, 0); return true; } catch { return false; }
        })();
        if (now() - heartbeat <= lockTtlMs || sameHostAlive) fail('CATALOG52_WRITE_LOCKED', { status: 409, period: key, action: owner?.action || null });
        const stale = `${file}.stale-${now()}-${crypto.randomBytes(4).toString('hex')}`;
        try { fs.renameSync(file, stale); fs.unlinkSync(stale); } catch { fail('CATALOG52_WRITE_LOCKED', { status: 409, period: key }); }
        writeFileDurable(file, `${JSON.stringify({ ...lockOwner(token), action, recovered: true })}\n`);
      }
    }
    attempt();
    const heartbeat = setInterval(() => {
      try {
        const current = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (current.token === token) atomicJson(file, { ...current, heartbeatAt: now() });
      } catch { /* ownership will be checked at release */ }
    }, Math.max(1000, Math.floor(lockTtlMs / 3)));
    heartbeat.unref?.();
    return () => {
      clearInterval(heartbeat);
      try {
        const current = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (current.token !== token) fail('CATALOG52_LOCK_OWNERSHIP_LOST', { status: 409 });
        fs.unlinkSync(file); fsyncDirectory(locksRoot);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
  }
  function withLock(period, action, fn) {
    const release = acquireLock(period, action);
    try { return fn(); } finally { release(); }
  }

  function prepareCandidate(envelope, { activate = false, actor = 'system' } = {}) {
    const period = periodValue(envelope?.period);
    return withLock(period, 'prepare', () => {
      const source = cleanText(envelope?.source, 80);
      const sourceVersion = cleanText(envelope?.sourceVersion, 180);
      const sourceVersionNo = Number(envelope?.sourceVersionNo);
      const expectedSourceDigest = digestValue(envelope?.sourceIntegrityChecksum, 'CATALOG52_SOURCE_CHECKSUM_REQUIRED');
      const bytes = Buffer.isBuffer(envelope?.canonicalBytes) ? envelope.canonicalBytes : Buffer.from(String(envelope?.canonicalBytes || ''), 'utf8');
      if (!bytes.length || sha256(bytes) !== expectedSourceDigest) fail('CATALOG52_SOURCE_CHECKSUM_MISMATCH');
      if (source !== 'ceo-vault' || !sourceVersion || !Number.isSafeInteger(sourceVersionNo) || sourceVersionNo < 0) fail('CATALOG52_SOURCE_IDENTITY_INVALID');
      let sourceDocument;
      try { sourceDocument = JSON.parse(bytes.toString('utf8')); } catch { fail('CATALOG52_SOURCE_BYTES_INVALID'); }
      const rows = sourceDocument?.rows;
      if (!Array.isArray(rows) || rows.length !== envelope.rowCount) fail('CATALOG52_ROW_COUNT_MISMATCH');
      const normalized = rows.map(normalizedRow);
      const projections = projectRows(normalized, { period, sourceVersion, sourceVersionNo });
      const internalIdentityHash = checksum(canonicalJson(normalized));
      const manifestId = `${sourceVersionNo}-${expectedSourceDigest.slice(0, 24)}-${internalIdentityHash.slice(7, 23)}`;
      const objectDirectory = path.join(objectsRoot, period, manifestId);
      if (fs.existsSync(objectDirectory)) fail('CATALOG52_IMMUTABLE_OBJECT_EXISTS', { status: 409, manifestId });
      fs.mkdirSync(path.dirname(objectDirectory), { recursive: true, mode: 0o700 });
      const stage = fs.mkdtempSync(path.join(path.dirname(objectDirectory), `.stage-${process.pid}-`));
      try {
        fs.chmodSync(stage, 0o700);
        const artifacts = {
          full: { file: 'full.jsonl', rows: normalized },
          catalogSafe: { file: 'catalog-safe.jsonl', rows: projections.catalogSafe },
          employeeMapping: { file: 'employee-mapping.jsonl', rows: projections.employeeMapping },
          costRestricted: { file: 'cost-restricted.jsonl', rows: projections.costRestricted },
        };
        const artifactManifest = {};
        for (const [name, artifact] of Object.entries(artifacts)) {
          const content = jsonLines(artifact.rows);
          writeFileDurable(path.join(stage, artifact.file), content);
          artifactManifest[name] = { file: artifact.file, rowCount: artifact.rows.length, checksum: checksum(content) };
        }
        const createdAt = new Date(now()).toISOString();
        const manifest = {
          schemaVersion: SCHEMA_VERSION, projectionVersion: PROJECTION_VERSION, manifestId, period, source,
          sourceVersion, sourceVersionNo, rowCount: normalized.length,
          sourceIntegrityChecksum: `sha256:${expectedSourceDigest}`, internalIdentityHash,
          receivedAt: cleanText(envelope.receivedAt, 80) || createdAt, validatedAt: createdAt, activatedAt: null,
          artifacts: artifactManifest, projections: projections.metadata,
          mappingConflicts: projections.employeeMapping.filter((row) => row.employeeConflict || row.uomConflict).length,
          state: 'validated', createdBy: cleanText(actor, 80),
        };
        writeFileDurable(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        fsyncDirectory(stage);
        fs.renameSync(stage, objectDirectory); fsyncDirectory(path.dirname(objectDirectory));
        writeAudit(period, 'preview_validated', { manifestId, actor: cleanText(actor, 80), sourceVersion, sourceIntegrityChecksum: `sha256:${expectedSourceDigest}` });
        if (activate) return activateUnlocked(period, manifestId, actor);
        return manifest;
      } catch (error) {
        try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* best effort */ }
        throw error;
      }
    });
  }

  function activateUnlocked(period, manifestId, actor) {
    const manifest = readManifest(period, manifestId);
    for (const artifact of Object.values(manifest.artifacts || {})) {
      const file = path.join(path.dirname(manifestPath(period, manifestId)), artifact.file);
      const content = fs.readFileSync(file);
      if (checksum(content) !== artifact.checksum) fail('CATALOG52_ARTIFACT_CHECKSUM_MISMATCH', { manifestId });
    }
    const current = readPointer(period);
    const activatedAt = new Date(now()).toISOString();
    const pointer = {
      schemaVersion: 1, period: periodValue(period), activeManifestId: manifestId,
      lastKnownGoodManifestId: current?.activeManifestId || current?.lastKnownGoodManifestId || manifestId,
      activatedAt, actor: cleanText(actor, 80),
    };
    atomicJson(pointerFile(period), pointer);
    writeAudit(period, 'activate', { manifestId, previousManifestId: current?.activeManifestId || null, actor: cleanText(actor, 80) });
    return { ...manifest, activatedAt, state: 'active', pointer };
  }
  function activateManifest(period, manifestId, { actor = 'system' } = {}) {
    return withLock(period, 'activate', () => activateUnlocked(periodValue(period), safeSegment(manifestId, 'CATALOG52_MANIFEST_ID_INVALID'), actor));
  }
  function rollback(period, { actor = 'system' } = {}) {
    return withLock(period, 'rollback', () => {
      const current = readPointer(period);
      if (!current?.lastKnownGoodManifestId) fail('CATALOG52_LKG_MISSING', { status: 409 });
      if (current.lastKnownGoodManifestId === current.activeManifestId) fail('CATALOG52_ROLLBACK_NO_PREVIOUS', { status: 409 });
      const previousActive = current.activeManifestId;
      const result = activateUnlocked(periodValue(period), current.lastKnownGoodManifestId, actor);
      const pointer = { ...result.pointer, lastKnownGoodManifestId: previousActive };
      atomicJson(pointerFile(period), pointer);
      writeAudit(period, 'rollback', { fromManifestId: previousActive, toManifestId: pointer.activeManifestId, actor: cleanText(actor, 80) });
      return { ...result, pointer };
    });
  }
  function pin(period, manifestId) {
    ensureRoots();
    const id = `${periodValue(period)}-${safeSegment(manifestId, 'CATALOG52_MANIFEST_ID_INVALID')}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    const file = path.join(pinsRoot, `${id}.json`);
    atomicJson(file, { period, manifestId, pid: process.pid, host: os.hostname(), pinnedAt: now() });
    return () => { try { fs.unlinkSync(file); fsyncDirectory(pinsRoot); } catch { /* best effort */ } };
  }
  function readProjectionPage(period, projection, { page = 1, pageSize = 100, manifestId = null } = {}) {
    const pointer = manifestId ? null : readPointer(period);
    const pinnedManifestId = safeSegment(manifestId || pointer?.activeManifestId, 'CATALOG52_ACTIVE_POINTER_MISSING');
    const manifest = readManifest(periodValue(period), pinnedManifestId);
    const artifact = manifest.artifacts?.[projection];
    if (!artifact || projection === 'costRestricted') fail('CATALOG52_PROJECTION_FORBIDDEN', { status: 403 });
    const release = pin(period, pinnedManifestId);
    try {
      const normalizedPage = Math.max(1, Number(page) || 1);
      const normalizedSize = Math.max(1, Math.min(500, Number(pageSize) || 100));
      const start = (normalizedPage - 1) * normalizedSize;
      const end = start + normalizedSize;
      const rows = readJsonLinesPage(path.join(path.dirname(manifestPath(period, pinnedManifestId)), artifact.file), start, end);
      if (projection === 'catalogSafe') assertNoSensitive(rows, 'catalogSafeResponse');
      return {
        period: manifest.period, manifestId: manifest.manifestId, sourceVersion: manifest.sourceVersion,
        sourceIntegrityChecksum: manifest.sourceIntegrityChecksum, stale: false, page: normalizedPage,
        pageSize: normalizedSize, total: artifact.rowCount, rows,
      };
    } finally { release(); }
  }
  function status(period) {
    const pointer = readPointer(period);
    if (!pointer) return { period: periodValue(period), active: null, lastKnownGood: null };
    const active = readManifest(periodValue(period), pointer.activeManifestId);
    return { period: periodValue(period), active, lastKnownGoodManifestId: pointer.lastKnownGoodManifestId, pointer };
  }
  function retain(period, { keep = 3 } = {}) {
    return withLock(period, 'retention', () => {
      const key = periodValue(period); const pointer = readPointer(key);
      const protectedIds = new Set([pointer?.activeManifestId, pointer?.lastKnownGoodManifestId].filter(Boolean));
      try {
        for (const file of fs.readdirSync(pinsRoot)) {
          const pinValue = JSON.parse(fs.readFileSync(path.join(pinsRoot, file), 'utf8'));
          if (pinValue.period === key && now() - pinValue.pinnedAt <= readerGraceMs) protectedIds.add(pinValue.manifestId);
        }
      } catch { /* absent/invalid pins fail safe by retaining files */ return { deleted: [], skipped: ['pin_store_unavailable'] }; }
      const directory = path.join(objectsRoot, key);
      let entries = [];
      try { entries = fs.readdirSync(directory).filter((name) => !name.startsWith('.stage-')).map((name) => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime); }
      catch (error) { if (error.code === 'ENOENT') return { deleted: [], skipped: [] }; throw error; }
      entries.slice(0, Math.max(2, keep)).forEach((entry) => protectedIds.add(entry.name));
      const deleted = [];
      for (const entry of entries) {
        if (protectedIds.has(entry.name) || now() - entry.mtime < readerGraceMs) continue;
        fs.rmSync(path.join(directory, entry.name), { recursive: true }); deleted.push(entry.name);
      }
      if (deleted.length) fsyncDirectory(directory);
      if (deleted.length) writeAudit(key, 'retention_delete', { manifestIds: deleted });
      return { deleted, protected: [...protectedIds] };
    });
  }

  return Object.freeze({
    root: storeRoot, prepareCandidate, activateManifest, rollback, status, readProjectionPage, retain,
    readPointer, readManifest, acquireLock, writeAudit,
  });
}

module.exports = {
  SCHEMA_VERSION, PROJECTION_VERSION, FULL_COLUMNS, SAFE_COLUMNS, SENSITIVE_COLUMNS, COST_COLUMNS,
  Catalog52Error, stableValue, canonicalJson, checksum, normalizedRow, assertNoSensitive, projectRows, readJsonLinesPage, createStore,
};
