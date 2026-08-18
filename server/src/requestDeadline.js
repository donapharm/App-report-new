'use strict';
/**
 * ‼ HẠN CHÓT CHO CẢ YÊU CẦU — CEO lo 04/08: *"cứ mỗi lần nó load là lại cảm giác
 * thấy sợ nó lỗi hay treo luôn thì toi."*
 *
 * Đo được: bản "Tất cả NV" LẠNH, xấu nhất = 21 NV ÷ 3 luồng = 7 đợt × 25,5 giây
 * mỗi NV (3 lần thử + 2 lần chờ) ≈ **178 giây**. Trong khi trình duyệt bỏ cuộc ở
 * 45 giây và Cloudflare cắt ở 100 giây (lỗi 524). Tức là khi DataHub chậm, màn hình
 * CHẮC CHẮN đứt — server vẫn cày tiếp cho một người đã bỏ đi.
 *
 * Cách chữa: chốt một hạn chót. Tới hạn thì TRẢ NGAY phần đã có; NV chưa kịp lấy
 * được đánh dấu `sourceOutcome: 'deadline'` ⇒ rơi vào đúng luồng "thiếu nguồn" sẵn
 * có, hiện tên trên băng đỏ. **Không bịa số 0 cho ai**, không im lặng.
 */
// 21 NV ÷ 3 luồng = 7 đợt. Nâng lên 6 còn 4 đợt — cắt gần nửa thời gian mà vẫn
// không dội quá mạnh vào DataHub (nguồn đang hay kẹt khoá vault-audit).
const EMPLOYEE_COST_ALL_CONCURRENCY = Math.max(
  1, Number(process.env.APP_REPORT_COST_ALL_CONCURRENCY || 0) || 6,
);
const EMPLOYEE_COST_ALL_DEADLINE_MS = Math.max(
  5_000, Number(process.env.APP_REPORT_COST_ALL_DEADLINE_MS || 0) || 25_000,
);

async function mapWithDeadline(items, limit, worker, { deadlineAt, onSkip, now = () => Date.now() }) {
  const results = new Array(items.length);
  let cursor = 0;
  const left = () => deadlineAt - now();
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      // Hết giờ thì KHÔNG bắt đầu thêm ai nữa — bắt đầu cũng không kịp trả.
      if (left() <= 0) { results[index] = onSkip(item, 'deadline'); continue; }
      let timer = null;
      try {
        results[index] = await Promise.race([
          worker(item, index),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), left()); }),
        ]) || onSkip(item, 'deadline');
      } catch (error) {
        // Một NV hỏng KHÔNG được kéo sập cả bảng đội.
        results[index] = onSkip(item, 'error', error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

module.exports = { mapWithDeadline, EMPLOYEE_COST_ALL_CONCURRENCY, EMPLOYEE_COST_ALL_DEADLINE_MS };
