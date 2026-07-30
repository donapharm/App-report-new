function abortError() {
  if (typeof DOMException === 'function') return new DOMException('Request cancelled', 'AbortError');
  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  return error;
}

export function requestScopeKey({ method = 'GET', path = '', authScope = 'ANON', deviceId = '', dataSignature = '', body = '' } = {}) {
  // Every cache/coalescing key is bound to an opaque local auth generation,
  // device, backend data generation and full query. Never retain a bearer token
  // inside cache keys; CEO and employee payloads still cannot share an entry.
  return [method, path, authScope, deviceId || 'NO_DEVICE', dataSignature || 'NO_DATA_SIGNATURE', body || ''].join('\u001f');
}

export class RequestCoordinator {
  constructor({ maxEntries = 12, now = () => Date.now() } = {}) {
    this.maxEntries = Math.max(1, maxEntries);
    this.now = now;
    this.cache = new Map();
    this.inFlight = new Map();
    this.generation = 0;
  }

  clear() {
    this.generation += 1;
    this.cache.clear();
    for (const entry of this.inFlight.values()) entry.controller.abort();
    this.inFlight.clear();
  }

  invalidateCache() {
    this.generation += 1;
    this.cache.clear();
  }

  setCached(key, value, at = this.now()) {
    this.cache.delete(key);
    this.cache.set(key, { at, value });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
  }

  cached(key, maxAgeMs) {
    const hit = this.cache.get(key);
    if (!hit || maxAgeMs <= 0 || this.now() - hit.at > maxAgeMs) return undefined;
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit.value;
  }

  run(key, loader, { cacheMs = 0, signal } = {}) {
    const cached = this.cached(key, cacheMs);
    if (cached !== undefined) return Promise.resolve(cached);

    let entry = this.inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const generation = this.generation;
      entry = { controller, consumers: new Set(), settled: false, promise: null };
      entry.promise = Promise.resolve()
        .then(() => loader(controller.signal))
        .then((value) => {
          if (cacheMs > 0 && generation === this.generation && !controller.signal.aborted) this.setCached(key, value);
          return value;
        })
        .finally(() => {
          entry.settled = true;
          if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
        });
      // A consumer wrapper observes rejection; keep the shared promise from
      // becoming an unhandled rejection when every consumer cancels.
      entry.promise.catch(() => {});
      this.inFlight.set(key, entry);
    }

    const consumer = {};
    entry.consumers.add(consumer);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        signal?.removeEventListener?.('abort', onAbort);
        entry.consumers.delete(consumer);
        fn(value);
      };
      const onAbort = () => {
        finish(reject, abortError());
        if (!entry.settled && entry.consumers.size === 0) entry.controller.abort();
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      entry.promise.then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
  }
}

export function createLatestRequestGate() {
  let sequence = 0;
  let controller = null;
  return {
    next() {
      controller?.abort();
      controller = new AbortController();
      const currentController = controller;
      const id = ++sequence;
      return {
        id,
        signal: currentController.signal,
        isLatest: () => id === sequence && controller === currentController && !currentController.signal.aborted,
      };
    },
    cancel() { controller?.abort(); controller = null; sequence += 1; },
  };
}
