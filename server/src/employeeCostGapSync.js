'use strict';

const crypto = require('crypto');
const catalogManagement = require('./catalogManagement');
const persist = require('./persist');

const AUDIT_FILE = 'employee_cost_gap_sync_audit';
const AUDIT_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 6500;
// DataHub receiver (DataHub team build). Contract: DIRECTIVE_EMP_COST_GAP_SYNC_DATAHUB.md §1b.
const ENDPOINT = '/api/integrations/app-report/cost-gap-worklist';
// Trần chống payload phình (blocker 6). Tháng giới hạn ở route (MAX_MONTHS).
const MAX_ITEMS = 5000;
const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
// Worklist đồng bộ chỉ được chứa mã + thống kê ảnh hưởng + doanh thu. Vì item
// dựng theo từng field whitelist bên dưới nên cost/%/PII/C32-C47 vốn không lọt;
// assert này là chốt chặn thứ hai fail-closed nếu payload lỡ dính khóa cấm.
const FORBIDDEN_KEY = /(^|_)(c3[2-9]|c4[0-7]|cost|margin|percent|phantram|phan_tram|payout|hoahong|hoa_hong|thuong|luong|salary|bonus|price|gia|cccd|cmnd|phone|sdt|email|dob|birth|address|diachi)(_|$)/i;

function configured() {
  return catalogManagement.configured();
}
function baseUrl() {
  return String(process.env.DATA_HUB_BASE_URL || '').trim().replace(/\/$/, '');
}
function timeoutMs() {
  return Math.max(1000, Number(process.env.DATA_HUB_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
}
function safeText(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function assertNoForbiddenKeys(value, pathName = 'worklist') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${pathName}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(String(key).replace(/[^a-z0-9_]/gi, ''))) {
      throw Object.assign(new Error(`Trường bị cấm trong worklist đồng bộ: ${pathName}.${key}`), {
        status: 502,
        code: 'GAP_SYNC_FORBIDDEN_FIELD',
      });
    }
    assertNoForbiddenKeys(child, `${pathName}.${key}`);
  }
}

// Dựng worklist thiếu % từ gap payload (backend là nguồn sự thật; body client
// KHÔNG được tin để chống chèn dòng/giả mạo). Chỉ lấy đúng field cần cho DataHub.
// CANONICAL: sort đơn vị trong item + sort items theo mã → checksum độc lập thứ tự
// đầu vào (blocker 4), để DataHub dedupe ổn định dù thứ tự nguồn thay đổi.
function buildWorklist(payload = {}, { actor = '' } = {}) {
  const items = (Array.isArray(payload.items) ? payload.items : []).map((item) => ({
    ma_qlnb: safeText(item.productCode, 160),
    ten_hang: safeText(item.productName, 300),
    don_vi_anh_huong: (Array.isArray(item.unitLabels) ? item.unitLabels : [])
      .map((label) => safeText(label, 240)).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'vi')),
    so_don_vi: num(item.unitCount),
    so_nv: num(item.employeeCount),
    doanh_thu_anh_huong: num(item.revenueAffected),
    ly_do: item.reason === 'qd_mismatch' ? 'qd_mismatch' : 'missing',
    ma_catalog_goi_y: item.suggestedCatalogCode ? safeText(item.suggestedCatalogCode, 160) : null,
  })).filter((item) => item.ma_qlnb)
    .sort((a, b) => a.ma_qlnb.localeCompare(b.ma_qlnb, 'vi'));
  const worklist = {
    from: safeText(payload.from, 7) || null,
    to: safeText(payload.to, 7) || null,
    actor: safeText(actor || 'App Report CEO', 60),
    coverage: {
      matched_pairs: num(payload.coverage?.matchedPairs),
      total_pairs: num(payload.coverage?.totalPairs),
    },
    items,
  };
  // Checksum trên items canonical (đã sort) → độc lập thứ tự nguồn.
  worklist.worklist_checksum = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
  assertNoForbiddenKeys(worklist);
  return worklist;
}

async function pushWorklist(worklist, serialized) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${baseUrl()}${ENDPOINT}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-assignment-key': String(process.env.DATA_HUB_ASSIGNMENT_KEY || ''),
        'x-app-report-actor': worklist.actor,
      },
      body: serialized || JSON.stringify(worklist),
    });
    const body = await response.json().catch(() => ({}));
    // 404 = DataHub chưa build cửa nhận → dormant, không coi là app vỡ.
    if (response.status === 404) {
      throw Object.assign(new Error('DataHub chưa mở cửa nhận worklist thiếu % — dùng tạm Xuất Excel.'), {
        status: 503,
        code: 'GAP_SYNC_RECEIVER_ABSENT',
        dormant: true,
      });
    }
    if (!response.ok) {
      throw Object.assign(new Error(body.error || `DataHub HTTP ${response.status}`), { status: response.status, upstream: true });
    }
    const data = body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data : body;
    // Chỉ xác nhận thành công đúng contract production của receiver:
    // - 201 cho lần nhận mới (deduped=false), 200 cho bản dedupe (deduped=true)
    // - ok:true, worklist_id không rỗng, received khớp chính xác số mã đã gửi
    // - deduped bắt buộc là boolean. Mọi 2xx khác/kết quả thiếu field đều fail-closed.
    const expectedReceived = worklist.items.length;
    const validStatus = (response.status === 201 && data?.deduped === false)
      || (response.status === 200 && data?.deduped === true);
    const validData = data
      && typeof data === 'object'
      && data.ok === true
      && typeof data.worklist_id === 'string'
      && data.worklist_id.trim().length > 0
      && Number.isInteger(data.received)
      && data.received === expectedReceived
      && typeof data.deduped === 'boolean';
    if (!validStatus || !validData) {
      throw Object.assign(new Error('DataHub trả response không đúng contract nhận worklist; coi như chưa nhận chắc.'), {
        status: 502,
        code: 'GAP_SYNC_BAD_RESPONSE',
        upstream: true,
      });
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error(`DataHub phản hồi chậm (timeout ${timeoutMs()}ms), chưa gửi xong.`), { status: 504, upstream: true });
    }
    // Lỗi kết nối (DataHub tắt/không tới được) → thông báo dịu, không phải app vỡ.
    if (!error.status) {
      throw Object.assign(new Error('Không kết nối được DataHub để đồng bộ — dùng tạm Xuất Excel.'), { status: 503, code: 'GAP_SYNC_UNREACHABLE', upstream: true, dormant: true });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// persist.load/save đồng bộ + ghi atomic (tmp+rename) nên mỗi appendAudit chạy
// trọn vẹn trong 1 tick, không interleave (không race in-process). Không ném lỗi
// ra ngoài để audit hỏng không làm gãy request — nhưng log cảnh báo để không "nuốt".
function appendAudit(entry) {
  try {
    const rows = persist.load(AUDIT_FILE, []);
    rows.push({ at: new Date().toISOString(), ...entry });
    persist.save(AUDIT_FILE, rows.slice(-AUDIT_LIMIT));
  } catch (error) {
    console.warn('[employee-cost-gap-sync] audit write failed', { outcome: entry?.outcome, message: error.message });
  }
}

function auditBase(payload, session) {
  return {
    actor: String(session?.emp_code || session?.name || 'UNKNOWN'),
    role: safeText(session?.role || 'unknown', 24).toLowerCase(),
    from: safeText(payload?.from, 7) || null,
    to: safeText(payload?.to, 7) || null,
  };
}

// KHÔNG auto-retry POST: gửi lại có thể tạo worklist trùng ở DataHub. Idempotency
// do checksum lo; lỗi trả thẳng để người dùng chủ động bấm lại.
// Ghi audit MỌI outcome, kể cả các nhánh từ chối sớm (blocker 5).
async function sync(payload = {}, session = {}, { confirmed = false } = {}) {
  const actor = String(session.emp_code || session.name || 'App Report CEO');
  const base = auditBase(payload, session);
  if (payload.note) base.note = safeText(payload.note, 500);
  try {
    // Chốt xác nhận: chỉ gửi khi đã Duyệt tường minh (blocker 2 — lớp backend,
    // song song với gate ở route để admin gọi thẳng API cũng không lọt).
    if (confirmed !== true) {
      throw Object.assign(new Error('Cần xác nhận Duyệt trước khi gửi (confirm=true).'), { status: 400, code: 'GAP_SYNC_NOT_CONFIRMED' });
    }
    if (!configured()) {
      throw Object.assign(new Error('DataHub chưa được cấu hình — chưa thể đồng bộ; dùng tạm Xuất Excel.'), { status: 503, code: 'GAP_SYNC_NOT_CONFIGURED', dormant: true });
    }
    const worklist = buildWorklist(payload, { actor });
    if (!worklist.items.length) {
      throw Object.assign(new Error('Không có mã thiếu % để đồng bộ.'), { status: 400, code: 'GAP_SYNC_EMPTY' });
    }
    if (worklist.items.length > MAX_ITEMS) {
      throw Object.assign(new Error(`Worklist ${worklist.items.length} mã vượt trần ${MAX_ITEMS}; thu hẹp bộ lọc/kỳ.`), { status: 413, code: 'GAP_SYNC_TOO_MANY_ITEMS' });
    }
    const serialized = JSON.stringify(worklist);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw Object.assign(new Error('Gói worklist vượt trần kích thước; thu hẹp kỳ/bộ lọc.'), { status: 413, code: 'GAP_SYNC_PAYLOAD_TOO_LARGE' });
    }
    const result = await pushWorklist(worklist, serialized);
    appendAudit({ ...base, checksum: worklist.worklist_checksum, codeCount: worklist.items.length, outcome: 'ok', worklistId: result.worklist_id || null });
    return {
      ok: true,
      from: worklist.from,
      to: worklist.to,
      sent: worklist.items.length,
      revenueAffected: worklist.items.reduce((total, item) => total + num(item.doanh_thu_anh_huong), 0),
      checksum: worklist.worklist_checksum,
      datahub: result,
    };
  } catch (error) {
    appendAudit({ ...base, outcome: error.code || 'error', message: safeText(error.message, 300) });
    throw error;
  }
}

// 📝 "Ý kiến khác": CEO ghi nhận ý kiến/nghi vấn mà KHÔNG gửi worklist (blocker 1
// phía backend). Chỉ ghi audit để truy vết, không chạm DataHub.
function recordNote(payload = {}, session = {}) {
  const note = safeText(payload.note, 500);
  const base = auditBase(payload, session);
  if (!note) {
    appendAudit({ ...base, outcome: 'note_empty' });
    throw Object.assign(new Error('Ý kiến trống.'), { status: 400, code: 'GAP_SYNC_NOTE_EMPTY' });
  }
  appendAudit({ ...base, outcome: 'note', note });
  return { ok: true, noted: true };
}

module.exports = {
  AUDIT_FILE,
  AUDIT_LIMIT,
  ENDPOINT,
  MAX_ITEMS,
  MAX_PAYLOAD_BYTES,
  configured,
  assertNoForbiddenKeys,
  buildWorklist,
  sync,
  recordNote,
};
