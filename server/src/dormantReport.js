'use strict';

const crypto = require('crypto');
const fs = require('fs');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const { localYmd, safeNote, safeAudit } = require('./dormantService');
const { reviewState } = require('./dormantNotifications');

const SNAPSHOT_NAME = 'dormant_report_snapshots';
const DEFAULT_RETENTION = 100;
const TEMPLATES = new Set(['standard', 'ceo_meeting', 'employee_work']);
const REVIEW_LABELS = { unplanned: 'Chưa lập kế hoạch', in_progress: 'Đang triển khai', upcoming: 'Sắp đến hạn', due: 'Đến hạn', overdue: 'Quá hạn', completed: 'Đã hoàn tất' };
const ACTION_LABELS = {
  contacted: 'Đã liên hệ đơn vị', scheduled: 'Đã lên lịch liên hệ', waiting_forecast: 'Đơn vị đang chờ dự trù',
  expected_order: 'Đơn vị dự kiến có đơn', blocked: 'Vướng thầu/cơ số/hàng hóa', national_tender_forecast: 'Vướng thầu QG, sẽ xin dự trù',
  debt_blocked: 'Vướng công nợ, không giao hàng', insurance_mapping_blocked: 'Vướng ánh xạ BHYT', no_demand: 'Đơn vị đã ngưng nhu cầu',
  inactive_assignment: 'Không còn đúng người phụ trách', other: 'Lý do khác',
};

function upper(v) { return String(v || '').trim().toUpperCase(); }
function text(v, max = 500) { return String(v == null ? '' : v).trim().slice(0, max); }
function dateOnly(v) { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function isCeo(session = {}) { return String(session.role || '').toLowerCase() === 'ceo' || upper(session.emp_code) === 'CEO'; }
function isAdmin(session = {}) { return isCeo(session) || String(session.role || '').toLowerCase() === 'admin'; }
function ownEmp(session = {}) { return isAdmin(session) ? null : upper(session.emp_code); }
function fail(message, status = 400, code = 'DORMANT_REPORT_ERROR') { const e = new Error(message); e.status = status; e.code = code; throw e; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function vnNumber(v) { return Number(v || 0).toLocaleString('vi-VN'); }
function vnDate(v) { const d = dateOnly(v); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'; }
function reviewLabel(v) { return REVIEW_LABELS[v] || text(v, 80) || '—'; }
function actionLabel(v) { return ACTION_LABELS[v] || text(v, 120) || '—'; }

function sanitizeItem(item, today) {
  const action = item.action || {};
  const attention = reviewState(item, today);
  return {
    key: text(item.key, 500), emp_code: upper(item.emp_code), employee_name: text(item.employee_name, 160),
    unit_code: text(item.unit_code, 160), unit_name: text(item.unit_name, 300),
    iit_code: text(item.iit_code, 200), product_name: text(item.product_name, 300), route: text(item.route, 30),
    first_activity_at: dateOnly(item.first_activity_at), last_activity_at: dateOnly(item.last_activity_at),
    first_detected_at: dateOnly(item.first_detected_at), days_idle: Number(item.days_idle || 0),
    threshold_days: Number(item.threshold_days || 0),
    historical_quantity: Number(item.historical_quantity || 0), remain_qty: item.cst?.remain_qty == null ? null : Number(item.cst.remain_qty),
    c30_available: !!item.cst?.c30_available, priority_score: Number(item.priority?.score || 0),
    review_status: attention.status || 'unplanned', action_status: action.status || null,
    next_follow_up: dateOnly(action.next_follow_up), action_note: safeNote(action.note, 1000), action_updated_at: dateOnly(action.updated_at),
    action_cycle: Number(action.cycle || 0), newly_dormant: dateOnly(item.first_detected_at) === dateOnly(today),
  };
}
function sanitizeEvidence(state = {}, scopeEmp = null) {
  return Object.entries(state.items || {}).flatMap(([key, row]) => {
    const emp = upper(decodeURIComponent(String(key).split('|')[0] || ''));
    if (scopeEmp && emp !== scopeEmp) return [];
    const audit = safeAudit(row.audit || []);
    if (!row.resolved_at && !audit.some((entry) => entry.type === 'reactivated')) return [];
    return [{ key, emp_code: emp, resolved_at: dateOnly(row.resolved_at), resolution: text(row.resolution, 100), audit }];
  });
}
function metrics(items) {
  return {
    dormant_total: items.length,
    newly_dormant: items.filter((x) => x.newly_dormant).length,
    unplanned: items.filter((x) => x.review_status === 'unplanned').length,
    in_progress: items.filter((x) => ['in_progress', 'upcoming'].includes(x.review_status)).length,
    due_review: items.filter((x) => x.review_status === 'due').length,
    overdue_review: items.filter((x) => x.review_status === 'overdue').length,
    employees: new Set(items.map((x) => x.emp_code).filter(Boolean)).size,
    units: new Set(items.map((x) => x.unit_code).filter(Boolean)).size,
  };
}
function groups(items, key, label) {
  const map = new Map();
  for (const item of items) {
    const k = item[key]; if (!k) continue;
    const cur = map.get(k) || { key: k, label: item[label] || k, total: 0, overdue: 0, due: 0, unplanned: 0 };
    cur.total += 1; cur.overdue += item.review_status === 'overdue' ? 1 : 0; cur.due += item.review_status === 'due' ? 1 : 0; cur.unplanned += item.review_status === 'unplanned' ? 1 : 0;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.due - a.due || b.unplanned - a.unplanned || b.total - a.total || a.key.localeCompare(b.key, 'vi'));
}
function normalizeFilters(filters = {}, session = {}) {
  const employee = ownEmp(session);
  const requestedEmp = upper(filters.emp_code);
  if (requestedEmp && !isCeo(session)) fail('Chỉ CEO được lọc theo mã nhân viên', 403, 'CEO_FILTER_REQUIRED');
  return {
    emp_code: employee || requestedEmp || null,
    unit_code: text(filters.unit_code, 160) || null,
    review_status: text(filters.review_status, 40).toLowerCase() || null,
    q: text(filters.q, 200).toLocaleLowerCase('vi') || null,
  };
}
function applyFilters(items, filters) {
  return items.filter((item) => (!filters.emp_code || item.emp_code === filters.emp_code)
    && (!filters.unit_code || item.unit_code === filters.unit_code)
    && (!filters.review_status || item.review_status === filters.review_status)
    && (!filters.q || [item.key, item.emp_code, item.employee_name, item.unit_code, item.unit_name, item.iit_code, item.product_name, item.action_note].join(' ').toLocaleLowerCase('vi').includes(filters.q)));
}
function templateFor(value, session) {
  const requested = String(value || 'standard');
  if (!TEMPLATES.has(requested)) fail('Mẫu báo cáo không hợp lệ', 400, 'INVALID_REPORT_TEMPLATE');
  const template = requested;
  if (template === 'ceo_meeting' && !isCeo(session)) fail('Mẫu họp CEO chỉ dành cho CEO', 403, 'CEO_TEMPLATE_REQUIRED');
  return template;
}
function snapshotDigest(snapshot, signingKey) {
  return crypto.createHmac('sha256', signingKey).update(stable({
    id: snapshot.id, created_at: snapshot.created_at, created_by: snapshot.created_by,
    access_scope: snapshot.access_scope, owner_scope_key: snapshot.owner_scope_key,
    dedupe_key: snapshot.dedupe_key, scope: snapshot.scope, filters: snapshot.filters,
    template: snapshot.template, data_digest: snapshot.data_digest,
    state_digest: snapshot.state_digest, report: snapshot.report,
  })).digest('hex');
}
function validSnapshot(snapshot, signingKey) {
  if (!signingKey || !snapshot || typeof snapshot !== 'object' || !/^[a-f0-9]{64}$/.test(String(snapshot.snapshot_digest || ''))) return false;
  const expected = snapshotDigest(snapshot, signingKey);
  const actual = String(snapshot.snapshot_digest);
  return !!snapshot && typeof snapshot === 'object' && !!snapshot.snapshot_digest
    && crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function publicSnapshot(snapshot) {
  const { dedupe_key, owner_scope_key, snapshot_digest, ...safe } = snapshot || {};
  return clone(safe);
}
async function deterministicZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const fixed = new Date('2000-01-01T00:00:00.000Z');
  for (const entry of Object.values(zip.files)) entry.date = fixed;
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' }));
}

function createDormantReportService({ dormantService, persist, clock = () => new Date(), retention = DEFAULT_RETENTION, snapshotSecret = process.env.DORMANT_REPORT_SNAPSHOT_SECRET || process.env.SESSION_SECRET } = {}) {
  if (!dormantService || !persist) throw new Error('Dormant report thiếu dormantService/persist');
  const signingKey = String(snapshotSecret || '').trim();
  const requireSigningKey = () => {
    if (Buffer.byteLength(signingKey, 'utf8') < 32) fail('Khóa ký snapshot QLNB chưa sẵn sàng', 503, 'SNAPSHOT_SIGNING_UNAVAILABLE');
    return signingKey;
  };
  const loadSnapshots = () => persist.load(SNAPSHOT_NAME, { version: 1, snapshots: [] });
  const verifiedSnapshots = () => {
    requireSigningKey();
    const rows = loadSnapshots().snapshots;
    if (!Array.isArray(rows)) fail('Kho snapshot QLNB không hợp lệ', 409, 'SNAPSHOT_INTEGRITY_FAILED');
    if (rows.some((x) => !validSnapshot(x, signingKey))) fail('Phát hiện snapshot QLNB không toàn vẹn', 409, 'SNAPSHOT_INTEGRITY_FAILED');
    return rows;
  };
  const saveSnapshots = (value) => persist.save(SNAPSHOT_NAME, value);

  function current({ session = {}, filters = {}, template = 'standard' } = {}) {
    if (isAdmin(session) && !isCeo(session)) fail('Báo cáo QLNB này chỉ dành cho CEO hoặc nhân viên trong phạm vi được giao', 403, 'DORMANT_REPORT_ROLE_REQUIRED');
    const normalized = normalizeFilters(filters, session);
    const selectedTemplate = templateFor(template, session);
    const employee = ownEmp(session);
    let result = dormantService.analyzeScope(employee || null);
    // The engine's `newly_dormant` flag is a transition signal consumed by
    // the first analysis.  Materialize once more so snapshots of the same
    // persisted state do not differ merely because one call discovered it.
    if (result.items.some((item) => item.newly_dormant)) result = dormantService.analyzeScope(employee || null);
    const today = localYmd(clock());
    const all = result.items.map((item) => sanitizeItem(item, today));
    const items = applyFilters(all, normalized).sort((a, b) => ({ overdue: 0, due: 1, unplanned: 2, upcoming: 3, in_progress: 4 }[a.review_status] ?? 5) - ({ overdue: 0, due: 1, unplanned: 2, upcoming: 3, in_progress: 4 }[b.review_status] ?? 5) || b.priority_score - a.priority_score || a.key.localeCompare(b.key, 'vi'));
    const scopeEmp = employee || normalized.emp_code;
    const report = {
      version: 1, template: selectedTemplate, generated_at: new Date(clock()).toISOString(), generated_on: today,
      as_of: result.as_of, scope: { type: scopeEmp ? 'employee' : 'company', emp_code: scopeEmp || null }, filters: normalized,
      kpis: metrics(items), top_employees: groups(items, 'emp_code', 'employee_name'), top_units: groups(items, 'unit_code', 'unit_name'),
      priority_items: items.filter((x) => ['overdue', 'due', 'unplanned'].includes(x.review_status)), items,
      completed_reactivated_evidence: sanitizeEvidence(result.state, scopeEmp),
    };
    // Hash only the authorized, filtered projection.  Company activity outside
    // an employee/filter scope must not create duplicate snapshots or consume
    // that scope's retention budget.
    report.state_digest = digest({
      as_of: result.as_of,
      scope: report.scope,
      filters: report.filters,
      items: report.items,
      completed_reactivated_evidence: report.completed_reactivated_evidence,
    });
    report.data_digest = digest({ ...report, generated_at: undefined, generated_on: undefined, state_digest: undefined });
    return report;
  }

  function createSnapshot({ session = {}, filters = {}, template = 'standard' } = {}) {
    requireSigningKey();
    const employee = ownEmp(session);
    if (!employee && !isCeo(session)) fail('Chỉ CEO được lưu snapshot toàn công ty', 403, 'CEO_SNAPSHOT_REQUIRED');
    const report = current({ session, filters, template });
    if (report.scope.type === 'company' && !isCeo(session)) fail('Snapshot toàn công ty chỉ dành cho CEO', 403, 'CEO_SNAPSHOT_REQUIRED');
    const root = loadSnapshots(); const list = verifiedSnapshots();
    const accessScope = isCeo(session) ? 'ceo' : 'employee';
    const ownerScopeKey = accessScope === 'ceo' ? 'CEO' : `EMP:${employee}`;
    const dedupeKey = digest({ access_scope: accessScope, owner_scope_key: ownerScopeKey, scope: report.scope, filters: report.filters, template: report.template });
    const hit = list.find((x) => x.dedupe_key === dedupeKey && x.data_digest === report.data_digest && x.state_digest === report.state_digest);
    if (hit) return { ...publicSnapshot(hit), deduplicated: true };
    const createdAt = new Date(clock()).toISOString();
    const snapshot = { id: `dormant-${createdAt.replace(/\D/g, '').slice(0, 17)}-${crypto.randomBytes(4).toString('hex')}`, created_at: createdAt, created_by: upper(session.emp_code), access_scope: accessScope, owner_scope_key: ownerScopeKey, dedupe_key: dedupeKey, data_digest: report.data_digest, state_digest: report.state_digest, scope: report.scope, filters: report.filters, template: report.template, report: clone(report) };
    snapshot.snapshot_digest = snapshotDigest(snapshot, signingKey);
    list.push(snapshot);
    const keep = Math.max(1, Number(retention) || DEFAULT_RETENTION);
    const ownRows = list.filter((x) => x.owner_scope_key === ownerScopeKey).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, keep);
    const ownIds = new Set(ownRows.map((x) => x.id));
    root.version = 2; root.snapshots = list.filter((x) => x.owner_scope_key !== ownerScopeKey || ownIds.has(x.id)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    saveSnapshots(root);
    return { ...publicSnapshot(snapshot), deduplicated: false };
  }
  function canRead(snapshot, session) {
    if (isCeo(session)) return true;
    return snapshot.access_scope === 'employee' && !!ownEmp(session) && snapshot.scope?.type === 'employee' && snapshot.scope?.emp_code === ownEmp(session);
  }
  function listSnapshots({ session = {} } = {}) {
    return verifiedSnapshots().filter((x) => canRead(x, session)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(({ report, dedupe_key, owner_scope_key, snapshot_digest, ...meta }) => ({ ...clone(meta), item_count: report?.items?.length || 0 }));
  }
  function getSnapshot({ id, session = {} } = {}) {
    const snapshot = verifiedSnapshots().find((x) => x.id === String(id || ''));
    if (!snapshot || !canRead(snapshot, session)) fail('Không tìm thấy snapshot trong phạm vi được phép', 404, 'SNAPSHOT_NOT_FOUND');
    return publicSnapshot(snapshot);
  }
  async function exportSnapshot({ id, session = {}, format } = {}) {
    const snapshot = getSnapshot({ id, session });
    if (!['xlsx', 'pdf'].includes(format)) fail('Định dạng export không hợp lệ');
    return { snapshot, buffer: format === 'xlsx' ? await excelBuffer(snapshot.report) : await pdfBuffer(snapshot.report) };
  }
  return { current, createSnapshot, listSnapshots, getSnapshot, exportSnapshot };
}

function styleHeader(row) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F54' } }; row.alignment = { vertical: 'middle', wrapText: true }; }
function addItemsSheet(workbook, report) {
  const ws = workbook.addWorksheet('Chi tiết QLNB', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [
    ['STT', 7], ['Mã NV', 11], ['Nhân viên', 20], ['Mã đơn vị', 18], ['Đơn vị', 28], ['Mã QLNB', 18], ['Sản phẩm', 30], ['Tuyến', 9], ['Ngày bán cuối', 14], ['Số ngày ngủ', 12], ['CST còn lại', 12], ['Ưu tiên', 10], ['Trạng thái review', 18], ['Kết quả xử lý', 24], ['Review lại', 14], ['Chu kỳ xử lý', 14], ['Ghi chú', 34], ['Quyết định', 20], ['Chủ trì', 16], ['Hạn', 14],
  ].map(([header, width]) => ({ header, width })); styleHeader(ws.getRow(1)); ws.autoFilter = { from: 'A1', to: 'T1' };
  report.items.forEach((x, i) => ws.addRow([i + 1, x.emp_code, x.employee_name, x.unit_code, x.unit_name, x.iit_code, x.product_name, x.route, x.last_activity_at ? new Date(`${x.last_activity_at}T00:00:00Z`) : null, x.days_idle, x.remain_qty, x.priority_score, reviewLabel(x.review_status), actionLabel(x.action_status), x.next_follow_up ? new Date(`${x.next_follow_up}T00:00:00Z`) : null, x.action_cycle, x.action_note, '', '', '']));
  ['I', 'O', 'T'].forEach((c) => { ws.getColumn(c).numFmt = 'dd/mm/yyyy'; }); ['J', 'K', 'L', 'P'].forEach((c) => { ws.getColumn(c).numFmt = '#,##0'; });
  ws.eachRow((row, n) => { row.alignment = { vertical: 'top', wrapText: true }; if (n > 1 && n % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F7FA' } }; });
  ws.headerFooter.oddFooter = 'App Report · Trang &P/&N';
}
async function excelBuffer(report) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'App Report'; wb.created = new Date(report.generated_at);
  const summary = wb.addWorksheet(report.template === 'ceo_meeting' ? 'Tổng quan CEO' : 'Tổng quan', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
  summary.addRow(['BÁO CÁO QLNB NGỦ ĐÔNG', report.scope.type === 'company' ? 'Toàn công ty' : report.scope.emp_code]); summary.mergeCells('A1:D1'); summary.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FF1F4E78' } };
  summary.addRow(['Ngày dữ liệu', vnDate(report.as_of), 'Ngày tạo', vnDate(report.generated_on)]);
  summary.addRow(['QLNB ngủ đông', report.kpis.dormant_total, 'Quá hạn', report.kpis.overdue_review]); summary.addRow(['Đến hạn', report.kpis.due_review, 'Chưa kế hoạch', report.kpis.unplanned]);
  summary.addRow([]); summary.addRow(['Top nhân viên', 'Tổng', 'Quá hạn', 'Đến hạn']); styleHeader(summary.getRow(6)); report.top_employees.slice(0, 15).forEach((x) => summary.addRow([`${x.key} · ${x.label}`, x.total, x.overdue, x.due]));
  summary.columns = [{ width: 42 }, { width: 16 }, { width: 16 }, { width: 16 }]; summary.getColumn(2).numFmt = '#,##0'; summary.getColumn(3).numFmt = '#,##0'; summary.getColumn(4).numFmt = '#,##0'; summary.headerFooter.oddFooter = 'App Report · Trang &P/&N';
  if (report.template === 'ceo_meeting') {
    const units = wb.addWorksheet('Top đơn vị'); units.addRow(['Đơn vị', 'Tổng', 'Quá hạn', 'Đến hạn', 'Chưa kế hoạch', 'Quyết định', 'Chủ trì', 'Hạn']); styleHeader(units.getRow(1)); report.top_units.slice(0, 30).forEach((x) => units.addRow([`${x.key} · ${x.label}`, x.total, x.overdue, x.due, x.unplanned, '', '', ''])); units.columns = [{ width: 45 }, ...Array.from({ length: 7 }, () => ({ width: 16 }))]; units.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    const evidence = wb.addWorksheet('Bằng chứng hoàn tất'); evidence.addRow(['Mã', 'Mã NV', 'Ngày hoàn tất', 'Kết quả', 'Dấu vết audit']); styleHeader(evidence.getRow(1)); report.completed_reactivated_evidence.forEach((x) => evidence.addRow([x.key, x.emp_code, x.resolved_at ? new Date(`${x.resolved_at}T00:00:00Z`) : null, x.resolution, x.audit.map((a) => `${vnDate(a.at)} ${a.type}`).join('; ')])); evidence.getColumn(3).numFmt = 'dd/mm/yyyy'; evidence.columns = [{ width: 45 }, { width: 12 }, { width: 15 }, { width: 28 }, { width: 60 }];
  }
  addItemsSheet(wb, report); return deterministicZip(await wb.xlsx.writeBuffer());
}
function pickFont(bold) { return (bold ? ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'] : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']).find(fs.existsSync); }
function pdfBuffer(report) {
  return new Promise((resolve, reject) => {
    const fixedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(report.as_of || '')) ? new Date(`${report.as_of}T00:00:00.000Z`) : new Date('2000-01-01T00:00:00.000Z');
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true, info: { Title: 'Báo cáo QLNB ngủ đông', Author: 'App Report', CreationDate: fixedDate, ModDate: fixedDate } }); const chunks = []; doc.on('data', (x) => chunks.push(x)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const rf = pickFont(false), bf = pickFont(true); if (rf) doc.registerFont('VN', rf); if (bf) doc.registerFont('VNB', bf); const F = rf ? 'VN' : 'Helvetica', B = bf ? 'VNB' : 'Helvetica-Bold'; const width = doc.page.width - 64;
    const heading = (title, sub) => { doc.font(B).fontSize(18).fillColor('#1f4e78').text(title, { align: 'center' }); doc.font(F).fontSize(9).fillColor('#64748b').text(sub, { align: 'center' }).moveDown(); };
    const table = (rows, cols, y = doc.y + 8) => { let yy = y; const header = () => { doc.rect(32, yy, width, 22).fill('#1f6f54'); let x = 32; cols.forEach((c) => { doc.font(B).fontSize(7).fillColor('white').text(c.h, x + 3, yy + 6, { width: c.w * width - 6, align: c.a || 'left' }); x += c.w * width; }); yy += 22; }; header(); rows.forEach((r, i) => { if (yy > doc.page.height - 48) { doc.addPage(); yy = 35; header(); } if (i % 2) doc.rect(32, yy, width, 20).fill('#f3f7fa'); let x = 32; cols.forEach((c) => { doc.font(F).fontSize(7).fillColor('#263645').text(text(c.v(r, i), 100), x + 3, yy + 5, { width: c.w * width - 6, height: 11, ellipsis: true, align: c.a || 'left' }); x += c.w * width; }); yy += 20; }); doc.y = yy; };
    heading(report.template === 'ceo_meeting' ? 'BÁO CÁO HỌP CEO · QLNB NGỦ ĐÔNG' : report.template === 'employee_work' ? 'CÔNG VIỆC CÁ NHÂN · QLNB NGỦ ĐÔNG' : 'BÁO CÁO QLNB NGỦ ĐÔNG', `${report.scope.type === 'company' ? 'Toàn công ty' : report.scope.emp_code} · dữ liệu đến ${vnDate(report.as_of)}`);
    doc.font(B).fontSize(13).fillColor('#1f4e78').text(`Tổng ${vnNumber(report.kpis.dormant_total)} · Quá hạn ${vnNumber(report.kpis.overdue_review)} · Đến hạn ${vnNumber(report.kpis.due_review)} · Chưa kế hoạch ${vnNumber(report.kpis.unplanned)}`, { align: 'center' });
    if (report.template === 'ceo_meeting') {
      doc.moveDown(1.5); table(report.top_employees.slice(0, 12), [{ h: 'Nhân viên', w: .46, v: (x) => `${x.key} · ${x.label}` }, { h: 'Tổng', w: .14, a: 'right', v: (x) => vnNumber(x.total) }, { h: 'Quá hạn', w: .14, a: 'right', v: (x) => vnNumber(x.overdue) }, { h: 'Đến hạn', w: .13, a: 'right', v: (x) => vnNumber(x.due) }, { h: 'Chưa KH', w: .13, a: 'right', v: (x) => vnNumber(x.unplanned) }]);
      doc.addPage(); heading('TOP ĐƠN VỊ CẦN ƯU TIÊN', 'Xếp theo quá hạn · đến hạn · chưa có kế hoạch'); table(report.top_units.slice(0, 18), [{ h: 'Đơn vị', w: .48, v: (x) => `${x.key} · ${x.label}` }, { h: 'Tổng', w: .13, a: 'right', v: (x) => vnNumber(x.total) }, { h: 'Quá hạn', w: .13, a: 'right', v: (x) => vnNumber(x.overdue) }, { h: 'Đến hạn', w: .13, a: 'right', v: (x) => vnNumber(x.due) }, { h: 'Chưa KH', w: .13, a: 'right', v: (x) => vnNumber(x.unplanned) }]);
    }
    doc.addPage();
    const meeting = report.template === 'ceo_meeting';
    heading('CHI TIẾT HÀNH ĐỘNG QLNB', meeting ? 'Cột quyết định để trống phục vụ cuộc họp' : 'Phạm vi công việc đúng theo nhân viên được phân công');
    const detailCols = [
      { h: '#', w: .03, v: (_, i) => i + 1 }, { h: 'NV', w: .06, v: (x) => x.emp_code },
      { h: 'Đơn vị', w: .15, v: (x) => x.unit_name || x.unit_code }, { h: 'QLNB / sản phẩm', w: .18, v: (x) => `${x.iit_code} · ${x.product_name}` },
      { h: 'Ngày cuối', w: .08, v: (x) => vnDate(x.last_activity_at) }, { h: 'Ngủ', w: .06, a: 'right', v: (x) => vnNumber(x.days_idle) },
      { h: 'CST còn', w: .06, a: 'right', v: (x) => x.remain_qty == null ? '—' : vnNumber(x.remain_qty) }, { h: 'Review', w: .10, v: (x) => reviewLabel(x.review_status) },
      { h: 'Kết quả', w: meeting ? .11 : .15, v: (x) => actionLabel(x.action_status) }, { h: 'Review lại', w: .08, v: (x) => vnDate(x.next_follow_up) },
      { h: 'Chu kỳ', w: .05, a: 'right', v: (x) => vnNumber(x.action_cycle) },
    ];
    if (meeting) detailCols.push({ h: 'Quyết định', w: .04, v: () => '' });
    table(report.items, detailCols);
    const notes = report.items.filter((x) => x.action_note);
    if (notes.length) {
      doc.addPage(); heading('GHI CHÚ XỬ LÝ QLNB', 'Nội dung công việc tại thời điểm lưu snapshot');
      notes.forEach((x) => {
        if (doc.y > doc.page.height - 95) { doc.addPage(); heading('GHI CHÚ XỬ LÝ QLNB · TIẾP', 'Nội dung công việc tại thời điểm lưu snapshot'); }
        doc.font(B).fontSize(8).fillColor('#1f4e78').text(`${x.emp_code} · ${x.unit_name || x.unit_code} · ${x.iit_code} · ${x.product_name}`, { width });
        doc.font(F).fontSize(7.5).fillColor('#263645').text(`Kết quả: ${actionLabel(x.action_status)}`, { width });
        doc.font(F).fontSize(8).fillColor('#263645').text(`Ghi chú: ${x.action_note}`, { width }).moveDown(.7);
      });
    }
    if (report.template === 'ceo_meeting' && report.completed_reactivated_evidence.length) { doc.addPage(); heading('BẰNG CHỨNG HOÀN TẤT / KÍCH HOẠT LẠI', 'Dấu vết audit bất biến tại thời điểm snapshot'); table(report.completed_reactivated_evidence, [{ h: 'Mã', w: .45, v: (x) => x.key }, { h: 'NV', w: .10, v: (x) => x.emp_code }, { h: 'Ngày', w: .12, v: (x) => vnDate(x.resolved_at) }, { h: 'Kết quả', w: .18, v: (x) => x.resolution }, { h: 'Audit', w: .15, v: (x) => x.audit.map((a) => `${vnDate(a.at)} ${a.type}`).join('; ') }]); }
    const pages = doc.bufferedPageRange(); for (let i = pages.start; i < pages.start + pages.count; i++) { doc.switchToPage(i); doc.font(F).fontSize(7).fillColor('#94a3b8').text(`App Report · Trang ${i + 1}/${pages.count}`, 32, doc.page.height - 24, { width, align: 'right', lineBreak: false }); } doc.end();
  });
}

module.exports = { SNAPSHOT_NAME, DEFAULT_RETENTION, isCeo, sanitizeItem, normalizeFilters, createDormantReportService, excelBuffer, pdfBuffer };
