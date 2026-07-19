const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JOBS_NAME = 'filtered_employee_delivery_jobs';
const APPROVED_EMP_CODES = Object.freeze([
  'DN001', 'DN002', 'DN003', 'DN004', 'DN005', 'DN006', 'DN007', 'DN008', 'DN009',
  'DN010', 'DN011', 'DN012', 'DN016', 'DN017', 'DN018', 'DN019', 'DN022', 'DN024',
]);
const EXCLUDED_EMP_CODES = Object.freeze(['DN021', 'DN023', 'VP004', 'VP018']);
const TELEGRAM_APPROVED_EMP_CODES = Object.freeze(APPROVED_EMP_CODES.filter((code) => !['DN004', 'DN012', 'DN022'].includes(code)));
const APPROVED_SET = new Set(APPROVED_EMP_CODES);
const EXCLUDED_SET = new Set(EXCLUDED_EMP_CODES);
const TELEGRAM_APPROVED_SET = new Set(TELEGRAM_APPROVED_EMP_CODES);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FORBIDDEN_KEY = /(?:^|_)(?:cp_?total|chi_?phi|cost|gia_?von|profit|loi_?nhuan|margin)(?:_|$)/i;

function upper(v) { return String(v || '').trim().toUpperCase(); }
function text(v) { return String(v || '').trim(); }
function sha(value) { return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex'); }
function safeFilePart(v, fallback = 'report') {
  return String(v || fallback).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}
function channelSelection(value = {}) {
  return { telegram: value.telegram !== false && value.telegram !== 'false', email: value.email !== false && value.email !== 'false' };
}
function requestedCodes(payload = {}) {
  const raw = Array.isArray(payload.emp_codes) ? payload.emp_codes : Array.isArray(payload.empCodes) ? payload.empCodes : [];
  return [...new Set(raw.map(upper).filter(Boolean))];
}
function maskEmail(value) {
  const [local, domain] = String(value || '').split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, Math.min(6, local.length - 2)))}@${domain}`;
}
function recipientDigest(recipient) {
  return sha(JSON.stringify({ emp_code: recipient.emp_code, email: text(recipient.email).toLowerCase(), telegram_id: text(recipient.telegram_id) }));
}
function manifestDigest(job) {
  return sha(JSON.stringify({
    filters: job.filters,
    channels: job.channels,
    recipients: job.recipients.map((item) => ({ emp_code: item.emp_code, recipient_digest: item.recipient_digest })),
    files: job.files.map((item) => ({ emp_code: item.emp_code, file_name: item.file_name, bytes: item.bytes, sha256: item.sha256, content_sha256: item.content_sha256 })),
    expires_at: job.expires_at,
  }));
}
function reportContentDigest(report) {
  return sha(JSON.stringify({ period: report.period, period_ui: report.period_ui, filters: report.filters, summary: report.summary, rows: report.rows }));
}
function assertSafeReport(report, empCode) {
  const code = upper(empCode);
  if (!APPROVED_SET.has(code) || EXCLUDED_SET.has(code)) throw Object.assign(new Error('Mã nhân viên không thuộc phạm vi gửi đã được CEO duyệt.'), { status: 403, code: 'FILTERED_DELIVERY_EMPLOYEE_BLOCKED' });
  if (upper(report?.summary?.emp_code) !== code) throw Object.assign(new Error('Báo cáo không khớp mã nhân viên nhận.'), { status: 409, code: 'FILTERED_DELIVERY_SCOPE_MISMATCH' });
  const scanSensitiveKeys = (value, seen = new Set()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [rawKey, nested] of Object.entries(value)) {
      const key = rawKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      if (FORBIDDEN_KEY.test(key)) throw Object.assign(new Error('Báo cáo chứa trường nhạy cảm và đã bị chặn.'), { status: 409, code: 'FILTERED_DELIVERY_SENSITIVE_FIELD' });
      scanSensitiveKeys(nested, seen);
    }
  };
  scanSensitiveKeys(report?.summary);
  for (const row of report?.rows || []) {
    if (upper(row?.emp_code) !== code) throw Object.assign(new Error('Phát hiện dữ liệu chéo nhân viên trong file.'), { status: 409, code: 'FILTERED_DELIVERY_SCOPE_MISMATCH' });
    scanSensitiveKeys(row);
  }
}
function actorHash(value) { return sha(`filtered-employee-delivery:${text(value)}`); }
function deliveryResultStatus(channel, result) {
  if (result?.ok) return 'sent';
  const message = String(result?.description || '').toLowerCase();
  if (result?.uncertain || /timeout|timed out|etimedout|econnreset|econnaborted|epipe|socket hang up|fetch failed|network error|unexpected.*clos|connection closed/.test(message)) return 'unknown';
  const definite = channel === 'email'
    ? /reject|invalid recipient|authentication|auth failed|smtp[^a-z]*(?:4\d\d|5\d\d)|(?:^|\s)(?:4\d\d|5\d\d)(?:\s|$)|chưa cấu hình|chưa có email/.test(message)
    : /bad request|forbidden|unauthorized|bot was blocked|chat not found|thiếu chat_id|không tồn tại|chưa có telegram_bot_token/.test(message);
  return definite ? 'failed' : 'unknown';
}

function createFilteredEmployeeDeliveryService({
  filteredEmployeeReport,
  store,
  listTelegramMap,
  notifyChannels,
  persist,
  clock = () => new Date(),
  previewTtlMs = 24 * 60 * 60 * 1000,
  outputDir = process.env.FILTERED_EMPLOYEE_DELIVERY_DIR || path.join(__dirname, '..', '..', 'artifacts', 'sales-report', 'filtered-employee-delivery'),
  sendEnabled = () => process.env.FILTERED_EMPLOYEE_REPORT_SEND_ENABLED === '1',
} = {}) {
  if (!filteredEmployeeReport || !store || !listTelegramMap || !notifyChannels || !persist) throw new Error('Filtered delivery service thiếu dependency');
  const locks = new Set();
  const lockDir = path.join(outputDir, '.locks');

  function nowIso() { return clock().toISOString(); }
  function lockInfo(name) {
    const lockPath = path.join(lockDir, `${safeFilePart(name)}.lock`);
    try {
      const stat = fs.statSync(lockPath);
      const value = JSON.parse(fs.readFileSync(lockPath, 'utf8') || '{}');
      let ownerAlive = false;
      if (Number.isInteger(value.pid) && value.pid > 0) { try { process.kill(value.pid, 0); ownerAlive = true; } catch { ownerAlive = false; } }
      return { lockPath, ageMs: Math.max(0, Date.now() - stat.mtimeMs), ownerAlive };
    } catch { return { lockPath, ageMs: 0, ownerAlive: false }; }
  }
  function acquireFileLock(name) {
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    const lockPath = path.join(lockDir, `${safeFilePart(name)}.lock`);
    let fd;
    try { fd = fs.openSync(lockPath, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: nowIso() })); }
    catch (error) {
      if (error.code === 'EEXIST') {
        const info = lockInfo(name);
        if (name === 'state' && !info.ownerAlive && info.ageMs > 1000) {
          try { fs.unlinkSync(lockPath); } catch { /* another process may own recovery */ }
          return acquireFileLock(name);
        }
        throw Object.assign(new Error('Một tiến trình khác đang xử lý delivery; vui lòng kiểm tra trạng thái trước khi thử lại.'), { status: 409, code: name === 'send-global' && !info.ownerAlive ? 'FILTERED_DELIVERY_STALE_SEND_LOCK' : 'FILTERED_DELIVERY_IN_PROGRESS' });
      }
      throw error;
    }
    return () => { try { fs.closeSync(fd); } catch { /* ignore */ } try { fs.unlinkSync(lockPath); } catch { /* keep fail-closed */ } };
  }
  function loadState() {
    const value = persist.load(JOBS_NAME, { version: 1, jobs: {}, events: [] });
    return value && typeof value === 'object' ? { version: 1, jobs: value.jobs || {}, events: Array.isArray(value.events) ? value.events : [] } : { version: 1, jobs: {}, events: [] };
  }
  function saveState(state) {
    if (state.events.length > 5000) state.events = state.events.slice(-5000);
    persist.save(JOBS_NAME, state);
  }
  function mutateState(mutation) {
    const release = acquireFileLock('state');
    try {
      const state = loadState();
      const result = mutation(state);
      saveState(state);
      return result;
    } finally { release(); }
  }
  function event(state, type, job, extra = {}) {
    state.events.push({ at: nowIso(), type, preview_id: job.preview_id, actor_key: job.actor_key, ...extra });
  }
  function recoverInterruptedSend({ force = false } = {}) {
    const info = lockInfo('send-global');
    if (!fs.existsSync(info.lockPath) || info.ownerAlive || (!force && info.ageMs <= 1000)) return false;
    mutateState((state) => {
      for (const job of Object.values(state.jobs || {})) {
        let interrupted = false;
        if (job.approval?.status === 'approved' && !job.approval.consumed_at) {
          job.approval.status = 'revoked';
          job.approval.consumed_at = nowIso();
          interrupted = true;
        }
        for (const channels of Object.values(job.delivery || {})) for (const value of Object.values(channels || {})) {
          if (value?.status === 'sending') { value.status = 'unknown'; value.updated_at = nowIso(); interrupted = true; }
        }
        if (job.status === 'sending' || interrupted) {
          if (job.status === 'sending') job.status = 'partial';
          event(state, 'send_interrupted_recovered', job);
        }
      }
    });
    try { fs.unlinkSync(info.lockPath); } catch { /* remain fail-closed if recovery races */ }
    return true;
  }
  function cleanupArtifacts() {
    const nowMs = clock().getTime();
    try {
      mutateState((state) => {
        for (const job of Object.values(state.jobs || {})) {
          const expiresMs = Date.parse(job.expires_at);
          if (!Number.isFinite(expiresMs) || expiresMs > nowMs || job.artifacts_removed_at) continue;
          if (job.status === 'sending' && nowMs < expiresMs + previewTtlMs) continue;
          fs.rmSync(path.join(outputDir, safeFilePart(job.preview_id)), { recursive: true, force: true });
          job.artifacts_removed_at = nowIso();
          if (job.status === 'prepared') job.status = 'expired';
          event(state, 'artifacts_removed', job);
        }
      });
    } catch (error) {
      if (error.code !== 'FILTERED_DELIVERY_IN_PROGRESS') throw error;
    }
    try {
      for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith('.tmp')) continue;
        const fullPath = path.join(outputDir, entry.name);
        if (nowMs - fs.statSync(fullPath).mtimeMs > previewTtlMs) fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch { /* output directory may not exist yet */ }
  }
  try { recoverInterruptedSend(); } catch { /* keep stale lock fail-closed until explicit status/send check */ }
  cleanupArtifacts();
  const cleanupTimer = setInterval(cleanupArtifacts, Math.max(60_000, Math.min(previewTtlMs, 60 * 60 * 1000)));
  cleanupTimer.unref?.();

  function recipientCatalog() {
    const telegramIdsByEmp = new Map();
    for (const item of listTelegramMap() || []) {
      const code = upper(item.emp_code);
      const telegramId = text(item.telegram_id);
      if (!code || !telegramId) continue;
      if (!telegramIdsByEmp.has(code)) telegramIdsByEmp.set(code, new Set());
      telegramIdsByEmp.get(code).add(telegramId);
    }
    for (const [code, ids] of telegramIdsByEmp) if (TELEGRAM_APPROVED_SET.has(code) && ids.size > 1) {
      throw Object.assign(new Error(`Nhân viên ${code} có nhiều mapping Telegram; đã chặn delivery.`), { status: 409, code: 'FILTERED_DELIVERY_TELEGRAM_AMBIGUOUS' });
    }
    return APPROVED_EMP_CODES.map((empCode) => {
      const user = store.findUserByCode(empCode);
      const email = text(notifyChannels.emailFor(empCode, user?.email)).toLowerCase();
      const telegramId = TELEGRAM_APPROVED_SET.has(empCode) ? ([...(telegramIdsByEmp.get(empCode) || [])][0] || '') : '';
      return { emp_code: empCode, name: user?.name || empCode, email, telegram_id: telegramId, user_exists: !!user };
    });
  }
  function safeRecipient(item, channels) {
    const hasEmail = !!item.email;
    const hasTelegram = !!item.telegram_id;
    return {
      emp_code: item.emp_code,
      name: item.name,
      email_masked: maskEmail(item.email),
      telegram_fingerprint: hasTelegram ? `••••${item.telegram_id.slice(-4)}` : '',
      has_email: hasEmail,
      has_telegram: hasTelegram,
      email_planned: !!(channels.email && hasEmail && notifyChannels.emailReady()),
      telegram_planned: !!(channels.telegram && hasTelegram && notifyChannels.telegramReady()),
    };
  }
  function publicJob(job) {
    const recipients = job.recipients.map((item) => {
      const file = job.files.find((candidate) => candidate.emp_code === item.emp_code) || {};
      const delivery = Object.fromEntries(Object.entries(job.delivery?.[item.emp_code] || {}).map(([channel, value]) => [channel, {
        status: value.status, attempt: value.attempt, updated_at: value.updated_at, retry_available: value.status === 'failed', duplicate_blocked: !!value.duplicate_of,
      }]));
      return {
        emp_code: item.emp_code,
        name: item.name,
        email_masked: item.email_masked,
        telegram_fingerprint: item.telegram_fingerprint,
        has_email: item.has_email,
        has_telegram: item.has_telegram,
        email_planned: item.email_planned,
        telegram_planned: item.telegram_planned,
        file: { emp_code: file.emp_code, file_name: file.file_name, bytes: file.bytes, sha256: file.sha256, row_count: file.row_count, unit_count: file.unit_count, qlnb_count: file.qlnb_count },
        delivery,
      };
    });
    return {
      ok: true,
      preview_id: job.preview_id,
      manifest_digest: job.manifest_digest,
      created_at: job.created_at,
      expires_at: job.expires_at,
      status: job.status,
      period: job.period,
      period_ui: job.period_ui,
      filters: job.filters,
      filter_text: job.filter_text,
      channels: job.channels,
      approved_scope_count: APPROVED_EMP_CODES.length,
      excluded_emp_codes: EXCLUDED_EMP_CODES,
      blocked_requested: job.blocked_requested || [],
      recipients,
      summary: {
        recipients: recipients.length,
        files: job.files.length,
        rows: job.files.reduce((sum, item) => sum + Number(item.row_count || 0), 0),
        email: recipients.filter((item) => item.email_planned).length,
        telegram: recipients.filter((item) => item.telegram_planned).length,
        missing_email: recipients.filter((item) => !item.has_email).map((item) => item.emp_code),
        missing_telegram: recipients.filter((item) => !item.has_telegram).map((item) => item.emp_code),
      },
      approval: job.approval ? { status: job.approval.status, mode: job.approval.mode, approved_at: job.approval.approved_at, consumed_at: job.approval.consumed_at || null } : null,
      send_enabled: !!sendEnabled(),
      send_requires_second_ceo_approval: true,
    };
  }
  function findJob(previewId, actorKey) {
    const state = loadState();
    const job = state.jobs[text(previewId)];
    if (!job || job.actor_key !== actorHash(actorKey)) throw Object.assign(new Error('Preview gửi không tồn tại hoặc không thuộc phiên quản trị này.'), { status: 409, code: 'FILTERED_DELIVERY_PREVIEW_REQUIRED' });
    if (Date.parse(job.expires_at) <= clock().getTime()) throw Object.assign(new Error('Preview gửi đã hết hạn; vui lòng lập preview mới.'), { status: 409, code: 'FILTERED_DELIVERY_PREVIEW_EXPIRED' });
    return { state, job };
  }
  function mutateJob(previewId, actorKey, mutation) {
    return mutateState((state) => {
      const job = state.jobs[text(previewId)];
      if (!job || job.actor_key !== actorHash(actorKey)) throw Object.assign(new Error('Preview gửi không tồn tại hoặc không thuộc phiên quản trị này.'), { status: 409, code: 'FILTERED_DELIVERY_PREVIEW_REQUIRED' });
      if (Date.parse(job.expires_at) <= clock().getTime()) throw Object.assign(new Error('Preview gửi đã hết hạn; vui lòng lập preview mới.'), { status: 409, code: 'FILTERED_DELIVERY_PREVIEW_EXPIRED' });
      mutation(job, state);
      state.jobs[job.preview_id] = job;
      return { state, job };
    });
  }

  async function preview(payload = {}, actorKey = '') {
    cleanupArtifacts();
    const channels = channelSelection(payload.channels || {});
    if (!channels.email && !channels.telegram) throw Object.assign(new Error('Chọn ít nhất một kênh gửi.'), { status: 400 });
    if (channels.email && !notifyChannels.emailReady()) throw Object.assign(new Error('Kênh email chưa sẵn sàng; đã chặn preview gửi.'), { status: 503, code: 'FILTERED_DELIVERY_EMAIL_UNAVAILABLE' });
    if (channels.telegram && !notifyChannels.telegramReady()) throw Object.assign(new Error('Kênh Telegram chưa sẵn sàng; đã chặn preview gửi.'), { status: 503, code: 'FILTERED_DELIVERY_TELEGRAM_UNAVAILABLE' });
    const rawRequested = requestedCodes(payload);
    const blockedRequested = rawRequested.filter((code) => EXCLUDED_SET.has(code) || !APPROVED_SET.has(code));
    const selectedCodes = rawRequested.length ? rawRequested.filter((code) => APPROVED_SET.has(code) && !EXCLUDED_SET.has(code)) : [...APPROVED_EMP_CODES];
    if (!selectedCodes.length) throw Object.assign(new Error('Không có nhân viên nào thuộc phạm vi gửi đã được CEO duyệt.'), { status: 400 });
    const reportPayload = { ...payload, emp_codes: selectedCodes };
    delete reportPayload.channels;
    delete reportPayload.preview_id;
    delete reportPayload.previewId;
    const reportPreview = await filteredEmployeeReport.preview(reportPayload, actorKey);
    const reportSet = await filteredEmployeeReport.summaryReport({ ...reportPreview.filters, preview_id: reportPreview.preview_id }, actorKey);
    const catalog = new Map(recipientCatalog().map((item) => [item.emp_code, item]));
    const previewId = crypto.randomUUID();
    const stagingDir = path.join(outputDir, `${previewId}.tmp`);
    const finalDir = path.join(outputDir, previewId);
    fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    const files = [];
    let recipients = [];
    try {
      for (const report of reportSet.reports) {
        const empCode = upper(report.summary.emp_code);
        if (!selectedCodes.includes(empCode)) continue;
        assertSafeReport(report, empCode);
        const buffer = await filteredEmployeeReport.excelBuffer(report);
        const fileName = `Bao_cao_App_Report_${safeFilePart(report.period_ui)}_${safeFilePart(empCode)}.xlsx`;
        const filePath = path.join(stagingDir, fileName);
        fs.writeFileSync(filePath, buffer, { mode: 0o600 });
        files.push({ emp_code: empCode, file_name: fileName, file_path: path.join(finalDir, fileName), bytes: buffer.length, sha256: sha(buffer), content_sha256: reportContentDigest(report), row_count: report.summary.row_count, unit_count: report.summary.unit_count, qlnb_count: report.summary.qlnb_count });
      }
      if (!files.length) throw Object.assign(new Error('Không có báo cáo nào có dữ liệu để lập preview gửi.'), { status: 404 });
      recipients = files.map((file) => {
        const current = catalog.get(file.emp_code);
        if (!current?.user_exists) throw Object.assign(new Error(`Không tìm thấy nhân viên ${file.emp_code} trong danh bạ hiện tại.`), { status: 409, code: 'FILTERED_DELIVERY_USER_MISSING' });
        if (channels.email && !current.email) throw Object.assign(new Error(`Nhân viên ${file.emp_code} chưa có email; đã chặn preview gửi.`), { status: 409, code: 'FILTERED_DELIVERY_EMAIL_MISSING' });
        if (channels.telegram && TELEGRAM_APPROVED_SET.has(file.emp_code) && !current.telegram_id) throw Object.assign(new Error(`Nhân viên ${file.emp_code} thiếu mapping Telegram đã được duyệt; đã chặn preview gửi.`), { status: 409, code: 'FILTERED_DELIVERY_TELEGRAM_MISSING' });
        const safe = safeRecipient(current, channels);
        if (!safe.email_planned && !safe.telegram_planned) throw Object.assign(new Error(`Nhân viên ${file.emp_code} không có kênh gửi hợp lệ trong preview này.`), { status: 409, code: 'FILTERED_DELIVERY_NO_CHANNEL' });
        return { ...safe, recipient_digest: recipientDigest(current) };
      });
      for (const channel of ['email', 'telegram_id']) {
        const seen = new Map();
        for (const file of files) {
          const rawValue = catalog.get(file.emp_code)?.[channel];
          const value = channel === 'email' ? text(rawValue).toLowerCase() : text(rawValue);
          if (!value) continue;
          if (seen.has(value)) throw Object.assign(new Error(`Thông tin người nhận ${channel === 'email' ? 'email' : 'Telegram'} bị trùng giữa ${seen.get(value)} và ${file.emp_code}; đã chặn preview gửi.`), { status: 409, code: 'FILTERED_DELIVERY_RECIPIENT_DUPLICATE' });
          seen.set(value, file.emp_code);
        }
      }
      fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
      fs.renameSync(stagingDir, finalDir);
    } catch (error) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw error;
    }
    const createdAt = nowIso();
    const job = {
      preview_id: previewId,
      actor_key: actorHash(actorKey),
      created_at: createdAt,
      expires_at: new Date(clock().getTime() + previewTtlMs).toISOString(),
      status: 'prepared',
      period: reportSet.period,
      period_ui: reportSet.period_ui,
      filters: reportPreview.filters,
      filter_text: reportPreview.filter_text,
      channels,
      blocked_requested: blockedRequested,
      recipients,
      files,
      delivery: {},
    };
    job.manifest_digest = manifestDigest(job);
    try {
      mutateState((state) => {
        state.jobs[previewId] = job;
        event(state, 'preview_prepared', job, { recipients: recipients.length, manifest_digest: job.manifest_digest });
      });
    } catch (error) {
      fs.rmSync(finalDir, { recursive: true, force: true });
      throw error;
    }
    return publicJob(job);
  }

  function status(previewId, actorKey = '') {
    cleanupArtifacts();
    const { job } = findJob(previewId, actorKey);
    return publicJob(job);
  }

  function approve(previewId, payload = {}, actorKey = '') {
    cleanupArtifacts();
    if (text(payload.confirm_text || payload.confirmText).toUpperCase() !== 'DUYET_GUI_BAO_CAO_CA_NHAN') throw Object.assign(new Error('Thiếu xác nhận DUYET_GUI_BAO_CAO_CA_NHAN.'), { status: 400, code: 'FILTERED_DELIVERY_APPROVAL_CONFIRM_REQUIRED' });
    const expectedManifest = text(payload.manifest_digest || payload.manifestDigest);
    const { job } = findJob(previewId, actorKey);
    if (!expectedManifest || expectedManifest !== job.manifest_digest) throw Object.assign(new Error('Manifest xin duyệt không khớp preview.'), { status: 409, code: 'FILTERED_DELIVERY_MANIFEST_MISMATCH' });
    const result = mutateJob(previewId, actorKey, (current, state) => {
      const mode = current.status === 'prepared' ? 'send' : current.status === 'partial' ? 'retry' : null;
      if (!mode) throw Object.assign(new Error('Trạng thái hiện tại không cho phép tạo phê duyệt gửi/retry.'), { status: 409, code: 'FILTERED_DELIVERY_APPROVAL_STATE_INVALID' });
      if (current.approval?.status === 'approved' && !current.approval.consumed_at) throw Object.assign(new Error('Preview đã có một phê duyệt chưa sử dụng.'), { status: 409, code: 'FILTERED_DELIVERY_APPROVAL_ALREADY_EXISTS' });
      current.approval = { status: 'approved', mode, actor_key: actorHash(actorKey), manifest_digest: expectedManifest, approved_at: nowIso(), consumed_at: null };
      event(state, 'ceo_approved', current, { manifest_digest: expectedManifest, mode });
    });
    return publicJob(result.job);
  }

  function saveChannelState(previewId, actorKey, empCode, channel, value) {
    return mutateJob(previewId, actorKey, (job, state) => {
      job.delivery[empCode] = job.delivery[empCode] || {};
      job.delivery[empCode][channel] = value;
      event(state, `delivery_${value.status}`, job, { emp_code: empCode, channel, attempt: value.attempt });
    });
  }
  function priorDelivery(state, idempotencyKey, currentPreviewId) {
    for (const candidate of Object.values(state.jobs || {})) {
      for (const channels of Object.values(candidate.delivery || {})) {
        for (const value of Object.values(channels || {})) {
          if (value?.idempotency_key === idempotencyKey && ['sent', 'sending', 'unknown'].includes(value.status)) {
            return { preview_id: candidate.preview_id, status: value.status, current: candidate.preview_id === currentPreviewId };
          }
        }
      }
    }
    return null;
  }

  async function send(payload = {}, actorKey = '', { retryFailed = false } = {}) {
    cleanupArtifacts();
    if (!sendEnabled()) throw Object.assign(new Error('Gửi thật đang khóa; cần CEO duyệt lần hai và bật quyền gửi tạm thời.'), { status: 423, code: 'FILTERED_DELIVERY_DISABLED' });
    if (text(payload.confirm_text || payload.confirmText).toUpperCase() !== 'GUI_BAO_CAO_CA_NHAN') throw Object.assign(new Error('Thiếu xác nhận GUI_BAO_CAO_CA_NHAN.'), { status: 400 });
    const previewId = text(payload.preview_id || payload.previewId);
    if (locks.has(previewId)) throw Object.assign(new Error('Lệnh gửi này đang được xử lý.'), { status: 409, code: 'FILTERED_DELIVERY_IN_PROGRESS' });
    locks.add(previewId);
    let releaseSendLock;
    try { releaseSendLock = acquireFileLock('send-global'); }
    catch (error) {
      locks.delete(previewId);
      if (error.code === 'FILTERED_DELIVERY_STALE_SEND_LOCK') {
        recoverInterruptedSend({ force: true });
        throw Object.assign(new Error('Đã phục hồi lệnh gửi bị gián đoạn về trạng thái unknown; cần CEO kiểm tra và duyệt lại trước mọi retry.'), { status: 409, code: 'FILTERED_DELIVERY_INTERRUPTED_REVIEW_REQUIRED' });
      }
      throw error;
    }
    try {
      const found = findJob(previewId, actorKey);
      let { state, job } = found;
      if (text(payload.manifest_digest || payload.manifestDigest) !== job.manifest_digest) throw Object.assign(new Error('Manifest gửi không khớp preview đã duyệt.'), { status: 409, code: 'FILTERED_DELIVERY_MANIFEST_MISMATCH' });
      if (job.status === 'sent') return publicJob(job);
      const requiredApprovalMode = retryFailed ? 'retry' : 'send';
      if (job.approval?.status !== 'approved' || job.approval.mode !== requiredApprovalMode || job.approval.consumed_at || job.approval.actor_key !== actorHash(actorKey) || job.approval.manifest_digest !== job.manifest_digest) throw Object.assign(new Error(`Cần CEO phê duyệt riêng cho thao tác ${requiredApprovalMode === 'retry' ? 'retry' : 'gửi'} trong đúng phiên này.`), { status: 403, code: 'FILTERED_DELIVERY_SECOND_APPROVAL_REQUIRED' });
      const currentCatalog = new Map(recipientCatalog().map((item) => [item.emp_code, item]));
      for (const recipient of job.recipients) {
        if (!APPROVED_SET.has(recipient.emp_code) || EXCLUDED_SET.has(recipient.emp_code)) throw Object.assign(new Error(`Mã ${recipient.emp_code} bị chặn khỏi luồng gửi.`), { status: 403, code: 'FILTERED_DELIVERY_EMPLOYEE_BLOCKED' });
        const current = currentCatalog.get(recipient.emp_code);
        if (!current?.user_exists || recipientDigest(current) !== recipient.recipient_digest) throw Object.assign(new Error(`Thông tin người nhận ${recipient.emp_code} đã thay đổi; cần preview lại.`), { status: 409, code: 'FILTERED_DELIVERY_RECIPIENT_CHANGED' });
      }
      const results = [];
      ({ state, job } = mutateJob(previewId, actorKey, (current, currentState) => {
        if (current.approval?.status !== 'approved' || current.approval.mode !== requiredApprovalMode || current.approval.consumed_at || current.approval.actor_key !== actorHash(actorKey) || current.approval.manifest_digest !== current.manifest_digest) throw Object.assign(new Error('Phê duyệt một lần không còn hợp lệ.'), { status: 403, code: 'FILTERED_DELIVERY_SECOND_APPROVAL_REQUIRED' });
        current.approval.consumed_at = nowIso();
        current.status = 'sending';
        event(currentState, 'send_started', current);
      }));
      for (const recipient of job.recipients) {
        const current = currentCatalog.get(recipient.emp_code);
        const file = job.files.find((item) => item.emp_code === recipient.emp_code);
        if (!file || !fs.existsSync(file.file_path)) throw Object.assign(new Error(`File preview ${recipient.emp_code} không còn tồn tại.`), { status: 409, code: 'FILTERED_DELIVERY_FILE_MISSING' });
        const buffer = fs.readFileSync(file.file_path);
        if (buffer.length !== file.bytes || sha(buffer) !== file.sha256) throw Object.assign(new Error(`File preview ${recipient.emp_code} đã thay đổi.`), { status: 409, code: 'FILTERED_DELIVERY_FILE_CHANGED' });
        const row = { emp_code: recipient.emp_code, channels: {} };
        const subject = `DONAPHARM App Report — Báo cáo cá nhân ${job.period_ui} — ${recipient.emp_code}`;
        const bodyText = `Kính gửi Anh/Chị ${recipient.name} - ${recipient.emp_code}. App Report gửi báo cáo cá nhân kỳ ${job.period_ui} theo đúng phạm vi được phân quyền. Phạm vi lọc: ${job.filter_text}. File đính kèm: ${file.file_name}.`;
        const bodyHtml = `<p>${bodyText.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</p><p>File không chứa CP Total, chi phí, lợi nhuận hoặc margin.</p>`;
        for (const channel of ['email', 'telegram']) {
          const planned = channel === 'email' ? recipient.email_planned : recipient.telegram_planned;
          if (!planned) { row.channels[channel] = { status: 'not_planned' }; continue; }
          const idempotencyKey = sha(JSON.stringify({ emp_code: recipient.emp_code, channel, content_sha256: file.content_sha256, recipient_digest: recipient.recipient_digest }));
          const previous = job.delivery?.[recipient.emp_code]?.[channel];
          const duplicate = priorDelivery(state, idempotencyKey, previewId);
          if (!previous && duplicate && !duplicate.current) {
            ({ state, job } = saveChannelState(previewId, actorKey, recipient.emp_code, channel, { status: duplicate.status === 'sending' ? 'unknown' : duplicate.status, attempt: 0, updated_at: nowIso(), file_sha256: file.sha256, idempotency_key: idempotencyKey, duplicate_of: duplicate.preview_id }));
            row.channels[channel] = { status: duplicate.status === 'sending' ? 'unknown' : duplicate.status, skipped: true, duplicate_blocked: true };
            continue;
          }
          if (previous?.status === 'sent' || previous?.status === 'unknown' || previous?.status === 'sending') {
            const statusValue = previous.status === 'sending' ? 'unknown' : previous.status;
            if (statusValue !== previous.status) {
              ({ state, job } = saveChannelState(previewId, actorKey, recipient.emp_code, channel, { ...previous, status: 'unknown', updated_at: nowIso() }));
            }
            row.channels[channel] = { status: statusValue, skipped: true };
            continue;
          }
          if (previous?.status === 'failed' && !retryFailed) { row.channels[channel] = { status: 'failed', skipped: true, retry_available: true }; continue; }
          const attempt = Number(previous?.attempt || 0) + 1;
          ({ state, job } = saveChannelState(previewId, actorKey, recipient.emp_code, channel, { status: 'sending', attempt, started_at: nowIso(), updated_at: nowIso(), file_sha256: file.sha256, idempotency_key: idempotencyKey }));
          let providerResult;
          try {
            providerResult = channel === 'email'
              ? await notifyChannels.sendEmail(current.email, subject, bodyText, bodyHtml, [{ filename: file.file_name, content: buffer, contentType: XLSX_MIME }])
              : await notifyChannels.sendDocument(current.telegram_id, file.file_path, `Báo cáo App Report cá nhân ${recipient.emp_code} — ${job.period_ui}`);
          } catch (error) {
            providerResult = { ok: false, description: error.message, uncertain: true };
          }
          const channelStatus = deliveryResultStatus(channel, providerResult);
          const safeState = { status: channelStatus, attempt, updated_at: nowIso(), file_sha256: file.sha256, idempotency_key: idempotencyKey, provider_message_id: text(providerResult?.provider_message_id).slice(0, 120), description: providerResult?.ok ? '' : text(providerResult?.description).slice(0, 300) };
          ({ state, job } = saveChannelState(previewId, actorKey, recipient.emp_code, channel, safeState));
          row.channels[channel] = { status: channelStatus, retry_available: channelStatus === 'failed' };
        }
        results.push(row);
      }
      const allStates = results.flatMap((row) => Object.values(row.channels)).filter((item) => item.status !== 'not_planned');
      const finalStatus = !allStates.length || allStates.some((item) => ['failed', 'unknown'].includes(item.status)) ? 'partial' : 'sent';
      ({ state, job } = mutateJob(previewId, actorKey, (current, currentState) => { current.status = finalStatus; event(currentState, 'send_finished', current, { status: finalStatus }); }));
      return { ...publicJob(job), results };
    } finally {
      releaseSendLock?.();
      locks.delete(previewId);
    }
  }

  async function retry(previewId, payload = {}, actorKey = '') {
    return send({ ...payload, preview_id: previewId }, actorKey, { retryFailed: true });
  }

  return { preview, status, approve, send, retry, approvedEmpCodes: APPROVED_EMP_CODES, telegramApprovedEmpCodes: TELEGRAM_APPROVED_EMP_CODES, excludedEmpCodes: EXCLUDED_EMP_CODES };
}

module.exports = { APPROVED_EMP_CODES, TELEGRAM_APPROVED_EMP_CODES, EXCLUDED_EMP_CODES, assertSafeReport, createFilteredEmployeeDeliveryService };
