'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const employeeBonus = require('./employeeBonus');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POLICY_FILE = process.env.EMPLOYEE_BONUS_POLICY_FILE || path.join(DATA_DIR, 'employee_bonus_policies.json');
const AUDIT_FILE = process.env.EMPLOYEE_BONUS_POLICY_AUDIT_FILE || path.join(DATA_DIR, 'employee_bonus_policy_audit.json');
const LAYERS = Object.freeze(['default', 'productGroup', 'route', 'unit', 'employee']);
const TARGET_LAYERS = Object.freeze(['default', 'route', 'unit', 'employee']);
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
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
    schemaVersion: employeeBonus.SCHEMA_VERSION,
    version: normalized.version || '', effectiveFrom: normalized.effectiveFrom || '',
    base: employeeBonus.BASE, currency: normalized.currency || 'VND',
    baseTiers: normalized.baseTiers.map((tier) => ({ ...tier })),
    priorityThresholdPct: normalized.priorityThresholdPct,
    priorityRates: { ...normalized.priorityRates },
    priorityTargets: { ...normalized.priorityTargets },
    totalCapPct: normalized.totalCapPct,
  };
}

function mergeConfig(base, patch = {}) {
  return {
    ...base,
    ...(Object.prototype.hasOwnProperty.call(patch, 'baseTiers') ? { baseTiers: patch.baseTiers } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'priorityThresholdPct') ? { priorityThresholdPct: patch.priorityThresholdPct } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'totalCapPct') ? { totalCapPct: patch.totalCapPct } : {}),
    priorityRates: { ...(base.priorityRates || {}), ...(patch.priorityRates || {}) },
    priorityTargets: { ...(base.priorityTargets || {}), ...(patch.priorityTargets || {}) },
  };
}

function normalizePatch(raw = {}, seedConfig, scope = { type: 'default' }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('Cấu hình thưởng không hợp lệ'), { status: 400, code: 'BONUS_POLICY_PATCH_INVALID' });
  const patch = {};
  for (const key of ['baseTiers', 'priorityThresholdPct', 'priorityRates', 'priorityTargets', 'totalCapPct']) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) patch[key] = raw[key];
  }
  if (!Object.keys(patch).length) throw Object.assign(new Error('Chưa có trường cấu hình nào để lưu'), { status: 400, code: 'BONUS_POLICY_PATCH_EMPTY' });
  if (Object.prototype.hasOwnProperty.call(patch, 'priorityTargets') && !TARGET_LAYERS.includes(scope.type)) {
    throw Object.assign(new Error('Target nhóm chỉ hỗ trợ tầng Mặc định, tuyến, đơn vị hoặc NV.'), { status: 400, code: 'BONUS_POLICY_TARGET_SCOPE_INVALID' });
  }
  if (patch.priorityTargets != null && (typeof patch.priorityTargets !== 'object' || Array.isArray(patch.priorityTargets))) {
    throw Object.assign(new Error('Target nhóm không hợp lệ'), { status: 400, code: 'BONUS_POLICY_TARGET_INVALID' });
  }
  if (patch.priorityTargets) {
    for (const [group, value] of Object.entries(patch.priorityTargets)) {
      const official = employeeBonus.normalizePriorityGroup(group);
      if (!official) throw Object.assign(new Error(`Nhóm target không hợp lệ: ${group}`), { status: 400, code: 'BONUS_POLICY_GROUP_INVALID' });
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw Object.assign(new Error(`Target nhóm ${official} phải là số không âm hoặc để trống.`), { status: 400, code: 'BONUS_POLICY_TARGET_INVALID' });
      }
    }
  }
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
  if (patch.priorityTargets) {
    normalized.priorityTargets = {};
    for (const [group, value] of Object.entries(patch.priorityTargets)) {
      const official = employeeBonus.normalizePriorityGroup(group);
      normalized.priorityTargets[official] = value == null ? null : Number(value);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'totalCapPct')) normalized.totalCapPct = validated.totalCapPct;
  return normalized;
}

function contextValue(context, type) {
  if (type === 'default') return '*';
  const aliases = {
    productGroup: ['productGroup', 'group', 'priorityGroup'], route: ['route'],
    unit: ['unit', 'unitCode'], employee: ['employee', 'empCode'],
  }[type] || [];
  for (const key of aliases) if (context?.[key] != null && String(context[key]).trim()) return String(context[key]).trim();
  return '';
}

function policyMatches(policy, period, context) {
  if (policy.effectiveFrom > period || (policy.effectiveTo && policy.effectiveTo < period)) return false;
  const expected = contextValue(context, policy.scope.type);
  if (!expected) return policy.scope.type === 'default';
  return policy.scope.type === 'employee' || policy.scope.type === 'route'
    ? expected.toUpperCase() === policy.scope.value.toUpperCase() : expected === policy.scope.value;
}

function createPolicyStore({ policyFile = POLICY_FILE, auditFile = AUDIT_FILE, seedConfig = null } = {}) {
  const seed = rawConfig(seedConfig || employeeBonus.loadConfig());
  if (!seed) throw new Error('Default employee bonus v3 config is invalid');

  function list() {
    const root = readJson(policyFile, { schemaVersion: 1, policies: [] });
    return Array.isArray(root.policies) ? root.policies : [];
  }
  function audit() {
    const rows = readJson(auditFile, []);
    return Array.isArray(rows) ? rows : [];
  }
  function revision(policies = list()) { return sha256({ schemaVersion: 1, policies }); }

  function resolve({ period, context = {}, extraPolicies = [] } = {}) {
    const key = monthKey(period);
    const active = [...list(), ...(Array.isArray(extraPolicies) ? extraPolicies : [])]
      .filter((policy) => policy && policy.scope && LAYER_INDEX.has(policy.scope.type)
        && policy.effectiveFrom <= key && (!policy.effectiveTo || policy.effectiveTo >= key));
    const candidates = active.filter((policy) => policyMatches(policy, key, context));
    const selected = [];
    for (const layer of LAYERS) {
      const matches = candidates.filter((policy) => policy.scope.type === layer)
        .sort((left, right) => String(left.effectiveFrom).localeCompare(String(right.effectiveFrom))
          || Number(left.version || 0) - Number(right.version || 0)
          || String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
      if (matches.length) selected.push(matches.at(-1));
    }
    let merged = {
      ...seed, priorityRates: { ...seed.priorityRates }, priorityTargets: { ...seed.priorityTargets },
      baseTiers: seed.baseTiers.map((tier) => ({ ...tier })),
    };
    const priorityTargetSources = Object.fromEntries(employeeBonus.PRIORITY_GROUPS.map((group) => [
      group, seed.priorityTargets[group] == null ? null : { id: 'seed', version: 0, scope: { type: 'default', value: '*' }, effectiveFrom: monthKey(seed.effectiveFrom) },
    ]));
    const priorityTargetStatuses = Object.fromEntries(employeeBonus.PRIORITY_GROUPS.map((group) => [group, null]));
    for (const policy of selected) {
      merged = mergeConfig(merged, policy.patch);
      for (const group of employeeBonus.PRIORITY_GROUPS) {
        if (Object.prototype.hasOwnProperty.call(policy.patch?.priorityTargets || {}, group)) {
          priorityTargetSources[group] = { id: policy.id, version: policy.version, scope: policy.scope, effectiveFrom: policy.effectiveFrom, effectiveTo: policy.effectiveTo || null };
        }
      }
    }
    if (context?.targetScopeStrict === true) {
      const employeePolicy = selected.find((policy) => policy.scope.type === 'employee');
      for (const group of employeeBonus.PRIORITY_GROUPS) {
        // An explicit employee value (including null = deliberately unassigned) is
        // the highest target layer and therefore resolves the ambiguity below it.
        if (Object.prototype.hasOwnProperty.call(employeePolicy?.patch?.priorityTargets || {}, group)) continue;
        const ambiguous = active.some((policy) => ['route', 'unit'].includes(policy.scope.type)
          && !contextValue(context, policy.scope.type)
          && Object.prototype.hasOwnProperty.call(policy.patch?.priorityTargets || {}, group));
        if (ambiguous) priorityTargetStatuses[group] = 'ambiguous_scope';
      }
    }
    merged.version = selected.length ? selected.map((policy) => `v${policy.version}:${policy.scope.type}`).join('>') : seed.version;
    merged.effectiveFrom = selected.length ? selected.map((policy) => policy.effectiveFrom).sort().at(-1) : seed.effectiveFrom;
    const config = employeeBonus.validateConfig(merged);
    return {
      configured: config.configured, config, period: key, priorityTargetSources, priorityTargetStatuses,
      sources: selected.map((policy) => ({ id: policy.id, version: policy.version, scope: policy.scope, effectiveFrom: policy.effectiveFrom, effectiveTo: policy.effectiveTo || null })),
    };
  }

  function normalizeCandidate(payload = {}, actor = 'CEO') {
    const effectiveFrom = monthKey(payload.effectiveFrom || payload.period);
    const effectiveTo = payload.effectiveTo ? monthKey(payload.effectiveTo) : null;
    if (effectiveFrom < employeeBonus.BONUS_V3_EFFECTIVE_MONTH) {
      throw Object.assign(new Error('Thưởng v3 chỉ hiệu lực từ T07.2026; không sửa kỳ đã đóng trước đó.'), { status: 409, code: 'BONUS_POLICY_CLOSED_PERIOD' });
    }
    if (effectiveTo && effectiveTo < effectiveFrom) throw Object.assign(new Error('Giai đoạn kết thúc trước giai đoạn bắt đầu'), { status: 400, code: 'BONUS_POLICY_RANGE_INVALID' });
    const scope = normalizeScope(payload.scope || { type: payload.scopeType, value: payload.scopeValue });
    const context = {
      productGroup: scope.type === 'productGroup' ? scope.value : undefined,
      route: scope.type === 'route' ? scope.value : undefined,
      unit: scope.type === 'unit' ? scope.value : undefined,
      employee: scope.type === 'employee' ? scope.value : undefined,
    };
    const baseForScope = resolve({ period: effectiveFrom, context }).config;
    const patch = normalizePatch(payload.patch || payload.config || {}, rawConfig(baseForScope) || seed, scope);
    return {
      id: String(payload.id || `bonus-policy-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`),
      version: Number(payload.version || 0), effectiveFrom, effectiveTo, scope, patch,
      note: String(payload.note || '').trim().slice(0, 500), actor: String(actor || 'CEO').slice(0, 80), createdAt: new Date().toISOString(),
    };
  }

  function preview(payload = {}, actor = 'CEO') {
    const policies = list();
    const candidate = normalizeCandidate(payload, actor);
    candidate.version = Math.max(0, ...policies.map((policy) => Number(policy.version || 0))) + 1;
    const context = payload.context || {
      productGroup: candidate.scope.type === 'productGroup' ? candidate.scope.value : undefined,
      route: candidate.scope.type === 'route' ? candidate.scope.value : undefined,
      unit: candidate.scope.type === 'unit' ? candidate.scope.value : undefined,
      employee: candidate.scope.type === 'employee' ? candidate.scope.value : undefined,
    };
    const currentRevision = revision(policies);
    const resolved = resolve({ period: payload.previewPeriod || candidate.effectiveFrom, context, extraPolicies: [candidate] });
    const previewHash = sha256({ candidate, revision: currentRevision, actor: String(actor || 'CEO') });
    return { candidate, resolved, revision: currentRevision, previewHash };
  }

  function persistCandidate(candidate, actor, { expectedRevision = null, previewHash = null } = {}) {
    const policies = list();
    const currentRevision = revision(policies);
    if (expectedRevision && currentRevision !== expectedRevision) {
      throw Object.assign(new Error('Cấu hình đã thay đổi sau khi preview. Vui lòng mô phỏng lại.'), { status: 409, code: 'BONUS_POLICY_REVISION_CHANGED' });
    }
    const expectedVersion = Math.max(0, ...policies.map((policy) => Number(policy.version || 0))) + 1;
    if (Number(candidate.version) !== expectedVersion) {
      throw Object.assign(new Error('Version preview không còn mới nhất. Vui lòng mô phỏng lại.'), { status: 409, code: 'BONUS_POLICY_REVISION_CHANGED' });
    }
    const context = {
      productGroup: candidate.scope.type === 'productGroup' ? candidate.scope.value : undefined,
      route: candidate.scope.type === 'route' ? candidate.scope.value : undefined,
      unit: candidate.scope.type === 'unit' ? candidate.scope.value : undefined,
      employee: candidate.scope.type === 'employee' ? candidate.scope.value : undefined,
    };
    const before = resolve({ period: candidate.effectiveFrom, context });
    const after = resolve({ period: candidate.effectiveFrom, context, extraPolicies: [candidate] });
    if (!after.configured) throw Object.assign(new Error('Cấu hình sau khi đè tầng không hợp lệ'), { status: 400, code: 'BONUS_POLICY_RESOLUTION_INVALID' });
    writeAtomic(policyFile, { schemaVersion: 1, policies: [...policies, candidate] });
    const event = {
      action: 'bonus_policy_saved', at: candidate.createdAt, actor: String(actor || candidate.actor || 'CEO'),
      policyId: candidate.id, version: candidate.version, effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo, scope: candidate.scope, patch: candidate.patch,
      beforeConfig: rawConfig(before.config), afterConfig: rawConfig(after.config),
      beforeSources: before.sources, afterSources: after.sources,
      revisionBefore: currentRevision, revisionAfter: revision([...policies, candidate]),
      candidateHash: sha256(candidate), previewHash, note: candidate.note,
    };
    writeAtomic(auditFile, [event, ...audit()].slice(0, 2000));
    return { policy: candidate, resolved: after, revision: revision([...policies, candidate]), previewHash };
  }

  function savePreview(previewResult, actor = 'CEO') {
    if (!previewResult?.candidate || !previewResult.revision || !previewResult.previewHash) {
      throw Object.assign(new Error('Thiếu candidate preview chuẩn để lưu.'), { status: 409, code: 'BONUS_POLICY_PREVIEW_REQUIRED' });
    }
    const expectedHash = sha256({ candidate: previewResult.candidate, revision: previewResult.revision, actor: String(actor || 'CEO') });
    if (expectedHash !== previewResult.previewHash || String(previewResult.candidate.actor) !== String(actor)) {
      throw Object.assign(new Error('Preview không thuộc đúng actor hoặc đã bị thay đổi.'), { status: 409, code: 'BONUS_POLICY_PREVIEW_REQUIRED' });
    }
    return persistCandidate(previewResult.candidate, actor, { expectedRevision: previewResult.revision, previewHash: previewResult.previewHash });
  }

  // Direct save remains for trusted internal tests/imports; public routes must call savePreview.
  function save(payload = {}, actor = 'CEO') {
    const policies = list();
    const candidate = normalizeCandidate(payload, actor);
    candidate.version = Math.max(0, ...policies.map((policy) => Number(policy.version || 0))) + 1;
    return persistCandidate(candidate, actor);
  }

  return { list, audit, revision, resolve, preview, savePreview, save, normalizeCandidate, files: { policyFile, auditFile } };
}

const store = createPolicyStore();
module.exports = {
  POLICY_FILE, AUDIT_FILE, LAYERS, TARGET_LAYERS, monthKey, normalizeScope, mergeConfig, createPolicyStore,
  list: store.list, audit: store.audit, revision: store.revision, resolve: store.resolve,
  preview: store.preview, savePreview: store.savePreview, save: store.save,
};
