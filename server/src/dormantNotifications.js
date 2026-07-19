'use strict';

const crypto = require('crypto');
const dormant = require('./dormantQlnb');

const STORE_NAME = 'dormant_qlnb_notifications';
const MAX_EVENTS = 5000;

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function dateOnly(v) { const s = text(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function stableId(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}
function normalize(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    version: 1,
    events: Array.isArray(value.events) ? value.events.filter((x) => x && x.id).slice(-MAX_EVENTS) : [],
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
      emp_code: upper(input.emp_code),
      employee_name: text(input.employee_name),
      unit_code: text(input.unit_code),
      unit_name: text(input.unit_name),
      qlnb_codes: [...new Set((input.qlnb_codes || []).map(text).filter(Boolean))].slice(0, 20),
      count: Math.max(0, Number(input.count || 0)),
      cycle: Math.max(0, Number(input.cycle || 0)),
      ref_date: dateOnly(input.ref_date),
      title: text(input.title),
      message: text(input.message),
      at,
      read_at: input.read_at || null,
    };
    event.id = input.id || stableId([
      event.type, event.emp_code, event.unit_code, event.qlnb_codes.slice().sort(),
      event.ref_date, event.cycle, text(input.fingerprint || ''),
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
        const refreshed = { ...event, at: current.at, read_at: current.read_at || null };
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
      cycle, ref_date: dateOnly(at), at,
      title: `${upper(empCode)} đã lập kế hoạch ${codes.length} QLNB`,
      message: `Đơn vị ${unitName || unitCode}: đã cập nhật một lô kế hoạch, chu kỳ xử lý tối đa 14 ngày.`,
      fingerprint: items.map((x) => x.key).sort().join('|') + '|' + at,
    });
  }

  function syncReviewEvents({ items = [], reactivated = [], today } = {}) {
    const inputs = [];
    for (const item of items) {
      const review = reviewState(item, today);
      const base = {
        emp_code: item.emp_code, employee_name: item.employee_name,
        unit_code: item.unit_code, unit_name: item.unit_name,
        qlnb_codes: [item.iit_code], count: 1,
        cycle: item.action?.cycle || 0, ref_date: item.action?.next_follow_up,
      };
      if (review.status === 'upcoming') inputs.push({ ...base, type: 'review_upcoming', severity: 'info', title: `${item.emp_code} còn ${review.days_left} ngày đến hạn review`, message: `${item.product_name || item.iit_code} tại ${item.unit_name || item.unit_code}.` });
      if (review.status === 'due') inputs.push({ ...base, type: 'review_due', severity: 'warning', title: `${item.emp_code} đến hạn review QLNB`, message: `${item.product_name || item.iit_code} tại ${item.unit_name || item.unit_code} cần cập nhật kết quả hôm nay.` });
      if (review.status === 'overdue') inputs.push({ ...base, type: 'review_overdue', severity: 'danger', title: `${item.emp_code} quá hạn review ${review.overdue_days} ngày`, message: `${item.product_name || item.iit_code} tại ${item.unit_name || item.unit_code} chưa có kết quả mới.` });
    }
    for (const item of reactivated) inputs.push({
      type: 'reactivated', severity: 'success', emp_code: item.emp_code,
      unit_code: item.unit_code, qlnb_codes: [item.iit_code], count: 1,
      ref_date: item.order_at, title: `${item.emp_code} có đơn dương trở lại`,
      message: `QLNB ${item.iit_code} tại ${item.unit_code} đã được tự đóng cảnh báo.`,
    });
    return addMany(inputs);
  }

  function feed({ items = [], reactivated = [], today } = {}) {
    syncReviewEvents({ items, reactivated, today });
    const state = load();
    const events = state.events.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)));
    const unread = events.filter((x) => !x.read_at);
    const counts = events.reduce((acc, event) => { acc[event.type] = (acc[event.type] || 0) + 1; return acc; }, {});
    return { generated_on: today, unread_count: unread.length, counts, events: events.slice(0, 150) };
  }

  function markRead({ ids = [], all = false } = {}) {
    const state = load();
    const wanted = new Set((ids || []).map(text).filter(Boolean));
    const at = new Date(clock()).toISOString();
    let changed = 0;
    state.events = state.events.map((event) => {
      if (event.read_at || (!all && !wanted.has(event.id))) return event;
      changed += 1;
      return { ...event, read_at: at };
    });
    if (changed) save(state);
    return { ok: true, changed, unread_count: state.events.filter((x) => !x.read_at).length };
  }

  return { add, addMany, addPlanBatch, syncReviewEvents, feed, markRead };
}

module.exports = { STORE_NAME, MAX_EVENTS, reviewState, stableId, createDormantNotificationStore };
