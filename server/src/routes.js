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
function productMetaFromRows(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const key = r.iit_code || r.product_name;
    if (!key || map.has(key)) continue;
    map.set(key, {
      iit_code: r.iit_code || key,
      product_name: r.product_name || key,
      active_ingredient: r.active_ingredient || '',
      ham_luong: r.ham_luong || '',
      uom: r.uom || '',
      contractor: r.contractor_code || r.contractor_name || '',
      contractor_code: r.contractor_code || '',
      contractor_name: r.contractor_name || '',
      bid_price: r.bid_price || null,
      qd: qdOf(`${r.iit_code || ''} ${r.bid_package || ''}`),
    });
  }
  return map;
}
function pairLabel(code, name) {
  const c = String(code || '').trim();
  const n = String(name || '').trim();
  if (!c && !n) return '—';
  if (!c) return n;
  if (!n || n === c || c.includes(n)) return c;
  if (n.includes(c)) return `${c} · ${n.replace(c, '').trim().replace(/^[-–—·\s]+/, '')}`;
  return `${c} · ${n}`;
}
function contractorOptions(rows = []) {
  const m = new Map();
  for (const r of rows) {
    const code = String(r.contractor_code || r.contractor || '').trim();
    const name = String(r.contractor_name || '').trim();
    if (!code && !name) continue;
    const key = code || name;
    const cur = m.get(key) || { key, code, names: new Set() };
    if (name && name !== code) cur.names.add(name);
    m.set(key, cur);
  }
  return [...m.values()].map((x) => {
    const names = [...x.names].sort((a, b) => a.localeCompare(b, 'vi'));
    return { key: x.key, label: pairLabel(x.code || x.key, names.join(' / ')), kind: 'contractor', code: x.code || x.key, names };
  }).sort((a, b) => String(a.key).localeCompare(String(b.key), 'vi'));
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
      const pmap = productMetaFromRows(cst.concat(rows));
      return [...pmap.values()].map((p) => ({
        key: p.iit_code,
        label: p.product_name,
        kind: 'product',
        ...p,
      })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'vi') || String(a.key).localeCompare(String(b.key), 'vi'));
    })(),
    routes: uniq(rows, 'route'),
    priorities: uniq(rows.concat(cst), 'priority'),
    contractors: contractorOptions(rows.concat(cst)),
    bidPackages: uniq(rows.concat(cst), 'bid_package'),
  });
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
  res.json(smart.buildAlerts({ ...periodCtx(req.query), scope: auth.scopeOf(req.session) }));
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
    const metaMap = productMetaFromRows(store.getCst({ scope }).concat(store.getRowsRange({ kys: pc.kys, scope })));
    outRows = outRows.map((r) => ({ ...r, ...(metaMap.get(r.key) || {}), label: r.label }));
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
    unit: q.unit || null,
    product: q.product || null,
    route: q.route || null,
    priority: q.priority || null,
    contractor: q.contractor || null,
    bid: q.bid || null,
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
  let rows = store.getRowsRange({ kys: pc.kys, scope });
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
  const rows = A.applyFilters(store.getRowsRange({ kys: pc.kys, scope }), revenueFiltersFromQuery(req.query));
  const metaMap = productMetaFromRows(store.getCst({ scope }).concat(rows));
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
    };
    cur.revenue += r.revenue || 0;
    cur.quantity += r.quantity || 0;
    cur.rows += 1;
    if (r.unit_code || r.unit_name) cur.units.add(r.unit_code || r.unit_name);
    if (r.emp_code) cur.emps.add(r.emp_code);
    if (r.contractor_code) cur.contractors.add(r.contractor_code);
    if (r.bid_package) cur.bidPackages.add(r.bid_package);
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
    contractor_name: meta.contractor_name || '',
    bid_price: meta.bid_price || null,
    revenue: x.revenue,
    quantity: x.quantity,
    rows: x.rows,
    unitCount: x.units.size,
    empCount: x.emps.size,
    contractorCount: x.contractors.size,
    bidPackages: [...x.bidPackages].slice(0, 5).join(', '),
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
  const compare = (dimension) => {
    const cur = A.revenueBreakdown({ kys, scope, dimension, filters });
    const prev = prevRows.length ? A.revenueBreakdown({ kys: prevKys, scope, dimension, filters }) : [];
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
  const unitCompare = compare('unit');
  const productCompare = compare('product');
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
    rowCount: currentRows.length,
    byRoute,
    byContractor,
    byPriority,
    byBidPackage,
    topGrowthUnits: unitCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => b.delta - a.delta).slice(0, 10),
    topDeclineUnits: unitCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
    topGrowthProducts: productCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => b.delta - a.delta).slice(0, 10),
    topDeclineProducts: productCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
    pushProducts,
    cstLowProducts,
  });
});

/* ---------- Cơ số thầu ---------- */
router.get('/cst', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  res.json({
    rows: A.cstTable({
      scope,
      remainPctMax: num(req.query.remainMax),
      remainPctMin: num(req.query.remainMin),
      bidPackage: req.query.bid || null,
      filters: {
        emp: req.query.emp || null,
        unit: req.query.unit || null,
        product: req.query.product || null,
        priority: req.query.priority || null,
        status: req.query.status || null,
        q: req.query.q || null,
      },
    }),
  });
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
  const items = store.targetRoster({ scope }).map((u) => {
    const ec = u.emp_code;
    const rev = A.sum(store.getRowsRange({ kys, scope: { empCode: ec } }), (r) => r.revenue);
    const beforeVat = rev / A.VAT_DIVISOR;
    const targetFull = targetByEmp[ec] || 0;
    // DIRECTIVE_TARGET_KPI: KPI so với target CẢ THÁNG để CEO/NV đọc dễ hiểu.
    // Pacing chỉ là metadata tham khảo, không dùng làm mẫu số chính.
    const target = targetFull;
    const tm = targetMetaByEmp[ec] || {};
    const assigned = targetFull > 0;
    return {
      emp_code: ec,
      emp_name: u.name || ec,
      employee_type: store.employeeType(u),
      target_full: targetFull,
      target_compare: target,
      target,
      target_assigned: assigned,
      target_source: tm.source || null,
      target_source_label: tm.label || null,
      target_source_ky: tm.source_ky || null,
      target_reference: !!tm.reference,
      revenue_before_vat: Math.round(beforeVat),
      pct: assigned ? +(beforeVat / targetFull * 100).toFixed(1) : null,
      gap: assigned ? Math.round(beforeVat - targetFull) : null,
    };
  }).sort((a, b) => b.revenue_before_vat - a.revenue_before_vat);
  const totalRevenueBeforeVat = Math.round(A.sum(items, (x) => x.revenue_before_vat));
  const totalTarget = Math.round(A.sum(items, (x) => x.target_full));
  const assignedCount = items.filter((x) => x.target_assigned).length;
  const achievedCount = items.filter((x) => x.target_assigned && x.revenue_before_vat >= x.target_full).length;
  res.json({ ky, kys, pacing, summary: { totalRevenueBeforeVat, totalTarget, pct: totalTarget > 0 ? +(totalRevenueBeforeVat / totalTarget * 100).toFixed(1) : null, gap: totalTarget > 0 ? totalRevenueBeforeVat - totalTarget : null, assignedCount, unassignedCount: items.length - assignedCount, achievedCount, totalEmployees: items.length }, items });
});

// Dự báo target kỳ tới theo xu hướng
router.get('/targets/forecast', auth.requireAuth, (req, res) => {
  res.json(smart.forecastTargets({ scope: auth.scopeOf(req.session) }));
});

/* ---------- Target admin: manual > upload > appsale > ai > legacy ---------- */
function targetMatrix(ky) {
  const roster = store.targetRoster({ scope: {} });
  const resolved = new Map(targetAdmin.resolveTargets({ ky, empCodes: roster.map((u) => u.emp_code) }).map((e) => [e.emp_code, e]));
  return roster.map((u) => {
    const r = resolved.get(u.emp_code) || null;
    return { emp_code: u.emp_code, emp_name: u.name, employee_type: store.employeeType(u), target: r?.target || 0, source: r?.source || null, scope: r?.scope || 'all', source_label: r?.source_label || r?.source || null, source_ky: r?.source_ky || null, reference: !!r?.reference, updated_at: r?.at || null };
  });
}
router.get('/admin/targets', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const ky = req.query.ky || store.latestKy();
  const baseline = targetAdmin.baseline202606();
  res.json({ ky, rows: targetMatrix(ky), baseline: { ky: baseline.ky, total: baseline.total, count: baseline.rows.length, label: 'T06/2026 Lumos' }, history: targetAdmin.listAudit().slice(0, 30) });
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
    const metaMap = productMetaFromRows(store.getCst({ scope }).concat(store.getRows({ ky, scope })));
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
