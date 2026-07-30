'use strict';
/**
 * CẢNH BÁO VẬN HÀNH KHI ĐỒNG BỘ DOANH THU LỖI
 * (CEO chốt 2026-07-29, CEO yêu cầu làm ngay 2026-07-30)
 *
 * CEO: "khi đồng bộ mà lỗi thì hệ thống báo về Telegram cho VP018 / DN007 / CEO để
 * biết xử lý. Và báo về bot Sale luôn." · "để tránh tình trạng chạy loanh quanh tìm
 * số không khớp mãi mới ra được. Do không có người canh cửa nên hậu quả là chạy
 * lòng vòng đi tìm."
 *
 * Lý do tồn tại: màn "Chưa đồng bộ" vẫn phải CÓ NGƯỜI CHỦ ĐỘNG MỞ RA mới thấy —
 * và chính vì không ai mở nên 382,6 triệu nằm im 18 ngày.
 *
 * BỐN QUY TẮC SỐNG CÒN (spec SPEC_REVENUE_SYNC_EXCEPTIONS.md mục 8):
 *  1. Danh sách người nhận là RIÊNG (`config/sync_alert_recipients.json`). TUYỆT ĐỐI
 *     không lọc qua notify_optout / targetNotify.isMuted / diemXu.EXCLUDE — VP018 nằm
 *     trong optout nhưng là NGƯỜI SỬA, chặn VP018 là chặn đúng người cần biết.
 *  2. Mỗi người nhận ĐÚNG PHẦN MÌNH SỬA ĐƯỢC. Nhận thứ mình không sửa được thì lần
 *     sau không đọc nữa.
 *  3. Mỗi mục phải đủ 4 phần: CÁI GÌ · BAO NHIÊU TIỀN · VÌ SAO · AI LÀM GÌ.
 *     Thiếu "ai làm gì" là người nhận lại phải đi hỏi — đúng cái "chạy lòng vòng".
 *  4. CHỈ BÁO CÁI MỚI. Ngoại lệ tồn 10 ngày không được nhắn 10 lần. Không có gì mới
 *     ⇒ KHÔNG GỬI (CEO chốt 28/07: "không có tin gì thì không gửi").
 */
const fs = require('fs');
const path = require('path');
const defaultPersist = require('./persist');

const RECIPIENTS_FILE = process.env.SYNC_ALERT_RECIPIENTS_FILE
  || path.join(__dirname, '..', 'config', 'sync_alert_recipients.json');
const STATE_FILE = 'sync_alert_state';
const STATE_LIMIT = 4000;

// Nhóm CẦN XỬ LÝ (có tiền, đáng lẽ phải vào) + nhóm THIẾU DANH MỤC. Nhóm "chỉ để
// biết" (chưa ghi doanh số, ngày thuộc kỳ khác, đối tác chưa phản hồi) KHÔNG báo:
// mấy cái đó lúc nào cũng có, báo hằng ngày thì 3 hôm là không ai đọc, và cảnh báo
// thật sẽ chìm nghỉm.
const REASONS = Object.freeze({
  MISA_REVENUE_DATE_NULL: {
    scope: 'delivery_date',
    why: 'đã ghi doanh số nhưng THIẾU NGÀY DOANH THU nên không quy được vào kỳ nào',
    who: 'Kế toán MISA nhập ngày ghi doanh thu',
  },
  UNIT_NOT_IN_CATALOG: {
    scope: 'unit',
    why: 'mã đơn vị chưa có trong danh mục → mất tỉnh, không lọc được',
    who: 'DataHub/App Sale thêm mã đơn vị rồi đồng bộ lại',
  },
  PRODUCT_NOT_IN_CATALOG: {
    scope: 'unit',
    why: 'mã hàng chưa có trong danh mục',
    who: 'DataHub thêm mã hàng vào danh mục',
  },
  DELIVERY_DATE_MISSING: {
    scope: 'delivery_date',
    why: 'đối tác đã phản hồi nhưng CHƯA CÓ NGÀY THỰC GIAO',
    who: 'VP018/DN007 điền ngày thực giao trên App Sale',
  },
  AMOUNT_ZERO: {
    scope: 'order',
    why: 'có dòng nhưng tiền = 0',
    who: 'App Sale kiểm lại giá/số lượng của dòng này',
  },
  DELIVERED_ZERO: {
    scope: 'order',
    why: 'đã phản hồi nhưng số giao = 0',
    who: 'VP018/DN007 kiểm lại số thực giao',
  },
  SUSPECT_TEST_ORDER: {
    scope: 'is_test',
    why: 'nghi là đơn test nhưng chưa gắn cờ test',
    who: 'App Sale gắn cờ is_test hoặc bỏ cờ nếu là đơn thật',
  },
  ENTITY_GROUP_INVALID: {
    scope: 'entity_group',
    why: 'entity_group sai/thiếu nên không quy được về nhóm',
    who: 'App Sale sửa entity_group',
  },
  HOLD_GOLIVE_UNEXPECTED: {
    scope: 'hold_golive',
    why: 'trạng thái HOLD_GOLIVE bất thường',
    who: 'App Sale xác nhận trạng thái đơn',
  },
  ROSTER_CONFLICT: {
    scope: 'order',
    why: 'NV xung đột roster nên không quy được doanh thu cho ai',
    who: 'DataHub chốt lại người phụ trách',
  },
});

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`;
}

function readRecipientsFile(file = RECIPIENTS_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Người nhận cảnh báo đồng bộ. KHÔNG nhận tham số "muted"/"optout" nào — cố ý.
 * File hỏng/thiếu ⇒ trả rỗng và nêu lý do, KHÔNG âm thầm rơi về danh sách khác.
 */
function recipients({ file = RECIPIENTS_FILE } = {}) {
  const raw = readRecipientsFile(file);
  if (!raw || !Array.isArray(raw.recipients)) {
    return { ok: false, reason: 'sync_alert_recipients_unreadable', list: [], appSaleBot: null };
  }
  const list = raw.recipients
    .map((item) => ({
      empCode: String(item?.emp_code || '').trim().toUpperCase(),
      role: String(item?.role || '').trim(),
      scope: Array.isArray(item?.scope) ? item.scope.map(String) : [],
    }))
    .filter((item) => item.empCode && item.scope.length);
  return {
    ok: list.length > 0,
    reason: list.length ? '' : 'sync_alert_recipients_empty',
    list,
    appSaleBot: raw.appSaleBot && typeof raw.appSaleBot === 'object'
      ? { enabled: raw.appSaleBot.enabled === true, scope: Array.isArray(raw.appSaleBot.scope) ? raw.appSaleBot.scope.map(String) : [] }
      : null,
  };
}

// Khoá nhận dạng một ngoại lệ. Cùng mã đơn + cùng lý do + cùng kỳ = cùng một việc,
// dù chạy đồng bộ lại bao nhiêu lần cũng chỉ nhắn một lần.
function itemKey(item = {}) {
  const ky = String(item.ky || '').trim();
  const reason = String(item.reason || item.issue || '').trim().toUpperCase();
  const ref = String(item.orderCode || item.order_code || item.unitCode || item.unit_code
    || item.productCode || item.product_code || item.ref || '').trim().toUpperCase();
  return `${ky}|${reason}|${ref}`;
}

function normalizeItem(raw = {}) {
  const reason = String(raw.reason || raw.issue || '').trim().toUpperCase();
  const meta = REASONS[reason] || null;
  return {
    key: itemKey({ ...raw, reason }),
    ky: String(raw.ky || '').trim(),
    reason,
    scope: meta?.scope || 'order',
    what: String(raw.what || raw.orderCode || raw.order_code || raw.unitCode || raw.unit_code || raw.ref || '').trim(),
    empCode: String(raw.emp_code || raw.empCode || '').trim().toUpperCase(),
    amount: Number(raw.amount || 0) || 0,
    // Lý do và việc phải làm lấy từ bảng REASONS; nguồn có thể ghi đè nhưng KHÔNG
    // được để trống — thiếu "ai làm gì" là vi phạm quy tắc 3.
    why: String(raw.why || meta?.why || '').trim(),
    who: String(raw.action || raw.who || meta?.who || '').trim(),
    known: !!meta,
  };
}

function loadState(persist = defaultPersist) {
  const raw = persist.load(STATE_FILE, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/**
 * Phân loại theo trạng thái đã-nhắn:
 *  - fresh: mới xuất hiện lần đầu ⇒ nhắn chi tiết
 *  - stale: đã nhắn rồi, chưa xử lý ⇒ chỉ gộp một dòng "còn tồn N mục cũ"
 *  - resolved: đã nhắn rồi và nay hết ⇒ báo MỘT LẦN "đã hết"
 */
function diffAgainstState(items = [], state = {}) {
  const normalized = (Array.isArray(items) ? items : []).map(normalizeItem);
  const seen = new Set(normalized.map((item) => item.key));
  const fresh = normalized.filter((item) => !state[item.key]);
  const stale = normalized.filter((item) => !!state[item.key]);
  const resolved = Object.keys(state).filter((key) => !seen.has(key) && state[key]?.resolvedAt == null);
  return { normalized, fresh, stale, resolved };
}

// Một mục = 4 phần bắt buộc. Mục lý do LẠ vẫn phải hiện (không im lặng bỏ), nhưng
// nói thẳng là chưa khai báo cách xử lý để có người đi khai.
function itemLines(item, index) {
  const head = [item.what || '(không rõ mã)', item.amount ? money(item.amount) : null, item.empCode || null]
    .filter(Boolean).join(' · ');
  return [
    `${index + 1}. ${head}`,
    `   Lý do: ${item.why || 'CHƯA KHAI BÁO LÝ DO'}`,
    `   → ${item.who || '‼ CHƯA KHAI BÁO AI XỬ LÝ — cần bổ sung vào REASONS của syncAlert.js'}`,
  ].join('\n');
}

/**
 * Dựng tin cho từng người nhận. Trả [] khi KHÔNG có gì mới — nơi gọi không được tự
 * bịa tin "hôm nay không có lỗi".
 */
function buildMessages({ ky = '', items = [], state = {}, recipientList = [], urgent = null } = {}) {
  const { fresh, stale, resolved } = diffAgainstState(items, state);
  const out = [];
  const periodText = ky ? ` (kỳ ${ky})` : '';

  // MỨC 1 — KHẨN: bất biến vỡ (Σ đưa vào + Σ loại ≠ Σ nguồn). Đây không phải ngoại
  // lệ dữ liệu mà là HỆ THỐNG HỎNG: có dòng rơi ở chỗ không ai khai báo.
  if (urgent && urgent.invariantBroken) {
    const text = [
      `🛑 KHẨN — ĐỒNG BỘ DOANH THU DỪNG${periodText}`,
      'Bất biến vỡ: Σ(đưa vào) + Σ(loại) ≠ Σ(nguồn) — có dòng rơi ở chỗ không ai khai báo.',
      urgent.detail ? `Chi tiết: ${urgent.detail}` : '',
      `Nguồn ${money(urgent.sourceTotal)} · đưa vào ${money(urgent.includedTotal)} · loại ${money(urgent.excludedTotal)} · lệch ${money(urgent.diff)}`,
      '‼ ĐÃ DỪNG, CHƯA GHI SLOT. Không dùng số của kỳ này cho tới khi khớp lại.',
      '→ Bot/DataHub kiểm script materialize rồi chạy lại; không sửa tay số trong slot.',
    ].filter(Boolean).join('\n');
    for (const person of recipientList) out.push({ empCode: person.empCode, level: 'urgent', text });
    return out;
  }

  for (const person of recipientList) {
    if (person.scope.includes('summary')) {
      // CEO chỉ nhận bản tổng: bao nhiêu mục, tổng tiền, ai đang phải xử lý bao nhiêu.
      if (!fresh.length && !resolved.length) continue;
      const byWho = new Map();
      for (const item of [...fresh, ...stale]) {
        const current = byWho.get(item.who) || { count: 0, amount: 0 };
        current.count += 1; current.amount += item.amount;
        byWho.set(item.who, current);
      }
      const text = [
        `⚠ ĐỒNG BỘ DOANH THU — ${fresh.length} mục MỚI cần xử lý${periodText}`,
        `Tổng tiền đang mắc: ${money([...fresh, ...stale].reduce((sum, item) => sum + item.amount, 0))} · tổng ${fresh.length + stale.length} mục (${fresh.length} mới, ${stale.length} cũ)`,
        ...[...byWho.entries()].map(([who, agg]) => `• ${who || 'chưa khai báo'}: ${agg.count} mục · ${money(agg.amount)}`),
        resolved.length ? `✅ ${resolved.length} mục đã được xử lý xong.` : '',
        'Chi tiết ở màn "Chưa đồng bộ" trên app.',
      ].filter(Boolean).join('\n');
      out.push({ empCode: person.empCode, level: 'daily', text });
      continue;
    }
    // Người sửa: chỉ nhận đúng phần mình sửa được.
    const mine = fresh.filter((item) => person.scope.includes(item.scope));
    const mineStale = stale.filter((item) => person.scope.includes(item.scope));
    const mineResolved = resolved.length && (fresh.length + stale.length === 0);
    if (!mine.length && !mineResolved) continue;
    const text = [
      mine.length
        ? `⚠ ĐỒNG BỘ DOANH THU — ${mine.length} mục mới cần bạn xử lý${periodText}`
        : `✅ ĐỒNG BỘ DOANH THU${periodText} — các mục trước đã xử lý xong.`,
      '',
      ...mine.map(itemLines),
      mineStale.length ? `\nCòn tồn ${mineStale.length} mục cũ chưa xử lý — xem trên app.` : '',
    ].filter(Boolean).join('\n');
    out.push({ empCode: person.empCode, level: 'daily', text });
  }
  return out;
}

// Ghi lại đã-nhắn. resolvedAt để chỉ báo "đã hết" đúng một lần.
function markState({ items = [], state = {}, at = new Date().toISOString() } = {}) {
  const { normalized, resolved } = diffAgainstState(items, state);
  const next = { ...state };
  for (const item of normalized) {
    next[item.key] = { firstSeenAt: next[item.key]?.firstSeenAt || at, lastSeenAt: at, resolvedAt: null };
  }
  for (const key of resolved) next[key] = { ...(next[key] || {}), resolvedAt: at };
  const keys = Object.keys(next);
  if (keys.length > STATE_LIMIT) {
    // Cắt bản ghi ĐÃ XỬ LÝ cũ nhất trước, không bao giờ cắt mục đang tồn.
    const removable = keys.filter((key) => next[key]?.resolvedAt)
      .sort((left, right) => String(next[left].resolvedAt).localeCompare(String(next[right].resolvedAt)));
    for (const key of removable.slice(0, keys.length - STATE_LIMIT)) delete next[key];
  }
  return next;
}

function saveState(state, persist = defaultPersist) {
  persist.save(STATE_FILE, state);
  return state;
}

module.exports = {
  RECIPIENTS_FILE, STATE_FILE, STATE_LIMIT, REASONS,
  recipients, itemKey, normalizeItem, loadState, saveState,
  diffAgainstState, buildMessages, markState,
};
