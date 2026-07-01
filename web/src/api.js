// api.js — gọi backend, tự đính token. Frontend KHÔNG tự quyết quyền.
const TOKEN_KEY = 'rpt_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function req(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
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
  me: () => req('GET', '/me'),
  periods: () => req('GET', '/periods'),
  overview: (ky) => req('GET', '/overview' + (ky ? `?ky=${ky}` : '')),
  alerts: () => req('GET', '/alerts'),
  revenue: (dimension, ky, extra = {}) => {
    const p = new URLSearchParams({ dimension, ...(ky ? { ky } : {}), ...extra });
    return req('GET', '/revenue?' + p.toString());
  },
  cst: (params = {}) => req('GET', '/cst?' + new URLSearchParams(params).toString()),
  targets: (ky) => req('GET', '/targets' + (ky ? `?ky=${ky}` : '')),
  forecast: () => req('GET', '/targets/forecast'),
  ask: (text) => req('POST', '/ai/ask', { text }),
  // Upload
  uploadPreview: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/upload/preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: fd,
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'Lỗi upload'), { errors: d.errors, headerDetected: d.headerDetected });
      return d;
    });
  },
  uploadCommit: (payload) => req('POST', '/upload/commit', payload),
  uploadSlots: () => req('GET', '/upload/slots'),
  uploadActivate: (id) => req('POST', '/upload/activate', { id }),
};

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
