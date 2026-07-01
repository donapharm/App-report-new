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

/* ---------- Auth ---------- */
// Demo login (TODO(LIVE): thay bằng OTP/SSO). Body: { emp_code }
router.post('/auth/login', (req, res) => {
  const r = auth.mockLogin((req.body.emp_code || '').trim().toUpperCase());
  if (!r) return res.status(401).json({ error: 'Mã NV không tồn tại' });
  res.json({
    token: r.token,
    user: { emp_code: r.user.emp_code, name: r.user.name, role: r.user.role, route: r.user.route || null },
  });
});

// Danh sách tài khoản demo để bấm nhanh trên màn login (chỉ dùng cho bản mẫu).
router.get('/auth/demo-users', (req, res) => {
  res.json(store.listUsers().map((u) => ({ emp_code: u.emp_code, name: u.name, role: u.role })));
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ ...req.session, isAdmin: auth.isAdmin(req.session.role) });
});

/* ---------- Metadata ---------- */
router.get('/periods', auth.requireAuth, (req, res) => {
  res.json({ periods: store.listPeriods(), latest: store.latestKy() });
});

/* ---------- Overview + Alerts ---------- */
router.get('/overview', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const ky = req.query.ky || store.latestKy();
  res.json(A.overviewKpis({ ky, scope }));
});

router.get('/alerts', auth.requireAuth, (req, res) => {
  res.json(smart.buildAlerts({ scope: auth.scopeOf(req.session) }));
});

/* ---------- Revenue drill-down ---------- */
router.get('/revenue', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const ky = req.query.ky || store.latestKy();
  const dimension = ['emp', 'unit', 'product'].includes(req.query.dimension) ? req.query.dimension : 'emp';
  res.json({
    ky,
    dimension,
    rows: A.revenueBreakdown({
      ky, scope, dimension,
      filterEmp: req.query.emp || null,
      filterUnit: req.query.unit || null,
    }),
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
    }),
  });
});

/* ---------- Target: xem + dự báo ---------- */
router.get('/targets', auth.requireAuth, (req, res) => {
  const scope = auth.scopeOf(req.session);
  const ky = req.query.ky || store.latestKy();
  const targets = store.getTargets({ ky, scope });
  const items = targets.map((t) => {
    const rev = A.sum(store.getRows({ ky, scope: { empCode: t.emp_code } }), (r) => r.revenue);
    const beforeVat = rev / A.VAT_DIVISOR;
    return {
      emp_code: t.emp_code,
      emp_name: store.findUserByCode(t.emp_code)?.name,
      target: t.target,
      revenue_before_vat: Math.round(beforeVat),
      pct: t.target > 0 ? +(beforeVat / t.target * 100).toFixed(1) : null,
      gap: Math.round(beforeVat - t.target),
    };
  }).sort((a, b) => (b.pct || 0) - (a.pct || 0));
  res.json({ ky, items });
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
    const rows = A.revenueBreakdown({ ky, scope, dimension: dim });
    ws.columns = [
      { header: 'Mã', key: 'key', width: 16 },
      { header: 'Tên', key: 'label', width: 40 },
      { header: 'Doanh thu', key: 'revenue', width: 20 },
      { header: 'Số lượng', key: 'quantity', width: 14 },
    ];
    rows.forEach((r) => ws.addRow(r));
  } else if (kind === 'cst') {
    const rows = A.cstTable({ scope });
    ws.columns = [
      { header: 'Đơn vị', key: 'unit_name', width: 30 },
      { header: 'Sản phẩm', key: 'product_name', width: 26 },
      { header: 'Gói thầu', key: 'bid_package', width: 12 },
      { header: 'Cơ số ban đầu', key: 'bid_qty_initial', width: 16 },
      { header: 'Đã bán', key: 'sold_qty', width: 12 },
      { header: 'Còn lại', key: 'remain_qty', width: 12 },
      { header: '% còn lại', key: 'remain_pct', width: 12 },
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
