'use strict';

/**
 * Xác định tỉnh/thành của một đơn vị chỉ từ nguồn chính thức:
 *   1) cột tỉnh trên chính dòng dữ liệu;
 *   2) map mã đơn vị -> tỉnh tại server/config/unit_province.json.
 *
 * Không suy luận từ tên, huyện hay viết tắt. Thiếu cả hai nguồn trả chuỗi rỗng
 * để lớp trình bày gắn nhãn "Chưa gán tỉnh" một cách trung thực.
 */
const fs = require('fs');
const path = require('path');

const MAP_FILE = path.join(__dirname, '..', 'config', 'unit_province.json');
let _map = null;
let _mtime = -1;
const _cache = new Map();

function loadMap() {
  try {
    const stat = fs.statSync(MAP_FILE);
    if (!_map || stat.mtimeMs !== _mtime) {
      const parsed = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) || {};
      _map = parsed.map && typeof parsed.map === 'object' ? parsed.map : parsed;
      _mtime = stat.mtimeMs;
      _cache.clear();
    }
  } catch {
    if (!_map) _map = {};
  }
  return _map;
}

function provinceResolution(unitCode, _unitName, rowProvince) {
  const direct = String(rowProvince || '').trim();
  if (direct) return { value: direct, source: 'source' };

  const code = String(unitCode || '').trim();
  if (!code) return { value: '', source: '' };
  loadMap();
  if (_cache.has(code)) return _cache.get(code);

  const configured = String(_map?.[code] || '').trim();
  const result = configured ? { value: configured, source: 'config' } : { value: '', source: '' };
  _cache.set(code, result);
  return result;
}

function provinceOf(unitCode, unitName, rowProvince) {
  return provinceResolution(unitCode, unitName, rowProvince).value;
}

module.exports = { provinceOf, provinceResolution };
