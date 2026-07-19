'use strict';

const crypto = require('crypto');
const dormant = require('./dormantQlnb');

const STORE_NAME = 'dormant_qlnb_notifications';
const MAX_EVENTS = 5000;
const AUDIENCES = new Set(['ceo', 'employee']);

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function dateOnly(v) { const s = text(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function stableId(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}
function businessDaysBetween(fromValue, toValue) {
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let days = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}
function itemKeysForStoredEvent(event = {}) {
  if (Array.isArray(event.item_keys) && event.item_keys.length) return event.item_keys.map(text).filter(Boolean);
  const emp = upper(event.emp_code);
  const unit = upper(event.unit_code);
  if (!emp || !unit) return [];
  return (event.qlnb_codes || []).map(upper).filter(Boolean)
    .map((iit) => [emp, unit, iit].map(encodeURIComponent).join('|'));
}
function normalize(input) {
  const value = input && typeof input === 'object' ? input : {};
  const sourceVersion = Number(value.version || 1);
  const events = Array.isArray(value.events) ? value.events.filter((x) => x && x.id).slice(-MAX_EVENTS).map((stored) => {
    const event = {
      ...stored,
      audience: AUDIENCES.has(text(stored.audience)) ? text(stored.audience) : 'ceo',
      item_keys: itemKeysForStoredEvent(stored),
      action_cycle: Math.max(0, Number(stored.action_cycle ?? stored.cycle ?? 0)),
      feedback_id: text(stored.feedback_id) || null,
      ack_at: stored.ack_at || null,
      ack_kind: ['read', 'updated'].includes(text(stored.ack_kind)) ? text(stored.ack_kind) : null,
      target: stored.target && typeof stored.target === 'object' ? stored.target : null,
      closed_at: stored.closed_at || null,
      closed_reason: text(stored.closed_reason) || null,
    };
    // V1 review IDs did not include audience/item scope. Canonicalize only
    // deterministic generated events so the first V2 sync refreshes them
    // instead of duplicating the same status. Submission events keep their
    // original immutable ID because their old request fingerprint was not
    // persisted.
    if (sourceVersion < 2 && ['review_upcoming', 'review_due', 'review_overdue', 'reactivated'].includes(event.type)) {
      event.id = stableId([
        event.audience, event.type, upper(event.emp_code), text(event.unit_code), event.item_keys.slice().sort(),
        (event.qlnb_codes || []).map(text).filter(Boolean).sort(), dateOnly(event.ref_date), 0,
        event.type === 'reactivated' ? 0 : event.action_cycle, '',
      ]);
    }
    return event;
  }) : [];
  return {
    version: 2,
    events,
  };
}
function reviewState(item, today) {
  const action = item?.action || {};
  const follow = dateOnly(action.next_follow_up);
  if (!action.status || !follow) return { status: 'unplanned', days_left: null, overdue_days: 0 };
  const delta = dormant.daysBetween(today, follow);
  if (delta == null) return { status: 'unplanned', days_left: null, overdue_days: 0 };
  if (delta < 0) return { status: 'overdue', days_left: delta, overdue_days: Math.abs(delta) };
  if (delta === 0) return { status: 'due', days_left: 0, overdue_days: 0 };
  if (delta <= 3) return { status: 'upcoming', days_left: delta, overdue_days: 0 };
  return { status: 'in_progress', days_left: delta, overdue_days: 0 };
}

function createDormantNotificationStore({ persist, clock = () => new Date() } = {}) {
  if (!persist) throw new Error('Notification store thiếu persist');
  const load = () => normalize(persist.load(STORE_NAME, { version: 1, events: [] }));
  const save = (value) => persist.save(STORE_NAME, normalize(value));

  function buildEvent(input = {}) {
    const at = input.at || new Date(clock()).toISOString();
    const event = {
      type: text(input.type) || 'info',
      severity: text(input.severity) || 'info',
      audience: AUDIENCES.has(text(input.audience)) ? text(input.audience) : 'ceo',
      emp_code: upper(input.emp_code),
      employee_name: text(input.employee_name),
      unit_code: text(input.unit_code),
      unit_name: text(input.unit_name),
      qlnb_codes: [...new Set((input.qlnb_codes || []).map(text).filter(Boolean))].slice(0, 20),
      item_keys: [...new Set((input.item_keys || []).map(text).filter(Boolean))].slice(0, 20),
      count: Math.max(0, Number(input.count || 0)),
      cycle: Math.max(0, Number(input.cycle || 0)),
      action_cycle: Math.max(0, Number(input.action_cycle ?? input.cycle ?? 0)),
      feedback_id: text(input.feedback_id) || null,
      ref_date: dateOnly(input.ref_date),
      title: text(input.title),
      message: text(input.message),
      target: input.target && typeof input.target === 'object' ? {
        tab: text(input.target.tab) || 'dormantReports',
        item_key: text(input.target.item_key) || null,
        unit_code: text(input.target.unit_code) || null,
      } : null,
      at,
      read_at: input.read_at || null,
      ack_at: input.ack_at || null,
      ack_kind: ['read', 'updated'].includes(text(input.ack_kind)) ? text(input.ack_kind) : null,
      closed_at: input.closed_at || null,
      closed_reason: text(input.closed_reason) || null,
    };
    event.id = input.id || stableId([
      event.audience, event.type, event.emp_code, event.unit_code, event.item_keys.slice().sort(), event.qlnb_codes.slice().sort(),
      event.ref_date, event.type === 'dormant_detected' ? event.cycle : 0,
      ['dormant_detected', 'reactivated'].includes(event.type) ? 0 : event.action_cycle, text(input.fingerprint || ''),
    ]);
    return event;
  }

  function addMany(inputs = []) {
    const state = load();
    const existing = new Map(state.events.map((x, index) => [x.id, index]));
    const added = [];
    let changed = false;
    for (const input of inputs) {
      const event = buildEvent(input);
      if (existing.has(event.id)) {
        const index = existing.get(event.id);
        const current = state.events[index];
        const refreshed = {
          ...event,
          at: current.at,
          read_at: current.read_at || null,
          ack_at: current.ack_at || null,
          ack_kind: current.ack_kind || null,
          closed_at: current.closed_at || null,
          closed_reason: current.closed_reason || null,
        };
        if (JSON.stringify(current) !== JSON.stringify(refreshed)) {
          state.events[index] = refreshed;
          changed = true;
        }
        continue;
      }
      existing.set(event.id, state.events.length);
      state.events.push(event);
      added.push(event);
      changed = true;
    }
    if (changed) {
      if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
      save(state);
    }
    return added;
  }

  function add(input = {}) {
    const event = buildEvent(input);
    const added = addMany([{ ...input, id: event.id }]);
    if (added.length) return added[0];
    return load().events.find((x) => x.id === event.id) || event;
  }

  function addPlanBatch({ empCode, employeeName, unitCode, unitName, items = [], at } = {}) {
    const codes = items.map((x) => x.iit_code).filter(Boolean);
    const cycle = Math.max(0, ...items.map((x) => Number(x.action?.cycle || 0)));
    return add({
      type: 'plan_batch', severity: 'info', emp_code: empCode, employee_name: employeeName,
      unit_code: unitCode, unit_name: unitName, qlnb_codes: codes, count: codes.length,
      item_keys: items.map((x) => x.key).filter(Boolean),
      cycle, ref_date: dateOnly(at), at,
      title: `${upper(empCode)} đã lập kế hoạch ${codes.length} QLNB`,
      message: `Đơn vị ${unitName || unitCode}: đã cập nhật một lô kế hoạch, chu kỳ xử lý tối đa 14 ngày.`,
      fingerprint: items.map((x) => x.key).sort().join('|') + '|' + at,
    });
  }

  function closeEmployeeEvents(itemKeys = [], reason = 'qlnb_reactivated') {
    const wanted = new Set(itemKeys.map(text).filter(Boolean));
    if (!wanted.size) return 0;
    const state = load();
    const at = new Date(clock()).toISOString();
    let changed = 0;
    state.events = state.events.map((event) => {
      if (event.audience !== 'employee' || event.closed_at || !(event.item_keys || []).some((key) => wanted.has(key))) return event;
      changed += 1;
      return { ...event, closed_at: at, closed_reason: reason };
    });
    if (changed) save(state);
    return changed;
  }

  function syncReviewEvents({ items = [], reactivated = [], today } = {}) {
    const inputs = [];
    // Keep resolved events as immutable audit history, but remove them from the
    // actionable employee feed before any escalation or deep-link projection.
    closeEmployeeEvents(reactivated.map((item) => item?.key));
    for (const item of items) {
      const review = reviewState(item, today);
      const base = {
        emp_code: item.emp_code, employee_name: item.employee_name,
        unit_code: item.unit_code, unit_name: item.unit_name,
        qlnb_codes: [item.iit_code], item_keys: [item.key], count: 1,
        cycle: item.dormant_cycle || 0, action_cycle: item.action?.cycle || 0,
        ref_date: item.action?.next_follow_up,
        target: { tab: 'dormantReports', item_key: item.key, unit_code: item.unit_code },
      };
      // Every currently valid dormant item gets one employee event per dormant
      // cycle.  This also safely backfills items detected before the bell was
      // introduced without producing a daily duplicate.
      inputs.push({
        ...base,
        audience: 'employee',
        type: 'dormant_detected',
        severity: Number(item.days_idle || 0) >= 90 ? 'danger' : 'warning',
        // Legacy items may not have first_detected_at. Use the stable last
        // activity date (or null), never "today", otherwise a backfill would
        // create a new notification every day.
        ref_date: item.first_detected_at || item.last_activity_at || null,
        title: `QLNB đã ngủ đông ${Number(item.days_idle || 0)} ngày`,
        message: `${item.product_name || item.iit_code} tại ${item.unit_name || item.unit_code} cần có kế hoạch xử lý.`,
        fingerprint: `dormant:${item.dormant_cycle || 1}`,
      });
      const reviewEvents = [];
      if (review.status === 'upcoming') reviewEvents.push({ ...base, type: 'review_upcoming', severity: 'info', title: `${item.emp_code} còn ${review.days_left} ngày đến hạn review`, message: `${item.product_name || item.iit_code} tại ${item.unit_name || item.unit_code}.` });
      if (review.status === 'due') reviewEvents.push({ ...base, type: 'review_due', severity: 'warning', title: `${item.emp_code} đến hạn review QLNB`, message: `${item.product_name || item.iit_code} tại ${item.unit_name || item.unit_code} cần cập nhật kết quả hôm nay.` });
      if (review.status === 'overdue') reviewEvents.push({ ...base, type: 'review_overdue', severity: 'danger', title: `${item.emp_code} quá hạn review ${review.overdue_days} ngày`, message: `${item.product_name || item.iit_code} tại ${item.unit_name || item.unit_code} chưa có kết quả mới.` });
      for (const event of reviewEvents) {
        inputs.push({ ...event, audience: 'ceo' });
        inputs.push({ ...event, audience: 'employee', title: event.title.replace(`${item.emp_code} `, '') });
      }
    }
    for (const item of reactivated) inputs.push({
      type: 'reactivated', severity: 'success', emp_code: item.emp_code,
      unit_code: item.unit_code, qlnb_codes: [item.iit_code], item_keys: [item.key], count: 1,
      ref_date: item.order_at, title: `${item.emp_code} có đơn dương trở lại`,
      message: `QLNB ${item.iit_code} tại ${item.unit_code} đã được tự đóng cảnh báo.`,
    });
    return addMany(inputs);
  }

  function escalationFor(event, nowValue) {
    if (event.audience !== 'employee' || event.closed_at) return null;
    const ageHours = Math.max(0, (new Date(nowValue).getTime() - new Date(event.at).getTime()) / 3600000);
    const workdays = businessDaysBetween(event.at, nowValue);
    const unread24h = !event.read_at && ageHours >= 24;
    const unresolved3d = event.ack_kind !== 'updated' && workdays >= 3;
    if (!unread24h && !unresolved3d) return null;
    return {
      preview_only: true,
      send_enabled: false,
      unread_24h: unread24h,
      unresolved_3_business_days: unresolved3d,
      reason: unresolved3d ? 'employee_not_updated_3_business_days' : 'employee_unread_24h',
      event_id: event.id,
    };
  }

  function feed({ items = [], reactivated = [], today, audience = 'ceo', empCode = null } = {}) {
    syncReviewEvents({ items, reactivated, today });
    const state = load();
    const wantedAudience = AUDIENCES.has(text(audience)) ? text(audience) : 'ceo';
    const emp = upper(empCode);
    const nowValue = new Date(clock()).toISOString();
    const events = state.events.filter((event) => !event.closed_at && event.audience === wantedAudience && (!emp || event.emp_code === emp))
      .map((event) => ({ ...event, escalation: escalationFor(event, nowValue) }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)));
    const unread = events.filter((x) => !x.read_at);
    const counts = events.reduce((acc, event) => { acc[event.type] = (acc[event.type] || 0) + 1; return acc; }, {});
    return { generated_on: today, unread_count: unread.length, counts, events: events.slice(0, 150) };
  }

  function markRead({ ids = [], all = false, audience = 'ceo', empCode = null } = {}) {
    const state = load();
    const wanted = new Set((ids || []).map(text).filter(Boolean));
    const at = new Date(clock()).toISOString();
    let changed = 0;
    state.events = state.events.map((event) => {
      if (event.closed_at || event.audience !== audience || (empCode && event.emp_code !== upper(empCode)) || event.read_at || (!all && !wanted.has(event.id))) return event;
      changed += 1;
      return { ...event, read_at: at };
    });
    if (changed) save(state);
    return { ok: true, changed, unread_count: state.events.filter((x) => !x.closed_at && x.audience === audience && (!empCode || x.emp_code === upper(empCode)) && !x.read_at).length };
  }

  function acknowledge({ ids = [], itemKeys = [], empCode, kind = 'read' } = {}) {
    const state = load();
    const emp = upper(empCode);
    const wanted = new Set((ids || []).map(text).filter(Boolean));
    const wantedItems = new Set((itemKeys || []).map(text).filter(Boolean));
    const ackKind = kind === 'updated' ? 'updated' : 'read';
    const at = new Date(clock()).toISOString();
    let changed = 0;
    state.events = state.events.map((event) => {
      const matches = wanted.has(event.id) || (event.item_keys || []).some((key) => wantedItems.has(key));
      if (event.closed_at || event.audience !== 'employee' || event.emp_code !== emp || !matches) return event;
      if (event.ack_kind === 'updated' || (event.ack_kind === ackKind && event.ack_at)) return event;
      changed += 1;
      return { ...event, read_at: event.read_at || at, ack_at: at, ack_kind: ackKind };
    });
    if (changed) save(state);
    return { ok: true, changed };
  }

  return { add, addMany, addPlanBatch, syncReviewEvents, feed, markRead, acknowledge };
}

module.exports = { STORE_NAME, MAX_EVENTS, reviewState, stableId, businessDaysBetween, createDormantNotificationStore };
