// api.js — gọi backend, tự đính token. Frontend KHÔNG tự quyết quyền.
const TOKEN_KEY = 'rpt_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// deviceId bền cho "thiết bị tin cậy" — sinh ngẫu nhiên 1 lần, lưu localStorage.
const DEVICE_KEY = 'rpt_device';
export function getDeviceId() {
  let d = localStorage.getItem(DEVICE_KEY);
  if (!d) {
    d = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(DEVICE_KEY, d);
  }
  return d;
}

async function req(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getDeviceId(),
      ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    setToken(null);
    throw new Error('Phiên đăng nhập hết hạn');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lỗi máy chủ');
  return data;
}

export const api = {
  login: (emp_code) => req('POST', '/auth/login', { emp_code }),
  demoUsers: () => req('GET', '/auth/demo-users'),
  mode: () => req('GET', '/auth/mode'),
  otpRequest: (phone) => req('POST', '/auth/otp/request', { phone }),
  otpVerify: (phone, code) => req('POST', '/auth/otp/verify', { phone, code }),
  otpSelect: (phone, emp_code) => req('POST', '/auth/otp/select', { phone, emp_code }),
  sso: (sso_token) => req('POST', '/auth/sso', { sso_token }),
  // Telegram login (chính)
  telegramStart: () => req('POST', '/auth/telegram/start', {}),
  telegramStatus: (poll_secret) => req('POST', '/auth/telegram/status', { poll_secret }),
  // Admin: mapping Telegram + thiết bị tin cậy
  adminTelegramMap: () => req('GET', '/admin/telegram-map'),
  adminTelegramMapAdd: (telegram_id, emp_code) => req('POST', '/admin/telegram-map', { telegram_id, emp_code }),
  adminTelegramMapDel: (telegram_id) => req('DELETE', '/admin/telegram-map', { telegram_id }),
  adminDevices: (emp) => req('GET', '/admin/devices' + (emp ? `?emp=${encodeURIComponent(emp)}` : '')),
  adminDeviceDel: (id) => req('DELETE', '/admin/devices/' + encodeURIComponent(id)),
  me: () => req('GET', '/me'),
  employeeCost: (emp, range = {}) => {
    const params = new URLSearchParams();
    if (emp) params.set('emp', emp);
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    const query = params.toString();
    return req('GET', '/employee-cost' + (query ? `?${query}` : ''));
  },
  employeeCostEmployees: () => req('GET', '/employee-cost/employees'),
  periods: () => req('GET', '/periods'),
  revenueRefreshStatus: () => req('GET', '/admin/revenue-refresh/status'),
  revenueRefreshRun: (ky) => req('POST', '/admin/revenue-refresh/run', ky ? { ky } : {}),
  adminReconcile: (ky) => req('GET', '/admin/reconcile' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  adminTargets: (ky) => req('GET', '/admin/targets' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  adminTargetManual: (payload) => req('POST', '/admin/targets/manual', payload),
  adminTargetBulk: (payload) => req('POST', '/admin/targets/bulk', payload),
  adminTargetQuarter: (payload) => req('POST', '/admin/targets/quarter', payload),
  adminTargetAiPropose: () => req('POST', '/admin/targets/ai/propose', {}),
  adminTargetAiApply: (payload) => req('POST', '/admin/targets/ai/apply', payload),
  adminTargetUploadCommit: (previewId) => req('POST', '/admin/targets/upload/commit', { previewId }),
  adminTargetCarryover: (payload) => req('POST', '/admin/targets/carryover', payload),
  adminTargetManualClear: (payload) => req('POST', '/admin/targets/manual/clear', payload),
  adminTargetUploadRollback: (batchId) => req('POST', '/admin/targets/upload/rollback', { batchId }),
  adminTargetHistory: () => req('GET', '/admin/targets/history'),
  targetAdjustments: (params = {}) => req('GET', '/target-adjustments?' + new URLSearchParams(params).toString()),
  targetAdjustmentCreate: (payload) => req('POST', '/target-adjustments', payload),
  adminTargetAdjustmentApprove: (id) => req('POST', '/admin/target-adjustments/' + encodeURIComponent(id) + '/approve', {}),
  adminTargetAdjustmentReject: (id) => req('POST', '/admin/target-adjustments/' + encodeURIComponent(id) + '/reject', {}),
  adminTargetAdjustmentSuggestions: (params = {}) => req('GET', '/admin/target-adjustments/suggestions?' + new URLSearchParams(params).toString()),
  filters: (params) => req('GET', '/filters' + (params ? `?${new URLSearchParams(typeof params === 'string' ? { ky: params } : params)}` : '')),
  overview: (params) => req('GET', '/overview' + (params ? `?${new URLSearchParams(typeof params === 'string' ? { ky: params } : params)}` : '')),
  trend: (params = {}) => req('GET', '/trend?' + new URLSearchParams(params).toString()),
  alerts: (params) => req('GET', '/alerts' + (params ? `?${new URLSearchParams(params)}` : '')),
  dormantGate: (params = {}) => req('GET', '/dormant/gate?' + new URLSearchParams(params).toString()),
  dormantActions: (payload) => req('POST', '/dormant/actions', payload),
  dormantItemDetail: (key) => req('GET', '/dormant/items/' + encodeURIComponent(key) + '/detail'),
  dormantReportCurrent: (params = {}) => req('GET', '/dormant/reports/current?' + new URLSearchParams(params).toString()),
  dormantReportSnapshotCreate: (payload) => req('POST', '/dormant/reports/snapshots', payload),
  dormantReportSnapshots: () => req('GET', '/dormant/reports/snapshots'),
  dormantReportSnapshot: (id) => req('GET', '/dormant/reports/snapshots/' + encodeURIComponent(id)),
  dormantSummary: (params = {}) => req('GET', '/dormant/summary?' + new URLSearchParams(params).toString()),
  dormantAdminPlans: (params = {}) => req('GET', '/dormant/admin/plans?' + new URLSearchParams(params).toString()),
  dormantNotifications: () => req('GET', '/dormant/notifications'),
  dormantNotificationsRead: (payload = {}) => req('POST', '/dormant/notifications/read', payload),
  dormantEmployeeNotifications: () => req('GET', '/dormant/employee/notifications'),
  dormantEmployeeNotificationsRead: (payload = {}) => req('POST', '/dormant/employee/notifications/read', payload),
  dormantFeedbackCreate: (payload) => req('POST', '/dormant/feedback', payload),
  dormantFeedbackTelegramPreview: (id) => req('GET', '/dormant/feedback/' + encodeURIComponent(id) + '/telegram-preview'),
  dormantFeedbackAck: (id, payload) => req('POST', '/dormant/feedback/' + encodeURIComponent(id) + '/ack', payload),
  revenue: (dimension, ky, extra = {}) => {
    const p = new URLSearchParams({ dimension, ...(ky ? { ky } : {}), ...extra });
    return req('GET', '/revenue?' + p.toString());
  },
  revenueFull: (params = {}) => req('GET', '/revenue/full?' + new URLSearchParams(params).toString()),
  revenueSendRecipients: () => req('GET', '/report/revenue-send/recipients'),
  revenueSendPreview: (payload) => req('POST', '/report/revenue-send/preview', payload),
  revenueSendNow: (payload) => req('POST', '/report/revenue-send/send', payload),
  products: (params = {}) => req('GET', '/products?' + new URLSearchParams(params).toString()),
  analysis: (params = {}) => req('GET', '/analysis?' + new URLSearchParams(params).toString()),
  dailySalesOrders: (params = {}) => req('GET', '/daily-sales/orders?' + new URLSearchParams(params).toString()),
  cst: (params = {}) => req('GET', '/cst?' + new URLSearchParams(params).toString()),
  salesCatalog: (params = {}) => req('GET', '/catalog/sales?' + new URLSearchParams(params).toString()),
  myAssignments: (params = {}) => req('GET', '/assignments/mine?' + new URLSearchParams(params).toString()),
  catalogManagement: (period) => req('GET', '/catalog-management?' + new URLSearchParams(period ? { period } : {}).toString()),
  adminCatalogManagementHistory: (period) => req('GET', '/admin/catalog-management/history?' + new URLSearchParams(period ? { period } : {}).toString()),
  adminCatalogManagementDiagnostics: () => req('GET', '/admin/catalog-management/diagnostics'),
  adminCatalogManagementReportPreview: (payload) => req('POST', '/admin/catalog-management/report/preview', payload),
  adminCatalogManagementDeliveryPreview: (payload) => req('POST', '/admin/catalog-management/report/delivery/preview', payload),
  adminCatalogManagementDeliveryStatus: (previewId) => req('GET', '/admin/catalog-management/report/delivery/' + encodeURIComponent(previewId)),
  adminCatalogManagementTransfer: (payload) => req('POST', '/admin/catalog-management/transfers', payload),
  specialCandidates: () => req('GET', '/specials'),
  adminAssignments: (params = {}) => req('GET', '/admin/assignments?' + new URLSearchParams(params).toString()),
  adminAssignmentSave: (payload) => req('POST', '/admin/assignments', payload),
  adminAssignmentDelete: (id) => req('DELETE', '/admin/assignments/' + encodeURIComponent(id)),
  adminAssignmentSeed: (replaceAuto = false) => req('POST', '/admin/assignments/seed', { replaceAuto }),
  adminAssignmentHistory: () => req('GET', '/admin/assignments/history'),
  adminAssignmentUpload: (file) => {
    const fd = new FormData(); fd.append('file', file);
    return fetch('/api/admin/assignments/upload', { method: 'POST', headers: { 'X-Device-Id': getDeviceId(), ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) }, body: fd }).then(async (res) => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'Lỗi upload phân công'); return data; });
  },
  targets: (params) => req('GET', '/targets' + (params ? `?${new URLSearchParams(typeof params === 'string' ? { ky: params } : params)}` : '')),
  targetKpi: (ky) => req('GET', '/targets/kpi' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  employeeDetail: (emp, ky) => req('GET', '/employee/detail?' + new URLSearchParams({ ...(emp ? { emp } : {}), ...(ky ? { ky } : {}) }).toString()),
  notificationsPreview: (ky) => req('GET', '/admin/notifications/preview' + (ky ? `?ky=${encodeURIComponent(ky)}` : '')),
  notificationsSend: (payload) => req('POST', '/admin/notifications/send', payload || {}),
  notificationsSendOne: (emp_code, ky) => req('POST', '/admin/notifications/send-one', { emp_code, ...(ky ? { ky } : {}) }),
  forecast: () => req('GET', '/targets/forecast'),
  ask: (text, context = null) => req('POST', '/ai/ask', { text, ...(context ? { context } : {}) }),
  lookup: (q, ky) => req('GET', '/lookup?' + new URLSearchParams({ q, ...(ky ? { ky } : {}) }).toString()),
  // Upload
  uploadPreview: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/upload/preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() },
      body: fd,
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'Lỗi upload'), { errors: d.errors, headerDetected: d.headerDetected });
      return d;
    });
  },
  targetUploadPreview: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/admin/targets/upload/preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() },
      body: fd,
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'Lỗi upload target'), { errors: d.errors });
      return d;
    });
  },
  uploadCommit: (payload) => req('POST', '/upload/commit', payload),
  uploadSlots: () => req('GET', '/upload/slots'),
  uploadActivate: (id) => req('POST', '/upload/activate', { id }),
};

function filenameFromDisposition(disposition, fallback) {
  const utf8 = String(disposition || '').match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) { try { return decodeURIComponent(utf8[1].replace(/["']/g, '')); } catch { /* use regular filename */ } }
  return String(disposition || '').match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

export async function downloadDormantReport(format, snapshotId) {
  const extension = format === 'pdf' ? 'pdf' : 'xlsx';
  const url = `/api/dormant/reports/export.${extension}?` + new URLSearchParams({ snapshot_id: snapshotId }).toString();
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được báo cáo QLNB');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filenameFromDisposition(res.headers.get('content-disposition'), `bao-cao-qlnb-${snapshotId}.${extension}`);
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
}

// Tải file export: fetch có token rồi kích hoạt download (an toàn hơn link trần).
export async function downloadExport(kind, params = {}) {
  const url = `/api/export/${kind}.xlsx?` + new URLSearchParams(params).toString();
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!res.ok) throw new Error('Không xuất được file');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report_${kind}_${params.ky || ''}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// Bộ báo cáo doanh thu quản trị: Excel nhiều sheet / CSV / PDF / PowerPoint.
export async function downloadRevenueReport(format = 'xlsx', params = {}) {
  const fmt = ['xlsx', 'csv', 'pdf', 'pptx'].includes(format) ? format : 'xlsx';
  const url = `/api/export/revenue_report.${fmt}?` + new URLSearchParams(params).toString();
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Không xuất được báo cáo');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] || `bao_cao_doanh_thu_${params.ky || ''}.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function downloadCatalogReport(url, payload, fallbackName) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không xuất được báo cáo');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

export async function downloadFilteredEmployeeReport(empCode, payload) {
  return downloadCatalogReport(`/api/admin/catalog-management/report/export/${encodeURIComponent(empCode)}.xlsx`, payload, `bao-cao-ca-nhan-${empCode}.xlsx`);
}

export async function downloadFilteredEmployeeSummary(payload) {
  return downloadCatalogReport('/api/admin/catalog-management/report/export-summary.xlsx', payload, 'tong-hop-bao-cao-nhan-vien.xlsx');
}

export async function downloadAssignmentTemplate(ky) {
  const url = `/api/admin/assignments/template.xlsx?` + new URLSearchParams({ ky: ky || '' }).toString();
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) throw new Error('Không tải được mẫu phân công');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `assignment_template_${ky || ''}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export async function downloadTargetTemplate(ky, basis = 't06') {
  const url = `/api/admin/targets/template.xlsx?` + new URLSearchParams({ ky: ky || '', basis: basis || 't06' }).toString();
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'X-Device-Id': getDeviceId() } });
  if (!res.ok) throw new Error('Không tải được template target');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `target_template_${ky || ''}_${basis || 't06'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
