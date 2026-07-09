/**
 * llm.js — Điểm cắm LLM (Claude) cho AI hỏi nhanh, theo nguyên tắc GROUNDED:
 *   - LLM CHỈ được dùng các SỐ đã tính sẵn (facts) trong phạm vi quyền.
 *   - LLM KHÔNG được bịa số; nếu facts không có thì phải nói "không có dữ liệu".
 *   - Không gửi dữ liệu thô/PII cho LLM — chỉ gửi số tổng hợp.
 *
 * Bật bằng biến môi trường:
 *   ANTHROPIC_API_KEY=sk-ant-...        (bắt buộc để bật)
 *   LLM_MODEL=claude-haiku-4-5-20251001 (mặc định; có thể đổi claude-sonnet-5)
 * Nếu không cấu hình -> trả null để AI dùng câu gợi ý code-first.
 */
const MODEL = process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';

function isEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM = [
  'Bạn là trợ lý báo cáo doanh thu nội bộ của Donapharm.',
  'CHỈ được dùng các con số trong khối FACTS (JSON) mà hệ thống cung cấp.',
  'TUYỆT ĐỐI không được bịa hay ước lượng số. Nếu FACTS không chứa dữ liệu để trả lời, hãy nói rõ "Mình không có dữ liệu đó trong phạm vi hiện tại".',
  'Trả lời ngắn gọn bằng tiếng Việt, đúng trọng tâm câu hỏi. Định dạng số theo kiểu Việt Nam.',
  'Tất cả số tiền trong FACTS là đồng Việt Nam (VND). Không được tự đổi sai đơn vị: 231.000.000đ là 231 triệu, KHÔNG phải 231 tỷ; 818.000.000đ là khoảng 818 triệu/ngày, KHÔNG phải 818 tỷ/ngày. Nếu không chắc thì ghi nguyên số VND.',
  'Tránh phóng đại. Chỉ dùng đơn vị tỷ khi số tiền >= 1.000.000.000 VND; nếu dưới mức đó dùng triệu hoặc ghi nguyên VND.',
  'Nếu FACTS có can_ban_moi_ngay_hien_thi thì khi nói số cần bán mỗi ngày PHẢI dùng đúng chuỗi đó. Không được lấy con_thieu_target để nói thành số/ngày.',
  'Nếu FACTS chỉ nói cơ số/hạn mức còn lại hoặc co_so_thau_sap_can thì không được diễn thành hết hạn thầu/tái thầu. Hãy nói sắp cạn cơ số/hạn mức hoặc cần kiểm tra bổ sung hàng.',
  'tien_do_thoi_gian_pct là phần trăm ngày đã trôi trong tháng; không được diễn thành đã qua 1 tháng nếu chưa đủ tháng.',
].join(' ');

/**
 * @returns {Promise<{text:string, source:'llm'}|null>}
 */
async function callLlm({ question, facts }) {
  if (!isEnabled()) return null; // TODO(LIVE): cấu hình ANTHROPIC_API_KEY để bật
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        temperature: 0,
        system: SYSTEM,
        messages: [
          { role: 'user', content: `FACTS:\n${JSON.stringify(facts)}\n\nCâu hỏi: ${question}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text).join('').trim();
    return text ? { text, source: 'llm' } : null;
  } catch {
    return null; // lỗi mạng/LLM -> im lặng fallback về code
  }
}

module.exports = { callLlm, isEnabled, MODEL };
