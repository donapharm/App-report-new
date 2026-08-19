'use strict';

const os = require('os');
const zlib = require('zlib');
const employeeCost = require('./employeeCost');

try { os.setPriority(0, 19); } catch { /* best effort */ }

process.on('message', ({ id, action, payload, options }) => {
  try {
    if (action !== 'enrichRangePayload') throw new Error(`Unsupported employee-cost CPU action: ${action}`);
    const value = employeeCost.enrichRangePayload(payload, options || {});
    const encoded = zlib.gzipSync(Buffer.from(JSON.stringify(value)), { level: 1 });
    if (process.send) process.send({ id, encoded });
  } catch (error) {
    if (process.send) process.send({ id, error: { message: error?.message || String(error), code: error?.code || null } });
  }
});
