const PREFIX = 'app-report:swr:v1';
export const SWR_SCHEMA_VERSION = 1;
export const SWR_TTL_MS = 24 * 60 * 60 * 1000;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function actorId(actor = {}) {
  return String(actor.emp_code || actor.empCode || actor.id || '').trim().toUpperCase();
}

export function swrCacheKey({ actor, screen, period }) {
  const id = actorId(actor);
  if (!id || !screen || !period) return '';
  return `${PREFIX}:${encodeURIComponent(id)}:${encodeURIComponent(screen)}:${encodeURIComponent(JSON.stringify(stable(period)))}`;
}

export function validPayload(screen, value) {
  if (screen === 'overview') return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.revenue === 'number' && Array.isArray(value.kys);
  if (screen === 'trend') return Array.isArray(value)
    && value.every((row) => row && typeof row === 'object' && typeof row.ky === 'string');
  return false;
}

export function readSwrCache(storage, spec, now = Date.now()) {
  const key = swrCacheKey(spec);
  if (!key || !storage) return null;
  try {
    const entry = JSON.parse(storage.getItem(key) || 'null');
    if (!entry || entry.schema !== SWR_SCHEMA_VERSION || entry.screen !== spec.screen) return null;
    if (!Number.isFinite(entry.savedAt) || entry.savedAt > now || now - entry.savedAt > SWR_TTL_MS) return null;
    if (!validPayload(spec.screen, entry.value)) return null;
    return { value: entry.value, savedAt: entry.savedAt };
  } catch { return null; }
}

export function writeSwrCache(storage, spec, value, now = Date.now()) {
  const key = swrCacheKey(spec);
  if (!key || !storage || !validPayload(spec.screen, value)) return false;
  try {
    storage.setItem(key, JSON.stringify({ schema: SWR_SCHEMA_VERSION, screen: spec.screen, savedAt: now, value }));
    return true;
  } catch { return false; }
}

export function clearSwrActor(storage, actor) {
  const id = actorId(actor);
  if (!storage || !id) return;
  const prefix = `${PREFIX}:${encodeURIComponent(id)}:`;
  try {
    const remove = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) remove.push(key);
    }
    remove.forEach((key) => storage.removeItem(key));
  } catch { /* restricted storage */ }
}

export function swrTimeLabel(savedAt) {
  if (!Number.isFinite(savedAt)) return '';
  const text = new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  }).format(new Date(savedAt));
  return `số lúc ${text}`;
}
