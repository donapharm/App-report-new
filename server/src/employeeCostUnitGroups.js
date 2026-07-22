'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = process.env.EMPLOYEE_COST_UNIT_GROUPS_FILE
  || path.join(__dirname, '..', 'config', 'employee_cost_unit_groups.json');

let cached = null;
let cachedMtime = -1;

function normalizePrefix(value) {
  return String(value || '').trim().toLocaleUpperCase('vi')
    .normalize('NFC').replace(/[\s._/\\-]+/g, '');
}

function extractPrefix(unitCode) {
  const value = String(unitCode || '').trim();
  if (!value) return '';
  const withoutOrdinal = value.replace(/^\s*\d{1,4}\s*[.\-:/]\s*/, '');
  const token = withoutOrdinal.match(/^([^\s.\-:/()\d]+)/u)?.[1] || '';
  return normalizePrefix(token);
}

function readConfig() {
  let mtime = 0;
  try { mtime = fs.statSync(CONFIG_PATH).mtimeMs; } catch { mtime = 0; }
  if (cached && cachedMtime === mtime) return cached;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { raw = {}; }
  const aliases = new Map(Object.entries(raw.aliases || {}).map(([key, value]) => [normalizePrefix(key), normalizePrefix(value)]).filter(([key, value]) => key && value));
  const labels = new Map(Object.entries(raw.labels || {}).map(([key, value]) => [normalizePrefix(key), String(value || '').trim()]).filter(([key, value]) => key && value));
  cached = { version: Number(raw.version || 1), aliases, labels };
  cachedMtime = mtime;
  return cached;
}

function resolve(unitCode) {
  const prefix = extractPrefix(unitCode);
  if (!prefix) return { key: '', label: '', prefix: '', configured: false };
  const config = readConfig();
  const key = config.aliases.get(prefix) || prefix;
  return {
    key,
    label: config.labels.get(key) || key,
    prefix,
    configured: config.aliases.has(prefix) || config.labels.has(key),
  };
}

function resetForTests() {
  cached = null;
  cachedMtime = -1;
}

module.exports = { CONFIG_PATH, normalizePrefix, extractPrefix, resolve, resetForTests };
