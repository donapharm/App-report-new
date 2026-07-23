#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadRepoEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadRepoEnv();

const { deviceIdHash, legacyAuditDeviceHash, deviceFingerprint } = require('../src/trustedDevice');

function readJson(file, fallback = [], { required = false } = {}) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`REQUIRED_FILE_MISSING:${file}`);
    return fallback;
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`EXPECTED_ARRAY:${path.basename(file)}`);
  return value;
}
function normalizePhone(value) {
  let s = String(value || '').replace(/\D/g, '');
  if (s.startsWith('84')) s = `0${s.slice(2)}`;
  if (s && !s.startsWith('0')) s = `0${s}`;
  return s;
}
function timeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function eventTime(event) { return timeValue(event?.at || event?.ts); }

function buildBackfill({ legacyDevices, legacyAudit, currentDevices, users, threshold = 3 }) {
  const usersByCode = new Map();
  for (const user of users) {
    const code = String(user.emp_code || '').trim().toUpperCase();
    if (!code) continue;
    if (!usersByCode.has(code)) usersByCode.set(code, []);
    usersByCode.get(code).push(user);
  }
  const currentByKey = new Map();
  for (const device of currentDevices) {
    const code = String(device.emp_code || '').trim().toUpperCase();
    const hash = String(device.device_id_hash || device.id || '').trim();
    const key = `${code}\u0000${hash}`;
    if (!currentByKey.has(key)) currentByKey.set(key, []);
    currentByKey.get(key).push(device);
  }

  let historicalOtpEvents = 0;
  let matchedDevices = 0;
  let updatedDevices = 0;
  let newlyTrusted = 0;
  let ambiguousDevices = 0;
  let missingCurrentDevices = 0;
  let incompleteIdentity = 0;
  const changed = [];

  for (const legacy of legacyDevices) {
    const rawId = String(legacy.id || '').trim();
    const code = String(legacy.emp_code || '').trim().toUpperCase();
    if (!rawId || !code) continue;
    const legacyHashes = new Set([rawId, legacyAuditDeviceHash(rawId)]);
    const events = legacyAudit
      .filter((item) => item?.event === 'login'
        && item?.method === 'otp'
        && String(item.emp_code || '').trim().toUpperCase() === code
        && legacyHashes.has(String(item.device || '').trim())
        && eventTime(item) > 0)
      .sort((a, b) => eventTime(a) - eventTime(b));
    if (!events.length) continue;
    historicalOtpEvents += events.length;

    const hash = deviceIdHash(rawId);
    const matches = currentByKey.get(`${code}\u0000${hash}`) || [];
    if (matches.length > 1) { ambiguousDevices += 1; continue; }
    if (matches.length !== 1) { missingCurrentDevices += 1; continue; }
    matchedDevices += 1;

    const device = matches[0];
    const userMatches = usersByCode.get(code) || [];
    const phone = userMatches.length === 1 ? normalizePhone(userMatches[0].phone) : '';
    const fingerprint = deviceFingerprint(device.ua || legacy.ua);
    if (!phone || !fingerprint) { incompleteIdentity += 1; continue; }

    const oldCount = Math.max(0, Number(device.trusted_login_count || 0));
    const historicalCount = Math.min(threshold, events.length);
    const alreadyBackfilled = Math.max(0, Number(device.history_backfilled_otp_count || 0));
    const historicalDelta = Math.max(0, historicalCount - alreadyBackfilled);
    const nextCount = Math.min(threshold, oldCount + historicalDelta);
    const lastOtpAt = Math.max(timeValue(device.last_otp_at), eventTime(events[events.length - 1]));
    const thirdOtpAt = events.length >= threshold ? eventTime(events[threshold - 1]) : 0;
    const wasTrusted = device.is_trusted === true;
    const nextTrusted = wasTrusted || nextCount >= threshold;
    const next = {
      ...device,
      phone,
      trusted_fingerprint: device.trusted_fingerprint || fingerprint,
      trusted_login_count: nextCount,
      history_backfilled_otp_count: Math.max(alreadyBackfilled, historicalCount),
      is_trusted: nextTrusted,
      trusted_at: device.trusted_at || (nextTrusted ? (thirdOtpAt || lastOtpAt) : null),
      last_otp_at: lastOtpAt || device.last_otp_at || null,
    };
    const materiallyChanged = JSON.stringify(next) !== JSON.stringify(device);
    if (!materiallyChanged) continue;
    Object.assign(device, next);
    updatedDevices += 1;
    if (!wasTrusted && nextTrusted) newlyTrusted += 1;
    changed.push({ emp_code: code, otp_count: nextCount, trusted: nextTrusted });
  }

  return {
    devices: currentDevices,
    summary: {
      threshold,
      legacyDevices: legacyDevices.length,
      currentDevices: currentDevices.length,
      historicalOtpEvents,
      matchedDevices,
      updatedDevices,
      newlyTrusted,
      ambiguousDevices,
      missingCurrentDevices,
      incompleteIdentity,
      changedByOtpCount: changed.reduce((acc, row) => {
        const key = String(row.otp_count);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

function parseArgs(argv) {
  const out = { apply: false, actor: 'CEO-approved-migration' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--legacy-auth-dir') out.legacyAuthDir = argv[++i];
    else if (arg === '--current-auth-dir') out.currentAuthDir = argv[++i];
    else if (arg === '--expect-updated') out.expectUpdated = Number(argv[++i]);
    else if (arg === '--expect-trusted') out.expectTrusted = Number(argv[++i]);
    else if (arg === '--actor') out.actor = argv[++i];
    else throw new Error(`UNKNOWN_ARG:${arg}`);
  }
  if (!out.legacyAuthDir) throw new Error('REQUIRED_ARG:--legacy-auth-dir');
  out.legacyAuthDir = path.resolve(out.legacyAuthDir);
  out.currentAuthDir = path.resolve(out.currentAuthDir || path.join(__dirname, '..', 'data', 'auth'));
  return out;
}

function replaceDevicesAndAudit({ currentDevicesPath, currentAuditPath, devices, audit }) {
  // Đọc và validate cả hai file trước mọi write. Sau đó chuẩn bị đủ hai temp;
  // nếu bước replace thứ hai lỗi thì khôi phục cả hai từ bytes ban đầu.
  const originalDevices = fs.readFileSync(currentDevicesPath);
  const originalAudit = fs.readFileSync(currentAuditPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const devicesBackup = `${currentDevicesPath}.bak-trust-backfill-${stamp}`;
  const auditBackup = `${currentAuditPath}.bak-trust-backfill-${stamp}`;
  const devicesTmp = `${currentDevicesPath}.tmp-trust-backfill-${process.pid}`;
  const auditTmp = `${currentAuditPath}.tmp-trust-backfill-${process.pid}`;
  fs.writeFileSync(devicesTmp, JSON.stringify(devices, null, 2));
  fs.writeFileSync(auditTmp, JSON.stringify(audit, null, 2));
  fs.copyFileSync(currentDevicesPath, devicesBackup);
  fs.copyFileSync(currentAuditPath, auditBackup);
  try {
    fs.renameSync(devicesTmp, currentDevicesPath);
    fs.renameSync(auditTmp, currentAuditPath);
  } catch (error) {
    try {
      fs.writeFileSync(currentDevicesPath, originalDevices);
      fs.writeFileSync(currentAuditPath, originalAudit);
    } catch (rollbackError) {
      throw new Error(`BACKFILL_ROLLBACK_FAILED:${error.message}:${rollbackError.message}`);
    } finally {
      fs.rmSync(devicesTmp, { force: true });
      fs.rmSync(auditTmp, { force: true });
    }
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const legacyDevices = readJson(path.join(args.legacyAuthDir, 'devices.json'), [], { required: true });
  const legacyAudit = readJson(path.join(args.legacyAuthDir, 'audit_auth.json'), [], { required: true });
  const currentDevicesPath = path.join(args.currentAuthDir, 'devices.json');
  const currentAuditPath = path.join(args.currentAuthDir, 'audit_auth.json');
  const usersPath = path.join(__dirname, '..', 'data', 'users.json');
  const currentDevices = readJson(currentDevicesPath, [], { required: true });
  // Bắt buộc validate audit trước khi tính/ghi để tuyệt đối không có trust update
  // thiếu dấu vết migration.
  const currentAudit = readJson(currentAuditPath, [], { required: true });
  const users = readJson(usersPath, [], { required: true });
  const threshold = Math.max(1, Number(process.env.SESSION_TRUSTED_LOGIN_THRESHOLD || 3) || 3);
  const result = buildBackfill({ legacyDevices, legacyAudit, currentDevices, users, threshold });

  if (Number.isFinite(args.expectUpdated) && result.summary.updatedDevices !== args.expectUpdated) {
    throw new Error(`EXPECT_UPDATED_MISMATCH:${result.summary.updatedDevices}:${args.expectUpdated}`);
  }
  if (Number.isFinite(args.expectTrusted) && result.summary.newlyTrusted !== args.expectTrusted) {
    throw new Error(`EXPECT_TRUSTED_MISMATCH:${result.summary.newlyTrusted}:${args.expectTrusted}`);
  }

  if (args.apply) {
    const audit = [...currentAudit];
    audit.push({
      at: new Date().toISOString(),
      event: 'trusted_device_history_backfill',
      actor: args.actor,
      updated_devices: result.summary.updatedDevices,
      newly_trusted: result.summary.newlyTrusted,
      historical_otp_events: result.summary.historicalOtpEvents,
    });
    replaceDevicesAndAudit({
      currentDevicesPath,
      currentAuditPath,
      devices: result.devices,
      audit: audit.slice(-2000),
    });
  }

  const output = { mode: args.apply ? 'apply' : 'dry-run', ...result.summary };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildBackfill, main, normalizePhone };
