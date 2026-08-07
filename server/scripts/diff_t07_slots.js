#!/usr/bin/env node
/**
 * ĐIỀU TRA 75 DÒNG / 64 TRIỆU chênh giữa hai bản chụp T07 (CEO yêu cầu 07/08/2026)
 *
 * Bối cảnh: bot dựng lại T07 từ lần đồng bộ #301 (2.091 dòng · 30.982.248.913đ),
 * khác bản đã khoá sổ #299 (2.016 dòng · 30.917.892.673đ). CEO muốn biết 75 dòng
 * tăng thêm là ĐƠN GÌ trước khi quyết giữ số nào.
 *
 * CHỈ ĐỌC hai file slot JSON, so theo source_line_id. Không DB, không sửa gì.
 *
 *   node scripts/diff_t07_slots.js --old <file_slot_cu.json> --new <file_slot_moi.json>
 *   node scripts/diff_t07_slots.js --old <file_cu>            # --new tự lấy slot T07 active
 *   node scripts/diff_t07_slots.js --json                     # in JSON cho báo cáo
 *
 * Tự tìm slot T07 active nếu thiếu --new; tìm bản cũ trong data/backups nếu thiếu --old.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const BK_DIR = path.join(DATA_DIR, 'backups');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};
const asJson = process.argv.includes('--json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const vn = (n) => Number(n || 0).toLocaleString('vi-VN');
const round = (v) => Math.round(Number(v) || 0);
const lineId = (r) => String(r.source_line_id || r.sourceLineId || '');
const rev = (r) => round(r.revenue);

function activeT07SlotFile() {
  const slots = readJson(path.join(DATA_DIR, 'upload_slots.json')).filter((s) => s.active && s.ky === '07.2026');
  if (slots.length !== 1) throw new Error(`Cần đúng 1 slot T07 active, thấy ${slots.length}. Truyền --new tường minh.`);
  return path.join(UP_DIR, `${slots[0].id}.json`);
}

// Tìm bản chụp T07 CŨ nhất còn giữ trong backups (khác slot đang active).
function findOldBackup(activeFile) {
  if (!fs.existsSync(BK_DIR)) return null;
  const activeRows = readJson(activeFile).length;
  const found = [];
  for (const dir of fs.readdirSync(BK_DIR)) {
    const slotsPath = path.join(BK_DIR, dir, 'upload_slots.json');
    if (!fs.existsSync(slotsPath)) continue;
    let slots; try { slots = readJson(slotsPath); } catch { continue; }
    for (const s of slots.filter((x) => x.active && x.ky === '07.2026')) {
      const f = path.join(BK_DIR, dir, 'uploads', `${s.id}.json`);
      if (fs.existsSync(f)) found.push({ dir, id: s.id, file: f, rows: readJson(f).length });
    }
  }
  // Bản cũ = bản có SỐ DÒNG KHÁC bản active (ứng viên là 2.016 dòng).
  const diff = found.filter((x) => x.rows !== activeRows);
  return diff.sort((a, b) => a.rows - b.rows)[0] || null;
}

function main() {
  const newFile = arg('new') || activeT07SlotFile();
  let oldFile = arg('old');
  let oldMeta = oldFile ? { file: oldFile } : findOldBackup(newFile);
  if (!oldMeta) throw new Error('Không tìm được bản chụp T07 cũ để so. Truyền --old <đường dẫn file slot cũ>.');
  oldFile = oldMeta.file;

  const oldRows = readJson(oldFile);
  const newRows = readJson(newFile);
  const oldById = new Map(oldRows.map((r) => [lineId(r), r]));
  const newById = new Map(newRows.map((r) => [lineId(r), r]));

  const added = newRows.filter((r) => !oldById.has(lineId(r)));   // có ở mới, không ở cũ
  const removed = oldRows.filter((r) => !newById.has(lineId(r))); // có ở cũ, mất ở mới
  const changed = newRows.filter((r) => oldById.has(lineId(r)) && rev(oldById.get(lineId(r))) !== rev(r));

  const sum = (rows) => rows.reduce((a, r) => a + rev(r), 0);
  const oldTotal = sum(oldRows); const newTotal = sum(newRows);

  const brief = (r) => ({
    line: lineId(r), date: r.date || '', revenue_date: r.revenue_date || r.revenueDate || '',
    order: r.source_order || r.orderCode || '', unit: r.unit_code || '', iit: r.iit_code || '',
    emp: r.emp_code || '', raw_emp: r.raw_emp_code || '', revenue: rev(r), source: r.source || '',
  });

  if (asJson) {
    console.log(JSON.stringify({
      oldFile, newFile,
      oldTotal, newTotal, diff: newTotal - oldTotal,
      oldRows: oldRows.length, newRows: newRows.length,
      added: added.map(brief), removed: removed.map(brief),
      changed: changed.map((r) => ({ ...brief(r), oldRevenue: rev(oldById.get(lineId(r))) })),
    }, null, 2));
    return;
  }

  console.log(`So hai bản chụp T07:`);
  console.log(`  CŨ: ${oldFile}\n      ${vn(oldRows.length)} dòng · ${vn(oldTotal)}đ`);
  console.log(`  MỚI: ${newFile}\n      ${vn(newRows.length)} dòng · ${vn(newTotal)}đ`);
  console.log(`  CHÊNH: ${newTotal - oldTotal >= 0 ? '+' : ''}${vn(newTotal - oldTotal)}đ · ${added.length - removed.length >= 0 ? '+' : ''}${added.length - removed.length} dòng ròng`);
  console.log(`\nDÒNG TĂNG THÊM (có ở mới, không có ở cũ): ${added.length} dòng · +${vn(sum(added))}đ`);
  const head = ['ngày', 'ngày_DT', 'mã đơn', 'đơn vị', 'mã hàng', 'NV', 'raw', 'nguồn', 'doanh thu'];
  const show = (rows) => {
    for (const r of rows.sort((a, b) => rev(b) - rev(a))) {
      const b = brief(r);
      console.log(`  ${b.date.padEnd(10)} ${String(b.revenue_date).padEnd(10)} ${String(b.order).padEnd(14)} ${String(b.unit).padEnd(22)} ${String(b.iit).padEnd(26)} ${String(b.emp).padEnd(12)} ${String(b.raw_emp).padEnd(8)} ${String(b.source).padEnd(10)} ${vn(b.revenue)}đ`);
    }
  };
  console.log(`  [${head.join(' · ')}]`);
  show(added);
  if (removed.length) { console.log(`\nDÒNG MẤT ĐI (có ở cũ, không có ở mới): ${removed.length} dòng · -${vn(sum(removed))}đ`); show(removed); }
  if (changed.length) { console.log(`\nDÒNG ĐỔI SỐ TIỀN: ${changed.length} dòng`); for (const r of changed) console.log(`  ${lineId(r)}: ${vn(rev(oldById.get(lineId(r))))}đ → ${vn(rev(r))}đ`); }

  // Gợi ý đọc: phân nhóm dòng tăng theo THÁNG của ngày doanh thu — để thấy có phải
  // đơn giao trong T07 nhưng đồng bộ muộn (đúng SPEC_REVENUE_DELIVERY_PERIOD) hay không.
  const byMonth = {};
  for (const r of added) {
    const d = String(r.revenue_date || r.date || '').slice(0, 7) || 'không rõ';
    byMonth[d] = byMonth[d] || { rows: 0, amount: 0 };
    byMonth[d].rows += 1; byMonth[d].amount += rev(r);
  }
  console.log(`\nDòng tăng thêm phân theo tháng của ngày doanh thu:`);
  for (const [m, v] of Object.entries(byMonth).sort()) console.log(`  ${m}: ${vn(v.rows)} dòng · ${vn(v.amount)}đ`);

  // Giả thuyết cần kiểm (Claude Sale nêu 07/08): 75 dòng này là do ĐỔI CÁCH QUY KỲ
  // — đơn CUỐI tháng 7, ghi doanh số sang đầu tháng 8, lần đồng bộ sau mới lấy về.
  // Nếu đúng thì chúng phải DỒN vào mấy ngày cuối tháng; nếu rải đều cả tháng thì
  // là chuyện khác (đơn về muộn lẻ tẻ, hoặc dòng lạ) — phải xem, không được đoán.
  const byDay = {};
  for (const r of added) {
    const d = String(r.date || r.revenue_date || '').slice(0, 10) || 'không rõ';
    byDay[d] = byDay[d] || { rows: 0, amount: 0 };
    byDay[d].rows += 1; byDay[d].amount += rev(r);
  }
  const days = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  console.log(`\nDòng tăng thêm phân theo NGÀY (kiểm giả thuyết "đơn cuối tháng ghi doanh số sang T08"):`);
  for (const [d, v] of days) console.log(`  ${d}: ${vn(v.rows)} dòng · ${vn(v.amount)}đ`);
  const lateJuly = days.filter(([d]) => /^2026-07-(2[7-9]|3[01])$/.test(d));
  const lateRows = lateJuly.reduce((a, [, v]) => a + v.rows, 0);
  const lateAmount = lateJuly.reduce((a, [, v]) => a + v.amount, 0);
  const pct = added.length ? Math.round(lateRows / added.length * 100) : 0;
  console.log(`  → 27–31/07: ${vn(lateRows)}/${vn(added.length)} dòng (${pct}%) · ${vn(lateAmount)}đ`);
  console.log(pct >= 70
    ? '  → DỒN cuối tháng: khớp giả thuyết đổi cách quy kỳ, KHÔNG phải dòng lạ.'
    : '  → KHÔNG dồn cuối tháng: phải soi từng dòng, đừng vội kết luận là đơn về muộn.');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`⛔ ${e.message}`); process.exit(1); }
}
module.exports = { main };
