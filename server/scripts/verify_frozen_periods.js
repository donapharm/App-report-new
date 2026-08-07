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

const fs = require('fs');
const path = require('path');
const {
  CURRENT_FROZEN_PERIOD_BASELINE_ID,
  CURRENT_FROZEN_PERIOD_PINS,
} = require('../src/revenueMaterializeGuard');
const { frozenPeriodFingerprints } = require('../src/revenueTransitionSafety');

const money = (value) => Number(value || 0).toLocaleString('vi-VN');

/** Gom tất cả kỳ bị ghim từ mọi bản chuyển đổi đã duyệt. Cùng kỳ khai nhiều nơi
 *  mà số khác nhau ⇒ chính bản ghim đã mâu thuẫn, phải báo ngay. */
function collectPins(source = CURRENT_FROZEN_PERIOD_PINS) {
  const pins = new Map();
  const conflicts = [];
  const directPins = Object.values(source || {}).every((pin) => pin && pin.frozenPeriods === undefined);
  const transitions = directPins
    ? { [CURRENT_FROZEN_PERIOD_BASELINE_ID]: { id: CURRENT_FROZEN_PERIOD_BASELINE_ID, frozenPeriods: source } }
    : source;
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
function exactPinMap(pins) {
  return Object.fromEntries((pins || []).map(({ ky, from, ...pin }) => [ky, pin]));
}

function verifyExactPins(pins, {
  slotsPath = path.join(__dirname, '..', 'data', 'upload_slots.json'),
  uploadsDir = path.join(__dirname, '..', 'data', 'uploads'),
} = {}) {
  try {
    const slots = JSON.parse(fs.readFileSync(slotsPath, 'utf8'));
    return { ok: true, fingerprints: frozenPeriodFingerprints(slots, exactPinMap(pins), uploadsDir), error: null };
  } catch (error) {
    return { ok: false, fingerprints: null, error: String(error?.message || error) };
  }
}

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

// Đọc số SỐNG của một kỳ.
// ‼ SỬA 04/08 19:45 — bản đầu gọi `store.revenueRows`, HÀM NÀY KHÔNG TỒN TẠI. Hàm
// đúng là `store.getRows({ ky })` (đồng bộ, `ky` dạng 'MM.YYYY'). Bản đầu vì thế
// luôn trả `unknown` ⇒ script vô dụng. Nó KHÔNG báo nhầm là "khớp" chỉ nhờ luật
// fail-closed; nhưng vô dụng vẫn là vô dụng, và suýt được dùng làm cổng gác thật.
//
// Không đọc được thì trả `null` — KHÔNG trả 0, vì 0 sẽ so ra "lệch −30 tỷ" làm
// người đọc hoảng nhầm, còn tệ hơn là nói thẳng "chưa đọc được".
function readActuals(kys, store = require('../src/store')) {
  if (typeof store.getRows !== 'function') {
    // Đổi tên hàm ở store mà quên sửa đây ⇒ phải NỔ, không được âm thầm unknown.
    throw new Error('store.getRows không còn tồn tại — sửa verify_frozen_periods.js trước khi dùng làm cổng gác');
  }
  const out = {};
  for (const ky of kys) {
    try {
      const rows = store.getRows({ ky });
      out[ky] = Array.isArray(rows) ? {
        totalRows: rows.length,
        totalRevenue: Math.round(rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0)),
      } : null;
    } catch (error) {
      console.warn(`[frozen] không đọc được kỳ ${ky}: ${error.message}`);
      out[ky] = null;
    }
  }
  return out;
}

/**
 * ‼ Đang chạy trên DỮ LIỆU MẪU hay dữ liệu THẬT?
 *
 * Kỳ đã khoá sổ được ghim theo số PRODUCTION. Chạy script này trên máy dev (dữ liệu
 * seed) thì kỳ nào cũng "lệch mấy chục tỷ" — báo đỏ giả. Vài lần như vậy là người ta
 * quen mắt rồi bỏ qua, tới lúc lệch THẬT cũng không ai buồn nhìn.
 * Nhận biết: mọi dòng của kỳ được ghim đều là dòng seed ⇒ đang đọc dữ liệu mẫu.
 */
function onSampleData(kys, store = require('../src/store')) {
  try {
    const sample = new Set(store.base().sampleRows || []);
    if (!sample.size) return false;
    // Mọi dòng của kỳ được ghim đều là dòng MẪU ⇒ chưa có dữ liệu upload thật.
    // So bằng THAM CHIẾU đối tượng nên không nhầm với dữ liệu thật trùng số.
    return kys.every((ky) => {
      const rows = store.getRows({ ky });
      return Array.isArray(rows) && rows.every((row) => sample.has(row));
    });
  } catch { return false; }
}

function main() {
  const asJson = process.argv.includes('--json');
  const { pins: pinsForCheck } = collectPins();
  if (onSampleData(pinsForCheck.map((pin) => pin.ky)) && !process.argv.includes('--force')) {
    console.error('⏭  Đang chạy trên DỮ LIỆU MẪU (mọi dòng của kỳ ghim đều là dòng seed) — KHÔNG kết luận.');
    console.error('   Chỉ chạy trên máy chủ thật. Muốn ép chạy để thử: thêm --force.');
    process.exit(2);
  }
  const { pins, conflicts } = collectPins();
  if (!pins.length) { console.error('Không có kỳ nào được ghim — kiểm lại revenueMaterializeGuard.'); process.exit(2); }

  const exact = verifyExactPins(pins);
  if (!exact.ok) {
    if (asJson) console.log(JSON.stringify({ conflicts, results: [], exact }, null, 2));
    else console.error(`⛔ Không xác minh được exact frozen pin: ${exact.error}`);
    const isDrift = /(?:PIN_MISMATCH|METADATA_MISMATCH|ACTIVE_SLOT_INVALID)/.test(exact.error);
    process.exit(isDrift ? 1 : 2);
  }
  const results = comparePins(pins, exact.fingerprints);
  if (asJson) { console.log(JSON.stringify({ baselineId: CURRENT_FROZEN_PERIOD_BASELINE_ID, conflicts, results, exact }, null, 2)); }
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

module.exports = { collectPins, exactPinMap, verifyExactPins, comparePins, readActuals, onSampleData };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(2); }
}
