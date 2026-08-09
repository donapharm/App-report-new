// LÕI LOGIC MENU PHÂN QUYỀN CỘT % — BẢN V2 THEO NHÓM ĐƠN VỊ
// (SPEC_CATALOG_COST_COLUMNS.md · CEO chốt 06/08, nâng chi tiết 08/08/2026)
// Tách khỏi JSX để test được bằng node:test và để màn hình chỉ còn việc vẽ.
//
// CEO 08/08: quyền là ma trận NV × CỘT × NHÓM ĐƠN VỊ — mỗi cột một phạm vi nhóm
// riêng; cấp theo nhóm là cấp CẢ nhóm (hai đơn vị cùng nhóm không bao giờ lệch).
// Bảng "mã đơn vị → nhóm" do BACKEND phân giải (endpoint unit-groups) — frontend
// không chép luật tách nhóm để khỏi lệch hai nơi.
//
// ‼ Đây CHỈ là tầng trình bày. Quyền thật do backend quyết (`auth.requireCeo` +
// `catalogCostColumnGrants`). Sửa gì ở đây cũng không nới được quyền.

export const ALL_UNITS = '*';

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const lower = (value) => text(value).toLowerCase();

// Cùng luật whitelist với server (`catalogCostColumnGrants.isAllowedColumn`): C33–C46.
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
    // CEO 08/08: *"bản chất các cột này chức năng đều giống nhau, phân quyền cột nào
    // thì sẽ thấy đúng mục của cột đó thôi"* — ĐÚNG với menu này. Nhãn "chỉ xem" trước
    // đây là rò rỉ một phân biệt NỘI BỘ (C38/C42 không nằm trong công thức tính tiền)
    // vào đúng chỗ nó không liên quan. Phân biệt đó vẫn được giữ ở tầng cấu hình +
    // test (`viewOnlyCostColumns`); menu phân quyền thì mọi cột như nhau.
    out.push({ key, label: text(raw?.label) || key.toUpperCase(), annual: !!raw?.annual });
  }
  return out;
}

/** Đơn vị mỗi NV đang phụ trách — suy từ chính bảng phân công đang hiển thị. */
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

/** Nhóm mỗi NV đang phụ trách, tính từ đơn vị của họ + bảng tra backend.
 *  Đơn vị không phân giải được nhóm gom vào `ungroupedUnits` — NÓI RA, không giấu:
 *  các đơn vị đó chỉ '*' mới phủ tới (fail-closed phía backend). */
export function groupsForUnits(units = [], groupsByUnit = {}) {
  const groups = new Map();
  const ungroupedUnits = [];
  // ‼ Backend trả bảng tra theo mã ĐƠN VỊ GỐC ('001.BVĐK Đồng Nai'), còn panel giữ
  // mã đã viết hoa ('001.BVĐK ĐỒNG NAI') ⇒ tra thẳng là trượt, báo nhầm 28 đơn vị
  // "chưa nhận diện được nhóm" trong khi chúng phân giải ra BV bình thường
  // (CEO chụp màn 08/08). Chuẩn hoá khoá một lần rồi mới tra.
  const index = new Map(Object.entries(groupsByUnit || {}).map(([key, value]) => [upper(key), value]));
  for (const unit of units) {
    const resolved = index.get(upper(unit)) || null;
    if (!resolved?.key) { ungroupedUnits.push(unit); continue; }
    const key = upper(resolved.key);
    // Giữ DANH SÁCH ĐƠN VỊ trong nhóm, không chỉ đếm: CEO cần nhìn thấy tick nhóm
    // 001 là mở đúng những mã nào (001.BVĐK Đồng Nai · Khu C · NT-BVĐK…).
    const current = groups.get(key) || { key, label: text(resolved.label) || key, units: [] };
    current.units.push(unit);
    groups.set(key, current);
  }
  return {
    groups: [...groups.values()]
      .map((group) => ({ ...group, units: group.units.sort(), unitCount: group.units.length }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    ungroupedUnits: ungroupedUnits.sort(),
  };
}

function normalizeScopes(columnsValue) {
  const scopes = {};
  if (!columnsValue || typeof columnsValue !== 'object') return scopes;
  // v1 cũ (mảng cột) hết đường vào đây: backend đã tự nâng khi đọc. Vẫn đỡ nhẹ
  // để panel không vỡ nếu gặp bản ghi chưa nâng.
  if (Array.isArray(columnsValue)) {
    for (const item of columnsValue) {
      const key = lower(item?.key ?? item);
      if (isGrantableColumn(key)) scopes[key] = [ALL_UNITS];
    }
    return scopes;
  }
  for (const [rawKey, rawScope] of Object.entries(columnsValue)) {
    const key = lower(rawKey);
    if (!isGrantableColumn(key)) continue;
    const list = Array.isArray(rawScope) ? rawScope : [];
    if (list.some((item) => text(item) === ALL_UNITS)) { scopes[key] = [ALL_UNITS]; continue; }
    const groups = [...new Set(list.map(upper).filter(Boolean))].sort();
    if (groups.length) scopes[key] = groups;
  }
  return scopes;
}

/** Dựng bảng cho menu: mỗi NV một dòng, kèm ma trận cột→nhóm hiện tại + nhóm họ phụ trách. */
export function buildGrantPanel({ grants = [], columns = [], catalogRows = [], employees = [], groupsByUnit = {} } = {}) {
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
      const availableUnits = units.get(code) || [];
      const { groups, ungroupedUnits } = groupsForUnits(availableUnits, groupsByUnit);
      return {
        empCode: code,
        name: nameOf.get(code) || '',
        availableUnits,
        availableGroups: groups,
        ungroupedUnits,
        columns: normalizeScopes(grant?.columns),
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

/** Tick/bỏ tick một cột. Tick mới ⇒ mặc định '*' (mọi nhóm đang phụ trách). */
export function toggleColumn(panel, empCode, columnKey) {
  const key = lower(columnKey);
  if (!isGrantableColumn(key)) return panel;
  const row = panel.rows.find((item) => item.empCode === upper(empCode));
  if (!row) return panel;
  const columns = { ...row.columns };
  if (columns[key]) delete columns[key];
  else columns[key] = [ALL_UNITS];
  return replaceRow(panel, empCode, { columns });
}

/** Đặt phạm vi NHÓM cho MỘT cột. Chỉ nhận nhóm NV thực sự phụ trách (chặn ngay
 *  trên giao diện cho CEO thấy rõ; backend vẫn fail-closed độc lập). Chọn rỗng ⇒
 *  cột tắt luôn — "cấp cột mà không nhóm nào" không tồn tại. */
export function setColumnGroups(panel, empCode, columnKey, groups) {
  const key = lower(columnKey);
  const row = panel.rows.find((item) => item.empCode === upper(empCode));
  if (!row || !isGrantableColumn(key)) return panel;
  const list = Array.isArray(groups) ? groups.map(upper) : [];
  const columns = { ...row.columns };
  if (list.includes(ALL_UNITS)) columns[key] = [ALL_UNITS];
  else {
    const allowed = new Set(row.availableGroups.map((group) => group.key));
    const kept = [...new Set(list.filter((item) => allowed.has(item)))].sort();
    if (kept.length) columns[key] = kept;
    else delete columns[key];
  }
  return replaceRow(panel, empCode, { columns });
}

/** Thao tác hàng loạt: áp đúng bộ cột này cho danh sách NV, phạm vi mặc định '*'. */
export function applyColumnsToMany(panel, empCodes, columnKeys) {
  const codes = new Set((Array.isArray(empCodes) ? empCodes : []).map(upper));
  const keys = [...new Set((Array.isArray(columnKeys) ? columnKeys : []).map(lower).filter(isGrantableColumn))].sort();
  return {
    ...panel,
    rows: panel.rows.map((row) => (codes.has(row.empCode)
      ? { ...row, columns: Object.fromEntries(keys.map((key) => [key, [ALL_UNITS]])), dirty: true }
      : row)),
  };
}

/** Payload gửi backend cho MỘT nhân viên — đúng ma trận cột→nhóm, không gửi gì thừa. */
export function grantSavePayload(row) {
  return { columns: normalizeScopes(row?.columns) };
}

export const dirtyRows = (panel) => (panel?.rows || []).filter((row) => row.dirty);

/** Tra cứu % theo cặp (đơn vị × mã hàng) cho bảng danh mục.
 *  Cặp/ô không có trong kết quả backend nghĩa là KHÔNG ĐƯỢC XEM hoặc CHƯA CÓ % —
 *  cả hai đều ra `null` và màn hình hiện '—'. Không suy 0%. */
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

/** Nhãn phạm vi một cột cho CEO đọc lướt. */
export function columnScopeLabel(row, columnKey) {
  const scope = row?.columns?.[lower(columnKey)];
  if (!Array.isArray(scope) || !scope.length) return '';
  if (scope.includes(ALL_UNITS)) return 'mọi nhóm';
  return `${scope.length} nhóm`;
}

/** Câu mô tả quyền cho CEO đọc lướt — nói rõ từng cột thấy ở nhóm nào. */
export function grantSummary(row) {
  const entries = Object.entries(row?.columns || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return 'Không thấy cột % nào';
  const labelOf = new Map((row?.availableGroups || []).map((group) => [group.key, group.label]));
  return entries.map(([key, scope]) => {
    const scopeText = scope.includes(ALL_UNITS)
      ? 'mọi nhóm'
      : scope.map((item) => labelOf.get(item) || item).join(', ');
    return `${key.toUpperCase()}: ${scopeText}`;
  }).join(' · ');
}

/* ── MÀN CHI TIẾT MỘT NHÂN VIÊN (CEO yêu cầu 09/08/2026) ──────────────────────
 * CEO: *"chọn theo nhân viên rồi có màn hình phụ cho liệt kê các đơn vị, các cột
 * để tích theo cột, theo nhóm mã đơn vị… thì sẽ rõ và làm nhanh hơn."*
 *
 * Màn chi tiết là một LƯỚI: hàng = nhóm mã đơn vị (001, 033…), cột = C36…C45.
 * Tick ở cấp NHÓM (CEO chốt phương án A), mỗi hàng liệt kê các mã bên trong.
 * Không đổi cách lưu: vẫn đúng ma trận `{ c41: ['*'], c43: ['033'] }` như cũ.
 */

/** Ô (cột × nhóm) này đang được cấp chưa. '*' nghĩa là mọi nhóm ⇒ ô nào cũng bật. */
export function isGroupChecked(row, columnKey, groupKey) {
  const scope = row?.columns?.[lower(columnKey)];
  if (!Array.isArray(scope) || !scope.length) return false;
  return scope.includes(ALL_UNITS) || scope.includes(upper(groupKey));
}

/** Cột này có đang cấp cho MỌI nhóm không (lưu dạng '*'). */
export const isColumnAllGroups = (row, columnKey) =>
  (row?.columns?.[lower(columnKey)] || []).includes(ALL_UNITS);

/**
 * Bật/tắt MỘT ô (cột × nhóm). Đang là '*' mà bỏ tick một nhóm ⇒ nở '*' ra danh sách
 * tường minh rồi bớt nhóm đó — giữ đúng những nhóm còn lại, không mất quyền oan.
 */
export function toggleColumnGroup(panel, empCode, columnKey, groupKey) {
  const key = lower(columnKey);
  const group = upper(groupKey);
  const row = panel.rows.find((item) => item.empCode === upper(empCode));
  if (!row || !isGrantableColumn(key)) return panel;
  const every = row.availableGroups.map((item) => item.key);
  const scope = row.columns[key] || [];
  const current = scope.includes(ALL_UNITS) ? [...every] : [...scope];
  const next = current.includes(group) ? current.filter((item) => item !== group) : [...current, group];
  // Tick đủ mọi nhóm ⇒ gom về '*' cho gọn, và để nhóm mới sau này cũng được phủ.
  if (next.length && every.length && every.every((item) => next.includes(item))) {
    return setColumnGroups(panel, empCode, key, [ALL_UNITS]);
  }
  return setColumnGroups(panel, empCode, key, next);
}

/** Bật/tắt CẢ CỘT cho mọi nhóm — hàng "Mọi nhóm" trên đầu lưới. */
export function setColumnAllGroups(panel, empCode, columnKey, on) {
  return setColumnGroups(panel, empCode, columnKey, on ? [ALL_UNITS] : []);
}

/** Bật/tắt CẢ HÀNG: một nhóm, mọi cột — cho thao tác nhanh theo cụm đơn vị. */
export function toggleGroupAllColumns(panel, empCode, groupKey, columnKeys, on) {
  let next = panel;
  for (const columnKey of columnKeys) {
    const row = next.rows.find((item) => item.empCode === upper(empCode));
    if (isGroupChecked(row, columnKey, groupKey) !== !!on) {
      next = toggleColumnGroup(next, empCode, columnKey, groupKey);
    }
  }
  return next;
}

/** Tóm tắt cho dòng danh sách: mấy cột đang cấp, trên mấy nhóm. */
export function grantCounts(row) {
  const entries = Object.entries(row?.columns || {});
  const groupCount = new Set(entries.flatMap(([, scope]) => scope)).size;
  return {
    columnCount: entries.length,
    allGroups: entries.some(([, scope]) => scope.includes(ALL_UNITS)),
    groupCount,
  };
}
