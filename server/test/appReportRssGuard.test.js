'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const {
  RSS_THRESHOLD_BYTES, RSS_TRIGGER_MS, ROLLBACK_COMMIT, ROLLBACK_RELEASE,
  evaluateSample, validateRollbackRelease, verifyReleaseManifest, executeRollback,
} = require('../src/appReportRssGuard');

test('RSS must remain over 1.8 GiB continuously for more than ten minutes', () => {
  const start = 1_000_000;
  let state = evaluateSample({}, { atMs: start, rssBytes: RSS_THRESHOLD_BYTES + 1, restarts: 3, pid: 1 });
  assert.equal(state.trigger, '');
  state = evaluateSample(state, { atMs: start + RSS_TRIGGER_MS - 1, rssBytes: RSS_THRESHOLD_BYTES + 1, restarts: 3, pid: 1 });
  assert.equal(state.trigger, '');
  state = evaluateSample(state, { atMs: start + RSS_TRIGGER_MS, rssBytes: RSS_THRESHOLD_BYTES + 1, restarts: 3, pid: 1 });
  assert.equal(state.trigger, '');
  state = evaluateSample(state, { atMs: start + RSS_TRIGGER_MS + 1, rssBytes: RSS_THRESHOLD_BYTES + 1, restarts: 3, pid: 1 });
  assert.equal(state.trigger, 'RSS_OVER_1_8_GIB_10_MIN');
  const reset = evaluateSample(state, { atMs: start + RSS_TRIGGER_MS + 1, rssBytes: RSS_THRESHOLD_BYTES, restarts: 3, pid: 1 });
  assert.equal(reset.overSinceMs, 0);
});

test('new restart/OOM and numeric mismatch are independent rollback triggers', () => {
  const base = evaluateSample({}, { atMs: 1, rssBytes: 1, restarts: 7 });
  assert.equal(evaluateSample(base, { atMs: 2, rssBytes: 1, restarts: 8 }).trigger, 'OOM_OR_UNEXPECTED_RESTART');
  assert.equal(evaluateSample(base, { atMs: 2, rssBytes: 1, restarts: 7, numericMismatch: true }).trigger, 'NUMERIC_MISMATCH');
});

test('rollback is inert unless execute flag is exactly 1', () => {
  assert.deepEqual(executeRollback({ execute: '0' }), { executed: false, reason: 'EXECUTE_FLAG_OFF' });
  assert.deepEqual(executeRollback({ execute: '' }), { executed: false, reason: 'EXECUTE_FLAG_OFF' });
});

test('rollback validation accepts only exact 3a3a47d release and forbids 7870', () => {
  const files = new Map([
    [path.join(ROLLBACK_RELEASE, 'RELEASE_COMMIT'), `${ROLLBACK_COMMIT}\n`],
    [path.join(ROLLBACK_RELEASE, 'release_manifest.sha256'), 'manifest'],
  ]);
  const fakeFs = {
    realpathSync: (value) => value,
    readFileSync: (value) => files.get(value),
    statSync: () => ({ isFile: () => true }),
  };
  assert.equal(validateRollbackRelease(ROLLBACK_RELEASE, fakeFs).commit, ROLLBACK_COMMIT);
  assert.throws(() => validateRollbackRelease('/tmp/7870f10-release', fakeFs), /7870f10/);
  const wrongFs = { ...fakeFs, readFileSync: () => '7870f10\n' };
  assert.throws(() => validateRollbackRelease(ROLLBACK_RELEASE, wrongFs), /mismatch/);
});

test('rollback refuses nonexistent and manifest-dirty releases before pointer swap', () => {
  assert.throws(() => validateRollbackRelease('/missing/release', { realpathSync: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }), /missing/);
  const fakeFs = {
    realpathSync: (value) => value,
    readFileSync: () => `${ROLLBACK_COMMIT}\n`,
    statSync: () => ({ isFile: () => true }),
  };
  assert.throws(() => executeRollback({
    execute: '1', fs: fakeFs,
    verifyManifest: () => { throw new Error('dirty release'); },
  }), /dirty release/);
});

test('custom release manifest verifies content, metadata, links and rejects drift', (t) => {
  const os = require('os'); const crypto = require('crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'server', 'src'), { recursive: true }); fs.writeFileSync(path.join(root, 'server', 'src', 'app.js'), 'safe\n', { mode: 0o640 });
  fs.symlinkSync('server/src/app.js', path.join(root, 'current-file'));
  const rows = ['./current-file', './server', './server/src', './server/src/app.js'].map((relative) => {
    const stat = fs.lstatSync(path.join(root, relative));
    const type = stat.isSymbolicLink() ? 'l' : stat.isDirectory() ? 'd' : 'f';
    const identity = type === 'l' ? fs.readlinkSync(path.join(root, relative)) : type === 'd' ? '-'
      : crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    return `${type}|${relative}|${(stat.mode & 0o7777).toString(8)}|${stat.uid}:${stat.gid}|${identity}`;
  });
  const manifest = path.join(root, 'release_manifest.sha256'); fs.writeFileSync(manifest, `${rows.join('\n')}\n`);
  assert.equal(verifyReleaseManifest(root, manifest).entries, 4);
  fs.appendFileSync(path.join(root, 'server', 'src', 'app.js'), 'drift');
  assert.throws(() => verifyReleaseManifest(root, manifest), /mismatch/);
  fs.writeFileSync(path.join(root, 'server', 'src', 'app.js'), 'safe\n', { mode: 0o640 });
  fs.writeFileSync(path.join(root, 'server', 'src', 'evil.js'), 'extra');
  assert.throws(() => verifyReleaseManifest(root, manifest), /directory mismatch/);
  fs.unlinkSync(path.join(root, 'server', 'src', 'evil.js'));
  fs.writeFileSync(path.join(root, 'evil-root.js'), 'extra');
  assert.throws(() => verifyReleaseManifest(root, manifest), /root mismatch/);
});

test('runner distinguishes observe/execute triggers and resets restart baseline after rollback', () => {
  const source = fs.readFileSync(require.resolve('../scripts/watch_app_report_rss'), 'utf8');
  assert.match(source, /triggerKey = `\$\{evaluated\.trigger\}:\$\{executeMode\}`/);
  assert.match(source, /postRestartBaseline = pm2Sample\(\)\.restarts/);
  assert.match(source, /baselineRestarts: postRestartBaseline/);
  assert.match(source, /overSinceMs: result\.executed \? 0/);
});

test('execute path verifies manifest, swaps atomically, restarts app only and smokes health', () => {
  const calls = []; const links = new Map([['/repo/current', '/release/live']]);
  const files = new Map([
    [path.join(ROLLBACK_RELEASE, 'RELEASE_COMMIT'), `${ROLLBACK_COMMIT}\n`],
    [path.join(ROLLBACK_RELEASE, 'release_manifest.sha256'), 'manifest'],
  ]);
  const fakeFs = {
    realpathSync: (value) => links.get(value) || value,
    readFileSync: (value) => files.get(value),
    statSync: () => ({ isFile: () => true }),
    symlinkSync: (target, file) => links.set(file, target),
    renameSync: (from, to) => { links.set(to, links.get(from)); links.delete(from); },
  };
  let verified = false;
  const result = executeRollback({
    execute: '1', fs: fakeFs, repoRoot: '/repo',
    verifyManifest: () => { verified = true; return { entries: 1 }; },
    execFileSync: (command, args) => {
      calls.push([command, args]);
      if (command === 'curl') return '{"status":"ok"}';
      return '';
    },
  });
  assert.equal(result.executed, true);
  assert.equal(links.get('/repo/current'), ROLLBACK_RELEASE);
  assert.equal(verified, true);
  assert.ok(calls.some(([cmd, args]) => cmd === 'pm2' && args.join(' ') === 'restart app-report --update-env'));
  assert.ok(!calls.some(([, args]) => args.includes('app-report-tgbot')));
});
