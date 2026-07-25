'use strict';

const crypto = require('crypto');
const catalogManagement = require('./catalogManagement');
const persist = require('./persist');

const AUDIT_FILE = 'employee_cost_gap_sync_audit';
const AUDIT_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 6500;
// DataHub receiver (DataHub team build). Contract: DIRECTIVE_EMP_COST_GAP_SYNC_DATAHUB.md §1b.
const ENDPOINT = '/api/integrations/app-report/cost-gap-worklist';
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
function buildWorklist(payload = {}, { actor = '' } = {}) {
  const items = (Array.isArray(payload.items) ? payload.items : []).map((item) => ({
    ma_qlnb: safeText(item.productCode, 160),
    ten_hang: safeText(item.productName, 300),
    don_vi_anh_huong: (Array.isArray(item.unitLabels) ? item.unitLabels : []).map((label) => safeText(label, 240)).filter(Boolean),
    so_don_vi: num(item.unitCount),
    so_nv: num(item.employeeCount),
    doanh_thu_anh_huong: num(item.revenueAffected),
    ly_do: item.reason === 'qd_mismatch' ? 'qd_mismatch' : 'missing',
    ma_catalog_goi_y: item.suggestedCatalogCode ? safeText(item.suggestedCatalogCode, 160) : null,
  })).filter((item) => item.ma_qlnb);
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
  // Checksum trên items đã chuẩn hoá để DataHub idempotent + App Report truy vết.
  worklist.worklist_checksum = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
  assertNoForbiddenKeys(worklist);
  return worklist;
}

async function pushWorklist(worklist) {
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
      body: JSON.stringify(worklist),
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
    return body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data : body;
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

function appendAudit(entry) {
  try {
    const rows = persist.load(AUDIT_FILE, []);
    rows.push({ at: new Date().toISOString(), ...entry });
    persist.save(AUDIT_FILE, rows.slice(-AUDIT_LIMIT));
  } catch (error) {
    console.warn('[employee-cost-gap-sync] audit write failed', { message: error.message });
  }
}

// KHÔNG auto-retry POST: gửi lại có thể tạo worklist trùng ở DataHub. Idempotency
// do checksum lo; lỗi trả thẳng để người dùng chủ động bấm lại.
async function sync(payload = {}, session = {}) {
  if (!configured()) {
    throw Object.assign(new Error('DataHub chưa được cấu hình — chưa thể đồng bộ; dùng tạm Xuất Excel.'), {
      status: 503,
      code: 'GAP_SYNC_NOT_CONFIGURED',
      dormant: true,
    });
  }
  const actor = String(session.emp_code || session.name || 'App Report CEO');
  const worklist = buildWorklist(payload, { actor });
  if (!worklist.items.length) {
    throw Object.assign(new Error('Không có mã thiếu % để đồng bộ.'), { status: 400, code: 'GAP_SYNC_EMPTY' });
  }
  const baseAudit = {
    actor,
    role: safeText(session.role || 'unknown', 24).toLowerCase(),
    from: worklist.from,
    to: worklist.to,
    codeCount: worklist.items.length,
    checksum: worklist.worklist_checksum,
  };
  let result = null;
  try {
    result = await pushWorklist(worklist);
  } catch (error) {
    appendAudit({ ...baseAudit, outcome: error.code || 'error', message: error.message });
    throw error;
  }
  appendAudit({ ...baseAudit, outcome: 'ok', worklistId: result?.worklist_id || null });
  return {
    ok: true,
    from: worklist.from,
    to: worklist.to,
    sent: worklist.items.length,
    revenueAffected: worklist.items.reduce((total, item) => total + num(item.doanh_thu_anh_huong), 0),
    checksum: worklist.worklist_checksum,
    datahub: result || {},
  };
}

module.exports = {
  AUDIT_FILE,
  AUDIT_LIMIT,
  ENDPOINT,
  configured,
  assertNoForbiddenKeys,
  buildWorklist,
  sync,
};
