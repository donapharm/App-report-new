const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteFile, writeJsonAtomic, acquireFileLock } = require('../src/materializeFileSafety');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-materialize-safety-'));
}

test('atomic writer replaces complete content and leaves no temp file', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'upload_slots.json');
  atomicWriteFile(file, 'old\n');
  writeJsonAtomic(file, [{ id: 'new', active: true }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ id: 'new', active: true }]);
  assert.deepEqual(fs.readdirSync(dir), ['upload_slots.json']);
});

test('file lock rejects a concurrent materializer and releases cleanly', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'materialize.lock');
  const release = acquireFileLock(lock);
  assert.throws(() => acquireFileLock(lock), (error) => error.code === 'REVENUE_MATERIALIZE_ALREADY_RUNNING');
  release();
  const releaseAgain = acquireFileLock(lock);
  releaseAgain();
  assert.equal(fs.existsSync(lock), false);
});

test('stale orphan lock is recovered once but release never deletes another owner lock', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'materialize.lock');
  fs.writeFileSync(lock, JSON.stringify({ token: 'stale', pid: 99999999 }));
  fs.utimesSync(lock, new Date(0), new Date(0));
  const release = acquireFileLock(lock, { staleMs: 1000, isPidAlive: () => false });

  fs.unlinkSync(lock);
  fs.writeFileSync(lock, JSON.stringify({ token: 'new-owner' }));
  release();
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'new-owner');
  assert.equal(fs.existsSync(`${lock}.recover`), false);
});

test('old mtime never evicts a lock whose owner PID is still alive', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'materialize.lock');
  fs.writeFileSync(lock, JSON.stringify({ token: 'live', pid: process.pid }));
  fs.utimesSync(lock, new Date(0), new Date(0));
  assert.throws(
    () => acquireFileLock(lock, { staleMs: 1000 }),
    (error) => error.code === 'REVENUE_MATERIALIZE_ALREADY_RUNNING',
  );
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'live');
});

test('live recovery mutex makes contenders fail closed', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'materialize.lock');
  fs.writeFileSync(`${lock}.recover`, JSON.stringify({ token: 'recovering', pid: process.pid }));
  assert.throws(
    () => acquireFileLock(lock),
    (error) => error.code === 'REVENUE_MATERIALIZE_ALREADY_RUNNING',
  );
  assert.equal(fs.existsSync(lock), false);
});

test('stale recovery mutex owned by a dead PID is recovered safely', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'materialize.lock');
  const recovery = `${lock}.recover`;
  fs.writeFileSync(recovery, JSON.stringify({ token: 'dead-recovery', pid: 99999999 }));
  fs.utimesSync(recovery, new Date(0), new Date(0));
  const release = acquireFileLock(lock, { staleMs: 1000, isPidAlive: () => false });
  assert.equal(fs.existsSync(recovery), false);
  assert.equal(fs.existsSync(lock), true);
  release();
  assert.equal(fs.existsSync(lock), false);
});
