'use strict';

const { spawnSync } = require('node:child_process');

const DEFAULT_CONFLICT_EXIT_CODE = 75;

/**
 * Chạy một process dưới advisory lock của hệ điều hành. `flock` giữ lock trong
 * suốt đời process con; process chết/killed thì kernel tự nhả, không có stale lock.
 */
function runLockedProcess({
  lockFile,
  command,
  args = [],
  env = process.env,
  conflictExitCode = DEFAULT_CONFLICT_EXIT_CODE,
  spawn = spawnSync,
} = {}) {
  if (!lockFile || !command) throw new Error('Thiếu lockFile/command');
  const result = spawn('flock', [
    '-n', '-E', String(conflictExitCode), lockFile,
    command, ...args,
  ], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status === conflictExitCode) return { contended: true, status: 0 };
  return { contended: false, status: Number.isInteger(result.status) ? result.status : 1, signal: result.signal || null };
}

module.exports = { DEFAULT_CONFLICT_EXIT_CODE, runLockedProcess };
