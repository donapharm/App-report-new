import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * BỘ LỌC NÂNG CAO DÙNG CHUNG cho hai menu chi phí (CEO yêu cầu 09/08/2026).
 *
 * CEO: *"Tất cả các yêu cầu lọc trên làm theo dạng tính năng thông minh, nâng cao,
 * khi cần lọc thì mở bảng và chọn tính năng."* Nên bộ lọc NẰM GỌN sau một nút, mở ra
 * mới hiện — màn hình ngày thường không bị 9 ô lọc chiếm chỗ.
 *
 * ‼ Một bộ luật cho cả hai menu (backend: `server/src/costFilters.js`). Hai màn lọc
 * bằng hai bộ luật khác nhau thì cùng một câu hỏi ra hai con số, và không ai biết màn
 * nào đúng.
 */

/** Danh sách chiều lọc — thứ tự này cũng là thứ tự hiện trên màn. */
export const COST_FILTER_DIMENSIONS = [
  { key: 'contractors', label: 'Mã nhà thầu' },
  { key: 'contractorNames', label: 'Tên nhà thầu' },
  { key: 'partnerGroups', label: 'Group DONA/đối tác' },
  { key: 'employees', label: 'Nhân viên' },
  { key: 'routes', label: 'Tuyến' },
  { key: 'units', label: 'Mã đơn vị' },
  { key: 'groups', label: 'Nhóm mã đơn vị' },
  { key: 'priorities', label: 'Ưu tiên (H.A*…)' },
];

export const EMPTY_COST_FILTERS = Object.freeze({
  contractors: [], contractorNames: [], partnerGroups: [], employees: [],
  routes: [], units: [], groups: [], priorities: [], groupQuery: '', search: '',
});

/** Đếm số điều kiện đang bật — hiện ngay trên nút để không ai lọc mà không biết. */
export function countCostFilters(filters = {}) {
  const lists = COST_FILTER_DIMENSIONS.reduce((sum, dim) => sum + (filters[dim.key] || []).length, 0);
  return lists + (String(filters.groupQuery || '').trim() ? 1 : 0) + (String(filters.search || '').trim() ? 1 : 0);
}

/** Đổi bộ lọc thành tham số query — dùng CHUNG cho cả xem màn lẫn xuất Excel. */
export function costFilterParams(filters = {}) {
  const params = {};
  for (const dim of COST_FILTER_DIMENSIONS) {
    const list = filters[dim.key] || [];
    if (list.length) params[dim.key] = list.join(',');
  }
  if (String(filters.groupQuery || '').trim()) params.groupQuery = String(filters.groupQuery).trim();
  if (String(filters.search || '').trim()) params.search = String(filters.search).trim();
  return params;
}

const optionValue = (option) => (typeof option === 'string' ? option : option.value ?? option.key ?? '');
const optionLabel = (option) => (typeof option === 'string' ? option : option.label ?? optionValue(option));

/**
 * Ô chọn nhiều giá trị: nút mở danh sách tick. Danh sách trống = không lọc.
 *
 * ‼ BA ĐƯỜNG THOÁT (CEO báo kẹt 09/08: "tích vào ô chọn xuất theo cột, nó dính
 * luôn không thoát ra được"). Bản đầu mỗi ô tự giữ trạng thái mở nên MỞ ĐƯỢC
 * NHIỀU Ô CÙNG LÚC, chồng lên nhau che mất bảng, mà cách đóng duy nhất là bấm
 * lại đúng cái nút đã bị menu khác che. Nay:
 *   1. Bấm ra ngoài  → đóng
 *   2. Bấm phím Esc  → đóng
 *   3. Nút "Xong"    → đóng
 * và trạng thái mở do CHA giữ ⇒ mở ô này thì ô kia tự đóng, không bao giờ chồng.
 */
export function MultiPick({ label, options = [], values = [], onChange, open, onToggle }) {
  const boxRef = useRef(null);
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (event) => { if (!boxRef.current?.contains(event.target)) onToggle(false); };
    const onKey = (event) => { if (event.key === 'Escape') onToggle(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); };
  }, [open, onToggle]);

  // Danh sách dài (mã đơn vị có hàng trăm dòng) mà bắt cuộn tay thì không ai lọc nổi.
  const shown = useMemo(() => {
    const q = needle.trim().toUpperCase();
    if (!q) return options;
    return options.filter((option) => `${optionValue(option)} ${optionLabel(option)}`.toUpperCase().includes(q));
  }, [options, needle]);

  return <div className="cost-breakdown-pick" ref={boxRef}>
    <button type="button" className={`btn secondary${values.length ? ' is-active' : ''}`} aria-expanded={open}
      onClick={() => onToggle(!open)}>
      {label}{values.length ? ` (${values.length})` : ''}
    </button>
    {open && <div className="cost-breakdown-pick-menu">
      <div className="cost-breakdown-pick-head">
        <button type="button" className="btn ghost" onClick={() => onChange([])}>Bỏ lọc</button>
        <button type="button" className="btn" onClick={() => onToggle(false)}>Xong</button>
      </div>
      {options.length > 8 && <input className="cost-breakdown-pick-search" value={needle} aria-label={`Tìm trong ${label}`}
        onChange={(e) => setNeedle(e.target.value)} placeholder={`Tìm trong ${options.length} giá trị…`} />}
      <div className="cost-breakdown-pick-list">
        {shown.map((option) => {
          const value = optionValue(option);
          return <label key={value}>
            <input type="checkbox" checked={values.includes(value)}
              onChange={() => onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value])} />
            {optionLabel(option)}
          </label>;
        })}
        {!options.length && <small className="muted">Chưa có giá trị nào trong dữ liệu đang xem.</small>}
        {!!options.length && !shown.length && <small className="muted">Không có giá trị nào khớp "{needle}".</small>}
      </div>
      <small className="muted cost-breakdown-pick-hint">Bấm ra ngoài hoặc phím Esc để đóng.</small>
    </div>}
  </div>;
}

/**
 * Bảng lọc nâng cao — đóng lại thành MỘT nút khi không dùng.
 *
 * `options` là các giá trị CÓ THẬT trong dữ liệu đang xem, backend thu TRƯỚC khi lọc
 * nên bỏ lọc luôn còn đường quay lại.
 */
export function CostFilterPanel({ options = {}, partnerGroups = [], value = EMPTY_COST_FILTERS, onChange, note = '' }) {
  const [open, setOpen] = useState(false);
  const [openPick, setOpenPick] = useState('');
  const active = countCostFilters(value);
  const set = (patch) => onChange({ ...value, ...patch });
  const optionsOf = (key) => (key === 'partnerGroups'
    ? (partnerGroups.length ? partnerGroups : [{ key: 'DONA', label: 'Group-DONA' }, { key: 'PARTNER', label: 'Group-đối tác' }])
    : (options[key] || []));

  // Chip từng điều kiện đang bật: nhìn là biết đang lọc gì, bỏ được từng cái một.
  const chips = COST_FILTER_DIMENSIONS.flatMap((dim) => (value[dim.key] || []).map((item) => ({
    key: `${dim.key}:${item}`, label: `${dim.label}: ${item}`,
    drop: () => set({ [dim.key]: value[dim.key].filter((v) => v !== item) }),
  })));
  if (String(value.groupQuery || '').trim()) chips.push({ key: 'groupQuery', label: `Nhóm mã: ${value.groupQuery}`, drop: () => set({ groupQuery: '' }) });
  if (String(value.search || '').trim()) chips.push({ key: 'search', label: `Tìm: ${value.search}`, drop: () => set({ search: '' }) });

  return <div className="card cost-filter-panel">
    <div className="cost-filter-head">
      <button type="button" className={`btn secondary${active ? ' is-active' : ''}`} aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        {open ? '▲ Thu gọn bộ lọc' : '⚙ Bộ lọc nâng cao'}{active ? ` (${active})` : ''}
      </button>
      {!!active && <button type="button" className="btn ghost" onClick={() => onChange({ ...EMPTY_COST_FILTERS })}>Xoá hết bộ lọc</button>}
      {!open && !active && <small className="muted">Chưa lọc gì — đang xem toàn bộ phạm vi được phép.</small>}
    </div>

    {!!chips.length && <div className="cost-filter-chips">
      {chips.map((chip) => <button type="button" key={chip.key} className="cost-filter-chip" onClick={chip.drop}
        title="Bấm để bỏ điều kiện này">{chip.label} ✕</button>)}
    </div>}

    {open && <div className="cost-filter-body">
      <div className="cost-filter-picks">
        {COST_FILTER_DIMENSIONS.map((dim) => <MultiPick key={dim.key} label={dim.label}
          open={openPick === dim.key} onToggle={(v) => setOpenPick(v ? dim.key : '')}
          options={optionsOf(dim.key)} values={value[dim.key] || []}
          onChange={(list) => set({ [dim.key]: list })} />)}
      </div>
      <div className="cost-filter-inputs">
        {/* ‼ CEO nhấn mạnh: "phải có dấu '.' sau số nhóm thì mới liệt kê đủ số nhóm
            mã đơn vị". Không có dấu chấm thì 001 nuốt luôn 0011 — nên backend KHÔNG
            lọc, và nói thẳng ra ở dòng dưới chứ không lặng lẽ bỏ qua. */}
        <label><span>Gõ nhóm mã đơn vị</span>
          <input value={value.groupQuery || ''} onChange={(e) => set({ groupQuery: e.target.value })}
            placeholder='ví dụ 033.  (bắt buộc có dấu chấm)' />
        </label>
        <label><span>Tìm tự do</span>
          <input value={value.search || ''} onChange={(e) => set({ search: e.target.value })}
            placeholder="NV, đơn vị, mã hàng, nhà thầu, tuyến…" />
        </label>
      </div>
      <small className="muted cost-filter-hint">Gõ <b>033.</b> (có dấu chấm) để lấy đúng cụm 033 — thiếu dấu chấm thì nhóm 001 sẽ nuốt luôn nhóm 0011, nên hệ thống không lọc.</small>
      {!!note && <div className="catalog-alert error cost-filter-note" role="status">⚠ {note}</div>}
    </div>}
  </div>;
}
