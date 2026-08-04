'use strict';
/**
 * QUYỀN ƯU TIÊN ỨNG SỚM LẦN 2 — CEO chốt 04/08/2026 22:45.
 *
 * CEO: *"Mỗi NV trong vòng 3 tháng chỉ được phép đề xuất ứng chi phí lần 2 sớm một
 * lần, lần đề xuất đó không sớm hơn 30 ngày kể từ khi kết thúc tháng bán hàng…
 * nghĩa là sớm hơn 15 ngày. Và mỗi quý chỉ được ứng lần 2 sớm hơn 15 ngày một lần.
 * NV phải cân nhắc lựa chọn tháng nào để sử dụng quyền ưu tiên. Sau khi quyền ưu
 * tiên được sử dụng rồi thì lần khác trong quý đó… hệ thống sẽ đưa ra cảnh báo là
 * bạn đã hết lượt và sẽ chặn không cho thao tác tiếp."*
 *
 * Hai điều kiện, phải thoả CẢ HAI:
 *   1. **Chưa quá sớm**: phải **qua đủ 30 ngày** kể từ khi hết tháng bán hàng.
 *      Xem đính chính của CEO ngay dưới — con số "15 ngày" trong câu nói trên là
 *      CEO ước lượng, mốc thật CEO chốt là **01/10 cho kỳ T08**, tức 14 ngày.
 *   2. **Còn lượt**: mỗi NV **1 lượt / quý**. Hết lượt thì CHẶN, không phải cảnh báo suông.
 *
 * ‼ Lượt tính theo QUÝ CỦA KỲ BÁN HÀNG (kỳ T08 thuộc Q3), không phải quý của ngày
 * bấm nút — nếu tính theo ngày bấm thì NV bấm muộn vài ngày là nhảy sang quý sau và
 * được thêm lượt, thành lách luật.
 */

/**
 * ‼ CEO đính chính 04/08 23:00: *"nó phải là sau ngày 01/10 mới đúng nhé"* (cho kỳ T08.2026).
 *
 * Nghĩa là phải **QUA ĐỦ 30 NGÀY** kể từ khi hết tháng bán hàng, nên được bấm từ
 * **ngày thứ 31** — không phải đúng ngày thứ 30.
 *   T08 hết 31/08 → qua đủ 30 ngày là hết 30/09 → bấm được từ **01/10**. ✔ khớp CEO.
 *
 * Hệ quả nhỏ, ghi ra để khỏi ai tưởng sai: mốc này sớm hơn hạn Lần 2 **14 ngày**
 * (không phải 15), và đúng 14 ngày cho MỌI tháng — kể cả tháng 2. Bản trước dùng
 * ngày thứ 30 nên ra 30/09.
 */
const DAYS_AFTER_PERIOD_END = 31;    // qua đủ 30 ngày ⇒ bấm được từ ngày thứ 31
const QUOTA_PER_QUARTER = 1;

function normalizeMonth(value) {
  const text = String(value || '').trim();
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const vn = /^(0[1-9]|1[0-2])\.(\d{4})$/.exec(text);
  return vn ? `${vn[2]}-${vn[1]}` : '';
}

function periodEndDate(period) {
  const month = normalizeMonth(period);
  if (!month) return '';
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

function addDays(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return '';
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

const daysBetween = (from, to) => (
  /^\d{4}-\d{2}-\d{2}$/.test(String(from)) && /^\d{4}-\d{2}-\d{2}$/.test(String(to))
    ? Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000)
    : null
);

/** Quý của KỲ BÁN HÀNG. 'YYYY-MM' → 'YYYY-Qn'. */
function quarterOf(period) {
  const month = normalizeMonth(period);
  if (!month) return '';
  return `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
}

/** Ngày SỚM NHẤT được phép xin ứng sớm cho kỳ này. */
function earliestRequestDate(period) {
  const end = periodEndDate(period);
  return end ? addDays(end, DAYS_AFTER_PERIOD_END) : '';
}

const dmy = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).split('-').reverse().join('/') : '—');

/**
 * Được xin ứng sớm không?
 * @param {string} period    kỳ bán hàng 'YYYY-MM'
 * @param {string} today     'YYYY-MM-DD' theo giờ VN
 * @param {Array}  used      các lượt đã dùng: [{ period, at }]
 * @returns {{allowed:boolean, code:string, message:string, earliestDate:string, quarter:string, usedPeriod:string}}
 */
function checkEarlyRequest({ period, today, used = [] } = {}) {
  const month = normalizeMonth(period);
  const quarter = quarterOf(month);
  const earliestDate = earliestRequestDate(month);
  const base = { earliestDate, quarter, usedPeriod: '' };
  if (!month || !earliestDate) {
    return { ...base, allowed: false, code: 'PERIOD_INVALID', message: 'Kỳ không hợp lệ' };
  }

  // ① Hết lượt của quý ⇒ CHẶN. Kiểm TRƯỚC điều kiện ngày để câu báo nói đúng
  //    cái quan trọng nhất: đã dùng quyền cho tháng nào rồi.
  const sameQuarter = (Array.isArray(used) ? used : []).filter((item) => quarterOf(item?.period) === quarter);
  if (sameQuarter.length >= QUOTA_PER_QUARTER) {
    const spent = normalizeMonth(sameQuarter[0]?.period);
    return {
      ...base, allowed: false, code: 'EARLY_QUOTA_USED', usedPeriod: spent,
      message: `Bạn đã hết lượt dùng quyền ưu tiên ứng chi phí sớm của quý ${quarter}`
        + `${spent ? ` — đã dùng cho kỳ ${spent.slice(5)}/${spent.slice(0, 4)}` : ''}.`,
    };
  }

  // ② Chưa tới ngày sớm nhất ⇒ chặn, và nói rõ ngày nào mới được.
  const wait = daysBetween(today, earliestDate);
  if (today && wait != null && wait > 0) {
    return {
      ...base, allowed: false, code: 'EARLY_TOO_SOON',
      message: `Chưa tới lúc xin ứng sớm. Sớm nhất là ${dmy(earliestDate)} (còn ${wait} ngày)`
        + ' — phải qua đủ 30 ngày kể từ khi hết tháng bán hàng.',
    };
  }

  return {
    ...base, allowed: true, code: 'OK',
    message: `Còn ${QUOTA_PER_QUARTER} lượt ưu tiên trong quý ${quarter}. Dùng cho kỳ này thì hết lượt của quý.`,
  };
}

module.exports = {
  DAYS_AFTER_PERIOD_END, QUOTA_PER_QUARTER,
  quarterOf, earliestRequestDate, periodEndDate, checkEarlyRequest,
};
