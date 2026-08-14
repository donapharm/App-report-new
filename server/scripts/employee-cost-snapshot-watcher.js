#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { runLockedProcess } = require('../src/processLockRunner');
const fs = require('node:fs');

const activityMarker = process.env.APP_REPORT_ACTIVITY_MARKER || '';
function markActivity(activity) {
  if (!activityMarker || !path.isAbsolute(activityMarker)) return;
  fs.mkdirSync(path.dirname(activityMarker), { recursive: true });
  fs.writeFileSync(activityMarker, `${process.pid}|${new Date().toISOString()}|${String(activity).slice(0, 80)}\n`, { mode: 0o600 });
}
function clearActivity() {
  if (!activityMarker || !path.isAbsolute(activityMarker)) return;
  try {
    if (fs.readFileSync(activityMarker, 'utf8').startsWith(`${process.pid}|`)) fs.unlinkSync(activityMarker);
  } catch { /* absent or owned by another task */ }
}
process.on('exit', clearActivity);

const stateDir = process.env.EMPLOYEE_COST_WATCH_STATE_DIR;
const lockFile = process.env.EMPLOYEE_COST_WATCH_LOCK_FILE;
if (!stateDir || !path.isAbsolute(stateDir) || !lockFile || !path.isAbsolute(lockFile)) {
  console.error(JSON.stringify({ state: 'waiting', code: 'WATCHER_PATHS_REQUIRED' }));
  process.exitCode = 2;
} else if (process.env.EMPLOYEE_COST_WATCH_LOCK_HELD !== '1') {
  const result = runLockedProcess({
    lockFile, command: process.execPath, args: [__filename],
    env: { ...process.env, EMPLOYEE_COST_WATCH_LOCK_HELD: '1' },
  });
  if (result.contended) console.info(JSON.stringify({ state: 'waiting', code: 'WATCHER_LOCK_CONTENDED' }));
  process.exitCode = result.status;
} else {
  main().catch((error) => {
    console.error(JSON.stringify({ state: 'waiting', code: String(error?.code || 'WATCHER_FAILED').replace(/[^A-Z0-9_:-]/gi, '').slice(0, 80) }));
    process.exitCode = 2;
  });
}

async function deliverOneCeoNotification(outboxDir, recipient) {
  if (process.env.EMPLOYEE_COST_SNAPSHOT_WATCH_NOTIFY !== '1') return { delivered: false, reason: 'disabled' };
  if (String(recipient) !== '1748199545') return { delivered: false, reason: 'recipient_refused' };
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '');
  if (!token) return { delivered: false, reason: 'token_missing' };
  const files = require('node:fs').readdirSync(outboxDir).filter((name) => /^\d.*\.json$/.test(name)).sort();
  if (!files.length) return { delivered: false, reason: 'empty' };
  const fs = require('node:fs');
  const file = path.join(outboxDir, files[0]);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (String(payload.recipient) !== '1748199545' || !String(payload.text || '').trim()) return { delivered: false, reason: 'payload_refused' };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: '1748199545', text: payload.text, disable_notification: false }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { delivered: false, reason: `http_${response.status}` };
  const sentDir = path.join(outboxDir, 'sent'); fs.mkdirSync(sentDir, { recursive: true, mode: 0o700 });
  fs.renameSync(file, path.join(sentDir, files[0]));
  return { delivered: true, file: files[0] };
}

async function main() {
  const { createSnapshotWatcher, createCeoOutbox, CEO_TELEGRAM_ID } = require('../src/employeeCostSnapshotWatcher');
  const { observeT07Availability } = require('../src/employeeCostT07Observer');
  const routes = require('../src/routes');
  const runtime = routes.employeeCostSnapshotWatcherRuntime;
  if (!runtime) throw Object.assign(new Error('runtime missing'), { code: 'WATCHER_RUNTIME_MISSING' });
  const activeJobs = [];
  if (process.env.EMPLOYEE_COST_LOCAL_SNAPSHOT_SYNC_ENABLED === '1') activeJobs.push('snapshot-loop-enabled');
  if (process.env.EMPLOYEE_COST_ALL_WARM_DISABLED !== '1') activeJobs.push('warm-loop-enabled');
  if (process.env.EMPLOYEE_COST_CRON_DISABLED !== '1') activeJobs.push('cron-not-confirmed-disabled');
  if (process.env.EMPLOYEE_COST_SERVE_FROM_SNAPSHOT === '1') activeJobs.push('snapshot-serve-enabled');
  if (runtime.store.isPeriodBusy('2026-08')) activeJobs.push('snapshot-sync-active');
  const outboxDir = path.join(stateDir, 'outbox');
  const outbox = createCeoOutbox({
    root: outboxDir,
    enabled: process.env.EMPLOYEE_COST_SNAPSHOT_WATCH_NOTIFY === '1',
    recipient: CEO_TELEGRAM_ID,
  });
  const watchMode = process.env.EMPLOYEE_COST_SNAPSHOT_WATCH_MODE === 'sync' ? 'sync' : 'probe';
  markActivity(`employee-cost-snapshot:T08:${watchMode}`);
  const watcher = createSnapshotWatcher({
    period: '2026-08', mode: watchMode,
    statusFile: path.join(stateDir, 'status.json'), stateFile: path.join(stateDir, 'success.json'),
    rosterProvider: runtime.rosterProvider, probeEmployee: runtime.probeEmployee,
    dependencyIdentity: runtime.dependencyIdentity, readActiveJobs: () => activeJobs,
    syncOnce: (period, options) => runtime.sync.dongBoKy(period, options),
    readCurrent: (period, roster) => runtime.store.readCurrent(period, { roster }),
    capturePublicationState: (period) => runtime.store.capturePublicationState(period),
    cleanupFailedTarget: (period, captured, failedGenerationId) => runtime.store.restorePublicationState(period, captured, failedGenerationId),
    outbox,
  });
  const status = await watcher.run();
  markActivity('employee-cost-snapshot:T07:probe');
  const roster = await runtime.rosterProvider('2026-07');
  const t07Results = [];
  const depBefore = await runtime.dependencyIdentity('2026-07');
  for (const row of roster) {
    const empCode = String(row.emp_code || row.empCode || row).toUpperCase();
    try { t07Results.push({ empCode, ...await runtime.probeEmployee(empCode, { period: '2026-07', probeOnly: true, roster }) }); }
    catch { t07Results.push({ empCode, ok: false, sourceOutcome: 'upstream_unavailable' }); }
  }
  const depAfter = await runtime.dependencyIdentity('2026-07');
  const t07 = observeT07Availability({
    results: t07Results,
    dependencyStable: runtime.store.canonicalJson(depBefore) === runtime.store.canonicalJson(depAfter),
    markerFile: path.join(stateDir, 't07-priority.json'),
  });
  if (t07.state === 'open') outbox.enqueue({ type: 't07_source_ready', period: '2026-07', state: 'open' });
  markActivity('employee-cost-snapshot:CEO-notification');
  let notification = { delivered: false, reason: 'not_attempted' };
  try { notification = await deliverOneCeoNotification(outboxDir, CEO_TELEGRAM_ID); }
  catch { notification = { delivered: false, reason: 'delivery_failed' }; }
  if (notification.delivered && status.successKey) watcher.markNotified(status.successKey);
  console.info(JSON.stringify({ state: status.state, code: status.code || '', period: status.period, availableCount: status.probe?.availableCount || status.rosterCount || 0, t07State: t07.state, notification: notification.delivered ? 'delivered' : notification.reason }));
  process.exitCode = status.state === 'ready' ? 0 : 20;
}
