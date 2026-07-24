'use strict';

const { parentPort, workerData } = require('worker_threads');

async function main() {
  const routes = require('./routes');
  const result = await routes.__buildEmployeeCostAllWarmBase(workerData?.query || {});
  // Bonus resolvers are build-time closures and are not part of the JSON API
  // contract. Serialize once in the worker to drop functions/undefined values
  // before crossing the structured-clone boundary.
  const jsonSafeResult = JSON.parse(JSON.stringify(result));
  parentPort.postMessage({ ok: true, result: jsonSafeResult });
  parentPort.close();
}

main().catch((error) => {
  parentPort.postMessage({
    ok: false,
    error: { message: String(error?.message || error), stack: String(error?.stack || '') },
  });
  parentPort.close();
});
