const EXCHANGE_URL = String(process.env.HOME_SSO_EXCHANGE_URL || 'http://127.0.0.1:3862/api/sso/exchange').trim();
const TIMEOUT_MS = Math.min(10_000, Math.max(500, Number(process.env.HOME_SSO_TIMEOUT_MS || 3000) || 3000));
const ALLOWED_COOKIES = new Set(['sso_token', 'sso_device_binding']);

function selectedCookieHeader(rawCookie) {
  const selected = [];
  for (const part of String(rawCookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    const value = rest.join('=').trim();
    if (ALLOWED_COOKIES.has(name) && value) selected.push(`${name}=${value}`);
  }
  return selected.join('; ');
}

function normalizePhone(value) {
  let phone = String(value || '').replace(/[^0-9]/g, '');
  if (phone.startsWith('84') && phone.length >= 11) phone = `0${phone.slice(2)}`;
  return phone;
}

function normalizeIdentity(data) {
  const user = data?.user || {};
  return {
    phone: normalizePhone(data?.phone || data?.sdt || user.phone || user.sdt),
    empCode: String(data?.emp_code || data?.empCode || user.emp_code || user.empCode || user.code || '').trim().toUpperCase(),
    name: String(data?.emp_name || data?.empName || user.emp_name || user.empName || user.name || '').trim(),
  };
}

async function exchange(rawCookie, options = {}) {
  const cookie = selectedCookieHeader(rawCookie);
  if (!/(?:^|; )sso_token=/.test(cookie) || !/(?:^|; )sso_device_binding=/.test(cookie)) {
    const error = new Error('Thiếu phiên Home đã ràng buộc thiết bị.');
    error.status = 401;
    error.code = 'SSO_BINDING_REQUIRED';
    throw error;
  }
  const fetchImpl = options.fetchImpl || global.fetch;
  let response;
  let data;
  try {
    response = await fetchImpl(options.url || EXCHANGE_URL, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(options.timeoutMs || TIMEOUT_MS),
    });
    data = await response.json().catch(() => null);
  } catch {
    const error = new Error('Home SSO tạm thời không phản hồi.');
    error.status = 502;
    error.code = 'HOME_SSO_UNAVAILABLE';
    throw error;
  }
  if (!response.ok || data?.ok !== true) {
    const error = new Error('Phiên Home không hợp lệ hoặc không thuộc thiết bị này.');
    error.status = response.status === 401 ? 401 : 502;
    error.code = String(data?.code || 'HOME_SSO_REJECTED');
    throw error;
  }
  return normalizeIdentity(data);
}

module.exports = { exchange, normalizeIdentity, selectedCookieHeader };
