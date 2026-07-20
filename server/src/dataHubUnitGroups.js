const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE = process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE
  || path.join(__dirname, '..', 'data', 'datahub_unit_groups_lkg.json');
const DEFAULT_TIMEOUT_MS = 6500;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
let memory = null;
let inflight = null;

function normalizeGroupKey(value = '') {
  return String(value || '').trim().replace(/\.+$/, '');
}
function normalizeUnitCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}
function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function configured() {
  return Boolean(String(process.env.DATA_HUB_BASE_URL || '').trim()
    && String(process.env.DATA_HUB_ASSIGNMENT_KEY || '').trim());
}
function baseUrl() {
  return String(process.env.DATA_HUB_BASE_URL || '').trim().replace(/\/$/, '');
}
function error(message, code = 'DATA_HUB_UNIT_GROUPS_INVALID', status = 502) {
  return Object.assign(new Error(message), { code, status, upstream: true });
}
function normalizeMember(member = {}) {
  const code = String(member.code || '').trim();
  if (!code) throw error('Data Hub có thành viên nhóm đơn vị thiếu mã.');
  return {
    code,
    name: String(member.name || '').trim(),
    route: member.route == null ? null : String(member.route).trim(),
    type: String(member.type || 'CS').trim() || 'CS',
    unitClass: member.unitClass == null ? null : String(member.unitClass).trim(),
    active: member.active ?? null,
  };
}
function validateSnapshot(payload = {}) {
  if (payload.contract !== 'app-report.unit-groups.v1') {
    throw error(`Sai contract nhóm đơn vị: ${String(payload.contract || '(trống)')}`);
  }
  if (!Array.isArray(payload.groups) || !payload.groups.length) {
    throw error('Data Hub trả danh mục nhóm đơn vị rỗng.', 'DATA_HUB_UNIT_GROUPS_EMPTY');
  }
  const expectedChecksum = checksum({
    groups: payload.groups,
    totalUnits: payload.totalUnits,
    totalGroups: payload.totalGroups,
    sharedGroups: payload.sharedGroups,
  });
  if (!/^[a-f0-9]{64}$/i.test(String(payload.checksum || ''))
    || String(payload.checksum).toLowerCase() !== expectedChecksum) {
    throw error('Data Hub trả checksum nhóm đơn vị không hợp lệ.', 'DATA_HUB_UNIT_GROUPS_CHECKSUM');
  }
  const bases = new Set();
  const unitOwners = new Map();
  const groups = payload.groups.map((raw) => {
    const base = normalizeGroupKey(raw.base);
    if (!base || bases.has(base)) throw error(`Nhóm đơn vị trùng/không hợp lệ: ${base || '(trống)'}`);
    bases.add(base);
    if (!Array.isArray(raw.members) || !raw.members.length) throw error(`Nhóm ${base} không có thành viên.`);
    const members = raw.members.map(normalizeMember);
    const local = new Set();
    for (const member of members) {
      const key = normalizeUnitCode(member.code);
      if (local.has(key)) throw error(`Nhóm ${base} trùng mã đơn vị ${member.code}.`);
      local.add(key);
      const owner = unitOwners.get(key);
      if (owner && owner !== base) throw error(`Mã đơn vị ${member.code} xuất hiện ở cả nhóm ${owner} và ${base}.`);
      unitOwners.set(key, base);
    }
    if (Number(raw.count) !== members.length) throw error(`Nhóm ${base} sai số lượng thành viên.`);
    return {
      base,
      label: String(raw.label || base).trim(),
      count: members.length,
      types: raw.types && typeof raw.types === 'object' ? raw.types : {},
      classes: Array.isArray(raw.classes) ? raw.classes.map(String) : [],
      conflict: !!raw.conflict,
      suspect: !!raw.suspect,
      flagged: !!raw.flagged,
      members,
    };
  });
  if (Number(payload.totalGroups) !== groups.length) throw error('Data Hub sai tổng số nhóm đơn vị.');
  if (Number(payload.totalUnits) !== unitOwners.size) throw error('Data Hub sai tổng số đơn vị duy nhất.');
  const body = {
    contract: payload.contract,
    source: String(payload.source || 'data-hub.catalogs+units'),
    version: String(payload.version || 'unknown'),
    sourceChecksum: String(payload.sourceChecksum || payload.checksum).toLowerCase(),
    updatedAt: payload.updatedAt || null,
    totalUnits: unitOwners.size,
    totalGroups: groups.length,
    sharedGroups: Number(payload.sharedGroups) || groups.filter((group) => group.count >= 2).length,
    groups,
  };
  // Cache the normalized representation with its own checksum while retaining
  // DataHub's verified source checksum for diagnostics.
  body.checksum = checksum({
    groups: body.groups,
    totalUnits: body.totalUnits,
    totalGroups: body.totalGroups,
    sharedGroups: body.sharedGroups,
  });
  return body;
}
function writeCacheAtomic(snapshot) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const tmp = `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CACHE_FILE);
}
function readCache() {
  try { return validateSnapshot(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))); }
  catch { return null; }
}
async function remoteSnapshot() {
  const timeoutMs = Math.max(1000, Number(process.env.DATA_HUB_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl()}/api/integrations/app-report/unit-groups`, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'x-assignment-key': String(process.env.DATA_HUB_ASSIGNMENT_KEY || '') },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw error(body.error || `Data Hub HTTP ${response.status}`, 'DATA_HUB_UNIT_GROUPS_HTTP', response.status);
    const snapshot = validateSnapshot(body?.data && typeof body.data === 'object' ? body.data : body);
    writeCacheAtomic(snapshot);
    return snapshot;
  } catch (cause) {
    if (cause.name === 'AbortError') throw error(`Data Hub timeout sau ${timeoutMs}ms`, 'DATA_HUB_UNIT_GROUPS_TIMEOUT');
    throw cause;
  } finally { clearTimeout(timer); }
}
function withMeta(snapshot, meta = {}) {
  return { ...snapshot, meta: { source: meta.source || 'data-hub', stale: !!meta.stale, message: meta.message || null, lastSyncAt: meta.lastSyncAt || null } };
}
async function getSnapshot({ force = false } = {}) {
  const ttlMs = Math.max(1000, Number(process.env.DATA_HUB_UNIT_GROUPS_CACHE_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS);
  if (!force && memory && Date.now() - memory.at < ttlMs) return memory.value;
  if (configured()) {
    if (!force && inflight) return inflight;
    const load = (async () => {
    try {
      const snapshot = await remoteSnapshot();
      const value = withMeta(snapshot, { source: 'data-hub', lastSyncAt: new Date().toISOString() });
      memory = { at: Date.now(), value };
      return value;
    } catch (cause) {
      const fallback = memory?.value || readCache();
      if (fallback) {
        const value = withMeta(fallback, { source: 'data-hub-lkg', stale: true, message: `Data Hub tạm lỗi; giữ bản tốt gần nhất. ${cause.message}` });
        memory = { at: Date.now(), value };
        return value;
      }
      throw Object.assign(error(`Data Hub tạm lỗi và chưa có bản nhóm đơn vị tốt gần nhất: ${cause.message}`, 'DATA_HUB_UNIT_GROUPS_UNAVAILABLE', 503), { cause });
    }
    })();
    if (!force) inflight = load;
    try { return await load; }
    finally { if (inflight === load) inflight = null; }
  }
  const fallback = memory?.value || readCache();
  if (fallback) {
    const value = withMeta(fallback, { source: 'data-hub-lkg', stale: true, message: 'Data Hub chưa được cấu hình; dùng bản nhóm đơn vị tốt gần nhất.' });
    memory = { at: Date.now(), value };
    return value;
  }
  throw error('Data Hub chưa được cấu hình và chưa có bản nhóm đơn vị tốt gần nhất.', 'DATA_HUB_UNIT_GROUPS_UNAVAILABLE', 503);
}
async function membersFor(groupInput) {
  const key = normalizeGroupKey(groupInput);
  if (!key) return { key: '', group: null, codes: [] };
  const snapshot = await getSnapshot();
  const group = snapshot.groups.find((item) => item.base === key) || null;
  return { key, group, codes: group ? group.members.map((member) => member.code) : [], snapshot };
}
function memberRouteTokens(member = {}) {
  const tokens = new Set(String(member.type || '').toUpperCase().split('/').map((item) => item.trim()).filter(Boolean));
  const route = String(member.route || '').toUpperCase();
  if (/\bNCL\b/.test(route)) tokens.add('NCL');
  else if (/\bCL\b/.test(route)) tokens.add('CL');
  if (/\bNT\b|NHÀ THUỐC|NHA THUOC/.test(route)) tokens.add('NT');
  return tokens;
}
function memberMatchesRoutes(member, routeValue) {
  const selected = String(routeValue || '').split('|').map((item) => item.trim().toUpperCase()).filter(Boolean);
  if (!selected.length) return true;
  const tokens = memberRouteTokens(member);
  return selected.some((route) => tokens.has(route) || String(member.route || '').trim().toUpperCase() === route);
}
function facetEmployeeCodes({ isAdmin = false, ownEmployee = '', selectedEmployees = [] } = {}) {
  const selected = [...new Set(selectedEmployees.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];
  if (isAdmin) return selected;
  const own = String(ownEmployee || '').trim().toUpperCase();
  if (!own || (selected.length && !selected.includes(own))) return [];
  return [own];
}
function diagnostics() {
  return {
    configured: configured(),
    endpoint: configured() ? `${baseUrl()}/api/integrations/app-report/unit-groups` : null,
    cacheFile: CACHE_FILE,
    memory: memory ? { at: memory.at, version: memory.value.version, stale: !!memory.value.meta?.stale } : null,
  };
}
function resetForTests() { memory = null; inflight = null; }

module.exports = {
  CACHE_FILE,
  configured,
  normalizeGroupKey,
  normalizeUnitCode,
  validateSnapshot,
  getSnapshot,
  membersFor,
  memberRouteTokens,
  memberMatchesRoutes,
  facetEmployeeCodes,
  diagnostics,
  resetForTests,
};
