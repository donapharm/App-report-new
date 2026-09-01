'use strict';

const fs = require('node:fs');
const path = require('node:path');
const schedule = require('./debtsRevenueSchedule');
const policy = require('./groupDonaRevenuePolicy');
const catalogMapping = require('./debtsCatalogMapping');
const shadow = require('./debtsInvoiceShadow');
const cutover = require('./debtsRevenueCutover');
const slot = require('./debtsRevenueSlot');
const shadowService = require('./debtsShadowService');

const state = { started: false, timer: null, inFlight: false, lastSlot: '', lastRun: null, lastSkip: null };
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function uiPeriod(period) { return `${period.slice(5)}.${period.slice(0, 4)}`; }
function currentPeriod(now = new Date()) { return schedule.vnParts(now).period; }
function readCurrentRows(dataDir, period) {
  const registry = JSON.parse(fs.readFileSync(path.join(dataDir, 'upload_slots.json'), 'utf8'));
  if (!Array.isArray(registry)) fail('DEBTS_SLOT_REGISTRY_INVALID');
  const active = registry.find((item) => item.ky === uiPeriod(period) && item.active);
  if (!active) return [];
  const file = path.join(dataDir, 'uploads', `${active.id}.json`);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) fail('DEBTS_SLOT_ACTIVE_ROWS_INVALID');
  return rows;
}

async function runOnce({ force = false, reason = 'manual', now = new Date(), env = process.env, fetchImpl = globalThis.fetch,
  dataDir = shadowService.DATA_DIR, deps = {} } = {}) {
  if (state.inFlight) return { ok: false, skipped: true, reason: 'in_flight' };
  const due = schedule.isDue(now, env);
  if (!force && !due.due) return { ok: false, skipped: true, ...due };
  const period = currentPeriod(now);
  if (!policy.isCutoverPeriod(period)) fail('DEBTS_REVENUE_CUTOVER_PERIOD_BLOCKED');
  const cfg = shadowService.config(env);
  const ready = shadowService.readiness(env, { requireMapping: false });
  if (!ready.publishReady) fail('DEBTS_REVENUE_JOB_NOT_READY');
  state.inFlight = true;
  const run = { ok: false, reason, period, startedAt: new Date().toISOString() };
  try {
    const getSnapshot = deps.getCatalogSnapshot || require('./catalogManagement').getSnapshot;
    const fetchPages = deps.fetchSnapshotPages || shadow.fetchSnapshotPages;
    const materialize = deps.materializeShadow || shadow.materializeShadow;
    const publishShadow = deps.publishShadow || shadow.publishShadow;
    const verifyShadow = deps.verifyPublishedShadow || shadow.verifyPublishedShadow;
    const publishSlot = deps.publishSlot || slot.publish;
    const loadPartnerRows = deps.loadPartnerRows || require('./debtsPartnerRevenue').load;
    const catalog = await getSnapshot(period);
    const mapping = catalogMapping.build(catalog, period);
    const staged = {};
    for (const legalEntity of ['DONA', 'AFP']) {
      const combined = await fetchPages({ endpoint: cfg.endpoint, token: cfg.token, period, legalEntity, lockedPeriods: [shadow.HARD_BLOCKED_PERIOD], fetchImpl });
      staged[legalEntity] = materialize(combined, mapping, { codeRevision: 'debts-t09-catalog-direct-v1' });
    }
    const payload = cutover.build({ period, partitions: staged });
    const partner = await loadPartnerRows(period, { env });
    if (!partner || !Array.isArray(partner.rows) || partner.rows.some((row) => String(row.source || '').toUpperCase() !== 'APP_WEB_PARTNER')) fail('PARTNER_REVENUE_RESULT_INVALID');
    const verified = {};
    for (const legalEntity of ['DONA', 'AFP']) {
      const target = publishShadow(staged[legalEntity], { dataDir: cfg.dataDir, allowWrite: true,
        receiptSigningKey: cfg.receiptSigningKey, receiptSigningKeyId: cfg.receiptSigningKeyId });
      verified[legalEntity] = verifyShadow(target, { receiptSigningKey: cfg.receiptSigningKey, receiptSigningKeyId: cfg.receiptSigningKeyId });
    }
    const verifiedPayload = cutover.build({ period, partitions: verified });
    if (verifiedPayload.rowsChecksum !== payload.rowsChecksum) fail('DEBTS_REVENUE_VERIFY_DRIFT');
    const composed = slot.compose({ period, currentRows: partner.rows, debts: verifiedPayload });
    run.publish = publishSlot(composed, { dataDir }); run.rowCount = verifiedPayload.rowCount;
    run.partnerRowCount = partner.rows.length; run.rowsChecksum = verifiedPayload.rowsChecksum; run.finishedAt = new Date().toISOString(); run.ok = true; state.lastRun = run;
    return Object.freeze(run);
  } catch (error) {
    run.finishedAt = new Date().toISOString(); run.error = String(error?.code || error?.message || error); state.lastRun = run; throw error;
  } finally { state.inFlight = false; }
}

function tick(now = new Date()) {
  const due = schedule.isDue(now);
  if (!due.due) { state.lastSkip = { at: new Date().toISOString(), ...due }; return; }
  if (due.slot === state.lastSlot) return;
  state.lastSlot = due.slot;
  runOnce({ force: true, reason: `schedule:${due.slot}`, now }).catch((error) => console.error('[debts-revenue] failed; previous slot remains active', String(error?.code || error?.message || error)));
}
function start() {
  if (state.started) return; state.started = true;
  if (!schedule.enabled()) { console.log('[debts-revenue] disabled'); return; }
  state.timer = setInterval(() => tick(), 60 * 1000); state.timer.unref?.(); console.log('[debts-revenue] scheduler armed', JSON.stringify(schedule.config())); tick();
}
function status() { return { ...schedule.config(), inFlight: state.inFlight, lastSlot: state.lastSlot, lastRun: state.lastRun, lastSkip: state.lastSkip }; }

module.exports = { currentPeriod, readCurrentRows, runOnce, tick, start, status, _state: state };
