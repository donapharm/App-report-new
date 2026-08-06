'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = process.env.PAYMENT_REQUEST_REASONS_FILE
  || path.join(__dirname, '..', 'config', 'payment_request_reasons.json');
const SCHEMA_VERSION = 1;
const GROUPS = Object.freeze(['early', 'reject']);
const MAX_OPTIONS = 20;
const MAX_LABEL_LENGTH = 300;
const NOTE_MAX_LENGTH = 300;

let cachedVersion = '';
let cachedValue = null;

function configError(reason) {
  const error = new Error('Danh sách lý do thanh toán chưa sẵn sàng');
  error.status = 503;
  error.code = 'PAYMENT_REQUEST_REASONS_UNAVAILABLE';
  error.reason = reason;
  return error;
}

function normalizeOption(raw, group, index, seen) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw configError(`${group}_${index}_invalid`);
  const id = String(raw.id || '').trim();
  const label = String(raw.label || '').trim();
  if (!/^[a-z0-9_-]{1,60}$/.test(id) || seen.has(id)) throw configError(`${group}_${index}_id_invalid`);
  if (!label || label.length > MAX_LABEL_LENGTH) throw configError(`${group}_${index}_label_invalid`);
  seen.add(id);
  const requiresDetail = raw.requiresDetail === true;
  const minLength = requiresDetail ? Number(raw.minLength) : 0;
  if (requiresDetail && (!Number.isInteger(minLength) || minLength < 5 || minLength > 100
    || label.length + 2 + minLength > NOTE_MAX_LENGTH)) {
    throw configError(`${group}_${index}_detail_invalid`);
  }
  return { id, label, requiresDetail, minLength };
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== SCHEMA_VERSION) {
    throw configError('schema_invalid');
  }
  const result = { schemaVersion: SCHEMA_VERSION };
  for (const group of GROUPS) {
    const rows = raw[group];
    if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_OPTIONS) throw configError(`${group}_invalid`);
    const seen = new Set();
    result[group] = rows.map((row, index) => normalizeOption(row, group, index, seen));
    const detailOptions = result[group].filter((row) => row.requiresDetail);
    const other = result[group].find((row) => row.id === 'other');
    if (detailOptions.length !== 1 || !other?.requiresDetail) throw configError(`${group}_custom_invalid`);
  }
  return result;
}

function readFromFile(file = CONFIG_FILE) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw configError('missing');
  }
  const version = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (file === CONFIG_FILE && cachedValue && cachedVersion === version) return cachedValue;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw configError('json_invalid');
  }
  const normalized = normalize(parsed);
  if (file === CONFIG_FILE) {
    cachedVersion = version;
    cachedValue = normalized;
  }
  return normalized;
}

function resetCache() {
  cachedVersion = '';
  cachedValue = null;
}

module.exports = { CONFIG_FILE, SCHEMA_VERSION, GROUPS, normalize, readFromFile, resetCache };
