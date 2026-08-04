'use strict';
/**
 * LỊCH CHẠY NỀN — MỘT CỬA DUY NHẤT
 *
 * Bot chỉ cần gọi `runDueJobs()` mỗi ~5 phút; module này tự quyết việc nào tới giờ.
 * Mọi mốc theo **GIỜ VIỆT NAM (Asia/Bangkok)** — CEO nhắc nhiều lần; lấy giờ máy thì
 * từ 00:00–07:00 giờ VN sẽ ra NGÀY HÔM QUA, lịch "ngày 01" bắn nhầm sang ngày 31.
 *
 * Hai việc:
 *   1. `payment_notice`  — nhắc Lần 2/Lần 3 tới hạn & quá hạn, chạy mỗi ngày 08:00.
 *   2. `target_proposal` — AI đề xuất target tháng mới:
 *        · **NGÀY 01 08:00** — đề xuất NGAY đầu tháng (CEO chốt 04/08), neo doanh thu
 *          tháng vừa kết thúc, ghi rõ **CHƯA KHOÁ SỔ**.
 *        · **NGÀY 09 08:00** — sau khoá sổ ngày 8, tính lại bằng số đã chốt.
 *
 * ‼ TUYỆT ĐỐI KHÔNG TỰ ÁP TARGET. Chỉ sinh đề xuất + nhắn CEO; ghi thành target thật
 * là do CEO bấm. Target là tiền.
 */

const persist = require('./persist');

const STATE_FILE = 'scheduled_jobs_state';
const TZ = 'Asia/Bangkok';

function vnParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: `${parts.year}-${parts.month}`,
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  };
}

function previousMonth(month) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ''));
  if (!match) return '';
  const year = Number(match[1]);
  const index = Number(match[2]);
  return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, '0')}`;
}

function readState(store) {
  const rows = store.load(STATE_FILE, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

const alreadyRan = (state, key) => Object.prototype.hasOwnProperty.call(state, key);

/**
 * Việc nào tới giờ? Thuần tính toán — không chạy, không ghi. Dễ kiểm bằng test.
 * Mỗi việc chỉ chạy MỘT lần mỗi mốc: khoá theo ngày (và theo loại mốc).
 */
function dueJobs(now = new Date(), state = {}) {
  const { date, month, day, hour } = vnParts(now);
  const jobs = [];

  // Nhắc thanh toán: mỗi ngày một lần, từ 08:00 giờ VN.
  if (hour >= 8 && !alreadyRan(state, `payment_notice|${date}`)) {
    jobs.push({ job: 'payment_notice', key: `payment_notice|${date}`, at: date });
  }

  // Đề xuất target: ngày 01 (số chưa chốt) và ngày 09 (số đã chốt).
  if (hour >= 8) {
    if (day === 1 && !alreadyRan(state, `target_proposal|${month}|open`)) {
      jobs.push({
        job: 'target_proposal', key: `target_proposal|${month}|open`,
        targetKy: month, anchorKy: previousMonth(month), stage: 'open', closed: false,
      });
    }
    if (day === 9 && !alreadyRan(state, `target_proposal|${month}|closed`)) {
      jobs.push({
        job: 'target_proposal', key: `target_proposal|${month}|closed`,
        targetKy: month, anchorKy: previousMonth(month), stage: 'closed', closed: true,
      });
    }
  }
  return jobs;
}

function markRan(keys, { store = persist, now = () => new Date().toISOString() } = {}) {
  if (!keys.length) return;
  const state = readState(store);
  const at = now();
  for (const key of keys) state[key] = at;
  const all = Object.keys(state);
  if (all.length > 400) {
    all.sort((a, b) => String(state[a]).localeCompare(String(state[b])));
    for (const stale of all.slice(0, all.length - 400)) delete state[stale];
  }
  store.save(STATE_FILE, state);
}

/**
 * Chạy các việc tới giờ. `handlers` do nơi gọi cung cấp:
 *   { payment_notice: async () => …, target_proposal: async (job) => … }
 * Việc nào ném lỗi thì KHÔNG đánh dấu đã chạy ⇒ lần sau chạy lại, không nuốt mất.
 */
async function runDueJobs({ now = new Date(), handlers = {}, store = persist, dryRun = false } = {}) {
  const state = readState(store);
  const jobs = dueJobs(now, state);
  if (dryRun) return { jobs, ran: [], failed: [] };

  const ran = [];
  const failed = [];
  for (const job of jobs) {
    const handler = handlers[job.job];
    if (typeof handler !== 'function') continue;
    try {
      await handler(job);
      ran.push(job.key);
    } catch (error) {
      failed.push({ key: job.key, message: error.message });
      console.warn('[scheduled-jobs] việc lỗi, sẽ chạy lại lần sau', { job: job.job, message: error.message });
    }
  }
  markRan(ran, { store });
  return { jobs, ran, failed };
}

module.exports = { STATE_FILE, TZ, vnParts, previousMonth, dueJobs, markRan, runDueJobs, readState };
