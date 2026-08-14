#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const guard = require('../src/appReportRssGuard');

const ROOT = process.env.APP_REPORT_RSS_GUARD_DIR
  || '/home/osboxes/.openclaw/workspace-report-dev/artifacts/app-report-rss-guard';
const STATE_FILE = path.join(ROOT, 'state.json');
const PEAK_DIR = path.join(ROOT, 'peaks');
const INTERVAL_MS = Math.max(5000, Number(process.env.APP_REPORT_RSS_GUARD_INTERVAL_MS || 5000));
const LOOP = process.argv.includes('--loop');
fs.mkdirSync(PEAK_DIR, { recursive: true, mode: 0o700 });

function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function atomicJson(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function pm2Sample() {
  const list = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  const app = list.find((item) => item.name === 'app-report');
  if (!app) throw new Error('app-report process missing');
  const numericMarker = process.env.APP_REPORT_NUMERIC_MISMATCH_MARKER || '';
  return {
    atMs: Date.now(), pid: Number(app.pid || 0), restarts: Number(app.pm2_env?.restart_time || 0),
    rssBytes: Number(app.monit?.memory || 0), status: String(app.pm2_env?.status || 'missing'),
    numericMismatch: !!numericMarker && fs.existsSync(numericMarker),
    unexpectedOom: String(app.pm2_env?.status || '') !== 'online',
  };
}
function activity() {
  const marker = process.env.APP_REPORT_ACTIVITY_MARKER || '';
  if (marker) { try { return fs.readFileSync(marker, 'utf8').trim().slice(0, 500); } catch { /* continue */ } }
  return 'unknown';
}
function peakEvidence(sample, evaluated) {
  if (!evaluated.peak) return;
  const stamp = new Date(sample.atMs).toISOString().replace(/[:.]/g, '-');
  let processes = '';
  try { processes = execFileSync('ps', ['-eo', 'pid,ppid,rss,vsz,lstart,args', '--sort=-rss'], { encoding: 'utf8' }).split('\n').slice(0, 35).join('\n'); } catch { /* no process list */ }
  fs.writeFileSync(path.join(PEAK_DIR, `${stamp}.txt`), [
    `time=${new Date(sample.atMs).toISOString()}`,
    `pid=${sample.pid}`,
    `restarts=${sample.restarts}`,
    `rss_bytes=${sample.rssBytes}`,
    `continuous_ms=${evaluated.continuousMs}`,
    `activity=${activity()}`,
    `suspect_catalog_lkg=${/catalog|lkg/i.test(activity())}`,
    '', processes, '',
  ].join('\n'), { mode: 0o600 });
}
function runOnce() {
  const previous = readJson(STATE_FILE, {});
  const sample = pm2Sample();
  const evaluated = guard.evaluateSample(previous, sample);
  peakEvidence(sample, evaluated);
  const next = { ...previous, ...evaluated, lastStatus: sample.status, updatedAt: new Date(sample.atMs).toISOString() };
  atomicJson(STATE_FILE, next);
  const executeMode = String(process.env.APP_REPORT_RSS_GUARD_EXECUTE || '') === '1' ? 'execute' : 'observe';
  const triggerKey = `${evaluated.trigger}:${executeMode}`;
  if (!evaluated.trigger || previous.handledTriggerKey === triggerKey) return { ...evaluated, handled: false };
  const triggerFile = path.join(ROOT, `TRIGGER-${new Date(sample.atMs).toISOString().replace(/[:.]/g, '-')}.json`);
  atomicJson(triggerFile, { trigger: evaluated.trigger, sample, activity: activity() });
  const result = guard.executeRollback();
  atomicJson(path.join(ROOT, 'last-rollback-result.json'), { at: new Date().toISOString(), trigger: evaluated.trigger, result });
  let postRestartBaseline = next.baselineRestarts;
  if (result.executed) {
    try { postRestartBaseline = pm2Sample().restarts; } catch { postRestartBaseline = sample.restarts + 1; }
  }
  atomicJson(STATE_FILE, {
    ...next, handledTriggerKey: triggerKey, rollbackResult: result,
    baselineRestarts: postRestartBaseline, overSinceMs: result.executed ? 0 : next.overSinceMs,
  });
  return { ...evaluated, handled: true, rollback: result };
}

async function main() {
  do {
    try { console.log(JSON.stringify(runOnce())); }
    catch (error) {
      console.error(JSON.stringify({ ok: false, code: String(error?.code || 'RSS_GUARD_FAILED'), message: String(error?.message || '').slice(0, 200) }));
    }
    if (LOOP) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  } while (LOOP);
}
main();
