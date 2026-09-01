'use strict';

const os = require('os');
const catalogManagement = require('./catalogManagement');

try { os.setPriority(0, 19); } catch { /* best effort */ }

process.once('message', async ({ period } = {}) => {
  try {
    const result = await catalogManagement.refreshAndPersistForWorker(period);
    if (process.send) process.send({ ok: true, result });
  } catch (error) {
    if (process.send) process.send({ ok: false, error: {
      message: error?.message || String(error), code: error?.code || null,
      status: error?.status || 502, upstream: error?.upstream === true,
    } });
  }
});
