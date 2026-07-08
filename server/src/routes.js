/**
 * routes.js — Toàn bộ REST API. Quyền được kiểm ở BACKEND (scopeOf/requireAdmin).
 */
const express = require('express');
const ExcelJS = require('exceljs');
const multer = require('multer');
const crypto = require('crypto');
const store = require('./store');
const auth = require('./auth');
const A = require('./analytics');
const smart = require('./smart');
const uploadSvc = require('./upload');
const revenueRefresh = require('./revenueRefresh');
const targetAdmin = require('./targetAdmin');
const assignmentAdmin = require('./assignmentAdmin');
const targetAdjustment = require('./targetAdjustment');
const targetNotify = require('./targetNotify');
const notifyChannels = require('./notifyChannels');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const memo = new Map();
function clearTargetDependentCache() {
  if (typeof A.clearOverviewCache === 'function') A.clearOverviewCache();
}
function memoGet(key, ttlMs, build) {
  const hit = memo.get(key);
  const t = Date.now();
  if (hit && t - hit.t < ttlMs) return hit.v;
  const v = build();
  memo.set(key, { t, v });
  return v;
}

// Ngữ cảnh phiên/thiết bị: deviceId (từ body/header), IP thật (qua Cloudflare), user-agent.
function loginCtx(req) {
  return {
    deviceId: (req.body?.deviceId || req.headers['x-device-id'] || '').toString().trim() || null,
    ip: (req.headers['cf-connecting-ip'] || req.ip || '').toString(),
    ua: (req.headers['user-agent'] || '').toString().slice(0, 200),
  };
}

function periodCtx(q) {
  const periods = store.periodKys();
  const latest = store.latestKy();
  let kys = [];
  if (q.from && q.to) kys = store.periodRange(String(q.from), String(q.to));
  else if (q.ky) kys = periods.includes(String(q.ky)) ? [String(q.ky)] : [];
  if (!kys.length) kys = [latest];
  const ky = kys[kys.length - 1];
  return { ky, kys, from: kys[0], to: ky };
}

function qdOf(v) {
  const m = String(v || '').match(/QĐ\s*(\d+)|QD\s*(\d+)/i);
  return m ? `QĐ${m[1] || m[2]}` : '';
}
function productMetaFromRows(rows = [], contractorLookup) {
  const map = new Map();
  for (const r of rows) {
    const key = r.iit_code || r.product_name;
    if (!key) continue;
    const cur = map.get(key) || {
      iit_code: r.iit_code || key,
      product_name: r.product_name || key,
      active_ingredient: '',
      ham_luong: '',
      uom: '',
      contractor: '',
      contractor_code: '',
      contractor_name: '',
      bid_price: null,
      priority: '',
      qd: '',
    };
    const qd = qdOf(`${r.iit_code || ''} ${r.bid_package || ''}`);
    const rawCode = r.contractor_code || r.contractor || cur.contractor_code || cur.contractor || '';
    const code = contractorCodeFor(rawCode, contractorLookup, r.iit_code || key);
    map.set(key, {
      ...cur,
      iit_code: cur.iit_code || r.iit_code || key,
      product_name: cur.product_name || r.product_name || key,
      active_ingredient: cur.active_ingredient || r.active_ingredient || '',
      ham_luong: cur.ham_luong || r.ham_luong || '',
      uom: cur.uom || r.uom || '',
      contractor: cur.contractor || code || r.contractor_name || '',
      contractor_code: cur.contractor_code || code || '',
      contractor_name: cur.contractor_name || contractorNameFor(code, r.contractor_name, contractorLookup, r.iit_code || key) || '',
      bid_price: cur.bid_price ?? r.bid_price ?? null,
      priority: cur.priority || r.priority || '',
      qd: cur.qd || qd,
    });
  }
  return map;
}
function enrichProductMeta(rows = [], metaMap, contractorLookup) {
  return rows.map((r) => {
    const meta = metaMap.get(r.iit_code || r.product_name) || {};
    const qd = meta.qd || qdOf(`${r.iit_code || ''} ${r.bid_package || ''}`);
    const rawCode = r.contractor_code || meta.contractor_code || meta.contractor || r.contractor || '';
    const iit = r.iit_code || meta.iit_code || r.product_name || '';
    const code = contractorCodeFor(rawCode, contractorLookup, iit);
    return {
      ...r,
      qd,
      active_ingredient: qd === 'QĐ139' ? (r.active_ingredient || meta.active_ingredient || '') : '',
      ham_luong: qd === 'QĐ139' ? (r.ham_luong || meta.ham_luong || '') : '',
      uom: r.uom || meta.uom || '',
      contractor: r.contractor || meta.contractor || code,
      contractor_code: code,
      contractor_name: contractorNameFor(code, r.contractor_name || meta.contractor_name, contractorLookup, iit),
      bid_price: r.bid_price ?? meta.bid_price ?? null,
      priority: r.priority || meta.priority || '',
    };
  });
}
function pairLabel(code, name) {
  const c = String(code || '').trim();
  const n = String(name || '').trim();
  if (!c && !n) return '—';
  if (!c) return n;
  if (n && looksLikeContractorName(c)) return n;
  if (!n || n === c || c.includes(n)) return c;
  if (n.includes(c)) return `${c} - ${n.replace(c, '').trim().replace(/^[-–—·\s]+/, '')}`;
  return `${c} - ${n}`;
}
function normContractor(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
function looksLikeContractorName(v) {
  return /\b(c[oô]ng\s*ty|tnhh|tr[aá]ch\s*nhi[eệ]m|d[uư][oợ]c|pharma)\b/i.test(String(v || ''));
}
function contractorAliasTokens(code) {
  const raw = String(code || '').trim();
  const noPrefix = raw.replace(/^\d+[.\-_\s]*/, '');
  const vals = [raw, noPrefix, ...noPrefix.split(/[.\-_\s]+/)];
  return [...new Set(vals.map(normContractor).filter((x) => x.length >= 3))];
}
function contractorNamePart(v) {
  return String(v || '').split('/').map((x) => x.trim()).filter(Boolean)[0] || '';
}
function addContractorCandidate(bucket, name) {
  const n = contractorNamePart(name);
  if (!n) return;
  const cur = bucket.get(n) || { name: n, count: 0 };
  cur.count += 1;
  bucket.set(n, cur);
}
function addContractorCodeCandidate(bucket, code) {
  const c = String(code || '').trim();
  if (!c || looksLikeContractorName(c)) return;
  const cur = bucket.get(c) || { code: c, count: 0 };
  cur.count += 1;
  bucket.set(c, cur);
}
function pickContractorName(bucket) {
  if (!bucket || !bucket.size) return '';
  return [...bucket.values()].sort((a, b) => (b.count - a.count) || (b.name.length - a.name.length) || a.name.localeCompare(b.name, 'vi'))[0].name;
}
function pickContractorCode(bucket) {
  if (!bucket || !bucket.size) return '';
  return [...bucket.values()].sort((a, b) => (b.count - a.count) || (a.code.length - b.code.length) || a.code.localeCompare(b.code, 'vi'))[0].code;
}
function pairKey(iitCode, contractorToken) {
  const iit = String(iitCode || '').trim().toUpperCase();
  const token = normContractor(contractorToken);
  return iit && token ? `${iit}::${token}` : '';
}
function buildContractorNameLookup(rows = []) {
  const byCodeBuckets = new Map();
  const byPairBuckets = new Map();
  const byCanonicalCodeBuckets = new Map();
  const byPairCanonicalCodeBuckets = new Map();
  const nameCandidates = new Set();
  function addByCode(token, name) {
    if (!token || !name) return;
    if (!byCodeBuckets.has(token)) byCodeBuckets.set(token, new Map());
    addContractorCandidate(byCodeBuckets.get(token), name);
  }
  function addByPair(iit, token, name) {
    const key = pairKey(iit, token);
    if (!key || !name) return;
    if (!byPairBuckets.has(key)) byPairBuckets.set(key, new Map());
    addContractorCandidate(byPairBuckets.get(key), name);
  }
  function addCanonicalCode(token, code) {
    if (!token || !code || looksLikeContractorName(code)) return;
    if (!byCanonicalCodeBuckets.has(token)) byCanonicalCodeBuckets.set(token, new Map());
    addContractorCodeCandidate(byCanonicalCodeBuckets.get(token), code);
  }
  function addPairCanonicalCode(iit, token, code) {
    const key = pairKey(iit, token);
    if (!key || !code || looksLikeContractorName(code)) return;
    if (!byPairCanonicalCodeBuckets.has(key)) byPairCanonicalCodeBuckets.set(key, new Map());
    addContractorCodeCandidate(byPairCanonicalCodeBuckets.get(key), code);
  }
  for (const r of rows) {
    const rawCode = String(r.contractor_code || r.contractor || '').trim();
    const rawName = contractorNamePart(r.contractor_name);
    const iit = r.iit_code || r.product_name || '';
    if (rawName && rawName !== rawCode) {
      for (const token of contractorAliasTokens(rawCode || rawName)) {
        addByCode(token, rawName);
        addByPair(iit, token, rawName);
        addCanonicalCode(token, rawCode);
        addPairCanonicalCode(iit, token, rawCode);
      }
      continue;
    }
    if (looksLikeContractorName(rawCode)) nameCandidates.add(rawCode);
  }
  // Một số nguồn legacy chỉ có tên công ty trong contractor_code, còn nguồn App Sale
  // chỉ có mã ngắn (AFP/DONA). Ghép theo token mã xuất hiện trong tên đã có sẵn.
  const names = [...nameCandidates].sort((a, b) => b.length - a.length);
  for (const r of rows) {
    const rawCode = String(r.contractor_code || r.contractor || '').trim();
    const iit = r.iit_code || r.product_name || '';
    if (!rawCode || looksLikeContractorName(rawCode)) continue;
    if (String(r.contractor_name || '').trim()) continue;
    const tokens = contractorAliasTokens(rawCode);
    const found = names.find((name) => tokens.some((t) => normContractor(name).includes(t)));
    if (found) for (const t of tokens) {
      addByCode(t, found);
      addByPair(iit, t, found);
    }
  }
  const byCode = new Map([...byCodeBuckets.entries()].map(([k, bucket]) => [k, pickContractorName(bucket)]));
  byCode.byPair = new Map([...byPairBuckets.entries()].map(([k, bucket]) => [k, pickContractorName(bucket)]));
  byCode.canonicalCode = new Map([...byCanonicalCodeBuckets.entries()].map(([k, bucket]) => [k, pickContractorCode(bucket)]));
  byCode.pairCanonicalCode = new Map([...byPairCanonicalCodeBuckets.entries()].map(([k, bucket]) => [k, pickContractorCode(bucket)]));
  return byCode;
}
function contractorCodeFor(code, lookup, iitCode = '') {
  const c = String(code || '').trim();
  if (!c) return '';
  if (!looksLikeContractorName(c)) return c;
  const tokens = contractorAliasTokens(c);
  if (iitCode && lookup?.pairCanonicalCode) {
    for (const token of tokens) {
      const hit = lookup.pairCanonicalCode.get(pairKey(iitCode, token));
      if (hit) return hit;
    }
  }
  for (const token of tokens) {
    const hit = lookup?.canonicalCode?.get(token);
    if (hit) return hit;
  }
  return c;
}
function contractorNameFor(code, name, lookup, iitCode = '') {
  const n = contractorNamePart(name);
  if (n) return n;
  const tokens = contractorAliasTokens(code);
  if (iitCode && lookup?.byPair) {
    for (const token of tokens) {
      const hit = lookup.byPair.get(pairKey(iitCode, token));
      if (hit) return hit;
    }
  }
  for (const token of tokens) {
    const hit = lookup?.get(token);
    if (hit) return hit;
  }
  return '';
}
function enrichContractorNames(rows = [], lookup) {
  return rows.map((r) => {
    const rawCode = r.contractor_code || r.contractor;
    const code = contractorCodeFor(rawCode, lookup, r.iit_code || r.product_name);
    const name = contractorNameFor(rawCode || code, r.contractor_name, lookup, r.iit_code || r.product_name);
    const next = { ...r };
    if (code && code !== r.contractor_code) next.contractor_code = code;
    if (name && name !== r.contractor_name) next.contractor_name = name;
    return next;
  });
}
function contractorLookupFor(scope, extraRows = []) {
  const all = store.getRowsRange({ kys: store.periodKys(), scope }).concat(store.getCst({ scope }), extraRows);
  return buildContractorNameLookup(all);
}
function contractorOptions(rows = [], lookup = buildContractorNameLookup(rows)) {
  const m = new Map();
  for (const r of rows) {
    const rawCode = String(r.contractor_code || r.contractor || '').trim();
    const code = contractorCodeFor(rawCode, lookup, r.iit_code || r.product_name);
    const name = contractorNameFor(rawCode || code, r.contractor_name, lookup, r.iit_code || r.product_name);
    if (!code && !name) continue;
    const key = code || name;
    const cur = m.get(key) || { key, code, name: '' };
    if (!cur.name && name && name !== code) cur.name = name;
    m.set(key, cur);
  }
  return [...m.values()].map((x) => ({
    key: x.key,
    label: pairLabel(x.code || x.key, x.name),
    kind: 'contractor',
    code: x.code || x.key,
    name: x.name,
  })).sort((a, b) => String(a.key).localeCompare(String(b.key), 'vi'));
}
function cstSourceLabel(r = {}) {
  const base = r.cst_baseline_covered_ky || (/MAY/i.test(String(r.source_from_date || '')) ? '05.2026' : '');
  const up = r.cst_upload_ky || '';
  if (base && up) return `Baseline ${base} + bán đến ${String(up).split(',').at(-1)}`;
  if (base) return `Cập nhật đến kỳ ${base}`;
  return r.source_from_date || '';
}

/* ---------- Auth ---------- */
// Demo login (TODO(LIVE): thay bằng OTP/SSO). Body: { emp_code }
router.post('/auth/login', (req, res) => {
  const r = auth.mockLogin((req.body.emp_code || '').trim().toUpperCase(), loginCtx(req));
  if (!r) return res.status(401).json({ error: 'Mã NV không tồn tại' });
  res.json({
    token: r.token,
    user: { emp_code: r.user.emp_code, name: r.user.name, role: r.user.role, route: r.user.route || null },
  });
});

// Danh sách tài khoản demo để bấm nhanh trên màn login (chỉ khi còn bật demo-login).
router.get('/auth/demo-users', (req, res) => {
  if (!auth.demoAllowed()) return res.json([]);
  res.json(store.listUsers().map((u) => ({ emp_code: u.emp_code, name: u.name, role: u.role, status: u.status || null })));
});

// Cho frontend biết chế độ đăng nhập: có OTP/SSO thật không, còn cho demo không.
router.get('/auth/mode', (req, res) => res.json({ live: auth.liveAuthEnabled(), demo: auth.demoAllowed(), telegram: auth.telegramConfigured() }));

// --- Đăng nhập THẬT (chỉ chạy khi cấu hình env OTP/SSO) ---
router.post('/auth/otp/request', async (req, res) => {
  try {
    const ok = await auth.requestOtp((req.body.phone || '').trim());
    res.json({ ok });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/auth/otp/verify', async (req, res) => {
  try {
    const r = await auth.verifyOtp((req.body.phone || '').trim(), (req.body.code || '').trim(), loginCtx(req));
    if (!r) return res.status(401).json({ error: 'Mã OTP không đúng hoặc đã hết hạn' });
    res.json(r); // { token, user } hoặc { accounts:[...] } nếu SĐT có nhiều mã NV
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Chọn tài khoản khi 1 SĐT có nhiều mã NV (sau khi OTP đã xác thực)
router.post('/auth/otp/select', (req, res) => {
  try {
    const r = auth.selectAccount((req.body.phone || '').trim(), (req.body.emp_code || '').trim(), loginCtx(req));
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/auth/sso', async (req, res) => {
  try {
    const r = await auth.verifySso((req.body.sso_token || '').trim(), loginCtx(req));
    if (!r) return res.status(401).json({ error: 'SSO không hợp lệ' });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- Đăng nhập TELEGRAM (chính) ---------- */
// Bắt đầu: trả mã RP-XXXXXX + poll_secret + link bot. Trình duyệt poll bằng poll_secret.
router.post('/auth/telegram/start', (req, res) => {
  try {
    res.json(auth.telegramStart(loginCtx(req)));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// Trình duyệt hỏi trạng thái bằng poll_secret (không phải mã hiển thị).
router.post('/auth/telegram/status', (req, res) => {
  try {
    res.json(auth.telegramStatus((req.body.poll_secret || '').toString()));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// CHỈ bot Telegram nội bộ gọi (kèm secret_bot = TELEGRAM_BOT_SECRET). Không dùng ở frontend.
router.post('/auth/telegram/confirm', (req, res) => {
  try {
    const r = auth.telegramConfirm({
      login_code: req.body.login_code,
      telegram_id: req.body.telegram_id,
      secret_bot: req.body.secret_bot,
    });
    res.json(r);
  } catch (e) {
    if (e.code === 'UNMAPPED') return res.status(404).json({ error: 'unmapped', message: 'Tài khoản Telegram chưa được cấp quyền App Report.' });
    res.status(e.status || 400).json({ error: e.message });
  }
});

/* ---------- Admin: mapping Telegram ---------- */
router.get('/admin/telegram-map', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(auth.listTelegramMap());
});
router.post('/admin/telegram-map', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try {
    res.json(auth.addTelegramMap(req.body.telegram_id, req.body.emp_code, req.session.emp_code));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/admin/telegram-map', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const removed = auth.removeTelegramMap(req.body.telegram_id || req.query.telegram_id);
  res.json({ ok: removed });
});

/* ---------- Admin: thiết bị tin cậy ---------- */
router.get('/admin/devices', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(auth.listDevices(req.query.emp || null));
});
router.delete('/admin/devices/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json({ ok: auth.removeDevice(req.params.id) });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ ...req.session, isAdmin: auth.isAdmin(req.session.role) });
});



function empLabel(code) {
  const u = store.findUserByCode(String(code || '').trim().toUpperCase());
  return u ? `${u.emp_code} · ${u.name}` : String(code || '—');
}
function salesCatalogRows(scope, { allPeriods = false } = {}) {
  const kys = allPeriods ? store.periodKys() : [store.latestKy()];
  const contractorLookup = contractorLookupFor(scope);
  const revenueRows = enrichContractorNames(store.getRowsRange({ kys, scope }), contractorLookup);
  const cstRows = enrichContractorNames(store.getCst({ scope }), contractorLookup);
  const metaMap = productMetaFromRows(cstRows.concat(revenueRows), contractorLookup);
  const map = new Map();
  for (const r of cstRows.concat(revenueRows)) {
    const key = r.iit_code || r.product_name;
    if (!key) continue;
    const meta = metaMap.get(key) || {};
    const cur = map.get(key) || {
      iit_code: r.iit_code || key,
      product_name: r.product_name || key,
      active_ingredient: meta.active_ingredient || '',
      ham_luong: meta.ham_luong || '',
      uom: meta.uom || '',
      priority: meta.priority || '',
      routes: new Set(),
      bidPackages: new Set(),
      contractors: new Set(),
      bid_price: meta.bid_price || null,
      cst_remain_qty: 0,
      cst_remain_amount: 0,
      cst_max_remain_pct: null,
      revenue: 0,
      quantity: 0,
      unitCount: new Set(),
      unitCodes: new Set(),
      empCount: new Set(),
      qd: meta.qd || qdOf(`${r.iit_code || ''} ${r.bid_package || ''}`),
    };
    if (r.active_ingredient && !cur.active_ingredient) cur.active_ingredient = r.active_ingredient;
    if (r.ham_luong && !cur.ham_luong) cur.ham_luong = r.ham_luong;
    if (r.uom && !cur.uom) cur.uom = r.uom;
    if (r.priority && !cur.priority) cur.priority = r.priority;
    if (r.route) cur.routes.add(r.route);
    if (r.bid_package) cur.bidPackages.add(r.bid_package);
    const cname = contractorNameFor(r.contractor_code || r.contractor, r.contractor_name, contractorLookup, r.iit_code || r.product_name || key);
    if (r.contractor_code || cname) cur.contractors.add(pairLabel(r.contractor_code || r.contractor, cname));
    if (r.bid_price != null && cur.bid_price == null) cur.bid_price = r.bid_price;
    cur.cst_remain_qty += Number(r.remain_qty || 0);
    cur.cst_remain_amount += Number(r.remain_amount || 0);
    if (r.remain_pct != null) cur.cst_max_remain_pct = Math.max(cur.cst_max_remain_pct || 0, Number(r.remain_pct || 0));
    cur.revenue += Number(r.revenue || r.sold_amount || 0);
    cur.quantity += Number(r.quantity || 0);
    if (r.unit_code || r.unit_name) cur.unitCount.add(r.unit_code || r.unit_name);
    if (r.unit_code) cur.unitCodes.add(r.unit_code);
    if (r.emp_code || r.sales_emps) String(r.emp_code || r.sales_emps).split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => cur.empCount.add(x));
    map.set(key, cur);
  }
  return [...map.values()].map((x) => ({
    ...x,
    routes: [...x.routes].sort().join(', '),
    bidPackages: [...x.bidPackages].slice(0, 6).join(', '),
    contractors: [...x.contractors].sort((a, b) => String(a).localeCompare(String(b), 'vi'))[0] || '',
    unitCount: x.unitCount.size,
    unitCodes: [...x.unitCodes],
    empCount: x.empCount.size,
  })).sort((a, b) => (b.revenue + b.cst_remain_amount) - (a.revenue + a.cst_remain_amount));
}

function filterCatalogByAssignments(rows, session, ky) {
  if (auth.isAdmin(session.role)) return rows;
  const assigns = assignmentAdmin.mine(session.emp_code, ky || store.latestKy());
  if (!assigns.length) return [];
  if (assigns.some((a) => a.type === 'all')) return rows;
  return rows.filter((r) => assigns.some((a) => {
    if (a.type === 'iit') return r.iit_code === a.value;
    if (a.type === 'group') return r.priority === a.value;
    if (a.type === 'route') return String(r.routes || '').split(',').map((x) => x.trim()).includes(a.value);
    if (a.type === 'unit') return (r.unitCodes || []).includes(a.value);
    if (a.type === 'special') return true;
    return false;
  }));
}

function specialCandidates(scope) {
  const cst = store.getCst({ scope });
  const revenue = store.getRowsRange({ kys: ['04.2026', '05.2026', '06.2026'], scope });
  const revByIit = new Map();
  const unitByIit = new Map();
  for (const r of revenue) {
    const k = r.iit_code || r.product_name;
    if (!k) continue;
    revByIit.set(k, (revByIit.get(k) || 0) + Number(r.revenue || 0));
    const s = unitByIit.get(k) || new Set();
    if (r.unit_code || r.unit_name) s.add(r.unit_code || r.unit_name);
    unitByIit.set(k, s);
  }
  const byIit = new Map();
  for (const r of cst) {
    const k = r.iit_code || r.product_name;
    if (!k) continue;
    const cur = byIit.get(k) || { iit_code: r.iit_code || k, product_name: r.product_name || k, remain_pct: 0, remain_qty: 0, remain_amount: 0, priority: r.priority || '', bid_package: r.bid_package || '' };
    cur.remain_pct = Math.max(cur.remain_pct || 0, Number(r.remain_pct || 0));
    cur.remain_qty += Number(r.remain_qty || 0);
    cur.remain_amount += Number(r.remain_amount || 0);
    if (!cur.priority && r.priority) cur.priority = r.priority;
    byIit.set(k, cur);
  }
  const items = [...byIit.values()];
  const tonNhieu = items.filter((x) => x.remain_pct >= 85 && x.remain_amount > 0).sort((a, b) => b.remain_amount - a.remain_amount).slice(0, 100).map((x) => ({ ...x, special_kind: 'ton_nhieu', reason: `CST còn ${x.remain_pct}%` }));
  const hangNgach = items.filter((x) => (revByIit.get(x.iit_code) || 0) < 50000000 || (unitByIit.get(x.iit_code)?.size || 0) <= 2).sort((a, b) => (revByIit.get(a.iit_code) || 0) - (revByIit.get(b.iit_code) || 0)).slice(0, 100).map((x) => ({ ...x, special_kind: 'hang_ngach', reason: `Doanh số/độ phủ thấp 04-06: ${revByIit.get(x.iit_code) || 0}đ · ${unitByIit.get(x.iit_code)?.size || 0} đơn vị` }));
  return {
    ton_nhieu: tonNhieu,
    hang_ngach: hangNgach,
    can_date: { source_missing: true, message: 'Thiếu nguồn hạn dùng/lô date trong App Report; GĐ1 để danh sách CEO chọn thủ công.' },
    sap_het_thau_cst_lon: { source_missing: true, message: 'Thiếu nguồn hạn gói thầu hd_den_ngay; chưa auto xác định sắp hết thầu-CST lớn.' },
  };
}

/* ---------- Metadata ---------- */
router.get('/periods', auth.requireAuth, (req, res) => {
  res.json({ periods: store.listPeriods(), latest: store.latestKy() });
});

router.get('/admin/revenue-refresh/status', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(revenueRefresh.status());
});

router.post('/admin/revenue-refresh/run', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    const r = await revenueRefresh.runOnce({ force: true, reason: 'admin_button', ky: req.body?.ky || req.query?.ky });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/filters', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  const uniq = (arr, key, label = key) => {
    const m = new Map();
    for (const r of arr) {
      const k = r[key];
      if (k != null && k !== '' && !m.has(k)) m.set(k, { key: k, label: r[label] || k });
    }
    return [...m.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), 'vi'));
  };
  let rows = store.getRowsRange({ kys: pc.kys, scope });
  const cst = store.getCst({ scope });
  const contractorLookup = contractorLookupFor(scope, rows.concat(cst));
  if (req.query.emp) {
    const emp = String(req.query.emp).trim().toUpperCase();
    rows = rows.filter((r) => r.emp_code === emp);
  }
  const empMap = new Map();
  for (const r of rows) if (r.emp_code) empMap.set(r.emp_code, { key: r.emp_code, label: r.emp_code === store.UNALLOCATED_EMP ? store.UNALLOCATED_LABEL : (r.emp_name || r.emp_code) });
  for (const r of cst) for (const ec of String(r.emp_code || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!empMap.has(ec)) empMap.set(ec, { key: ec, label: ec === store.UNALLOCATED_EMP ? store.UNALLOCATED_LABEL : (store.findUserByCode(ec)?.name || ec) });
  }
  res.json({
    ky: pc.ky,
    kys: pc.kys,
    employees: [...empMap.values()].sort((a, b) => String(a.key).localeCompare(String(b.key), 'vi')),
    units: uniq(rows.concat(cst), 'unit_code', 'unit_name').map((u) => ({ ...u, kind: 'unit' })),
    products: (() => {
      const pmap = productMetaFromRows(cst.concat(rows), contractorLookup);
      return [...pmap.values()].map((p) => ({
        key: p.iit_code,
        label: p.product_name,
        kind: 'product',
        ...p,
      })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'vi') || String(a.key).localeCompare(String(b.key), 'vi'));
    })(),
    provinces: uniq(rows.concat(cst), 'province'),
    routes: uniq(rows, 'route'),
    priorities: uniq(rows.concat(cst), 'priority'),
    contractors: contractorOptions(rows.concat(cst), contractorLookup),
    bidPackages: uniq(rows.concat(cst), 'bid_package'),
  });
});



/* ---------- Target Assignment GĐ1: catalog + phân công ---------- */
router.get('/catalog/sales', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  let rows = salesCatalogRows(scope, { allPeriods: req.query.all === '1' || req.query.all === 'true' });
  rows = filterCatalogByAssignments(rows, req.session, req.query.ky || store.latestKy());
  const q = String(req.query.q || '').trim().toLowerCase();
  const filtered = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : rows;
  const pg = paginate(filtered, req, 100, 1000);
  res.json({ total: pg.total, page: pg.page, pageSize: pg.pageSize, rows: pg.rows });
});
router.get('/assignments/mine', auth.requireAuth, (req, res) => {
  const emp = req.session.emp_code;
  const ky = req.query.ky || store.latestKy();
  const assignments = assignmentAdmin.mine(emp, ky).map((a) => ({ ...a, label: assignmentAdmin.typeLabel(a.type, a.value) }));
  res.json({ emp_code: emp, emp_name: store.findUserByCode(emp)?.name || emp, ky, assignments, specials: specialCandidates({ empCode: emp }) });
});
router.get('/specials', auth.requireAuth, (req, res) => res.json(specialCandidates(auth.scopeOf(req.session))));
router.get('/admin/assignments', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const rows = assignmentAdmin.listAssignments({ emp_code: req.query.emp, activeOnly: req.query.active === '1', ky: req.query.ky }).map((a) => ({ ...a, emp_name: store.findUserByCode(a.emp_code)?.name || a.emp_code, label: assignmentAdmin.typeLabel(a.type, a.value) }));
  res.json({ rows, types: assignmentAdmin.TYPES });
});
router.post('/admin/assignments', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { res.json({ ok: true, row: assignmentAdmin.upsert(req.body || {}, req.session) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/admin/assignments/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { res.json({ ok: true, row: assignmentAdmin.deactivate(req.params.id, req.session) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/assignments/seed', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { res.json({ ok: true, result: assignmentAdmin.seedFromHistory({ user: req.session, replaceAuto: !!req.body?.replaceAuto }) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/assignments/upload', auth.requireAuth, auth.requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Thiếu file upload' });
    const rows = await assignmentAdmin.parseWorkbook(req.file.buffer, req.session);
    const result = assignmentAdmin.commitRows(rows, req.session);
    res.json({ ok: true, result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/admin/assignments/history', auth.requireAuth, auth.requireAdmin, (req, res) => res.json({ history: assignmentAdmin.listAudit().slice(0, 300) }));
// Mẫu template NHẬP phân công: cột khớp parseWorkbook; nếu đã có phân công thì điền sẵn (dùng lại để nhập), chưa có thì cho ví dụ.
router.get('/admin/assignments/template.xlsx', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  const ky = String(req.query.ky || store.latestKy()).trim();
  const existing = assignmentAdmin.listAssignments({});
  const wb = new ExcelJS.Workbook();
  wb.creator = 'App Report New'; wb.created = new Date();
  const ws = wb.addWorksheet('Phan cong');
  ws.columns = [
    { header: 'emp_code', key: 'emp_code', width: 12 },
    { header: 'type', key: 'type', width: 12 },
    { header: 'value', key: 'value', width: 34 },
    { header: 'from_ky', key: 'from_ky', width: 12 },
    { header: 'to_ky', key: 'to_ky', width: 12 },
    { header: 'active', key: 'active', width: 10 },
    { header: 'note', key: 'note', width: 34 },
  ];
  const sample = existing.length
    ? existing.map((a) => ({ emp_code: a.emp_code, type: a.type, value: a.value, from_ky: a.from_ky, to_ky: a.to_ky || '', active: a.active === false ? 'false' : 'true', note: a.note || '' }))
    : [
      { emp_code: 'DN001', type: 'unit', value: '001.BVĐK Đồng Nai', from_ky: ky, to_ky: '', active: 'true', note: 'Ví dụ — phụ trách 1 đơn vị' },
      { emp_code: 'DN001', type: 'iit', value: 'G1.GE.QĐ139.3106.N5.484', from_ky: ky, to_ky: '', active: 'true', note: 'Ví dụ — phụ trách 1 mã QLNB' },
      { emp_code: 'DN002', type: 'all', value: 'all', from_ky: ky, to_ky: '', active: 'true', note: 'Ví dụ — phụ trách toàn bộ' },
    ];
  sample.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const guide = wb.addWorksheet('Huong dan');
  guide.addRows([
    ['Cột', 'Ý nghĩa'],
    ['emp_code', 'Mã NV phụ trách (VD DN001). Bắt buộc.'],
    ['type', 'unit=Đơn vị · group=Nhóm UT · route=Tuyến · iit=Mã QLNB · special=Hàng cần đẩy · all=Toàn bộ. Bắt buộc.'],
    ['value', 'Giá trị theo loại (mã/tên đơn vị, nhóm UT, tuyến, mã QLNB...). Với type=all ghi "all".'],
    ['from_ky', 'Kỳ bắt đầu hiệu lực MM.YYYY. Trống = kỳ hiện tại. KHÔNG hồi tố.'],
    ['to_ky', 'Kỳ kết thúc (trống = còn hiệu lực).'],
    ['active', 'true/false. Trống = true.'],
    ['note', 'Ghi chú (tuỳ chọn).'],
    ['Header tiếng Việt', 'File nhập cũng nhận: mã nv · loại · giá trị · từ kỳ · đến kỳ · hiệu lực · ghi chú.'],
    ['Cách dùng', 'Sửa/điền dòng rồi bấm "⬆ Upload Excel" ở tab Phân công. Upload có audit, hiệu lực từ kỳ, không hồi tố.'],
  ]);
  guide.getColumn(1).width = 18; guide.getColumn(2).width = 92;
  guide.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="assignment_template_${ky}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/* ---------- Overview + Alerts ---------- */
router.get('/overview', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  res.json(A.overviewKpis({ ...pc, scope }));
});

router.get('/trend', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const cacheKey = `trend:${scope.empCode || 'ALL'}`;
  res.json(memoGet(cacheKey, 60 * 1000, () => store.listPeriods().map((p) => {
    // Lightweight trend: không gọi overviewKpis vì hàm đó còn tính CST/target từng NV.
    const rows = store.getRows({ ky: p.ky, scope });
    const revenue = A.sum(rows, (r) => r.revenue);
    const targetTotal = A.sum(store.getTargets({ ky: p.ky, scope }), (t) => t.target);
    const revenueBeforeVat = Math.round(revenue / A.VAT_DIVISOR);
    return {
      ky: p.ky,
      revenue,
      revenueBeforeVat,
      targetTotal,
      pctTarget: targetTotal > 0 ? +(revenueBeforeVat / targetTotal * 100).toFixed(1) : null,
    };
  })));
});

router.get('/alerts', auth.requireAuth, (req, res) => {
  res.json(smart.buildAlerts({ ...periodCtx(req.query), scope: auth.scopeOf(req.session), compareMode: req.query.compareMode }));
});

/* ---------- Revenue drill-down ---------- */
router.get('/revenue', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  const dimension = ['emp', 'unit', 'product'].includes(req.query.dimension) ? req.query.dimension : 'emp';
  const filters = {
    emp: req.query.emp || null,
    unit: req.query.unit || null,
    product: req.query.product || null,
    route: req.query.route || null,
    priority: req.query.priority || null,
    contractor: req.query.contractor || null,
    bid: req.query.bid || null,
    q: req.query.q || null,
  };
  let outRows = A.revenueBreakdown({
    ...pc, scope, dimension, filters,
    filterEmp: null,
    filterUnit: null,
  });
  if (dimension === 'product') {
    const contractorLookup = contractorLookupFor(scope);
    const rawRows = enrichContractorNames(store.getRowsRange({ kys: pc.kys, scope }), contractorLookup);
    const metaMap = productMetaFromRows(enrichContractorNames(store.getCst({ scope }).concat(rawRows), contractorLookup), contractorLookup);
    const unitMap = new Map();
    for (const r of A.applyFilters(rawRows, filters)) {
      const key = r.iit_code || r.product_name || 'UNKNOWN';
      const cur = unitMap.get(key) || { units: new Set(), emps: new Set(), routes: new Set(), contractors: new Set(), priorities: new Set() };
      if (r.unit_code || r.unit_name) cur.units.add(A.baseUnitKey(r.unit_code || r.unit_name));
      if (r.emp_code || r.emp_name) cur.emps.add([r.emp_code, r.emp_name].filter(Boolean).join(' · '));
      if (r.route) cur.routes.add(r.route);
      if (r.contractor_code) cur.contractors.add(r.contractor_code);
      if (r.priority) cur.priorities.add(r.priority);
      unitMap.set(key, cur);
    }
    outRows = enrichProductMeta(outRows.map((r) => ({ ...r, ...(metaMap.get(r.key) || {}), label: r.label })), metaMap, contractorLookup)
      .map((r) => {
        const agg = unitMap.get(r.key) || {};
        return {
          ...r,
          unitCount: agg.units?.size || 0,
          empCount: agg.emps?.size || 0,
          routes: [...(agg.routes || [])].slice(0, 3).join(', '),
          contractor_code: r.contractor_code || [...(agg.contractors || [])][0] || '',
          contractor_name: contractorNameFor(r.contractor_code || [...(agg.contractors || [])][0], r.contractor_name, contractorLookup, r.iit_code || r.key),
          priority: r.priority || [...(agg.priorities || [])][0] || '',
        };
      });
  } else if (dimension === 'emp' || dimension === 'unit') {
    // Bổ sung: số ĐƠN VỊ (gộp mã theo baseUnitKey — tránh đếm nhầm NT-... thành 2),
    // số sản phẩm, số NV cho từng ô NV/đơn vị.
    const rawRows = A.applyFilters(store.getRowsRange({ kys: pc.kys, scope }), filters);
    const keyField = dimension === 'emp' ? 'emp_code' : 'unit_code';
    const aggMap = new Map();
    for (const r of rawRows) {
      const key = r[keyField];
      if (key == null) continue;
      const cur = aggMap.get(key) || { units: new Set(), products: new Set(), emps: new Set() };
      if (r.unit_code || r.unit_name) cur.units.add(A.baseUnitKey(r.unit_code || r.unit_name));
      if (r.iit_code || r.product_name) cur.products.add(r.iit_code || r.product_name);
      if (r.emp_code) cur.emps.add(r.emp_code);
      aggMap.set(key, cur);
    }
    outRows = outRows.map((r) => {
      const a = aggMap.get(r.key) || {};
      return { ...r, unitCount: a.units?.size || 0, productCount: a.products?.size || 0, empCount: a.emps?.size || 0 };
    });
  }
  res.json({
    ky: pc.ky,
    kys: pc.kys,
    dimension,
    rows: outRows,
  });
});

function revenueFiltersFromQuery(q) {
  return {
    emp: q.emp || null,
    province: q.province || null,
    unit: q.unit || null,
    product: q.product || null,
    route: q.route || null,
    priority: q.priority || null,
    contractor: q.contractor || null,
    bid: q.bid || null,
    dateFrom: q.dateFrom || null,
    dateTo: q.dateTo || null,
    q: q.q || null,
  };
}

function paginate(rows, req, def = 50, max = 500) {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(max, Math.max(10, Number(req.query.pageSize || def)));
  const start = (page - 1) * pageSize;
  return { page, pageSize, total: rows.length, rows: rows.slice(start, start + pageSize) };
}

/* ---------- Doanh thu đầy đủ: bảng chi tiết từng dòng bán hàng ---------- */
router.get('/revenue/full', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  const contractorLookup = contractorLookupFor(scope);
  const metaMap = productMetaFromRows(enrichContractorNames(store.getCst({ scope }).concat(store.getRowsRange({ kys: pc.kys, scope })), contractorLookup), contractorLookup);
  let rows = enrichProductMeta(enrichContractorNames(store.getRowsRange({ kys: pc.kys, scope }), contractorLookup), metaMap, contractorLookup);
  rows = A.applyFilters(rows, revenueFiltersFromQuery(req.query))
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  const totalRevenue = A.sum(rows, (r) => r.revenue);
  const totalQuantity = A.sum(rows, (r) => r.quantity);
  const pg = paginate(rows, req, 50, 500);
  res.json({
    ky: pc.ky,
    kys: pc.kys,
    page: pg.page,
    pageSize: pg.pageSize,
    total: pg.total,
    totalRevenue,
    totalQuantity,
    rows: pg.rows,
  });
});

/* ---------- Sản phẩm: tổng hợp theo mã QLNB/sản phẩm, kèm độ phủ ---------- */
router.get('/products', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  const contractorLookup = contractorLookupFor(scope);
  const rows = A.applyFilters(enrichContractorNames(store.getRowsRange({ kys: pc.kys, scope }), contractorLookup), revenueFiltersFromQuery(req.query));
  const metaMap = productMetaFromRows(enrichContractorNames(store.getCst({ scope }).concat(rows), contractorLookup), contractorLookup);
  const map = new Map();
  for (const r of rows) {
    const key = r.iit_code || r.product_name || 'UNKNOWN';
    const cur = map.get(key) || {
      key,
      iit_code: r.iit_code || key,
      product_name: r.product_name || key,
      revenue: 0,
      quantity: 0,
      rows: 0,
      units: new Set(),
      emps: new Set(),
      contractors: new Set(),
      bidPackages: new Set(),
      priorities: new Set(),
      routes: new Set(),
    };
    cur.revenue += r.revenue || 0;
    cur.quantity += r.quantity || 0;
    cur.rows += 1;
    if (r.unit_code || r.unit_name) cur.units.add(r.unit_code || r.unit_name);
    if (r.emp_code) cur.emps.add(r.emp_code);
    if (r.contractor_code) cur.contractors.add(r.contractor_code);
    if (r.bid_package) cur.bidPackages.add(r.bid_package);
    if (r.priority) cur.priorities.add(r.priority);
    if (r.route) cur.routes.add(r.route);
    map.set(key, cur);
  }
  const out = [...map.values()].map((x) => {
    const meta = metaMap.get(x.iit_code) || {};
    return ({
    key: x.key,
    iit_code: x.iit_code,
    product_name: x.product_name,
    qd: meta.qd || qdOf(x.iit_code),
    active_ingredient: meta.qd === 'QĐ139' ? (meta.active_ingredient || '') : '',
    ham_luong: meta.qd === 'QĐ139' ? (meta.ham_luong || '') : '',
    uom: meta.uom || '',
    contractor: meta.contractor || [...x.contractors][0] || '',
    contractor_code: meta.contractor_code || meta.contractor || [...x.contractors][0] || '',
    contractor_name: contractorNameFor(meta.contractor_code || meta.contractor || [...x.contractors][0], meta.contractor_name, contractorLookup, x.iit_code),
    bid_price: meta.bid_price || null,
    priority: meta.priority || [...x.priorities][0] || '',
    revenue: x.revenue,
    quantity: x.quantity,
    rows: x.rows,
    unitCount: x.units.size,
    empCount: x.emps.size,
    contractorCount: x.contractors.size,
    bidPackages: [...x.bidPackages].slice(0, 5).join(', '),
    routes: [...x.routes].slice(0, 5).join(', '),
    avgPrice: x.quantity ? Math.round(x.revenue / x.quantity) : null,
    });
  }).sort((a, b) => b.revenue - a.revenue);
  const pg = paginate(out, req, 50, 500);
  res.json({ ky: pc.ky, kys: pc.kys, page: pg.page, pageSize: pg.pageSize, total: pg.total, rows: pg.rows, totalRevenue: A.sum(out, (r) => r.revenue) });
});

/* ---------- Phân tích: so kỳ trước theo đơn vị/sản phẩm/tuyến/NV ---------- */
router.get('/analysis', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  const { ky, kys } = pc;
  const filters = revenueFiltersFromQuery(req.query);
  const prevKys = store.previousKys(kys);
  const prevKy = prevKys.length ? prevKys[prevKys.length - 1] : null;
  const currentRows = A.applyFilters(store.getRowsRange({ kys, scope }), filters);
  const prevRows = prevKys.length === kys.length ? A.applyFilters(store.getRowsRange({ kys: prevKys, scope }), filters) : [];
  const currentRevenue = A.sum(currentRows, (r) => r.revenue);
  const prevRevenue = A.sum(prevRows, (r) => r.revenue);
  const delta = currentRevenue - prevRevenue;
  const deltaPct = prevRevenue > 0 ? +(delta / prevRevenue * 100).toFixed(1) : null;
  // Bảng tăng/giảm: so tháng liền trước / cùng kỳ năm ngoái (tự lùi 2 tháng đủ nếu kỳ dở).
  const cmpMode = req.query.compareMode === 'yoy' ? 'yoy' : 'prev';
  const cmpP = store.comparePeriods(kys, cmpMode);
  const fmtKy = (k) => { const [m, y] = String(k || '').split('.'); return m && y ? `T${m}/${y}` : String(k || ''); };
  const growthNote = cmpP.yoyMissing
    ? `Chưa có dữ liệu cùng kỳ năm ngoái (${fmtKy(cmpP.prevKy)}) để so — cần nạp số ${String(cmpP.prevKy || '').split('.')[1] || 'năm trước'}.`
    : (!cmpP.hasPrev
      ? 'Chưa đủ dữ liệu kỳ trước để so tăng/giảm.'
      : (cmpP.mode === 'yoy'
        ? `Bảng tăng/giảm so cùng kỳ năm ngoái: ${fmtKy(cmpP.curKy)} với ${fmtKy(cmpP.prevKy)}.`
        : (cmpP.adjusted
          ? `⚠ Kỳ đang xem chưa đủ ngày — bảng tăng/giảm đang so 2 tháng đã hoàn tất: ${fmtKy(cmpP.curKy)} với ${fmtKy(cmpP.prevKy)}.`
          : `Bảng tăng/giảm so tháng liền trước: ${fmtKy(cmpP.curKy)} với ${fmtKy(cmpP.prevKy)}.`)));
  const compare = (dimension) => {
    const cur = A.revenueBreakdown({ kys: cmpP.curKys, scope, dimension, filters });
    const prev = cmpP.hasPrev ? A.revenueBreakdown({ kys: cmpP.prevKys, scope, dimension, filters }) : [];
    const prevMap = Object.fromEntries(prev.map((x) => [x.key, x.revenue]));
    return cur.map((x) => {
      const before = prevMap[x.key] || 0;
      const d = x.revenue - before;
      return { ...x, prevRevenue: before, delta: d, deltaPct: before > 0 ? +(d / before * 100).toFixed(1) : null };
    });
  };
  const byRoute = A.groupSum(currentRows, 'route', 'route').slice(0, 10);
  const contractorLabelByCode = Object.fromEntries(contractorOptions(currentRows).map((x) => [x.key, x.label]));
  const byContractor = A.groupSum(currentRows, 'contractor_code', 'contractor_code')
    .map((x) => ({ ...x, label: contractorLabelByCode[x.key] || x.label || x.key }))
    .slice(0, 10);
  const byPriority = A.groupSum(currentRows, 'priority', 'priority').slice(0, 10);
  const byBidPackage = A.groupSum(currentRows, 'bid_package', 'bid_package').slice(0, 10);
  // So sánh theo nhóm khác (route/tuyến…) — revenueBreakdown chỉ hỗ trợ unit/product/emp,
  // nên gom bằng groupSum trên đúng 2 kỳ so sánh (cmpP) để nhất quán bảng tăng/giảm.
  const compareGroup = (keyField, labelField) => {
    const cur = A.groupSum(A.applyFilters(store.getRowsRange({ kys: cmpP.curKys, scope }), filters), keyField, labelField);
    const prev = cmpP.hasPrev ? A.groupSum(A.applyFilters(store.getRowsRange({ kys: cmpP.prevKys, scope }), filters), keyField, labelField) : [];
    const prevMap = Object.fromEntries(prev.map((x) => [x.key, x.revenue]));
    return cur.map((x) => {
      const before = prevMap[x.key] || 0;
      const d = x.revenue - before;
      return { ...x, prevRevenue: before, delta: d, deltaPct: before > 0 ? +(d / before * 100).toFixed(1) : null };
    });
  };
  const unitCompare = compare('unit');
  const productCompare = compare('product');
  // Biến động theo TUYẾN: sắp theo mức chênh lệch tuyệt đối (tuyến chuyển động mạnh nhất trước).
  const routeDelta = compareGroup('route', 'route')
    .filter((x) => (x.revenue || 0) > 0 || (x.prevRevenue || 0) > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);
  // SP CHƯA KHAI THÁC: cơ số trúng thầu còn NGUYÊN (kỳ này chưa bán viên nào) — cơ hội để trống.
  const cstUntouched = A.cstTable({ scope, filters: { ...filters, status: 'empty' } })
    .sort((a, b) => Number(b.remain_qty || 0) - Number(a.remain_qty || 0))
    .slice(0, 10)
    .map((c) => ({
      key: `${c.iit_code || c.product_name}-${c.unit_code || c.unit_name}`,
      label: c.product_name,
      iit_code: c.iit_code,
      unit_code: c.unit_code,
      unit_name: c.unit_name || c.unit_code,
      remain_qty: c.remain_qty,
      bid_qty_initial: c.bid_qty_initial,
      remain_pct: c.remain_pct,
      qd: qdOf(`${c.iit_code || ''} ${c.bid_package || ''}`),
      active_ingredient: c.active_ingredient || '',
      ham_luong: c.ham_luong || '',
    }));
  const pushProducts = productCompare
    .filter((x) => (x.prevRevenue || 0) > 0 && x.delta < 0)
    .sort((a, b) => a.deltaPct - b.deltaPct)
    .slice(0, 10);
  const cstLowProducts = A.cstTable({ scope, remainPctMax: 10, filters })
    .slice(0, 10)
    .map((c) => ({
      key: `${c.iit_code || c.product_name}-${c.unit_code || c.unit_name}`,
      label: c.product_name,
      iit_code: c.iit_code,
      unit_code: c.unit_code,
      unit_name: c.unit_name || c.unit_code,
      remain_pct: c.remain_pct,
      remain_qty: c.remain_qty,
      bid_qty_initial: c.bid_qty_initial,
      qd: qdOf(`${c.iit_code || ''} ${c.bid_package || ''}`),
      active_ingredient: c.active_ingredient || '',
      ham_luong: c.ham_luong || '',
    }));
  res.json({
    ky,
    kys,
    prevKy,
    currentRevenue,
    prevRevenue,
    delta,
    deltaPct,
    growthNote,
    growthCompare: { curKy: cmpP.curKy, prevKy: cmpP.prevKy, adjusted: cmpP.adjusted, mode: cmpP.mode, yoyMissing: cmpP.yoyMissing },
    rowCount: currentRows.length,
    byRoute,
    byContractor,
    byPriority,
    byBidPackage,
    // CHỈ lấy đúng chiều: "tăng mạnh" = delta > 0, "giảm mạnh" = delta < 0.
    // (Trước đây chỉ lọc prevRevenue>0 rồi sort theo delta -> khi số đơn vị giảm < 10 thì
    //  danh sách "giảm" lấy bù bằng đơn vị TĂNG, gây lẫn lộn tăng/giảm.)
    topGrowthUnits: unitCompare.filter((x) => x.prevRevenue > 0 && x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10),
    topDeclineUnits: unitCompare.filter((x) => x.prevRevenue > 0 && x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
    topGrowthProducts: productCompare.filter((x) => x.prevRevenue > 0 && x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10),
    topDeclineProducts: productCompare.filter((x) => x.prevRevenue > 0 && x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
    pushProducts,
    cstLowProducts,
    cstUntouched,
    routeDelta,
  });
});

/* ---------- Cơ số thầu ---------- */
router.get('/cst', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  const contractorLookup = contractorLookupFor(scope);
  const rows = A.cstTable({
    scope,
    remainPctMax: num(req.query.remainMax),
    remainPctMin: num(req.query.remainMin),
    bidPackage: req.query.bid || null,
    filters: {
      emp: req.query.emp || null,
      province: req.query.province || null,
      unit: req.query.unit || null,
      product: req.query.product || null,
      priority: req.query.priority || null,
      status: req.query.status || null,
      q: req.query.q || null,
    },
  });
  res.json({ rows: enrichContractorNames(rows, contractorLookup) });
});

/* ---------- Target: xem + dự báo ---------- */
router.get('/targets', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  const { ky, kys } = pc;
  // Danh sách target = allowlist/has_target CEO chốt (0-BIS), không suy luận role/status.
  const targets = store.getTargetsRange({ kys, scope });
  const targetByEmp = {};
  for (const t of targets) targetByEmp[t.emp_code] = (targetByEmp[t.emp_code] || 0) + Number(t.target || 0);
  const targetMetaByEmp = Object.fromEntries(targets.map((t) => [t.emp_code, {
    source: t.target_source || t.source || '—',
    label: t.target_source_label || t.target_source || t.source || '—',
    source_ky: t.target_source_ky || null,
    reference: !!t.target_reference,
  }]));
  const pacing = A.targetPacingMeta(ky);
  const roster = store.targetRoster({ scope });
  // Perf: đọc doanh thu range 1 lần rồi group theo NV. Trước đây mỗi NV gọi getRowsRange()
  // riêng, làm trang Target chậm rõ trên mobile.
  const revenueByEmp = {};
  for (const r of store.getRowsRange({ kys, scope })) {
    const ec = r.emp_code;
    if (!ec) continue;
    revenueByEmp[ec] = (revenueByEmp[ec] || 0) + Number(r.revenue || 0);
  }
  const adjByEmp = targetAdjustment.totalsByEmp({ kys, empCodes: roster.map((u) => u.emp_code) });
  const items = roster.map((u) => {
    const ec = u.emp_code;
    const rev = revenueByEmp[ec] || 0;
    const beforeVat = rev / A.VAT_DIVISOR;
    const targetFull = targetByEmp[ec] || 0;
    // DIRECTIVE_TARGET_KPI: KPI so với target CẢ THÁNG để CEO/NV đọc dễ hiểu.
    // Pacing chỉ là metadata tham khảo, không dùng làm mẫu số chính.
    const target = targetFull;
    const tm = targetMetaByEmp[ec] || {};
    const assigned = targetFull > 0;
    const adj = adjByEmp.get(ec) || { total: 0, by_reason: { dut_hang: 0, cong_no: 0, khac: 0 }, rows: [] };
    const targetAdjusted = assigned ? Math.max(0, Math.round(targetFull - Number(adj.total || 0))) : 0;
    return {
      emp_code: ec,
      emp_name: u.name || ec,
      employee_type: store.employeeType(u),
      target_full: targetFull,
      target_original: targetFull,
      target_adjusted: targetAdjusted,
      target_compare: targetAdjusted || target,
      target,
      target_assigned: assigned,
      target_source: tm.source || null,
      target_source_label: tm.label || null,
      target_source_ky: tm.source_ky || null,
      target_reference: !!tm.reference,
      revenue_before_vat: Math.round(beforeVat),
      pct_original: assigned ? +(beforeVat / targetFull * 100).toFixed(1) : null,
      pct_adjusted: assigned && targetAdjusted > 0 ? +(beforeVat / targetAdjusted * 100).toFixed(1) : (assigned && targetAdjusted === 0 ? 100 : null),
      pct: assigned ? +(beforeVat / targetFull * 100).toFixed(1) : null,
      gap: assigned ? Math.round(beforeVat - targetFull) : null,
      gap_adjusted: assigned ? Math.round(beforeVat - targetAdjusted) : null,
      target_adjustment: { approved_total: Math.round(adj.total || 0), by_reason: adj.by_reason, rows: adj.rows },
    };
  }).sort((a, b) => b.revenue_before_vat - a.revenue_before_vat);
  const totalRevenueBeforeVat = Math.round(A.sum(items, (x) => x.revenue_before_vat));
  const totalTarget = Math.round(A.sum(items, (x) => x.target_full));
  const totalTargetAdjusted = Math.round(A.sum(items, (x) => x.target_adjusted || x.target_full));
  const totalAdjustment = Math.round(A.sum(items, (x) => x.target_adjustment?.approved_total || 0));
  const adjustmentByReason = items.reduce((acc, x) => {
    for (const [k, v] of Object.entries(x.target_adjustment?.by_reason || {})) acc[k] = (acc[k] || 0) + Number(v || 0);
    return acc;
  }, { dut_hang: 0, cong_no: 0, khac: 0 });
  const assignedCount = items.filter((x) => x.target_assigned).length;
  const achievedCount = items.filter((x) => x.target_assigned && x.revenue_before_vat >= x.target_full).length;
  const achievedAdjustedCount = items.filter((x) => x.target_assigned && x.revenue_before_vat >= (x.target_adjusted || x.target_full)).length;
  res.json({ ky, kys, pacing, kpi: targetKpiSummary(ky, scope), summary: { totalRevenueBeforeVat, totalTarget, totalTargetAdjusted, totalAdjustment, adjustmentByReason, pct: totalTarget > 0 ? +(totalRevenueBeforeVat / totalTarget * 100).toFixed(1) : null, pctAdjusted: totalTargetAdjusted > 0 ? +(totalRevenueBeforeVat / totalTargetAdjusted * 100).toFixed(1) : null, gap: totalTarget > 0 ? totalRevenueBeforeVat - totalTarget : null, gapAdjusted: totalTargetAdjusted > 0 ? totalRevenueBeforeVat - totalTargetAdjusted : null, assignedCount, unassignedCount: items.length - assignedCount, achievedCount, achievedAdjustedCount, totalEmployees: items.length }, items });
});
// KPI target gọn (tháng+quý+pacing) — cho trang Phân tích (và nơi khác cần), theo scope.
router.get('/targets/kpi', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const ky = req.query.ky || store.lastCompleteKy() || store.latestKy();
  res.json({ kpi: targetKpiSummary(ky, scope) });
});
// Xem trước (DRY-RUN) thông báo target sẽ gửi — CEO duyệt trước khi bật gửi thật.
// KHÔNG gửi, KHÔNG đổi trạng thái. Worker (telegram-bot) mới là nơi gửi + đánh dấu.
router.get('/admin/notifications/preview', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const ky = req.query.ky || undefined;
  const p = targetNotify.pendingEvents({ ky });
  res.json({
    ky: p.ky, timePct: p.timePct,
    events: p.events.map((e) => ({ emp_code: e.emp_code, name: e.name, type: e.type, milestone: e.milestone || null, pct: e.pct, message: targetNotify.messageFor(e) })),
    ceoDigest: targetNotify.ceoDigest({ ky }),
  });
});
// Gửi CHỦ ĐỘNG (CEO bấm). testOnly=true: chỉ gửi bản tổng cho chính CEO (gửi thử).
// Ngược lại: gửi tin cho từng NV (mốc/chậm nhịp) + bản tổng cho admin, và ĐÁNH DẤU đã gửi
// (chống trùng với lịch tự động). Cần app có TELEGRAM_BOT_TOKEN.
router.post('/admin/notifications/send', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    if (!notifyChannels.anyReady()) return res.status(400).json({ error: 'Chưa cấu hình kênh nào (Telegram token / SMTP email). Nhờ bot bổ sung env.' });
    const ky = req.body?.ky || undefined;
    const testOnly = req.body?.testOnly === true;
    const maps = auth.listTelegramMap();
    const tidByEmp = {};
    for (const m of maps) tidByEmp[String(m.emp_code || '').toUpperCase()] = String(m.telegram_id);
    if (testOnly) {
      const meEmp = String(req.session.emp_code || '').toUpperCase();
      const meUser = store.findUserByCode(meEmp);
      const r = await notifyChannels.deliver({ telegramId: tidByEmp[meEmp], email: notifyChannels.emailFor(meEmp, meUser?.email), subject: '[GỬI THỬ] DNPHARMA Target', text: '🧪 [GỬI THỬ]\n' + targetNotify.ceoDigest({ ky }) });
      return r.ok ? res.json({ ok: true, test: true, channels: r.channels }) : res.status(400).json({ error: 'Tài khoản của bạn chưa có Telegram lẫn email để gửi thử.' });
    }
    const { events } = targetNotify.pendingEvents({ ky });
    const sent = []; let skipped = 0; const chan = { telegram: 0, email: 0 };
    for (const e of events) {
      const user = store.findUserByCode(e.emp_code);
      if (!user || user.no_auto_notify) { skipped += 1; continue; }
      const email = notifyChannels.emailFor(e.emp_code, user?.email);
      const tid = tidByEmp[e.emp_code];
      if (!tid && !email) { skipped += 1; continue; } // chưa có kênh nào -> để dành
      const r = await notifyChannels.deliver({ telegramId: tid, email, subject: 'DNPHARMA — Nhắc target', text: targetNotify.messageFor(e) });
      if (r.ok) { sent.push(e); r.channels.forEach((c) => { chan[c] = (chan[c] || 0) + 1; }); } else skipped += 1;
    }
    targetNotify.markSent(sent);
    let ceoSent = 0;
    for (const m of maps) {
      const u = store.findUserByCode(m.emp_code);
      if (u && auth.isAdmin(u.role)) { const r = await notifyChannels.deliver({ telegramId: String(m.telegram_id), email: notifyChannels.emailFor(u.emp_code, u.email), subject: 'DNPHARMA — Tổng hợp target', text: targetNotify.ceoDigest({ ky }) }); if (r.ok) ceoSent += 1; }
    }
    res.json({ ok: true, sentNv: sent.length, skipped, ceoSent, pending: events.length, byChannel: chan });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Gửi ĐÍCH DANH 1 NV (test/nudge) — tin trạng thái hiện tại, không cần vừa vượt mốc.
router.post('/admin/notifications/send-one', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  try {
    if (!notifyChannels.anyReady()) return res.status(400).json({ error: 'Chưa cấu hình kênh nào (Telegram token / SMTP email). Nhờ bot bổ sung env.' });
    const emp = String(req.body?.emp_code || '').trim().toUpperCase();
    if (!emp) return res.status(400).json({ error: 'Thiếu mã NV' });
    if (targetNotify.isMuted(emp)) return res.status(400).json({ error: `NV ${emp} nằm trong danh sách KHÔNG nhận thông báo (CEO chốt) — đã chặn.` });
    const st = targetNotify.statusFor(emp, req.body?.ky || undefined);
    if (!st) return res.status(400).json({ error: `NV ${emp} chưa được giao target kỳ này (không có gì để gửi).` });
    const user = store.findUserByCode(emp);
    const map = auth.listTelegramMap().find((m) => String(m.emp_code || '').toUpperCase() === emp);
    const email = notifyChannels.emailFor(emp, user?.email);
    if (!map && !email) return res.status(400).json({ error: `NV ${emp} chưa có Telegram lẫn email — chưa gửi được. Cần bạn ấy đăng nhập Telegram hoặc bổ sung email.` });
    const r = await notifyChannels.deliver({ telegramId: map ? String(map.telegram_id) : null, email, subject: 'DNPHARMA — Nhắc target', text: st.message });
    return r.ok ? res.json({ ok: true, emp_code: emp, channels: r.channels, message: st.message }) : res.status(400).json({ error: (r.telegram?.description || r.email?.description || 'Gửi thất bại') });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Chi tiết 1 NV: KPI + xu hướng target/đạt theo tháng + top sản phẩm/đơn vị.
// NV thường chỉ xem chính mình (scope.empCode); admin xem NV bất kỳ qua ?emp=.
router.get('/employee/detail', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const emp = String(scope.empCode || req.query.emp || '').trim().toUpperCase();
  if (!emp) return res.status(400).json({ error: 'Thiếu mã NV' });
  const ky = req.query.ky || store.lastCompleteKy() || store.latestKy();
  const user = store.findUserByCode(emp);
  const empScope = { empCode: emp };
  const monthly = store.periodKys().map((k) => {
    const rev = store.getRows({ ky: k, scope: empScope }).reduce((s, r) => s + Number(r.revenue || 0), 0);
    const target = targetAdmin.resolveTargets({ ky: k, empCodes: [emp] }).reduce((a, e) => a + (Number(e.target) > 0 ? Number(e.target) : 0), 0);
    const achieved = Math.round(rev / A.VAT_DIVISOR);
    return { ky: k, target: Math.round(target), achieved, pct: target > 0 ? +(achieved / target * 100).toFixed(1) : null };
  });
  const topProducts = A.revenueBreakdown({ ky, scope: empScope, dimension: 'product' }).slice(0, 12)
    .map((x) => ({ iit_code: x.key, product_name: x.label, revenue: Math.round(x.revenue), quantity: x.quantity }));
  const topUnits = A.revenueBreakdown({ ky, scope: empScope, dimension: 'unit' }).slice(0, 12)
    .map((x) => ({ unit_code: x.key, unit_name: x.label, revenue: Math.round(x.revenue) }));
  res.json({
    emp: { code: emp, name: user?.name || emp, type: store.employeeType(user || {}) },
    ky, kpi: targetKpiSummary(ky, empScope, [emp]), monthly, topProducts, topUnits,
  });
});


/* ---------- Target Adjustment GĐ2a: lý do bất khả kháng + CEO duyệt ---------- */
router.get('/target-adjustments', auth.requireAuth, (req, res) => {
  const isAdmin = auth.isAdmin(req.session.role);
  res.json({ rows: targetAdjustment.list({ ky: req.query.ky, emp_code: req.query.emp_code, status: req.query.status, session: req.session, isAdmin }), audit: isAdmin ? targetAdjustment.listAudit().slice(0, 50) : [] });
});
router.post('/target-adjustments', auth.requireAuth, (req, res) => {
  try {
    const isAdmin = auth.isAdmin(req.session.role);
    const payload = { ...req.body };
    if (!isAdmin) payload.emp_code = req.session.emp_code;
    const row = targetAdjustment.create(payload, req.session);
    res.json({ ok: true, row });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/target-adjustments/:id/approve', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { const row = targetAdjustment.setStatus(req.params.id, 'approved', req.session); clearTargetDependentCache(); res.json({ ok: true, row }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/target-adjustments/:id/reject', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { const row = targetAdjustment.setStatus(req.params.id, 'rejected', req.session); clearTargetDependentCache(); res.json({ ok: true, row }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/admin/target-adjustments/suggestions', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(targetAdjustment.suggestions({ ky: req.query.ky || store.latestKy(), scope: auth.scopeOf(req.session), emp_code: req.query.emp_code }));
});

// Dự báo target kỳ tới theo xu hướng
router.get('/targets/forecast', auth.requireAuth, (req, res) => {
  res.json(smart.forecastTargets({ scope: auth.scopeOf(req.session) }));
});

/* ---------- Target admin: manual > upload > appsale > ai > legacy ---------- */
function targetMatrix(ky) {
  const roster = store.targetRoster({ scope: {} });
  const codes = roster.map((u) => u.emp_code);
  const resolved = new Map(targetAdmin.resolveTargets({ ky, empCodes: codes }).map((e) => [e.emp_code, e]));
  const overrides = targetAdmin.overrideInfo({ ky, empCodes: codes });
  return roster.map((u) => {
    const r = resolved.get(u.emp_code) || null;
    const ov = overrides[u.emp_code] || null;
    return { emp_code: u.emp_code, emp_name: u.name, employee_type: store.employeeType(u), target: r?.target || 0, source: r?.source || null, scope: r?.scope || 'all', source_label: r?.source_label || r?.source || null, source_ky: r?.source_ky || null, reference: !!r?.reference, updated_at: r?.at || null, manual_override: !!ov?.manual_override, fallback_source: ov?.fallback_source || null, fallback_target: ov?.fallback_target || 0, fallback_label: ov?.fallback_label || null };
  });
}
// KPI Quản target: target giao (tháng/quý) + đã đạt thực (tháng/quý) + tiến độ thời gian.
function quarterMetaOf(ky) {
  const [m, y] = String(ky || '').split('.').map(Number);
  if (!m || !y) return { q: 0, year: y || 0, kys: [] };
  const q = Math.floor((m - 1) / 3) + 1;
  const start = (q - 1) * 3 + 1;
  return { q, year: y, kys: [start, start + 1, start + 2].map((mm) => `${String(mm).padStart(2, '0')}.${y}`) };
}
function targetKpiSummary(ky, scope, codesOverride) {
  const codes = codesOverride || store.targetRosterCodes({ scope });
  const codeSet = new Set(codes);
  const qm = quarterMetaOf(ky);
  const sumTargets = (kys) => Math.round(kys.reduce((s, k) => s + targetAdmin.resolveTargets({ ky: k, empCodes: codes }).reduce((a, e) => a + (Number(e.target) > 0 ? Number(e.target) : 0), 0), 0));
  const revBeforeVat = (kys) => {
    let rev = 0;
    for (const r of store.getRowsRange({ kys, scope })) if (codeSet.has(r.emp_code)) rev += Number(r.revenue || 0);
    return Math.round(rev / A.VAT_DIVISOR);
  };
  const pacing = A.targetPacingMeta(ky);
  const pct = (a, t) => (t > 0 ? +(a / t * 100).toFixed(1) : null);
  const monthTarget = sumTargets([ky]); const monthAchieved = revBeforeVat([ky]);
  const qTarget = sumTargets(qm.kys); const qAchieved = revBeforeVat(qm.kys);
  return {
    ky, quarter_label: qm.q ? `Q${qm.q}/${qm.year}` : null, quarter_kys: qm.kys,
    assigned_count: targetAdmin.resolveTargets({ ky, empCodes: codes }).filter((e) => Number(e.target) > 0).length, total_nv: codes.length,
    month: { target: monthTarget, achieved: monthAchieved, pct: pct(monthAchieved, monthTarget), gap: monthAchieved - monthTarget },
    quarter: { target: qTarget, achieved: qAchieved, pct: pct(qAchieved, qTarget), gap: qAchieved - qTarget },
    pacing: { days_elapsed: pacing.daysElapsed, days_in_month: pacing.daysInMonth, time_pct: +(pacing.factor * 100).toFixed(1), is_current: pacing.isCurrent },
  };
}
router.get('/admin/targets', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const ky = req.query.ky || store.latestKy();
  const scope = auth.scopeOf(req.session);
  const baseline = targetAdmin.baseline202606();
  res.json({ ky, rows: targetMatrix(ky), kpi: targetKpiSummary(ky, scope), baseline: { ky: baseline.ky, total: baseline.total, count: baseline.rows.length, label: 'T06/2026 Lumos' }, history: targetAdmin.listAudit().slice(0, 30) });
});
router.get('/admin/targets/template.xlsx', auth.requireAuth, auth.requireAdmin, async (req, res) => {
  const ky = String(req.query.ky || store.latestKy()).trim();
  const basis = String(req.query.basis || 't06').trim().toLowerCase();
  const rows = targetMatrix(ky);
  const baseline = targetAdmin.baseline202606();
  const baselineByEmp = new Map((baseline.rows || []).map((r) => [r.emp_code, Number(r.target || 0)]));
  const latestByEmp = basis === 'latest' ? targetAdmin.latestAssignedTargets({ beforeKy: ky, empCodes: rows.map((r) => r.emp_code) }) : new Map();
  function fillTarget(row) {
    if (Number(row.target || 0) > 0) return { value: Number(row.target || 0), source: row.source_label || row.source || 'Target hiện tại' };
    if (basis === 'blank') return { value: null, source: 'Trống — chưa giao target' };
    if (basis === 'latest') {
      const latest = latestByEmp.get(row.emp_code);
      if (latest) return { value: Number(latest.target || 0), source: `Căn cứ: kỳ gần nhất đã giao ${latest.ky}` };
      const b = baselineByEmp.get(row.emp_code);
      if (b) return { value: b, source: 'Căn cứ fallback: target T06/2026 Lumos' };
      return { value: null, source: 'Không có căn cứ' };
    }
    const b = baselineByEmp.get(row.emp_code);
    if (b) return { value: b, source: 'Căn cứ: target T06/2026 Lumos' };
    return { value: null, source: 'Không có căn cứ T06' };
  }
  const basisLabel = basis === 'blank' ? 'Trống' : basis === 'latest' ? 'Kỳ gần nhất đã giao' : 'Target T06/2026 Lumos';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'App Report New';
  wb.created = new Date();
  const ws = wb.addWorksheet('Target template');
  ws.columns = [
    { header: 'emp_code', key: 'emp_code', width: 12 },
    { header: 'emp_name', key: 'emp_name', width: 28 },
    { header: 'ky', key: 'ky', width: 12 },
    { header: 'target', key: 'target', width: 18 },
    { header: 'source', key: 'source', width: 38 },
    { header: 'note', key: 'note', width: 38 },
  ];
  rows.forEach((r) => {
    const fill = fillTarget(r);
    ws.addRow({
      emp_code: r.emp_code,
      emp_name: r.emp_name,
      ky,
      target: fill.value,
      source: fill.source,
      note: Number(r.target || 0) > 0 ? 'Target hiện tại của kỳ này; sửa nếu cần.' : `Chưa giao target kỳ ${ky}; điền sẵn theo ${basisLabel} để CEO sửa rồi upload.`,
    });
  });
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getColumn('target').numFmt = '#,##0';
  ws.autoFilter = 'A1:F22';
  const guide = wb.addWorksheet('Huong dan');
  guide.addRows([
    ['Template target kỳ', ky],
    ['Căn cứ xuất file', basisLabel],
    ['Baseline T06 Lumos', `${baseline.rows.length} NV · tổng ${Number(baseline.total || 0).toLocaleString('vi-VN')}đ`],
    ['Roster', `${rows.length} NV theo allowlist CEO chốt, tên lấy từ DB`],
    ['Cách nhập', 'Chỉ sửa cột target. Ô trống sẽ giữ nguyên target hiện tại. Nhập 0 nếu thật sự muốn giao target bằng 0.'],
    ['Ưu tiên điền sẵn', 'Nếu kỳ này đã có target thì dùng target hiện tại; nếu chưa giao thì dùng căn cứ đã chọn. Căn cứ không tự thành target live cho đến khi CEO upload/commit.'],
    ['Upload', 'Upload lại file này để preview → commit. Rollback theo batch/mã upload nếu cần.'],
  ]);
  guide.getColumn(1).width = 18; guide.getColumn(2).width = 80;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="target_template_${ky}_${basis || 't06'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});
router.post('/admin/targets/upload/preview', auth.requireAuth, auth.requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file .xlsx' });
  const valid = new Set(store.targetRoster({ scope: {} }).map((u) => u.emp_code));
  try {
    const parsed = await targetAdmin.parseTargetWorkbook(req.file.buffer, (code) => valid.has(String(code || '').toUpperCase()));
    if (parsed.errors.length) return res.status(422).json({ errors: parsed.errors, meta: parsed.meta, sample: parsed.rows.slice(0, 10) });
    const previewId = targetAdmin.stashPreview({ ...parsed, filename: req.file.originalname });
    res.json({ previewId, filename: req.file.originalname, meta: parsed.meta, skipped: parsed.skipped?.slice(0, 10) || [], sample: parsed.rows.slice(0, 10) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/targets/upload/commit', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { const result = targetAdmin.commitPreview({ previewId: req.body?.previewId, user: req.session }); clearTargetDependentCache(); res.json({ ok: true, result }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/targets/upload/rollback', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { const result = targetAdmin.rollbackBatch({ batchId: req.body?.batchId, user: req.session }); clearTargetDependentCache(); res.json({ ok: true, result }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/targets/manual', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const valid = new Set(store.targetRoster({ scope: {} }).map((u) => u.emp_code));
  const emp = String(req.body?.emp_code || '').toUpperCase();
  if (!valid.has(emp)) return res.status(400).json({ error: 'Mã NV không thuộc đội target hoặc là telesale' });
  try { const entry = targetAdmin.upsertEntry({ emp_code: emp, ky: req.body?.ky, target: req.body?.target, source: 'manual', user: req.session, note: req.body?.note || 'manual_edit' }); clearTargetDependentCache(); res.json({ ok: true, entry }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/targets/bulk', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const valid = new Set(store.targetRoster({ scope: {} }).map((u) => u.emp_code));
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const bad = rows.map((r) => String(r.emp_code || '').toUpperCase()).filter((c) => !valid.has(c));
  if (bad.length) return res.status(400).json({ error: `Mã NV không thuộc đội target: ${[...new Set(bad)].join(', ')}` });
  try { const result = targetAdmin.bulkUpsert({ rows, source: 'manual', user: req.session, note: req.body?.note || 'bulk_manual', batchId: req.body?.batchId }); clearTargetDependentCache(); res.json({ ok: true, result }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/targets/quarter', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const valid = new Set(store.targetRoster({ scope: {} }).map((u) => u.emp_code));
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const bad = items.map((r) => String(r.emp_code || '').toUpperCase()).filter((c) => !valid.has(c));
  if (bad.length) return res.status(400).json({ error: `Mã NV không thuộc đội target: ${[...new Set(bad)].join(', ')}` });
  try { const result = targetAdmin.upsertQuarter({ quarter: req.body?.quarter, year: req.body?.year, items, source: 'manual', user: req.session, note: req.body?.note || 'quarter_split3' }); clearTargetDependentCache(); res.json({ ok: true, result }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Gỡ target sửa tay (manual) của 1 NV ở 1 kỳ -> quay về nguồn kế (upload/nhân bản…).
router.post('/admin/targets/manual/clear', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { const result = targetAdmin.clearManualOverride({ emp_code: req.body?.emp_code, ky: req.body?.ky, user: req.session }); clearTargetDependentCache(); res.json({ ok: true, result }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Nhân bản target từ kỳ nguồn sang kỳ đích (không cần file). Sửa tay vẫn ưu tiên hơn.
router.post('/admin/targets/carryover', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try {
    const scope = auth.scopeOf(req.session);
    const empCodes = store.targetRosterCodes({ scope });
    const result = targetAdmin.carryOverTargets({ fromKy: req.body?.fromKy, toKy: req.body?.toKy, overwrite: req.body?.overwrite === true, empCodes, user: req.session, note: req.body?.note });
    clearTargetDependentCache();
    res.json({ ok: true, result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/admin/targets/ai/propose', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const fc = smart.forecastTargets({ scope: { empCode: null } });
  res.json({ ok: true, ...fc });
});
router.post('/admin/targets/ai/apply', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const ky = req.body?.ky || smart.forecastTargets({ scope: { empCode: null } }).next_ky;
  const items = Array.isArray(req.body?.items) ? req.body.items : smart.forecastTargets({ scope: { empCode: null } }).items;
  const valid = new Set(store.targetRoster({ scope: {} }).map((u) => u.emp_code));
  const batchId = `ai_${Date.now().toString(36)}`;
  try {
    const out = items.filter((x) => valid.has(String(x.emp_code || '').toUpperCase())).map((x) => targetAdmin.upsertEntry({ emp_code: x.emp_code, ky, target: x.target ?? x.suggested_target, source: 'ai', user: req.session, note: 'ai_apply', batchId }));
    clearTargetDependentCache(); res.json({ ok: true, batchId, rows: out.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/admin/targets/history', auth.requireAuth, auth.requireAdmin, (req, res) => res.json({ history: targetAdmin.listAudit() }));

/* ---------- AI hỏi nhanh (code-first) ---------- */
router.post('/ai/ask', auth.requireAuth, async (req, res) => {
  const answer = await smart.answerQuestion({
    text: req.body.text || '',
    scope: auth.scopeOf(req.session),
    session: req.session,
  });
  res.json(answer);
});

// Tra cứu ĐÍCH DANH có cấu trúc (cho ô "Tra cứu nhanh" trên web): thuốc/mã QLNB + đơn vị.
// Cùng phạm vi quyền như mọi query — NV chỉ thấy phần của mình.
router.get('/lookup', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const q = String(req.query.q || '').trim();
  const ky = req.query.ky || store.latestKy();
  if (q.length < 2) return res.json({ q, ky, products: [], units: [] });
  const products = smart.lookupProducts({ q, ky, scope, max: 6 });
  const units = smart.lookupUnits({ q, ky, scope, max: 6 });
  res.json({ q, ky, products, units });
});

/* ---------- Export Excel (qua backend + kiểm quyền) ---------- */
router.get('/export/:kind.xlsx', auth.requireAuth, async (req, res) => {
  const scope = auth.scopeOf(req.session);
  const ky = req.query.ky || store.latestKy();
  const kind = req.params.kind;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'App Report New';
  const ws = wb.addWorksheet('Report');

  if (kind === 'revenue') {
    const dim = ['emp', 'unit', 'product'].includes(req.query.dimension) ? req.query.dimension : 'emp';
    const rows = A.revenueBreakdown({ ky, scope, dimension: dim, filters: {
      emp: req.query.emp || null,
      unit: req.query.unit || null,
      product: req.query.product || null,
      route: req.query.route || null,
      priority: req.query.priority || null,
      contractor: req.query.contractor || null,
      bid: req.query.bid || null,
      q: req.query.q || null,
    } });
    ws.columns = [
      { header: 'Mã', key: 'key', width: 16 },
      { header: 'Tên', key: 'label', width: 40 },
      { header: 'Doanh thu', key: 'revenue', width: 20 },
      { header: 'Số lượng', key: 'quantity', width: 14 },
    ];
    rows.forEach((r) => ws.addRow(r));
  } else if (kind === 'revenue_full') {
    const rows = A.applyFilters(store.getRows({ ky, scope }), revenueFiltersFromQuery(req.query))
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    ws.columns = [
      { header: 'Kỳ', key: 'ky', width: 12 },
      { header: 'Mã NV', key: 'emp_code', width: 12 },
      { header: 'Tên NV', key: 'emp_name', width: 24 },
      { header: 'Tuyến', key: 'route', width: 10 },
      { header: 'Mã đơn vị', key: 'unit_code', width: 28 },
      { header: 'Tên đơn vị', key: 'unit_name', width: 34 },
      { header: 'Mã QLNB', key: 'iit_code', width: 24 },
      { header: 'Sản phẩm', key: 'product_name', width: 30 },
      { header: 'Nhà thầu', key: 'contractor_code', width: 30 },
      { header: 'Gói thầu', key: 'bid_package', width: 12 },
      { header: 'Số lượng', key: 'quantity', width: 12 },
      { header: 'Doanh thu', key: 'revenue', width: 18 },
    ];
    rows.forEach((r) => ws.addRow(r));
  } else if (kind === 'products') {
    const rows0 = A.revenueBreakdown({ ky, scope, dimension: 'product', filters: revenueFiltersFromQuery(req.query) });
    const contractorLookup = contractorLookupFor(scope);
    const metaMap = productMetaFromRows(store.getCst({ scope }).concat(store.getRows({ ky, scope })), contractorLookup);
    const rows = rows0.map((r) => ({ ...r, ...(metaMap.get(r.key) || {}), label: r.label }));
    ws.columns = [
      { header: 'Mã QLNB', key: 'key', width: 24 },
      { header: 'Sản phẩm', key: 'label', width: 34 },
      { header: 'QĐ', key: 'qd', width: 10 },
      { header: 'Hoạt chất', key: 'active_ingredient', width: 24 },
      { header: 'Hàm lượng', key: 'ham_luong', width: 14 },
      { header: 'ĐVT', key: 'uom', width: 10 },
      { header: 'Nhà thầu', key: 'contractor', width: 30 },
      { header: 'Giá thầu', key: 'bid_price', width: 14 },
      { header: 'Doanh thu', key: 'revenue', width: 18 },
      { header: 'Số lượng', key: 'quantity', width: 12 },
      { header: 'Số dòng', key: 'rows', width: 10 },
    ];
    rows.forEach((r) => ws.addRow(r));
  } else if (kind === 'cst') {
    const num = (v) => (v === undefined || v === '' ? null : Number(v));
    const rows = A.cstTable({ scope, remainPctMax: num(req.query.remainMax), remainPctMin: num(req.query.remainMin), bidPackage: req.query.bid || null, filters: {
      emp: req.query.emp || null,
      province: req.query.province || null,
      unit: req.query.unit || null,
      product: req.query.product || null,
      priority: req.query.priority || null,
      status: req.query.status || null,
      q: req.query.q || null,
    } });
    ws.columns = [
      { header: 'Mã QL nội bộ', key: 'iit_code', width: 24 },
      { header: 'Tên thuốc', key: 'product_name', width: 28 },
      { header: 'Hoạt chất', key: 'active_ingredient', width: 24 },
      { header: 'Hàm lượng', key: 'ham_luong', width: 14 },
      { header: 'ĐVT', key: 'uom', width: 10 },
      { header: 'UT', key: 'priority', width: 10 },
      { header: 'Gói thầu', key: 'bid_package', width: 18 },
      { header: 'Đơn vị', key: 'unit_name', width: 30 },
      { header: 'NV phụ trách', key: 'emp_code', width: 14 },
      { header: 'NV bán liên quan', key: 'sales_emps', width: 18 },
      { header: 'Giá thầu', key: 'bid_price', width: 14 },
      { header: 'Tổng TT', key: 'bid_qty_initial', width: 16 },
      { header: 'CST còn lại', key: 'remain_qty', width: 14 },
      { header: '% còn lại', key: 'remain_pct', width: 12 },
      { header: 'Tổng đã bán', key: 'sold_qty', width: 14 },
      { header: 'TT thầu', key: 'bid_amount', width: 18 },
      { header: 'TT đã bán', key: 'sold_amount', width: 18 },
      { header: 'TT còn lại', key: 'remain_amount', width: 18 },
      { header: 'Nguồn/cập nhật', key: 'source_label', width: 28 },
    ];
    rows.forEach((r) => ws.addRow({ ...r, qd: qdOf(`${r.iit_code || ''} ${r.bid_package || ''}`), source_label: cstSourceLabel(r) }));
  } else if (kind === 'assignments') {
    // Xuất phân công hiện có; cột khớp template để nhập lại được. Chỉ CEO/admin.
    if (!auth.isAdmin(req.session.role)) return res.status(403).json({ error: 'Chỉ CEO/admin được xuất phân công' });
    const rows = assignmentAdmin.listAssignments({ emp_code: req.query.emp, activeOnly: req.query.active === '1', ky: req.query.ky })
      .map((a) => ({ emp_code: a.emp_code, emp_name: store.findUserByCode(a.emp_code)?.name || a.emp_code, type: a.type, type_label: assignmentAdmin.typeLabel(a.type, a.value), value: a.value, from_ky: a.from_ky, to_ky: a.to_ky || '', active: a.active === false ? 'false' : 'true', source: a.source || 'manual', note: a.note || '' }));
    ws.columns = [
      { header: 'emp_code', key: 'emp_code', width: 12 },
      { header: 'emp_name', key: 'emp_name', width: 26 },
      { header: 'type', key: 'type', width: 12 },
      { header: 'Loại', key: 'type_label', width: 16 },
      { header: 'value', key: 'value', width: 34 },
      { header: 'from_ky', key: 'from_ky', width: 12 },
      { header: 'to_ky', key: 'to_ky', width: 12 },
      { header: 'active', key: 'active', width: 10 },
      { header: 'source', key: 'source', width: 12 },
      { header: 'note', key: 'note', width: 34 },
    ];
    rows.forEach((r) => ws.addRow(r));
  } else if (kind === 'adjustments') {
    // Xuất điều chỉnh target (GĐ2a) kèm trạng thái duyệt + lý do; NV chỉ thấy phần mình.
    const isAdmin = auth.isAdmin(req.session.role);
    const reasonLabel = { dut_hang: 'Đứt hàng', cong_no: 'Công nợ', khac: 'Khác' };
    const statusLabel = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
    const rows = targetAdjustment.list({ ky: req.query.ky, emp_code: req.query.emp_code, status: req.query.status, session: req.session, isAdmin });
    ws.columns = [
      { header: 'Mã NV', key: 'emp_code', width: 12 },
      { header: 'Kỳ', key: 'ky', width: 10 },
      { header: 'Lý do', key: 'reason_label', width: 14 },
      { header: 'Số tiền ảnh hưởng', key: 'impact_amount', width: 20 },
      { header: 'Trạng thái', key: 'status_label', width: 12 },
      { header: 'Ghi chú', key: 'note', width: 40 },
      { header: 'Người đề xuất', key: 'by', width: 16 },
      { header: 'Thời điểm', key: 'at', width: 22 },
      { header: 'Người duyệt', key: 'approved_by', width: 16 },
      { header: 'Duyệt lúc', key: 'approved_at', width: 22 },
    ];
    rows.forEach((r) => ws.addRow({ ...r, reason_label: reasonLabel[r.reason_type] || r.reason_type, status_label: statusLabel[r.status] || r.status }));
    ws.getColumn('impact_amount').numFmt = '#,##0';
  } else if (kind === 'analysis') {
    // Xuất phân tích: KPI + tăng/giảm ĐV & SP + cơ cấu + SP sắp hết CST (nhiều sheet).
    wb.removeWorksheet(ws.id);
    const pc = periodCtx(req.query);
    const { ky: aky, kys } = pc;
    const filters = revenueFiltersFromQuery(req.query);
    const prevKys = store.previousKys(kys);
    const curRows = A.applyFilters(store.getRowsRange({ kys, scope }), filters);
    const prevRows = prevKys.length === kys.length ? A.applyFilters(store.getRowsRange({ kys: prevKys, scope }), filters) : [];
    const curRev = A.sum(curRows, (r) => r.revenue);
    const prevRev = A.sum(prevRows, (r) => r.revenue);
    const compare = (dimension) => {
      const cur = A.revenueBreakdown({ kys, scope, dimension, filters });
      const prevMap = Object.fromEntries((prevRows.length ? A.revenueBreakdown({ kys: prevKys, scope, dimension, filters }) : []).map((x) => [x.key, x.revenue]));
      return cur.map((x) => { const before = prevMap[x.key] || 0; const d = x.revenue - before; return { ...x, prevRevenue: before, delta: d, deltaPct: before > 0 ? +(d / before * 100).toFixed(1) : null }; });
    };
    const s1 = wb.addWorksheet('Tong quan');
    s1.columns = [{ header: 'Chỉ số', key: 'k', width: 30 }, { header: 'Giá trị', key: 'v', width: 26 }];
    s1.addRows([
      { k: 'Kỳ', v: kys.join(', ') || aky },
      { k: 'Kỳ so sánh', v: prevKys.join(', ') || '—' },
      { k: 'Doanh thu kỳ này', v: curRev },
      { k: 'Doanh thu kỳ trước', v: prevRev },
      { k: 'Chênh lệch', v: curRev - prevRev },
      { k: '% thay đổi', v: prevRev > 0 ? +((curRev - prevRev) / prevRev * 100).toFixed(1) : null },
      { k: 'Số dòng', v: curRows.length },
    ]);
    s1.getColumn('v').numFmt = '#,##0';
    const compareSheet = (title, dimension) => {
      const data = compare(dimension).filter((x) => x.prevRevenue > 0);
      const growth = [...data].sort((a, b) => b.delta - a.delta).slice(0, 10);
      const decline = [...data].sort((a, b) => a.delta - b.delta).slice(0, 10);
      const s = wb.addWorksheet(title);
      s.columns = [
        { header: 'Chiều', key: 'grp', width: 10 },
        { header: 'Mã', key: 'key', width: 24 },
        { header: 'Tên', key: 'label', width: 36 },
        { header: 'Kỳ này', key: 'revenue', width: 18 },
        { header: 'Kỳ trước', key: 'prevRevenue', width: 18 },
        { header: 'Chênh lệch', key: 'delta', width: 18 },
        { header: '%', key: 'deltaPct', width: 10 },
      ];
      growth.forEach((x) => s.addRow({ ...x, grp: 'Tăng' }));
      decline.forEach((x) => s.addRow({ ...x, grp: 'Giảm' }));
      ['revenue', 'prevRevenue', 'delta'].forEach((c) => (s.getColumn(c).numFmt = '#,##0'));
      s.getRow(1).font = { bold: true };
    };
    compareSheet('Tang giam DV', 'unit');
    compareSheet('Tang giam SP', 'product');
    const s4 = wb.addWorksheet('Co cau');
    s4.columns = [{ header: 'Nhóm', key: 'grp', width: 14 }, { header: 'Khoá', key: 'key', width: 24 }, { header: 'Tên', key: 'label', width: 30 }, { header: 'Doanh thu', key: 'revenue', width: 18 }];
    const addGroup = (label, dimField) => A.groupSum(curRows, dimField, dimField).slice(0, 10).forEach((x) => s4.addRow({ grp: label, key: x.key, label: x.label || x.key, revenue: x.revenue }));
    addGroup('Tuyến', 'route'); addGroup('Nhà thầu', 'contractor_code'); addGroup('UT', 'priority'); addGroup('Gói thầu', 'bid_package');
    s4.getColumn('revenue').numFmt = '#,##0'; s4.getRow(1).font = { bold: true };
    const s5 = wb.addWorksheet('SP sap het CST');
    s5.columns = [
      { header: 'Mã QLNB', key: 'iit_code', width: 24 },
      { header: 'Sản phẩm', key: 'product_name', width: 30 },
      { header: 'Đơn vị', key: 'unit_name', width: 30 },
      { header: '% còn lại', key: 'remain_pct', width: 12 },
      { header: 'CST còn', key: 'remain_qty', width: 14 },
      { header: 'Tổng TT', key: 'bid_qty_initial', width: 14 },
    ];
    A.cstTable({ scope, remainPctMax: 10, filters }).slice(0, 50).forEach((c) => s5.addRow({ iit_code: c.iit_code, product_name: c.product_name, unit_name: c.unit_name || c.unit_code, remain_pct: c.remain_pct, remain_qty: c.remain_qty, bid_qty_initial: c.bid_qty_initial }));
    s5.getRow(1).font = { bold: true };
    [s1].forEach((s) => (s.getRow(1).font = { bold: true }));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report_analysis_${aky}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  } else {
    return res.status(400).json({ error: 'Loại export không hợp lệ' });
  }
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report_${kind}_${ky}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/* ---------- Upload doanh thu (admin) ---------- */
// 1) Preview: parse + validate, CHƯA ghi.
router.post('/upload/preview', auth.requireAuth, auth.requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file .xlsx' });
  try {
    const result = await uploadSvc.parseWorkbook(req.file.buffer);
    if (result.errors && result.errors.length) return res.status(422).json({ errors: result.errors, headerDetected: result.headerDetected });
    const previewId = crypto.randomBytes(8).toString('hex');
    uploadSvc.stashPreview(previewId, { rows: result.rows, meta: result.meta, filename: req.file.originalname });
    res.json({
      previewId,
      filename: req.file.originalname,
      meta: result.meta,
      warnings: result.warnings,
      warningCount: result.warningCount,
      sample: result.rows.slice(0, 8),
    });
  } catch (e) {
    res.status(400).json({ error: 'Không đọc được file: ' + e.message });
  }
});

// 2) Commit: ghi slot + audit.
router.post('/upload/commit', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const { previewId, ky, dateFrom, dateTo, mode } = req.body || {};
  if (!previewId || !ky) return res.status(400).json({ error: 'Thiếu previewId hoặc kỳ.' });
  try {
    const slot = uploadSvc.commitSlot({ previewId, ky, dateFrom, dateTo, mode: mode === 'update' ? 'update' : 'new', user: req.session });
    res.json({ ok: true, slot });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 3) Danh sách slot + nhật ký
router.get('/upload/slots', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json({ slots: uploadSvc.listSlots(), audit: uploadSvc.listAudit() });
});

// 4) Rollback / kích hoạt lại slot cũ
router.post('/upload/activate', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try {
    const slot = uploadSvc.activateSlot({ id: (req.body || {}).id, user: req.session });
    res.json({ ok: true, slot });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
