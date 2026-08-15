#!/usr/bin/env node
'use strict';

// Offline/read-only Phase 0 benchmark. It writes projections only below a
// temporary directory and never imports the runtime catalog reader/writer.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const phase0 = require('../src/catalogPeriodLkgPhase0');

function nowMs() { return Number(process.hrtime.bigint()) / 1e6; }
function memory() { const m = process.memoryUsage(); return { rss: m.rss, heapUsed: m.heapUsed, external: m.external }; }

function childMeasure(file, repetitions) {
  const bytes = fs.statSync(file).size;
  let firstMs = 0;
  let hotMs = 0;
  let value;
  for (let i = 0; i < repetitions; i += 1) {
    if (i > 0 && typeof global.gc === 'function') global.gc();
    const start = nowMs();
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const elapsed = nowMs() - start;
    if (i === 0) firstMs = elapsed; else hotMs += elapsed;
  }
  if (value?.kind === 'catalog-period-lkg') phase0.validateEnvelope(value, value.period);
  process.stdout.write(JSON.stringify({
    bytes,
    coldMs: firstMs,
    hotMeanMs: repetitions > 1 ? hotMs / (repetitions - 1) : null,
    memory: memory(),
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
  }));
}

if (process.argv[2] === '--measure') {
  childMeasure(process.argv[3], Math.max(1, Number(process.argv[4]) || 1));
  process.exit(0);
}

function measure(file, repetitions = 3) {
  const result = spawnSync(process.execPath, ['--expose-gc', __filename, '--measure', file, String(repetitions)], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `benchmark child exited ${result.status}`);
  return JSON.parse(result.stdout);
}

function main() {
  const mainFile = path.resolve(process.env.CATALOG_MANAGEMENT_CACHE_FILE || path.join(__dirname, '..', 'data', 'catalog_management_lkg.json'));
  const dqFile = path.resolve(process.env.EMPLOYEE_COST_DQ_CATALOG_CACHE_FILE || path.join(__dirname, '..', 'data', 'employee_cost_dq_catalog_lkg.json'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-period-lkg-bench-'));
  try {
    const started = nowMs();
    const mainRoot = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
    const dqRoot = JSON.parse(fs.readFileSync(dqFile, 'utf8'));
    const periods = Object.keys(mainRoot.snapshots || {}).filter((period) => dqRoot.snapshots?.[period]).sort();
    if (!periods.length) throw new Error('No common main/DQ periods');
    const projectedFiles = [];
    for (const period of periods) {
      const file = path.join(temp, `${period}.json`);
      phase0.writeEnvelopeAtomic(file, phase0.projectPeriod(mainRoot, dqRoot, period));
      projectedFiles.push(file);
    }
    const projectionBuildMs = nowMs() - started;
    const requestedPeriod = process.env.CATALOG_PERIOD_BENCHMARK_PERIOD || '2026-08';
    const oneIndex = periods.includes(requestedPeriod) ? periods.indexOf(requestedPeriod) : periods.length - 1;
    const one = projectedFiles[oneIndex];
    const multiFile = path.join(temp, 'all-periods.json');
    fs.writeFileSync(multiFile, JSON.stringify(projectedFiles.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))), { mode: 0o600 });
    const result = {
      measuredAt: new Date().toISOString(),
      source: { mainFile, mainBytes: fs.statSync(mainFile).size, dqBytes: fs.statSync(dqFile).size, periods },
      projectionBuildMs,
      monolith: measure(mainFile),
      onePeriod: { period: periods[oneIndex], ...measure(one) },
      multiplePeriods: { count: periods.length, ...measure(multiFile) },
      note: 'Cold/hot are isolated-process JSON read+parse timings. RSS is child process.memoryUsage().rss after parsing; runtime was not modified.',
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

main();
