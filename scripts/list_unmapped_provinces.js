/**
 * Liệt kê các ĐƠN VỊ chưa xác định được TỈNH (map trống + tên không đoán ra).
 * Dùng để bot chỉ cần điền những đơn vị này vào server/config/unit_province.json.
 *
 * Chạy trên server thật:  node scripts/list_unmapped_provinces.js
 * In ra JSON {unit_code: ""} để copy vào phần "map".
 */
const path = require('path');
const store = require(path.join(__dirname, '..', 'server', 'src', 'store'));
const { provinceOf } = require(path.join(__dirname, '..', 'server', 'src', 'province'));

const catalog = store.db().catalog || {};
const units = catalog.units || [];
const unmapped = [];
for (const u of units) {
  const prov = provinceOf(u.unit_code, u.unit_name);
  if (!prov) unmapped.push({ unit_code: u.unit_code, unit_name: u.unit_name });
}

console.log(`Tổng ${units.length} đơn vị · CHƯA có tỉnh: ${unmapped.length}`);
console.log('--- Danh sách (mã · tên) ---');
unmapped.forEach((u) => console.log(`${u.unit_code}\t${u.unit_name || ''}`));
console.log('\n--- Khối để dán vào "map" của unit_province.json (điền tỉnh vào ""): ---');
const skeleton = {};
unmapped.forEach((u) => { skeleton[u.unit_code] = ''; });
console.log(JSON.stringify(skeleton, null, 2));
