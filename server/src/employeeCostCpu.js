'use strict';

const path = require('path');
const zlib = require('zlib');
const { fork } = require('child_process');

let child = null;
let nextId = 1;
let idleTimer = null;
const pending = new Map();

function rejectAll(error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function rejectChild(spawned, error) {
  for (const [id, entry] of pending.entries()) {
    if (entry.child !== spawned) continue;
    pending.delete(id);
    entry.reject(error);
  }
}

function armIdleStop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size || !child) return;
    const old = child;
    child = null;
    old.kill('SIGTERM');
  }, 20_000);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

function getChild() {
  if (child) return child;
  const spawned = fork(path.join(__dirname, 'employeeCostCpuWorker.js'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
  });
  child = spawned;
  spawned.on('message', ({ id, encoded, error }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) {
      entry.reject(Object.assign(new Error(error.message), { code: error.code }));
      armIdleStop();
      return;
    }
    zlib.gunzip(Buffer.from(encoded), (zipError, decoded) => {
      if (zipError) entry.reject(zipError);
      else {
        try { entry.resolve(JSON.parse(decoded.toString('utf8'))); }
        catch (parseError) { entry.reject(parseError); }
      }
      armIdleStop();
    });
  });
  spawned.on('error', (error) => { rejectChild(spawned, error); if (child === spawned) child = null; });
  spawned.on('exit', (code) => {
    if (child === spawned) child = null;
    rejectChild(spawned, new Error(`Employee-cost CPU worker exited ${code}`));
  });
  spawned.unref();
  return spawned;
}

function enrichRangePayload(payload, options) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const activeChild = getChild();
    pending.set(id, { resolve, reject, child: activeChild });
    activeChild.send({ id, action: 'enrichRangePayload', payload, options });
  });
}

module.exports = { enrichRangePayload };
