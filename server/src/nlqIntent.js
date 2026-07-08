/*
 * nlqIntent.js — phân loại câu hỏi tự nhiên thành intent có cấu trúc.
 * Mục tiêu: không để fuzzy lookup thuốc/đơn vị quyết định trước ý định chính.
 * LLM (nếu dùng sau này) chỉ nên sinh JSON theo schema này; số liệu vẫn do code tính.
 */
function noAccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
function norm(text) { return noAccent(String(text || '').toLowerCase()).replace(/\s+/g, ' ').trim(); }
function limitFrom(q, def = 5, max = 30) {
  const m = q.match(/top\s*(\d{1,2})|(?:lay|xem|liet ke|hien)\s*(\d{1,2})|\b(\d{1,2})\s*(?:dong|muc|don vi|san pham|nv|nhan vien)\b/);
  const n = Number(m?.[1] || m?.[2] || m?.[3] || def);
  return Math.min(max, Math.max(1, Number.isFinite(n) ? n : def));
}
function periodText(q) {
  return (q.match(/(?:t|thang)\s*0?([1-9]|1[0-2])(?:[./-]?(20\d{2}|\d{2}))?/) || [])[0] || '';
}

function classify(text) {
  const q = norm(text);
  const has = (re) => re.test(q);
  const asksRevenue = has(/doanh thu|doanh so|tong tien|ban duoc|bao nhieu tien/);
  const productCue = has(/thuoc|san pham|mat hang|ma hang|ma thuoc|qlnb|hoat chat/);
  const unitCue = has(/don vi|benh vien|phong kham|nha thuoc|khach hang|ma dv/);
  const empCue = has(/nhan vien|\bnv\b|sale/);
  const topCue = has(/top|xep hang|ranking|dan dau|dung dau|cao nhat|nhieu nhat|ban chay/);
  const detailCue = has(/theo|tung|moi|liet ke|thong ke|chi tiet|danh sach|tat ca|toan bo|day du|het cac|lay het/);

  if (has(/chi phi|cp total|%\s*total|gia von|loi nhuan|margin|lai gop|ty le chi phi/)) return { intent: 'sensitive' };
  if (has(/\b(help|menu|giup)\b|huong dan|lam duoc gi|hoi gi|ban lam gi|chuc nang|tro giup/)) return { intent: 'help' };
  if (has(/^(chao|hi|hello|alo|xin chao|hey)\b/)) return { intent: 'greeting' };
  if (has(/(toi|minh|em)\s+la\b.*\b(nv|nhan vien|dn\d{3}|vp\d{3})\b|\bban tra loi\b|\btra loi toi\b/)) return { intent: 'identity_check' };

  const empCodeMention = (q.match(/\b(dn\d{3}|vp\d{3}|ceo)\b/) || [])[1];
  if (empCodeMention && asksRevenue) return { intent: 'revenue_employee', empCode: empCodeMention.toUpperCase() };

  if (topCue || has(/\b(ai|nguoi nao)\b.*(dan dau|dung dau|cao nhat|nhieu nhat)/)) {
    if (empCue || has(/\b(ai|nguoi nao)\b.*(dan dau|dung dau|cao nhat|nhieu nhat)/)) return { intent: 'ranking', dimension: 'emp', limit: limitFrom(q, 5) };
    if (unitCue || has(/co doanh thu|phat sinh doanh thu/)) return { intent: 'ranking', dimension: 'unit', limit: limitFrom(q, has(/top\s*10|10\s*(don vi|benh vien|phong kham|khach)/) ? 10 : 5) };
    if (productCue || has(/ban chay/)) return { intent: 'ranking', dimension: 'product', limit: limitFrom(q, 5) };
    if (has(/nha thau/)) return { intent: 'ranking', dimension: 'contractor', limit: limitFrom(q, 5) };
    if (has(/goi thau/)) return { intent: 'ranking', dimension: 'bid_package', limit: limitFrom(q, 5) };
    if (has(/tinh|thanh pho|khu vuc/)) return { intent: 'ranking', dimension: 'province', limit: limitFrom(q, 8) };
  }

  if (has(/(co doanh thu|phat sinh doanh thu).*(don vi|benh vien|phong kham|khach)|(don vi|benh vien|phong kham|khach).*(co doanh thu|phat sinh doanh thu)/)) {
    return { intent: 'ranking', dimension: 'unit', limit: limitFrom(q, 10) };
  }
  if (detailCue) {
    if (empCue) return { intent: 'breakdown', dimension: 'emp', limit: limitFrom(q, 10) };
    if (unitCue) return { intent: 'breakdown', dimension: 'unit', limit: limitFrom(q, 15) };
    if (productCue) return { intent: 'breakdown', dimension: 'product', limit: limitFrom(q, 15) };
    if (has(/nha thau/)) return { intent: 'breakdown', dimension: 'contractor', limit: limitFrom(q, 10) };
    if (has(/goi thau/)) return { intent: 'breakdown', dimension: 'bid_package', limit: limitFrom(q, 10) };
  }

  if (has(/bao cao tong hop|tong hop|tong quan|bao cao chung|tinh hinh chung|so lieu chung/)) return { intent: 'overview' };
  if (has(/giam manh|sut giam|tut manh|giam nhieu|tang manh|tang truong/)) return { intent: 'unit_movement' };
  if (has(/con thieu|con bao nhieu|can ban bao nhieu|can them|bao nhieu nua|de dat target|cach target|cham target|con cach/)) return { intent: 'target_gap' };
  if (has(/target|chi tieu|% ?dat|dat bao nhieu|hoan thanh/)) return { intent: 'target_pct' };
  if (has(/so voi|so ky truoc|so thang truoc|tang hay giam|tang giam|bien dong|so sanh/)) return { intent: 'comparison' };
  if (has(/chua ban|chua khai thac|can cham|chua co don|chua ban gi/)) return { intent: 'cst_empty' };
  if (has(/co so|con lai|sap can|ton kho|con nhieu/)) return { intent: 'cst_low' };

  // Tra cứu đích danh chỉ khi có dấu hiệu rõ ràng. Không dùng cho câu doanh thu chung.
  if (has(/gia thau|don gia|qlnb|ma hang|ma thuoc|hoat chat|tra cuu|tim thuoc|thong tin (san pham|thuoc)/)) return { intent: 'entity_lookup', entity: 'product' };
  if (has(/\bai ban\b|ai phu trach|nhan vien nao ban|nv nao ban/) || (unitCue && asksRevenue)) return { intent: 'entity_lookup', entity: 'unit' };

  if (asksRevenue) return { intent: 'revenue_total' };
  return { intent: 'unknown', periodText: periodText(q) };
}

module.exports = { classify, norm, noAccent, limitFrom };
