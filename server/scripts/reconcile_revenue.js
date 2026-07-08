#!/usr/bin/env node
/**
 * reconcile_revenue.js — ĐỐI SOÁT Report-New ↔ Sale-New theo NV/kỳ (chạy trên server bot).
 *
 * Lớp 1 (LUÔN chạy, không cần DB): tính toàn vẹn slot Report-New — ngày ngoài biên, đếm trùng,
 *   lệch metadata, đơn vị NV biến mất so kỳ trước. (dùng lại server/src/reconcile.js)
 * Lớp 2 (chỉ khi DB Sale-New sẵn): DỰNG LẠI doanh thu từ NGUỒN bằng chính truy vấn của
 *   materialize (require lại, KHÔNG chạy materialize) rồi đối chiếu per (NV, đơn vị):
 *     - thiếu ở Report-New   (đơn vị/NV nguồn có, Report-New không có → kiểu DN009)
 *     - lệch doanh thu        (chênh > ngưỡng)
 *     - dư ở Report-New       (Report-New có mà nguồn không)
 *
 * Dùng:  MATERIALIZE_KY=07.2026 node server/scripts/reconcile_revenue.js [--json]
 *        (không set MATERIALIZE_KY → lấy kỳ hiện tại theo giờ VN)
 */
const fs = require('fs');
const path = require('path');

const asJson = process.argv.includes('--json');
const KY_ARG = (process.argv.find((a) => /^\d{2}\.\d{4}$/.test(a)) || process.env.MATERIALIZE_KY || process.env.REVENUE_REFRESH_KY || '').trim();
if (KY_ARG) { process.env.MATERIALIZE_KY = KY_ARG; process.env.REVENUE_REFRESH_KY = KY_ARG; }

const store = require(path.join('..', 'src', 'store'));
const reconcile = require(path.join('..', 'src', 'reconcile'));

const num = (v) => Number(v || 0);
const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(num(n)));

function aggByEmpUnit(rows) {
  const m = new Map();
  for (const r of rows) {
    const emp = r.emp_code || '', unit = r.unit_code || '';
    if (!emp && !unit) continue;
    const k = `${emp}|${unit}`;
    const g = m.get(k) || { emp_code: emp, emp_name: r.emp_name || '', unit_code: unit, unit_name: r.unit_name || unit, rows: 0, revenue: 0 };
    g.rows += 1; g.revenue += num(r.revenue);
    if (!g.emp_name && r.emp_name) g.emp_name = r.emp_name;
    if ((!g.unit_name || g.unit_name === g.unit_code) && r.unit_name) g.unit_name = r.unit_name;
    m.set(k, g);
  }
  return m;
}

async function sourceReconcile(ky) {
  // require lại materialize (module.exports) — KHÔNG chạy main(); PERIOD lấy theo env đã set.
  const M = require(path.join('..', 'scripts', 'materialize_july_revenue'));
  try {
    const run = await M.latestRun();
    if (!run) return { ok: false, note: 'Không có MISA snapshot success' };
    const srcRows = [...await M.fetchMisa(run.id), ...await M.fetchPartner()];
    const src = aggByEmpUnit(srcRows);
    const rep = aggByEmpUnit(store.getRows({ ky, scope: {} }));

    const THRESH = Number(process.env.RECONCILE_REVENUE_THRESHOLD || 1000); // đ
    const missingInReport = [], revenueDelta = [], extraInReport = [];
    for (const [k, s] of src) {
      const r = rep.get(k);
      if (!r) { missingInReport.push({ ...s, revenue: Math.round(s.revenue) }); continue; }
      if (Math.abs(s.revenue - r.revenue) > THRESH) {
        revenueDelta.push({ emp_code: s.emp_code, emp_name: s.emp_name, unit_code: s.unit_code, unit_name: s.unit_name, source: Math.round(s.revenue), report: Math.round(r.revenue), delta: Math.round(s.revenue - r.revenue) });
      }
    }
    for (const [k, r] of rep) if (!src.has(k)) extraInReport.push({ ...r, revenue: Math.round(r.revenue) });

    const sortByEmp = (a, b) => String(a.emp_code).localeCompare(String(b.emp_code)) || String(a.unit_code).localeCompare(String(b.unit_code));
    missingInReport.sort(sortByEmp); extraInReport.sort(sortByEmp);
    revenueDelta.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return {
      ok: (missingInReport.length + revenueDelta.length + extraInReport.length) === 0,
      misaRunId: String(run.id),
      totals: {
        source: { pairs: src.size, revenue: Math.round([...src.values()].reduce((s, x) => s + x.revenue, 0)) },
        report: { pairs: rep.size, revenue: Math.round([...rep.values()].reduce((s, x) => s + x.revenue, 0)) },
      },
      summary: { missingInReport: missingInReport.length, revenueDelta: revenueDelta.length, extraInReport: extraInReport.length },
      missingInReport, revenueDelta, extraInReport,
    };
  } finally {
    try { await M.pool.end(); } catch {}
  }
}

function printLayer1(r) {
  console.log(`\n=== ĐỐI SOÁT Report-New — kỳ ${r.ky} (so kỳ trước ${r.prevKy || '—'}) ===`);
  if (!r.hasSlot) { console.log('  ⚠ ' + r.note); return; }
  console.log(`  Trạng thái: ${r.ok ? '✅ SẠCH' : '⚠ CÓ ' + r.summary.issues + ' vấn đề'}`);
  if (r.dateOutOfBand.length) {
    console.log(`\n  ⛔ NGÀY NGOÀI BIÊN KỲ (${r.dateOutOfBand.length} đơn vị) — dấu hiệu lỗi múi giờ như 01/07→30/06:`);
    for (const u of r.dateOutOfBand) console.log(`     ${u.unit_code} ${u.unit_name} · ${u.rows} dòng · ${u.dates.join(',')} (${u.side}) · ${fmt(u.revenue)}đ · NV ${u.emps.join(',')}`);
  }
  if (r.metaMismatch.length) { console.log(`\n  ⚠ LỆCH METADATA:`); for (const m of r.metaMismatch) console.log(`     ${m.slot} ${m.field}: meta=${m.meta} thực tế=${m.actual}`); }
  if (r.duplicateLines.length) console.log(`\n  ⚠ TRÙNG source_line_id: ${r.duplicateLines.length} dòng`);
  if (r.unitDrop.length) {
    console.log(`\n  ⚠ ĐƠN VỊ BIẾN MẤT so kỳ trước (theo NV):`);
    for (const nv of r.unitDrop) console.log(`     ${nv.emp_code} ${nv.emp_name}: mất ${nv.units.length} đơn vị — ${nv.units.map((u) => u.unit_code).join(', ')}`);
  }
}

function printLayer2(s) {
  if (!s) { console.log('\n=== ĐỐI SOÁT NGUỒN Sale-New: BỎ QUA (không kết nối được DB) ==='); return; }
  if (s.ok === false && s.note) { console.log(`\n=== ĐỐI SOÁT NGUỒN Sale-New: ${s.note} ===`); return; }
  console.log(`\n=== ĐỐI SOÁT NGUỒN Sale-New (MISA run #${s.misaRunId}) ===`);
  console.log(`  Nguồn: ${s.totals.source.pairs} cặp(NV,ĐV) · ${fmt(s.totals.source.revenue)}đ | Report: ${s.totals.report.pairs} cặp · ${fmt(s.totals.report.revenue)}đ`);
  console.log(`  Trạng thái: ${s.ok ? '✅ KHỚP' : '⚠ LỆCH'}`);
  if (s.missingInReport.length) {
    console.log(`\n  ⛔ NGUỒN CÓ, REPORT-NEW THIẾU (${s.missingInReport.length}) — chính là ca DN009:`);
    for (const u of s.missingInReport) console.log(`     ${u.emp_code} ${u.emp_name} · ${u.unit_code} ${u.unit_name} · ${u.rows} dòng · ${fmt(u.revenue)}đ`);
  }
  if (s.revenueDelta.length) {
    console.log(`\n  ⚠ LỆCH DOANH THU (${s.revenueDelta.length}):`);
    for (const u of s.revenueDelta.slice(0, 50)) console.log(`     ${u.emp_code} · ${u.unit_code} ${u.unit_name}: nguồn ${fmt(u.source)} vs report ${fmt(u.report)} (Δ ${fmt(u.delta)})`);
  }
  if (s.extraInReport.length) {
    console.log(`\n  ⚠ REPORT-NEW CÓ, NGUỒN KHÔNG (${s.extraInReport.length}):`);
    for (const u of s.extraInReport.slice(0, 50)) console.log(`     ${u.emp_code} · ${u.unit_code} ${u.unit_name} · ${fmt(u.revenue)}đ`);
  }
}

async function main() {
  const ky = KY_ARG || store.latestKy();
  const layer1 = reconcile.reconcileKy(ky);

  let layer2 = null;
  try { layer2 = await sourceReconcile(ky); }
  catch (e) { layer2 = null; if (!asJson) console.log(`\n(Đối soát nguồn bỏ qua: ${String(e?.message || e).slice(0, 120)})`); }

  const out = { ky, checkedAt: new Date().toISOString(), report: layer1, source: layer2 };
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }

  printLayer1(layer1);
  printLayer2(layer2);

  const artDir = path.join(__dirname, '..', '..', 'artifacts');
  try {
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(artDir, `reconcile_${ky.replace('.', '')}.json`), JSON.stringify(out, null, 2) + '\n');
    console.log(`\nĐã ghi artifacts/reconcile_${ky.replace('.', '')}.json`);
  } catch {}

  const clean = layer1.ok && (!layer2 || layer2.ok !== false);
  process.exitCode = clean ? 0 : 2;
}
main().catch((e) => { console.error(e); process.exit(1); });
