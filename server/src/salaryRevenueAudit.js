'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LIMIT_PER_MINUTE = 60;

function bangkokTimestamp(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+07:00`;
}

function auditFile() {
  return process.env.SALARY_REVENUE_AUDIT_FILE
    || path.join(__dirname, '..', 'data', 'salary_revenue_access_audit.jsonl');
}

function createFileAuditor({ file = auditFile(), now = () => Date.now() } = {}) {
  return (entry) => {
    const safe = {
      at: bangkokTimestamp(now()),
      month: /^\d{4}-\d{2}$/.test(String(entry?.month || '')) ? String(entry.month) : null,
      recordCount: Number.isSafeInteger(entry?.recordCount) && entry.recordCount >= 0 ? entry.recordCount : 0,
      status: Number(entry?.status) || 500,
      result: String(entry?.result || 'unknown').slice(0, 80),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.appendFileSync(fd, `${JSON.stringify(safe)}\n`, 'utf8'); } finally { fs.closeSync(fd); }
    fs.chmodSync(file, 0o600);
  };
}

function configuredLimit(value = process.env.SALARY_REVENUE_RATE_LIMIT_PER_MINUTE) {
  const parsed = Number(value == null || value === '' ? DEFAULT_LIMIT_PER_MINUTE : value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 600 ? parsed : DEFAULT_LIMIT_PER_MINUTE;
}

function createMinuteLimiter({ limit = configuredLimit(), now = () => Date.now() } = {}) {
  const buckets = new Map();
  return {
    take(key) {
      const bucket = Math.floor(now() / 60_000);
      const id = String(key || 'anonymous');
      const current = buckets.get(id);
      const count = current?.bucket === bucket ? current.count + 1 : 1;
      buckets.set(id, { bucket, count });
      if (buckets.size > 10_000) {
        for (const [candidate, value] of buckets) if (value.bucket < bucket) buckets.delete(candidate);
      }
      return count <= limit;
    },
  };
}

module.exports = { DEFAULT_LIMIT_PER_MINUTE, bangkokTimestamp, createFileAuditor, configuredLimit, createMinuteLimiter };
