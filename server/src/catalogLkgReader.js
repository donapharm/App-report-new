'use strict';

/**
 * Đọc/JSON.parse/kiểm hợp đồng catalog LKG ở worker thread.
 *
 * File production hiện hơn 400 MB. Làm việc này trên main thread từng khiến
 * /api/health im lặng hàng chục giây và watchdog restart cả app. Một worker dùng
 * chung cho cả chùm kỳ để file lớn chỉ được parse một lần; snapshot từng kỳ được
 * gửi về main thread, còn bản monolith được worker tự thả theo TTL sẵn có.
 */
const path = require('path');
const { fork } = require('child_process');
const zlib = require('zlib');

let worker = null;
let nextId = 1;
let idleTimer = null;
const pending = new Map();

function armIdleStop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size || !worker) return;
    const old = worker;
    worker = null;
    old.kill('SIGTERM');
  }, 20_000);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

function rejectAll(error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function rejectWorker(spawned, error) {
  for (const [id, entry] of pending.entries()) {
    if (entry.worker !== spawned) continue;
    pending.delete(id);
    entry.reject(error);
  }
}

function getWorker() {
  if (worker) return worker;
  const spawned = fork(path.join(__dirname, 'catalogLkgReaderWorker.js'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
  });
  worker = spawned;
  spawned.on('message', ({ id, encoded, format, error }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) {
      entry.reject(Object.assign(new Error(error.message), { code: error.code }));
      armIdleStop();
      return;
    }
    zlib.gunzip(Buffer.from(encoded), async (zipError, decoded) => {
      if (zipError) entry.reject(zipError);
      else {
        try {
          if (format === 'ndjson') {
            const lines = decoded.toString('utf8').split('\n');
            const rows = [];
            for (let start = 0; start < lines.length; start += 500) {
              for (const line of lines.slice(start, start + 500)) if (line) rows.push(JSON.parse(line));
              await new Promise((resolve) => setImmediate(resolve));
            }
            entry.resolve(rows);
          } else entry.resolve(JSON.parse(decoded.toString('utf8')));
        }
        catch (parseError) { entry.reject(parseError); }
      }
      armIdleStop();
    });
  });
  spawned.on('error', (error) => {
    rejectWorker(spawned, error);
    if (worker === spawned) worker = null;
  });
  spawned.on('exit', (code) => {
    if (worker === spawned) worker = null;
    rejectWorker(spawned, new Error(`Catalog LKG worker exited ${code}`));
  });
  spawned.unref();
  return spawned;
}

function read(period, projection = 'snapshot') {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    pending.set(id, { resolve, reject, worker: activeWorker });
    activeWorker.send({ id, period, projection });
  });
}

module.exports = { read };
