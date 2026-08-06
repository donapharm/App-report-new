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
 *   - target_proposal: CHƯA có handler thật (đợt sau). Ở đây chỉ GHI LOG rồi đánh dấu
 *     đã chạy — TUYỆT ĐỐI KHÔNG tự áp target (luật CEO: target là tiền, CEO bấm mới ghi).
 *   - payment_notice: CỐ Ý không cắm handler ⇒ việc hiện lại mỗi lần chạy dưới nhãn
 *     "chờ handler" và KHÔNG bị đánh dấu đã chạy. Đánh dấu một việc chưa làm gì là
 *     giấu mất sự thật "chưa ai nhắc thanh toán"; để nó lộ ra cho đến khi có handler
 *     thật (cần sổ thanh toán từng NV + notifyChannels — làm ở đợt sau, có duyệt).
 */
const persist = require('../src/persist');
const { dueJobs, runDueJobs, readState } = require('../src/scheduledJobs');

const DRY = process.argv.includes('--dry-run');

const stamp = () => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date());

async function main() {
  const now = new Date();
  if (DRY) {
    const jobs = dueJobs(now, readState(persist));
    console.log(`[${stamp()}] DRY-RUN — ${jobs.length} việc tới giờ (giờ VN):`);
    for (const job of jobs) console.log(`  · ${job.job} (key=${job.key})${job.stage ? ` stage=${job.stage} targetKy=${job.targetKy} anchorKy=${job.anchorKy}` : ''}`);
    if (!jobs.length) console.log('  (không có việc nào tới giờ)');
    console.log('Chưa chạy gì, chưa ghi state. Bỏ --dry-run để chạy thật.');
    return;
  }

  const result = await runDueJobs({
    now,
    handlers: {
      target_proposal: async (job) => {
        // Đợt sau mới có handler thật. KHÔNG tự áp target — chỉ ghi log để lại dấu vết.
        console.log(`[${stamp()}] target_proposal ${job.stage} cho kỳ ${job.targetKy} (neo ${job.anchorKy}, closed=${job.closed}) — handler chưa làm, CHỈ GHI LOG, không áp target.`);
      },
    },
  });

  const handled = new Set([...result.ran, ...result.failed.map((f) => f.key)]);
  const waiting = result.jobs.filter((job) => !handled.has(job.key));
  console.log(`[${stamp()}] tới giờ ${result.jobs.length} · đã chạy ${result.ran.length} · lỗi ${result.failed.length} · chờ handler ${waiting.length}`);
  for (const key of result.ran) console.log(`  ✅ ${key}`);
  for (const item of result.failed) console.log(`  ⛔ ${item.key}: ${item.message} (không đánh dấu — lần sau chạy lại)`);
  for (const job of waiting) console.log(`  ⏳ ${job.key}: chưa có handler — sẽ hiện lại cho đến khi cắm`);
  if (result.failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(`⛔ ${error.stack || error.message}`); process.exit(1); });
