#!/usr/bin/env node
'use strict';

// Offline-only materializer. Runtime code never invokes this script.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const phase0 = require('../src/catalogPeriodLkgPhase0');
const sidecar = require('../src/catalogPeriodLkg');

function fsyncDir(dir) { const fd = fs.openSync(dir, fs.constants.O_RDONLY); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function atomic(file, raw) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file); fs.chmodSync(file, 0o600); fsyncDir(path.dirname(file));
}
function extract(source, out) {
  const root = JSON.parse(fs.readFileSync(source, 'utf8'));
  const snapshots = root.snapshots || (root.period ? { [root.period]: root } : {});
  for (const [period, snapshot] of Object.entries(snapshots)) atomic(path.join(out, `${period}.json`), JSON.stringify(snapshot));
  process.stdout.write(`${JSON.stringify(Object.keys(snapshots).sort())}\n`);
}
if (process.argv[2] === '--extract') {
  extract(path.resolve(process.argv[3]), path.resolve(process.argv[4]));
  process.exit(0);
}
function extractIsolated(source, out) {
  const child = spawnSync(process.execPath, [__filename, '--extract', source, out], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (child.status !== 0) throw new Error(child.stderr || `extract failed: ${source}`);
  return JSON.parse(child.stdout);
}
function main() {
  const mainFile = path.resolve(process.env.CATALOG_MANAGEMENT_CACHE_FILE || path.join(__dirname, '..', 'data', 'catalog_management_lkg.json'));
  const dqFile = path.resolve(process.env.EMPLOYEE_COST_DQ_CATALOG_CACHE_FILE || path.join(__dirname, '..', 'data', 'employee_cost_dq_catalog_lkg.json'));
  const out = path.resolve(process.env.CATALOG_PERIOD_LKG_ROOT || path.join(__dirname, '..', 'data', 'catalog_lkg', 'v1'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-period-materialize-'));
  try {
    const mainOut = path.join(temp, 'main');
    const dqOut = path.join(temp, 'dq');
    const mainPeriods = extractIsolated(mainFile, mainOut);
    const dqPeriods = new Set(extractIsolated(dqFile, dqOut));
    const periods = mainPeriods.filter((period) => dqPeriods.has(period)).sort();
    const index = { schemaVersion: 1, kind: 'catalog-period-lkg-index', createdAt: new Date().toISOString(), periods: {} };
    for (const period of periods) {
      const snapshot = JSON.parse(fs.readFileSync(path.join(mainOut, `${period}.json`), 'utf8'));
      const dqSnapshot = JSON.parse(fs.readFileSync(path.join(dqOut, `${period}.json`), 'utf8'));
      const payload = { period, snapshot, dqSnapshot };
      const envelope = { schemaVersion: 1, kind: 'catalog-period-lkg', period, payloadChecksum: phase0.sha256(payload), payload };
      const raw = JSON.stringify(envelope);
      const name = `${period}.json`;
      atomic(path.join(out, name), raw);
      index.periods[period] = { file: name, checksum: sidecar.hash(raw), sourceVersion: String(snapshot.meta?.version || ''), sourceChecksum: String(snapshot.meta?.checksum || '') };
    }
    atomic(path.join(out, 'index.json'), JSON.stringify(index));
    process.stdout.write(`${JSON.stringify({ out, periods: periods.length })}\n`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main();
