'use strict';

const path = require('path');
const { fork } = require('child_process');

const inFlight = new Map();
const TIMEOUT_MS = Math.max(30_000, Number(process.env.CATALOG_REFRESH_WORKER_TIMEOUT_MS || 180_000));

function refresh(period) {
  if (inFlight.has(period)) return inFlight.get(period);
  const task = new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'catalogRefreshWorkerChild.js'), [], {
      env: { ...process.env, CATALOG_REFRESH_WORKER_CHILD: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: ['--max-old-space-size=2048'],
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.connected) child.disconnect();
      if (!child.killed) child.kill('SIGTERM');
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(
      new Error(`Catalog refresh worker timeout sau ${TIMEOUT_MS}ms`),
      { status: 504, code: 'CATALOG_REFRESH_WORKER_TIMEOUT' },
    )), TIMEOUT_MS);
    child.once('message', (message = {}) => {
      if (message.ok) finish(null, message.result);
      else finish(Object.assign(new Error(message.error?.message || 'Catalog refresh worker failed'), {
        status: message.error?.status || 502,
        code: message.error?.code || 'CATALOG_REFRESH_WORKER_FAILED',
        upstream: message.error?.upstream === true,
      }));
    });
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      if (!settled) finish(Object.assign(new Error(`Catalog refresh worker exited ${code ?? signal}`), {
        status: 502, code: 'CATALOG_REFRESH_WORKER_EXIT',
      }));
    });
    child.unref();
    child.send({ period }, (error) => { if (error) finish(error); });
  }).finally(() => inFlight.delete(period));
  inFlight.set(period, task);
  return task;
}

module.exports = { refresh, _inFlightSizeForTests: () => inFlight.size };
