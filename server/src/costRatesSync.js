'use strict';
/**
 * KHO % CHI PHÍ CỤC BỘ THEO KỲ + ĐỒNG BỘ CHỦ ĐỘNG (SPEC_COST_RATES_LOCAL_SYNC)
 * CEO chốt 08/08/2026: *"kéo % về đây rồi thì DataHub chết cũng không ảnh hưởng —
 * dữ liệu nằm bên này; chỉ khi đồng bộ mới mới cần nó sống."*
 *
 * Khác `employeeCostRateSnapshot` (bị động, nhớ khi tình cờ lấy được, theo từng NV):
 * kho này là BẢN SAO CHỦ ĐỘNG theo KỲ — CEO bấm nút, kéo đủ cả đội một lượt.
 *
 * ‼ Ba luật không đổi:
 *  1. ALL-OR-NOTHING theo kỳ: kéo đủ MỌI NV mới ghi đè; hụt một người ⇒ giữ nguyên
 *     bản tốt đang có, báo rõ ai hỏng. Nửa đội số mới nửa đội số cũ là loại lệch
 *     không ai lần ra được.
 *  2. Số nào cũng có căn cước: fetchedAt · fetchedBy · đổi bao nhiêu cặp so bản trước.
 *  3. App Report KHÔNG sửa %: kho chỉ chép, nguồn sự thật vẫn là DataHub.
 */

const persist = require('./persist');
const employeeCost = require('./employeeCost');
const rateSnapshot = require('./employeeCostRateSnapshot');
const employeeCostTemplates = require('./employeeCostTemplates');

const FILE = 'cost_rates_local';
const AUDIT_FILE = 'cost_rates_sync_audit';
const MAX_PERIODS = 12;
const AUDIT_LIMIT = 300;

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const isPeriod = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));

function readAll(store = persist) {
  const rows = store.load(FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

/** Trạng thái kho của một kỳ — cho UI hiện "số tính đến …". Chưa có ⇒ null, không bịa. */
function statusOf(period, { store = persist } = {}) {
  const entry = readAll(store)[text(period)];
  if (!entry) return null;
  return {
    period: text(period),
    fetchedAt: entry.fetchedAt || null,
    fetchedBy: entry.fetchedBy || null,
    sourceVersion: entry.sourceVersion || null,
    employeeCount: Object.keys(entry.employees || {}).length,
    pairCount: Object.keys(entry.pairSignatures || {}).length,
  };
}

function listStatus({ store = persist } = {}) {
  return Object.keys(readAll(store)).sort().map((period) => statusOf(period, { store }));
}

/** Bản tỷ lệ đã lưu cho một NV trong kỳ — cho tầng đọc dùng dần (bước chuyển 2). */
function readEmployee(period, empCode, { store = persist } = {}) {
  const entry = readAll(store)[text(period)];
  const kept = entry?.employees?.[upper(empCode)];
  if (!kept || !Array.isArray(kept.rows) || !kept.rows.length) return null;
  return { columns: kept.columns || [], rows: kept.rows, fetchedAt: entry.fetchedAt || null };
}

// Chữ ký %: mỗi cặp (đơn vị × mã hàng) → chuỗi giá trị các cột chi phí. Dùng để
// đếm "đổi bao nhiêu cặp" giữa hai lần đồng bộ — kể cả khi số hiệu bản không đổi.
function pairSignatures(employees, costColumns) {
  const signatures = {};
  for (const empCode of Object.keys(employees).sort()) {
    for (const row of employees[empCode].rows || []) {
      const unit = upper(row.unit_code ?? row.c7);
      const product = upper(row.c5 ?? row.product_code);
      if (!unit || !product) continue;
      const values = costColumns.map((key) => {
        const raw = row?.[key];
        return raw == null || raw === '' || !Number.isFinite(Number(raw)) ? '—' : String(Number(raw));
      });
      // Cùng cặp xuất hiện ở nhiều NV: giá trị phải như nhau; khác nhau thì ghi
      // 'XUNG_DOT' để phép so lần sau lộ ra, không im lặng lấy bừa một bên.
      const key = `${unit}\u001f${product}`;
      const signature = values.join('\u001f');
      signatures[key] = signatures[key] == null || signatures[key] === signature ? signature : 'XUNG_DOT';
    }
  }
  return signatures;
}

function diffSignatures(before = {}, after = {}) {
  let changed = 0; let added = 0; let removed = 0;
  for (const key of Object.keys(after)) {
    if (!(key in before)) added += 1;
    else if (before[key] !== after[key]) changed += 1;
  }
  for (const key of Object.keys(before)) if (!(key in after)) removed += 1;
  return { changed, added, removed };
}

function writeAudit(entry, { store = persist } = {}) {
  const rows = store.load(AUDIT_FILE, []);
  const list = Array.isArray(rows) ? rows : [];
  list.unshift(entry);
  store.save(AUDIT_FILE, list.slice(0, AUDIT_LIMIT));
}

/**
 * Đồng bộ MỘT KỲ cho danh sách NV. CEO bấm mới chạy — route chặn `requireCeo`.
 * Trả về kết quả đầy đủ để UI nói thật: kéo được bao nhiêu, ai hỏng, đổi gì.
 */
async function syncPeriod({
  period,
  empCodes,
  actor,
  fetchImpl = employeeCost.fetchRawEmployeeCost,
  store = persist,
  now = () => new Date().toISOString(),
} = {}) {
  if (!isPeriod(period)) {
    throw Object.assign(new Error('Kỳ không hợp lệ'), { status: 400, code: 'COST_SYNC_PERIOD_INVALID' });
  }
  const codes = [...new Set((empCodes || []).map(upper).filter((code) => /^(DN|VP)\d{3}$/.test(code)))].sort();
  if (!codes.length) {
    throw Object.assign(new Error('Không có nhân viên nào để đồng bộ — kiểm APP_REPORT_EMPLOYEE_COST_KEYS'), { status: 400, code: 'COST_SYNC_NO_EMPLOYEES' });
  }
  const who = upper(actor);
  if (!who) throw Object.assign(new Error('Thiếu người thao tác'), { status: 400, code: 'COST_SYNC_ACTOR_REQUIRED' });

  const employees = {};
  const failures = [];
  // Gọi TUẦN TỰ — DataHub từng kẹt vì dồn tải; 21 lượt tuần tự vẫn xong trong ~1 phút.
  for (const empCode of codes) {
    let result;
    try { result = await fetchImpl(empCode, { from: period, to: period }); }
    catch (error) { failures.push({ empCode, outcome: 'exception', message: String(error?.message || error) }); continue; }
    const periodPayload = (result?.payload?.periods || []).find((item) => item.period === period);
    if (result?.outcome === 'ok' && rateSnapshot.isStorable(periodPayload)) {
      employees[empCode] = { columns: periodPayload.columns, rows: periodPayload.rows };
    } else {
      failures.push({ empCode, outcome: String(result?.outcome || 'unknown') });
    }
  }

  const at = now();
  // ① ALL-OR-NOTHING: hụt người nào là KHÔNG ghi gì, giữ nguyên bản tốt đang có.
  if (failures.length) {
    writeAudit({ at, actor: who, period, ok: false, requested: codes.length, fetched: Object.keys(employees).length, failures }, { store });
    return { ok: false, period, requested: codes.length, fetched: Object.keys(employees).length, failures, written: false };
  }

  const template = employeeCostTemplates.resolveTemplate(codes[0]);
  const signatures = pairSignatures(employees, template.costColumns || []);
  const rows = readAll(store);
  const diff = diffSignatures(rows[period]?.pairSignatures, signatures);

  rows[period] = { period, fetchedAt: at, fetchedBy: who, sourceVersion: null, employees, pairSignatures: signatures };
  const keys = Object.keys(rows).sort();
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PERIODS))) delete rows[stale];
  store.save(FILE, rows);

  // Cầu nối: nạp luôn vào kho bị động sẵn có để đường fallback hiện hành hưởng ngay,
  // không phải chờ bước chuyển 2 của tầng đọc.
  for (const empCode of codes) {
    try {
      rateSnapshot.write(empCode, period, { ...employees[empCode], period }, { store });
    } catch { /* kho phụ hỏng không làm hỏng kết quả đồng bộ */ }
  }

  const summary = {
    ok: true, period, requested: codes.length, fetched: codes.length, written: true,
    fetchedAt: at, pairCount: Object.keys(signatures).length, diff, failures: [],
  };
  writeAudit({ at, actor: who, period, ok: true, requested: codes.length, fetched: codes.length, pairCount: summary.pairCount, diff }, { store });
  return summary;
}

/** Danh sách NV để đồng bộ = đúng các mã có khoá chi phí riêng trong cấu hình. */
function rosterFromEnv(env = process.env) {
  return [...employeeCost.parseEmployeeCostKeys(env.APP_REPORT_EMPLOYEE_COST_KEYS).keys()].sort();
}

function listAudit({ store = persist, limit = 20 } = {}) {
  const rows = store.load(AUDIT_FILE, []);
  return (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, Number(limit) || 0));
}

module.exports = {
  FILE, AUDIT_FILE, MAX_PERIODS,
  statusOf, listStatus, readEmployee, pairSignatures, diffSignatures,
  syncPeriod, rosterFromEnv, listAudit,
};
