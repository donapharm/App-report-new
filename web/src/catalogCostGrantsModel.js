// LÕI LOGIC MENU PHÂN QUYỀN CỘT % (SPEC_CATALOG_COST_COLUMNS.md · CEO chốt 06/08/2026)
// Tách khỏi JSX để test được bằng node:test và để màn hình chỉ còn việc vẽ.
//
// ‼ Đây CHỈ là tầng trình bày. Quyền thật do backend quyết (`auth.requireCeo` +
// `catalogCostColumnGrants`). Sửa gì ở đây cũng không nới được quyền — đúng nguyên
// tắc số 1 của repo: frontend không tự lọc quyền.

export const ALL_UNITS = '*';

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const lower = (value) => text(value).toLowerCase();

// Cùng luật whitelist với server (`catalogCostColumnGrants.isAllowedColumn`) và với
// `isAllowedCostColumn` của bảng chi phí: C33–C46.
export function isGrantableColumn(key) {
  const match = /^c(\d+)$/.exec(lower(key?.key ?? key));
  if (!match) return false;
  const pos = Number(match[1]);
  return pos >= 33 && pos <= 46;
}

export function grantableColumns(columns = []) {
  const out = [];
  for (const raw of Array.isArray(columns) ? columns : []) {
    const key = lower(raw?.key ?? raw);
    if (!isGrantableColumn(key) || out.some((item) => item.key === key)) continue;
    // `viewOnly`: cột chỉ-để-xem (C38/C42) — cấp quyền xem như cột khác, nhưng KHÔNG
    // nằm trong công thức tính tiền. Giữ cờ để menu nói rõ cho CEO khỏi hiểu nhầm.
    out.push({ key, label: text(raw?.label) || key.toUpperCase(), annual: !!raw?.annual, viewOnly: !!raw?.viewOnly });
  }
  return out;
}

/** Đơn vị mỗi NV đang phụ trách — suy từ chính bảng phân công đang hiển thị.
 *  CEO không thể cấp đơn vị nằm ngoài danh sách này: phạm vi chỉ THU HẸP. */
export function unitsByEmployee(catalogRows = []) {
  const map = new Map();
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) {
    const emp = upper(row?.emp_code);
    const unit = upper(row?.unit_code);
    if (!emp || !unit) continue;
    const set = map.get(emp) || new Set();
    set.add(unit);
    map.set(emp, set);
  }
  return new Map([...map].map(([emp, set]) => [emp, [...set].sort()]));
}

/** Dựng bảng cho menu: mỗi NV một dòng, kèm quyền hiện tại và đơn vị họ phụ trách. */
export function buildGrantPanel({ grants = [], columns = [], catalogRows = [], employees = [] } = {}) {
  const cols = grantableColumns(columns);
  const units = unitsByEmployee(catalogRows);
  const byEmp = new Map((Array.isArray(grants) ? grants : []).map((item) => [upper(item?.empCode), item]));
  const codes = [...new Set([
    ...employees.map((item) => upper(item?.code ?? item)),
    ...units.keys(),
    ...byEmp.keys(),
  ])].filter((code) => /^(DN|VP)\d{3}$/.test(code)).sort();
  const nameOf = new Map(employees.map((item) => [upper(item?.code ?? item), text(item?.name)]));
  return {
    columns: cols,
    rows: codes.map((code) => {
      const grant = byEmp.get(code) || null;
      const granted = grantableColumns(grant?.columns || []).map((item) => item.key);
      const scope = Array.isArray(grant?.units) ? grant.units.map(upper) : [];
      return {
        empCode: code,
        name: nameOf.get(code) || '',
        availableUnits: units.get(code) || [],
        columns: granted,
        units: scope.includes(ALL_UNITS) ? [ALL_UNITS] : scope,
        updatedAt: grant?.updatedAt || null,
        updatedBy: grant?.updatedBy || null,
        dirty: false,
      };
    }),
  };
}

const replaceRow = (panel, empCode, patch) => ({
  ...panel,
  rows: panel.rows.map((row) => (row.empCode === upper(empCode) ? { ...row, ...patch, dirty: true } : row)),
});

export function toggleColumn(panel, empCode, columnKey) {
  const key = lower(columnKey);
  if (!isGrantableColumn(key)) return panel;
  const row = panel.rows.find((item) => item.empCode === upper(empCode));
  if (!row) return panel;
  const columns = row.columns.includes(key)
    ? row.columns.filter((item) => item !== key)
    : [...row.columns, key].sort();
  // Bỏ hết cột ⇒ dọn luôn phạm vi, không để quyền treo lơ lửng (khớp luật backend).
  return replaceRow(panel, empCode, { columns, units: columns.length ? row.units : [] });
}

export function setUnits(panel, empCode, units) {
  const row = panel.rows.find((item) => item.empCode === upper(empCode));
  if (!row) return panel;
  const list = Array.isArray(units) ? units.map(upper) : [];
  if (list.includes(ALL_UNITS)) return replaceRow(panel, empCode, { units: [ALL_UNITS] });
  // Chỉ giữ đơn vị NV thực sự phụ trách — chặn ngay trên giao diện cho CEO thấy rõ,
  // backend vẫn chặn độc lập.
  const allowed = list.filter((unit) => row.availableUnits.includes(unit));
  return replaceRow(panel, empCode, { units: [...new Set(allowed)].sort() });
}

/** Thao tác hàng loạt: áp đúng bộ cột này cho danh sách NV, phạm vi để mặc định "*". */
export function applyColumnsToMany(panel, empCodes, columnKeys) {
  const codes = new Set((Array.isArray(empCodes) ? empCodes : []).map(upper));
  const columns = [...new Set((Array.isArray(columnKeys) ? columnKeys : []).map(lower).filter(isGrantableColumn))].sort();
  return {
    ...panel,
    rows: panel.rows.map((row) => (codes.has(row.empCode)
      ? { ...row, columns, units: columns.length ? (row.units.length ? row.units : [ALL_UNITS]) : [], dirty: true }
      : row)),
  };
}

/** Payload gửi backend cho MỘT nhân viên. Không gửi gì thừa. */
export function grantSavePayload(row) {
  const columns = [...new Set((row?.columns || []).map(lower).filter(isGrantableColumn))].sort();
  return { columns, units: columns.length ? (row?.units?.length ? row.units.map(upper) : [ALL_UNITS]) : [] };
}

export const dirtyRows = (panel) => (panel?.rows || []).filter((row) => row.dirty);

/** Tra cứu % theo cặp (đơn vị × mã hàng) cho bảng danh mục.
 *  Trả về hàm tra; cặp không có trong kết quả backend nghĩa là KHÔNG ĐƯỢC XEM
 *  hoặc CHƯA CÓ % — cả hai đều ra `null` và màn hình hiện '—'. Không suy 0%. */
export function ratesLookup(pairs = []) {
  const index = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    index.set(`${upper(pair?.unitCode)}\u001f${upper(pair?.productCode)}`, pair?.rates || {});
  }
  return (unitCode, productCode, columnKey) => {
    const rates = index.get(`${upper(unitCode)}\u001f${upper(productCode)}`);
    if (!rates) return null;
    const value = rates[lower(columnKey)];
    return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  };
}

/** Câu mô tả quyền cho CEO đọc lướt — phải nói rõ "không thấy gì" chứ đừng để trống. */
export function grantSummary(row) {
  const columns = (row?.columns || []).map((key) => key.toUpperCase());
  if (!columns.length) return 'Không thấy cột % nào';
  const scope = !row.units.length || row.units.includes(ALL_UNITS)
    ? 'mọi đơn vị đang phụ trách'
    : `${row.units.length} đơn vị`;
  return `${columns.join(' · ')} — ${scope}`;
}
