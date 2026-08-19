'use strict';

/* ĐỒNG HỒ ĐO NGHẼN VÒNG LẶP SỰ KIỆN.
 *
 * Vì sao cần: 19/08/2026 app bị watchdog bắn 11 lần. Chuỗi nhân quả đo được là
 * request "Tất cả nhân viên" lúc cache lạnh chạy 34–43 giây → /api/health trên cổng
 * 3873 KHÔNG trả lời → cron tưởng app chết → restart. Mà /api/health chỉ trả về một
 * object hằng, KHÔNG đọc kho, KHÔNG tính gì (index.js). Một endpoint rẻ như vậy mà
 * không trả lời thì chỉ có một cách giải thích: VÒNG LẶP SỰ KIỆN BỊ CHẶN — tức đang có
 * việc ĐỒNG BỘ chạy dài, không phải chờ mạng.
 *
 * ‼ NHƯNG CHẶN Ở ĐÂU THÌ CHƯA AI BIẾT. Đoán rồi vá mò là cách hỏng thêm. File này KHÔNG
 * sửa gì cả — nó chỉ ĐO, để lần chạy tới nói ra được con số thật:
 *   · có nghẽn không, và nghẽn bao lâu;
 *   · nghẽn trùng đúng lúc dựng ALL hay không.
 * Có số rồi mới biết phải vá chỗ nào, và cũng chính con số này là thước đo CHỨNG MINH
 * bản vá có ăn: sửa xong thì lag phải nằm dưới ngưỡng trong SUỐT lượt dựng ALL.
 *
 * Rẻ: monitorEventLoopDelay là histogram trong lõi Node, chi phí gần như bằng không.
 * An toàn: chỉ đọc số của chính tiến trình; KHÔNG ghi file, KHÔNG chạm dữ liệu, KHÔNG
 * ảnh hưởng luồng phục vụ. Log chỉ có con số mili-giây — không URL, không token, không
 * payload, không mã nhân viên.
 */

const { monitorEventLoopDelay } = require('node:perf_hooks');

const MS = 1e6; // histogram của Node trả nano-giây

// Lấy mẫu 20ms: đủ mịn để thấy một cú chặn ~100ms, mà vẫn không tốn gì.
const RESOLUTION_MS = 20;

// Ngưỡng kêu. Watchdog bắn app khi health im, nên thứ đáng quan tâm là những cú chặn
// đủ dài để một lượt kiểm health trượt — lấy 1 giây làm mốc kêu.
const WARN_LAG_MS = Math.max(
  100, Number(process.env.APP_REPORT_EVENT_LOOP_WARN_MS || 0) || 1000,
);

// Chu kỳ tổng kết. Mỗi 30 giây in một dòng NẾU có gì đáng nói; im lặng khi khoẻ để
// không bơm rác vào log (chính rác log đã góp phần làm đầy đĩa sáng 19/08).
const REPORT_INTERVAL_MS = Math.max(
  5_000, Number(process.env.APP_REPORT_EVENT_LOOP_REPORT_MS || 0) || 30_000,
);

let histogram = null;
let timer = null;
let worstLagMs = 0;
let warnCount = 0;

const round = (value) => Math.round(value * 10) / 10;

function snapshot() {
  if (!histogram) return null;
  return {
    maxMs: round(histogram.max / MS),
    p99Ms: round(histogram.percentile(99) / MS),
    meanMs: round(histogram.mean / MS),
  };
}

function start() {
  if (timer) return timer;
  try {
    histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    histogram.enable();
  } catch (error) {
    // Không có perf_hooks thì thôi, tuyệt đối không được làm hỏng lúc khởi động.
    console.warn('[event-loop] không bật được đồng hồ đo', { message: error.message });
    histogram = null;
    return null;
  }
  timer = setInterval(() => {
    const current = snapshot();
    if (!current) return;
    if (current.maxMs > worstLagMs) worstLagMs = current.maxMs;
    // Chỉ nói khi có chuyện. Khoẻ thì im.
    if (current.maxMs >= WARN_LAG_MS) {
      warnCount += 1;
      console.warn('[event-loop] NGHẼN — vòng lặp sự kiện bị chặn', {
        ...current,
        warnMs: WARN_LAG_MS,
        windowMs: REPORT_INTERVAL_MS,
        warnCount,
      });
    }
    histogram.reset();
  }, REPORT_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log('[event-loop] đồng hồ đo đã bật', {
    resolutionMs: RESOLUTION_MS, warnMs: WARN_LAG_MS, reportMs: REPORT_INTERVAL_MS,
  });
  return timer;
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (histogram) { try { histogram.disable(); } catch { /* ignore */ } histogram = null; }
}

// Cho phép đọc số tại một thời điểm bất kỳ (dùng khi cần gắn vào một lượt đo cụ thể).
function read() {
  return { ...(snapshot() || { maxMs: null, p99Ms: null, meanMs: null }), worstLagMs, warnCount };
}

module.exports = { start, stop, read, WARN_LAG_MS, RESOLUTION_MS, REPORT_INTERVAL_MS };
