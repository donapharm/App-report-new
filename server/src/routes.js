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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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
  res.json(store.listUsers().map((u) => ({ emp_code: u.emp_code, name: u.name, role: u.role })));
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
  const rows = store.getRowsRange({ kys: pc.kys, scope });
  const cst = store.getCst({ scope });
  const empMap = new Map();
  for (const r of rows) if (r.emp_code) empMap.set(r.emp_code, { key: r.emp_code, label: r.emp_name || r.emp_code });
  for (const r of cst) for (const ec of String(r.emp_code || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!empMap.has(ec)) empMap.set(ec, { key: ec, label: store.findUserByCode(ec)?.name || ec });
  }
  res.json({
    ky: pc.ky,
    kys: pc.kys,
    employees: [...empMap.values()].sort((a, b) => String(a.key).localeCompare(String(b.key), 'vi')),
    units: uniq(rows.concat(cst), 'unit_code', 'unit_name'),
    products: uniq(rows.concat(cst), 'iit_code', 'product_name'),
    routes: uniq(rows, 'route'),
    priorities: uniq(rows.concat(cst), 'priority'),
    contractors: uniq(rows, 'contractor_code'),
    bidPackages: uniq(rows.concat(cst), 'bid_package'),
  });
});

/* ---------- Overview + Alerts ---------- */
router.get('/overview', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const pc = periodCtx(req.query);
  res.json(A.overviewKpis({ ...pc, scope }));
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
  res.json({
    ky: pc.ky,
    kys: pc.kys,
    dimension,
    rows: A.revenueBreakdown({
      ...pc, scope, dimension, filters,
      filterEmp: null,
      filterUnit: null,
    }),
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
  const out = [...map.values()].map((x) => ({
    key: x.key,
    iit_code: x.iit_code,
    product_name: x.product_name,
    revenue: x.revenue,
    quantity: x.quantity,
    rows: x.rows,
    unitCount: x.units.size,
    empCount: x.emps.size,
    contractorCount: x.contractors.size,
    bidPackages: [...x.bidPackages].slice(0, 5).join(', '),
    avgPrice: x.quantity ? Math.round(x.revenue / x.quantity) : null,
  })).sort((a, b) => b.revenue - a.revenue);
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
  const byContractor = A.groupSum(currentRows, 'contractor_code', 'contractor_code').slice(0, 10);
  const byPriority = A.groupSum(currentRows, 'priority', 'priority').slice(0, 10);
  const unitCompare = compare('unit');
  const productCompare = compare('product');
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
    topGrowthUnits: unitCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => b.delta - a.delta).slice(0, 10),
    topDeclineUnits: unitCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
    topGrowthProducts: productCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => b.delta - a.delta).slice(0, 10),
    topDeclineProducts: productCompare.filter((x) => x.prevRevenue > 0).sort((a, b) => a.delta - b.delta).slice(0, 10),
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
  // Danh sách NV = NV thực sự có doanh thu (đúng App Report); target lấy từ nguồn target thật (0 nếu chưa import)
  const targets = store.getTargetsRange({ kys, scope });
  const targetByEmp = {};
  for (const t of targets) targetByEmp[t.emp_code] = (targetByEmp[t.emp_code] || 0) + Number(t.target || 0);
  const items = store.empCodesWithRows({ kys, scope }).map((ec) => {
    const rev = A.sum(store.getRowsRange({ kys, scope: { empCode: ec } }), (r) => r.revenue);
    const beforeVat = rev / A.VAT_DIVISOR;
    const target = targetByEmp[ec] || 0;
    return {
      emp_code: ec,
      emp_name: store.findUserByCode(ec)?.name || ec,
      target,
      revenue_before_vat: Math.round(beforeVat),
      pct: target > 0 ? +(beforeVat / target * 100).toFixed(1) : null,
      gap: Math.round(beforeVat - target),
    };
  }).sort((a, b) => b.revenue_before_vat - a.revenue_before_vat);
  res.json({ ky, kys, items });
});

// Dự báo target kỳ tới theo xu hướng
router.get('/targets/forecast', auth.requireAuth, (req, res) => {
  res.json(smart.forecastTargets({ scope: auth.scopeOf(req.session) }));
});

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
    const rows = A.revenueBreakdown({ ky, scope, dimension: 'product', filters: revenueFiltersFromQuery(req.query) });
    ws.columns = [
      { header: 'Mã QLNB', key: 'key', width: 24 },
      { header: 'Sản phẩm', key: 'label', width: 34 },
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
      { header: 'Giá bán', key: 'sale_price', width: 14 },
      { header: 'Tổng TT', key: 'bid_qty_initial', width: 16 },
      { header: 'CST còn lại', key: 'remain_qty', width: 14 },
      { header: '% còn lại', key: 'remain_pct', width: 12 },
      { header: 'Tổng đã bán', key: 'sold_qty', width: 14 },
      { header: 'TT thầu', key: 'bid_amount', width: 18 },
      { header: 'TT đã bán', key: 'sold_amount', width: 18 },
      { header: 'TT còn lại', key: 'remain_amount', width: 18 },
      { header: 'Ngày nguồn', key: 'source_from_date', width: 14 },
    ];
    rows.forEach((r) => ws.addRow(r));
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
  const { previewId, ky, dateFrom, dateTo } = req.body || {};
  if (!previewId || !ky) return res.status(400).json({ error: 'Thiếu previewId hoặc kỳ.' });
  try {
    const slot = uploadSvc.commitSlot({ previewId, ky, dateFrom, dateTo, user: req.session });
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
