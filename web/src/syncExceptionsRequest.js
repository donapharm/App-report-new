export function syncExceptionsRequestPath(ky, freshKey = null) {
  const base = `/revenue/sync-exceptions?ky=${encodeURIComponent(ky)}`;
  if (freshKey == null) return base;
  return `${base}&refresh=${encodeURIComponent(String(freshKey))}`;
}
