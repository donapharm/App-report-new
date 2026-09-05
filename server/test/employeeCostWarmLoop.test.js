const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-warmloop-auth-'));
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-warmloop-no-lkg.json');
delete process.env.EMPLOYEE_COST_ALL_WARM_DISABLED;

const store = require('../src/store');
const employeeCost = require('../src/employeeCost');
const catalogManagement = require('../src/catalogManagement');
const router = require('../src/routes');

const flush = () => new Promise((r) => setImmediate(r));

test('employee-cost ALL warm loop defers heavy startup work, is idempotent, and honors disable flag', async () => {
  const originalSignature = store.activeDataSignature;
  const originalEmployeeCostSignature = store.employeeCostDataSignature;
  const originalLatestKy = store.latestKy;
  const originalCurrentKyByDate = store.currentKyByDate;
  const originalPeriodKys = store.periodKys;
  const originalTargetRoster = store.targetRoster;
  const originalGetForSession = employeeCost.getForSession;
  const originalSnapshot = catalogManagement.getSnapshot;

  let builds = 0;
  let warmedFrom = null;
  const warmedMonths = [];
  store.activeDataSignature = () => 'warmloop-sig';
  store.employeeCostDataSignature = () => 'warmloop-sig';
  store.latestKy = () => '03.2026';
  store.currentKyByDate = () => '03.2026';
  store.periodKys = () => ['01.2026', '02.2026', '03.2026'];
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    builds += 1;
    warmedFrom = options.from;
    if (!warmedMonths.includes(options.from)) warmedMonths.push(options.from);
    return employeeCost.emptyRangePayload(requestedEmp, employeeCost.parseMonthRange({ from: options.from, to: options.to }));
  };
  try {
    assert.equal(typeof router.startEmployeeCostAllWarmLoop, 'function', 'warm loop starter must be exported');

    // Bật vòng warm không được bắn việc nặng ngay trong callback listen/startup.
    // Watchdog PROD có timeout 4 giây; sweep ngay lúc traffic quay lại từng tạo
    // restart thứ hai dù health ban đầu đã xanh.
    const timer = router.startEmployeeCostAllWarmLoop();
    assert.ok(timer, 'starting must return a live timer when not disabled');
    await flush();
    await flush();
    assert.equal(builds, 0, 'startup must yield health/traffic instead of warming immediately');
    assert.deepEqual(warmedMonths, []);
    assert.equal(warmedFrom, null);

    // Idempotent: gọi lại trả cùng timer, không tạo vòng thứ hai.
    const again = router.startEmployeeCostAllWarmLoop();
    assert.equal(again, timer, 'starting twice must not create a second loop');

    // Tắt rồi bật với cờ disable -> không chạy (null).
    router.stopEmployeeCostAllWarmLoop();
    process.env.EMPLOYEE_COST_ALL_WARM_DISABLED = '1';
    const disabled = router.startEmployeeCostAllWarmLoop();
    assert.equal(disabled, null, 'disable flag must prevent the warm loop');
  } finally {
    delete process.env.EMPLOYEE_COST_ALL_WARM_DISABLED;
    router.stopEmployeeCostAllWarmLoop();
    store.activeDataSignature = originalSignature;
    store.employeeCostDataSignature = originalEmployeeCostSignature;
    store.latestKy = originalLatestKy;
    store.currentKyByDate = originalCurrentKyByDate;
    store.periodKys = originalPeriodKys;
    store.targetRoster = originalTargetRoster;
    employeeCost.getForSession = originalGetForSession;
    catalogManagement.getSnapshot = originalSnapshot;
  }
});


test('employeeCostWarmKyList: kỳ hiện tại + kỳ liền trước CÓ THẬT, không lấy kỳ rỗng', () => {
  const originalLatestKy = store.latestKy;
  const originalCurrentKyByDate = store.currentKyByDate;
  const originalPeriodKys = store.periodKys;
  try {
    assert.equal(typeof router.employeeCostWarmKyList, 'function');

    store.latestKy = () => '08.2026';
    store.currentKyByDate = () => '08.2026';
    store.periodKys = () => ['06.2026', '07.2026', '08.2026'];
    assert.deepEqual(router.employeeCostWarmKyList(), ['08.2026', '07.2026'],
      'mặc định: kỳ hiện tại + 1 kỳ liền trước');

    // Sang tháng mới mà kỳ đó chưa có dữ liệu: vẫn giữ kỳ hiện tại (hành vi cũ)
    // và lấy thêm kỳ CÓ THẬT gần nhất, không đi hâm một kỳ không tồn tại.
    store.latestKy = () => '08.2026';
    store.currentKyByDate = () => '09.2026';
    store.periodKys = () => ['07.2026', '08.2026'];
    assert.deepEqual(router.employeeCostWarmKyList(), ['09.2026', '08.2026']);

    // Chỉ có đúng một kỳ: không bịa ra kỳ trước.
    store.currentKyByDate = () => '08.2026';
    store.periodKys = () => ['08.2026'];
    assert.deepEqual(router.employeeCostWarmKyList(), ['08.2026']);

    // Bắc cầu sang năm: 01.2026 -> 12.2025.
    store.currentKyByDate = () => '01.2026';
    store.periodKys = () => ['11.2025', '12.2025', '01.2026'];
    assert.deepEqual(router.employeeCostWarmKyList(), ['01.2026', '12.2025']);
  } finally {
    store.latestKy = originalLatestKy;
    store.currentKyByDate = originalCurrentKyByDate;
    store.periodKys = originalPeriodKys;
  }
});

test('vòng warm phải hâm TUẦN TỰ — chốt toàn cục bỏ lần gọi chồng, bắn song song là mất kỳ', () => {
  const source = fs.readFileSync(require.resolve('../src/routes.js'), 'utf8');
  const sweep = source.slice(source.indexOf('function scheduleEmployeeCostAllWarmSweep'));
  assert.match(sweep.slice(0, 800), /for \(const ky of employeeCostWarmKyList\(\)\)[\s\S]*?await warmEmployeeCostAllCache\(ky, reason\)/,
    'phải await từng kỳ trong vòng lặp, không Promise.all/không bắn nhiều setImmediate');
  const loop = source.slice(source.indexOf('function startEmployeeCostAllWarmLoop'));
  assert.doesNotMatch(loop.slice(0, 700), /scheduleEmployeeCostAllWarm\(currentWarmKy\(\)/,
    'vòng định kỳ không được quay lại kiểu hâm một kỳ');
});

test('startup loop must not schedule an immediate heavy sweep before watchdog health stabilizes', () => {
  const source = fs.readFileSync(require.resolve('../src/routes.js'), 'utf8');
  const start = source.indexOf('function startEmployeeCostAllWarmLoop');
  const stop = source.indexOf('function stopEmployeeCostAllWarmLoop', start);
  const loop = source.slice(start, stop);
  assert.doesNotMatch(loop, /scheduleEmployeeCostAllWarmSweep\('startup'\)/,
    'startup callback must not race the one-minute watchdog');
  assert.match(loop, /setInterval\([\s\S]*scheduleEmployeeCostAllWarmSweep\('interval'\)/,
    'periodic warm must remain armed after startup stabilization');
  assert.match(loop, /startupDeferred:\s*true/,
    'runtime log must state why startup did not warm immediately');
});

test('first completed health starts one current-period warm and concurrent cold users share it', async () => {
  const originalCurrentKyByDate = store.currentKyByDate;
  try {
    router.stopEmployeeCostAllWarmLoop();
    store.currentKyByDate = () => '09.2026';
    router.startEmployeeCostAllWarmLoop();
    assert.equal(router.employeeCostStartupWarmState(), 'pending');
    let calls = 0;
    let release;
    const warm = () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    };
    const first = router.ensureEmployeeCostStartupWarm(warm);
    const second = router.ensureEmployeeCostStartupWarm(warm);
    const user = router.waitForEmployeeCostStartupWarm({ query: { from: '2026-09', to: '2026-09' } });
    await flush();
    assert.equal(calls, 1, 'cold users must share one startup warm');
    assert.equal(router.employeeCostStartupWarmState(), 'warming');
    release(true);
    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.equal(await user, true, 'active-period ALL waits for the shared warm instead of cold fan-out');
    assert.equal(router.employeeCostStartupWarmState(), 'ready');
  } finally {
    router.stopEmployeeCostAllWarmLoop();
    store.currentKyByDate = originalCurrentKyByDate;
  }
});

test('health route acknowledges before scheduling startup warm', () => {
  const source = fs.readFileSync(require.resolve('../src/index.js'), 'utf8');
  const health = source.slice(source.indexOf("app.get('/api/health'"), source.indexOf("app.use('/api'"));
  assert.match(health, /res\.once\('finish',[\s\S]*noteEmployeeCostHealthReady/,
    'warm may start only after the cheap health response has finished');
  assert.match(health, /res\.json\(\{ ok: true/);
});

test('failed startup warm returns explicit unavailable and remains retryable, never cold-fanout success', async () => {
  const originalCurrentKyByDate = store.currentKyByDate;
  try {
    router.stopEmployeeCostAllWarmLoop();
    store.currentKyByDate = () => '09.2026';
    router.startEmployeeCostAllWarmLoop();
    assert.equal(await router.ensureEmployeeCostStartupWarm(async () => false), false);
    assert.equal(router.employeeCostStartupWarmState(), 'pending');
    await assert.rejects(
      router.waitForEmployeeCostStartupWarm({ query: { from: '2026-09', to: '2026-09' } }, async () => false),
      (error) => error.status === 503 && error.code === 'EMPLOYEE_COST_STARTUP_WARM_UNAVAILABLE',
    );
  } finally {
    router.stopEmployeeCostAllWarmLoop();
    store.currentKyByDate = originalCurrentKyByDate;
  }
});


test('EMPLOYEE_COST_ALL_WARM_PREV_PERIODS rỗng KHÔNG được tự tắt warm kỳ trước', () => {
  // Sự cố 19/08/2026: biến đặt rỗng làm Number('')===0 ⇒ warm lặng lẽ chỉ còn một kỳ,
  // log chỉ in periods:['08.2026'] nên mất cả buổi mới tìm ra. Khoá lại luật đọc biến.
  const source = fs.readFileSync(require.resolve('../src/routes.js'), 'utf8');
  const start = source.indexOf('function resolveWarmPrevPeriods');
  assert.ok(start > 0, 'phải có hàm đọc biến tường minh, không nhét vào một biểu thức');
  const fn = source.slice(start, source.indexOf('\n}', start));
  assert.match(fn, /trim\(\)/, 'phải trim trước khi xét rỗng');
  assert.match(fn, /=== ''/, 'rỗng phải rơi về mặc định, không rơi về 0');
  assert.doesNotMatch(fn, /\|\|\s*0/, 'cấm dùng `|| 0`: nó biến mọi giá trị lạ thành TẮT');

  const resolve = (raw) => {
    const text = String(raw ?? '').trim();
    if (text === '') return { value: 1, source: 'default' };
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return { value: 1, source: 'default_invalid' };
    return { value: Math.max(0, Math.min(3, Math.trunc(parsed))), source: 'env' };
  };
  assert.deepEqual(resolve(undefined), { value: 1, source: 'default' }, 'chưa đặt ⇒ 1');
  assert.deepEqual(resolve(''), { value: 1, source: 'default' }, 'rỗng ⇒ 1, KHÔNG phải 0');
  assert.deepEqual(resolve('   '), { value: 1, source: 'default' }, 'toàn khoảng trắng ⇒ 1');
  assert.deepEqual(resolve('abc'), { value: 1, source: 'default_invalid' }, 'rác ⇒ 1');
  assert.deepEqual(resolve('0'), { value: 0, source: 'env' }, 'chỉ số 0 VIẾT RÕ mới tắt được');
  assert.deepEqual(resolve('2'), { value: 2, source: 'env' });
  assert.deepEqual(resolve('99'), { value: 3, source: 'env' }, 'chặn trần 3');
});

test('log khởi động warm phải nói ĐỦ LÝ DO, không chỉ kết quả', () => {
  const source = fs.readFileSync(require.resolve('../src/routes.js'), 'utf8');
  const at = source.indexOf("ALL cache warm loop started");
  assert.ok(at > 0);
  const block = source.slice(at, at + 500);
  for (const field of ['periods', 'prevPeriods', 'prevPeriodsSource', 'knownPeriods']) {
    assert.match(block, new RegExp(field), `log phải in ${field} để chẩn được ngay tại chỗ`);
  }
});


test('kho rỗng lúc khởi động KHÔNG được làm mất kỳ liền trước', () => {
  // Sự cố 19/08/2026 (lần 2): vòng warm chạy ngay khi tiến trình lên, store nạp lười nên
  // periodKys() trả [] ⇒ danh sách warm chỉ còn kỳ hiện tại (suy từ đồng hồ) và T07 không
  // bao giờ được hâm. Nay phải suy kỳ trước bằng số học thay vì bỏ trống.
  const originalLatestKy = store.latestKy;
  const originalCurrentKyByDate = store.currentKyByDate;
  const originalPeriodKys = store.periodKys;
  try {
    store.latestKy = () => '08.2026';
    store.currentKyByDate = () => '08.2026';

    store.periodKys = () => [];
    assert.deepEqual(router.employeeCostWarmKyList(), ['08.2026', '07.2026'],
      'kho RỖNG ⇒ vẫn phải suy ra kỳ liền trước');

    store.periodKys = () => { throw new Error('store chưa nạp'); };
    assert.deepEqual(router.employeeCostWarmKyList(), ['08.2026', '07.2026'],
      'đọc kho LỖI ⇒ vẫn phải suy ra kỳ liền trước, không nuốt im lặng rồi bỏ trống');

    // Bắc cầu sang năm khi phải suy bằng số học.
    store.currentKyByDate = () => '01.2026';
    store.periodKys = () => [];
    assert.deepEqual(router.employeeCostWarmKyList(), ['01.2026', '12.2025']);

    // Kho CÓ dữ liệu thì ưu tiên kho, kể cả khi có tháng khuyết (07 không tồn tại).
    store.currentKyByDate = () => '08.2026';
    store.periodKys = () => ['05.2026', '06.2026', '08.2026'];
    assert.deepEqual(router.employeeCostWarmKyList(), ['08.2026', '06.2026'],
      'có kho thì theo kho, không nhảy vào tháng khuyết');
  } finally {
    store.latestKy = originalLatestKy;
    store.currentKyByDate = originalCurrentKyByDate;
    store.periodKys = originalPeriodKys;
  }
});

test('log khởi động phải phân biệt kho RỖNG với đọc kho LỖI', () => {
  const source = fs.readFileSync(require.resolve('../src/routes.js'), 'utf8');
  const at = source.indexOf('ALL cache warm loop started');
  const block = source.slice(at, at + 600);
  assert.match(block, /knownPeriodsError/,
    'phải in knownPeriodsError, nếu không thì kho rỗng và kho lỗi trông giống hệt nhau');
  const helper = source.slice(source.indexOf('function employeeCostKnownPeriods'));
  assert.match(helper.slice(0, 400), /catch \(error\)/,
    'cấm nuốt lỗi bằng catch trống — lần trước mất cả buổi vì đúng chỗ này');
});
