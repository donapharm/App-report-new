'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RSS_THRESHOLD_BYTES = 1932735283; // 1.8 GiB
const RSS_TRIGGER_MS = 10 * 60 * 1000;
const ROLLBACK_COMMIT = '3a3a47d8ac2634ffd0bdecfb46f71db24667a823';
const FORBIDDEN_ROLLBACK = '7870f10';
const ROLLBACK_RELEASE = '/home/osboxes/.openclaw/workspace-report/App-report/.staging/release-app-report-3a3a47d-20260813-085826';

function evaluateSample(previous = {}, sample = {}) {
  const atMs = Number(sample.atMs || Date.now());
  const rssBytes = Number(sample.rssBytes || 0);
  const restarts = Number(sample.restarts || 0);
  const baselineRestarts = Number.isFinite(Number(previous.baselineRestarts))
    ? Number(previous.baselineRestarts) : restarts;
  const over = rssBytes > RSS_THRESHOLD_BYTES;
  const overSinceMs = over ? Number(previous.overSinceMs || atMs) : 0;
  const continuousMs = over ? Math.max(0, atMs - overSinceMs) : 0;
  let trigger = '';
  if (sample.numericMismatch === true) trigger = 'NUMERIC_MISMATCH';
  else if (sample.unexpectedOom === true || restarts > baselineRestarts) trigger = 'OOM_OR_UNEXPECTED_RESTART';
  else if (over && continuousMs > RSS_TRIGGER_MS) trigger = 'RSS_OVER_1_8_GIB_10_MIN';
  return {
    baselineRestarts, overSinceMs, continuousMs, trigger,
    peak: over, lastAtMs: atMs, lastRssBytes: rssBytes,
    lastPid: Number(sample.pid || 0), lastRestarts: restarts,
  };
}

function validateRollbackRelease(release = ROLLBACK_RELEASE, fsImpl = fs) {
  const resolved = fsImpl.realpathSync(release);
  if (resolved.includes(FORBIDDEN_ROLLBACK)) throw new Error('Forbidden rollback target 7870f10');
  const commit = fsImpl.readFileSync(path.join(resolved, 'RELEASE_COMMIT'), 'utf8').trim();
  if (commit !== ROLLBACK_COMMIT) throw new Error(`Rollback commit mismatch: ${commit}`);
  const manifest = path.join(resolved, 'release_manifest.sha256');
  if (!fsImpl.statSync(manifest).isFile()) throw new Error('Rollback release manifest missing');
  return { release: resolved, commit, manifest };
}

function executeRollback(options = {}) {
  if (String(options.execute ?? process.env.APP_REPORT_RSS_GUARD_EXECUTE ?? '') !== '1') {
    return { executed: false, reason: 'EXECUTE_FLAG_OFF' };
  }
  const fsImpl = options.fs || fs;
  const exec = options.execFileSync || execFileSync;
  const repoRoot = options.repoRoot || '/home/osboxes/.openclaw/workspace-report/App-report';
  const current = path.join(repoRoot, 'current');
  const validated = validateRollbackRelease(options.release || ROLLBACK_RELEASE, fsImpl);
  exec('sha256sum', ['-c', validated.manifest], { cwd: validated.release, stdio: 'ignore' });
  const before = fsImpl.realpathSync(current);
  const temp = `${current}.rollback-${process.pid}-${Date.now()}`;
  fsImpl.symlinkSync(validated.release, temp);
  fsImpl.renameSync(temp, current);
  try {
    exec('pm2', ['restart', 'app-report', '--update-env'], { stdio: 'ignore' });
  } catch (error) {
    const restore = `${current}.restore-${process.pid}-${Date.now()}`;
    try { fsImpl.symlinkSync(before, restore); fsImpl.renameSync(restore, current); } catch { /* operator intervention */ }
    throw error;
  }
  const local = String(exec('curl', ['-fsS', '--max-time', '20', 'http://127.0.0.1:3000/api/health'], { encoding: 'utf8' }) || '');
  const publicHealth = String(exec('curl', ['-fsS', '--max-time', '20', 'https://report.donapharm.asia/api/health'], { encoding: 'utf8' }) || '');
  return { executed: true, before, after: validated.release, commit: validated.commit, localOk: /ok/i.test(local), publicOk: /ok/i.test(publicHealth) };
}

module.exports = {
  RSS_THRESHOLD_BYTES, RSS_TRIGGER_MS, ROLLBACK_COMMIT, FORBIDDEN_ROLLBACK, ROLLBACK_RELEASE,
  evaluateSample, validateRollbackRelease, executeRollback,
};
