'use strict';

const fs = require('node:fs');
const path = require('node:path');
const schedule = require('./debtsRevenueSchedule');
const policy = require('./groupDonaRevenuePolicy');
const catalogMapping = require('./debtsCatalogMapping');
const shadow = require('./debtsInvoiceShadow');
const cutover = require('./debtsRevenueCutover');
const slot = require('./debtsRevenueSlot');
const coordinator = require('./revenuePartitionCoordinator');
const shadowService = require('./debtsShadowService');
const incident = require('./revenueSyncIncident');
const persist = require('./persist');

const MONITOR_STATE = 'revenue_sync_monitor_state';

const state = { started: false, timer: null, inFlight: false, lastSlot: '', lastRun: null, lastSkip: null, lastSuccessSlot: '', handledWindows: new Set() };
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
function activeDataThrough(dataDir, period) {
  try {
    return readCurrentRows(dataDir, period).reduce((latest, row) => {
      const value = String(row?.date || row?.revenue_date || row?.sale_order_date || row?.order_date || row?.invoice_date || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && value > latest ? value : latest;
    }, '');
  } catch { return ''; }
}
function monitorState(store = persist) { return store.load(MONITOR_STATE, {}); }
function saveMonitorState(value, store = persist) { store.save(MONITOR_STATE, value); }

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
  const run = { ok: false, reason, period, startedAt: new Date().toISOString(), sources: {
    DEBTS_DONA: { status: 'pending' }, DEBTS_AFP: { status: 'pending' }, APP_WEB: { status: 'pending' },
  } };
  try {
    const getSnapshot = deps.getCatalogSnapshot || require('./catalogManagement').getSnapshot;
    const fetchPages = deps.fetchSnapshotPages || shadow.fetchSnapshotPages;
    const materialize = deps.materializeShadow || shadow.materializeShadow;
    const publishShadow = deps.publishShadow || shadow.publishShadow;
    const verifyShadow = deps.verifyPublishedShadow || shadow.verifyPublishedShadow;
    const publishSlot = deps.publishSlot || slot.publish;
    const loadPartnerRows = deps.loadPartnerRows || require('./debtsPartnerRevenue').load;
    const stageGeneration = deps.stageGeneration || coordinator.stage;
    const loadGeneration = deps.loadGeneration || coordinator.loadCurrent;
    const bootstrapGenerations = deps.bootstrapGenerations || coordinator.bootstrapFromActive;
    let appWebGeneration = null; let debtsGeneration = null; let appWebError = null; let debtsError = null;
    try {
      const partner = await loadPartnerRows(period, { env });
      appWebGeneration = coordinator.buildAppWeb(period, partner?.rows, { catalogVersion: partner?.catalogVersion, kpi: partner?.kpi });
      stageGeneration(appWebGeneration, { dataDir });
      run.sources.APP_WEB = { status: 'ok', rowCount: appWebGeneration.rowCount, dataThrough: appWebGeneration.dataThrough };
    } catch (error) {
      appWebError = error; run.sources.APP_WEB = { status: 'failed', code: String(error?.code || error?.message || 'APP_WEB_SOURCE_FAILED') };
    }
    const staged = {};
    try {
    const catalog = await getSnapshot(period); const mapping = catalogMapping.build(catalog, period);
    for (const legalEntity of ['DONA', 'AFP']) {
      try {
        const combined = await fetchPages({ endpoint: cfg.endpoint, token: cfg.token, period, legalEntity, lockedPeriods: [shadow.HARD_BLOCKED_PERIOD], fetchImpl });
        staged[legalEntity] = materialize(combined, mapping, { codeRevision: 'debts-t09-catalog-direct-v1' });
        run.sources[`DEBTS_${legalEntity}`] = { status: 'ok', rowCount: staged[legalEntity].receipt?.rowCount || 0,
          mappedCount: staged[legalEntity].receipt?.mappedCount || 0, quarantinedCount: staged[legalEntity].receipt?.quarantinedCount || 0 };
      } catch (error) {
        run.sources[`DEBTS_${legalEntity}`] = { status: 'failed', code: String(error?.code || error?.message || 'DEBTS_SOURCE_FAILED') };
        throw error;
      }
    }
    const payload = cutover.build({ period, partitions: staged }); const verified = {};
    for (const legalEntity of ['DONA', 'AFP']) {
      const target = publishShadow(staged[legalEntity], { dataDir: cfg.dataDir, allowWrite: true,
        receiptSigningKey: cfg.receiptSigningKey, receiptSigningKeyId: cfg.receiptSigningKeyId });
      verified[legalEntity] = verifyShadow(target, { receiptSigningKey: cfg.receiptSigningKey, receiptSigningKeyId: cfg.receiptSigningKeyId });
    }
    const verifiedPayload = cutover.build({ period, partitions: verified });
    if (verifiedPayload.rowsChecksum !== payload.rowsChecksum) fail('DEBTS_REVENUE_VERIFY_DRIFT');
    debtsGeneration = coordinator.buildDebts(period, verifiedPayload); stageGeneration(debtsGeneration, { dataDir });
    } catch (error) { debtsError = error; }
    if (!appWebGeneration) try { appWebGeneration = loadGeneration({ dataDir, period, kind: 'app-web' }); } catch {}
    if (!debtsGeneration) try { debtsGeneration = loadGeneration({ dataDir, period, kind: 'debts-dona-afp' }); } catch {}
    if (!appWebGeneration || !debtsGeneration) try {
      const fallback = bootstrapGenerations({ dataDir, period });
      appWebGeneration ||= fallback.appWeb; debtsGeneration ||= fallback.debts;
    } catch {}
    if (!appWebGeneration || !debtsGeneration) throw (debtsError || appWebError || Object.assign(new Error('REVENUE_COORDINATOR_GENERATION_UNAVAILABLE'), { code: 'REVENUE_COORDINATOR_GENERATION_UNAVAILABLE' }));
    const coordinated = coordinator.coordinate({ period, appWeb: appWebGeneration, debts: debtsGeneration });
    const composed = slot.compose(coordinated);
    run.publish = publishSlot(composed, { dataDir }); run.rowCount = debtsGeneration.rowCount;
    run.partnerRowCount = appWebGeneration.rowCount; run.rowsChecksum = debtsGeneration.rowsChecksum; run.partitionGenerations = coordinated.partitionGenerations;
    run.partial = Boolean(appWebError || debtsError); run.finishedAt = new Date().toISOString(); run.ok = !run.partial; state.lastRun = run;
    if (run.partial) { const error = debtsError || appWebError; error.details = { ...(error.details || {}), compositePublished: true }; throw error; }
    return Object.freeze(run);
  } catch (error) {
    const legalEntity = String(error?.details?.legalEntity || '').toUpperCase();
    if (legalEntity === 'DONA' || legalEntity === 'AFP') {
      run.sources[`DEBTS_${legalEntity}`] = { ...run.sources[`DEBTS_${legalEntity}`], status: 'failed',
        code: String(error?.code || error?.message || 'DEBTS_PARTITION_FAILED') };
    }
    run.finishedAt = new Date().toISOString(); run.error = String(error?.code || error?.message || error); state.lastRun = run; throw error;
  } finally { state.inFlight = false; }
}

function nextRetryText(due) {
  const next = schedule.RETRY_OFFSETS.find((offset) => offset > due.offset);
  if (next === undefined) return '';
  const minute = due.base + next; return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
function tick(now = new Date(), deps = {}) {
  const due = schedule.runWindow(now, deps.env || process.env);
  if (!due.due) { state.lastSkip = { at: new Date().toISOString(), ...due }; return; }
  const windowKey = `${due.slot}|${due.offset}`;
  if (state.handledWindows.has(windowKey)) return;
  state.handledWindows.add(windowKey);
  const stored = monitorState(deps.store);
  if (state.lastSuccessSlot === due.slot || stored.lastSuccessSlot === due.slot) return;
  const period = currentPeriod(now);
  const currentThrough = () => deps.activeDataThrough?.() || activeDataThrough(deps.dataDir || shadowService.DATA_DIR, period);
  if (due.kind === 'watchdog') {
    const last = state.lastRun || {};
    return (deps.notifyIncident || incident.notifyCeo)({ kind: 'stale', period, slot: due.slot,
      code: last.error || stored.lastError || 'REVENUE_SYNC_STALE', sources: last.sources || stored.sources || {}, activeDataThrough: currentThrough(), nextRetryAt: '' });
  }
  state.lastSlot = due.slot;
  return runOnce({ force: true, reason: `${due.kind}:${due.slot}`, now, ...(deps.runOptions || {}) }).then((result) => {
    state.lastSuccessSlot = due.slot;
    saveMonitorState({ lastSuccessSlot: due.slot, lastSuccessAt: new Date().toISOString(), sources: result.sources || {} }, deps.store);
    return result;
  }).catch(async (error) => {
    console.error('[debts-revenue] failed; previous slot remains active', String(error?.code || error?.message || error), error?.details || {});
    const last = state.lastRun || {};
    saveMonitorState({ ...stored, lastError: String(error?.code || error?.message || error), lastFailureAt: new Date().toISOString(),
      lastFailureSlot: due.slot, sources: last.sources || {} }, deps.store);
    await (deps.notifyIncident || incident.notifyCeo)({ kind: 'failure', period, slot: due.slot,
      code: error?.code || error?.message, sources: last.sources || {}, activeDataThrough: currentThrough(), nextRetryAt: nextRetryText(due) });
    return null;
  });
}
function start() {
  if (state.started) return; state.started = true;
  if (!schedule.enabled()) { console.log('[debts-revenue] disabled'); return; }
  state.timer = setInterval(() => tick(), 60 * 1000); state.timer.unref?.(); console.log('[debts-revenue] scheduler armed', JSON.stringify(schedule.config())); tick();
}
function status() { return { ...schedule.config(), inFlight: state.inFlight, lastSlot: state.lastSlot, lastRun: state.lastRun, lastSkip: state.lastSkip,
  monitor: monitorState() }; }

module.exports = { MONITOR_STATE, currentPeriod, readCurrentRows, activeDataThrough, monitorState, runOnce, nextRetryText, tick, start, status, _state: state };
