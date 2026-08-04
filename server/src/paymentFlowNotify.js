'use strict';
/**
 * TIN NHẮN THEO QUY TRÌNH ĐỀ NGHỊ — CEO chốt 04/08/2026 21:55.
 *
 * CEO: *"cứ mỗi lần NV gửi đề nghị là tin nhắn Telegram gửi qua cho CEO, khi CEO
 * duyệt thì tin nhắn sẽ được phản hồi lại cho NV. Kể cả lệnh xin ứng sớm, duyệt
 * sớm, đề xuất… các nội dung khác cũng gửi tin nhắn Telegram."*
 *
 * Hai chiều rõ ràng:
 *   NV làm gì  →  báo CEO   (CEO là người phải quyết)
 *   CEO làm gì →  báo NV    (NV là người đang chờ)
 *
 * ‼ Module này THUẦN TÍNH TOÁN: quyết định gửi cho ai, nội dung gì. Không gọi mạng,
 * không đọc file. Nhờ vậy test được toàn bộ luật mà không cần Telegram thật, và
 * gửi hỏng cũng KHÔNG BAO GIỜ làm hỏng việc ghi sổ.
 */

const money = (value) => (Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('vi-VN')}đ` : '—');
const dmy = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).split('-').reverse().join('/') : '—');
const periodLabel = (period) => {
  const text = String(period || '');
  return /^\d{4}-\d{2}$/.test(text) ? `${text.slice(5)}/${text.slice(0, 4)}` : text;
};
const stepLabel = (key) => (key === 'second' ? 'Lần 2' : key === 'final' ? 'Lần 3 · tất toán' : String(key));

// Ai phải nhận tin của từng nấc. `employee` = NV của sổ đó; `ceo` = người duyệt.
const AUDIENCE = Object.freeze({
  unlock_requested: 'ceo',
  requested: 'ceo',
  unlocked: 'employee',
  approved: 'employee',
  // Từ chối đưa về `plan` — người cần biết là NV.
  plan: 'employee',
  paid: 'employee',
  undone: 'employee',
  second_changed: 'employee',
});

/**
 * Dựng tin cho MỘT lần chuyển nấc.
 * @returns {null|{audience, empCode, kind, text}} — `null` nghĩa là nấc này không nhắn.
 */
function flowNotice({
  empCode, employeeName = '', period, key, from, to,
  actor = '', note = '', amount = null, dueDate = '', graceDate = '',
} = {}) {
  const audience = AUDIENCE[String(to)];
  if (!audience) return null;
  const who = employeeName ? `${empCode} · ${employeeName}` : String(empCode || '');
  const step = stepLabel(key);
  const kỳ = periodLabel(period);
  const tiền = money(amount);
  const lýDo = note ? `\nLý do: “${String(note).slice(0, 300)}”` : '';

  if (to === 'unlock_requested') {
    return {
      audience, empCode, kind: 'unlock_requested',
      text: `🔓 XIN NHẬN SỚM — ${who}\n${step} kỳ ${kỳ}: ${tiền}\nHạn thường là ${dmy(dueDate)}, NV xin nhận trước.${lýDo}\n\nVào App Report → Thanh toán CP để MỞ KHOÁ hoặc TỪ CHỐI.`,
    };
  }
  if (to === 'requested') {
    return {
      audience, empCode, kind: 'requested',
      text: `📨 ĐỀ NGHỊ NHẬN — ${who}\n${step} kỳ ${kỳ}: ${tiền}\nHạn ${dmy(dueDate)}${graceDate ? ` · còn nhận được tới ${dmy(graceDate)}` : ''}.${lýDo}\n\nVào App Report → Thanh toán CP để DUYỆT hoặc TỪ CHỐI.`,
    };
  }
  if (to === 'unlocked') {
    return {
      audience, empCode, kind: 'unlocked',
      text: `🔓 SẾP ĐÃ MỞ KHOÁ — ${step} kỳ ${kỳ}: ${tiền}\nBạn được đề nghị nhận sớm hơn hạn ${dmy(dueDate)}.\nVào App Report → Thanh toán CP và bấm “Đề nghị nhận”.`,
    };
  }
  if (to === 'approved') {
    return {
      audience, empCode, kind: 'approved',
      text: `👍 SẾP ĐÃ DUYỆT — ${step} kỳ ${kỳ}: ${tiền}\nĐang chờ chuyển tiền. Khi chuyển xong Sếp sẽ ghi nhận, bạn sẽ nhận thêm một tin nữa.`,
    };
  }
  if (to === 'plan') {
    // Chỉ nhắn khi ĐANG ở một nấc nào đó rồi bị đưa về kế hoạch = TỪ CHỐI.
    if (!from || from === 'plan') return null;
    return {
      audience, empCode, kind: 'rejected',
      text: `↩️ SẾP CHƯA DUYỆT — ${step} kỳ ${kỳ}: ${tiền}${lýDo}\nĐề nghị đã quay về “kế hoạch”. Bạn ĐỀ NGHỊ LẠI được khi đủ điều kiện.`,
    };
  }
  if (to === 'paid') {
    return {
      audience, empCode, kind: 'paid',
      text: `✅ ĐÃ CHUYỂN — ${step} kỳ ${kỳ}: ${tiền}\nSếp đã ghi nhận chuyển tiền ngày ${dmy(dueDate)}.\nXem lại ở App Report → Thanh toán CP.`,
    };
  }
  if (to === 'undone') {
    return {
      audience, empCode, kind: 'undone',
      text: `⚠️ GỠ GHI NHẬN — ${step} kỳ ${kỳ}\nSếp vừa gỡ ghi nhận đã trả (ghi nhầm). Lần này quay lại trạng thái chưa nhận.${lýDo}`,
    };
  }
  if (to === 'second_changed') {
    return {
      audience, empCode, kind: 'second_changed',
      text: `✏️ ĐỔI SỐ ${step} — kỳ ${kỳ}: ${tiền}\nSếp vừa chỉnh số kế hoạch của lần này. Lần cuối tự tính lại để tổng không đổi.`,
    };
  }
  return null;
}

/**
 * Gửi thật. `resolve(audience, empCode)` do nơi gọi cung cấp — trả `{telegramId, email}`.
 * ‼ Gửi hỏng KHÔNG được ném ra ngoài: sổ đã ghi rồi, không thể vì Telegram lỗi mà
 * coi như thao tác thất bại. Chỉ ghi log để còn truy.
 */
async function sendFlowNotice(notice, { resolve, deliver } = {}) {
  if (!notice || typeof resolve !== 'function' || typeof deliver !== 'function') return { sent: false, reason: 'not_configured' };
  try {
    const target = await resolve(notice.audience, notice.empCode);
    if (!target || (!target.telegramId && !target.email)) return { sent: false, reason: 'no_recipient' };
    const result = await deliver({ ...target, subject: `App Report · ${notice.kind}`, text: notice.text });
    return { sent: result?.ok === true, reason: result?.ok ? '' : 'deliver_failed' };
  } catch (error) {
    console.warn('[payment-flow-notify] gửi lỗi', { kind: notice.kind, empCode: notice.empCode, message: error?.message });
    return { sent: false, reason: 'error' };
  }
}

module.exports = { AUDIENCE, flowNotice, sendFlowNotice, stepLabel, periodLabel };
