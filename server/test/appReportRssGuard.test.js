'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const {
  RSS_THRESHOLD_BYTES, RSS_TRIGGER_MS, ROLLBACK_COMMIT, ROLLBACK_RELEASE,
  evaluateSample, validateRollbackRelease, executeRollback,
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
  assert.throws(() => executeRollback({ execute: '1', fs: fakeFs, execFileSync: (command) => {
    if (command === 'sha256sum') throw Object.assign(new Error('dirty release'), { code: 1 });
    return '';
  } }), /dirty release/);
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
  const result = executeRollback({
    execute: '1', fs: fakeFs, repoRoot: '/repo',
    execFileSync: (command, args) => {
      calls.push([command, args]);
      if (command === 'curl') return '{"status":"ok"}';
      return '';
    },
  });
  assert.equal(result.executed, true);
  assert.equal(links.get('/repo/current'), ROLLBACK_RELEASE);
  assert.ok(calls.some(([cmd, args]) => cmd === 'sha256sum' && args[0] === '-c'));
  assert.ok(calls.some(([cmd, args]) => cmd === 'pm2' && args.join(' ') === 'restart app-report --update-env'));
  assert.ok(!calls.some(([, args]) => args.includes('app-report-tgbot')));
});
