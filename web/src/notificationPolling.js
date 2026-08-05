export const NOTIFICATION_POLL_SUCCESS_MS = 60_000;
export const NOTIFICATION_POLL_RETRY_INITIAL_MS = 20_000;
export const NOTIFICATION_POLL_MAX_MS = 300_000;
export const NOTIFICATION_POLL_MAX_CONSECUTIVE_FAILURES = 5;
export const NOTIFICATION_POLL_AUTH_MESSAGE = 'Phiên đăng nhập đã hết hạn. Chuông đã dừng cập nhật; vui lòng đăng nhập lại.';
export const NOTIFICATION_POLL_FORBIDDEN_MESSAGE = 'Tài khoản không có quyền xem thông báo. Chuông đã dừng cập nhật.';
export const NOTIFICATION_POLL_PERMANENT_MESSAGE = 'Không thể tải thông báo sau nhiều lần thử. Chuông đã dừng cập nhật.';
export const NOTIFICATION_POLL_RETRYING_MESSAGE = 'Chưa tải được thông báo. Chuông sẽ tự thử lại.';

function notificationHttpStatus(error) {
  const raw = error?.status;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const text = String(raw ?? '');
  return /^\d+$/.test(text) ? Number(text) : null;
}

export function notificationPollFailure(error) {
  const status = notificationHttpStatus(error);
  if (status === 401) {
    return { retry: false, message: NOTIFICATION_POLL_AUTH_MESSAGE };
  }
  if (status === 403) {
    return { retry: false, message: NOTIFICATION_POLL_FORBIDDEN_MESSAGE };
  }
  // Không có mã HTTP hợp lệ gồm timeout, lỗi mạng và cả lỗi lập trình.
  // Tất cả đều được thử lại có kiểm soát bởi trần lỗi liên tiếp của polling loop.
  if (status === null || status === 0 || status >= 500) {
    return { retry: true, message: NOTIFICATION_POLL_RETRYING_MESSAGE };
  }
  return {
    retry: false,
    // 4xx khác (và mã bất thường) không tự khỏi; không chiếu chi tiết kỹ thuật lên UI.
    message: NOTIFICATION_POLL_PERMANENT_MESSAGE,
  };
}

export function notificationFailureFromSettled(results = []) {
  const failures = results
    .filter((result) => result?.status === 'rejected')
    .map((result) => result.reason || new Error('Không tải được thông báo'));
  return failures.find((error) => {
    const status = notificationHttpStatus(error);
    return status === 401 || status === 403;
  }) || failures[0] || null;
}

export function createNotificationPollingLoop({
  refresh,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onPermanentError = () => {},
  successDelayMs = NOTIFICATION_POLL_SUCCESS_MS,
  retryInitialDelayMs = NOTIFICATION_POLL_RETRY_INITIAL_MS,
  maxDelayMs = NOTIFICATION_POLL_MAX_MS,
  maxConsecutiveFailures = NOTIFICATION_POLL_MAX_CONSECUTIVE_FAILURES,
} = {}) {
  if (typeof refresh !== 'function') throw new TypeError('refresh phải là hàm');
  let timer = null;
  let stopped = false;
  let disposed = false;
  let running = false;
  let manualRetryAllowed = false;
  let retryDelayMs = retryInitialDelayMs;
  let consecutiveFailures = 0;

  const clearScheduled = () => {
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
  };
  const schedule = (delayMs) => {
    if (stopped || disposed) return;
    clearScheduled();
    timer = setTimeoutFn(run, delayMs);
  };
  async function run() {
    if (disposed || stopped || running) return;
    running = true;
    try {
      await refresh();
      consecutiveFailures = 0;
      retryDelayMs = retryInitialDelayMs;
      manualRetryAllowed = false;
      schedule(successDelayMs);
    } catch (error) {
      const failure = notificationPollFailure(error);
      if (!failure.retry) {
        stopped = true;
        manualRetryAllowed = false;
        clearScheduled();
        onPermanentError(failure.message, error, { canRetry: false, consecutiveFailures });
        return;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        stopped = true;
        manualRetryAllowed = true;
        clearScheduled();
        onPermanentError(NOTIFICATION_POLL_PERMANENT_MESSAGE, error, {
          canRetry: true,
          consecutiveFailures,
        });
        return;
      }
      const delayMs = retryDelayMs;
      retryDelayMs = Math.min(maxDelayMs, retryDelayMs * 2);
      schedule(delayMs);
    } finally {
      running = false;
    }
  }

  return {
    start: run,
    runNow() {
      clearScheduled();
      return run();
    },
    retryNow() {
      if (disposed || running || !manualRetryAllowed) return Promise.resolve();
      stopped = false;
      manualRetryAllowed = false;
      consecutiveFailures = 0;
      retryDelayMs = retryInitialDelayMs;
      clearScheduled();
      return run();
    },
    stop() {
      disposed = true;
      stopped = true;
      manualRetryAllowed = false;
      clearScheduled();
    },
    isStopped: () => stopped,
  };
}
