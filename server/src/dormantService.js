'use strict';

const dormant = require('./dormantQlnb');
const xuPolicy = require('./xuPolicy');
const { reviewState } = require('./dormantNotifications');

const STATE_NAME = 'dormant_qlnb_state';
const CHECKPOINT_NAME = 'dormant_qlnb_checkpoints';
const MAX_GATE_ITEMS = 5;
const MAX_ACTION_DAYS = 14;
const NOTE_REQUIRED = new Set(['blocked', 'national_tender_forecast', 'debt_blocked', 'insurance_mapping_blocked', 'no_demand', 'inactive_assignment', 'other']);

function upper(v) { return String(v || '').trim().toUpperCase(); }
function dateOnly(v) { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function localYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(value, days) {
  const date = dateOnly(value) ? new Date(`${dateOnly(value)}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function sourceName(v) { return ['revenue', 'analysis', 'revenueFull'].includes(String(v || '')) ? String(v) : 'revenue'; }
function checkpointKey(empCode, today) { return `${upper(empCode)}:${xuPolicy.startOfWeek(today)}`; }
function exactKeys(items = []) { return [...new Set(items.map((x) => x.key).filter(Boolean))].sort(); }
function safeNote(value, max = 1000) {
  const note = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim().slice(0, max) : '';
  if (!note) return '';
  // Action notes are unstructured user input.  Export only plain operational
  // prose: any numeric/currency token or cost/revenue vocabulary fails closed.
  // Dates and cycles already have dedicated structured fields in the report.
  const sensitive = /\d|[%₫$€£¥]|\b(?:cp(?:\s*total|[\s._-]*\d+)?|remain[\s_-]*amount|bid[\s_-]*price|margin|profit|costs?|price|vnd|usd|eur)\b|giá(?:\s*(?:vốn|bán|trị))?|chi\s*phí|doanh\s*(?:thu|số)|lợi\s*nhuận|phần\s*trăm|tiền|đồng|triệu|tỷ|nghìn/iu.test(note);
  return sensitive ? '[Nội dung nhạy cảm đã được ẩn]' : note;
}

// Deliberately whitelist the drill-down contract.  A QLNB detail must never
// inherit newly-added CST/cost fields through an object spread.
function safeAudit(audit = []) {
  const allowedChanges = new Set(['status', 'next_follow_up', 'note', 'action_cycle', 'last_activity_at', 'days_idle']);
  return (Array.isArray(audit) ? audit : []).map((entry) => ({
    at: String(entry?.at || '').slice(0, 30) || null,
    actor: upper(entry?.actor) || 'SYSTEM',
    type: String(entry?.type || '').slice(0, 60),
    changes: Object.fromEntries(Object.entries(entry?.changes || {}).filter(([key]) => allowedChanges.has(key)).map(([key, value]) => {
      if (key === 'note') return [key, safeNote(value)];
      if (['action_cycle', 'days_idle'].includes(key)) return [key, Number.isFinite(Number(value)) ? Number(value) : null];
      if (['next_follow_up', 'last_activity_at'].includes(key)) return [key, dateOnly(value)];
      return [key, String(value == null ? '' : value).slice(0, 80)];
    })),
  }));
}
function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function safeDetailItem(item, stateRow, today) {
  const attention = reviewAttention(item, today);
  const initialQty = finiteOrNull(item.cst?.initial_qty);
  const remainQty = finiteOrNull(item.cst?.remain_qty);
  return {
    key: item.key,
    emp_code: upper(item.emp_code),
    employee_name: String(item.employee_name || ''),
    unit_code: String(item.unit_code || ''),
    unit_name: String(item.unit_name || ''),
    iit_code: String(item.iit_code || ''),
    product_name: String(item.product_name || ''),
    route: String(item.route || ''),
    classification: 'dormant',
    first_activity_at: dateOnly(item.first_activity_at),
    last_activity_at: dateOnly(item.last_activity_at),
    date_precision: ['day', 'month'].includes(String(item.date_precision || '')) ? String(item.date_precision) : null,
    first_detected_at: dateOnly(item.first_detected_at),
    days_idle: Number(item.days_idle || 0),
    threshold_days: Number(item.threshold_days || 0),
    historical_quantity: Number(item.historical_quantity || 0),
    positive_order_rows: Number(item.positive_order_rows || 0),
    average_cadence_days: item.average_cadence_days == null ? null : Number(item.average_cadence_days),
    initial_qty: initialQty,
    remain_qty: remainQty,
    remain_percent: initialQty != null && initialQty > 0 && remainQty != null ? Math.round((remainQty / initialQty) * 10000) / 100 : null,
    c30_available: !!item.cst?.c30_available,
    c30_qty: finiteOrNull(item.cst?.c30_qty),
    c30_remaining_qty: finiteOrNull(item.cst?.c30_remaining_qty),
    c30_status: String(item.cst?.c30_status || ''),
    bid_package: String(item.cst?.bid_package || ''),
    contract_to: dateOnly(item.cst?.contract_to),
    priority_score: Number(item.priority?.score || 0),
    priority_reasons: (item.priority?.evidence || []).map(String),
    action: {
      status: item.action?.status || null,
      next_follow_up: dateOnly(item.action?.next_follow_up),
      note: safeNote(item.action?.note),
      updated_at: dateOnly(item.action?.updated_at),
      action_cycle: Number(item.action?.cycle || 0),
      cycle: Number(item.action?.cycle || 0),
    },
    review_status: attention.status,
    days_due: attention.days_left == null ? null : Math.max(0, Number(attention.days_left)),
    days_overdue: Number(attention.overdue_days || 0),
    dormant_cycle: Math.max(0, Number(stateRow?.cycle || 0)),
    attention,
    audit: safeAudit(stateRow?.audit || []),
  };
}

function reviewAttention(item, today) {
  const review = reviewState(item, today);
  const level = review.status === 'overdue' ? 'management'
    : review.status === 'due' ? 'red'
      : review.status === 'upcoming' ? 'warning' : 'normal';
  return {
    ...review,
    level,
    escalate_management: review.status === 'overdue',
    action_window_days: MAX_ACTION_DAYS,
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
    attention: reviewAttention(item, today),
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

// 0 = đến/quá hạn review; 1 = chưa có kế hoạch; 2 = đang triển khai trong hạn.
function gateTier(item, today) {
  const action = item?.action || {};
  const follow = dateOnly(action.next_follow_up);
  if (follow && follow <= today) return 0;
  if (!action.status || !follow) return 1;
  return 2;
}
function gateComparator(today) {
  return (a, b) => gateTier(a, today) - gateTier(b, today)
    || Number(b.priority?.score || 0) - Number(a.priority?.score || 0)
    || Number(b.days_idle || 0) - Number(a.days_idle || 0)
    || String(a.key || '').localeCompare(String(b.key || ''), 'vi');
}
function eligibleItems(items = [], today) {
  return items.filter((item) => gateTier(item, today) < 2).sort(gateComparator(today));
}
function selectFocusUnit(items = [], today) {
  const grouped = new Map();
  for (const item of eligibleItems(items, today)) {
    const code = String(item.unit_code || '').trim();
    if (!code) continue;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(item);
  }
  const units = [...grouped.entries()].map(([unit_code, rows]) => ({
    unit_code,
    unit_name: rows.find((x) => x.unit_name)?.unit_name || unit_code,
    rows: rows.sort(gateComparator(today)),
    tier: Math.min(...rows.map((x) => gateTier(x, today))),
    due_count: rows.filter((x) => gateTier(x, today) === 0).length,
    top_score: Math.max(...rows.map((x) => Number(x.priority?.score || 0))),
    top_days_idle: Math.max(...rows.map((x) => Number(x.days_idle || 0))),
  }));
  units.sort((a, b) => a.tier - b.tier
    || b.top_score - a.top_score
    || b.due_count - a.due_count
    || b.rows.length - a.rows.length
    || b.top_days_idle - a.top_days_idle
    || a.unit_code.localeCompare(b.unit_code, 'vi'));
  return units[0] || null;
}
function summaryReview(items = [], today) {
  const statuses = items.map((item) => reviewState(item, today));
  return {
    in_progress: statuses.filter((x) => x.status === 'in_progress').length,
    upcoming_3_days: statuses.filter((x) => x.status === 'upcoming').length,
    due_review: statuses.filter((x) => x.status === 'due').length,
    overdue_review: statuses.filter((x) => x.status === 'overdue').length,
    unplanned: statuses.filter((x) => x.status === 'unplanned').length,
  };
}

function createDormantService({ store, scoreForEmp, persist, notificationStore = null, feedbackStore = null, clock = () => new Date() } = {}) {
  if (!store || !persist) throw new Error('Dormant service thiếu store/persist');
  const loadState = () => persist.load(STATE_NAME, { version: 1, items: {} });
  const saveState = (value) => persist.save(STATE_NAME, value);
  const loadCheckpoints = () => persist.load(CHECKPOINT_NAME, { version: 2, acknowledgements: {} });
  const saveCheckpoints = (value) => persist.save(CHECKPOINT_NAME, value);

  function analyzeScope(empCode) {
    const scope = empCode ? { empCode: upper(empCode) } : {};
    const kys = store.periodKys();
    const salesRows = store.getRowsRange({ kys, scope });
    const cstRows = store.getCst({ scope });
    const asOf = resolveAsOf(store, salesRows);
    if (!asOf) throw new Error('Chưa có ngày dữ liệu để tính QLNB ngủ đông');
    const result = dormant.analyze({ salesRows, cstRows, dataAsOf: asOf, scope, state: loadState(), maxPriority: MAX_GATE_ITEMS });
    saveState(result.state);
    // Ghi sự kiện ngay tại lần phân tích phát hiện transition. Nếu chờ đến lúc
    // CEO mở chuông thì summary/gate có thể đã tiêu thụ transition reactivated.
    if (notificationStore) {
      const today = localYmd(clock());
      notificationStore.syncReviewEvents({
        items: result.items.map((item) => ({
          ...publicItem(item, today),
          dormant_cycle: Math.max(0, Number(result.state?.items?.[item.key]?.cycle || 0)),
        })),
        reactivated: result.reactivated,
        today,
      });
    }
    return result;
  }

  function saveCompletedWorkflow({ checkpoints, cpKey, existing, source, focus, result, today, handledKeys = [] }) {
    checkpoints.version = 2;
    checkpoints.acknowledgements = checkpoints.acknowledgements || {};
    checkpoints.acknowledgements[cpKey] = {
      ...(existing || {}),
      status: 'completed',
      unit_code: focus?.unit_code || existing?.unit_code || null,
      unit_name: focus?.unit_name || existing?.unit_name || null,
      source: sourceName(source),
      started_at: existing?.started_at || new Date(clock()).toISOString(),
      completed_at: new Date(clock()).toISOString(),
      handled_keys: exactKeys([...(existing?.handled_keys || []).map((key) => ({ key })), ...handledKeys.map((key) => ({ key }))]),
      known_keys: result.items.map((item) => item.key),
      deferred_due_keys: result.items.filter((item) => gateTier(item, today) === 0).map((item) => item.key),
    };
    saveCheckpoints(checkpoints);
    return checkpoints.acknowledgements[cpKey];
  }

  function gateFor({ empCode, source, suppressNextUnit = false } = {}) {
    const emp = upper(empCode);
    if (!emp) throw new Error('Chỉ nhân viên đã định danh mới dùng AI canh cửa');
    const today = localYmd(clock());
    const result = analyzeScope(emp);
    const checkpoints = loadCheckpoints();
    const cpKey = checkpointKey(emp, today);
    let workflow = checkpoints.acknowledgements?.[cpKey] || null;
    // Checkpoint v1 chưa có status. Xem đó là workflow đã hoàn thành để không
    // mở lại backlog cũ trong cùng tuần.
    if (workflow && !workflow.status && (workflow.at || workflow.known_keys || workflow.item_keys)) {
      workflow = { ...workflow, status: 'completed' };
    }
    let candidates = [];
    let trigger = null;

    if (workflow?.status === 'in_progress' && workflow.unit_code) {
      candidates = eligibleItems(result.items.filter((item) => item.unit_code === workflow.unit_code), today);
      trigger = candidates.length ? 'same_unit_next_batch' : null;
      if (!candidates.length) workflow = saveCompletedWorkflow({ checkpoints, cpKey, existing: workflow, source, focus: workflow, result, today });
    } else if (workflow?.status === 'completed') {
      const knownKeys = new Set(workflow.known_keys || workflow.item_keys || []);
      candidates = suppressNextUnit ? [] : eligibleItems(result.items.filter((item) => (
        !knownKeys.has(item.key) || gateTier(item, today) === 0
      )), today);
      trigger = candidates.length ? 'new_or_due' : null;
    } else {
      candidates = eligibleItems(result.items, today);
      trigger = candidates.length ? 'weekly_unit_focus' : null;
    }

    let focus = null;
    if (workflow?.status === 'in_progress' && workflow.unit_code && candidates.length) {
      focus = {
        unit_code: workflow.unit_code,
        unit_name: workflow.unit_name || candidates[0]?.unit_name || workflow.unit_code,
        rows: candidates,
      };
    } else if (candidates.length) focus = selectFocusUnit(candidates, today);

    const focusRows = focus?.rows || [];
    const selected = focusRows.slice(0, MAX_GATE_ITEMS);
    const handledCount = workflow?.status === 'in_progress' ? (workflow.handled_keys || []).length : 0;
    const requiredItems = selected.map((item) => ({
      ...publicItem(item, today),
      selection_reason: gateTier(item, today) === 0 ? 'follow_up_due' : 'unplanned',
    }));
    const xu = typeof scoreForEmp === 'function'
      ? xuPolicy.buildCheckpoint({ empCode: emp, asOf: result.as_of, scoreFn: scoreForEmp, priorBookedAdjustment: null })
      : null;
    const review = summaryReview(result.items, today);

    return {
      as_of: result.as_of,
      generated_on: today,
      follow_up_max: addDays(today, MAX_ACTION_DAYS),
      action_window_days: MAX_ACTION_DAYS,
      source: sourceName(source),
      checkpoint_key: cpKey,
      must_answer: requiredItems.length > 0,
      trigger: requiredItems.length ? trigger : null,
      focus_unit: focus ? {
        unit_code: focus.unit_code,
        unit_name: focus.unit_name,
        batch_size: requiredItems.length,
        batch_number: Math.floor(handledCount / MAX_GATE_ITEMS) + 1,
        eligible_total: focusRows.length + handledCount,
        remaining_after_batch: Math.max(0, focusRows.length - requiredItems.length),
      } : null,
      summary: {
        dormant_total: result.summary.dormant,
        newly_dormant: result.summary.newly_dormant,
        due: review.due_review + review.overdue_review + review.unplanned,
        reactivated: result.summary.reactivated,
        not_activated: result.summary.not_activated,
        ...review,
        red_7_days: review.due_review,
        management_14_days: review.overdue_review,
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
    const maxFollow = addDays(today, MAX_ACTION_DAYS);
    const validated = actions.map((action) => {
      if (!dormant.ACTION_STATUSES.includes(action.status)) throw new Error(`Trạng thái không hợp lệ: ${action.status || '(rỗng)'}`);
      const follow = dateOnly(action.next_follow_up);
      if (!follow || follow <= today) throw new Error('Ngày theo dõi lại phải sau ngày hiện tại');
      if (follow > maxFollow) throw new Error(`Ngày theo dõi lại tối đa ${MAX_ACTION_DAYS} ngày kể từ hôm nay`);
      const note = String(action.note || '').trim();
      if (NOTE_REQUIRED.has(action.status) && note.length < 3) throw new Error('Vui lòng ghi rõ lý do cho kết quả đã chọn');
      return { key: action.key, status: action.status, next_follow_up: follow, note };
    });

    let state = loadState();
    for (const action of validated) state = dormant.updateAction({ state, ...action, actor: emp, now: today });
    saveState(state);
    const afterAction = analyzeScope(emp);
    const focusCode = gate.focus_unit?.unit_code;
    const remainingSameUnit = eligibleItems(afterAction.items.filter((item) => item.unit_code === focusCode), today);
    const checkpoints = loadCheckpoints();
    checkpoints.version = 2;
    checkpoints.acknowledgements = checkpoints.acknowledgements || {};
    const existing = checkpoints.acknowledgements[gate.checkpoint_key] || {};
    const handledKeys = exactKeys([...(existing.handled_keys || []).map((key) => ({ key })), ...validated]);

    if (remainingSameUnit.length) {
      checkpoints.acknowledgements[gate.checkpoint_key] = {
        ...existing,
        status: 'in_progress',
        unit_code: focusCode,
        unit_name: gate.focus_unit?.unit_name || focusCode,
        source: sourceName(source),
        started_at: existing.started_at || new Date(clock()).toISOString(),
        updated_at: new Date(clock()).toISOString(),
        handled_keys: handledKeys,
      };
      saveCheckpoints(checkpoints);
    } else {
      saveCompletedWorkflow({ checkpoints, cpKey: gate.checkpoint_key, existing, source, focus: gate.focus_unit, result: afterAction, today, handledKeys });
    }

    if (notificationStore && gate.focus_unit) {
      const updatedByKey = new Map(afterAction.items.map((item) => [item.key, item]));
      const updatedItems = validated.map((action) => updatedByKey.get(action.key)).filter(Boolean);
      notificationStore.addPlanBatch({
        empCode: emp,
        employeeName: gate.required_items.find((x) => x.employee_name)?.employee_name,
        unitCode: gate.focus_unit.unit_code,
        unitName: gate.focus_unit.unit_name,
        items: updatedItems,
        at: new Date(clock()).toISOString(),
      });
      // A submitted action is the authoritative "updated" acknowledgement
      // for every employee notification tied to those exact QLNB keys. This
      // stops the three-business-day escalation without trusting the client.
      notificationStore.acknowledge({ itemKeys: validated.map((action) => action.key), empCode: emp, kind: 'updated' });
    }
    // Response sau lô cuối phải đóng canh cửa, không tự nhảy đơn vị. Lần mở
    // màn hình sau vẫn nhắc ngay đơn vị khác đang đến/quá hạn.
    return gateFor({ empCode: emp, source, suppressNextUnit: !remainingSameUnit.length });
  }

  function summaryFor({ empCode, isAdmin = false } = {}) {
    const today = localYmd(clock());
    const result = analyzeScope(isAdmin ? null : empCode);
    const review = summaryReview(result.items, today);
    return {
      as_of: result.as_of,
      summary: {
        ...result.summary,
        ...review,
        red_7_days: review.due_review,
        management_14_days: review.overdue_review,
      },
      items: result.items.map((x) => publicItem(x, today)).sort((a, b) => {
        const rank = { management: 0, red: 1, warning: 2, normal: 3 };
        return (rank[a.attention?.level] ?? 3) - (rank[b.attention?.level] ?? 3)
          || Number(b.priority_score || 0) - Number(a.priority_score || 0)
          || String(a.key || '').localeCompare(String(b.key || ''), 'vi');
      }).slice(0, isAdmin ? 100 : 20),
      not_activated: result.not_activated.slice(0, isAdmin ? 100 : 20),
      reactivated: result.reactivated,
    };
  }

  function detailFor({ key, empCode, isAdmin = false } = {}) {
    const requestedKey = String(key || '').trim();
    const emp = upper(empCode);
    if (!requestedKey) throw new Error('Thiếu khóa QLNB');
    const parsed = dormant.parseKey(requestedKey);
    // Fail before company analysis so a forged employee key cannot become a
    // scope oracle.  Frontend emp_code is never accepted by this method.
    if (!isAdmin && (!emp || upper(parsed.emp_code) !== emp)) {
      const error = new Error('QLNB không thuộc phạm vi được phép');
      error.status = 403;
      throw error;
    }
    const result = analyzeScope(isAdmin ? null : emp);
    const item = result.items.find((row) => row.key === requestedKey);
    if (!item) {
      const error = new Error('QLNB không tồn tại, đã hoàn tất hoặc ngoài phạm vi');
      error.status = 404;
      throw error;
    }
    const stateRow = result.state?.items?.[requestedKey] || {};
    return {
      as_of: result.as_of,
      generated_on: localYmd(clock()),
      item: {
        ...safeDetailItem(item, stateRow, localYmd(clock())),
        ceo_feedback: feedbackStore ? feedbackStore.listForItem(requestedKey, { empCode: isAdmin ? null : emp }) : [],
      },
    };
  }

  function plansForAdmin({ empCode, unitCode } = {}) {
    const today = localYmd(clock());
    const result = analyzeScope(null);
    const items = result.items.map((item) => publicItem(item, today));
    const metrics = (rows) => ({
      total: rows.length,
      unplanned: rows.filter((item) => item.attention?.status === 'unplanned').length,
      in_progress: rows.filter((item) => ['in_progress', 'upcoming'].includes(item.attention?.status)).length,
      due: rows.filter((item) => item.attention?.status === 'due').length,
      overdue: rows.filter((item) => item.attention?.status === 'overdue').length,
    });
    const employeeGroups = new Map();
    for (const item of items) {
      const code = upper(item.emp_code);
      if (!code) continue;
      if (!employeeGroups.has(code)) employeeGroups.set(code, []);
      employeeGroups.get(code).push(item);
    }
    const rank = (summary) => summary.overdue * 100000 + summary.due * 10000 + summary.unplanned * 100 + summary.total;
    const employees = [...employeeGroups.entries()].map(([emp_code, rows]) => {
      const summary = metrics(rows);
      return { emp_code, employee_name: rows.find((item) => item.employee_name)?.employee_name || emp_code, ...summary, rank: rank(summary) };
    }).sort((a, b) => b.rank - a.rank || a.emp_code.localeCompare(b.emp_code, 'vi')).map(({ rank: _rank, ...safe }) => safe);
    const requestedEmp = upper(empCode);
    const selectedEmp = employees.some((item) => item.emp_code === requestedEmp) ? requestedEmp : employees[0]?.emp_code || null;
    const employeeItems = selectedEmp ? (employeeGroups.get(selectedEmp) || []) : [];
    const unitGroups = new Map();
    for (const item of employeeItems) {
      const code = String(item.unit_code || '').trim();
      if (!code) continue;
      if (!unitGroups.has(code)) unitGroups.set(code, []);
      unitGroups.get(code).push(item);
    }
    const units = [...unitGroups.entries()].map(([unit_code, rows]) => {
      const summary = metrics(rows);
      return { unit_code, unit_name: rows.find((item) => item.unit_name)?.unit_name || unit_code, ...summary, rank: rank(summary) };
    }).sort((a, b) => b.rank - a.rank || a.unit_code.localeCompare(b.unit_code, 'vi')).map(({ rank: _rank, ...safe }) => safe);
    const requestedUnit = String(unitCode || '').trim();
    const selectedUnit = units.some((item) => item.unit_code === requestedUnit) ? requestedUnit : units[0]?.unit_code || null;
    const selectedItems = selectedUnit ? (unitGroups.get(selectedUnit) || []) : [];
    return {
      generated_on: today,
      as_of: result.as_of,
      company_summary: metrics(items),
      employees,
      selected_emp_code: selectedEmp,
      units,
      selected_unit_code: selectedUnit,
      selected_summary: metrics(selectedItems),
      items: selectedItems.sort(gateComparator(today)).map((item) => ({
        ...item,
        dormant_cycle: Math.max(0, Number(result.state?.items?.[item.key]?.cycle || 0)),
        review_status: item.attention?.status || 'unplanned',
        ceo_feedback: feedbackStore ? feedbackStore.listForItem(item.key) : [],
      })),
      read_only: true,
      feedback_enabled: !!feedbackStore,
    };
  }

  function notificationsForAdmin() {
    if (!notificationStore) return { generated_on: localYmd(clock()), unread_count: 0, counts: {}, events: [] };
    const today = localYmd(clock());
    const result = analyzeScope(null);
    return notificationStore.feed({
      items: result.items.map((item) => ({ ...publicItem(item, today), dormant_cycle: Math.max(0, Number(result.state?.items?.[item.key]?.cycle || 0)) })),
      reactivated: result.reactivated, today, audience: 'ceo',
    });
  }

  function markNotificationsRead(payload) {
    if (!notificationStore) return { ok: true, changed: 0, unread_count: 0 };
    return notificationStore.markRead({ ...(payload || {}), audience: 'ceo' });
  }

  function notificationsForEmployee({ empCode } = {}) {
    const emp = upper(empCode);
    if (!emp) throw new Error('Chưa xác định mã nhân viên');
    if (!notificationStore) return { generated_on: localYmd(clock()), unread_count: 0, counts: {}, events: [] };
    const today = localYmd(clock());
    const result = analyzeScope(emp);
    return notificationStore.feed({
      items: result.items.map((item) => ({ ...publicItem(item, today), dormant_cycle: Math.max(0, Number(result.state?.items?.[item.key]?.cycle || 0)) })),
      reactivated: result.reactivated, today, audience: 'employee', empCode: emp,
    });
  }

  function markEmployeeNotificationsRead({ empCode, ids, all } = {}) {
    const emp = upper(empCode);
    if (!emp) throw new Error('Chưa xác định mã nhân viên');
    if (!notificationStore) return { ok: true, changed: 0, unread_count: 0 };
    return notificationStore.markRead({ ids, all, audience: 'employee', empCode: emp });
  }

  function createFeedbackForAdmin({ key, actionCycle, type, note, actor, requestId } = {}) {
    if (!feedbackStore) throw new Error('Chức năng phản hồi chưa sẵn sàng');
    const requestedKey = String(key || '').trim();
    if (!requestedKey) throw new Error('Thiếu khóa QLNB');
    const result = analyzeScope(null);
    const item = result.items.find((row) => row.key === requestedKey);
    if (!item) {
      const error = new Error('QLNB không tồn tại hoặc đã hoàn tất');
      error.status = 404;
      throw error;
    }
    const stateRow = result.state?.items?.[requestedKey] || {};
    const currentActionCycle = Math.max(0, Number(stateRow.action_cycle || item.action?.cycle || 0));
    if (!item.action?.status || currentActionCycle <= 0) {
      const error = new Error('Nhân viên chưa gửi kế hoạch cho QLNB này');
      error.status = 409;
      throw error;
    }
    if (Number(actionCycle) !== currentActionCycle) {
      const error = new Error('Chu kỳ xử lý đã thay đổi, vui lòng tải lại');
      error.status = 409;
      throw error;
    }
    return feedbackStore.create({
      item: {
        key: item.key,
        emp_code: item.emp_code,
        employee_name: item.employee_name,
        unit_code: item.unit_code,
        unit_name: item.unit_name,
        iit_code: item.iit_code,
        product_name: item.product_name,
        dormant_cycle: Math.max(0, Number(stateRow.cycle || 0)),
      },
      type, note, actionCycle: currentActionCycle, actor, requestId,
    });
  }

  function acknowledgeFeedbackForEmployee({ feedbackId, empCode, kind, requestId } = {}) {
    if (!feedbackStore) throw new Error('Chức năng phản hồi chưa sẵn sàng');
    const emp = upper(empCode);
    if (!emp) throw new Error('Chưa xác định mã nhân viên');
    return feedbackStore.acknowledge({ feedbackId, empCode: emp, kind, requestId });
  }

  function feedbackTelegramPreviewForAdmin(feedbackId) {
    if (!feedbackStore) throw new Error('Chức năng phản hồi chưa sẵn sàng');
    return feedbackStore.telegramPreview(feedbackId);
  }

  return {
    gateFor, submitActions, summaryFor, detailFor, plansForAdmin,
    notificationsForAdmin, markNotificationsRead,
    notificationsForEmployee, markEmployeeNotificationsRead,
    createFeedbackForAdmin, acknowledgeFeedbackForEmployee, feedbackTelegramPreviewForAdmin,
    analyzeScope,
  };
}

module.exports = {
  STATE_NAME, CHECKPOINT_NAME, MAX_GATE_ITEMS, MAX_ACTION_DAYS,
  localYmd, addDays, checkpointKey, reviewAttention, gateTier, selectFocusUnit, safeNote, safeAudit, safeDetailItem, createDormantService,
};
