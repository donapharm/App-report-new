export function normalizeTargetNavigation(payload = {}) {
  if (payload?.tab !== 'target' || payload?.targetView !== 'admin') return {};
  return {
    ky: /^\d{2}\.\d{4}$/.test(String(payload.ky || '')) ? String(payload.ky) : '',
    emp: String(payload.emp || '').trim().toUpperCase(),
    openAdmin: true,
  };
}

export function targetAdminKyAfterPeriods(currentKy, periodsPayload = {}) {
  const current = String(currentKy || '').trim();
  if (current) return current;
  return String(periodsPayload.latest || periodsPayload.periods?.at(-1)?.ky || '');
}
