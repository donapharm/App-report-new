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

const { monitorEventLoopDelay, PerformanceObserver, constants } = require('node:perf_hooks');
const { vnSecond } = require('./tickTelemetry');
const runtimeActivity = require('./runtimeActivity');
const { createDiagnosticLogLimiter } = require('./diagnosticLogLimiter');

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
const GC_WARN_MS = 200;
const ATTRIBUTION_INTERVAL_MS = 1_000;
const DETAIL_LIMIT_PER_MINUTE = 12;

let histogram = null;
let timer = null;
let attributionHistogram = null;
let attributionTimer = null;
let worstLagMs = 0;
let warnCount = 0;
let gcObserver = null;

const round = (value) => Math.round(value * 10) / 10;

function histogramSnapshot(target) {
  if (!target) return null;
  return {
    maxMs: round(target.max / MS),
    p99Ms: round(target.percentile(99) / MS),
    meanMs: round(target.mean / MS),
  };
}

function snapshot() { return histogramSnapshot(histogram); }

function createAttributionReporter({
  warnMs = WARN_LAG_MS,
  detailLimitPerMinute = DETAIL_LIMIT_PER_MINUTE,
  nowMs = Date.now,
  timestamp = vnSecond,
  activitySnapshot = runtimeActivity.snapshot,
  warn = console.warn,
} = {}) {
  const limiter = createDiagnosticLogLimiter({
    stream: 'event-loop-attribution',
    limit: detailLimitPerMinute,
    nowMs,
    detail: (record) => warn('[event-loop-attribution] NGHẼN', record),
    summary: (record) => warn('[event-loop-attribution-suppressed]', { at: timestamp(), ...record }),
  });
  return {
    observe(current) {
      if (!current || current.maxMs < warnMs) return false;
      return limiter.record({
        at: timestamp(),
        ...current,
        warnMs,
        windowMs: ATTRIBUTION_INTERVAL_MS,
        ...activitySnapshot(),
      });
    },
    flush: limiter.flush,
  };
}

function start() {
  if (timer) return timer;
  try {
    histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    histogram.enable();
    attributionHistogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    attributionHistogram.enable();
  } catch (error) {
    // Không có perf_hooks thì thôi, tuyệt đối không được làm hỏng lúc khởi động.
    console.warn('[event-loop] không bật được đồng hồ đo', { message: error.message });
    histogram = null;
    return null;
  }
  const attributionReporter = createAttributionReporter();
  attributionTimer = setInterval(() => {
    const current = histogramSnapshot(attributionHistogram);
    attributionReporter.observe(current);
    attributionReporter.flush();
    attributionHistogram.reset();
  }, ATTRIBUTION_INTERVAL_MS);
  if (typeof attributionTimer.unref === 'function') attributionTimer.unref();
  timer = setInterval(() => {
    const current = snapshot();
    if (!current) return;
    if (current.maxMs > worstLagMs) worstLagMs = current.maxMs;
    // Chỉ nói khi có chuyện. Khoẻ thì im.
    if (current.maxMs >= WARN_LAG_MS) {
      warnCount += 1;
      console.warn('[event-loop] NGHẼN — vòng lặp sự kiện bị chặn', {
        at: vnSecond(),
        ...current,
        warnMs: WARN_LAG_MS,
        windowMs: REPORT_INTERVAL_MS,
        warnCount,
        ...runtimeActivity.snapshot(),
      });
    }
    const memory = process.memoryUsage();
    console.log('[runtime-memory]', {
      at: vnSecond(),
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      rss: memory.rss,
    });
    histogram.reset();
  }, REPORT_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log('[event-loop] đồng hồ đo đã bật', {
    resolutionMs: RESOLUTION_MS, warnMs: WARN_LAG_MS, reportMs: REPORT_INTERVAL_MS,
  });
  try {
    gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < GC_WARN_MS) continue;
        const kind = entry.detail?.kind ?? entry.kind;
        const kindName = Object.entries(constants)
          .find(([name, value]) => name.startsWith('NODE_PERFORMANCE_GC_') && value === kind)?.[0]
          || String(kind ?? 'unknown');
        console.warn('[runtime-gc]', {
          at: vnSecond(),
          kind: kindName,
          durationMs: round(entry.duration),
        });
      }
    });
    gcObserver.observe({ entryTypes: ['gc'] });
  } catch (error) {
    console.warn('[runtime-gc] không bật được đồng hồ GC', { message: error.message });
    gcObserver = null;
  }
  return timer;
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (attributionTimer) { clearInterval(attributionTimer); attributionTimer = null; }
  if (histogram) { try { histogram.disable(); } catch { /* ignore */ } histogram = null; }
  if (attributionHistogram) {
    try { attributionHistogram.disable(); } catch { /* ignore */ }
    attributionHistogram = null;
  }
  if (gcObserver) { try { gcObserver.disconnect(); } catch { /* ignore */ } gcObserver = null; }
}

// Cho phép đọc số tại một thời điểm bất kỳ (dùng khi cần gắn vào một lượt đo cụ thể).
function read() {
  return { ...(snapshot() || { maxMs: null, p99Ms: null, meanMs: null }), worstLagMs, warnCount };
}

module.exports = {
  start, stop, read, createAttributionReporter,
  WARN_LAG_MS, RESOLUTION_MS, REPORT_INTERVAL_MS, ATTRIBUTION_INTERVAL_MS,
  DETAIL_LIMIT_PER_MINUTE, GC_WARN_MS,
};
