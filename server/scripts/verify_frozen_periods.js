#!/usr/bin/env node
'use strict';
/**
 * CANH KỲ ĐÃ KHOÁ SỔ — chạy được bất cứ lúc nào, KHÔNG cần materialize.
 *
 * Vì sao có file này (04/08/2026): bot DataHub báo **outbox còn 2.600 event đang chờ
 * replay**. Replay là ghi lại lịch sử. Nếu trong đống đó có event chạm vào **kỳ đã
 * khoá sổ**, tổng doanh thu T06/T07 sẽ đổi mà **không ai biết** — vì bộ canh sẵn có
 * (`revenueMaterializeGuard`) chỉ chạy lúc dựng lại dữ liệu, không canh thường trực.
 *
 * Số ghim lấy TỪ CHÍNH `revenueMaterializeGuard`, không chép tay — chép tay là có
 * ngày hai nơi lệch nhau rồi cãi nhau không biết bên nào đúng.
 *
 *   node scripts/verify_frozen_periods.js            # đọc số sống qua store
 *   node scripts/verify_frozen_periods.js --json     # in JSON cho script khác dùng
 *
 * Mã thoát: 0 = khớp · 1 = LỆCH (phải dừng, đi tìm nguyên nhân) · 2 = không đọc được số.
 */

const { APPROVED_RULE_TRANSITIONS } = require('../src/revenueMaterializeGuard');

const money = (value) => Number(value || 0).toLocaleString('vi-VN');

/** Gom tất cả kỳ bị ghim từ mọi bản chuyển đổi đã duyệt. Cùng kỳ khai nhiều nơi
 *  mà số khác nhau ⇒ chính bản ghim đã mâu thuẫn, phải báo ngay. */
function collectPins(transitions = APPROVED_RULE_TRANSITIONS) {
  const pins = new Map();
  const conflicts = [];
  for (const transition of Object.values(transitions || {})) {
    for (const [ky, pin] of Object.entries(transition?.frozenPeriods || {})) {
      const seen = pins.get(ky);
      if (!seen) { pins.set(ky, { ky, ...pin, from: [transition.id] }); continue; }
      if (seen.totalRevenue !== pin.totalRevenue || seen.totalRows !== pin.totalRows) {
        conflicts.push({ ky, a: seen.from[0], b: transition.id });
      }
      seen.from.push(transition.id);
    }
  }
  return { pins: [...pins.values()].sort((a, b) => a.ky.localeCompare(b.ky)), conflicts };
}

/** So số ghim với số sống. `actualOf(ky)` trả `{ totalRows, totalRevenue }` hoặc null. */
function comparePins(pins, actualByKy) {
  return pins.map((pin) => {
    const actual = actualByKy[pin.ky];
    if (!actual || actual.totalRevenue == null) {
      // ‼ Không đọc được KHÁC với khớp. Không được im lặng cho qua.
      return { ...pin, status: 'unknown', actualRows: null, actualRevenue: null, revenueDiff: null, rowDiff: null };
    }
    const revenueDiff = Number(actual.totalRevenue) - pin.totalRevenue;
    const rowDiff = Number(actual.totalRows ?? pin.totalRows) - pin.totalRows;
    return {
      ...pin,
      status: revenueDiff === 0 && rowDiff === 0 ? 'ok' : 'drifted',
      actualRows: Number(actual.totalRows ?? 0), actualRevenue: Number(actual.totalRevenue),
      revenueDiff, rowDiff,
    };
  });
}

// Đọc số SỐNG của một kỳ. Không đọc được thì trả `null` — KHÔNG trả 0, vì 0 sẽ bị
// so ra "lệch -30 tỷ" và làm người đọc hoảng nhầm, còn tệ hơn là nói thẳng "chưa đọc được".
async function readActuals(kys) {
  const store = require('../src/store');
  const out = {};
  for (const ky of kys) {
    try {
      const rows = typeof store.revenueRows === 'function' ? await store.revenueRows({ ky }) : null;
      out[ky] = Array.isArray(rows) ? {
        totalRows: rows.length,
        totalRevenue: Math.round(rows.reduce((sum, row) => sum + Number(row.revenue ?? row.amount ?? 0), 0)),
      } : null;
    } catch (error) {
      console.warn(`[frozen] không đọc được kỳ ${ky}: ${error.message}`);
      out[ky] = null;
    }
  }
  return out;
}

async function main() {
  const asJson = process.argv.includes('--json');
  const { pins, conflicts } = collectPins();
  if (!pins.length) { console.error('Không có kỳ nào được ghim — kiểm lại revenueMaterializeGuard.'); process.exit(2); }

  const actuals = await readActuals(pins.map((pin) => pin.ky));
  const results = comparePins(pins, actuals);
  if (asJson) { console.log(JSON.stringify({ conflicts, results }, null, 2)); }
  else {
    console.log('KIỂM KỲ ĐÃ KHOÁ SỔ (số ghim lấy từ revenueMaterializeGuard)\n');
    for (const row of results) {
      const icon = row.status === 'ok' ? '✅' : row.status === 'drifted' ? '⛔' : '❓';
      console.log(`${icon} ${row.ky}  ghim ${money(row.totalRevenue)}đ / ${row.totalRows} dòng`);
      if (row.status === 'drifted') {
        console.log(`     THỰC TẾ ${money(row.actualRevenue)}đ / ${row.actualRows} dòng`);
        console.log(`     LỆCH ${money(row.revenueDiff)}đ · ${row.rowDiff} dòng  ⇒ DỪNG, kỳ đã khoá sổ KHÔNG được đổi`);
      }
      if (row.status === 'unknown') console.log('     chưa đọc được số sống — CHƯA kết luận là khớp');
    }
    for (const item of conflicts) console.log(`⛔ bản ghim mâu thuẫn ở kỳ ${item.ky}: ${item.a} vs ${item.b}`);
  }
  if (conflicts.length || results.some((row) => row.status === 'drifted')) process.exit(1);
  if (results.some((row) => row.status === 'unknown')) process.exit(2);
  process.exit(0);
}

module.exports = { collectPins, comparePins };
if (require.main === module) main().catch((error) => { console.error(error); process.exit(2); });
