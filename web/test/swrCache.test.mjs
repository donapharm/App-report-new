import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SWR_SCHEMA_VERSION, SWR_TTL_MS, clearSwrActor, readSwrCache,
  swrCacheKey, swrTimeLabel, validPayload, writeSwrCache,
} from '../src/swrCache.js';

class Storage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const overview = { revenue: 123, kys: ['07.2026'], privateRows: [] };
const trend = [{ ky: '07.2026', revenue: 123 }];

test('SWR namespace isolates actor, screen, period and schema without token or secret', () => {
  const a = swrCacheKey({ actor: { emp_code: 'CEO' }, screen: 'overview', period: { ky: '07.2026' } });
  const b = swrCacheKey({ actor: { emp_code: 'DN001' }, screen: 'overview', period: { ky: '07.2026' } });
  const c = swrCacheKey({ actor: { emp_code: 'CEO' }, screen: 'trend', period: { ky: '07.2026' } });
  const d = swrCacheKey({ actor: { emp_code: 'CEO' }, screen: 'overview', period: { ky: '08.2026' } });
  assert.equal(new Set([a, b, c, d]).size, 4);
  assert.match(a, new RegExp(`app-report:swr:v${SWR_SCHEMA_VERSION}`));
  assert.doesNotMatch(a, /token|secret|authorization/i);
});

test('read/write validates schema, TTL and payload shape', () => {
  const storage = new Storage();
  const spec = { actor: { emp_code: 'CEO' }, screen: 'overview', period: { ky: '07.2026' } };
  assert.equal(writeSwrCache(storage, spec, overview, 1_000), true);
  assert.deepEqual(readSwrCache(storage, spec, 1_001), { value: overview, savedAt: 1_000 });
  assert.equal(readSwrCache(storage, spec, 1_000 + SWR_TTL_MS + 1), null);
  assert.equal(validPayload('overview', { kys: [] }), false);
  assert.equal(validPayload('trend', trend), true);
  storage.setItem(swrCacheKey(spec), JSON.stringify({ schema: 999, screen: 'overview', savedAt: 1_000, value: overview }));
  assert.equal(readSwrCache(storage, spec, 1_001), null);
});

test('logout clears only current actor namespace and stale label contains exact wording', () => {
  const storage = new Storage();
  const ceo = { emp_code: 'CEO' };
  const employee = { emp_code: 'DN001' };
  writeSwrCache(storage, { actor: ceo, screen: 'overview', period: { ky: '07.2026' } }, overview, 1_000);
  writeSwrCache(storage, { actor: employee, screen: 'overview', period: { ky: '07.2026' } }, overview, 1_000);
  clearSwrActor(storage, ceo);
  assert.equal(storage.length, 1);
  assert.match(swrTimeLabel(Date.UTC(2026, 7, 13, 3, 5)), /^số lúc 10:05$/);
});

test('Overview renders cache before refresh and spinner only when no cached/current data', () => {
  const source = fs.readFileSync(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');
  assert.match(source, /setKpi\(cachedOverview\?\.value \|\| null\)/);
  assert.match(source, /setTrend\(cachedTrend\?\.value \|\| null\)/);
  assert.match(source, /Đang làm tươi · \{swrTimeLabel\(staleSnapshotAt\)\}/);
  assert.match(source, /!kpi \? <Spinner \/>/);
  assert.doesNotMatch(source, /setKpi\(null\)/, 'manual/background refresh must preserve current overview data');
  assert.doesNotMatch(source, /setTrend\(null\)/, 'manual/background refresh must preserve current trend data');
});

test('logout clears SWR for authenticated actor', () => {
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /const logout = \(\) => \{\s*clearSwrActor\(localStorage, me\)/);
});
