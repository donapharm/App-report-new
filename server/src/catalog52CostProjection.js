'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KIND = 'app-report-employee-cost-projection';
const SCHEMA_VERSION = 1;
const COST_COLUMNS = Object.freeze(Array.from({ length: 14 }, (_, index) => `c${index + 33}`));
const DEFAULT_ROOT = '/home/osboxes/app-report-custody/catalog52-v1';
let cache = { file: '', identity: '', value: null };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function root(env = process.env) { return path.resolve(String(env.CATALOG52_STORE_ROOT || DEFAULT_ROOT)); }
function projectionFile(period, env = process.env) { return path.join(root(env), 'packages', String(period), 'cost-projection.json'); }
function validPeriod(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')); }
function clean(value) { return String(value ?? '').trim(); }
function employee(value) { return clean(value).toUpperCase(); }

function build({ manifest, rows, actor, builtAt = new Date().toISOString() }) {
  const period = String(manifest?.period || '');
  if (!validPeriod(period) || !Array.isArray(rows) || rows.length !== manifest?.rowCount
    || !/^[a-f0-9]{64}$/.test(String(manifest?.packageChecksum || ''))) {
    throw Object.assign(new Error('Full52 source is not projection-safe.'), { code: 'CATALOG52_COST_SOURCE_INVALID' });
  }
  const labels = new Map((manifest.columns || []).map((column) => [column.key, clean(column.label)]));
  if (!COST_COLUMNS.every((key) => labels.has(key))) {
    throw Object.assign(new Error('Full52 cost columns are incomplete.'), { code: 'CATALOG52_COST_COLUMNS_INCOMPLETE' });
  }
  const employees = {};
  for (const source of rows) {
    const empCode = employee(source?.c6);
    if (!/^(DN|VP)\d{3}$/.test(empCode)) {
      throw Object.assign(new Error('Full52 employee identity is invalid.'), { code: 'CATALOG52_COST_EMPLOYEE_INVALID' });
    }
    const row = { unit_code: source.c7, c7: source.c7, c5: source.c5, c16: source.c16, c25: source.c25 };
    for (const key of COST_COLUMNS) {
      const number = Number(source[key]);
      if (!Number.isFinite(number)) throw Object.assign(new Error(`Full52 ${key} is invalid.`), { code: 'CATALOG52_COST_VALUE_INVALID' });
      row[key] = number;
    }
    const entry = employees[empCode] || { columns: COST_COLUMNS.map((key, index) => ({ key, pos: index + 33, label: labels.get(key) })), rows: [] };
    entry.rows.push(row); employees[empCode] = entry;
  }
  const employeeCodes = Object.keys(employees).sort();
  if (employeeCodes.length !== 21) {
    throw Object.assign(new Error('Full52 employee roster is incomplete.'), { code: 'CATALOG52_COST_ROSTER_INCOMPLETE' });
  }
  const identity = {
    schemaVersion: SCHEMA_VERSION, kind: KIND, period,
    sourceContract: manifest.contract, sourcePackageChecksum: manifest.packageChecksum,
    sourcePublishedAt: manifest.publishedAt, rowCount: rows.length, employeeCount: employeeCodes.length,
    employeeCodes, builtAt, actor: clean(actor), employees,
  };
  identity.projectionChecksum = sha256(canonical(identity));
  return identity;
}

function validate(value, expectedPeriod) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || value.kind !== KIND || value.period !== expectedPeriod
    || !/^[a-f0-9]{64}$/.test(String(value.sourcePackageChecksum || ''))
    || !/^[a-f0-9]{64}$/.test(String(value.projectionChecksum || ''))
    || value.employeeCount !== 21 || !Array.isArray(value.employeeCodes) || value.employeeCodes.length !== 21
    || !value.employees || typeof value.employees !== 'object') return null;
  const copy = { ...value }; delete copy.projectionChecksum;
  if (sha256(canonical(copy)) !== value.projectionChecksum) return null;
  return value;
}

function write(value, { env = process.env } = {}) {
  const checked = validate(value, value?.period);
  if (!checked) throw Object.assign(new Error('Cost projection checksum is invalid.'), { code: 'CATALOG52_COST_PROJECTION_INVALID' });
  const file = projectionFile(value.period, env); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file); fs.chmodSync(file, 0o600);
  const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  cache = { file: '', identity: '', value: null };
  return { period: value.period, rowCount: value.rowCount, employeeCount: value.employeeCount, projectionChecksum: value.projectionChecksum };
}

function read(period, { env = process.env } = {}) {
  if (!validPeriod(period)) return null;
  const file = projectionFile(period, env); let stat;
  try { stat = fs.statSync(file, { bigint: true }); } catch { return null; }
  const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  if (cache.file === file && cache.identity === identity) return cache.value;
  let value; try { value = validate(JSON.parse(fs.readFileSync(file, 'utf8')), period); } catch { return null; }
  if (!value) return null; cache = { file, identity, value }; return value;
}

function readEmployee(period, empCode, options = {}) {
  const projection = read(period, options); const kept = projection?.employees?.[employee(empCode)];
  if (!kept || !Array.isArray(kept.columns) || !Array.isArray(kept.rows) || !kept.rows.length) return null;
  return { payload: { period, columns: kept.columns.slice(), rows: kept.rows.slice() }, fetchedAt: projection.builtAt, source: 'app_report_full52', sourcePackageChecksum: projection.sourcePackageChecksum };
}

function fingerprint({ env = process.env } = {}) {
  const packages = path.join(root(env), 'packages'); let periods;
  try { periods = fs.readdirSync(packages).filter(validPeriod).sort(); } catch { return 'catalog52-cost:none'; }
  const parts = [];
  for (const period of periods) {
    const file = projectionFile(period, env);
    try { const stat = fs.statSync(file, { bigint: true }); parts.push(`${period}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`); } catch { /* no cost projection for this package */ }
  }
  return `catalog52-cost:${sha256(parts.join('|'))}`;
}

module.exports = { KIND, SCHEMA_VERSION, COST_COLUMNS, DEFAULT_ROOT, canonical, sha256, projectionFile, build, validate, write, read, readEmployee, fingerprint };
