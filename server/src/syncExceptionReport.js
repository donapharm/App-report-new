'use strict';
/**
 * BÁO CÁO "CHƯA ĐỒNG BỘ" — gom dòng bị loại + KIỂM BẤT BIẾN
 * (SPEC_REVENUE_SYNC_EXCEPTIONS.md §1.1)
 *
 *   Σ(đưa vào) + Σ(loại)            ==  Σ(toàn bộ nguồn)
 *   số dòng đưa vào + số dòng loại  ==  số dòng nguồn
 *
 * Không khớp ⇒ **DỪNG, không hiển thị số**, báo rõ lệch bao nhiêu. Nghĩa là có
 * dòng rơi ở chỗ không ai khai báo — đúng hai vụ 382,6 triệu và 2,4 triệu.
 */

const catalog = require('./syncExceptionCatalog');

function moneyOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function buildSyncExceptionReport({ period, source = {}, included = {}, exceptions = [] } = {}) {
  const rows = (Array.isArray(exceptions) ? exceptions : []).map((raw) => {
    const info = catalog.describe(raw?.code);
    return {
      code: info.code,
      known: info.known,
      group: info.group,
      meaning: info.meaning,
      owner: info.owner,
      action: info.action,
      sourceSystem: String(raw?.source || info.source || '*'),
      orderCode: String(raw?.orderCode || raw?.source_order || ''),
      lineId: String(raw?.lineId || raw?.source_line_id || ''),
      productCode: String(raw?.productCode || raw?.iit_code || ''),
      unitCode: String(raw?.unitCode || raw?.unit_code || ''),
      empCode: String(raw?.empCode || raw?.emp_code || ''),
      date: String(raw?.date || ''),
      amount: moneyOrNull(raw?.amount ?? raw?.revenue) ?? 0,
    };
  });

  const excludedRows = rows.filter((row) => row.group === catalog.EXCLUDED);
  const sum = (list) => list.reduce((acc, row) => acc + row.amount, 0);

  const sourceAmount = moneyOrNull(source.amount);
  const sourceRows = Number.isFinite(Number(source.rows)) ? Number(source.rows) : null;
  const includedAmount = moneyOrNull(included.amount);
  const includedRows = Number.isFinite(Number(included.rows)) ? Number(included.rows) : null;
  const excludedAmount = sum(excludedRows);

  // Thiếu số nguồn thì KHÔNG kết luận "cân" — chưa đủ căn cứ, khác hẳn "đã cân".
  const measurable = sourceAmount != null && includedAmount != null && sourceRows != null && includedRows != null;
  const amountDiff = measurable ? sourceAmount - (includedAmount + excludedAmount) : null;
  const rowDiff = measurable ? sourceRows - (includedRows + excludedRows.length) : null;
  const balanced = measurable ? amountDiff === 0 && rowDiff === 0 : null;

  const byCode = new Map();
  for (const row of rows) {
    const entry = byCode.get(row.code) || { code: row.code, group: row.group, meaning: row.meaning, owner: row.owner, action: row.action, rows: 0, amount: 0 };
    entry.rows += 1;
    entry.amount += row.amount;
    byCode.set(row.code, entry);
  }

  return {
    period: String(period || ''),
    balanced,
    measurable,
    // Có mã lạ nghĩa là bên phân loại dùng lý do chưa khai báo — phải hiện ra.
    unknownCodes: [...new Set(rows.filter((row) => !row.known).map((row) => row.code))],
    totals: {
      sourceAmount, sourceRows, includedAmount, includedRows,
      excludedAmount, excludedRows: excludedRows.length,
      incompleteRows: rows.filter((row) => row.group === catalog.INCOMPLETE).length,
      incompleteAmount: sum(rows.filter((row) => row.group === catalog.INCOMPLETE)),
      noteRows: rows.filter((row) => row.group === catalog.NOTE).length,
      amountDiff, rowDiff,
    },
    byCode: [...byCode.values()].sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code)),
    rows: rows.sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code)),
  };
}

module.exports = { buildSyncExceptionReport };
