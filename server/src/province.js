/**
 * province.js — Xác định TỈNH/THÀNH của một đơn vị.
 * Thứ tự ưu tiên:
 *   1) row.province — nếu file upload có cột "Tỉnh".
 *   2) Map chính thức mã đơn vị -> tỉnh: server/config/unit_province.json (bot điền).
 *   3) Đoán theo TÊN đơn vị (tên tỉnh hoặc TP/huyện quen thuộc — vùng lõi Đồng Nai
 *      & Bình Phước + các tỉnh miền Nam/lân cận: BR-VT, Bình Dương, TP.HCM, Long An,
 *      Tây Ninh, Lâm Đồng, Bình Thuận, Ninh Thuận, Đắk Nông, Đắk Lắk, Tiền Giang).
 * Không xác định được -> '' (đơn vị sẽ gộp vào nhóm "Chưa gán tỉnh").
 */
const fs = require('fs');
const path = require('path');

const MAP_FILE = path.join(__dirname, '..', 'config', 'unit_province.json');
let _map = null, _mtime = -1;
function loadMap() {
  try {
    const st = fs.statSync(MAP_FILE);
    if (!_map || st.mtimeMs !== _mtime) {
      const j = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) || {};
      _map = j.map && typeof j.map === 'object' ? j.map : j; // chấp nhận {map:{...}} hoặc {...}
      _mtime = st.mtimeMs;
    }
  } catch { if (!_map) _map = {}; }
  return _map;
}

const noAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

// Từ khóa (không dấu) -> tỉnh. ĐƯA HUYỆN ĐẶC THÙ TRƯỚC (Bình Phước, Đồng Nai —
// vùng lõi), rồi tới các tỉnh lân cận/miền Nam ở mức TÊN TỈNH + thành phố/huyện
// KHÔNG trùng tên giữa các tỉnh (tránh 'chau thanh', 'tan chau'… gây map sai).
const KEYWORDS = [
  ['Bình Phước', ['binh phuoc', 'dong xoai', 'phuoc long', 'binh long', 'chon thanh', 'dong phu', 'bu dang', 'bu dop', 'bu gia map', 'loc ninh', 'hon quan', 'phu rieng']],
  ['Đồng Nai', ['dong nai', 'bien hoa', 'long khanh', 'nhon trach', 'long thanh', 'trang bom', 'thong nhat', 'cam my', 'xuan loc', 'dinh quan', 'tan phu', 'vinh cuu']],
  ['Bà Rịa - Vũng Tàu', ['ba ria', 'vung tau', 'phu my', 'chau duc', 'xuyen moc', 'long dien', 'dat do', 'con dao']],
  ['Bình Dương', ['binh duong', 'thu dau mot', 'di an', 'thuan an', 'ben cat', 'tan uyen', 'bau bang', 'dau tieng', 'phu giao']],
  ['TP. Hồ Chí Minh', ['ho chi minh', 'tphcm', 'tp hcm', 'sai gon', 'thu duc']],
  ['Long An', ['long an', 'tan an', 'ben luc', 'duc hoa', 'can giuoc', 'can duoc', 'thu thua', 'moc hoa', 'kien tuong']],
  ['Tây Ninh', ['tay ninh', 'trang bang', 'go dau', 'hoa thanh', 'ben cau', 'duong minh chau', 'tan bien']],
  ['Lâm Đồng', ['lam dong', 'da lat', 'bao loc', 'duc trong', 'di linh', 'don duong', 'lam ha', 'bao lam', 'da huoai', 'cat tien']],
  ['Bình Thuận', ['binh thuan', 'phan thiet', 'la gi', 'ham thuan', 'tuy phong', 'bac binh', 'duc linh', 'tanh linh', 'ham tan']],
  ['Ninh Thuận', ['ninh thuan', 'phan rang', 'ninh hai', 'ninh phuoc', 'ninh son', 'thuan bac', 'thuan nam']],
  ['Đắk Nông', ['dak nong', 'dac nong', 'gia nghia', 'dak mil', 'dak rlap', 'dak song', 'krong no', 'cu jut', 'tuy duc']],
  ['Đắk Lắk', ['dak lak', 'dac lac', 'buon ma thuot', 'buon me thuot', 'ea kar', 'krong pak', 'cu mgar', 'ea hleo']],
  ['Tiền Giang', ['tien giang', 'my tho', 'cai lay', 'cai be', 'go cong', 'cho gao', 'chau thanh tien giang']],
];
// Viết tắt tỉnh ở dạng TOKEN (biên từ) — chỉ tỉnh LÕI, ít nhầm.
// VD tên đơn vị thật "BV Cao Su ĐN" -> token "dn" -> Đồng Nai; "... BP" -> Bình Phước.
const ABBR = [
  ['Đồng Nai', ['dn']],
  ['Bình Phước', ['bp']],
];
function fromName(name) {
  const n = noAccent(name);
  if (!n) return '';
  for (const [prov, kws] of KEYWORDS) for (const k of kws) if (n.includes(k)) return prov;
  // Khớp viết tắt chỉ khi là 1 TOKEN đứng riêng (tránh dính giữa chữ).
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  for (const [prov, abbrs] of ABBR) for (const a of abbrs) if (tokens.includes(a)) return prov;
  return '';
}

function provinceOf(unitCode, unitName, rowProvince) {
  if (rowProvince) return String(rowProvince).trim();
  const m = loadMap();
  if (unitCode && m[unitCode]) return String(m[unitCode]).trim();
  // Đoán theo tên; nếu tên trống thì thử ngay trên MÃ đơn vị (mã thật thường kèm tên+tỉnh).
  return fromName(unitName) || fromName(unitCode);
}

module.exports = { provinceOf };
