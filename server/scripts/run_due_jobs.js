#!/usr/bin/env node
/**
 * CẮM LỊCH `runDueJobs()` — LENH_06082026.md §V-D
 *
 *   node scripts/run_due_jobs.js --dry-run   # chỉ liệt kê việc tới giờ, không chạy, không ghi state
 *   node scripts/run_due_jobs.js             # chạy thật
 *
 * Cách cắm trên PROD (ƯU TIÊN CRON NGOÀI — tiến trình restart thì setInterval mất, cron thì không):
 *   crontab:  ★/5 * * * * cd /path/App-report-new/server && /usr/bin/node scripts/run_due_jobs.js >> ../logs/scheduled_jobs.log 2>&1
 *   (thay ★ bằng dấu sao; PM2 thay thế: pm2 start scripts/run_due_jobs.js --cron "★/5 * * * *" --no-autorestart)
 *
 * ‼ Trước khi bật cron thật: chạy --dry-run và DÁN kết quả ra báo cáo (luật V-D.1).
 * ‼ Phân biệt hai bộ lịch: tin chi phí/thưởng (12:30 T7 · cuối tháng 20:00 · ngày 9)
 *   do app-report-tgbot chạy riêng và ĐANG HOẠT ĐỘNG — script này KHÔNG đụng vào.
 *
 * Trạng thái "đã chạy" ghi qua persist (`scheduled_jobs_state`) ngay trong markRan
 * của scheduledJobs ⇒ restart không chạy lại lần hai.
 *
 * Handler hiện có:
 *   - target_proposal: chỉ ghi log, tuyệt đối không tự áp target.
 *   - payment_notice: dựng sổ bằng backend App Report, gửi NV + CEO qua
 *     notifyChannels. Thiếu nguồn/mapping/gửi lỗi ⇒ không mark job, retry.
 */
const persist = require('../src/persist');
const { dueJobs, runDueJobs, readState } = require('../src/scheduledJobs');
const { createPaymentNoticeHandler } = require('../src/paymentNoticeHandler');
const { runLockedProcess } = require('../src/processLockRunner');
const path = require('node:path');

const DRY = process.argv.includes('--dry-run');
const PAYMENT_DRY = process.argv.includes('--payment-dry-run');

const stamp = () => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date());

async function main({
  services = require('../src/routes').notifyServices,
  paymentHandlerFactory = createPaymentNoticeHandler,
} = {}) {
  const now = new Date();
  if (PAYMENT_DRY) {
    if (!services.paymentNoticeEnabled()) {
      console.log(`[${stamp()}] PAYMENT DRY-RUN — công tắc chủ đang OFF; chưa dựng sổ, chưa gọi nguồn, gửi 0, ghi 0.`);
      return;
    }
    const paymentNotice = paymentHandlerFactory({ loadSchedules: services.paymentSchedulesForNotify });
    const result = await paymentNotice.preview({ at: require('../src/employeeCost').vnToday() });
    console.log(`[${stamp()}] PAYMENT DRY-RUN — sổ ${result.schedules} · tin ${result.planned} · audience ${result.audiences} · gửi ${result.sends} · ghi ${result.writes}.`);
    console.log(`  loại tin: ${JSON.stringify(result.kinds)}`);
    return;
  }
  if (DRY) {
    const jobs = dueJobs(now, readState(persist));
    console.log(`[${stamp()}] DRY-RUN — ${jobs.length} việc tới giờ (giờ VN):`);
    for (const job of jobs) console.log(`  · ${job.job} (key=${job.key})${job.stage ? ` stage=${job.stage} targetKy=${job.targetKy} anchorKy=${job.anchorKy}` : ''}`);
    if (!jobs.length) console.log('  (không có việc nào tới giờ)');
    console.log('Chưa chạy gì, chưa ghi state. Bỏ --dry-run để chạy thật.');
    return;
  }

  const paymentNotice = paymentHandlerFactory({ loadSchedules: services.paymentSchedulesForNotify });
  const handlers = {
    target_proposal: async (job) => {
      // Đợt sau mới có handler thật. KHÔNG tự áp target — chỉ ghi log để lại dấu vết.
      console.log(`[${stamp()}] target_proposal ${job.stage} cho kỳ ${job.targetKy} (neo ${job.anchorKy}, closed=${job.closed}) — handler chưa làm, CHỈ GHI LOG, không áp target.`);
    },
  };
  // Công tắc chủ vẫn mặc định OFF. Chỉ khi runtime được CEO duyệt bật thì runner
  // mới đăng ký handler; OFF nghĩa là job đứng chờ, không dựng sổ/ghi state/gửi.
  if (services.paymentNoticeEnabled()) handlers.payment_notice = paymentNotice;
  const result = await runDueJobs({
    now,
    handlers,
  });

  const handled = new Set([...result.ran, ...result.failed.map((f) => f.key)]);
  const waiting = result.jobs.filter((job) => !handled.has(job.key));
  console.log(`[${stamp()}] tới giờ ${result.jobs.length} · đã chạy ${result.ran.length} · lỗi ${result.failed.length} · chờ handler ${waiting.length}`);
  for (const key of result.ran) console.log(`  ✅ ${key}`);
  for (const item of result.failed) console.log(`  ⛔ ${item.key}: ${item.message} (không đánh dấu — lần sau chạy lại)`);
  for (const job of waiting) console.log(`  ⏳ ${job.key}: chưa có handler — sẽ hiện lại cho đến khi cắm`);
  if (result.failed.length) process.exitCode = 1;
}

async function cli() {
  // Dry-run tuyệt đối read-only. Run thật luôn tự bọc `flock`: hai cron/manual
  // chồng nhau thì chỉ một process được gửi; kernel tự nhả lock kể cả crash.
  if (DRY || PAYMENT_DRY || process.env.APP_REPORT_DUE_JOBS_LOCKED === '1') return main();
  const lockFile = path.join(persist.DIR, 'run_due_jobs.lock');
  const result = runLockedProcess({
    lockFile, command: process.execPath, args: [__filename, ...process.argv.slice(2)],
    env: { ...process.env, APP_REPORT_DUE_JOBS_LOCKED: '1' },
  });
  if (result.contended) {
    console.log(`[${stamp()}] Bỏ qua: một lượt run_due_jobs khác đang giữ lock.`);
    return;
  }
  if (result.status) process.exitCode = result.status;
}

if (require.main === module) {
  cli().catch((error) => { console.error(`⛔ ${error.stack || error.message}`); process.exit(1); });
}

module.exports = { main, cli };
