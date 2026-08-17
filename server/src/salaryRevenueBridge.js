const crypto = require('crypto');

const TOKEN_HASH_ENV = 'SALARY_REVENUE_SERVICE_TOKEN_SHA256';
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const EMPLOYEE_RE = /^(DN|VP)\d{3}$/;

function bearerToken(header) {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function sameHash(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'hex');
  const right = Buffer.from(String(expected || ''), 'hex');
  return left.length === 32 && right.length === 32 && crypto.timingSafeEqual(left, right);
}

function uiPeriod(month) {
  const match = String(month || '').match(MONTH_RE);
  return match ? `${match[2]}.${match[1]}` : '';
}

function aggregateByEmployee(rows = []) {
  const totals = new Map();
  for (const row of rows) {
    const code = String(row?.emp_code || '').trim().toUpperCase();
    const amount = Number(row?.revenue);
    if (!EMPLOYEE_RE.test(code) || !Number.isFinite(amount)) continue;
    totals.set(code, (totals.get(code) || 0) + amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'vi'))
    .map(([ma, value]) => ({ ma, doanhSo: Math.round(value) }));
}

function createHandler({ store, tokenHashProvider = () => process.env[TOKEN_HASH_ENV] || '' }) {
  if (!store || typeof store.getRows !== 'function') throw new TypeError('store.getRows is required');
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const expectedHash = String(tokenHashProvider() || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) return res.status(503).json({ error: 'Salary revenue service is not configured', code: 'SALARY_REVENUE_NOT_CONFIGURED' });

    const actual = bearerToken(req.headers.authorization);
    if (!actual) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Bearer token required', code: 'SALARY_REVENUE_AUTH_REQUIRED' });
    }
    if (!sameHash(sha256(actual), expectedHash)) return res.status(403).json({ error: 'Forbidden', code: 'SALARY_REVENUE_FORBIDDEN' });

    const month = String(req.query.thang || '');
    const ky = uiPeriod(month);
    if (!ky) return res.status(400).json({ error: 'Tháng không hợp lệ (YYYY-MM)', code: 'SALARY_REVENUE_MONTH_INVALID' });

    const rows = store.getRows({ ky, scope: {} });
    return res.json({ thang: month, data: aggregateByEmployee(rows) });
  };
}

module.exports = { TOKEN_HASH_ENV, bearerToken, sha256, sameHash, uiPeriod, aggregateByEmployee, createHandler };
