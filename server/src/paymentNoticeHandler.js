'use strict';

const defaultPersist = require('./persist');
const defaultAuth = require('./auth');
const defaultStore = require('./store');
const defaultChannels = require('./notifyChannels');
const defaultPaymentNotify = require('./paymentNotify');

const DELIVERY_STATE_FILE = 'payment_notice_delivery_state';
const DELIVERY_STATE_LIMIT = 10000;

function readDeliveryState(store = defaultPersist) {
  const value = store.load(DELIVERY_STATE_FILE, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function saveDelivery(state, key, store = defaultPersist, now = () => new Date().toISOString()) {
  state[key] = now();
  const keys = Object.keys(state);
  if (keys.length > DELIVERY_STATE_LIMIT) {
    keys.sort((a, b) => String(state[a]).localeCompare(String(state[b])));
    for (const stale of keys.slice(0, keys.length - DELIVERY_STATE_LIMIT)) delete state[stale];
  }
  store.save(DELIVERY_STATE_FILE, state);
}

function createPaymentNoticeHandler({
  loadSchedules,
  auth = defaultAuth,
  appStore = defaultStore,
  channels = defaultChannels,
  paymentNotify = defaultPaymentNotify,
  stateStore = defaultPersist,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof loadSchedules !== 'function') throw new Error('Thiếu loadSchedules cho payment_notice');

  function recipient(empCode) {
    const code = String(empCode || '').trim().toUpperCase();
    const mappings = (auth.listTelegramMap() || []).filter((row) => String(row.emp_code || '').trim().toUpperCase() === code);
    if (mappings.length > 1) throw new Error(`Mapping Telegram mơ hồ cho ${code}`);
    const user = appStore.findUserByCode(code);
    const telegramId = mappings[0] ? String(mappings[0].telegram_id || '').trim() : '';
    const email = channels.emailFor(code, user?.email);
    if (!telegramId && !email) throw new Error(`Không có kênh nhận tin cho ${code}`);
    return { code, telegramId, email };
  }

  async function prepare(job = {}) {
    const schedules = await loadSchedules({ today: job.at });
    const preview = await paymentNotify.runPaymentNotices(schedules, { store: stateStore, dryRun: true });
    const targets = new Map();
    for (const notice of preview.planned) {
      targets.set(`${notice.key}|employee`, recipient(notice.empCode));
      targets.set(`${notice.key}|ceo`, recipient('CEO'));
    }
    return { schedules, preview, targets };
  }

  async function paymentNoticeHandler(job = {}) {
    const { schedules, preview, targets } = await prepare(job);
    if (!preview.planned.length) return { planned: 0, delivered: 0 };

    // Preflight tất cả audience trước khi gửi tin đầu tiên. Lỗi provider giữa
    // chừng được state từng audience giữ lại để retry không gửi trùng phần đã xong.
    const deliveryState = readDeliveryState(stateStore);
    const send = async (text, empCode, kind, notice) => {
      const failures = [];
      for (const audience of ['employee', 'ceo']) {
        const stateKey = `${notice.key}|${audience}`;
        if (deliveryState[stateKey]) continue;
        const target = targets.get(stateKey);
        const result = await channels.deliver({
          telegramId: target.telegramId || null,
          email: target.email || null,
          subject: kind === 'overdue' ? 'DONAPHARM — Thanh toán quá hạn' : 'DONAPHARM — Nhắc thanh toán',
          text,
        });
        if (!result?.ok) failures.push(`${audience}:${result?.description || 'delivery_failed'}`);
        else saveDelivery(deliveryState, stateKey, stateStore, now);
      }
      if (failures.length) throw new Error(failures.join(', '));
    };

    const result = await paymentNotify.runPaymentNotices(schedules, { send, store: stateStore, now });
    if (result.delivered.length !== result.planned.length) {
      throw new Error(`Chưa gửi đủ payment_notice (${result.delivered.length}/${result.planned.length})`);
    }
    return { planned: result.planned.length, delivered: result.delivered.length };
  }

  // Dry-run nghiệp vụ: dựng đúng sổ, áp chống trùng và kiểm đủ kênh của NV + CEO,
  // nhưng không gọi provider và không ghi bất kỳ state nào.
  paymentNoticeHandler.preview = async (job = {}) => {
    const { schedules, preview, targets } = await prepare(job);
    const kinds = {};
    for (const notice of preview.planned) kinds[notice.kind] = (kinds[notice.kind] || 0) + 1;
    return Object.freeze({
      schedules: schedules.length,
      planned: preview.planned.length,
      audiences: targets.size,
      kinds: Object.freeze(kinds),
      writes: 0,
      sends: 0,
    });
  };
  return paymentNoticeHandler;
}

module.exports = {
  DELIVERY_STATE_FILE,
  DELIVERY_STATE_LIMIT,
  readDeliveryState,
  saveDelivery,
  createPaymentNoticeHandler,
};
