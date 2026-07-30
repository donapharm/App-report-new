'use strict';
/**
 * ĐƠN GIÁ TRỊ CAO — NHẮN CHỦ ĐỘNG (CEO chốt 2026-07-30, việc 5.2)
 *
 * CEO: "tất cả các đơn, với những đơn giá trị cao trên 50 triệu thì chủ động nhắn
 * tin telegram cho nhân viên có đơn đó, cho vp018, cho ceo nắm rõ."
 *
 * Vì sao: đơn to mà rơi/chậm/sai kỳ là mất nhiều tiền nhất, và đúng là loại đơn
 * không ai nhớ nổi bằng đầu. Ca 275.925.600đ của DN001 là ví dụ.
 *
 * QUY TẮC:
 *  1. Ngưỡng ở CONFIG, không ghi cứng trong code.
 *  2. Người nhận = NV có đơn + VP018 + CEO. KHÔNG lọc qua notify_optout/isMuted —
 *     VP018 nằm trong optout nhưng chính là người theo đơn.
 *  3. Mỗi đơn nhắn MỘT LẦN (khoá theo mã đơn + kỳ). Đơn đổi tiền đáng kể thì coi là
 *     tin mới, vì con số NV cần nhớ đã khác.
 *  4. KHÔNG BỊA: thiếu mã đơn hoặc thiếu tiền thì bỏ qua và đếm riêng, không nhắn.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = process.env.HIGH_VALUE_ORDER_ALERT_FILE
  || path.join(__dirname, '..', 'config', 'high_value_order_alert.json');

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`;
}

function loadConfig(file = CONFIG_FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const threshold = Number(raw.thresholdAmount);
    if (!Number.isFinite(threshold) || threshold <= 0) return { ok: false, reason: 'threshold_invalid' };
    return {
      ok: true,
      thresholdAmount: threshold,
      alwaysNotify: (Array.isArray(raw.alwaysNotify) ? raw.alwaysNotify : []).map((code) => String(code).trim().toUpperCase()).filter(Boolean),
      notifyOrderOwner: raw.notifyOrderOwner !== false,
    };
  } catch { return { ok: false, reason: 'config_unreadable' }; }
}

function normalizeOrder(raw = {}) {
  const amount = Number(raw.amount ?? raw.revenue ?? raw.revenue_before_vat);
  return {
    orderCode: String(raw.order_code ?? raw.orderCode ?? '').trim().toUpperCase(),
    empCode: String(raw.emp_code ?? raw.empCode ?? '').trim().toUpperCase(),
    unitName: String(raw.unit_name ?? raw.unitName ?? raw.unit_code ?? raw.unitCode ?? '').trim(),
    date: String(raw.order_date ?? raw.date ?? raw.revenue_date ?? '').slice(0, 10),
    ky: String(raw.ky ?? '').trim(),
    amount: Number.isFinite(amount) ? amount : null,
  };
}

// Khoá chống gửi trùng: mã đơn + kỳ + bậc tiền (làm tròn triệu) — đơn đổi tiền đáng
// kể là tin mới vì con số NV cần nhớ đã khác.
function alertKey(order = {}) {
  const item = normalizeOrder(order);
  return `hvo|${item.ky}|${item.orderCode}|${Math.round((item.amount || 0) / 1_000_000)}`;
}

/**
 * Lọc đơn vượt ngưỡng và dựng tin cho từng người nhận.
 * Trả { messages: [{empCode, orderCode, text}], skipped: [...] } — không có đơn nào
 * vượt ngưỡng thì messages rỗng và KHÔNG được gửi gì.
 */
function build({ orders = [], state = {}, config = loadConfig() } = {}) {
  if (!config.ok) return { ok: false, reason: config.reason, messages: [], skipped: [] };
  const messages = [];
  const skipped = [];
  const fresh = [];
  for (const raw of Array.isArray(orders) ? orders : []) {
    const item = normalizeOrder(raw);
    // Thiếu mã đơn hoặc thiếu tiền ⇒ KHÔNG nhắn, nhưng phải đếm ra để có người biết.
    if (!item.orderCode || item.amount == null) {
      skipped.push({ ...item, reason: 'thiếu mã đơn hoặc thiếu số tiền — không nhắn để tránh báo sai' });
      continue;
    }
    if (item.amount <= config.thresholdAmount) continue;
    const key = alertKey(raw);
    if (state[key]) continue;                       // đã nhắn rồi
    fresh.push({ ...item, key });
  }
  for (const item of fresh) {
    const owner = config.notifyOrderOwner && item.empCode ? [item.empCode] : [];
    const targets = [...new Set([...owner, ...config.alwaysNotify])];
    const head = `💰 ĐƠN GIÁ TRỊ CAO — ${money(item.amount)} (trên ngưỡng ${money(config.thresholdAmount)})`;
    const body = [
      `Đơn ${item.orderCode}${item.date ? ` · ngày ${item.date.split('-').reverse().join('/')}` : ''}`,
      item.unitName ? `Đơn vị: ${item.unitName}` : '',
      item.empCode ? `Nhân viên: ${item.empCode}` : '',
      '→ Theo sát đơn này: kiểm ngày thực giao, mã đơn vị, và phản hồi đối tác. Đơn to sai kỳ là mất nhiều tiền nhất.',
    ].filter(Boolean);
    for (const empCode of targets) {
      messages.push({ empCode, orderCode: item.orderCode, key: item.key, text: [head, ...body].join('\n') });
    }
  }
  return { ok: true, messages, skipped, freshCount: fresh.length, thresholdAmount: config.thresholdAmount };
}

function markState({ orders = [], state = {}, config = loadConfig(), at = new Date().toISOString() } = {}) {
  if (!config.ok) return state;
  const next = { ...state };
  for (const raw of Array.isArray(orders) ? orders : []) {
    const item = normalizeOrder(raw);
    if (!item.orderCode || item.amount == null || item.amount <= config.thresholdAmount) continue;
    next[alertKey(raw)] = { at, orderCode: item.orderCode, amount: item.amount };
  }
  return next;
}

module.exports = { CONFIG_FILE, loadConfig, normalizeOrder, alertKey, build, markState };
