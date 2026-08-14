'use strict';

const fs = require('node:fs');
const path = require('node:path');

function atomicWrite(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function observeT07Availability({ results = [], dependencyStable = false, markerFile, now = () => new Date() } = {}) {
  const valid = results.filter((row) => row?.ok !== false
    && String(row?.sourceOutcome || row?.outcome || 'ok').toLowerCase() === 'ok'
    && String(row?.sourceRange?.from || row?.effectiveFrom || '') === '2026-07'
    && String(row?.sourceRange?.to || row?.effectiveTo || '') === '2026-07');
  const open = results.length === 21 && valid.length === 21 && dependencyStable === true;
  const marker = {
    schemaVersion: 1, observedAt: now().toISOString(), period: '2026-07',
    state: open ? 'open' : 'waiting', availableCount: valid.length, rosterCount: results.length,
    priority: open ? 'high' : 'normal', requestedAction: open ? 'fresh_seal_snapshot' : 'keep_observing',
    executed: false,
  };
  if (markerFile) atomicWrite(markerFile, marker);
  return marker;
}

module.exports = { observeT07Availability };
