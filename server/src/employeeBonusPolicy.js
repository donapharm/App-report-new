'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const employeeBonus = require('./employeeBonus');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POLICY_FILE = process.env.EMPLOYEE_BONUS_POLICY_FILE || path.join(DATA_DIR, 'employee_bonus_policies.json');
const AUDIT_FILE = process.env.EMPLOYEE_BONUS_POLICY_AUDIT_FILE || path.join(DATA_DIR, 'employee_bonus_policy_audit.json');
const LAYERS = Object.freeze(['default', 'productGroup', 'route', 'unit', 'employee']);
const LAYER_INDEX = new Map(LAYERS.map((layer, index) => [layer, index]));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function monthKey(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/);
  if (match) return `${match[1]}-${match[2]}`;
  match = text.match(/^(0[1-9]|1[0-2])\.(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  throw Object.assign(new Error('Kỳ/giai đoạn phải có dạng MM.YYYY hoặc YYYY-MM'), { status: 400, code: 'BONUS_POLICY_PERIOD_INVALID' });
}

function normalizeScope(raw = {}) {
  const type = String(raw.type || 'default').trim();
  if (!LAYER_INDEX.has(type)) throw Object.assign(new Error('Tầng cấu hình thưởng không hợp lệ'), { status: 400, code: 'BONUS_POLICY_SCOPE_INVALID' });
  let value = String(raw.value ?? '').trim();
  if (type === 'default') value = '*';
  if (!value) throw Object.assign(new Error('Thiếu giá trị phạm vi cấu hình thưởng'), { status: 400, code: 'BONUS_POLICY_SCOPE_VALUE_REQUIRED' });
  if (type === 'productGroup') {
    value = employeeBonus.normalizePriorityGroup(value);
    if (!value) throw Object.assign(new Error('Nhóm hàng chỉ nhận H.A*, H.A, H.B, H.C, H.D'), { status: 400, code: 'BONUS_POLICY_GROUP_INVALID' });
  } else if (type === 'employee') {
    value = value.toUpperCase();
    if (!/^(?:DN|VP)\d{3}$/.test(value)) throw Object.assign(new Error('Mã nhân viên không hợp lệ'), { status: 400, code: 'BONUS_POLICY_EMPLOYEE_INVALID' });
  } else if (type !== 'default') {
    if (value.length > 160 || /[\u0000-\u001f]/.test(value)) throw Object.assign(new Error('Giá trị phạm vi không hợp lệ'), { status: 400, code: 'BONUS_POLICY_SCOPE_VALUE_INVALID' });
    if (type === 'route') value = value.toUpperCase();
  }
  return { type, value };
}

function rawConfig(config) {
  const normalized = config?.configured == null ? employeeBonus.validateConfig(config) : config;
  if (!normalized.configured) return null;
  return {
    schemaVersion: 2,
    version: normalized.version || '',
    effectiveFrom: normalized.effectiveFrom || '',
    base: employeeBonus.BASE,
    currency: normalized.currency || 'VND',
    baseTiers: normalized.baseTiers.map((tier) => ({ ...tier })),
    priorityThresholdPct: normalized.priorityThresholdPct,
    priorityRates: { ...normalized.priorityRates },
    totalCapPct: normalized.totalCapPct,
  };
}

function normalizePatch(raw = {}, seedConfig) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('Cấu hình thưởng không hợp lệ'), { status: 400, code: 'BONUS_POLICY_PATCH_INVALID' });
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'baseTiers')) patch.baseTiers = raw.baseTiers;
  if (Object.prototype.hasOwnProperty.call(raw, 'priorityThresholdPct')) patch.priorityThresholdPct = raw.priorityThresholdPct;
  if (Object.prototype.hasOwnProperty.call(raw, 'priorityRates')) patch.priorityRates = raw.priorityRates;
  if (Object.prototype.hasOwnProperty.call(raw, 'totalCapPct')) patch.totalCapPct = raw.totalCapPct;
  if (!Object.keys(patch).length) throw Object.assign(new Error('Chưa có trường cấu hình nào để lưu'), { status: 400, code: 'BONUS_POLICY_PATCH_EMPTY' });
  const candidate = mergeConfig(seedConfig, patch);
  const validated = employeeBonus.validateConfig(candidate);
  if (!validated.configured) throw Object.assign(new Error(`Cấu hình thưởng sai: ${validated.reason}`), { status: 400, code: 'BONUS_POLICY_CONFIG_INVALID', details: { reason: validated.reason } });
  const normalized = {};
  if (patch.baseTiers) normalized.baseTiers = validated.baseTiers;
  if (Object.prototype.hasOwnProperty.call(patch, 'priorityThresholdPct')) normalized.priorityThresholdPct = validated.priorityThresholdPct;
  if (patch.priorityRates) {
    normalized.priorityRates = {};
    for (const [group, value] of Object.entries(patch.priorityRates)) {
      const official = employeeBonus.normalizePriorityGroup(group);
      if (!official) throw Object.assign(new Error(`Nhóm rate không hợp lệ: ${group}`), { status: 400, code: 'BONUS_POLICY_GROUP_INVALID' });
      normalized.priorityRates[official] = Number(value);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'totalCapPct')) normalized.totalCapPct = validated.totalCapPct;
  return normalized;
}

function mergeConfig(base, patch = {}) {
  return {
    ...base,
    ...(Object.prototype.hasOwnProperty.call(patch, 'baseTiers') ? { baseTiers: patch.baseTiers } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'priorityThresholdPct') ? { priorityThresholdPct: patch.priorityThresholdPct } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'totalCapPct') ? { totalCapPct: patch.totalCapPct } : {}),
    priorityRates: { ...(base.priorityRates || {}), ...(patch.priorityRates || {}) },
  };
}

function contextValue(context, type) {
  if (type === 'default') return '*';
  const aliases = {
    productGroup: ['productGroup', 'group', 'priorityGroup'],
    route: ['route'], unit: ['unit', 'unitCode'], employee: ['employee', 'empCode'],
  }[type] || [];
  for (const key of aliases) if (context?.[key] != null && String(context[key]).trim()) return String(context[key]).trim();
  return '';
}

function policyMatches(policy, period, context) {
  if (policy.effectiveFrom > period || (policy.effectiveTo && policy.effectiveTo < period)) return false;
  const expected = contextValue(context, policy.scope.type);
  if (!expected) return policy.scope.type === 'default';
  return policy.scope.type === 'employee' || policy.scope.type === 'route'
    ? expected.toUpperCase() === policy.scope.value.toUpperCase()
    : expected === policy.scope.value;
}

function createPolicyStore({ policyFile = POLICY_FILE, auditFile = AUDIT_FILE, seedConfig = null } = {}) {
  const seed = rawConfig(seedConfig || employeeBonus.loadConfig());
  if (!seed) throw new Error('Default employee bonus v2 config is invalid');

  function list() {
    const root = readJson(policyFile, { schemaVersion: 1, policies: [] });
    return Array.isArray(root.policies) ? root.policies : [];
  }

  function audit() {
    const rows = readJson(auditFile, []);
    return Array.isArray(rows) ? rows : [];
  }

  function resolve({ period, context = {}, extraPolicies = [] } = {}) {
    const key = monthKey(period);
    const candidates = [...list(), ...(Array.isArray(extraPolicies) ? extraPolicies : [])]
      .filter((policy) => policy && policy.scope && LAYER_INDEX.has(policy.scope.type) && policyMatches(policy, key, context));
    const selected = [];
    for (const layer of LAYERS) {
      const matches = candidates.filter((policy) => policy.scope.type === layer)
        .sort((left, right) => String(left.effectiveFrom).localeCompare(String(right.effectiveFrom))
          || Number(left.version || 0) - Number(right.version || 0)
          || String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
      if (matches.length) selected.push(matches.at(-1));
    }
    let merged = { ...seed, priorityRates: { ...seed.priorityRates }, baseTiers: seed.baseTiers.map((tier) => ({ ...tier })) };
    for (const policy of selected) merged = mergeConfig(merged, policy.patch);
    merged.version = selected.length ? selected.map((policy) => `v${policy.version}:${policy.scope.type}`).join('>') : seed.version;
    merged.effectiveFrom = selected.length ? selected.map((policy) => policy.effectiveFrom).sort().at(-1) : seed.effectiveFrom;
    const config = employeeBonus.validateConfig(merged);
    return { configured: config.configured, config, period: key, sources: selected.map((policy) => ({ id: policy.id, version: policy.version, scope: policy.scope, effectiveFrom: policy.effectiveFrom, effectiveTo: policy.effectiveTo || null })) };
  }

  function normalizeCandidate(payload = {}, actor = 'CEO') {
    const effectiveFrom = monthKey(payload.effectiveFrom || payload.period);
    const effectiveTo = payload.effectiveTo ? monthKey(payload.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw Object.assign(new Error('Giai đoạn kết thúc trước giai đoạn bắt đầu'), { status: 400, code: 'BONUS_POLICY_RANGE_INVALID' });
    const scope = normalizeScope(payload.scope || { type: payload.scopeType, value: payload.scopeValue });
    const baseForScope = resolve({ period: effectiveFrom, context: {
      productGroup: scope.type === 'productGroup' ? scope.value : undefined,
      route: scope.type === 'route' ? scope.value : undefined,
      unit: scope.type === 'unit' ? scope.value : undefined,
      employee: scope.type === 'employee' ? scope.value : undefined,
    } }).config;
    const patch = normalizePatch(payload.patch || payload.config || {}, rawConfig(baseForScope) || seed);
    return {
      id: String(payload.id || `bonus-policy-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`),
      version: Number(payload.version || 0), effectiveFrom, effectiveTo, scope, patch,
      note: String(payload.note || '').trim().slice(0, 500), actor: String(actor || 'CEO').slice(0, 80), createdAt: new Date().toISOString(),
    };
  }

  function preview(payload = {}, actor = 'CEO') {
    const candidate = normalizeCandidate(payload, actor);
    candidate.version = Math.max(0, ...list().map((policy) => Number(policy.version || 0))) + 1;
    const context = payload.context || {
      productGroup: candidate.scope.type === 'productGroup' ? candidate.scope.value : undefined,
      route: candidate.scope.type === 'route' ? candidate.scope.value : undefined,
      unit: candidate.scope.type === 'unit' ? candidate.scope.value : undefined,
      employee: candidate.scope.type === 'employee' ? candidate.scope.value : undefined,
    };
    return { candidate, resolved: resolve({ period: payload.previewPeriod || candidate.effectiveFrom, context, extraPolicies: [candidate] }) };
  }

  function save(payload = {}, actor = 'CEO') {
    const candidate = normalizeCandidate(payload, actor);
    const policies = list();
    candidate.version = Math.max(0, ...policies.map((policy) => Number(policy.version || 0))) + 1;
    const resolved = resolve({ period: candidate.effectiveFrom, context: {
      productGroup: candidate.scope.type === 'productGroup' ? candidate.scope.value : undefined,
      route: candidate.scope.type === 'route' ? candidate.scope.value : undefined,
      unit: candidate.scope.type === 'unit' ? candidate.scope.value : undefined,
      employee: candidate.scope.type === 'employee' ? candidate.scope.value : undefined,
    }, extraPolicies: [candidate] });
    if (!resolved.configured) throw Object.assign(new Error('Cấu hình sau khi đè tầng không hợp lệ'), { status: 400, code: 'BONUS_POLICY_RESOLUTION_INVALID' });
    writeAtomic(policyFile, { schemaVersion: 1, policies: [...policies, candidate] });
    const event = { action: 'bonus_policy_saved', at: candidate.createdAt, actor: candidate.actor, policyId: candidate.id, version: candidate.version, effectiveFrom: candidate.effectiveFrom, effectiveTo: candidate.effectiveTo, scope: candidate.scope, note: candidate.note };
    writeAtomic(auditFile, [event, ...audit()].slice(0, 2000));
    return { policy: candidate, resolved };
  }

  return { list, audit, resolve, preview, save, normalizeCandidate, files: { policyFile, auditFile } };
}

const store = createPolicyStore();
module.exports = { POLICY_FILE, AUDIT_FILE, LAYERS, monthKey, normalizeScope, mergeConfig, createPolicyStore, list: store.list, audit: store.audit, resolve: store.resolve, preview: store.preview, save: store.save };
