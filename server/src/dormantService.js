'use strict';

const dormant = require('./dormantQlnb');
const xuPolicy = require('./xuPolicy');

const STATE_NAME = 'dormant_qlnb_state';
const CHECKPOINT_NAME = 'dormant_qlnb_checkpoints';
const MAX_GATE_ITEMS = 5;
const NOTE_REQUIRED = new Set(['blocked', 'no_demand', 'inactive_assignment', 'other']);

function upper(v) { return String(v || '').trim().toUpperCase(); }
function dateOnly(v) { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function localYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function sourceName(v) { return ['revenue', 'analysis', 'revenueFull'].includes(String(v || '')) ? String(v) : 'revenue'; }
function checkpointKey(empCode, today) { return `${upper(empCode)}:${xuPolicy.startOfWeek(today)}`; }
function attention(item, today) {
  const openDays = Math.max(0, dormant.daysBetween(item.first_detected_at, today) || 0);
  return {
    open_days: openDays,
    level: openDays >= 14 ? 'management' : openDays >= 7 ? 'red' : 'normal',
    escalate_management: openDays >= 14,
  };
}
function publicItem(item, today) {
  return {
    ...item,
    last_order_date: item.last_activity_at,
    remain_qty: item.cst?.remain_qty ?? null,
    remain_amount: item.cst?.remain_amount ?? 0,
    priority_score: item.priority?.score ?? null,
    priority_reasons: item.priority?.evidence || [],
    attention: attention(item, today),
  };
}
function resolveAsOf(store, salesRows) {
  const periods = store.listPeriods();
  const latest = periods.at(-1);
  if (latest?.ky && typeof store.periodFreshness === 'function') {
    const freshness = store.periodFreshness(latest.ky);
    if (dateOnly(freshness?.throughDate)) return dateOnly(freshness.throughDate);
  }
  return dateOnly(latest?.dateTo) || dormant.resolveDataAsOf({ salesRows });
}
function exactKeys(items = []) { return [...new Set(items.map((x) => x.key).filter(Boolean))].sort(); }

function createDormantService({ store, scoreForEmp, persist, clock = () => new Date() } = {}) {
  if (!store || !persist) throw new Error('Dormant service thiếu store/persist');
  const loadState = () => persist.load(STATE_NAME, { version: 1, items: {} });
  const saveState = (value) => persist.save(STATE_NAME, value);

  function analyzeScope(empCode) {
    const scope = empCode ? { empCode: upper(empCode) } : {};
    const kys = store.periodKys();
    const salesRows = store.getRowsRange({ kys, scope });
    const cstRows = store.getCst({ scope });
    const asOf = resolveAsOf(store, salesRows);
    if (!asOf) throw new Error('Chưa có ngày dữ liệu để tính QLNB ngủ đông');
    const result = dormant.analyze({ salesRows, cstRows, dataAsOf: asOf, scope, state: loadState(), maxPriority: MAX_GATE_ITEMS });
    saveState(result.state);
    return result;
  }

  function gateFor({ empCode, source } = {}) {
    const emp = upper(empCode);
    if (!emp) throw new Error('Chỉ nhân viên đã định danh mới dùng AI canh cửa');
    const today = localYmd(clock());
    const result = analyzeScope(emp);
    const checkpoints = persist.load(CHECKPOINT_NAME, { version: 1, acknowledgements: {} });
    const cpKey = checkpointKey(emp, today);
    const acknowledgement = checkpoints.acknowledgements?.[cpKey] || null;
    const weeklyPending = !acknowledgement;
    const externallyDue = result.items.filter((item) => item.action?.next_follow_up && item.action.next_follow_up <= today);
    const knownKeys = new Set(acknowledgement?.known_keys || acknowledgement?.item_keys || []);
    const newSinceCheckpoint = weeklyPending ? [] : result.items.filter((item) => !knownKeys.has(item.key));
    // Lần đầu tuần: ưu tiên mã chưa có kế hoạch/đến hạn trước rồi mới bổ sung
    // danh sách ưu tiên chung. Sau khi đã xác nhận: tuyệt đối không kéo tiếp cả
    // backlog theo từng lô 5; chỉ hỏi mã mới hoặc mã có ngày theo dõi đã đến.
    const candidates = weeklyPending
      ? [...result.gate, ...result.items]
      : [...newSinceCheckpoint, ...externallyDue];
    const selected = [...new Map(candidates.map((x) => [x.key, x])).values()]
      .sort((a, b) => b.priority.score - a.priority.score || b.days_idle - a.days_idle)
      .slice(0, MAX_GATE_ITEMS);
    const requiredItems = selected.map((x) => publicItem(x, today));
    const xu = typeof scoreForEmp === 'function'
      ? xuPolicy.buildCheckpoint({ empCode: emp, asOf: result.as_of, scoreFn: scoreForEmp, priorBookedAdjustment: null })
      : null;
    return {
      as_of: result.as_of,
      generated_on: today,
      source: sourceName(source),
      checkpoint_key: cpKey,
      must_answer: requiredItems.length > 0,
      trigger: weeklyPending ? 'weekly_first_entry' : (requiredItems.length ? 'new_or_due' : null),
      summary: {
        dormant_total: result.summary.dormant,
        newly_dormant: result.summary.newly_dormant,
        due: result.summary.due + externallyDue.filter((x) => !result.gate.some((g) => g.key === x.key)).length,
        reactivated: result.summary.reactivated,
        not_activated: result.summary.not_activated,
        red_7_days: result.items.filter((x) => attention(x, today).level !== 'normal').length,
        management_14_days: result.items.filter((x) => attention(x, today).escalate_management).length,
      },
      required_items: requiredItems,
      items: result.items.slice(0, 20).map((x) => publicItem(x, today)),
      not_activated: result.not_activated.slice(0, 20),
      reactivated: result.reactivated,
      xu,
    };
  }

  function submitActions({ empCode, source, checkpoint_key, actions } = {}) {
    const emp = upper(empCode);
    const gate = gateFor({ empCode: emp, source });
    if (checkpoint_key !== gate.checkpoint_key) throw new Error('Phiên xác nhận đã cũ, vui lòng tải lại');
    if (!gate.must_answer) return gate;
    if (!Array.isArray(actions)) throw new Error('Danh sách phản hồi không hợp lệ');
    const expected = exactKeys(gate.required_items);
    const received = exactKeys(actions);
    if (expected.length !== received.length || expected.some((key, i) => key !== received[i])) throw new Error('Phải phản hồi đủ các mã QLNB đang được yêu cầu');
    const today = localYmd(clock());
    const validated = actions.map((action) => {
      if (!dormant.ACTION_STATUSES.includes(action.status)) throw new Error(`Trạng thái không hợp lệ: ${action.status || '(rỗng)'}`);
      const follow = dateOnly(action.next_follow_up);
      if (!follow || follow <= today) throw new Error('Ngày theo dõi lại phải sau ngày hiện tại');
      const note = String(action.note || '').trim();
      if (NOTE_REQUIRED.has(action.status) && note.length < 3) throw new Error('Vui lòng ghi rõ lý do cho kết quả đã chọn');
      return { key: action.key, status: action.status, next_follow_up: follow, note };
    });
    let state = loadState();
    for (const action of validated) state = dormant.updateAction({ state, ...action, actor: emp, now: today });
    saveState(state);
    const checkpoints = persist.load(CHECKPOINT_NAME, { version: 1, acknowledgements: {} });
    checkpoints.version = 1;
    checkpoints.acknowledgements = checkpoints.acknowledgements || {};
    const afterAction = analyzeScope(emp);
    checkpoints.acknowledgements[gate.checkpoint_key] = {
      at: new Date(clock()).toISOString(),
      source: sourceName(source),
      item_keys: expected,
      known_keys: afterAction.items.map((item) => item.key),
    };
    persist.save(CHECKPOINT_NAME, checkpoints);
    return gateFor({ empCode: emp, source });
  }

  function summaryFor({ empCode, isAdmin = false } = {}) {
    const today = localYmd(clock());
    const result = analyzeScope(isAdmin ? null : empCode);
    return {
      as_of: result.as_of,
      summary: {
        ...result.summary,
        red_7_days: result.items.filter((x) => attention(x, today).level !== 'normal').length,
        management_14_days: result.items.filter((x) => attention(x, today).escalate_management).length,
      },
      items: result.items.slice(0, isAdmin ? 100 : 20).map((x) => publicItem(x, today)),
      not_activated: result.not_activated.slice(0, isAdmin ? 100 : 20),
      reactivated: result.reactivated,
    };
  }

  return { gateFor, submitActions, summaryFor, analyzeScope };
}

module.exports = { STATE_NAME, CHECKPOINT_NAME, MAX_GATE_ITEMS, localYmd, checkpointKey, attention, createDormantService };
