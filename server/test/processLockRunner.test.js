'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { runLockedProcess, DEFAULT_CONFLICT_EXIT_CODE } = require('../src/processLockRunner');

function waitExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function waitForFile(file, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (fs.existsSync(file)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error('worker không tạo marker đúng hạn');
}

test('hai process chồng nhau: lượt hai bị chặn, sau khi lượt một xong thì chạy được', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-report-flock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'runner.lock');
  const marker = path.join(dir, 'started');
  const worker = path.join(dir, 'worker.js');
  fs.writeFileSync(worker, `require('fs').writeFileSync(process.argv[2], 'started'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);`);

  const first = spawn('flock', ['-n', '-E', String(DEFAULT_CONFLICT_EXIT_CODE), lock, process.execPath, worker, marker], { stdio: 'ignore' });
  waitForFile(marker);
  const second = runLockedProcess({ lockFile: lock, command: process.execPath, args: ['-e', 'process.exit(0)'], spawn: (cmd, args, options) => spawnSync(cmd, args, { ...options, stdio: 'ignore' }) });
  assert.deepEqual(second, { contended: true, status: 0 });
  assert.deepEqual(await waitExit(first), { code: 0, signal: null });
  const third = runLockedProcess({ lockFile: lock, command: process.execPath, args: ['-e', 'process.exit(0)'], spawn: (cmd, args, options) => spawnSync(cmd, args, { ...options, stdio: 'ignore' }) });
  assert.deepEqual(third, { contended: false, status: 0, signal: null });
});
