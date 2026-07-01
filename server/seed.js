/**
 * seed.js — sinh dữ liệu MẪU ĐÃ ẨN DANH cho App Report New.
 * Không chứa PII/số liệu thật. Dữ liệu ổn định (seeded PRNG) để demo nhất quán.
 *
 * Sinh ra trong server/data/:
 *   users.json        danh sách tài khoản mẫu (CEO + Sale)
 *   catalog.json      đơn vị + sản phẩm + gói thầu
 *   report_rows.json  dòng doanh thu theo ReportRow (3 kỳ)
 *   cst_rows.json     cơ số thầu theo TenderQuotaRow
 *   targets.json      target theo NV theo kỳ
 */
const fs = require('fs');
const path = require('path');

// PRNG có hạt giống -> dữ liệu ổn định giữa các lần chạy
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260701);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);
const round = (n, unit) => Math.round(n / unit) * unit;

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const write = (name, obj) =>
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2), 'utf8');

// ---- Kỳ báo cáo ----
const PERIODS = [
  { ky: '04.2026', dateFrom: '2026-04-01', dateTo: '2026-04-30', trend: 1.0 },
  { ky: '05.2026', dateFrom: '2026-05-01', dateTo: '2026-05-31', trend: 1.06 },
  { ky: '06.2026', dateFrom: '2026-06-01', dateTo: '2026-06-30', trend: 1.11 },
];
const LATEST_KY = '06.2026';

// ---- Nhân viên (ẩn danh) ----
const users = [];
users.push({ emp_code: 'CEO', name: 'Ban Giám đốc (demo)', phone: '09xxxxxx01', role: 'ceo' });
users.push({ emp_code: 'ADMIN', name: 'Quản trị (demo)', phone: '09xxxxxx02', role: 'admin' });
const SALE_COUNT = 12;
const routes = ['Tuyến A', 'Tuyến B', 'Tuyến C', 'Tuyến D'];
for (let i = 1; i <= SALE_COUNT; i++) {
  const code = 'DN' + String(i).padStart(3, '0');
  users.push({
    emp_code: code,
    name: `NV Sale ${String(i).padStart(2, '0')}`,
    phone: '09xxxx' + String(1000 + i),
    role: 'sale',
    route: routes[(i - 1) % routes.length],
  });
}
const salesEmp = users.filter((u) => u.role === 'sale');

// ---- Danh mục đơn vị + sản phẩm ----
const unitTypes = ['BV', 'PK', 'NT']; // bệnh viện / phòng khám / nhà thuốc
const units = [];
for (let i = 1; i <= 20; i++) {
  const t = unitTypes[(i - 1) % unitTypes.length];
  units.push({
    unit_code: `${t}${String(i).padStart(3, '0')}`,
    unit_name: `${t === 'BV' ? 'Bệnh viện' : t === 'PK' ? 'Phòng khám' : 'Nhà thuốc'} Mẫu ${String(i).padStart(2, '0')}`,
    route: routes[(i - 1) % routes.length],
    owner: salesEmp[(i - 1) % salesEmp.length].emp_code,
  });
}
const products = [];
for (let i = 1; i <= 15; i++) {
  products.push({
    iit_code: 'QLNB' + String(100 + i),
    product_name: `Sản phẩm ${String.fromCharCode(64 + ((i - 1) % 26) + 1)}${String(i).padStart(2, '0')}`,
    ham_luong: pick(['250mg', '500mg', '10ml', '5mg', '80mg']),
    unit_price: round(between(15000, 320000), 500),
  });
}
const bidPackages = ['QĐ139', 'QĐ141'];
write('catalog.json', { units, products, bidPackages, periods: PERIODS, latest_ky: LATEST_KY });

// ---- Dòng doanh thu ----
const reportRows = [];
let rowId = 0;
for (const p of PERIODS) {
  for (const u of units) {
    // mỗi đơn vị bán 4-8 sản phẩm trong kỳ
    const nProd = Math.floor(between(4, 9));
    const chosen = [...products].sort(() => rnd() - 0.5).slice(0, nProd);
    for (const pr of chosen) {
      const qty = Math.floor(between(20, 400) * p.trend);
      const revenue = round(qty * pr.unit_price * between(0.9, 1.1), 1000);
      reportRows.push({
        id: ++rowId,
        ky: p.ky,
        date: p.dateFrom,
        emp_code: u.owner,
        unit_code: u.unit_code,
        route: u.route,
        iit_code: pr.iit_code,
        quantity: qty,
        revenue,
        contractor_code: pick(['NCC01', 'NCC02', 'NCC03']),
        bid_package: pick(bidPackages),
      });
    }
  }
}
write('report_rows.json', reportRows);

// ---- Cơ số thầu (theo kỳ mới nhất) ----
const cstRows = [];
for (const u of units) {
  const chosen = [...products].sort(() => rnd() - 0.5).slice(0, Math.floor(between(3, 7)));
  for (const pr of chosen) {
    const bidQty = round(between(2000, 12000), 100);
    const sold = Math.min(bidQty, Math.floor(bidQty * between(0.05, 1.0))); // không bán vượt cơ số
    const remain = bidQty - sold;
    cstRows.push({
      ky: LATEST_KY,
      emp_code: u.owner,
      unit_code: u.unit_code,
      unit_name: u.unit_name,
      iit_code: pr.iit_code,
      product_name: pr.product_name,
      ham_luong: pr.ham_luong,
      bid_package: pick(bidPackages),
      bid_qty_initial: bidQty,
      sold_qty: sold,
      remain_qty: remain,
      remain_pct: +(remain / bidQty * 100).toFixed(1),
    });
  }
}
write('cst_rows.json', cstRows);

// ---- Target theo NV theo kỳ ----
const targets = [];
for (const p of PERIODS) {
  for (const emp of salesEmp) {
    // target trước VAT ~ tương đương doanh thu tháng của NV (để % đạt thực tế, làm tròn 50 triệu)
    const empRev =
      reportRows
        .filter((r) => r.ky === p.ky && r.emp_code === emp.emp_code)
        .reduce((s, r) => s + r.revenue, 0) / 1.05;
    const factor = between(0.62, 1.3); // NV đạt ~62%–130% target (có người tụt để demo cảnh báo)
    targets.push({
      ky: p.ky,
      emp_code: emp.emp_code,
      target: Math.max(50e6, round((empRev || 300e6) / factor, 50e6)),
    });
  }
}
write('targets.json', targets);
write('users.json', users);

const totalRev = reportRows.filter((r) => r.ky === LATEST_KY).reduce((s, r) => s + r.revenue, 0);
console.log('✔ Seed xong dữ liệu mẫu ẩn danh:');
console.log(`  - ${users.length} tài khoản (1 CEO, 1 admin, ${salesEmp.length} sale)`);
console.log(`  - ${units.length} đơn vị, ${products.length} sản phẩm`);
console.log(`  - ${reportRows.length} dòng doanh thu (${PERIODS.length} kỳ)`);
console.log(`  - ${cstRows.length} dòng cơ số thầu, ${targets.length} target`);
console.log(`  - Doanh thu kỳ ${LATEST_KY}: ${totalRev.toLocaleString('vi-VN')} đ`);
