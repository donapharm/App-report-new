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
 *  2. Số nào cũng có căn cước: fetchedAt · fetchedBy · đổi bao nhiêu dòng danh mục so bản trước.
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
const MAX_LINE_EXCLUSION_RATE = 0.01;

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
    // Danh sách NV kho ĐANG CÓ — để màn nói được "có S/21, thiếu ai", thay vì chỉ
    // một con số đếm không truy được.
    employees: Object.keys(entry.employees || {}).sort(),
    rowCount: Object.keys(entry.lineSignatures || entry.pairSignatures || {}).length,
    pairCount: Object.keys(entry.lineSignatures || entry.pairSignatures || {}).length,
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

// Chữ ký % theo đúng grain dòng DataHub: đơn vị × QLNB × tên hàng × ĐVT.
// Không được gộp các thuốc khác nhau chỉ vì dùng chung QLNB.
function collectLineSignatures(employees, costColumns) {
  const signatures = {};
  const exclusions = [];
  let sourceRows = 0;
  for (const empCode of Object.keys(employees).sort()) {
    for (const [rowIndex, row] of (employees[empCode].rows || []).entries()) {
      sourceRows += 1;
      const unit = upper(row.unit_code ?? row.c7);
      const product = upper(row.c5 ?? row.product_code);
      const productName = upper(row.c16 ?? row.product_name);
      const uom = upper(row.c25 ?? row.uom);
      const missingFields = [!unit && 'unit', !product && 'product', !productName && 'productName', !uom && 'uom'].filter(Boolean);
      if (missingFields.length) {
        exclusions.push({ code: 'COST_SYNC_LINE_IDENTITY_MISSING', reason: 'missing_line_identity', empCode, rowIndex, missingFields });
        continue;
      }
      const values = costColumns.map((key) => {
        const raw = row?.[key];
        return raw == null || raw === '' || !Number.isFinite(Number(raw)) ? '—' : String(Number(raw));
      });
      // Cùng dòng xuất hiện ở nhiều NV: giá trị phải như nhau; khác nhau thì ghi
      // 'XUNG_DOT' để phép so lần sau lộ ra, không im lặng lấy bừa một bên.
      const key = `${unit}\u001f${product}\u001f${productName}\u001f${uom}`;
      const signature = values.join('\u001f');
      signatures[key] = signatures[key] == null || signatures[key] === signature ? signature : 'XUNG_DOT';
    }
  }
  return { signatures, exclusions, sourceRows, includedRows: sourceRows - exclusions.length };
}

function lineSignatures(employees, costColumns) {
  return collectLineSignatures(employees, costColumns).signatures;
}
const pairSignatures = lineSignatures;

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
  // Nghỉ giữa hai lượt gọi. Bằng chứng 08/08: DataHub tự restart vì RSS 951,8 MB
  // vượt ngưỡng 900 MiB khi bị đọc dồn. Gọi tuần tự thôi là chưa đủ — 21 lượt liên
  // tiếp không cho nguồn kịp thu hồi bộ nhớ giữa các lượt. Nghỉ một nhịp ngắn đổi
  // lấy việc đồng bộ chạy trót lọt: all-or-nothing nên nguồn ngã giữa chừng là hỏng
  // cả lượt, phải bấm lại từ đầu.
  pauseMs = Number(process.env.COST_SYNC_PAUSE_MS ?? 250),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
  // Gọi TUẦN TỰ + nghỉ một nhịp giữa các lượt — DataHub từng kẹt vì dồn tải, và
  // 08/08 còn tự restart vì hết bộ nhớ khi bị đọc dồn. 21 lượt vẫn xong trong ~1 phút.
  const wait = Number.isFinite(pauseMs) && pauseMs > 0 ? pauseMs : 0;
  let first = true;
  for (const empCode of codes) {
    if (!first && wait) await sleep(wait);
    first = false;
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
  const rows = readAll(store);
  const previous = rows[period];
  const fetchedCodes = Object.keys(employees).sort();
  const previousCodes = Object.keys(previous?.employees || {}).sort();
  const missing = codes.filter((code) => !employees[code]);

  // CEO chốt 21/08/2026: nút đồng bộ là giao dịch 21/21. Hụt một NV thì giữ
  // nguyên bản kho trước đó; tuyệt đối không công bố một kỳ trộn nhiều lần kéo.
  if (missing.length) {
    writeAudit({ at, actor: who, period, ok: false, requested: codes.length,
      fetched: fetchedCodes.length, stored: previousCodes.length, missing, complete: false, failures }, { store });
    return {
      ok: false, period, requested: codes.length, fetched: fetchedCodes.length, written: false,
      stored: previousCodes.length, missing, complete: false, gained: 0, failures,
    };
  }

  const template = employeeCostTemplates.resolveTemplate(codes[0]);
  const identity = collectLineSignatures(employees, template.costColumns || []);
  const { signatures, exclusions, sourceRows, includedRows } = identity;
  const exclusionRate = sourceRows ? exclusions.length / sourceRows : 0;
  if (!includedRows || exclusionRate > MAX_LINE_EXCLUSION_RATE) {
    const code = !includedRows ? 'COST_SYNC_NO_IDENTIFIED_LINES' : 'COST_SYNC_LINE_EXCLUSION_RATE_EXCEEDED';
    const failure = { code, sourceRows, includedRows, excludedRows: exclusions.length, exclusionRate, threshold: MAX_LINE_EXCLUSION_RATE };
    writeAudit({ at, actor: who, period, ok: false, requested: codes.length,
      fetched: Object.keys(employees).length, failures: [...failures, failure],
      lineIdentity: { ...failure, exceptions: exclusions } }, { store });
    throw Object.assign(new Error(!includedRows
      ? 'Không có dòng chi phí nào đủ định danh để lập chữ ký; giữ nguyên kho hiện tại.'
      : `Tỷ lệ dòng chi phí thiếu định danh ${(exclusionRate * 100).toFixed(2)}% vượt ngưỡng ${(MAX_LINE_EXCLUSION_RATE * 100).toFixed(2)}%; giữ nguyên kho hiện tại.`), {
      status: 502, code, sourceRows, includedRows, exclusions, exclusionRate, threshold: MAX_LINE_EXCLUSION_RATE,
    });
  }
  const diff = diffSignatures(previous?.lineSignatures || previous?.pairSignatures, signatures);

  rows[period] = { period, fetchedAt: at, fetchedBy: who, sourceVersion: null, employees, lineSignatures: signatures };
  const keys = Object.keys(rows).sort();
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PERIODS))) delete rows[stale];
  store.save(FILE, rows);

  const summary = {
    ok: true, period, requested: codes.length, fetched: Object.keys(employees).length, written: true,
    stored: fetchedCodes.length, missing: [], complete: true, gained: fetchedCodes.filter((code) => !previous?.employees?.[code]).length,
    fetchedAt: at, rowCount: Object.keys(signatures).length, pairCount: Object.keys(signatures).length, diff, failures,
    lineIdentity: { sourceRows, includedRows, excludedRows: exclusions.length, exclusionRate,
      threshold: MAX_LINE_EXCLUSION_RATE, exceptions: exclusions },
  };
  writeAudit({ at, actor: who, period, ok: true, requested: codes.length, fetched: summary.fetched,
    stored: summary.stored, missing, complete: summary.complete, rowCount: summary.rowCount, diff, failures,
    lineIdentity: summary.lineIdentity }, { store });
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
  FILE, AUDIT_FILE, MAX_PERIODS, MAX_LINE_EXCLUSION_RATE,
  statusOf, listStatus, readEmployee, collectLineSignatures, lineSignatures, pairSignatures, diffSignatures,
  syncPeriod, rosterFromEnv, listAudit,
};
