import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDonaTableCellTools } from '@donapharm/dona-table-cell-tools/react';
import '@donapharm/dona-table-cell-tools/css';
import { api, downloadCostRatesTable, downloadFilteredEmployeeReport, downloadFilteredEmployeeSummary } from '../api.js';
import { Spinner } from '../components.jsx';
import { bangkokToday } from '../revenueCoverage.js';
import { formatDateTime } from '../util.js';
import { createLatestRequestGate } from '../requestCoordinator.js';
import {
  ALL_UNITS, applyColumnsToMany, buildGrantPanel, dirtyRows,
  grantSavePayload, grantSummary, ratesLookup,
  grantCounts, isColumnAllGroups, isGroupChecked, setColumnAllGroups, toggleColumnGroup, toggleGroupAllColumns,
  reviewGrants, applySuggestion, verifySavedGrants,
} from '../catalogCostGrantsModel.js';
import { pct } from '../util.js';

/** Ô % trong bảng danh mục. Không có quyền HOẶC chưa có % ⇒ '—' + chỉ đường.
 *  `pct` đi qua rèm che nên đang ẩn số thì ô này cũng bị che (SPEC_PRIVACY_EYE). */
function CostRateCell({ value, label }) {
  if (value == null) {
    return <td className="catalog-money catalog-rate is-missing" data-sensitive="" data-label={label}
      title="Chưa có % cho cặp này — xem tab “Mặt hàng thiếu %” ở màn Chi phí">—</td>;
  }
  return <td className="catalog-money catalog-rate" data-sensitive="" data-label={label}>{pct(value, 2)}</td>;
}

const uiToHub = (ky) => { const m = String(ky || '').match(/^(\d{2})\.(\d{4})$/); return m ? `${m[2]}-${m[1]}` : ky; };
const hubToUi = (period) => { const m = String(period || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}.${m[1]}` : period; };
// GIỜ VIỆT NAM (GMT+7). Trước đây lấy `new Date().getMonth()` = giờ MÁY NGƯỜI DÙNG:
// máy để lệch múi giờ (hoặc mở app từ nước khác) sẽ ra sai tháng, nhất là ngày đầu/cuối tháng.
const currentKy = () => { const [y, m] = bangkokToday().split('-'); return `${m}.${y}`; };
// 'data-hub-local' = đường đọc THƯỜNG NGÀY: bản sao y đã kéo về máy, không phải
// hàng dự phòng lúc hỏng ('data-hub-lkg'). CEO bắt lỗi 09/08: xem danh mục không
// được đi gọi DataHub mỗi lần — muốn bản mới thì bấm "Đồng bộ lại".
const sourceLabel = (source) => ({ 'data-hub': 'Data Hub', 'data-hub-local': 'Data Hub · bản trên máy', 'data-hub-lkg': 'Data Hub · bản tốt gần nhất' }[source] || source || '—');
// ‼ GMT+7. Bản cũ dùng `new Date(iso).toLocaleString('vi-VN')` = múi giờ MÁY người
// dùng; máy để lệch (hoặc mở từ nước khác) là ngày đồng bộ hiện sai. `formatDateTime`
// đã ghim 'Asia/Bangkok'.
const dateText = (iso) => formatDateTime(iso, 'Chưa đồng bộ');

/**
 * Số hiệu bản danh mục để CEO nhìn phát biết ngay đang xem bản nào (yêu cầu 09/08/2026).
 * Số này do Data Hub gửi sang (`meta.version`), App Report chỉ chép lại.
 *
 * ‼ KHÔNG BAO GIỜ BỊA. Data Hub không gửi version thì `remoteSnapshot` điền 'unknown';
 * lúc đó phải nói "chưa rõ", tuyệt đối không suy ra số từ ngày tháng hay đoán bản kế
 * tiếp. Bài học 09/08: một con số viết cứng cho "đẹp màn hình" bị đọc thành số liệu
 * thật rồi thành nghi ngờ mất dữ liệu.
 */
const CATALOG_VERSION_UNKNOWN = new Set(['', 'unknown', 'null', 'undefined', 'n/a', '—', '-']);
function catalogVersionLabel(raw) {
  const value = String(raw ?? '').trim();
  if (CATALOG_VERSION_UNKNOWN.has(value.toLowerCase())) return '';
  // '31.4' → 'V31.4'; 'V31.4' giữ nguyên; dạng lạ (checksum…) hiện y như nguồn gửi.
  if (/^\d+(\.\d+)*$/.test(value)) return `V${value}`;
  if (/^v\d/i.test(value)) return `V${value.slice(1)}`;
  return value;
}
const moneyText = (value) => {
  if (value == null || value === '') return '—';
  const amount = Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(amount) ? `${amount.toLocaleString('vi-VN')} đ` : String(value);
};
const quantityText = (value) => {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : String(value);
};
const activeInPeriod = (row, period) => row?.active !== false && row?.effective_from <= period && (!row?.effective_to || row.effective_to >= period);
const routeOf = (row) => String(row?.route || '').trim().toUpperCase();
const provinceOf = (row) => String(row?.province || '').trim();
const normalizeSearch = (value) => String(value || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const editDistanceWithin = (a, b, limit) => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
};
const smartTokenMatch = (queryToken, candidateToken) => {
  if (queryToken === candidateToken || (queryToken.length >= 2 && candidateToken.includes(queryToken))) return true;
  if (!/^[a-z]+$/.test(queryToken) || !/^[a-z]+$/.test(candidateToken)) return false;
  const limit = queryToken.length >= 8 ? 2 : queryToken.length >= 4 ? 1 : 0;
  return limit > 0 && editDistanceWithin(queryToken, candidateToken, limit) <= limit;
};
const catalogSearchText = (row) => [row.emp_code, row.emp_name, row.type, row.value, row.label, row.province, row.route, row.contractor_code, row.unit_code, row.qlnb_code, row.c10, row.product_name, row.active_ingredient, row.strength, row.uom].filter(Boolean).join(' ');
const matchesSmartSearch = (row, query) => {
  const q = normalizeSearch(query); if (!q) return true;
  const haystack = normalizeSearch(catalogSearchText(row));
  if (haystack.includes(q)) return true;
  const candidates = haystack.split(' ');
  return q.split(' ').every((token) => candidates.some((candidate) => smartTokenMatch(token, candidate)));
};
const drugNameKey = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
const drugQlnbCounts = (rows) => {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = drugNameKey(row.product_name);
    const qlnb = String(row.qlnb_code || '').trim();
    if (!key || !qlnb) continue;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key).add(qlnb);
  }
  return new Map([...grouped].map(([key, codes]) => [key, codes.size]));
};
const ROUTES = ['CL', 'NCL', 'NT'];
const PAGE_SIZE = 50; // CEO chốt 08/08/2026: tối đa 50 dòng/trang cho đỡ dài
// Tổng width phải khớp CHÍNH XÁC tổng các cột đang render. Nếu giữ min-width của
// trường hợp đủ 7 cột %, table-layout:fixed sẽ kéo giãn mọi cột khi NV được cấp ít cột.
const catalogTableWidth = (admin, costColumnCount) => {
  const safeCount = Math.max(0, Math.min(7, Number(costColumnCount) || 0));
  return `${(admin ? 1658 : 1546) + safeCount * 96}px`;
};

function CatalogTableCard({ id, tableId, children, cellLines = 3 }) {
  const { rootRef } = useDonaTableCellTools({
    appId: 'app-report',
    tableId,
    cellSelector: 'td[data-full-value]'
  });
  return <div ref={rootRef} id={id} className="card table-card catalog-table-card" data-app-id="app-report" data-table-id={tableId}
    style={{ '--catalog-cell-lines': cellLines }}>{children}</div>;
}

/**
 * NHÃN KỲ CỦA BẢNG — dán ngay trên bảng danh mục (CEO yêu cầu 10/08/2026).
 *
 * CEO: *"Đáng lẽ khi chọn kỳ phụ trách ở trên là T07.2026 thì ở dưới bảng danh mục
 * cột phụ trách từ kỳ nó cũng phải nhảy theo, hoặc làm sao để nhìn thấy bảng dưới
 * chính xác là của T07.2026, còn chuyển kỳ thì nó cho biết bảng của tháng mấy chứ."*
 *
 * Hai chuyện khác hẳn nhau mà trước đây màn không nói ra chỗ nào:
 *  1. **Bảng thuộc kỳ nào** — ô "Kỳ" nằm tít trên đầu màn, cuộn xuống bảng là mất
 *     hút; không có gì trên bảng nhắc lại. Nay in thẳng "Bảng danh mục KỲ 07.2026".
 *  2. **Cột "Phụ trách từ kỳ" KHÔNG phải kỳ của bảng** — nó là kỳ NV BẮT ĐẦU nhận
 *     cặp đó, nên chọn kỳ 07 mà cột ghi 05.2026 là ĐÚNG (nhận từ tháng 5, vẫn còn
 *     phụ trách trong tháng 7). Nó không "nhảy theo" ô Kỳ, và đó là chủ ý.
 *
 * Khi bảng đang là kỳ CŨ (kỳ mới tải hỏng/đang tải) thì nhãn đổi màu cảnh báo và
 * nói rõ đang lệch — không để ai đọc số kỳ này tưởng là kỳ kia.
 */
function CatalogPeriodBanner({ tablePeriod, selectedPeriod = '', count = 0, countLabel = 'cặp' }) {
  const mismatch = !!selectedPeriod && !!tablePeriod && selectedPeriod !== tablePeriod;
  return <div className={`catalog-period-banner${mismatch ? ' is-mismatch' : ''}`} role="status" aria-live="polite">
    <b>📅 Bảng danh mục KỲ {tablePeriod || '—'}</b>
    <span className="catalog-period-banner-count">{Number(count || 0).toLocaleString('vi-VN')} {countLabel}</span>
    <em>{mismatch
      ? `⚠ Ô "Kỳ" phía trên đang chọn ${selectedPeriod} nhưng bảng dưới VẪN là kỳ ${tablePeriod} — chưa tải được kỳ ${selectedPeriod}.`
      : `Cột "Phụ trách từ kỳ" là kỳ nhân viên BẮT ĐẦU nhận cặp (có thể sớm hơn ${tablePeriod}), không phải kỳ của bảng.`}</em>
  </div>;
}

/** Chọn số dòng tối đa hiện trong MỘT ô (CEO yêu cầu 09/08: "chọn 1/2/3 dòng tuỳ
 *  theo mong muốn"). Ghi nhớ trong trình duyệt để lần sau mở lại vẫn như cũ. */
const CELL_LINES_KEY = 'rpt_catalog_cell_lines';
function useCellLines() {
  const [lines, setLines] = useState(() => {
    try { const v = Number(localStorage.getItem(CELL_LINES_KEY)); return [0, 1, 2, 3].includes(v) ? v : 3; } catch { return 3; }
  });
  useEffect(() => { try { localStorage.setItem(CELL_LINES_KEY, String(lines)); } catch { /* ignore */ } }, [lines]);
  return [lines, setLines];
}
function CellLinesPicker({ lines, onChange }) {
  return <label className="catalog-cell-lines">
    <span>Dòng/ô</span>
    <select value={lines} onChange={(e) => onChange(Number(e.target.value))} aria-label="Số dòng tối đa hiển thị trong một ô">
      <option value={1}>1 dòng</option>
      <option value={2}>2 dòng</option>
      <option value={3}>3 dòng</option>
      <option value={0}>Tất cả</option>
    </select>
  </label>;
}

function PreviewCell({ value, children, className, label }) {
  const visibleValue = String(value ?? '');
  return <td className={className} data-full-value={visibleValue} data-label={label}><span className="dona-cell-value">{children ?? visibleValue}</span></td>;
}

function DrugName({ row, counts }) {
  const name = row.product_name || '—';
  const count = counts.get(drugNameKey(row.product_name)) || 0;
  const needsAttention = count > 1;
  const title = needsAttention ? `${name} · Tên thuốc này có ${count} mã QLNB trong kỳ đang xem` : name;
  return <b className={`catalog-two-lines${needsAttention ? ' catalog-drug-multi-qlnb' : ''}`} title={title}>{name}</b>;
}

/**
 * Huy hiệu nguồn danh mục + nút đồng bộ lại (CEO yêu cầu 09/08/2026).
 *
 * CEO: "chỗ 'Data Hub đã kết nối' thêm vào đó bản Version bao nhiêu, kèm ngày tháng
 * năm… để nhìn vào biết ngay" — trước đây version chỉ nằm trong tooltip, phải rê chuột
 * mới thấy, mà trên điện thoại thì không rê được.
 *
 * Ba mẩu tin, mỗi mẩu trả lời đúng một câu hỏi:
 *   • bản nào  → V31.4 (Data Hub gửi; không có thì "bản: chưa rõ", KHÔNG đoán)
 *   • bản ngày nào → ngày Data Hub đóng bản (`updatedAt`)
 *   • mình kéo về lúc nào → `lastSyncAt`, để phân biệt "bản cũ" với "chưa kéo về"
 */
function SourceStatus({ meta, canRefresh = false, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Kết quả lần bấm gần nhất: nội dung có ĐỔI không (xem khối `run` bên dưới).
  const [refreshed, setRefreshed] = useState(null);
  if (!meta) return null;
  // ‼ Ưu tiên SỐ HIỆU FILE NGUỒN (CP_TOTAL) nếu DataHub gửi; không có thì hiện số
  // hiệu CỬA DANH MỤC và NÓI RÕ đó là số của cửa, không phải số file.
  const sourceVersion = catalogVersionLabel(meta.sourceVersion);
  const gateVersion = catalogVersionLabel(meta.version);
  const version = sourceVersion || gateVersion;
  const state = meta.stale ? 'Bản tốt gần nhất' : (meta.readOnly ? 'Chỉ đọc' : 'Đã kết nối');
  /**
   * ‼ Bấm "Đồng bộ lại" xong phải trả lời được câu DUY NHẤT người bấm muốn biết:
   * **nội dung có thật sự đổi không?** (CEO chỉnh 09/08/2026: *"số dòng thì đúng
   * rồi, nhưng tao đã sửa nhiều đợt trong đó, nên nó mới nâng lên bản V31.4"*).
   * Đếm dòng KHÔNG trả lời được — sửa hàng trăm ô mà tổng vẫn 27.719. So bằng
   * checksum (băm toàn bộ nội dung) mới là bằng chứng.
   */
  const run = async () => {
    setBusy(true); setError(''); setRefreshed(null);
    try { setRefreshed(await onRefresh?.() ?? null); }
    catch (e) { setError(e.message || 'Đồng bộ lại không thành công'); }
    finally { setBusy(false); }
  };
  return <div className={`catalog-source-inline ${meta.stale ? 'is-stale' : 'is-fresh'}`}
    title={`${sourceLabel(meta.source)} · ${sourceVersion ? `file nguồn ${sourceVersion}` : `cửa danh mục ${gateVersion || 'chưa rõ'} — Data Hub CHƯA gửi số hiệu file CP_TOTAL`} · đóng bản ${dateText(meta.updatedAt)} · kéo về ${dateText(meta.lastSyncAt)}${meta.message ? ` · ${meta.message}` : ''}`}>
    <i aria-hidden="true" />
    <div className="catalog-source-text">
      <b>
        {sourceLabel(meta.source)}
        {version
          ? <span className={`catalog-source-version${sourceVersion ? '' : ' is-gate'}`}
              title={sourceVersion
                ? `Số hiệu FILE NGUỒN (CP_TOTAL) do Data Hub gửi: ${sourceVersion}`
                : `${gateVersion} là số hiệu CỬA DANH MỤC của Data Hub, KHÔNG phải số hiệu file CP_TOTAL. Data Hub chưa gửi số hiệu file.`}>
              {version}{sourceVersion ? '' : ' (cửa)'}
            </span>
          : <span className="catalog-source-version is-unknown" title="Data Hub chưa gửi số hiệu bản cho kỳ này">bản: chưa rõ</span>}
      </b>
      <small>{meta.servedFrom === 'local' ? 'Đọc từ máy — không gọi Data Hub' : state} · bản ngày {dateText(meta.updatedAt)}</small>
      <small className="catalog-source-sync">Kéo về máy: {dateText(meta.lastSyncAt)}</small>
    </div>
    {canRefresh && <button type="button" className="btn secondary catalog-source-refresh" disabled={busy} onClick={run}
      title="Bỏ bản đang nhớ tạm và hỏi lại Data Hub ngay">
      {busy ? 'Đang hỏi lại…' : '⟳ Đồng bộ lại'}
    </button>}
    {error && <small className="catalog-source-error" role="alert">⚠ {error}</small>}
    {refreshed && (refreshed.changed === true
      ? <small className="catalog-source-changed" role="status">
          ✅ Đã hỏi lại Data Hub — <b>NỘI DUNG CÓ ĐỔI</b>
          {refreshed.before && refreshed.after && refreshed.before.rows !== refreshed.after.rows
            ? <> ({refreshed.before.rows.toLocaleString('vi-VN')} → {refreshed.after.rows.toLocaleString('vi-VN')} dòng)</>
            : ' (số dòng như cũ, nội dung bên trong khác)'}.
        </small>
      : refreshed.changed === false
        ? <small className="catalog-source-error" role="alert">
            ⚠ Đã hỏi lại Data Hub — <b>NỘI DUNG KHÔNG ĐỔI</b> (băm nội dung y hệt bản cũ).
            Nếu Anh/Chị vừa sửa file CP_TOTAL thì <b>bản sửa CHƯA sang tới đây</b> — báo Data Hub nạp lại file nguồn,
            bấm nút này thêm lần nữa cũng ra kết quả này.
          </small>
        : <small className="catalog-source-changed" role="status">✅ Đã hỏi lại Data Hub (máy chưa có bản cũ để so).</small>)}
  </div>;
}

/* ══ NHỚ DANH MỤC TRONG PHIÊN LÀM VIỆC ═══════════════════════════════════════
   CEO 09/08 23:22: *"mỗi lần tao đổi màn xem nó quay như thế này thì có bực không
   cơ chứ."* Đúng. Local-first đã bỏ được cú gọi DataHub, nhưng **mỗi lần vào lại
   trang là trình duyệt tải lại 27.719 dòng từ máy chủ** — vài giây quay vòng, lần
   nào cũng vậy, dù dữ liệu y hệt lần trước.

   Nhớ ngay trong bộ nhớ trang (không phải đĩa, không hạn mức): đổi màn qua lại
   trong cùng phiên là hiện NGAY. Đây là bộ nhớ CỦA TRÌNH DUYỆT, không đụng máy chủ
   và không đụng DataHub — không phải "tác dụng phụ trên đường đọc".

   Xoá bản nhớ khi: bấm "Đồng bộ lại" (muốn số mới) hoặc tải lại trang. */
const catalogSessionCache = new Map();
const CATALOG_SESSION_MAX = 3;
function rememberCatalog(period, value) {
  catalogSessionCache.delete(period);
  catalogSessionCache.set(period, value);
  while (catalogSessionCache.size > CATALOG_SESSION_MAX) catalogSessionCache.delete(catalogSessionCache.keys().next().value);
}

function CatalogSearch({ value, onChange, employee = false }) {
  return <label className="catalog-search-label"><span>{employee ? 'Tìm thông minh trong danh mục của tôi' : 'Tìm thông minh toàn danh mục'}</span><div className="catalog-search-wrap"><input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Tên thuốc, QLNB, đơn vị, nhà thầu…" aria-label="Tìm kiếm thông minh danh mục" />{value && <button type="button" onClick={() => onChange('')} aria-label="Xóa nội dung tìm kiếm" title="Xóa tìm kiếm">×</button>}</div></label>;
}

/** Nạp % chi phí theo phạm vi backend cấp. Lỗi/không quyền ⇒ không cột nào, bảng
 *  giữ nguyên như trước — tính năng này không bao giờ được làm hỏng màn danh mục. */
function useCostRates(period) {
  const [state, setState] = useState({ columns: [], rateOf: () => null, stale: false, note: '' });
  useEffect(() => {
    let alive = true;
    // ‼ `pairs: 1` = "màn này cần SỐ, không chỉ tên cột". Menu phân quyền gọi cùng
    // endpoint nhưng KHÔNG gửi cờ này nên không phải tải hàng vạn cặp cho nặng.
    api.catalogCostRates(period ? { period, pairs: 1 } : { pairs: 1 })
      .then((data) => {
        if (!alive) return;
        setState({
          columns: data.columns || [],
          rateOf: ratesLookup(data.pairs || []),
          stale: data.rateStale === true,
          note: data.rateStaleNote || '',
        });
      })
      .catch(() => { if (alive) setState({ columns: [], rateOf: () => null, stale: false, note: '' }); });
    return () => { alive = false; };
  }, [period]);
  return state;
}

function EmployeeSections({ data, costColumns = [], rateOf = () => null }) {
  const [query, setQuery] = useState('');
  const [province, setProvince] = useState('');
  const [route, setRoute] = useState('');
  const [unit, setUnit] = useState('');
  const [page, setPage] = useState(1);
  const [cellLines, setCellLines] = useCellLines();
  const currentRows = useMemo(() => data?.sections?.current || [], [data]);
  const qlnbCounts = useMemo(() => drugQlnbCounts(currentRows), [currentRows]);
  const provinceOptions = useMemo(() => [...new Set(currentRows.map(provinceOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows]);
  const routeOptions = useMemo(() => [...new Set(currentRows.filter((row) => !province || provinceOf(row) === province).map(routeOf).filter(Boolean))].sort(), [currentRows, province]);
  const unitOptions = useMemo(() => [...new Set(currentRows.filter((row) => (!province || provinceOf(row) === province) && (!route || routeOf(row) === route)).map((row) => row.unit_code).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows, province, route]);
  const rows = useMemo(() => currentRows.filter((row) => {
    return matchesSmartSearch(row, query) && (!province || provinceOf(row) === province) && (!route || routeOf(row) === route) && (!unit || row.unit_code === unit);
  }), [currentRows, query, province, route, unit]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, province, route, unit, data?.period]);
  const goPage = (next) => { setPage(Math.max(1, Math.min(pageCount, next))); requestAnimationFrame(() => document.getElementById('employee-catalog-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  return <>
    <div className="card catalog-help"><b>Danh mục của {data?.employee?.name || data?.employee?.code}</b><p>Chỉ hiển thị các cặp đơn vị – mã QLNB Anh/Chị đang phụ trách trong kỳ {data?.period_ui || hubToUi(data?.period)}.</p></div>
    <div className="card catalog-controls-compact">
      <div className="catalog-filter-row catalog-filter-row-employee">
        <CatalogSearch value={query} onChange={setQuery} employee />
        <label><span>Vùng/Tỉnh</span><select value={province} onChange={(e) => { setProvince(e.target.value); setRoute(''); setUnit(''); }}><option value="">Tất cả vùng</option>{provinceOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Tuyến</span><select value={route} onChange={(e) => { setRoute(e.target.value); setUnit(''); }}><option value="">Tất cả tuyến</option>{routeOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Đơn vị</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Tất cả đơn vị</option>{unitOptions.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <CellLinesPicker lines={cellLines} onChange={setCellLines} />
        <div className="catalog-result-count"><span>Đang phụ trách kỳ {data?.period_ui || hubToUi(data?.period)}</span><b>{rows.length.toLocaleString('vi-VN')} cặp</b></div>
      </div>
    </div>
    <CatalogTableCard id="employee-catalog-table-top" tableId="employee-catalog" cellLines={cellLines}>
      <CatalogPeriodBanner tablePeriod={data?.period_ui || hubToUi(data?.period)} count={rows.length} />
      <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} period={data?.period_ui || hubToUi(data?.period)} location="top" />
      <div className="table-scroll"><table className="catalog-table catalog-table-simple catalog-table-products catalog-table-employee" data-cost-column-count={costColumns.length} style={{ '--catalog-table-width': catalogTableWidth(false, costColumns.length) }}><thead><tr><th>Tuyến</th><th>Mã nhà thầu</th><th className="catalog-col-unit">Mã đơn vị</th><th>Mã QLNB</th><th>C10</th><th className="catalog-col-text">Tên thuốc</th><th className="catalog-col-text">Hoạt chất + Hàm lượng</th><th>ĐVT</th><th className="catalog-money catalog-col-price">Đơn giá trúng thầu</th><th className="catalog-money">CST ban đầu</th><th className="catalog-money">CST còn lại</th>{costColumns.map((c) => <th key={c.key} className="catalog-money" title={c.label}>{c.key.toUpperCase()} (%)</th>)}<th className="catalog-col-since" title="Kỳ nhân viên BẮT ĐẦU phụ trách cặp này — không phải kỳ đang xem">Phụ trách từ kỳ<small>kỳ NV bắt đầu nhận</small></th><th>Đến kỳ</th></tr></thead><tbody>{visibleRows.map((r) => {
        const pct = Number(r.cst_initial) > 0 && r.cst_remaining != null ? (Number(r.cst_remaining) / Number(r.cst_initial)) * 100 : null;
        const pctClass = pct == null ? '' : pct <= 10 ? ' is-low' : pct <= 30 ? ' is-warning' : ' is-ok';
        const ingredientText = [r.active_ingredient, r.strength].filter(Boolean).join(' · ') || '—';
        const effectiveToText = r.effective_to ? hubToUi(r.effective_to) : 'Đang phụ trách';
        return <tr key={r.id}>
          <PreviewCell label="Tuyến" value={routeOf(r) || '—'} />
          <PreviewCell label="Mã nhà thầu" value={r.contractor_code || '—'} />
          <PreviewCell label="Mã đơn vị" className="catalog-col-unit catalog-mobile-wide" value={r.unit_code || '—'} />
          <PreviewCell label="Mã QLNB" className="catalog-mobile-wide" value={r.qlnb_code || '—'} />
          <PreviewCell label="C10" value={r.c10 || '—'}><span className={r.c10 ? 'catalog-c10' : 'catalog-c10 is-missing'} title={r.c10 ? `Nhóm ưu tiên C10: ${r.c10}` : 'Chưa có C10 — cần bổ sung để tính thưởng P2'}>{r.c10 || '—'}</span></PreviewCell>
          <PreviewCell label="Tên thuốc" className="catalog-col-text catalog-mobile-wide" value={r.product_name || '—'}><DrugName row={r} counts={qlnbCounts} /></PreviewCell>
          <PreviewCell label="Hoạt chất + Hàm lượng" className="catalog-col-text catalog-mobile-wide" value={ingredientText}><span className="catalog-two-lines" title={ingredientText}>{ingredientText}</span></PreviewCell>
          <PreviewCell label="ĐVT" value={r.uom || '—'} />
          <td className="catalog-money catalog-col-price" data-sensitive="" data-label="Đơn giá trúng thầu"><b>{moneyText(r.bid_price)}</b></td>
          <td className="catalog-money" data-sensitive="" data-label="CST ban đầu">{quantityText(r.cst_initial)}</td>
          <td className={`catalog-money catalog-cst${pctClass}`} data-sensitive="" data-label="CST còn lại"><b>{quantityText(r.cst_remaining)}</b>{pct != null && <small>{pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</small>}</td>
          {costColumns.map((c) => <CostRateCell key={c.key} label={`${c.key.toUpperCase()} (%)`} value={rateOf(r.unit_code, r.qlnb_code, c.key)} />)}
          <PreviewCell label="Phụ trách từ kỳ" value={hubToUi(r.effective_from)} />
          <PreviewCell label="Đến kỳ" value={effectiveToText}>{r.effective_to ? effectiveToText : <span className="catalog-active-label">{effectiveToText}</span>}</PreviewCell>
        </tr>;
      })}</tbody></table></div>
      {rows.length === 0 && <div className="muted catalog-empty">Chưa có danh mục trong phạm vi đang lọc.</div>}
      <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} period={data?.period_ui || hubToUi(data?.period)} location="bottom" />
    </CatalogTableCard>
  </>;
}

function Pager({ page, pageCount, total, onPage, location, period = '' }) {
  return <div className={`catalog-pager ${location === 'top' ? 'is-top' : 'is-bottom'}`}>
    <div className="catalog-pager-capsule" role="group" aria-label={`Danh mục kỳ ${period || '—'}, chuyển trang, trang ${page} trên ${pageCount}`}>
      <button className="catalog-pager-prev" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Trước</button>
      {/* ‼ Kỳ đi kèm ngay trong thanh trang: thanh này DÍNH ĐẦU MÀN khi cuộn, nên đây
          là chỗ duy nhất luôn nhìn thấy. Ô "Kỳ" ở đầu trang cuộn một cái là mất hút,
          đúng điều CEO phàn nàn 10/08. */}
      <span>{!!period && <em className="catalog-pager-period" title="Kỳ của bảng đang xem">KỲ {period}</em>}<svg className="catalog-capsule-mark" viewBox="0 0 42 22" aria-hidden="true"><path d="M11 1h10v20H11A10 10 0 0 1 11 1Z" fill="#1676bd"/><path d="M21 1h10a10 10 0 0 1 0 20H21Z" fill="#f29313"/><path d="M8 5c6-4 20-4 27 0" fill="none" stroke="#fff" strokeOpacity=".62" strokeWidth="2" strokeLinecap="round"/><path d="M21 1v20" stroke="#fff" strokeOpacity=".82"/></svg><b>Trang {page.toLocaleString('vi-VN')}/{pageCount.toLocaleString('vi-VN')}</b><i>· {total.toLocaleString('vi-VN')} dòng</i></span>
      <button className="catalog-pager-next" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Sau ›</button>
    </div>
  </div>;
}

function TransferPanel({ period, rows, meta, onDone }) {
  const [form, setForm] = useState({ from_emp_code: '', to_emp_code: '', type: 'unit_qlnb', values: [], effective_period: period, note: '' });
  const [pickQuery, setPickQuery] = useState('');
  const [route, setRoute] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const employees = useMemo(() => [...new Set(rows.map((r) => r.emp_code).filter(Boolean))].sort(), [rows]);
  useEffect(() => { setForm((x) => ({ ...x, effective_period: period, values: [] })); setPreview(null); }, [period]);
  const set = (key, value) => { setForm((x) => ({ ...x, [key]: value })); setPreview(null); setMessage(''); setError(''); };
  const candidates = useMemo(() => rows.filter((row) => row.type === 'unit_qlnb' && (!form.from_emp_code || row.emp_code === form.from_emp_code)), [rows, form.from_emp_code]);
  const pickRows = useMemo(() => candidates.filter((row) => (!route || routeOf(row) === route) && (!pickQuery || `${row.label} ${row.value} ${row.unit_code} ${row.qlnb_code}`.toLowerCase().includes(pickQuery.toLowerCase()))).slice(0, 300), [candidates, route, pickQuery]);
  const toggleValue = (value) => set('values', form.values.includes(value) ? form.values.filter((x) => x !== value) : [...form.values, value]);
  function makePreview() {
    if (!form.from_emp_code) return setError('Bước 1: chọn nhân viên hiện tại.');
    if (!form.values.length) return setError('Bước 1: chọn ít nhất một cặp đơn vị – mã QLNB.');
    if (!form.to_emp_code) return setError('Bước 2: chọn nhân viên mới.');
    if (form.from_emp_code === form.to_emp_code) return setError('Nhân viên hiện tại và nhân viên mới phải khác nhau.');
    const selected = rows.filter((row) => row.emp_code === form.from_emp_code && row.type === 'unit_qlnb' && form.values.includes(row.value));
    if (selected.length !== form.values.length) return setError('Có mục quản lý không còn thuộc nhân viên hiện tại trong dữ liệu đang xem.');
    setError(''); setPreview({ before: selected, after_emp: form.to_emp_code, effective_from: form.effective_period });
  }
  async function submit() {
    if (!preview) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.adminCatalogManagementTransfer({ ...form, period: form.effective_period });
      setMessage('Data Hub đã ghi nhận điều chuyển.'); setPreview(null); setForm((x) => ({ ...x, values: [] })); await onDone?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return <div className="catalog-transfer-flow">
    <section className="card catalog-step">
      <div className="catalog-step-title"><span>1</span><div><h3>Chọn phạm vi đang phụ trách</h3><p>Chọn nhân viên hiện tại, sau đó đánh dấu các cặp đơn vị – mã QLNB cần chuyển.</p></div></div>
      <div className="filter-grid catalog-transfer-filters">
        <label><span>Nhân viên hiện tại</span><select value={form.from_emp_code} onChange={(e) => { set('from_emp_code', e.target.value); setForm((x) => ({ ...x, from_emp_code: e.target.value, values: [] })); }}><option value="">Chọn mã NV</option>{employees.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Tuyến</span><select value={route} onChange={(e) => setRoute(e.target.value)}><option value="">Tất cả CL/NCL/NT</option>{ROUTES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Tìm đơn vị hoặc QLNB</span><input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="Nhập tên/mã cần tìm" /></label>
      </div>
      {!form.from_emp_code ? <div className="catalog-callout">Hãy chọn nhân viên hiện tại để xem danh sách phụ trách.</div> : <div className="catalog-picker">
        <div className="catalog-picker-head"><b>{pickRows.length.toLocaleString('vi-VN')} kết quả đang hiển thị</b><div><button className="btn ghost" type="button" onClick={() => set('values', [...new Set([...form.values, ...pickRows.map((r) => r.value)])])}>Chọn tất cả đang lọc</button><button className="btn ghost" type="button" onClick={() => set('values', [])}>Bỏ chọn</button></div></div>
        <div className="catalog-pick-list">{pickRows.map((row) => <label key={row.id} className={form.values.includes(row.value) ? 'selected' : ''}><input type="checkbox" checked={form.values.includes(row.value)} onChange={() => toggleValue(row.value)} /><span><b>{routeOf(row)}</b> · {row.label}</span></label>)}</div>
        <div className="catalog-selected-count">Đã chọn <b>{form.values.length.toLocaleString('vi-VN')}</b> cặp đơn vị – QLNB</div>
      </div>}
    </section>

    <section className="card catalog-step">
      <div className="catalog-step-title"><span>2</span><div><h3>Chọn người nhận và kỳ hiệu lực</h3><p>Nhân viên chỉ thấy phạm vi của mình; không thấy danh tính người giao/nhận đối ứng.</p></div></div>
      <div className="filter-grid catalog-transfer-filters">
        <label><span>Nhân viên mới</span><select value={form.to_emp_code} onChange={(e) => set('to_emp_code', e.target.value)}><option value="">Chọn mã NV</option>{employees.filter((x) => x !== form.from_emp_code).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>Kỳ bắt đầu (MM.YYYY)</span><input value={hubToUi(form.effective_period)} onChange={(e) => set('effective_period', uiToHub(e.target.value))} placeholder="08.2026" /></label>
        <label><span>Lý do nội bộ</span><input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Chỉ CEO/admin nhìn thấy" /></label>
      </div>
    </section>

    <section className="card catalog-step">
      <div className="catalog-step-title"><span>3</span><div><h3>Kiểm tra và phê duyệt</h3><p>Chưa ghi dữ liệu cho đến khi bấm Xem trước rồi chọn ✅ Duyệt.</p></div></div>
      <button className="btn" disabled={busy} onClick={makePreview}>Xem trước điều chuyển</button>
      {preview && <div className="catalog-preview">
        <div><small>Phạm vi hiện tại</small><b>{form.from_emp_code} · {preview.before.length} cặp</b><span>{preview.before.slice(0, 3).map((x) => x.label).join(' | ')}{preview.before.length > 3 ? ` · +${preview.before.length - 3} cặp` : ''}</span></div>
        <div className="catalog-preview-arrow">→</div>
        <div><small>Hiệu lực mới</small><b>{preview.after_emp} · {preview.before.length} cặp</b><span>Từ kỳ {hubToUi(preview.effective_from)}</span></div>
        <p>⚠ Kiểm tra đúng nhân viên, phạm vi và kỳ trước khi duyệt.</p>
        <div className="catalog-approval-actions" aria-label="Phê duyệt điều chuyển">
          <button className="btn" disabled={busy || meta?.readOnly} onClick={submit}>{busy ? 'Đang gửi…' : '✅ Duyệt'}</button>
          <button className="btn ghost" disabled={busy} onClick={() => { setPreview(null); setMessage('Đã dừng, không gửi Data Hub.'); }}>❌ Không duyệt</button>
          <button className="btn ghost" disabled={busy} onClick={() => { setPreview(null); setMessage('Hãy cập nhật phần lựa chọn hoặc lý do rồi xem trước lại.'); }}>📝 Ý kiến khác</button>
        </div>
        {meta?.readOnly && <div className="meta muted">Nguồn hiện ở chế độ chỉ đọc nên không thể gửi điều chuyển.</div>}
      </div>}
      {error && <div className="catalog-alert error">⚠ {error}</div>}{message && <div className="catalog-alert success">✓ {message}</div>}
    </section>
  </div>;
}

const REPORT_DEFAULTS = {
  emp_codes: [], provinces: [], routes: [], units: [], contractors: [], qlnb_codes: [], query: '',
  cst_band: 'all', dormant_status: 'all', review_status: 'all', c30_status: 'all',
};
const compactNumber = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const percentText = (value) => value == null ? '—' : `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

function uniqueReportOptions(rows, key, label) {
  const seen = new Map();
  for (const row of rows || []) {
    const value = String(row?.[key] || '').trim();
    if (!value) continue;
    const title = label ? label(row, value) : value;
    if (!seen.has(value)) seen.set(value, { key: value, label: title });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}

function ReportMultiFilter({ label, values, options, onChange, searchPlaceholder }) {
  const [query, setQuery] = useState('');
  const selected = new Set(values || []);
  const normalized = normalizeSearch(query);
  const shown = (options || []).filter((item) => !normalized || normalizeSearch(`${item.key} ${item.label}`).includes(normalized));
  const toggle = (key) => onChange(selected.has(key) ? values.filter((value) => value !== key) : [...values, key]);
  const summary = selected.size ? `${selected.size} đã chọn` : `Tất cả (${(options || []).length})`;
  return <details className="catalog-report-multi">
    <summary><span>{label}</span><b>{summary}</b></summary>
    <div className="catalog-report-multi-menu">
      {(options || []).length > 8 && <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder || `Tìm ${label.toLowerCase()}…`} />}
      <div className="catalog-report-multi-actions"><button type="button" onClick={() => onChange((options || []).map((item) => item.key))}>Chọn tất cả</button><button type="button" onClick={() => onChange([])}>Dùng tất cả</button></div>
      <div className="catalog-report-checks">{shown.map((item) => <label key={item.key} className={selected.has(item.key) ? 'selected' : ''}><input type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)} /><span><b>{item.key}</b>{item.label !== item.key && <small>{item.label}</small>}</span></label>)}</div>
      {!shown.length && <div className="muted catalog-empty">Không tìm thấy lựa chọn phù hợp.</div>}
    </div>
  </details>;
}

function ReportPanel({ period, rows }) {
  const [form, setForm] = useState(REPORT_DEFAULTS);
  const [preview, setPreview] = useState(null);
  const [deliveryPreview, setDeliveryPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const previewRequestRef = useRef(0);
  const deliveryRequestRef = useRef(0);
  const options = useMemo(() => ({
    employees: uniqueReportOptions(rows, 'emp_code', (row, value) => `${value} · ${row.emp_name || value}`),
    provinces: uniqueReportOptions(rows, 'province'),
    routes: uniqueReportOptions(rows, 'route'),
    units: uniqueReportOptions(rows, 'unit_code'),
    contractors: uniqueReportOptions(rows, 'contractor_code'),
    qlnb: uniqueReportOptions(rows, 'qlnb_code', (row, value) => `${value} · ${row.product_name || value}`),
  }), [rows]);
  useEffect(() => {
    previewRequestRef.current += 1; deliveryRequestRef.current += 1;
    setBusy(false); setDeliveryBusy(false); setForm(REPORT_DEFAULTS); setPreview(null); setDeliveryPreview(null); setError(''); setMessage('');
  }, [period]);
  const set = (key, value) => {
    previewRequestRef.current += 1; deliveryRequestRef.current += 1;
    setBusy(false); setDeliveryBusy(false); setForm((current) => ({ ...current, [key]: value })); setPreview(null); setDeliveryPreview(null); setError(''); setMessage('');
  };
  const resetFilters = () => {
    previewRequestRef.current += 1; deliveryRequestRef.current += 1;
    setBusy(false); setDeliveryBusy(false); setForm(REPORT_DEFAULTS); setPreview(null); setDeliveryPreview(null); setError(''); setMessage('');
  };
  const payload = useMemo(() => ({ period, ...form }), [period, form]);
  async function makePreview() {
    const requestId = ++previewRequestRef.current;
    const requestPayload = payload;
    deliveryRequestRef.current += 1;
    setBusy(true); setDeliveryBusy(false); setError(''); setMessage(''); setPreview(null); setDeliveryPreview(null);
    try {
      const result = await api.adminCatalogManagementReportPreview(requestPayload);
      if (requestId === previewRequestRef.current) setPreview(result);
    } catch (requestError) {
      if (requestId === previewRequestRef.current) setError(requestError.message);
    } finally {
      if (requestId === previewRequestRef.current) setBusy(false);
    }
  }
  async function makeDeliveryPreview() {
    if (!preview) return;
    const requestId = ++deliveryRequestRef.current;
    const requestPayload = { ...payload, channels: { email: true, telegram: true } };
    setDeliveryBusy(true); setError(''); setMessage(''); setDeliveryPreview(null);
    try {
      const result = await api.adminCatalogManagementDeliveryPreview(requestPayload);
      if (requestId === deliveryRequestRef.current) setDeliveryPreview(result);
    } catch (requestError) {
      if (requestId === deliveryRequestRef.current) setError(requestError.message);
    } finally {
      if (requestId === deliveryRequestRef.current) setDeliveryBusy(false);
    }
  }
  const exportPayload = preview ? { ...preview.filters, preview_id: preview.preview_id } : null;
  async function downloadEmployee(empCode) {
    if (!exportPayload) return;
    setDownloading(empCode); setError(''); setMessage('');
    try { await downloadFilteredEmployeeReport(empCode, exportPayload); setMessage(`Đã tạo file cá nhân ${empCode}. Không có email/Telegram nào được gửi.`); }
    catch (downloadError) { setError(downloadError.message); }
    setDownloading('');
  }
  async function downloadSummary() {
    if (!exportPayload) return;
    setDownloading('summary'); setError(''); setMessage('');
    try { await downloadFilteredEmployeeSummary(exportPayload); setMessage('Đã tạo file tổng hợp CEO. Không có email/Telegram nào được gửi.'); }
    catch (downloadError) { setError(downloadError.message); }
    setDownloading('');
  }
  const selectedFilterCount = Object.entries(form).filter(([key, value]) => key !== 'query' ? (Array.isArray(value) ? value.length : value !== 'all') : !!value).length;
  return <div className="catalog-report-flow">
    <section className="card catalog-report-intro">
      <div><span className="catalog-report-icon" aria-hidden="true">📊</span><div><h3>Lập báo cáo cá nhân theo bộ lọc</h3><p>Mỗi nhân viên được tách thành một file riêng, chỉ chứa dữ liệu trong phạm vi họ phụ trách.</p></div></div>
      <strong>XEM TRƯỚC / XUẤT FILE / PREVIEW GỬI · CHƯA GỬI THẬT</strong>
    </section>

    <section className="card catalog-report-filters">
      <div className="catalog-step-title"><span>1</span><div><h3>Chọn người và phạm vi</h3><p>Để trống danh sách chọn nghĩa là dùng tất cả giá trị trong phạm vi hiện tại.</p></div></div>
      <div className="catalog-report-filter-grid">
        <ReportMultiFilter label="Nhân viên" values={form.emp_codes} options={options.employees} onChange={(value) => set('emp_codes', value)} />
        <ReportMultiFilter label="Tỉnh/Thành" values={form.provinces} options={options.provinces} onChange={(value) => set('provinces', value)} />
        <ReportMultiFilter label="Tuyến" values={form.routes} options={options.routes} onChange={(value) => set('routes', value)} />
        <ReportMultiFilter label="Đơn vị" values={form.units} options={options.units} onChange={(value) => set('units', value)} />
        <ReportMultiFilter label="Nhà thầu" values={form.contractors} options={options.contractors} onChange={(value) => set('contractors', value)} />
        <ReportMultiFilter label="Mã QLNB" values={form.qlnb_codes} options={options.qlnb} onChange={(value) => set('qlnb_codes', value)} />
      </div>
      <div className="catalog-report-select-grid">
        <label><span>Tìm kiếm</span><input value={form.query} onChange={(event) => set('query', event.target.value)} placeholder="Tên thuốc, hoạt chất, đơn vị, QLNB…" /></label>
        <label><span>Mức CST còn lại</span><select value={form.cst_band} onChange={(event) => set('cst_band', event.target.value)}><option value="all">Tất cả mức CST</option><option value="missing">Chưa có CST</option><option value="le10">≤ 10%</option><option value="10_30">Trên 10% đến 30%</option><option value="gt30">Trên 30%</option><option value="full">Còn gần nguyên ≥ 99,5%</option></select></label>
        <label><span>Phát sinh 60 ngày</span><select value={form.dormant_status} onChange={(event) => set('dormant_status', event.target.value)}><option value="all">Tất cả trạng thái</option><option value="dormant">Ngủ đông ≥ 60 ngày</option><option value="not_activated">Chưa kích hoạt</option><option value="normal">Đang hoạt động</option></select></label>
        <label><span>Trạng thái review</span><select value={form.review_status} onChange={(event) => set('review_status', event.target.value)}><option value="all">Tất cả review</option><option value="unplanned">Chưa lập kế hoạch</option><option value="in_progress">Đang triển khai</option><option value="upcoming">Sắp đến hạn</option><option value="due">Đến hạn</option><option value="overdue">Quá hạn</option></select></label>
        <label><span>C30</span><select value={form.c30_status} onChange={(event) => set('c30_status', event.target.value)}><option value="all">Tất cả C30</option><option value="available">Có tùy chọn C30</option><option value="actionable">C30 cần hành động</option><option value="none">Không có C30</option></select></label>
      </div>
      <div className="catalog-report-filter-footer"><span>{selectedFilterCount ? `${selectedFilterCount} nhóm lọc đang áp dụng` : 'Đang dùng toàn bộ phạm vi được giao'}</span><button type="button" className="btn ghost" onClick={resetFilters}>Xóa bộ lọc</button></div>
    </section>

    <section className="card catalog-report-preview-step">
      <div className="catalog-step-title"><span>2</span><div><h3>Xem trước bắt buộc</h3><p>Hệ thống kiểm lại số báo cáo, số dòng và khóa phạm vi trước khi cho tải file.</p></div></div>
      <button type="button" className="btn catalog-report-preview-button" disabled={busy} onClick={makePreview}>{busy ? 'Đang kiểm tra dữ liệu…' : '👁 Xem trước phạm vi báo cáo'}</button>
      {preview && <div className="catalog-report-preview">
        <div className="catalog-report-kpis"><div><small>NV đã chọn</small><b>{compactNumber(preview.selected_employees)}</b></div><div><small>Báo cáo có dữ liệu</small><b>{compactNumber(preview.total_employees)}</b></div><div><small>Tổng dòng sau lọc</small><b>{compactNumber(preview.total_rows)}</b></div><div><small>Không có dòng</small><b>{compactNumber(preview.empty_employees)}</b></div></div>
        <p><b>Phạm vi:</b> {preview.filter_text}</p>
        <div className="catalog-report-safety">🔒 Server đã tách dữ liệu theo từng mã nhân viên. File cá nhân không có CP Total, chi phí, lợi nhuận hoặc margin.</div>
        {preview.c30_source && !preview.c30_source.ready && <div className="catalog-report-source-warning">⚠ Nguồn C30 chưa sẵn sàng nên cột C30 để trống; hệ thống không suy diễn thành “không có C30”.</div>}
      </div>}
      {error && <div className="catalog-alert error">⚠ {error}</div>}{message && <div className="catalog-alert success">✓ {message}</div>}
    </section>

    {preview && <section className="card catalog-report-results">
      <div className="catalog-step-title"><span>3</span><div><h3>Xuất báo cáo</h3><p>File tổng hợp dành cho CEO; file cá nhân chỉ có dữ liệu đúng người. Không có nút gửi thật trong màn hình này.</p></div></div>
      <div className="catalog-report-summary-download"><div><b>Tổng hợp CEO</b><span>{preview.total_employees} nhân viên · {preview.total_rows.toLocaleString('vi-VN')} dòng</span></div><button type="button" className="btn" disabled={!preview.total_employees || !!downloading} onClick={downloadSummary}>{downloading === 'summary' ? 'Đang tạo…' : '⬇ Tải tổng hợp CEO'}</button></div>
      <div className="catalog-report-employee-list">{preview.employees.map((employee) => <article key={employee.emp_code} className={!employee.exportable ? 'is-empty' : ''}>
        <div className="catalog-report-employee-head"><div><b>{employee.emp_code} · {employee.emp_name}</b><span>{employee.row_count.toLocaleString('vi-VN')} dòng · {employee.unit_count} đơn vị · {employee.qlnb_count} QLNB</span></div><button type="button" className="btn ghost" disabled={!employee.exportable || !!downloading} onClick={() => downloadEmployee(employee.emp_code)}>{!employee.exportable ? 'Không có dữ liệu' : downloading === employee.emp_code ? 'Đang tạo…' : '⬇ Tải file cá nhân'}</button></div>
        {employee.exportable && <div className="catalog-report-employee-metrics"><span>CST còn <b>{percentText(employee.cst_remaining_pct)}</b></span><span>Ngủ đông <b>{employee.dormant_count}</b></span><span>Chưa kích hoạt <b>{employee.not_activated_count}</b></span><span>Review đến/quá hạn <b>{employee.review_due_count}</b></span><span>Target đạt <b>{percentText(employee.target_pct)}</b></span></div>}
      </article>)}</div>
    </section>}

    {preview && <section className="card catalog-delivery-preview-step">
      <div className="catalog-step-title"><span>4</span><div><h3>Preview gửi riêng</h3><p>Hệ thống dựng đúng file sẽ gửi, khóa checksum và người nhận. Bước này tuyệt đối chưa gửi email/Telegram.</p></div></div>
      <div className="catalog-delivery-exclusions"><b>Không bao giờ gửi:</b> DN021 · DN023 · VP004 · VP018</div>
      <button type="button" className="btn catalog-report-preview-button" disabled={deliveryBusy || !preview.total_employees} onClick={makeDeliveryPreview}>{deliveryBusy ? 'Đang dựng file và khóa checksum…' : '🔐 Lập preview người nhận & file gửi'}</button>
      {deliveryPreview && <div className="catalog-delivery-preview">
        <div className="catalog-report-kpis"><div><small>Người nhận</small><b>{deliveryPreview.summary.recipients}</b></div><div><small>File cá nhân</small><b>{deliveryPreview.summary.files}</b></div><div><small>Email dự kiến</small><b>{deliveryPreview.summary.email}</b></div><div><small>Telegram dự kiến</small><b>{deliveryPreview.summary.telegram}</b></div></div>
        <div className="catalog-report-safety">🔒 Mỗi file đã khóa SHA-256 và đúng một mã nhân viên. Gửi thật vẫn đang khóa, cần Sếp duyệt lần hai.</div>
        {!!deliveryPreview.summary.missing_telegram?.length && <div className="catalog-report-source-warning">Telegram chưa mapping: {deliveryPreview.summary.missing_telegram.join(', ')} — các mã này chỉ nhận email.</div>}
        <div className="catalog-delivery-list">{deliveryPreview.recipients.map((recipient) => <article key={recipient.emp_code}><div><b>{recipient.emp_code} · {recipient.name}</b><span>{recipient.file?.row_count || 0} dòng · {recipient.file?.unit_count || 0} đơn vị · SHA {String(recipient.file?.sha256 || '').slice(0, 12)}…</span></div><div className="catalog-delivery-channels"><i className={recipient.email_planned ? 'ready' : 'missing'}>✉ {recipient.email_masked || 'Thiếu email'}</i><i className={recipient.telegram_planned ? 'ready' : 'missing'}>Telegram {recipient.telegram_fingerprint || 'chưa mapping'}</i></div></article>)}</div>
        <small className="catalog-delivery-expiry">Preview hết hạn: {dateText(deliveryPreview.expires_at)} · Trạng thái: {deliveryPreview.send_enabled ? 'Đã mở quyền gửi tạm thời' : 'Chưa mở quyền gửi thật'}</small>
      </div>}
    </section>}
  </div>;
}

/** Nhật ký: quyền cũ (mảng cột) lẫn quyền mới (ma trận cột→nhóm) đều đọc được. */
function auditColumnsText(value) {
  if (Array.isArray(value)) return value.map((c) => String(c).toUpperCase()).join('+') || '(không thấy gì)';
  const entries = Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return '(không thấy gì)';
  return entries.map(([key, scope]) => `${key.toUpperCase()}(${Array.isArray(scope) && scope.includes(ALL_UNITS) ? 'mọi nhóm' : (scope || []).join(',')})`).join(' + ');
}

function Catalog52ControlPlane({ period }) {
  const [status, setStatus] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const hubPeriod = uiToHub(period);
  const load = async () => {
    setBusy('load'); setError('');
    try {
      const next = await api.catalog52Status(hubPeriod);
      setStatus(next);
      if (next?.active?.manifestId) setPage(await api.catalog52Rows({ period: hubPeriod, manifestId: next.active.manifestId }));
      else setPage(null);
    } catch (loadError) { setError(loadError.message); }
    finally { setBusy(''); }
  };
  useEffect(() => { load(); }, [hubPeriod]);
  const syncPreview = async () => {
    setBusy('sync'); setError('');
    try { const result = await api.catalog52SyncPreview(hubPeriod); setCandidate(result.manifest); }
    catch (syncError) { setError(syncError.message); }
    finally { setBusy(''); }
  };
  const activate = async () => {
    if (!candidate?.manifestId) return;
    setBusy('activate'); setError('');
    try { await api.catalog52Activate(hubPeriod, candidate.manifestId); setCandidate(null); await load(); }
    catch (activateError) { setError(activateError.message); }
    finally { setBusy(''); }
  };
  const rollback = async () => {
    setBusy('rollback'); setError('');
    try { await api.catalog52Rollback(hubPeriod); await load(); }
    catch (rollbackError) { setError(rollbackError.message); }
    finally { setBusy(''); }
  };
  const active = status?.active;
  return <details className="card catalog52-control-plane">
    <summary>🔐 CP Total 52 cột (CEO)</summary>
    <p className="muted">Control plane chỉ đọc snapshot backend bất biến. Đóng tab không ảnh hưởng các màn khác; đợt này chưa có export full 52.</p>
    {error && <div className="catalog-alert error">⚠ {error}</div>}
    <div className="catalog52-meta">
      <span>Kỳ <b>{hubPeriod}</b></span><span>Active <b>{active?.sourceVersion || 'Chưa có'}</b></span>
      <span>Dòng <b>{Number(active?.rowCount || 0).toLocaleString('vi-VN')}</b></span>
      <span>Manifest <b>{active?.manifestId || '—'}</b></span>
    </div>
    <div className="catalog52-actions">
      <button type="button" className="btn" disabled={!!busy} onClick={syncPreview}>{busy === 'sync' ? 'Đang kiểm tra…' : 'Đồng bộ toàn bộ · tạo preview'}</button>
      <button type="button" className="btn" disabled={!!busy || !candidate?.manifestId} onClick={activate}>Kích hoạt preview đã kiểm</button>
      <button type="button" className="btn ghost" disabled={!!busy || !status?.lastKnownGoodManifestId || status.lastKnownGoodManifestId === active?.manifestId} onClick={rollback}>Rollback LKG</button>
    </div>
    {candidate && <div className="catalog-alert success">✓ Candidate {candidate.sourceVersion} · {candidate.rowCount.toLocaleString('vi-VN')} dòng · chưa kích hoạt · mapping conflict {candidate.mappingConflicts}</div>}
    {page?.rows?.length > 0 && <div className="table-scroll"><table className="catalog-table catalog52-table"><thead><tr><th>Line ID</th>{Array.from({ length: 52 }, (_, index) => <th key={index}>C{index + 1}</th>)}</tr></thead><tbody>{page.rows.map((row) => <tr key={row.sourceLineId}><td>{row.sourceLineId}</td>{Array.from({ length: 52 }, (_, index) => <td key={index}>{String(row[`c${index + 1}`] ?? '—')}</td>)}</tr>)}</tbody></table></div>}
  </details>;
}

/**
 * MÀN CHI TIẾT QUYỀN CỦA MỘT NHÂN VIÊN (CEO yêu cầu 09/08/2026)
 *
 * CEO: *"chọn theo nhân viên rồi có màn hình phụ cho liệt kê các đơn vị, các cột để
 * tích theo cột, theo nhóm mã đơn vị… thì sẽ rõ và làm nhanh hơn."*
 *
 * Lưới: HÀNG = nhóm mã đơn vị (001 · 033 · 120…), CỘT = C36…C45. Tick ở cấp NHÓM
 * mã số (không phải loại đơn vị), mỗi hàng liệt kê các mã bên trong để thấy rõ đang
 * mở cho đơn vị nào. Hàng "Mọi nhóm" trên đầu bật/tắt cả cột; nút cuối mỗi hàng bật/tắt cả hàng.
 */
function EmployeeGrantDetail({ row, columns, onBack, onChange, groupsError = '', onRetryGroups }) {
  if (!row) return null;
  const keys = columns.map((column) => column.key);
  const set = (fn) => onChange((cur) => fn(cur));
  return <div className="catalog-grant-detail">
    <div className="catalog-grant-detail-head">
      <button type="button" className="btn ghost" onClick={onBack}>‹ Danh sách nhân viên</button>
      <div>
        <b>{row.empCode}{row.name ? ` · ${row.name}` : ''}</b>
        <small>{row.availableGroups.length} nhóm · {row.availableUnits.length} đơn vị đang phụ trách</small>
      </div>
      <button type="button" className="btn ghost"
        onClick={() => set((cur) => keys.reduce((acc, key) => setColumnAllGroups(acc, row.empCode, key, false), cur))}>
        Tắt hết cho NV này
      </button>
    </div>

    {/* ‼ CHƯA HỎI ĐƯỢC MÁY CHỦ ≠ ĐƠN VỊ THIẾU NHÓM (CEO không hiểu nổi hai khung đỏ,
        09/08 23:59). Bảng "mã đơn vị → nhóm" tải hỏng ⇒ mọi NV hiện 0 nhóm; bản cũ
        vẫn ghi "chưa có đơn vị nào nhận diện được nhóm" — đổ tội cho DỮ LIỆU trong
        khi mã 007/008/015 rõ ràng có nhóm. Nói sai nguyên nhân thì CEO đi sửa nhầm
        chỗ, và ngồi nghi ngờ chính dữ liệu của mình. */}
    {!row.availableGroups.length ? (groupsError
      ? <div className="catalog-alert error" role="alert">
        ⛔ <b>Chưa hỏi được máy chủ bảng "mã đơn vị → nhóm"</b> ({groupsError}) — nên màn này hiện <b>0 nhóm</b>.
        {' '}<b>KHÔNG phải {row.empCode} thiếu nhóm</b>: các mã như {row.availableUnits.slice(0, 2).join(', ') || '007.…'} vốn có nhóm.
        {' '}Bấm <b>Thử lại</b> rồi mở lại nhân viên này; chưa thử lại được thì <b>đừng cấp quyền</b> vì lưới nhóm đang trống.
        {onRetryGroups && <div className="catalog-grant-retry">
          <button type="button" className="btn" onClick={onRetryGroups}>↻ Thử lại</button>
        </div>}
      </div>
      : <div className="catalog-alert error" role="alert">
        Nhân viên này chưa có đơn vị nào nhận diện được nhóm — chưa cấp theo nhóm được.
        {' '}Nếu MỌI nhân viên đều báo 0 nhóm thì đây không phải lỗi dữ liệu: xem cảnh báo đỏ ở đầu menu.
      </div>) : <div className="table-scroll"><table className="catalog-table catalog-table-simple catalog-grant-grid">
      {/* Mỗi cột có nút bật/tắt CẢ CỘT, cân đối với nút "Chọn hết" ở cuối mỗi hàng.
          CEO 09/08/2026: "cho chọn hết tất cả theo cột, ví dụ DN001 chọn hết tất cả
          cột C41, thay vì phải đi tích từng dòng một."
          ‼ Việc này vốn đã làm được bằng ô tích ở hàng "Mọi nhóm", nhưng nhãn đó
          không đọc ra thành thao tác nên không ai thấy. Nút này CHÍNH LÀ ô tích đó
          (cùng gọi `setColumnAllGroups`), chỉ là nói bằng tiếng người. */}
      <thead><tr>
        <th>Nhóm mã đơn vị</th>
        {columns.map((column) => {
          const columnOn = isColumnAllGroups(row, column.key);
          return <th key={column.key} title={column.label} className="catalog-grant-colhead">
            <span>{column.key.toUpperCase()}</span>
            <button type="button" className="btn ghost catalog-grant-colbtn"
              title={columnOn ? `Bỏ ${column.key.toUpperCase()} ở mọi nhóm` : `Cấp ${column.key.toUpperCase()} ở mọi nhóm, gồm cả nhóm mới sau này`}
              onClick={() => set((cur) => setColumnAllGroups(cur, row.empCode, column.key, !columnOn))}>
              {columnOn ? 'Bỏ cả cột' : 'Chọn cả cột'}
            </button>
          </th>;
        })}
        <th>Cả hàng</th>
      </tr></thead>
      <tbody>
        <tr className="catalog-grant-allrow">
          <td><b>Mọi nhóm</b><small>gồm cả nhóm mới sau này</small></td>
          {columns.map((column) => <td key={column.key} className="catalog-grants-cell">
            <input type="checkbox" aria-label={`${column.key.toUpperCase()} cho mọi nhóm`}
              checked={isColumnAllGroups(row, column.key)}
              onChange={(e) => set((cur) => setColumnAllGroups(cur, row.empCode, column.key, e.target.checked))} />
          </td>)}
          <td />
        </tr>
        {row.availableGroups.map((group) => {
          const rowOn = keys.every((key) => isGroupChecked(row, key, group.key));
          return <tr key={group.key}>
            <td>
              <b>{group.label}</b>
              <small>{group.unitCount} đơn vị</small>
              <em className="catalog-grant-units">{group.units.join(' · ')}</em>
            </td>
            {columns.map((column) => <td key={column.key} className="catalog-grants-cell">
              <input type="checkbox" aria-label={`${column.key.toUpperCase()} cho nhóm ${group.key}`}
                checked={isGroupChecked(row, column.key, group.key)}
                onChange={() => set((cur) => toggleColumnGroup(cur, row.empCode, column.key, group.key))} />
            </td>)}
            <td className="catalog-grants-cell">
              <button type="button" className="btn ghost catalog-grant-rowbtn"
                onClick={() => set((cur) => toggleGroupAllColumns(cur, row.empCode, group.key, keys, !rowOn))}>
                {rowOn ? 'Bỏ hết' : 'Chọn hết'}
              </button>
            </td>
          </tr>;
        })}
      </tbody>
    </table></div>}

    {!!row.ungroupedUnits.length && !groupsError && <div className="catalog-alert error" role="status">
      ⚠ {row.ungroupedUnits.length} đơn vị chưa nhận diện được nhóm ({row.ungroupedUnits.slice(0, 5).join(', ')}{row.ungroupedUnits.length > 5 ? '…' : ''}) — chỉ hàng <b>"Mọi nhóm"</b> mới phủ tới các đơn vị này.
    </div>}
    <div className="catalog-grant-detail-foot"><b>Đang cấp:</b> {grantSummary(row)}</div>
  </div>;
}

/**
 * MENU PHÂN QUYỀN CỘT % CHI PHÍ — CHỈ CEO (SPEC_CATALOG_COST_COLUMNS.md)
 * CEO chốt 06/08/2026: *"chỉ CEO mới quản lý ai được xem cột nào… không ai khác."*
 * Nút này chỉ hiện với tài khoản CEO; backend vẫn chặn độc lập bằng `requireCeo`
 * — ẩn nút KHÔNG phải lớp bảo vệ.
 */
/**
 * KHỐI "CẦN RÀ PHÂN QUYỀN" — vá lỗ hổng CEO chỉ ra 09/08/2026.
 *
 * CEO: *"hôm sau xuất hiện thêm mã đơn vị mới giao cho DN001/DN002… hôm sau anh
 * chuyển NV phụ trách mã QLNB của mã đơn vị này cho NV khác… vậy vào đâu để bấm
 * cập nhật phân quyền?"* — Trước bản này: KHÔNG CÓ CHỖ NÀO. Quyền lệch âm thầm,
 * NV chỉ thấy ô '—' và CEO chỉ biết khi có người kêu.
 *
 * ‼ CEO chốt: app CHỈ BÁO, KHÔNG TỰ CẤP. Nút "Cấp giống DN00x" chỉ điền sẵn vào
 * bảng đang sửa; vẫn phải bấm "Lưu thay đổi" như mọi thao tác khác. Không có
 * đường nào để quyền xem số chi phí tự mở mà CEO không bấm.
 */
const REVIEW_LIMIT = 25;
function GrantReviewBoard({ review, onOpen, onApply }) {
  const { needsGrant, staleGrant, neverConfigured, counts } = review;
  if (!counts.needsGrant && !counts.staleGrant) {
    return <div className="catalog-review is-clean" role="status">
      ✅ Phân quyền đang khớp với danh mục hiện hành — không có chỗ nào lệch.
      {!!counts.neverConfigured && <small> {counts.neverConfigured} NV chưa cấp cột nào (đúng mặc định "không thấy cột % nào").</small>}
    </div>;
  }
  return <div className="catalog-review" role="status">
    <div className="catalog-review-head">
      <b>⚠ Cần rà phân quyền</b>
      <small>
        Danh mục đã đổi so với lúc cấp quyền. Đây là chỗ để bấm cập nhật —
        app <b>không tự cấp</b> gì, mọi thay đổi vẫn phải bấm “Lưu thay đổi”.
      </small>
    </div>

    {!!counts.needsGrant && <div className="catalog-review-group">
      <div className="catalog-review-title">
        {counts.needsGrant} chỗ NV đang phụ trách mà <b>chưa được cấp cột nào</b>
        {!!counts.newGroups && <em> · trong đó {counts.newGroups} nhóm mã hoàn toàn mới</em>}
      </div>
      <ul>
        {needsGrant.slice(0, REVIEW_LIMIT).map((item) => <li key={`${item.empCode}|${item.groupKey}`}>
          <span className="catalog-review-what">
            <b>{item.empCode}</b>{item.name ? ` · ${item.name}` : ''} — nhóm <b>{item.groupLabel}</b>
            <small>{item.unitCount} đơn vị: {item.units.join(' · ')}</small>
          </span>
          <span className="catalog-review-act">
            {item.isNewGroup
              ? <em title="Cả công ty chưa ai được cấp ở nhóm này — không có ai để lấy mẫu">nhóm mới, chưa có mẫu</em>
              : item.suggestions.slice(0, 2).map((suggestion) => <button type="button" key={suggestion.empCode}
                className="btn ghost catalog-review-btn"
                title={`Cấp cho ${item.empCode} đúng ${suggestion.columns.map((c) => c.toUpperCase()).join(', ')} mà ${suggestion.empCode} đang có ở nhóm ${item.groupKey} — vẫn phải bấm Lưu`}
                onClick={() => onApply(item, suggestion)}>
                Cấp giống {suggestion.empCode} ({suggestion.columns.map((c) => c.toUpperCase()).join(', ')})
              </button>)}
            <button type="button" className="btn ghost catalog-review-btn" onClick={() => onOpen(item.empCode)}>Mở NV này ›</button>
          </span>
        </li>)}
      </ul>
      {needsGrant.length > REVIEW_LIMIT && <small className="muted">Hiện {REVIEW_LIMIT}/{needsGrant.length} chỗ — xử lý xong lượt này sẽ hiện tiếp.</small>}
    </div>}

    {!!counts.staleGrant && <div className="catalog-review-group">
      <div className="catalog-review-title">
        {counts.staleGrant} chỗ <b>quyền thừa</b> — NV không còn phụ trách nhóm này nữa
        <em> · không lộ số (bảng vẫn lọc theo phụ trách), nhưng nên dọn</em>
      </div>
      <ul>
        {staleGrant.slice(0, REVIEW_LIMIT).map((item) => <li key={`${item.empCode}|${item.groupKey}`}>
          <span className="catalog-review-what">
            <b>{item.empCode}</b>{item.name ? ` · ${item.name}` : ''} — còn {item.columns.map((c) => c.toUpperCase()).join(', ')} ở nhóm <b>{item.groupKey}</b>
          </span>
          <span className="catalog-review-act">
            <button type="button" className="btn ghost catalog-review-btn" onClick={() => onOpen(item.empCode)}>Mở NV này ›</button>
          </span>
        </li>)}
      </ul>
      {staleGrant.length > REVIEW_LIMIT && <small className="muted">Hiện {REVIEW_LIMIT}/{staleGrant.length} chỗ.</small>}
    </div>}

    {!!counts.neverConfigured && <small className="catalog-review-foot">
      Ngoài ra {counts.neverConfigured} NV chưa cấp cột nào ({neverConfigured.slice(0, 6).map((item) => item.empCode).join(' · ')}
      {neverConfigured.length > 6 ? '…' : ''}) — đây là <b>mặc định đúng</b>, không phải lệch, nên không tính vào số việc trên.
    </small>}
  </div>;
}

function CostColumnGrantsPanel({ catalogRows, employees, unitGroups = null }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [bulk, setBulk] = useState([]);
  // Rỗng = hỏi được bảng nhóm bình thường; có chữ = KHÔNG hỏi được (xem chú thích ở load).
  const [groupsError, setGroupsError] = useState('');
  // Mã NV đang mở màn chi tiết; rỗng = đang ở danh sách.
  const [selected, setSelected] = useState('');

  // Trả về panel vừa dựng để nơi gọi KIỂM LẠI được (xem `save`).
  const load = async () => {
    setLoading(true); setError(''); setMessage('');
    try {
      // Bảng "đơn vị → nhóm" hỏi backend MỘT lần cho các mã distinct — cùng bộ
      // nhóm màn Chi phí đang dùng, không chép luật tách nhóm sang frontend.
      const distinctUnits = [...new Set((catalogRows || []).map((row) => String(row?.unit_code || '').trim()).filter(Boolean))];
      /* ‼ BẢNG TRA NHÓM ĐI KÈM DANH MỤC ⇒ KHÔNG GỌI MẠNG NỮA (CEO kẹt 3 lần 09–10/08).
         Máy chủ đã cầm sẵn mọi mã đơn vị khi trả danh mục, và nhóm chỉ là tiền tố
         trước dấu chấm — bắt trình duyệt gửi ngược cả nghìn mã lên để hỏi lại là tự
         dựng thêm một lượt gọi có thể trượt. Nó trượt thật ("Failed to fetch") và
         làm cả menu mù. Lượt gọi cũ chỉ còn là ĐƯỜNG LUI cho máy chủ bản cũ. */
      const inlineGroups = unitGroups && Object.keys(unitGroups).length ? unitGroups : null;
      /* ‼ TỰ THỬ LẠI — "Failed to fetch" là hụt mạng nhất thời (CEO gặp 09/08 23:59).
         Bảng "mã đơn vị → nhóm" hỏng MỘT lượt là cả menu phân quyền hiện 0 nhóm và
         CEO không cấp được gì. Bắt người dùng tự bấm "Thử lại" cho một cú trượt mạng
         là đẩy việc của máy sang cho người. Thử 3 lượt, nghỉ tăng dần; vẫn hỏng thì
         mới báo — lúc đó là hỏng thật, có nút bấm tay. */
      const withRetry = async (call, tries = 3) => {
        let lastError;
        for (let attempt = 0; attempt < tries; attempt += 1) {
          try { return await call(); }
          catch (error) {
            lastError = error;
            if (attempt < tries - 1) await new Promise((done) => setTimeout(done, 400 * (attempt + 1)));
          }
        }
        throw lastError;
      };
      /* Chia nhỏ danh sách mã: một lượt gọi ôm cả nghìn mã mà trượt là mất TOÀN BỘ
         bảng tra. Từng mẻ 400 mã, mẻ nào cũng có 3 lượt thử. Chỉ cần một mẻ hỏng hẳn
         thì coi như hỏng cả (fail-closed) — ghép nửa bảng tra sẽ khiến phần thiếu bị
         gán oan là "chưa có nhóm", đúng cái sai đang phải sửa. */
      const fetchUnitGroups = async (units) => {
        const CHUNK = 400;
        const batches = [];
        for (let at = 0; at < units.length; at += CHUNK) batches.push(units.slice(at, at + CHUNK));
        if (!batches.length) return { byUnit: {} };
        const parts = await Promise.all(batches.map((batch) => withRetry(() => api.catalogCostUnitGroups(batch))));
        return {
          byUnit: Object.assign({}, ...parts.map((part) => part.byUnit || {})),
          truncated: parts.some((part) => part.truncated),
          total: parts.reduce((sum, part) => sum + Number(part.total || 0), 0),
          resolved: parts.reduce((sum, part) => sum + Number(part.resolved || 0), 0),
        };
      };
      const [grants, rates, fetchedGroups] = await Promise.allSettled([
        api.catalogCostGrants(), api.catalogCostRates(),
        inlineGroups ? Promise.resolve({ byUnit: inlineGroups }) : fetchUnitGroups(distinctUnits),
      ]);
      if (grants.status !== 'fulfilled') throw new Error(grants.reason?.message || 'Không tải được phân quyền');
      const columns = rates.status === 'fulfilled' ? (rates.value.columns || []) : [];
      // ‼ PHÂN BIỆT HAI CHUYỆN KHÁC HẲN NHAU (CEO chụp màn 09/08, bản cũ nói dối):
      //   · backend trả bảng nhưng đơn vị không phân giải được nhóm  → lỗi DỮ LIỆU
      //   · KHÔNG HỎI ĐƯỢC backend (403/timeout/lỗi mạng)            → lỗi HỆ THỐNG
      // Bản cũ nuốt lỗi thành `{}` nên cả hai đều hiện "164 đơn vị chưa nhận diện
      // được nhóm" — đổ tội cho dữ liệu trong khi thật ra là chưa hỏi được ai.
      // Nói sai nguyên nhân còn tệ hơn không nói: CEO đi sửa nhầm chỗ.
      setGroupsError(fetchedGroups.status === 'fulfilled'
        ? (fetchedGroups.value.truncated ? `Danh mục có ${fetchedGroups.value.total} mã đơn vị, vượt trần ${fetchedGroups.value.resolved} — phần vượt đang hiện "0 nhóm" oan, báo Claude nâng trần` : '')
        : (fetchedGroups.reason?.message || 'Không hỏi được bảng "mã đơn vị → nhóm"'));
      const groupsByUnit = fetchedGroups.status === 'fulfilled' ? (fetchedGroups.value.byUnit || {}) : {};
      const built = buildGrantPanel({ grants: grants.value.grants || [], columns, catalogRows, employees, groupsByUnit });
      setPanel(built);
      setAudit(grants.value.audit || []);
      return built;
    } catch (e) { setError(e.message); setPanel(null); return null; }
    finally { setLoading(false); }
  };
  useEffect(() => { if (open && !panel && !loading) load(); }, [open]);

  /**
   * Lưu rồi ĐỌC LẠI TỪ MÁY CHỦ để KIỂM (CEO lo 09/08/2026: *"tôi sợ phân quyền xong
   * vẫn bị lủng, không đúng mã đơn vị, không đúng cột thì nguy to"*).
   *
   * ‼ Lệnh ghi không ném lỗi KHÔNG có nghĩa là đã ghi đúng: backend chuẩn hoá lại
   * (loại nhóm không hợp lệ, bỏ cột không được phép) vẫn trả 200. Tin vào 200 là
   * tin vào lời hứa; đọc lại rồi so mới là bằng chứng.
   *
   * Khớp ⇒ báo hoàn thành + QUAY VỀ DANH SÁCH NV để CEO làm tiếp người kế (CEO:
   * *"đáng lẽ phải báo đã xác nhận hoàn thành và màn hình quay về trạng thái lúc
   * vào phân quyền để tiếp tục phân quyền nhân viên khác"*). Lệch ⇒ Ở LẠI màn đó,
   * nêu đích danh lệch ở đâu — không đưa người dùng đi khi số chưa đúng.
   */
  const save = async () => {
    if (!panel) return;
    setSaving(true); setError(''); setMessage('');
    const pending = dirtyRows(panel);
    const expected = new Map(pending.map((row) => [row.empCode, grantSavePayload(row).columns]));
    try {
      for (const row of pending) await api.catalogCostGrantSave(row.empCode, grantSavePayload(row));
      const fresh = await load();
      const check = verifySavedGrants(fresh, expected);
      if (!check.ok) {
        setError(`⛔ ĐÃ LƯU NHƯNG KIỂM LẠI THẤY LỆCH ${check.mismatches.length}/${check.checked} nhân viên — `
          + check.mismatches.map((item) => `${item.empCode}: cần "${item.wanted}" nhưng máy chủ đang giữ "${item.got}"`).join(' · ')
          + '. KHÔNG dùng phân quyền này cho tới khi sửa xong.');
        return;
      }
      const who = [...expected.keys()].join(', ');
      setMessage(`✅ Đã lưu và KIỂM LẠI TỪ MÁY CHỦ: đúng ${check.checked} nhân viên (${who}). Đang ở danh sách nhân viên — chọn người tiếp theo để cấp quyền.`);
      setSelected('');
    } catch (e) { setError(`${e.message} — các dòng chưa lưu vẫn còn nguyên, bấm Lưu lại sau khi xử lý.`); }
    finally { setSaving(false); }
  };

  const pending = panel ? dirtyRows(panel).length : 0;
  const review = useMemo(() => reviewGrants(panel), [panel]);
  const todo = review.counts.needsGrant + review.counts.staleGrant;
  return <div className="card catalog-grants">
    <div className="catalog-grants-head">
      <div>
        <div className="section-head">🔐 Phân quyền cột % chi phí
          {/* Số việc phải rà hiện NGAY trên đầu mục: danh mục đổi thì quyền lệch âm
              thầm, CEO không có cách nào biết nếu phải tự mở từng NV ra dò. */}
          {!!todo && <span className="catalog-grants-badge" title="Số chỗ phân quyền đang lệch so với danh mục hiện hành">{todo}</span>}
        </div>
        <p>Chỉ CEO đặt được. Mặc định mọi nhân viên <b>không thấy cột % nào</b>; bật từng cột và giới hạn theo <b>NHÓM MÃ đơn vị</b> (001 · 033 · 120…) — mỗi cột một phạm vi nhóm riêng, cấp nhóm nào thì các mã NV phụ trách trong nhóm đó cùng thấy.</p>
      </div>
      <button type="button" className="btn secondary" aria-expanded={open} aria-controls="catalog-grants-body" onClick={() => setOpen((v) => !v)}>
        {open ? 'Thu gọn' : 'Mở phân quyền'}
      </button>
    </div>
    {open && <div className="catalog-grants-body" id="catalog-grants-body">
      {error && <div className="catalog-alert error" role="alert">⚠ {error}</div>}
      {message && <div className="catalog-alert ok" role="status">{message}</div>}
      {/* ‼ Nút này gọi THẲNG `load()`. Bản đầu bảo người dùng "Thu gọn rồi Mở lại" —
          thao tác đó CHỈ đổi cờ `open`, còn `load()` có chốt `!panel` nên không chạy
          lại: hướng dẫn vô dụng, người làm theo vẫn thấy 0 nhóm (bot chặn Gate 2
          đúng, 09/08). Chỉ dẫn sai còn tệ hơn không chỉ dẫn — người ta làm theo,
          thất bại, rồi tin là app hỏng nặng hơn thực tế. */}
      {!!groupsError && <div className="catalog-alert error catalog-groups-error" role="alert">
        <div>
          ⛔ <b>Không hỏi được bảng "mã đơn vị → nhóm"</b> ({groupsError}). Vì thế mọi NV đang hiện
          <b> 0 nhóm</b> — <b>KHÔNG</b> phải đơn vị thiếu nhóm, mà là chưa hỏi được máy chủ.
          Còn lỗi sau khi thử lại thì báo bot kiểm <code>POST /catalog-management/cost-columns/unit-groups</code>.
        </div>
        <button type="button" className="btn" disabled={loading} onClick={() => load()}>
          {loading ? 'Đang thử lại…' : '↻ Thử lại'}
        </button>
      </div>}
      {loading || !panel ? <Spinner /> : <>
        {!panel.columns.length && <div className="catalog-alert error" role="alert">
          Chưa lấy được danh sách cột % từ nguồn chi phí — chưa cấp quyền được. Kiểm tra nguồn DataHub rồi mở lại.
        </div>}
        {!!panel.columns.length && <>
          {/* CEO 09/08: *"chọn theo nhân viên rồi có màn hình phụ cho liệt kê các đơn
              vị, các cột để tích"*. Bảng ma trận 21 NV × 7 cột nhét vào ô nhỏ là không
              làm chi tiết được — nay tách hai bước: chọn người → mở lưới đầy đủ. */}
          {!selected ? <>
            {/* ‼ BẢNG "VIỆC CẦN RÀ" PHẢI TẮT KHI BẢNG TRA NHÓM HỎNG (CEO bắt 10/08 00:02).
                Nó so quyền đã cấp với nhóm NV đang phụ trách. Bảng tra rỗng ⇒ mọi NV
                "0 nhóm" ⇒ nó kết luận TOÀN BỘ quyền đang cấp là "quyền thừa" và mời
                CEO đi dọn — dọn xong là mất sạch quyền ĐÚNG. Khuyên sai còn nguy hơn
                không khuyên gì. */}
            {groupsError
              ? <div className="catalog-alert error" role="alert">
                ⛔ <b>Tạm ẩn bảng "việc cần rà"</b> vì chưa hỏi được bảng "mã đơn vị → nhóm".
                {' '}Không có bảng tra thì mọi NV hiện <b>0 nhóm</b>, và mục này sẽ kết luận <b>SAI</b> rằng
                quyền đang cấp là "quyền thừa" — dọn theo là mất quyền đúng. Bấm <b>Thử lại</b> ở trên rồi xem lại.
              </div>
              : <GrantReviewBoard review={review} onOpen={setSelected}
              onApply={(item, suggestion) => setPanel((cur) => applySuggestion(cur, item.empCode, item.groupKey, suggestion.columns))} />}
            <div className="catalog-grants-bulk">
              <span>Áp nhanh cho nhiều người:</span>
              {panel.columns.map((column) => <label key={column.key}>
                <input type="checkbox" checked={bulk.includes(column.key)}
                  onChange={() => setBulk((cur) => (cur.includes(column.key) ? cur.filter((k) => k !== column.key) : [...cur, column.key]))} />
                {column.key.toUpperCase()}
              </label>)}
              <button type="button" className="btn ghost" disabled={saving}
                onClick={() => setPanel((cur) => applyColumnsToMany(cur, cur.rows.map((r) => r.empCode), bulk))}>
                Áp cho tất cả {panel.rows.length} NV
              </button>
              <button type="button" className="btn ghost" disabled={saving}
                onClick={() => setPanel((cur) => applyColumnsToMany(cur, cur.rows.map((r) => r.empCode), []))}>
                Tắt hết
              </button>
            </div>
            <div className="catalog-grant-list">
              {panel.rows.map((row) => {
                const counts = grantCounts(row);
                return <button type="button" key={row.empCode}
                  className={`catalog-grant-item${row.dirty ? ' is-dirty' : ''}`}
                  onClick={() => setSelected(row.empCode)}>
                  <span className="catalog-grant-who">
                    <b>{row.empCode}</b>{row.name ? <small>{row.name}</small> : null}
                  </span>
                  <span className="catalog-grant-scope">
                    <i>{row.availableGroups.length} nhóm · {row.availableUnits.length} đơn vị</i>
                    {/* Bảng tra hỏng ⇒ MỌI đơn vị đều "chưa có nhóm", kể cả 036.PKĐK
                        SÀI GÒN TÂM TRÍ vốn thuộc nhóm 036 rõ ràng. Im lặng ở đây và
                        nói MỘT LẦN ở cảnh báo đầu menu, thay vì lặp lại lời buộc tội
                        sai trên từng dòng (CEO bắt 10/08 00:02). */}
                    {!!row.ungroupedUnits.length && !groupsError && <em className="catalog-scope-warn" title={row.ungroupedUnits.join(', ')}>⚠ {row.ungroupedUnits.length} ĐV chưa có nhóm</em>}
                    {!!groupsError && <em className="catalog-scope-warn">⚠ chưa tra được nhóm</em>}
                  </span>
                  <span className={`catalog-grant-state${counts.columnCount ? ' is-on' : ''}`}>
                    {counts.columnCount ? grantSummary(row) : 'Không thấy cột % nào'}
                  </span>
                  <span className="catalog-grant-go" aria-hidden="true">Đặt quyền ›</span>
                </button>;
              })}
            </div>
          </> : <EmployeeGrantDetail
            row={panel.rows.find((item) => item.empCode === selected)}
            columns={panel.columns}
            onBack={() => setSelected('')}
            onChange={(fn) => setPanel(fn)}
            groupsError={groupsError}
            onRetryGroups={() => load()}
          />}
          <div className="catalog-grants-actions">
            <button type="button" className="btn" disabled={saving || !pending} onClick={save}>
              {saving ? 'Đang lưu…' : pending ? `Lưu ${pending} nhân viên` : 'Chưa có thay đổi'}
            </button>
            <button type="button" className="btn ghost" disabled={saving || !pending} onClick={load}>Huỷ thay đổi</button>
          </div>
        </>}
        {!!audit.length && <div className="catalog-grants-audit">
          <h4>Nhật ký thay đổi</h4>
          {audit.slice(0, 10).map((item, index) => <div key={`${item.at}-${index}`}>
            <span>{formatDateTime(item.at)}</span> · <b>{item.actor}</b> đổi cho <b>{item.empCode}</b>:
            {' '}{auditColumnsText(item.before?.columns)}
            {' → '}{auditColumnsText(item.after?.columns)}
          </div>)}
        </div>}
      </>}
    </div>}
  </div>;
}

/**
 * BẢNG % ĐẦY ĐỦ TỪ KHO CỤC BỘ (Đợt 2 — SPEC_COST_RATES_LOCAL_SYNC).
 * Backend tự lọc theo quyền: CEO thấy hết; NV chỉ cột được cấp × đơn vị trong
 * phạm vi × dòng có mình. DataHub chết vẫn xem được — đó là cả mục đích.
 */
function CostRatesTablePanel({ period }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  // Cùng luật với bảng danh mục: đổi kỳ thì GIỮ bảng cũ, không đập về vòng quay.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setBusy(true); setError('');
    api.catalogCostRatesTable({ period: uiToHub(period) })
      .then((result) => { if (alive) setData(result); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [open, period]);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    const q = normalizeSearch(query);
    if (!q) return data.rows;
    return data.rows.filter((row) => normalizeSearch(`${row.unitCode} ${row.productCode} ${row.productName} ${row.employees.join(' ')}`).includes(q));
  }, [data, query]);

  return <div className="card catalog-rates-panel">
    <div className="catalog-grants-head">
      <div>
        <div className="section-head">📊 Bảng % chi phí (kho cục bộ)</div>
        <p>Đọc từ bản đã đồng bộ — DataHub có sự cố vẫn xem được. Số % che/mở theo con mắt.</p>
      </div>
      <button type="button" className="btn secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Thu gọn' : 'Mở bảng %'}
      </button>
    </div>
    {open && <div className="catalog-rates-body">
      {error && <div className="catalog-alert error" role="alert">⚠ {error}</div>}
      {busy && !!data && <div className="catalog-loading-strip" role="status" aria-live="polite">
        <i className="catalog-loading-dot" aria-hidden="true" />
        <span>Đang tải bảng % kỳ <b>{period}</b>… bảng dưới vẫn là bản vừa xem.</span>
      </div>}
      {!error && !data && <div className="catalog-first-load" role="status" aria-live="polite">
        <Spinner /><b>Đang mở bảng % kỳ {period}…</b>
      </div>}
      {data && !data.available && <div className="catalog-alert error" role="status">
        {data.reason === 'CHUA_DONG_BO'
          ? `Kho cục bộ chưa có kỳ ${period} — CEO bấm "Đồng bộ % chi phí" một lần khi DataHub đang sống.`
          : 'Bạn chưa được cấp cột % nào — CEO cấp trong menu 🔐 Phân quyền cột % chi phí.'}
      </div>}
      {data?.available && <>
        <div className="catalog-rates-meta">
          <span>Bản đồng bộ <b>{formatDateTime(data.fetchedAt)}</b> bởi <b>{data.fetchedBy}</b> · {data.pairCount.toLocaleString('vi-VN')} cặp</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm đơn vị, mã QLNB, tên hàng, NV…" aria-label="Tìm trong bảng %" />
          <button type="button" className="btn secondary" disabled={exporting}
            onClick={async () => { setExporting(true); try { await downloadCostRatesTable({ period: uiToHub(period) }); } catch (e) { setError(e.message); } finally { setExporting(false); } }}>
            {exporting ? 'Đang xuất…' : 'Xuất Excel'}
          </button>
        </div>
        <div className="table-scroll"><table className="catalog-table catalog-table-simple">
          <thead><tr><th>Đơn vị</th><th>Mã QLNB</th><th>Tên hàng</th><th>NV</th>
            {data.columns.map((column) => <th key={column.key} className="catalog-money" title={column.label}>{column.key.toUpperCase()} (%)</th>)}
          </tr></thead>
          <tbody>{rows.slice(0, 300).map((row) => <tr key={`${row.employeeCode}|${row.unitCode}|${row.productCode}`}>
            <td data-label="Đơn vị">{row.unitCode}</td>
            <td data-label="Mã QLNB"><b>{row.productCode}</b></td>
            <td data-label="Tên hàng">{row.productName}</td>
            <td data-label="NV"><small>{row.employees.join(', ')}</small></td>
            {data.columns.map((column) => <CostRateCell key={column.key} label={`${column.key.toUpperCase()} (%)`} value={row.rates[column.key]} />)}
          </tr>)}</tbody>
        </table></div>
        {rows.length > 300 && <small className="muted">Hiện 300/{rows.length.toLocaleString('vi-VN')} dòng — dùng ô tìm để thu hẹp, hoặc Xuất Excel lấy đủ.</small>}
      </>}
    </div>}
  </div>;
}

/**
 * NÚT ĐỒNG BỘ % CHI PHÍ — CHỈ CEO (SPEC_COST_RATES_LOCAL_SYNC · CEO chốt 08/08).
 * Kéo bảng tỷ lệ của kỳ về kho cục bộ: từ đó DataHub chết cũng không mất số.
 * All-or-nothing: hụt một NV là backend giữ nguyên bản cũ và nói rõ ai hỏng.
 */
function CostRatesSyncCard({ period, catalogLoading = false }) {
  const hubPeriod = uiToHub(period);
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const loadStatus = () => api.catalogCostRatesLocalStatus()
    .then((data) => setStatus((data.periods || []).find((item) => item.period === hubPeriod) || null))
    .catch(() => setStatus(null));
  useEffect(() => { setResult(null); setError(''); loadStatus(); }, [hubPeriod]);

  const run = async () => {
    setSyncing(true); setError(''); setResult(null);
    try {
      const summary = await api.catalogCostRatesSync(hubPeriod);
      setResult(summary);
      await loadStatus();
    } catch (e) { setError(e.message); }
    finally { setSyncing(false); }
  };

  return <div className="card catalog-sync-card">
    <div>
      <b>🔄 Đồng bộ % chi phí kỳ {period}</b>
      <small>{status?.fetchedAt
        ? `Kho cục bộ: ${(status.employees?.length ?? status.employeeCount ?? 0)} NV · ${status.pairCount.toLocaleString('vi-VN')} cặp · đồng bộ ${formatDateTime(status.fetchedAt)} bởi ${status.fetchedBy}`
        : 'Kho cục bộ CHƯA có kỳ này — bấm đồng bộ lần đầu khi DataHub đang sống.'}</small>
    </div>
    <div className="catalog-sync-actions">
      <button type="button" className="btn" disabled={syncing || catalogLoading} onClick={run}>
        {syncing ? 'Đang kéo toàn đội…' : 'Đồng bộ từ DataHub'}
      </button>
    </div>
    {/* ‼ ĐANG TẢI DANH MỤC THÌ KHOÁ CÓ LÝ DO, KHÔNG GIẤU THẺ (CEO 09/08 20:04).
        Bản cũ ẩn nguyên thẻ này trong lúc tải (`actionsLocked`), nên khi danh mục
        tải lâu thì nút biến mất không dấu vết — CEO được bảo "bấm nút đồng bộ" mà
        tìm không ra, tưởng app hỏng. Khoá kèm lời giải thích + tự mở lại thì người
        dùng biết mình đang chờ cái gì; giấu đi thì không. Vẫn không cho bấm chồng
        vì DataHub từng tự restart do dồn tải (951,8 MB RSS, 08/08). */}
    {catalogLoading && <small className="muted">⏳ Đang mở danh mục kỳ này — nút tự mở lại ngay khi xong (không bấm chồng để DataHub khỏi quá tải).</small>}
    {error && <div className="catalog-alert error" role="alert">⚠ {error}</div>}
    {/* ‼ BA TRẠNG THÁI, KHÔNG PHẢI HAI (CEO bế tắc 10/08: bấm đồng bộ T07 mà "méo lấy
        kết quả"). Luật cũ all-or-nothing chỉ có "đủ" hoặc "hỏng"; nguồn chập chờn thì
        CEO không bao giờ ra khỏi ô "hỏng". Nay có trạng thái GIỮA: góp được thêm bao
        nhiêu, kho đang có bao nhiêu, còn thiếu ĐÍCH DANH ai. */}
    {result && (result.ok && result.complete
      ? <div className="catalog-alert ok" role="status">
        ✅ <b>KHO ĐÃ ĐỦ {result.stored}/{result.requested} NV</b> cho kỳ {period} · {result.pairCount.toLocaleString('vi-VN')} cặp.
        {' '}Kỳ này từ nay <b>đọc thẳng từ kho</b>, không hỏi DataHub nữa.
        {/* ‼ "thay đổi 0 · thêm 0 · bớt 0" từng làm CEO đọc thành "không làm gì cả"
            rồi bấm đi bấm lại (10/08 09:17). Nói rõ số 0 nghĩa là GIỐNG HỆT lần
            trước — tức đã có đủ từ trước, không phải nút hỏng. */}
        <div className="muted">
          So bản trước: thay đổi {result.diff.changed} · thêm {result.diff.added} · bớt {result.diff.removed}
          {result.diff.changed === 0 && result.diff.added === 0 && result.diff.removed === 0
            ? ' — toàn số 0 nghĩa là % lần này GIỐNG HỆT lần trước (kho đã đủ từ trước), KHÔNG phải nút không chạy.'
            : ''}
        </div>
      </div>
      : result.ok
        ? <div className="catalog-alert error" role="status">
          🟡 Đã góp thêm <b>{result.gained}</b> NV — kho hiện có <b>{result.stored}/{result.requested}</b> NV
          · {result.pairCount.toLocaleString('vi-VN')} cặp. <b>Còn thiếu:</b> {result.missing.slice(0, 8).join(', ')}{result.missing.length > 8 ? `… (${result.missing.length} NV)` : ''}.
          {' '}<b>Bấm lại nút này</b> khi nguồn khoẻ để gom tiếp — phần đã gom KHÔNG mất.
        </div>
        : <div className="catalog-alert error" role="alert">
          ⛔ Lượt này <b>không lấy được NV nào</b> ({result.failures.slice(0, 5).map((f) => f.empCode).join(', ')}{result.failures.length > 5 ? '…' : ''}).
          {' '}Kho giữ nguyên <b>{result.stored}/{result.requested}</b> NV. Chờ nguồn khoẻ rồi bấm lại.
        </div>)}
  </div>;
}

function AdminView({ data, period, selectedPeriod = '', onReload, history, diagnostics, costColumns = [], rateOf = () => null, interactionsDisabled = false }) {
  const [mode, setMode] = useState('view');
  const [query, setQuery] = useState('');
  const [emp, setEmp] = useState('');
  const [province, setProvince] = useState('');
  const [route, setRoute] = useState('');
  const [unit, setUnit] = useState('');
  const [page, setPage] = useState(1);
  const [cellLines, setCellLines] = useCellLines();
  const currentRows = useMemo(() => (data?.rows || []).filter((row) => activeInPeriod(row, period)), [data, period]);
  const qlnbCounts = useMemo(() => drugQlnbCounts(currentRows), [currentRows]);
  const provinceOptions = useMemo(() => [...new Set(currentRows.filter((row) => !emp || row.emp_code === emp).map(provinceOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows, emp]);
  const routeOptions = useMemo(() => [...new Set(currentRows.filter((row) => (!emp || row.emp_code === emp) && (!province || provinceOf(row) === province)).map(routeOf).filter(Boolean))].sort(), [currentRows, emp, province]);
  const unitOptions = useMemo(() => [...new Set(currentRows.filter((row) => (!emp || row.emp_code === emp) && (!province || provinceOf(row) === province) && (!route || routeOf(row) === route)).map((row) => row.unit_code).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [currentRows, emp, province, route]);
  const rows = useMemo(() => currentRows.filter((row) => {
    return matchesSmartSearch(row, query) && (!emp || row.emp_code === emp) && (!province || provinceOf(row) === province) && (!route || routeOf(row) === route) && (!unit || row.unit_code === unit);
  }), [currentRows, query, emp, province, route, unit]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [period, query, emp, province, route, unit]);
  useEffect(() => { if (interactionsDisabled) setMode('view'); }, [interactionsDisabled]);
  // Khi đang giữ bảng kỳ cũ để CEO tiếp tục đọc, tuyệt đối không cho subtree cũ
  // đi vào báo cáo/điều chuyển với kỳ vừa chọn. `effectiveMode` khóa ngay trong
  // render đầu tiên; effect phía trên chỉ đồng bộ state sau đó.
  const effectiveMode = interactionsDisabled ? 'view' : mode;
  const goPage = (next) => { setPage(Math.max(1, Math.min(pageCount, next))); requestAnimationFrame(() => document.getElementById('catalog-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  return <>
    <details className="card catalog-help-compact">
      <summary>❓ Hướng dẫn sử dụng</summary>
      <div><p>Màn hình quản lý theo từng tháng: nhân viên nào đang phụ trách từng cặp <b>đơn vị + mã QLNB</b>.</p><ol><li>Chọn kỳ</li><li>Chọn tuyến/NV hoặc nhập mã cần tìm</li><li>Nếu cần, mở tab Điều chuyển nhân viên</li></ol></div>
    </details>
    <div className="catalog-mode-tabs" role="tablist" aria-label="Chức năng danh mục quản lý">
      <button role="tab" aria-selected={effectiveMode === 'view'} className={effectiveMode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>🔎 Xem phân công</button>
      <button role="tab" aria-selected={effectiveMode === 'report'} className={effectiveMode === 'report' ? 'active' : ''} disabled={interactionsDisabled} onClick={() => setMode('report')} title={interactionsDisabled ? 'Chờ tải xong đúng kỳ trước khi lập báo cáo' : ''}>📊 Lập báo cáo NV</button>
      <button role="tab" aria-selected={effectiveMode === 'transfer'} className={effectiveMode === 'transfer' ? 'active' : ''} disabled={interactionsDisabled} onClick={() => setMode('transfer')} title={interactionsDisabled ? 'Chờ tải xong đúng kỳ trước khi điều chuyển' : ''}>⇄ Điều chuyển nhân viên</button>
    </div>

    {effectiveMode === 'view' ? <>
      <div className="card catalog-controls-compact">
        <div className="catalog-filter-row">
          <CatalogSearch value={query} onChange={setQuery} />
          <label><span>Vùng/Tỉnh</span><select value={province} onChange={(e) => { setProvince(e.target.value); setRoute(''); setUnit(''); }}><option value="">Tất cả vùng</option>{provinceOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Nhân viên</span><select value={emp} onChange={(e) => { setEmp(e.target.value); setProvince(''); setRoute(''); setUnit(''); }}><option value="">Tất cả nhân viên</option>{[...new Set(currentRows.map((r) => r.emp_code).filter(Boolean))].sort().map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Tuyến</span><select value={route} onChange={(e) => { setRoute(e.target.value); setUnit(''); }}><option value="">Tất cả tuyến</option>{routeOptions.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Đơn vị</span><select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Tất cả đơn vị</option>{unitOptions.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <CellLinesPicker lines={cellLines} onChange={setCellLines} />
          <div className="catalog-result-count"><span>Kết quả kỳ {hubToUi(period)}</span><b>{rows.length.toLocaleString('vi-VN')} cặp</b></div>
        </div>
      </div>
      <CatalogTableCard id="catalog-table-top" tableId="admin-catalog" cellLines={cellLines}>
        <CatalogPeriodBanner tablePeriod={hubToUi(period)} selectedPeriod={selectedPeriod} count={rows.length} />
        <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} period={hubToUi(period)} location="top" />
        <div className="table-scroll"><table className="catalog-table catalog-table-simple catalog-table-products" data-cost-column-count={costColumns.length} style={{ '--catalog-table-width': catalogTableWidth(true, costColumns.length) }}><thead><tr><th className="catalog-col-employee">Nhân viên</th><th>Tuyến</th><th>Mã nhà thầu</th><th className="catalog-col-unit">Mã đơn vị</th><th>Mã QLNB</th><th>C10</th><th className="catalog-col-text">Tên thuốc</th><th className="catalog-col-text">Hoạt chất + Hàm lượng</th><th>ĐVT</th><th className="catalog-money catalog-col-price">Đơn giá trúng thầu</th><th className="catalog-money">CST ban đầu</th><th className="catalog-money">CST còn lại</th>{costColumns.map((c) => <th key={c.key} className="catalog-money" title={c.label}>{c.key.toUpperCase()} (%)</th>)}<th className="catalog-col-since" title="Kỳ nhân viên BẮT ĐẦU phụ trách cặp này — không phải kỳ đang xem">Phụ trách từ kỳ<small>kỳ NV bắt đầu nhận</small></th><th>Đến kỳ</th></tr></thead><tbody>{visibleRows.map((r) => {
          const pct = Number(r.cst_initial) > 0 && r.cst_remaining != null ? (Number(r.cst_remaining) / Number(r.cst_initial)) * 100 : null;
          const pctClass = pct == null ? '' : pct <= 10 ? ' is-low' : pct <= 30 ? ' is-warning' : ' is-ok';
          const ingredientText = [r.active_ingredient, r.strength].filter(Boolean).join(' · ') || '—';
          const effectiveToText = r.effective_to ? hubToUi(r.effective_to) : 'Đang phụ trách';
          return <tr key={r.id}>
            <td className="catalog-col-employee" data-sensitive="" data-label="Nhân viên"><b>{r.emp_code}</b><small>{r.emp_name}</small></td>
            <PreviewCell label="Tuyến" value={routeOf(r) || '—'} />
            <PreviewCell label="Mã nhà thầu" value={r.contractor_code || '—'} />
            <PreviewCell label="Mã đơn vị" className="catalog-col-unit catalog-mobile-wide" value={r.unit_code || '—'} />
            <PreviewCell label="Mã QLNB" className="catalog-mobile-wide" value={r.qlnb_code || '—'} />
            <PreviewCell label="C10" value={r.c10 || '—'}><span className={r.c10 ? 'catalog-c10' : 'catalog-c10 is-missing'} title={r.c10 ? `Nhóm ưu tiên C10: ${r.c10}` : 'Chưa có C10 — cần bổ sung để tính thưởng P2'}>{r.c10 || '—'}</span></PreviewCell>
            <PreviewCell label="Tên thuốc" className="catalog-col-text catalog-mobile-wide" value={r.product_name || '—'}><DrugName row={r} counts={qlnbCounts} /></PreviewCell>
            <PreviewCell label="Hoạt chất + Hàm lượng" className="catalog-col-text catalog-mobile-wide" value={ingredientText}><span className="catalog-two-lines" title={ingredientText}>{ingredientText}</span></PreviewCell>
            <PreviewCell label="ĐVT" value={r.uom || '—'} />
            <td className="catalog-money catalog-col-price" data-sensitive="" data-label="Đơn giá trúng thầu"><b>{moneyText(r.bid_price)}</b></td>
            <td className="catalog-money" data-sensitive="" data-label="CST ban đầu">{quantityText(r.cst_initial)}</td>
            <td className={`catalog-money catalog-cst${pctClass}`} data-sensitive="" data-label="CST còn lại"><b>{quantityText(r.cst_remaining)}</b>{pct != null && <small>{pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</small>}</td>
            {costColumns.map((c) => <CostRateCell key={c.key} label={`${c.key.toUpperCase()} (%)`} value={rateOf(r.unit_code, r.qlnb_code, c.key)} />)}
            <PreviewCell label="Phụ trách từ kỳ" value={hubToUi(r.effective_from)} />
            <PreviewCell label="Đến kỳ" value={effectiveToText}>{r.effective_to ? effectiveToText : <span className="catalog-active-label">{effectiveToText}</span>}</PreviewCell>
          </tr>;
        })}</tbody></table></div>
        <Pager page={safePage} pageCount={pageCount} total={rows.length} onPage={goPage} period={hubToUi(period)} location="bottom" />
      </CatalogTableCard>
    </> : effectiveMode === 'report' ? <ReportPanel period={period} rows={currentRows} /> : <TransferPanel period={period} rows={currentRows} meta={data?.meta} onDone={onReload} />}

    <details className="card catalog-advanced">
      <summary>Quản trị nâng cao: lịch sử và trạng thái hệ thống</summary>
      <div className="catalog-admin-bottom">
        <section><div className="catalog-card-head"><h3>Lịch sử CEO</h3><span>{history.length}</span></div>{history.length ? history.slice(0, 30).map((x, i) => { const items = x.items || []; const relation = items.slice(0, 3).map((it) => `${it.scope}:${it.code} · ${it.from_emp || 'Chưa gán'} → ${it.to_emp || x.to_emp || '—'}`).join(' | '); return <div className="catalog-history" key={x.id || i}><div><b>{x.action || x.event || 'Thay đổi'}</b>{relation && <small>{relation}{items.length > 3 ? ` · +${items.length - 3} mã` : ''}</small>}</div><span>{x.actor || x.by || '—'} · {dateText(x.at || x.updatedAt)}</span></div>; }) : <div className="muted catalog-empty">Chưa có lịch sử từ nguồn hiện tại.</div>}</section>
        <section><div className="catalog-card-head"><h3>Trạng thái kỹ thuật</h3></div><dl className="catalog-diag"><dt>Đã cấu hình</dt><dd>{diagnostics?.configured ? 'Có' : 'Chưa'}</dd><dt>Timeout</dt><dd>{diagnostics?.timeoutMs || '—'} ms</dd><dt>LKG cache</dt><dd>{diagnostics?.cache?.available ? 'Có' : 'Chưa'}</dd><dt>Giai đoạn</dt><dd>Đợt 1</dd></dl></section>
      </div>
    </details>
  </>;
}

export default function CatalogManagement({ me }) {
  const [period, setPeriod] = useState(currentKy());
  const [periods, setPeriods] = useState([]);
  const [data, setData] = useState(null);
  // Kỳ ĐANG tải (rỗng = không tải gì). Giữ riêng khỏi `data` để bảng cũ ở lại trên màn.
  const [loadingPeriod, setLoadingPeriod] = useState('');
  const [history, setHistory] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [error, setError] = useState('');
  const loadGateRef = useRef(null);
  if (!loadGateRef.current) loadGateRef.current = createLatestRequestGate();
  const isAdmin = !!me?.isAdmin;
  // Danh tính CEO do backend cấp (`/me` trả `is_ceo`), KHÔNG suy từ vai admin —
  // admin thường không được đụng phân quyền cột % (CEO chốt 06/08).
  const isCeo = !!me?.is_ceo;
  const costRates = useCostRates(period);
  // Kỳ của BẢNG ĐANG HIỂN THỊ — có thể khác kỳ đang tải. Phải nói rõ, không để
  // anh/chị tưởng số trên màn đã là kỳ vừa chọn.
  const shownPeriod = data ? (data.period_ui || hubToUi(data.period)) : '';
  const periodMismatch = !!data && !!shownPeriod && shownPeriod !== period;
  // Mọi thao tác ghi/report/export bị khóa trong lúc tải hoặc khi đang giữ bảng
  // của kỳ khác. Bảng cũ chỉ còn là bản đọc; không thể tạo payload trộn kỳ.
  const actionsLocked = !!loadingPeriod || periodMismatch;
  // ‼ CÂU CHỜ PHẢI NÓI ĐÚNG ĐANG LÀM GÌ (CEO bực 09/08 22:07: *"tại sao vẫn cứ báo
  // là đang đồng bộ từ DataHub, trong khi đã kéo đủ 27.719 dòng về rồi"*).
  // CEO đúng: từ khi đổi sang đọc-bản-trên-máy, lượt xem thường KHÔNG gọi DataHub
  // nữa — nhưng câu chờ vẫn ghi "từ Data Hub" như cũ. Chờ vài giây thì chịu được;
  // chờ mà bị nói sai mình đang chờ cái gì thì mất tin tưởng vào cả màn hình.
  // Chỉ có bấm "Đồng bộ lại" mới thực sự hỏi DataHub.
  const [askingHub, setAskingHub] = useState(false);
  const employeeOptions = useMemo(() => {
    const seen = new Map();
    for (const row of data?.rows || []) {
      const code = String(row?.emp_code || '').trim().toUpperCase();
      if (code && !seen.has(code)) seen.set(code, { code, name: String(row?.emp_name || '').trim() });
    }
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [data]);
  // ‼ KHÔNG xoá dữ liệu cũ trước khi tải (CEO 08/08: *"mỗi lần kéo dữ liệu mà quay
  // như vậy thì rất kẹt"*). Bản cũ `setData(null)` làm cả trang trắng thành một vòng
  // quay mỗi lần đổi kỳ — trong khi danh mục rất nhiều dòng nên chờ khá lâu. Nay giữ
  // bảng cũ trên màn, chỉ gắn dải "đang tải" + nói rõ đang xem kỳ nào / chờ kỳ nào.
  async function load(selected = period, { fresh = false } = {}) {
    const request = loadGateRef.current.next();
    const hub = uiToHub(selected);
    // Đã xem kỳ này trong phiên ⇒ hiện NGAY, không quay vòng, không tải lại 27.719
    // dòng. Bấm "Đồng bộ lại" thì `fresh` bật để bỏ qua bản nhớ.
    if (!fresh && catalogSessionCache.has(hub)) {
      setError(''); setData(catalogSessionCache.get(hub)); setLoadingPeriod('');
      return catalogSessionCache.get(hub);
    }
    setError(''); setLoadingPeriod(selected);
    try {
      const p = hub;
      const result = await api.catalogManagement(p);
      if (!request.isLatest()) return undefined;
      rememberCatalog(p, result);
      setData(result);
      if (isAdmin) {
        const [h, d] = await Promise.allSettled([api.adminCatalogManagementHistory(p), api.adminCatalogManagementDiagnostics()]);
        if (!request.isLatest()) return;
        setHistory(h.status === 'fulfilled' ? (h.value.history || []) : []); setDiagnostics(d.status === 'fulfilled' ? d.value : null);
      }
    } catch (e) {
      // Tải hỏng thì GIỮ bảng cũ + báo lỗi, không đập màn hình về trắng.
      // ‼ Nói rõ HỎNG Ở CỬA NÀO và cái gì VẪN LÀM ĐƯỢC — 502 ở cửa danh mục không
      // liên quan gì tới cửa chi phí, mà CEO đọc "Lỗi máy chủ" thì tưởng chết cả hệ.
      if (request.isLatest()) {
        setError(`${e.message} — đây là CỬA DANH MỤC của Data Hub, không phải cửa chi phí. `
          + `Nút "Đồng bộ % chi phí kỳ ${selected}" phía dưới VẪN DÙNG ĐƯỢC bình thường.`);
      }
    } finally {
      if (request.isLatest()) setLoadingPeriod('');
    }
    return undefined;
  }
  useEffect(() => () => { loadGateRef.current?.cancel(); }, []);
  useEffect(() => { api.periods().then((p) => { const list = (p.periods || p || []).map((x) => x.ky || x).filter((x) => /^\d{2}\.\d{4}$/.test(x)); setPeriods(list); if (list.length && !list.includes(period)) setPeriod(list.at(-1)); }).catch(() => {}); }, []);
  useEffect(() => { load(period); }, [period, isAdmin]);
  return <div className="catalog-management">
    <div className="card catalog-heading catalog-heading-compact">
      <div><div className="section-head">🗂️ {isAdmin ? 'Phân công danh mục bán hàng' : 'Danh mục bán hàng của tôi'}</div><div className="meta muted">{isAdmin ? 'Theo cặp đơn vị + mã QLNB và từng kỳ' : 'Chỉ hiển thị phạm vi Anh/Chị đang phụ trách'}</div></div>
      <div className="catalog-heading-actions">{data?.meta && <SourceStatus meta={data.meta} canRefresh={isAdmin}
        onRefresh={async () => {
          setAskingHub(true);
          try {
            const result = await api.catalogManagementRefresh(uiToHub(period));
            catalogSessionCache.delete(uiToHub(period)); // muốn số mới thì bỏ bản nhớ
            await load(period, { fresh: true });
            return result; // huy hiệu cần kết quả này để nói nội dung có đổi không
          } finally { setAskingHub(false); }
        }} />}<label><span>Kỳ</span><select value={period} onChange={(e) => setPeriod(e.target.value)}>{(periods.length ? periods : [period]).map((x) => <option key={x}>{x}</option>)}</select></label></div>
    </div>
    {error && <div className="card catalog-alert error">⚠ {error}</div>}
    {/* Menu phân quyền cột % — CHỈ tài khoản CEO. Backend chặn độc lập bằng requireCeo. */}
    {/* Thẻ đồng bộ % KHÔNG phụ thuộc danh mục (nó đọc trạng thái riêng, nhắm đúng
        kỳ đang chọn) nên LUÔN hiện — chỉ khoá nút kèm lý do khi đang tải. */}
    {/* ‼ CHỈ khoá khi ĐANG TẢI, KHÔNG khoá khi danh mục HỎNG (CEO chặn cứng 09/08
        23:24). Bản trước dùng `actionsLocked` (gồm cả `periodMismatch`): danh mục
        kỳ 07 trả 502 ⇒ mismatch VĨNH VIỄN ⇒ nút đồng bộ % khoá VĨNH VIỄN ⇒ CEO
        không tài nào đóng băng được T07. Mà đồng bộ % KHÔNG đụng danh mục — nó gọi
        cửa chi phí, cửa đang sống (probe 21/21). Khoá nó đúng lúc cần nhất là tự
        chặn đường thoát duy nhất. */}
    {isCeo && <CostRatesSyncCard period={period} catalogLoading={!!loadingPeriod} />}
    {isCeo && <Catalog52ControlPlane period={period} />}
    <CostRatesTablePanel period={period} />
    {isCeo && data && !actionsLocked && <CostColumnGrantsPanel catalogRows={data.rows || []} employees={employeeOptions} unitGroups={data.unitGroups || null} />}
    {costRates.stale && !!costRates.columns.length && <div className="card catalog-alert error" role="status">
      ⚠ Nguồn tỷ lệ chi phí đang kẹt — cột % đang dùng bảng tỷ lệ lấy được gần nhất.{costRates.note ? ` ${costRates.note}` : ''}
    </div>}
    {/* Đang tải MÀ ĐÃ CÓ bảng cũ ⇒ chỉ một dải mảnh, bảng ở lại cho anh/chị đọc tiếp. */}
    {!!loadingPeriod && !!data && <div className="card catalog-loading-strip" role="status" aria-live="polite">
      <i className="catalog-loading-dot" aria-hidden="true" />
      <span>{askingHub
        ? <>Đang <b>hỏi lại Data Hub</b> cho kỳ <b>{loadingPeriod}</b>…</>
        : <>Đang mở danh mục kỳ <b>{loadingPeriod}</b> — <b>đọc bản đã có trên máy</b>, không gọi Data Hub.</>}
        {shownPeriod && shownPeriod !== loadingPeriod
          ? <> Bảng dưới vẫn là <b>kỳ {shownPeriod}</b> cho tới khi có dữ liệu mới.</>
          : ' Bảng dưới là bản vừa xem, đang được làm mới.'}</span>
    </div>}
    {periodMismatch && !loadingPeriod && <div className="card catalog-alert error" role="status">
      ⚠ Chưa tải được danh mục kỳ <b>{period}</b>. Bảng kỳ <b>{shownPeriod}</b> bên dưới chỉ để đọc; báo cáo, cấp quyền và điều chuyển đang khóa để không trộn kỳ.
    </div>}
    {/* Lần đầu chưa có gì để giữ ⇒ khung chờ CÓ NÓI đang chờ cái gì, thay vì vòng quay trơ. */}
    {!data && !error && <div className="card catalog-first-load" role="status" aria-live="polite">
      <Spinner />
      <b>{askingHub
        ? `Đang hỏi lại Data Hub cho kỳ ${loadingPeriod || period}…`
        : `Đang mở danh mục kỳ ${loadingPeriod || period}…`}</b>
      {/* ‼ KHÔNG ghi con số ước lượng ở đây. Bản đầu viết cứng "khoảng 27.700 cặp" —
          CEO đọc thành số liệu thật rồi hỏi vì sao lệch 19 dòng so với 27.719 (09/08).
          Trong app này mọi con số trên màn đều phải là số THẬT, có nguồn. Câu chờ chỉ
          mô tả tình trạng, không mang số. */}
      <p>{askingHub
        ? 'Đang hỏi Data Hub để lấy bản mới nhất — chỗ này mới thật sự phụ thuộc mạng.'
        : 'Ưu tiên bản đã lưu TRÊN MÁY; chỉ gọi Data Hub khi máy chưa có kỳ này. Danh mục toàn công ty khá lớn nên vẫn mất vài giây để bày ra bảng.'}
        {' '}Các phần phía trên dùng được ngay.</p>
    </div>}
    {data && (isAdmin
      ? <AdminView data={data} period={uiToHub(shownPeriod || period)} selectedPeriod={period} history={history} diagnostics={diagnostics} onReload={() => load(period)}
        costColumns={costRates.columns} rateOf={costRates.rateOf} interactionsDisabled={actionsLocked} />
      : <EmployeeSections data={data} costColumns={costRates.columns} rateOf={costRates.rateOf} />)}
  </div>;
}
