/**
 * province.js — Xác định TỈNH/THÀNH của một đơn vị.
 * Thứ tự ưu tiên:
 *   1) row.province — nếu file upload có cột "Tỉnh".
 *   2) Map chính thức mã đơn vị -> tỉnh: server/config/unit_province.json (bot điền).
 *   3) Đoán theo TÊN đơn vị (tên tỉnh hoặc huyện/thị quen thuộc — chủ yếu Đồng Nai & Bình Phước).
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

// Từ khóa (không dấu) -> tỉnh. Đưa Bình Phước trước để huyện đặc thù không lẫn.
const KEYWORDS = [
  ['Bình Phước', ['binh phuoc', 'dong xoai', 'phuoc long', 'binh long', 'chon thanh', 'dong phu', 'bu dang', 'bu dop', 'bu gia map', 'loc ninh', 'hon quan', 'phu rieng']],
  ['Đồng Nai', ['dong nai', 'bien hoa', 'long khanh', 'nhon trach', 'long thanh', 'trang bom', 'thong nhat', 'cam my', 'xuan loc', 'dinh quan', 'tan phu', 'vinh cuu']],
];
function fromName(name) {
  const n = noAccent(name);
  if (!n) return '';
  for (const [prov, kws] of KEYWORDS) for (const k of kws) if (n.includes(k)) return prov;
  return '';
}

function provinceOf(unitCode, unitName, rowProvince) {
  if (rowProvince) return String(rowProvince).trim();
  const m = loadMap();
  if (unitCode && m[unitCode]) return String(m[unitCode]).trim();
  return fromName(unitName);
}

module.exports = { provinceOf };
