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

function fileDigest(file, fsImpl = fs) {
  const hash = require('crypto').createHash('sha256');
  const fd = fsImpl.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = fsImpl.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally { fsImpl.closeSync(fd); }
  return hash.digest('hex');
}
function verifyReleaseManifest(release, manifest, fsImpl = fs) {
  const expected = new Map();
  for (const line of fsImpl.readFileSync(manifest, 'utf8').split('\n').filter(Boolean)) {
    const parts = line.split('|');
    if (parts.length !== 5 || !/^\.\/[A-Za-z0-9._/@+-]+(?:\/[A-Za-z0-9._/@+-]+)*$/.test(parts[1]) || parts[1].includes('/../')) {
      throw new Error('Rollback manifest format invalid');
    }
    if (expected.has(parts[1])) throw new Error('Rollback manifest duplicate path');
    expected.set(parts[1], parts);
  }
  if (!expected.size) throw new Error('Rollback manifest empty');
  const expectedRoot = [...expected.keys()].filter((item) => !item.slice(2).includes('/')).map((item) => item.slice(2)).sort();
  const actualRoot = fsImpl.readdirSync(release).filter((name) => name !== path.basename(manifest)).sort();
  if (JSON.stringify(actualRoot) !== JSON.stringify(expectedRoot)) throw new Error('Rollback manifest root mismatch');
  for (const [relative, row] of expected) {
    const file = path.join(release, relative);
    const stat = fsImpl.lstatSync(file);
    const type = stat.isSymbolicLink() ? 'l' : stat.isDirectory() ? 'd' : stat.isFile() ? 'f' : '?';
    const mode = (stat.mode & 0o7777).toString(8);
    const owner = `${stat.uid}:${stat.gid}`;
    const identity = type === 'l' ? fsImpl.readlinkSync(file) : type === 'd' ? '-' : type === 'f' ? fileDigest(file, fsImpl) : '?';
    if (row[0] !== type || row[2] !== mode || row[3] !== owner || row[4] !== identity) {
      throw new Error(`Rollback manifest mismatch: ${relative}`);
    }
    const strictRuntimeRoots = ['./server/src', './server/scripts', './server/node_modules', './web/dist'];
    if (type === 'd' && strictRuntimeRoots.some((root) => relative === root || relative.startsWith(`${root}/`))) {
      const prefix = `${relative}/`;
      const expectedChildren = [...expected.keys()].filter((item) => item.startsWith(prefix) && !item.slice(prefix.length).includes('/'))
        .map((item) => item.slice(prefix.length)).sort();
      const actualChildren = fsImpl.readdirSync(file).filter((name) => path.join(relative, name) !== './release_manifest.sha256').sort();
      if (JSON.stringify(actualChildren) !== JSON.stringify(expectedChildren)) {
        throw new Error(`Rollback manifest directory mismatch: ${relative}`);
      }
    }
  }
  return { entries: expected.size };
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
  (options.verifyManifest || verifyReleaseManifest)(validated.release, validated.manifest, fsImpl);
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
  evaluateSample, validateRollbackRelease, verifyReleaseManifest, executeRollback,
};
