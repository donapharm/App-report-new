'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writeJsonAtomic, acquireFileLock } = require('./materializeFileSafety');
const policy = require('./groupDonaRevenuePolicy');
const cutover = require('./debtsRevenueCutover');

function fail(code, details = {}) { const error = new Error(code); error.code = code; error.details = details; throw error; }
function checksum(rows) { return createHash('sha256').update(cutover.canonical(rows)).digest('hex'); }
function dataThrough(rows) { return rows.reduce((latest, row) => {
  const value = String(row?.date || row?.invoice_date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value > latest ? value : latest;
}, ''); }
function root(dataDir, period) { return path.join(path.resolve(String(dataDir || '')), 'revenue_generations', period); }
function generationPath(dataDir, period, kind, digest) { return path.join(root(dataDir, period), `${kind}-${digest}.json`); }
function currentPath(dataDir, period, kind) { return path.join(root(dataDir, period), `${kind}-current.json`); }

function buildAppWeb(period, rows, metadata = {}) {
  const normalized = policy.normalizePeriod(period);
  if (!policy.isCutoverPeriod(normalized) || !Array.isArray(rows) || rows.some((row) =>
    String(row?.source || '').toUpperCase() !== 'APP_WEB_PARTNER' || policy.isGroupDona(row) || !String(row?.source_line_id || '').trim())) {
    fail('APP_WEB_GENERATION_INVALID');
  }
  const rowsChecksum = checksum(rows);
  return Object.freeze({ schema: 1, kind: 'app-web', period: normalized, rows: Object.freeze(rows.slice()), rowCount: rows.length,
    rowsChecksum, dataThrough: dataThrough(rows), source: 'APP_WEB_PARTNER', generatedAt: metadata.generatedAt || new Date().toISOString(),
    provenance: Object.freeze({ catalogVersion: metadata.catalogVersion || '', kpi: metadata.kpi || null }) });
}

function buildDebts(period, payload, metadata = {}) {
  const normalized = policy.normalizePeriod(period);
  const entities = new Set((payload?.sourceReceipts || []).map((item) => String(item?.legalEntity || '').toUpperCase()));
  if (!policy.isCutoverPeriod(normalized) || payload?.period !== normalized || !Array.isArray(payload?.rows)
    || payload.sourceReceipts.length !== 2 || entities.size !== 2 || !entities.has('DONA') || !entities.has('AFP')
    || payload.rows.some((row) => String(row?.source || '').toUpperCase() !== 'DEBTS_INVOICE_SHADOW' || !policy.isGroupDona(row)
      || !String(row?.source_line_id || '').trim())) {
    fail('DEBTS_ATOMIC_GENERATION_INVALID');
  }
  const rowsChecksum = checksum(payload.rows);
  if (payload.rowsChecksum !== rowsChecksum) fail('DEBTS_ATOMIC_GENERATION_CHECKSUM_MISMATCH');
  return Object.freeze({ schema: 1, kind: 'debts-dona-afp', period: normalized, rows: Object.freeze(payload.rows.slice()), rowCount: payload.rows.length,
    rowsChecksum, dataThrough: dataThrough(payload.rows), sourceReceipts: payload.sourceReceipts,
    generatedAt: metadata.generatedAt || new Date().toISOString() });
}

function validate(generation, expectedKind, period) {
  if (!['app-web', 'debts-dona-afp'].includes(expectedKind) || !generation || generation.kind !== expectedKind
    || generation.period !== policy.normalizePeriod(period) || !Array.isArray(generation.rows)
    || generation.rowCount !== generation.rows.length || checksum(generation.rows) !== generation.rowsChecksum) fail('REVENUE_GENERATION_INVALID');
  try {
    if (expectedKind === 'app-web') buildAppWeb(generation.period, generation.rows, generation.provenance || {});
    else buildDebts(generation.period, { period: generation.period, rows: generation.rows, rowsChecksum: generation.rowsChecksum,
      sourceReceipts: generation.sourceReceipts }, { generatedAt: generation.generatedAt });
  } catch { fail('REVENUE_GENERATION_INVALID'); }
  return generation;
}

function stage(generation, { dataDir } = {}) {
  validate(generation, generation?.kind, generation?.period);
  const dir = root(dataDir, generation.period); fs.mkdirSync(dir, { recursive: true });
  const release = acquireFileLock(path.join(dir, `${generation.kind}.lock`));
  try {
    const immutable = generationPath(dataDir, generation.period, generation.kind, generation.rowsChecksum);
    if (fs.existsSync(immutable)) {
      const existing = JSON.parse(fs.readFileSync(immutable, 'utf8'));
      validate(existing, generation.kind, generation.period);
      if (cutover.canonical(existing.rows) !== cutover.canonical(generation.rows)) fail('REVENUE_GENERATION_IMMUTABLE_CONFLICT');
    } else writeJsonAtomic(immutable, generation);
    writeJsonAtomic(currentPath(dataDir, generation.period, generation.kind), { schema: 1, file: path.basename(immutable), rowsChecksum: generation.rowsChecksum });
    return Object.freeze({ file: immutable, generation });
  } finally { release(); }
}

function loadCurrent({ dataDir, period, kind } = {}) {
  const pointer = JSON.parse(fs.readFileSync(currentPath(dataDir, period, kind), 'utf8'));
  if (!/^[a-z-]+-[a-f0-9]{64}\.json$/.test(String(pointer.file || ''))) fail('REVENUE_GENERATION_POINTER_INVALID');
  const generation = JSON.parse(fs.readFileSync(path.join(root(dataDir, policy.normalizePeriod(period)), pointer.file), 'utf8'));
  validate(generation, kind, period);
  if (pointer.rowsChecksum !== generation.rowsChecksum) fail('REVENUE_GENERATION_POINTER_DRIFT');
  return generation;
}

function bootstrapFromActive({ dataDir, period } = {}) {
  const normalized = policy.normalizePeriod(period); const ky = `${normalized.slice(5)}.${normalized.slice(0, 4)}`;
  const registry = JSON.parse(fs.readFileSync(path.join(path.resolve(dataDir), 'upload_slots.json'), 'utf8'));
  const active = Array.isArray(registry) && registry.find((item) => item.ky === ky && item.active);
  if (!active) fail('REVENUE_ACTIVE_SLOT_UNAVAILABLE');
  const rows = JSON.parse(fs.readFileSync(path.join(path.resolve(dataDir), 'uploads', `${active.id}.json`), 'utf8'));
  if (!Array.isArray(rows)) fail('REVENUE_ACTIVE_SLOT_INVALID');
  const appRows = rows.filter((row) => String(row?.source || '').toUpperCase() === 'APP_WEB_PARTNER');
  const debtRows = rows.filter((row) => String(row?.source || '').toUpperCase() === 'DEBTS_INVOICE_SHADOW');
  const receipts = active.debtsSourceReceipts;
  return Object.freeze({ appWeb: buildAppWeb(normalized, appRows, { generatedAt: active.activatedAt || active.uploadedAt }),
    debts: buildDebts(normalized, { period: normalized, rows: debtRows, rowsChecksum: checksum(debtRows), sourceReceipts: receipts },
      { generatedAt: active.activatedAt || active.uploadedAt }) });
}

function coordinate({ period, appWeb, debts } = {}) {
  const normalized = policy.normalizePeriod(period);
  validate(appWeb, 'app-web', normalized); validate(debts, 'debts-dona-afp', normalized);
  const dataAsOf = [appWeb.dataThrough, debts.dataThrough].filter(Boolean).sort()[0] || '';
  return Object.freeze({ period: normalized, currentRows: appWeb.rows, debts: { period: normalized, rows: debts.rows,
    rowsChecksum: debts.rowsChecksum, sourceReceipts: debts.sourceReceipts }, dataAsOf, partitionGenerations: {
    APP_WEB: { checksum: appWeb.rowsChecksum, rowCount: appWeb.rowCount, dataThrough: appWeb.dataThrough, generatedAt: appWeb.generatedAt },
    DEBTS_DONA_AFP: { checksum: debts.rowsChecksum, rowCount: debts.rowCount, dataThrough: debts.dataThrough, generatedAt: debts.generatedAt },
  } });
}

module.exports = { checksum, dataThrough, buildAppWeb, buildDebts, validate, stage, loadCurrent, bootstrapFromActive, coordinate,
  _paths: { root, generationPath, currentPath } };
