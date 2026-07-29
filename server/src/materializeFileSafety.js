const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function atomicWriteFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  let fd = null;
  try {
    const mode = fs.existsSync(file) ? (fs.statSync(file).mode & 0o777) : 0o644;
    fd = fs.openSync(tmp, 'wx', mode);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    try {
      const dirFd = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch { /* directory fsync is not supported on every platform */ }
  } catch (error) {
    if (fd != null) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function writeJsonAtomic(file, value) {
  atomicWriteFile(file, JSON.stringify(value, null, 2) + '\n');
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function readLock(file) {
  try {
    const stat = fs.statSync(file);
    let record = {};
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    return { record, stat };
  } catch { return null; }
}

function sameLock(left, right) {
  if (!left || !right) return false;
  if (left.record?.token && right.record?.token) return left.record.token === right.record.token;
  return left.stat.dev === right.stat.dev && left.stat.ino === right.stat.ino
    && left.stat.mtimeMs === right.stat.mtimeMs && left.stat.size === right.stat.size;
}

function lockedError() {
  const error = new Error('REVENUE_MATERIALIZE_ALREADY_RUNNING');
  error.code = 'REVENUE_MATERIALIZE_ALREADY_RUNNING';
  return error;
}

function acquireFileLock(lockFile, {
  staleMs = 15 * 60 * 1000,
  now = () => Date.now(),
  isPidAlive = processIsAlive,
} = {}) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const recoveryFile = `${lockFile}.recover`;
  const token = `${process.pid}:${now()}:${randomUUID()}`;

  const createOwner = () => {
    const fd = fs.openSync(lockFile, 'wx', 0o644);
    try {
      fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid, createdAt: new Date(now()).toISOString() }) + '\n', 'utf8');
      fs.fsyncSync(fd);
      return fd;
    } catch (error) {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(lockFile); } catch {}
      throw error;
    }
  };

  let fd;
  const existingRecovery = readLock(recoveryFile);
  if (existingRecovery) {
    const recoveryIsStale = now() - existingRecovery.stat.mtimeMs > staleMs;
    if (!recoveryIsStale || isPidAlive(existingRecovery.record?.pid)) throw lockedError();
    const recoveryClaim = `${recoveryFile}.stale-${token}`;
    const currentRecovery = readLock(recoveryFile);
    if (!sameLock(existingRecovery, currentRecovery)
      || now() - currentRecovery.stat.mtimeMs <= staleMs
      || isPidAlive(currentRecovery.record?.pid)) throw lockedError();
    try {
      fs.renameSync(recoveryFile, recoveryClaim);
      const claimedRecovery = readLock(recoveryClaim);
      // If identity changed between verification and rename, restore when safe
      // and fail closed rather than deleting another recovery owner's mutex.
      if (!sameLock(existingRecovery, claimedRecovery)) {
        try { fs.renameSync(recoveryClaim, recoveryFile); } catch {}
        throw lockedError();
      }
      fs.unlinkSync(recoveryClaim);
    } catch (error) {
      if (error.code === 'REVENUE_MATERIALIZE_ALREADY_RUNNING') throw error;
      throw lockedError();
    }
  }
  try {
    fd = createOwner();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const observed = readLock(lockFile);
    const stale = observed && now() - observed.stat.mtimeMs > staleMs;
    if (!stale || isPidAlive(observed?.record?.pid)) throw lockedError();

    // Only one contender may recover an orphan. Other compliant contenders see
    // this recovery lock and fail closed instead of renaming a new live owner.
    let recoveryFd;
    let ownsRecoveryFile = false;
    const recoveryToken = `${token}:recovery`;
    try {
      recoveryFd = fs.openSync(recoveryFile, 'wx', 0o644);
      ownsRecoveryFile = true;
      fs.writeFileSync(recoveryFd, JSON.stringify({ token: recoveryToken, pid: process.pid, createdAt: new Date(now()).toISOString() }) + '\n', 'utf8');
      fs.fsyncSync(recoveryFd);
    } catch {
      // We created this pathname with O_EXCL, so it cannot be another owner's
      // mutex. Remove it even when JSON write/fsync failed before a token was readable.
      if (ownsRecoveryFile) try { fs.unlinkSync(recoveryFile); } catch {}
      if (recoveryFd != null) try { fs.closeSync(recoveryFd); } catch {}
      throw lockedError();
    }

    const staleClaim = `${lockFile}.stale-${token}`;
    try {
      const current = readLock(lockFile);
      const stillStale = current && now() - current.stat.mtimeMs > staleMs;
      if (!sameLock(observed, current) || !stillStale || isPidAlive(current?.record?.pid)) throw lockedError();
      fs.renameSync(lockFile, staleClaim);
      try { fd = createOwner(); }
      finally { try { fs.unlinkSync(staleClaim); } catch {} }
    } finally {
      try { fs.closeSync(recoveryFd); } catch {}
      try {
        const recovery = JSON.parse(fs.readFileSync(recoveryFile, 'utf8'));
        if (recovery.token === recoveryToken) fs.unlinkSync(recoveryFile);
      } catch {}
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { fs.closeSync(fd); } catch {}
    try {
      const current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (current.token === token) fs.unlinkSync(lockFile);
    } catch {}
  };
}

module.exports = { atomicWriteFile, writeJsonAtomic, acquireFileLock, processIsAlive };
