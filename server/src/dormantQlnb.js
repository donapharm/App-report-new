'use strict';

/**
 * Deterministic QLNB dormant engine.
 *
 * Business key: employee + unit + QLNB. A candidate must have had at least one
 * positive sale. It becomes dormant after 60 complete days without a positive
 * order. Negative/return rows never reset activity.
 *
 * This module does not read/write files and does not call an LLM. Persistence is
 * dependency-injected through createEngine({ loadState, saveState }).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD_DAYS = 60;
const ACTION_STATUSES = Object.freeze([
  'contacted',
  'scheduled',
  'waiting_forecast',
  'expected_order',
  'blocked',
  'national_tender_forecast',
  'debt_blocked',
  'insurance_mapping_blocked',
  'no_demand',
  'inactive_assignment',
  'other',
]);
const ACTION_STATUS_SET = new Set(ACTION_STATUSES);

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function number(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function dateOnly(v) {
  const s = text(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}
function daysBetween(from, to) {
  const a = dateOnly(from), b = dateOnly(to);
  if (!a || !b) return null;
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
function maxDate(values) {
  return values.map(dateOnly).filter(Boolean).sort().at(-1) || null;
}
function monthKey(v) { const d = dateOnly(v); return d ? d.slice(0, 7) : null; }
function monthEnd(v) {
  const d = dateOnly(v);
  if (!d) return null;
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
// Dữ liệu tổng hợp tháng của App Report có toàn bộ dòng mang ngày 01. Chỉ
// nhận diện ở cấp cả kỳ/tháng, không suy luận riêng từng QLNB.
function detectDatePrecision(salesRows = []) {
  const daysByMonth = new Map();
  for (const row of salesRows) {
    const d = rowDate(row);
    if (!d) continue;
    const k = monthKey(d);
    if (!daysByMonth.has(k)) daysByMonth.set(k, new Set());
    daysByMonth.get(k).add(d.slice(8, 10));
  }
  return new Map([...daysByMonth].map(([k, days]) => [k, days.size === 1 && days.has('01') ? 'month' : 'day']));
}
function effectiveActivityDate(v, precisionByMonth) {
  const d = dateOnly(v);
  if (!d) return null;
  return precisionByMonth?.get(monthKey(d)) === 'month' ? monthEnd(d) : d;
}
function splitOwners(v) {
  const raw = Array.isArray(v) ? v : text(v).split(/[,;|]/);
  return [...new Set(raw.map(upper).filter(Boolean))];
}
function rowEmployee(row) { return upper(row.emp_code || row.employee_code || row.ma_nv); }
function rowUnit(row) { return upper(row.unit_code || row.unitCode || row.ma_dv || row.unit_name); }
function rowIit(row) { return upper(row.iit_code || row.productCode || row.ma_qlnb || row.qlnb); }
function rowDate(row) { return dateOnly(row.date || row.order_date || row.invoice_date || row.ngay); }
function rowRevenue(row) { return number(row.revenue ?? row.tong_tien ?? row.amount ?? row.sale_amount); }
function rowQuantity(row) { return number(row.quantity ?? row.qty ?? row.so_luong ?? row.sold_qty_delta); }
function isPositiveSale(row) { return rowRevenue(row) > 0 || rowQuantity(row) > 0; }

function makeKey(empCode, unitCode, iitCode) {
  const parts = [upper(empCode), upper(unitCode), upper(iitCode)];
  if (parts.some((v) => !v)) return null;
  return parts.map(encodeURIComponent).join('|');
}
function parseKey(key) {
  const p = text(key).split('|').map((v) => decodeURIComponent(v));
  return { emp_code: p[0] || '', unit_code: p[1] || '', iit_code: p[2] || '' };
}

function resolveDataAsOf({ salesRows = [], dataAsOf } = {}) {
  const explicit = dateOnly(dataAsOf);
  if (explicit) return explicit;
  const precision = detectDatePrecision(salesRows);
  const rowDates = [];
  for (const row of salesRows) {
    rowDates.push(row.data_as_of, row.dataAsOf, row.period_to, effectiveActivityDate(rowDate(row), precision));
  }
  return maxDate(rowDates);
}

function aggregatePositiveHistory(salesRows = [], scope = {}) {
  const scopedEmp = upper(scope.empCode);
  const precisionByMonth = detectDatePrecision(salesRows);
  const map = new Map();
  for (const row of salesRows) {
    const emp = rowEmployee(row), unit = rowUnit(row), iit = rowIit(row), rawDate = rowDate(row);
    const precision = precisionByMonth.get(monthKey(rawDate)) || 'day';
    const date = effectiveActivityDate(rawDate, precisionByMonth);
    if (!emp || !unit || !iit || !date || !isPositiveSale(row)) continue;
    if (scopedEmp && emp !== scopedEmp) continue;
    const key = makeKey(emp, unit, iit);
    let cur = map.get(key);
    if (!cur) {
      cur = {
        key, emp_code: emp, unit_code: unit, iit_code: iit,
        employee_name: text(row.employee_name || row.emp_name),
        unit_name: text(row.unit_name || row.unitName || row.unit_code),
        product_name: text(row.product_name || row.productName || row.iit_code),
        route: upper(row.route || row.tuyen),
        last_activity_at: date,
        last_activity_raw_at: rawDate,
        date_precision: precision,
        first_activity_at: date,
        positive_order_rows: 0,
        historical_revenue: 0,
        historical_quantity: 0,
        positive_dates: new Set(),
      };
      map.set(key, cur);
    }
    if (date > cur.last_activity_at) {
      cur.last_activity_at = date;
      cur.last_activity_raw_at = rawDate;
      cur.date_precision = precision;
    }
    if (date < cur.first_activity_at) cur.first_activity_at = date;
    cur.positive_order_rows += 1;
    cur.historical_revenue += Math.max(0, rowRevenue(row));
    cur.historical_quantity += Math.max(0, rowQuantity(row));
    cur.positive_dates.add(date);
    if (!cur.employee_name) cur.employee_name = text(row.employee_name || row.emp_name);
    if (!cur.unit_name) cur.unit_name = text(row.unit_name || row.unitName);
    if (!cur.product_name) cur.product_name = text(row.product_name || row.productName);
    if (!cur.route) cur.route = upper(row.route || row.tuyen);
  }
  return [...map.values()].map((x) => {
    const dates = [...x.positive_dates].sort();
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).filter((n) => n != null && n >= 0);
    const averageCadenceDays = gaps.length ? gaps.reduce((s, n) => s + n, 0) / gaps.length : null;
    const { positive_dates, ...safe } = x;
    return { ...safe, average_cadence_days: averageCadenceDays == null ? null : +averageCadenceDays.toFixed(1) };
  });
}

function cstOwners(row) {
  return splitOwners(row.sales_emps || row.salesEmps || row.emp_code || row.employee_code);
}
function cstIsActive(row) {
  if (row.active === false || row.is_active === false) return false;
  const status = upper(row.status || row.assignment_status || row.trang_thai);
  return !/(INACTIVE|EXPIRED|CLOSED|STOPPED|NGUNG|HET HIEU LUC)/.test(status);
}
function c30Available(row) {
  const formula = row.cstFormula || row.cst_formula || {};
  const c30 = row.c30 || {};
  if (row.c30_actionable === true || row.c30Actionable === true || c30.actionable === true) return true;
  if (number(row.c30_remaining ?? row.c30Remaining ?? row.c30_option_qty ?? row.option_qty ?? c30.remaining ?? c30.option_qty) > 0) return true;
  return /CO_THE_MUA_THEM|AVAILABLE|ACTIONABLE/.test(upper(formula.trangThai30 || formula.status || row.c30_status));
}
function cstRemainingKnown(row) {
  return [row.remain_qty, row.remaining_qty, row.slConLai, row.sl_con_lai].some((v) => v != null && v !== '');
}
function cstRemaining(row) {
  return number(row.remain_qty ?? row.remaining_qty ?? row.slConLai ?? row.sl_con_lai);
}
function matchCst(candidate, cstRows = []) {
  const matches = cstRows.filter((row) => {
    if (!cstIsActive(row) || rowUnit(row) !== candidate.unit_code || rowIit(row) !== candidate.iit_code) return false;
    const owners = cstOwners(row);
    return owners.length === 0 || owners.includes(candidate.emp_code);
  });
  if (!matches.length) return null;
  return matches.sort((a, b) => {
    const av = c30Available(a) ? 1 : 0, bv = c30Available(b) ? 1 : 0;
    return bv - av || cstRemaining(b) - cstRemaining(a);
  })[0];
}
function safeCst(row, empCode) {
  if (!row) return null;
  const remainKnown = cstRemainingKnown(row);
  const c30 = c30Available(row);
  return {
    emp_code: empCode,
    unit_code: rowUnit(row),
    iit_code: rowIit(row),
    remain_qty: remainKnown ? cstRemaining(row) : null,
    remain_amount: number(row.remain_amount ?? row.remaining_amount ?? row.remainAmount),
    c30_available: c30,
    bid_package: text(row.bid_package || row.kyThau || row.decisionNo),
    contract_to: dateOnly(row.contract_to || row.contractTo),
  };
}
function definitelyNoSellingCapacity(cst) {
  return !!cst && cst.remain_qty != null && cst.remain_qty <= 0 && !cst.c30_available;
}

function notActivatedCandidates({ history = [], cstRows = [], scope = {} } = {}) {
  const scopedEmp = upper(scope.empCode);
  const activeKeys = new Set(history.map((x) => x.key));
  const found = new Map();
  for (const row of cstRows) {
    if (!cstIsActive(row)) continue;
    const unit = rowUnit(row), iit = rowIit(row);
    if (!unit || !iit) continue;
    const owners = cstOwners(row);
    const scopedOwners = scopedEmp ? (owners.length === 0 || owners.includes(scopedEmp) ? [scopedEmp] : []) : owners;
    for (const emp of scopedOwners) {
      const key = makeKey(emp, unit, iit);
      if (!key || activeKeys.has(key)) continue;
      const safe = safeCst(row, emp);
      if (definitelyNoSellingCapacity(safe)) continue;
      const current = found.get(key);
      const candidate = {
        key,
        emp_code: emp,
        unit_code: unit,
        iit_code: iit,
        unit_name: text(row.unit_name || row.unitName || unit),
        product_name: text(row.product_name || row.productName || iit),
        route: upper(row.route || row.tuyen),
        classification: 'not_activated',
        cst: safe,
      };
      if (!current || number(candidate.cst?.remain_amount) > number(current.cst?.remain_amount)) found.set(key, candidate);
    }
  }
  return [...found.values()].sort((a, b) => number(b.cst?.remain_amount) - number(a.cst?.remain_amount) || a.key.localeCompare(b.key));
}

function normalizeState(input) {
  const state = input && typeof input === 'object' ? input : {};
  return { version: 1, items: { ...(state.items && typeof state.items === 'object' ? state.items : {}) } };
}
function cloneState(input) { return JSON.parse(JSON.stringify(normalizeState(input))); }
function auditEntry({ at, actor, type, changes = {} }) {
  return { at: dateOnly(at) || text(at), actor: upper(actor) || 'SYSTEM', type, changes };
}

function deterministicPriority(item) {
  const days = number(item.days_idle);
  const remainAmount = Math.max(0, number(item.cst?.remain_amount));
  const remainQty = Math.max(0, number(item.cst?.remain_qty));
  const revenue = Math.max(0, number(item.historical_revenue));
  const cadence = number(item.average_cadence_days);
  const cadenceOverdue = cadence > 0 ? Math.max(0, days / cadence - 1) : 0;
  const parts = {
    idle: Math.min(40, 20 + Math.max(0, days - 60) * 0.5),
    capacity: Math.min(25, remainAmount > 0 ? Math.log10(remainAmount + 1) * 3 : (remainQty > 0 || item.cst?.c30_available ? 8 : 0)),
    history: Math.min(20, revenue > 0 ? Math.log10(revenue + 1) * 2.2 : 0),
    cadence: Math.min(10, cadenceOverdue * 5),
    new_signal: item.newly_dormant ? 5 : 0,
  };
  const score = Math.max(0, Math.min(100, Math.round(Object.values(parts).reduce((s, n) => s + n, 0))));
  const evidence = [
    `${days} ngày không có đơn dương`,
    cadence > 0 ? `chu kỳ mua lịch sử khoảng ${Math.round(cadence)} ngày` : 'chưa đủ lịch sử để suy ra chu kỳ mua',
    item.cst ? (item.cst.remain_qty != null ? `CST còn ${item.cst.remain_qty}` : 'CST chưa có số lượng còn lại') : 'chưa có CST khớp',
    `doanh thu dương lịch sử ${Math.round(revenue)}`,
  ];
  if (item.cst?.c30_available) evidence.push('còn khả năng mua thêm C30');
  return { score, evidence, score_parts: parts, model: 'deterministic-v1' };
}

function shouldGate(item, asOf) {
  const action = item.action || {};
  if (item.newly_dormant) return { required: true, reason: 'newly_dormant' };
  if (!action.status) return { required: true, reason: 'due_unplanned' };
  const follow = dateOnly(action.next_follow_up);
  if (follow && follow < asOf) return { required: true, reason: 'overdue' };
  if (follow && follow === asOf) return { required: true, reason: 'due_today' };
  return { required: false, reason: null };
}

function analyze({ salesRows = [], cstRows = [], dataAsOf, scope = {}, state: inputState, thresholdDays = DEFAULT_THRESHOLD_DAYS, maxPriority = 5 } = {}) {
  const asOf = resolveDataAsOf({ salesRows, dataAsOf });
  if (!asOf) throw new Error('Không xác định được ngày dữ liệu (dataAsOf)');
  const scopedEmp = upper(scope.empCode);
  const state = cloneState(inputState);
  const history = aggregatePositiveHistory(salesRows, scope);
  const notActivated = notActivatedCandidates({ history, cstRows, scope });
  const byKey = new Map(history.map((x) => [x.key, x]));
  const reactivated = [];

  for (const [key, old] of Object.entries(state.items)) {
    if (scopedEmp && parseKey(key).emp_code !== scopedEmp) continue;
    if (old.resolved_at) continue;
    const current = byKey.get(key);
    const baseline = dateOnly(old.last_activity_at) || dateOnly(old.first_detected_at);
    if (current && baseline && current.last_activity_at > baseline) {
      const resolved = {
        ...old,
        last_activity_at: current.last_activity_at,
        resolved_at: asOf,
        resolution: 'reactivated_by_positive_order',
        audit: [...(old.audit || []), auditEntry({ at: asOf, actor: 'SYSTEM', type: 'reactivated', changes: { last_activity_at: current.last_activity_at } })],
      };
      state.items[key] = resolved;
      reactivated.push({ key, emp_code: current.emp_code, unit_code: current.unit_code, iit_code: current.iit_code, order_at: current.last_activity_at, resolved_at: asOf });
    }
  }

  const items = [];
  for (const candidate of history) {
    const idle = daysBetween(candidate.last_activity_at, asOf);
    if (idle == null || idle < thresholdDays) continue;
    const rawCst = matchCst(candidate, cstRows);
    const cst = safeCst(rawCst, candidate.emp_code);
    if (definitelyNoSellingCapacity(cst)) continue;

    const previous = state.items[candidate.key];
    const reopening = !!previous?.resolved_at;
    const newly = !previous || reopening;
    const persisted = newly ? {
      first_detected_at: asOf,
      last_activity_at: candidate.last_activity_at,
      status: null,
      next_follow_up: null,
      note: '',
      resolved_at: null,
      resolution: null,
      cycle: number(previous?.cycle) + 1,
      action_cycle: 0,
      audit: [...(previous?.audit || []), auditEntry({ at: asOf, actor: 'SYSTEM', type: reopening ? 'reopened_dormant' : 'detected_dormant', changes: { last_activity_at: candidate.last_activity_at, days_idle: idle } })],
    } : { ...previous, last_activity_at: candidate.last_activity_at };
    state.items[candidate.key] = persisted;

    const item = {
      ...candidate,
      days_idle: idle,
      threshold_days: thresholdDays,
      first_detected_at: persisted.first_detected_at,
      newly_dormant: newly,
      cst,
      action: {
        status: persisted.status || null,
        next_follow_up: dateOnly(persisted.next_follow_up),
        note: text(persisted.note),
        updated_at: persisted.action_updated_at || null,
        cycle: number(persisted.action_cycle),
      },
    };
    item.priority = deterministicPriority(item);
    item.gate = shouldGate(item, asOf);
    items.push(item);
  }

  items.sort((a, b) => b.priority.score - a.priority.score || b.days_idle - a.days_idle || a.key.localeCompare(b.key));
  const gate = items.filter((x) => x.gate.required).slice(0, Math.max(0, Math.min(5, number(maxPriority) || 5)));
  return {
    as_of: asOf,
    threshold_days: thresholdDays,
    scope: scopedEmp ? { empCode: scopedEmp } : {},
    summary: {
      dormant: items.length,
      newly_dormant: items.filter((x) => x.newly_dormant).length,
      due: items.filter((x) => x.gate.required).length,
      reactivated: reactivated.length,
      not_activated: notActivated.length,
    },
    items,
    gate,
    not_activated: notActivated,
    reactivated,
    state,
  };
}

function updateAction({ state: inputState, key, status, next_follow_up, note = '', actor, now } = {}) {
  if (!ACTION_STATUS_SET.has(status)) throw new Error(`Trạng thái không hợp lệ: ${status || '(rỗng)'}`);
  const at = dateOnly(now);
  if (!at) throw new Error('Thiếu ngày cập nhật hợp lệ');
  const state = cloneState(inputState);
  const old = state.items[key];
  if (!old || old.resolved_at) throw new Error('QLNB không tồn tại hoặc đã được xử lý xong');
  const follow = next_follow_up == null || next_follow_up === '' ? null : dateOnly(next_follow_up);
  if (next_follow_up && !follow) throw new Error('Ngày theo dõi lại không hợp lệ');
  const changes = { status, next_follow_up: follow, note: text(note) };
  state.items[key] = {
    ...old,
    ...changes,
    action_updated_at: at,
    action_cycle: number(old.action_cycle) + 1,
    audit: [...(old.audit || []), auditEntry({ at, actor, type: 'action_updated', changes: { ...changes, action_cycle: number(old.action_cycle) + 1 } })],
  };
  return state;
}

function createEngine({ loadState, saveState } = {}) {
  let memoryState = normalizeState();
  const load = typeof loadState === 'function' ? loadState : () => memoryState;
  const save = typeof saveState === 'function' ? saveState : (v) => { memoryState = v; };
  return {
    analyze(input = {}) {
      const result = analyze({ ...input, state: load() });
      save(result.state);
      return result;
    },
    updateAction(input = {}) {
      const next = updateAction({ ...input, state: load() });
      save(next);
      return next;
    },
    getState() { return cloneState(load()); },
  };
}

module.exports = {
  DAY_MS,
  DEFAULT_THRESHOLD_DAYS,
  ACTION_STATUSES,
  makeKey,
  parseKey,
  daysBetween,
  resolveDataAsOf,
  detectDatePrecision,
  effectiveActivityDate,
  isPositiveSale,
  aggregatePositiveHistory,
  notActivatedCandidates,
  deterministicPriority,
  shouldGate,
  analyze,
  updateAction,
  createEngine,
};
