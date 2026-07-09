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

const INTERPRET_SYSTEM = [
  'Bạn chỉ trích xuất ý định câu hỏi App Report thành JSON thuần, không giải thích.',
  'Không tính số, không bịa dữ liệu, không dùng markdown.',
  'Trả đúng một JSON object có schema:',
  '{"metric":"revenue|points|xu|target|cst|movement|overview|unknown","dimension":"unit|product|emp|contractor|bid_package|province|null","unitHint":"string|null","productHint":"string|null","empHint":"string|null","selfScoped":true,"period":"MM.YYYY|current|null","listAll":false,"needClarify":"string|null"}',
  'Hiểu cả tiếng Việt có dấu/không dấu và tiếng Anh.',
  'Nếu người hỏi nói tôi/của tôi/I/my/me thì selfScoped=true.',
  'Nếu hỏi at/in/tại/ở/bên/của một bệnh viện/đơn vị thì dimension="unit" và unitHint là tên/mã đơn vị.',
  'Nếu hỏi product/sản phẩm/thuốc ở một đơn vị thì metric="revenue", dimension="product", unitHint là đơn vị.',
  'Nếu hỏi how much did I sell/doanh thu tôi bán được thì metric="revenue", selfScoped=true.',
  'Nếu người dùng nói tháng/JULY mà không có năm thì dùng năm từ CURRENT_PERIOD trong user message để trả period="MM.YYYY". Ví dụ CURRENT_PERIOD=08.2026 và hỏi July/tháng 7 thì period="07.2026".',
  'Nếu chỉ liệt kê/top/theo toàn bộ thì listAll=true; nếu hỏi một thực thể cụ thể thì listAll=false.',
].join(' ');

function cleanJsonText(s) {
  let t = String(s || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t;
}
function normIntent(x) {
  if (!x || typeof x !== 'object') return null;
  const metricOk = new Set(['revenue', 'points', 'xu', 'target', 'cst', 'movement', 'overview', 'unknown']);
  const dimOk = new Set(['unit', 'product', 'emp', 'contractor', 'bid_package', 'province', null]);
  const metric = metricOk.has(x.metric) ? x.metric : 'unknown';
  const dimension = dimOk.has(x.dimension) ? x.dimension : null;
  const str = (v) => (v == null || v === '' || v === 'null' ? null : String(v).trim());
  let period = str(x.period);
  if (period && period !== 'current' && !/^\d{2}\.\d{4}$/.test(period)) period = null;
  return {
    metric,
    dimension,
    unitHint: str(x.unitHint),
    productHint: str(x.productHint),
    empHint: str(x.empHint),
    selfScoped: !!x.selfScoped,
    period,
    listAll: !!x.listAll,
    needClarify: str(x.needClarify),
  };
}

async function interpretQuery(question, { currentPeriod } = {}) {
  if (!isEnabled()) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(process.env.LLM_INTERPRET_TIMEOUT_MS || 8000));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        temperature: 0,
        system: INTERPRET_SYSTEM,
        messages: [{ role: 'user', content: `CURRENT_PERIOD: ${currentPeriod || 'current'}\nQUESTION: ${String(question || '').slice(0, 500)}` }],
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text).join('').trim();
    return normIntent(JSON.parse(cleanJsonText(text)));
  } catch {
    return null;
  }
}


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

module.exports = { callLlm, interpretQuery, isEnabled, MODEL };
