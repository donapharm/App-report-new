'use strict';

process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
const deckReport = require('./deckReport');

const state = { timer: null, running: false };
const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || '').trim());
const pad2 = (value) => String(value).padStart(2, '0');
const localStamp = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

function config(env = process.env) {
  return {
    enabled: truthy(env.REPORT_DECK_SCHEDULER_ENABLED),
    approved: truthy(env.REPORT_DECK_SCHEDULER_APPROVED),
    timezone: env.TZ || 'Asia/Ho_Chi_Minh',
    weekly: '13:00 Thứ 7',
    monthly: '18:00 ngày cuối tháng',
  };
}
function isLastDayOfMonth(date) {
  return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function minutes(date) { return date.getHours() * 60 + date.getMinutes(); }
function dueKinds(now = new Date()) {
  const out = [];
  if (now.getDay() === 6 && minutes(now) >= 13 * 60) out.push('week');
  if (isLastDayOfMonth(now) && minutes(now) >= 18 * 60) out.push('month');
  return out;
}

async function runDue({ now = new Date(), env = process.env, report = deckReport } = {}) {
  const cfg = config(env);
  if (!cfg.enabled) return { ok: true, skipped: 'scheduler-disabled', config: cfg };
  if (!cfg.approved) return { ok: true, skipped: 'ceo-approval-not-enabled', config: cfg };
  const kinds = dueKinds(now);
  if (!kinds.length) return { ok: true, skipped: 'not-due', at: localStamp(now), config: cfg };
  const results = [];
  for (const kind of kinds) {
    try {
      // Scheduler only produces the official release. Drafts remain manual via CLI/admin preview.
      const built = await report.build({ kind, draft: false });
      const delivery = await report.sendCeo(built, { approved: true });
      results.push({ kind, key: built.key, ok: delivery.ok, skipped: delivery.skipped || null, delivery });
    } catch (error) {
      results.push({ kind, ok: false, error: error.message });
    }
  }
  return { ok: results.every((x) => x.ok), at: localStamp(now), results, config: cfg };
}

async function tick(options = {}) {
  if (state.running) return { ok: true, skipped: 'already-running' };
  state.running = true;
  try {
    const result = await runDue(options);
    if (!result.ok) console.error('[report-deck-scheduler] run failed', JSON.stringify(result));
    else if (!result.skipped || !['not-due', 'scheduler-disabled'].includes(result.skipped)) console.log('[report-deck-scheduler]', JSON.stringify(result));
    return result;
  } finally { state.running = false; }
}

function start({ intervalMs = 60_000 } = {}) {
  const cfg = config();
  if (!cfg.enabled) {
    console.log('[report-deck-scheduler] disabled (REPORT_DECK_SCHEDULER_ENABLED=false)');
    return { started: false, config: cfg };
  }
  if (!cfg.approved) {
    console.warn('[report-deck-scheduler] not armed: missing REPORT_DECK_SCHEDULER_APPROVED=true');
    return { started: false, config: cfg };
  }
  if (state.timer) return { started: true, reused: true, config: cfg };
  state.timer = setInterval(() => tick().catch((error) => console.error('[report-deck-scheduler] tick failed', error)), intervalMs);
  state.timer.unref?.();
  setImmediate(() => tick().catch((error) => console.error('[report-deck-scheduler] initial tick failed', error)));
  console.log('[report-deck-scheduler] armed', JSON.stringify(cfg));
  return { started: true, config: cfg };
}
function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
}

module.exports = { config, dueKinds, isLastDayOfMonth, runDue, tick, start, stop };
