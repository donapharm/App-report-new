'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const employeeBonus = require('./employeeBonus');
const employeePenalty = require('./employeePenalty');

const DATA_DIR = path.join(__dirname, '..', 'data');
const POLICY_FILE = process.env.EMPLOYEE_PENALTY_POLICY_FILE || path.join(DATA_DIR, 'employee_penalty_policies.json');
const AUDIT_FILE = process.env.EMPLOYEE_PENALTY_POLICY_AUDIT_FILE || path.join(DATA_DIR, 'employee_penalty_policy_audit.json');
const POLICY_SCHEMA_VERSION = 1;
const ENGINE_VERSION = 'penalty-policy-v1';
const MIN_EFFECTIVE_MONTH = '2026-07';
// RÀO CHẮN GÕ SAI SỐ (Claude review 30/07): tỷ lệ phạt là % doanh thu, mức CEO đang
// dùng là 0,2–0,3%. Gõ "30" thay vì "0,3" là phạt gấp 100 lần ⇒ mất trọn C45 của cả
// đội. Chặn cứng trên 5%; từ trên 1% vẫn cho lưu nhưng preview phải cảnh báo.
const MAX_RATE_PCT = 5;
const RATE_WARN_PCT = 1;

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    throw policyError(`File cấu hình phạt bị lỗi JSON: ${path.basename(file)}`, 'PENALTY_POLICY_STORE_CORRUPT', 500, { message: error.message });
  }
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

function policyError(message, code, status = 400, details = undefined) {
  return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}

function ceoActor(actor) {
  const value = String(actor || '').trim().toUpperCase();
  if (value !== 'CEO') throw policyError('Chỉ CEO được thay đổi công thức phạt.', 'PENALTY_POLICY_CEO_REQUIRED', 403);
  return value;
}

function monthKey(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/);
  if (match) return `${match[1]}-${match[2]}`;
  match = text.match(/^(0[1-9]|1[0-2])\.(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  throw policyError('Kỳ/giai đoạn phải có dạng MM.YYYY hoặc YYYY-MM', 'PENALTY_POLICY_PERIOD_INVALID');
}

function monthStartDate(value, field) {
  const text = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(text)) {
    throw policyError(`${field} phải là ngày đầu tháng, dạng YYYY-MM-01`, 'PENALTY_POLICY_DATE_INVALID');
  }
  return text;
}

function finiteInRange(value, field, min, max) {
  if (value === '' || value == null || typeof value === 'boolean') throw policyError(`${field} không được để trống`, 'PENALTY_POLICY_NUMBER_INVALID');
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw policyError(`${field} phải từ ${min} đến ${max}`, 'PENALTY_POLICY_NUMBER_INVALID');
  }
  return number;
}

function parametersFromConfig(raw = {}) {
  const config = employeePenalty.normalizeConfig(raw);
  const byTier = Object.fromEntries((config.penaltyTiers || []).map((tier) => [tier.tier, tier]));
  return {
    penaltyEnabled: config.penaltyEnabled === true,
    warningFrom: config.penaltyWarnFrom || '2026-07-01',
    enforcedFrom: config.penaltyEffectiveFrom || '2026-08-01',
    dropThresholdPct: byTier.drop_c45?.toPct ?? 50,
    upperPenaltyThresholdPct: byTier.t70_90?.fromPct ?? byTier.t50_70?.toPct ?? 70,
    noPenaltyThresholdPct: byTier.none?.fromPct ?? byTier.t70_90?.toPct ?? 90,
    lowerRatePct: byTier.t50_70?.ratePct ?? 0.3,
    upperRatePct: byTier.t70_90?.ratePct ?? 0.2,
    bottomDropC45: byTier.drop_c45?.dropC45 !== false,
    bottomRatePct: byTier.drop_c45?.ratePct ?? 0.3,
    xuEnabled: config.xuPenalty.enabled === true,
    perMissingXu: config.xuPenalty.perMissingXu ?? 300_000,
  };
}

function normalizeParameters(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw policyError('Cấu hình phạt không hợp lệ', 'PENALTY_POLICY_CONFIG_INVALID');
  }
  const parameters = {
    penaltyEnabled: raw.penaltyEnabled === true,
    warningFrom: monthStartDate(raw.warningFrom, 'Ngày bắt đầu cảnh báo'),
    enforcedFrom: monthStartDate(raw.enforcedFrom, 'Ngày bắt đầu trừ thật'),
    dropThresholdPct: finiteInRange(raw.dropThresholdPct, 'Mốc mất C45', 0, 1000),
    upperPenaltyThresholdPct: finiteInRange(raw.upperPenaltyThresholdPct, 'Mốc chuyển bậc phạt trên', 0, 1000),
    noPenaltyThresholdPct: finiteInRange(raw.noPenaltyThresholdPct, 'Mốc không phạt', 0, 1000),
    lowerRatePct: finiteInRange(raw.lowerRatePct, 'Tỷ lệ phạt bậc thấp', 0, MAX_RATE_PCT),
    upperRatePct: finiteInRange(raw.upperRatePct, 'Tỷ lệ phạt bậc trên', 0, MAX_RATE_PCT),
    bottomDropC45: raw.bottomDropC45 === true,
    bottomRatePct: finiteInRange(raw.bottomRatePct, 'Tỷ lệ phạt bậc đáy', 0, MAX_RATE_PCT),
    xuEnabled: raw.xuEnabled === true,
    perMissingXu: Math.round(finiteInRange(raw.perMissingXu, 'Mức phạt mỗi Xu thiếu', 0, 1_000_000_000)),
  };
  if (!(parameters.dropThresholdPct < parameters.upperPenaltyThresholdPct
    && parameters.upperPenaltyThresholdPct < parameters.noPenaltyThresholdPct)) {
    throw policyError('Ba mốc phải tăng dần: mất C45 < chuyển bậc < không phạt', 'PENALTY_POLICY_THRESHOLDS_INVALID');
  }
  if (parameters.warningFrom > parameters.enforcedFrom) {
    throw policyError('Ngày cảnh báo không được sau ngày bắt đầu trừ thật', 'PENALTY_POLICY_DATES_INVALID');
  }
  return parameters;
}

function configFromParameters(raw = {}) {
  const parameters = normalizeParameters(raw);
  const penaltyTiers = [
    {
      tier: 'drop_c45', fromPct: null, toPct: parameters.dropThresholdPct,
      ratePct: parameters.bottomDropC45 ? null : parameters.bottomRatePct,
      dropC45: parameters.bottomDropC45,
    },
    {
      tier: 't50_70', fromExclusivePct: parameters.dropThresholdPct,
      toPct: parameters.upperPenaltyThresholdPct, ratePct: parameters.lowerRatePct,
    },
    {
      tier: 't70_90', fromPct: parameters.upperPenaltyThresholdPct,
      toPct: parameters.noPenaltyThresholdPct, ratePct: parameters.upperRatePct,
    },
    {
      tier: 'none', fromPct: parameters.noPenaltyThresholdPct, toPct: null, ratePct: 0,
    },
  ];
  const config = {
    penaltyEnabled: parameters.penaltyEnabled,
    penaltyWarnFrom: parameters.warningFrom,
    penaltyEffectiveFrom: parameters.enforcedFrom,
    penaltyTiers,
    xuPenalty: { enabled: parameters.xuEnabled, perMissingXu: parameters.perMissingXu },
  };
  if (!employeePenalty.normalizeConfig(config).configured) {
    throw policyError('Cấu hình bậc phạt sau chuẩn hóa không hợp lệ', 'PENALTY_POLICY_CONFIG_INVALID');
  }
  return config;
}

function rawPenaltyConfig(config = {}) {
  const normalized = employeePenalty.normalizeConfig(config);
  return {
    penaltyEnabled: normalized.penaltyEnabled,
    penaltyWarnFrom: normalized.penaltyWarnFrom,
    penaltyEffectiveFrom: normalized.penaltyEffectiveFrom,
    penaltyTiers: normalized.penaltyTiers.map((tier) => ({ ...tier })),
    xuPenalty: { ...normalized.xuPenalty },
  };
}

function createPolicyStore({ policyFile = POLICY_FILE, auditFile = AUDIT_FILE, seedConfig = null, now = () => new Date() } = {}) {
  const seed = rawPenaltyConfig(seedConfig || employeeBonus.loadConfig());
  const seedParameters = parametersFromConfig(seed);
  if (!employeePenalty.normalizeConfig(seed).configured) throw new Error('Default employee penalty config is invalid');

  function list() {
    const root = readJson(policyFile, { schemaVersion: POLICY_SCHEMA_VERSION, policies: [] });
    try {
      if (!root || typeof root !== 'object' || Array.isArray(root)
        || root.schemaVersion !== POLICY_SCHEMA_VERSION || !Array.isArray(root.policies)) {
        throw new Error('root/schemaVersion/policies không hợp lệ');
      }
      const ids = new Set();
      const versions = new Set();
      for (const policy of root.policies) {
        if (!policy || typeof policy !== 'object' || Array.isArray(policy)
          || !String(policy.id || '').trim() || !Number.isInteger(Number(policy.version)) || Number(policy.version) < 1) {
          throw new Error('policy id/version không hợp lệ');
        }
        if (ids.has(policy.id) || versions.has(Number(policy.version))) throw new Error('policy id/version bị trùng');
        ids.add(policy.id);
        versions.add(Number(policy.version));
        const from = monthKey(policy.effectiveFrom);
        const to = policy.effectiveTo ? monthKey(policy.effectiveTo) : null;
        if (to && to < from) throw new Error('policy range không hợp lệ');
        normalizeParameters(policy.parameters);
      }
      return root.policies;
    } catch (error) {
      if (error.code === 'PENALTY_POLICY_STORE_CORRUPT') throw error;
      throw policyError(`File cấu hình phạt sai cấu trúc: ${path.basename(policyFile)}`, 'PENALTY_POLICY_STORE_CORRUPT', 500, { message: error.message });
    }
  }
  function audit() {
    const rows = readJson(auditFile, []);
    if (!Array.isArray(rows)) {
      throw policyError(`File audit phạt sai cấu trúc: ${path.basename(auditFile)}`, 'PENALTY_POLICY_STORE_CORRUPT', 500);
    }
    return rows;
  }
  function revision(policies = list()) { return sha256({ schemaVersion: POLICY_SCHEMA_VERSION, policies }); }

  function resolve({ period, extraPolicies = [] } = {}) {
    const key = monthKey(period);
    const active = [...list(), ...(Array.isArray(extraPolicies) ? extraPolicies : [])]
      .filter((policy) => policy && policy.effectiveFrom <= key && (!policy.effectiveTo || policy.effectiveTo >= key))
      .sort((left, right) => String(left.effectiveFrom).localeCompare(String(right.effectiveFrom))
        || Number(left.version || 0) - Number(right.version || 0)
        || String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
    const selected = active.at(-1) || null;
    const parameters = selected ? normalizeParameters(selected.parameters) : seedParameters;
    return {
      configured: true,
      engineVersion: ENGINE_VERSION,
      period: key,
      parameters,
      config: configFromParameters(parameters),
      source: selected ? {
        id: selected.id, version: selected.version, effectiveFrom: selected.effectiveFrom,
        effectiveTo: selected.effectiveTo || null, actor: selected.actor, note: selected.note || '',
        copiedFromVersion: selected.copiedFromVersion || null,
      } : { id: 'seed', version: 0, effectiveFrom: MIN_EFFECTIVE_MONTH, effectiveTo: null, actor: 'system', note: 'Cấu hình mặc định v3.4', copiedFromVersion: null },
    };
  }

  function normalizeCandidate(payload = {}, actor) {
    const normalizedActor = ceoActor(actor);
    const effectiveFrom = monthKey(payload.effectiveFrom || payload.period);
    const effectiveTo = payload.effectiveTo ? monthKey(payload.effectiveTo) : null;
    const currentMonth = monthKey(now().toISOString().slice(0, 10));
    const earliestEditableMonth = currentMonth > MIN_EFFECTIVE_MONTH ? currentMonth : MIN_EFFECTIVE_MONTH;
    if (effectiveFrom < earliestEditableMonth) {
      throw policyError(`Không được tạo phiên bản mới ghi đè kỳ lịch sử trước ${earliestEditableMonth}.`, 'PENALTY_POLICY_CLOSED_PERIOD', 409);
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw policyError('Giai đoạn kết thúc trước giai đoạn bắt đầu', 'PENALTY_POLICY_RANGE_INVALID');
    }
    const previewPeriod = monthKey(payload.previewPeriod || effectiveFrom);
    if (previewPeriod < effectiveFrom || (effectiveTo && previewPeriod > effectiveTo)) {
      throw policyError('Kỳ mô phỏng phải nằm trong giai đoạn hiệu lực.', 'PENALTY_POLICY_PREVIEW_PERIOD_OUTSIDE_RANGE');
    }
    const parameters = normalizeParameters(payload.parameters || payload.config || {});
    return {
      // ID luôn do backend sinh; không nhận ID từ client để tránh trùng khóa làm
      // hỏng toàn bộ store ở lần đọc kế tiếp.
      id: `penalty-policy-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      version: Number(payload.version || 0),
      engineVersion: ENGINE_VERSION,
      effectiveFrom,
      effectiveTo,
      previewPeriod,
      parameters,
      copiedFromVersion: payload.copiedFromVersion == null ? null : Number(payload.copiedFromVersion),
      note: String(payload.note || '').trim().slice(0, 500),
      actor: normalizedActor,
      createdAt: now().toISOString(),
    };
  }

  function preview(payload = {}, actor) {
    const normalizedActor = ceoActor(actor);
    const policies = list();
    const candidate = normalizeCandidate(payload, normalizedActor);
    if (candidate.copiedFromVersion != null) {
      const sourceParameters = candidate.copiedFromVersion === 0
        ? seedParameters
        : policies.find((policy) => Number(policy.version) === candidate.copiedFromVersion)?.parameters;
      if (!sourceParameters) {
        throw policyError('Version nguồn dùng lại không tồn tại.', 'PENALTY_POLICY_COPY_SOURCE_INVALID');
      }
      if (sha256(normalizeParameters(sourceParameters)) !== sha256(candidate.parameters)) {
        throw policyError('Nội dung đã khác version nguồn; không được ghi nhận là dùng lại nguyên bản.', 'PENALTY_POLICY_COPY_SOURCE_MISMATCH');
      }
    }
    candidate.version = Math.max(0, ...policies.map((policy) => Number(policy.version || 0))) + 1;
    const currentRevision = revision(policies);
    const before = resolve({ period: candidate.previewPeriod });
    const after = resolve({ period: candidate.previewPeriod, extraPolicies: [candidate] });
    const previewHash = sha256({ candidate, revision: currentRevision, actor: normalizedActor });
    // Cảnh báo mềm: không chặn quyền quyết của CEO, nhưng phải nói thẳng con số đang
    // cao gấp mấy lần mức cũ để không lưu vì gõ nhầm dấu phẩy.
    const rateWarnings = [
      ['lowerRatePct', 'bậc phạt nặng'], ['upperRatePct', 'bậc phạt nhẹ'], ['bottomRatePct', 'bậc đáy'],
    ].flatMap(([key, label]) => {
      const value = candidate.parameters[key];
      const current = before.parameters[key];
      if (!(value > RATE_WARN_PCT)) return [];
      const times = current > 0 ? Math.round(value / current * 10) / 10 : null;
      return [`Tỷ lệ ${label} đang đặt ${value}% doanh thu${times ? ` — cao gấp ${times} lần mức đang áp dụng (${current}%)` : ''}. Kiểm tra lại dấu phẩy trước khi lưu.`];
    });
    return { candidate, before, resolved: after, revision: currentRevision, previewHash, rateWarnings };
  }

  function persistCandidate(candidate, actor, { expectedRevision = null, previewHash = null } = {}) {
    const policies = list();
    const currentRevision = revision(policies);
    if (expectedRevision && expectedRevision !== currentRevision) {
      throw policyError('Cấu hình đã thay đổi sau khi preview. Vui lòng mô phỏng lại.', 'PENALTY_POLICY_REVISION_CHANGED', 409);
    }
    const expectedVersion = Math.max(0, ...policies.map((policy) => Number(policy.version || 0))) + 1;
    if (Number(candidate.version) !== expectedVersion) {
      throw policyError('Version preview không còn mới nhất. Vui lòng mô phỏng lại.', 'PENALTY_POLICY_REVISION_CHANGED', 409);
    }
    const before = resolve({ period: candidate.previewPeriod });
    const after = resolve({ period: candidate.previewPeriod, extraPolicies: [candidate] });
    const previousAudit = audit(); // fail trước mọi write nếu audit store đang hỏng
    const nextPolicies = [...policies, candidate];
    const event = {
      action: 'penalty_policy_saved', at: candidate.createdAt, actor: String(actor || candidate.actor || 'CEO'),
      policyId: candidate.id, version: candidate.version, engineVersion: ENGINE_VERSION,
      effectiveFrom: candidate.effectiveFrom, effectiveTo: candidate.effectiveTo,
      previewPeriod: candidate.previewPeriod, parameters: candidate.parameters,
      beforeConfig: before.config, afterConfig: after.config,
      beforeSource: before.source, afterSource: after.source,
      revisionBefore: currentRevision, revisionAfter: revision(nextPolicies),
      candidateHash: sha256(candidate), previewHash, note: candidate.note,
      copiedFromVersion: candidate.copiedFromVersion,
    };
    const nextPolicyRoot = { schemaVersion: POLICY_SCHEMA_VERSION, engineVersion: ENGINE_VERSION, policies: nextPolicies };
    const previousPolicyRoot = { schemaVersion: POLICY_SCHEMA_VERSION, engineVersion: ENGINE_VERSION, policies };
    writeAtomic(policyFile, nextPolicyRoot);
    try {
      // Audit append-only theo nghiệp vụ: không cắt lịch sử cũ.
      writeAtomic(auditFile, [event, ...previousAudit]);
    } catch (error) {
      // Hai file không thể rename trong một transaction hệ thống tập tin. Rollback
      // policy ngay nếu audit write lỗi để không tồn tại thay đổi thiếu audit.
      try { writeAtomic(policyFile, previousPolicyRoot); }
      catch (rollbackError) { error.rollbackError = rollbackError.message; }
      throw error;
    }
    return { policy: candidate, resolved: after, revision: revision(nextPolicies), previewHash };
  }

  function savePreview(previewResult, actor) {
    const normalizedActor = ceoActor(actor);
    if (!previewResult?.candidate || !previewResult.revision || !previewResult.previewHash) {
      throw policyError('Thiếu candidate preview chuẩn để lưu.', 'PENALTY_POLICY_PREVIEW_REQUIRED', 409);
    }
    const expectedHash = sha256({ candidate: previewResult.candidate, revision: previewResult.revision, actor: normalizedActor });
    if (expectedHash !== previewResult.previewHash || String(previewResult.candidate.actor) !== normalizedActor) {
      throw policyError('Preview không thuộc đúng actor hoặc đã bị thay đổi.', 'PENALTY_POLICY_PREVIEW_REQUIRED', 409);
    }
    return persistCandidate(previewResult.candidate, normalizedActor, { expectedRevision: previewResult.revision, previewHash: previewResult.previewHash });
  }

  // Không expose direct-save: mọi ghi policy bắt buộc đi qua preview chuẩn,
  // actor binding và revision/hash check của savePreview().
  return { list, audit, revision, resolve, preview, savePreview, normalizeCandidate, files: { policyFile, auditFile } };
}

const store = createPolicyStore();
module.exports = {
  POLICY_FILE, AUDIT_FILE, POLICY_SCHEMA_VERSION, ENGINE_VERSION, MIN_EFFECTIVE_MONTH,
  MAX_RATE_PCT, RATE_WARN_PCT,
  monthKey, parametersFromConfig, normalizeParameters, configFromParameters, rawPenaltyConfig, createPolicyStore,
  list: store.list, audit: store.audit, revision: store.revision, resolve: store.resolve,
  preview: store.preview, savePreview: store.savePreview,
};
