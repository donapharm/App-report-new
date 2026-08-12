const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assignmentAdmin = require('./assignmentAdmin');
const store = require('./store');
const { provinceOf } = require('./province');

const CACHE_FILE = process.env.CATALOG_MANAGEMENT_CACHE_FILE || path.join(__dirname, '..', 'data', 'catalog_management_lkg.json');
const DQ_CACHE_FILE = process.env.EMPLOYEE_COST_DQ_CATALOG_CACHE_FILE
  || (process.env.CATALOG_MANAGEMENT_CACHE_FILE ? `${CACHE_FILE}.dq.json` : path.join(__dirname, '..', 'data', 'employee_cost_dq_catalog_lkg.json'));
const CACHE_INDEX_FILE = process.env.CATALOG_MANAGEMENT_CACHE_INDEX_FILE || `${CACHE_FILE}.index.json`;
const CACHE_SCHEMA_VERSION = 2;
const DQ_CACHE_SCHEMA_VERSION = 2;
const DEFAULT_TIMEOUT_MS = 6500;
const TYPE_LABELS = { unit_qlnb: 'Đơn vị + Mã QLNB', unit: 'Đơn vị', group: 'Nhóm ưu tiên', route: 'Tuyến', iit: 'Mã QLNB', special: 'Hàng cần đẩy', all: 'Toàn bộ' };
const EMPLOYEE_FORBIDDEN_KEYS = /(^|_)(?:(?:old|new|from|to)[_-]?emp|counterpart|actor|batch|transfer_batch_id|note|audit|history|by|internal)(_|$)/i;
const EMPLOYEE_FORBIDDEN_PHRASES = /bàn giao cho|nhận từ/i;
const PERMANENTLY_BLOCKED_CATALOG_FIELDS = Object.freeze(['c32', 'c47']);
const PERMANENTLY_BLOCKED_CATALOG_SET = new Set(PERMANENTLY_BLOCKED_CATALOG_FIELDS);
// C10 is the CEO-vault/DataHub SSOT for Thưởng v2 priority groups. It is
// optional until DataHub exposes it; C32/C47 remain permanently blocked.
const APPROVED_OPTIONAL_CATALOG_FIELDS = Object.freeze(['c10']);
const APPROVED_OPTIONAL_CATALOG_SET = new Set(APPROVED_OPTIONAL_CATALOG_FIELDS);

function normalizedFieldName(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}
function isPermanentlyBlockedCatalogField(value) {
  return PERMANENTLY_BLOCKED_CATALOG_SET.has(normalizedFieldName(value));
}
function isCatalogCostField(value) {
  return /^c(?:3[2-9]|4[0-7])$/.test(normalizedFieldName(value));
}
function assertNoPermanentCatalogFields(value, pathName = 'catalogPayload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPermanentCatalogFields(item, `${pathName}[${index}]`));
    return true;
  }
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    if (isPermanentlyBlockedCatalogField(key)) {
      throw Object.assign(new Error(`Permanent catalog field blocked at ${pathName}.${key}`), {
        status: 502,
        code: 'CATALOG_PERMANENT_FIELD_BLOCKED',
      });
    }
    assertNoPermanentCatalogFields(child, `${pathName}.${key}`);
  }
  return true;
}
function assertCatalogFieldPolicy(value, pathName = 'catalogPayload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCatalogFieldPolicy(item, `${pathName}[${index}]`));
    return true;
  }
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    const field = normalizedFieldName(key);
    if (isPermanentlyBlockedCatalogField(field)) {
      throw Object.assign(new Error(`Permanent catalog field blocked at ${pathName}.${key}`), {
        status: 502,
        code: 'CATALOG_PERMANENT_FIELD_BLOCKED',
      });
    }
    if (isCatalogCostField(field) && !APPROVED_OPTIONAL_CATALOG_SET.has(field)) {
      throw Object.assign(new Error(`Catalog field is not approved at ${pathName}.${key}`), {
        status: 502,
        code: 'CATALOG_FIELD_NOT_APPROVED',
      });
    }
    assertCatalogFieldPolicy(child, `${pathName}.${key}`);
  }
  return true;
}

function configured() {
  return Boolean(String(process.env.DATA_HUB_BASE_URL || '').trim() && String(process.env.DATA_HUB_ASSIGNMENT_KEY || '').trim());
}
function toHubPeriod(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}/.test(v)) return v.slice(0, 7);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  const m = v.match(/^(0[1-9]|1[0-2])\.(\d{4})$/);
  if (!m) throw Object.assign(new Error('Kỳ phải có dạng MM.YYYY hoặc YYYY-MM'), { status: 400 });
  return `${m[2]}-${m[1]}`;
}
function toUiPeriod(value) {
  const v = String(value || '').trim();
  const m = v.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? `${m[2]}.${m[1]}` : v;
}
function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function stableHash(value) {
  const hash = crypto.createHash('sha256');
  const visit = (item) => {
    if (item === null) { hash.update('null;'); return; }
    if (Array.isArray(item)) {
      hash.update(`array:${item.length}[`);
      for (const child of item) visit(child);
      hash.update(']');
      return;
    }
    if (typeof item === 'object') {
      const keys = Object.keys(item).sort();
      hash.update(`object:${keys.length}{`);
      for (const key of keys) {
        hash.update(`${JSON.stringify(key)}:`);
        visit(item[key]);
      }
      hash.update('}');
      return;
    }
    hash.update(`${typeof item}:${JSON.stringify(item)};`);
  };
  visit(value);
  return hash.digest('hex');
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
  // Ghi xong PHẢI quên bản nhớ, nếu không lượt đọc sau ăn phải bản cũ trong RAM.
  if (path.resolve(file) === path.resolve(CACHE_FILE)) quenLkg();
}
function cacheFileUsable(file) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size > 2; }
  catch { return false; }
}
function cacheFileIdentity(file) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    if (!stat.isFile() || stat.size <= 2n) return null;
    return { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs) };
  } catch { return null; }
}
function sameCacheFile(file, expected) {
  const actual = cacheFileIdentity(file);
  return Boolean(actual && expected
    && actual.dev === expected.dev && actual.ino === expected.ino
    && actual.size === expected.size && actual.mtimeNs === expected.mtimeNs);
}
function readCacheIndex() {
  try {
    const value = JSON.parse(fs.readFileSync(CACHE_INDEX_FILE, 'utf8'));
    return value && value.schemaVersion === CACHE_SCHEMA_VERSION && value.periods && typeof value.periods === 'object'
      ? value : { schemaVersion: CACHE_SCHEMA_VERSION, periods: {} };
  } catch { return { schemaVersion: CACHE_SCHEMA_VERSION, periods: {} }; }
}
function snapshotFingerprint(snapshot) {
  // Include actual durable content as well as Data Hub's version/checksum.
  // This catches an upstream payload change even if its metadata was not
  // bumped, while deliberately excluding volatile refresh metadata.
  return stableHash({
    schemaVersion: CACHE_SCHEMA_VERSION,
    period: snapshot?.period,
    version: String(snapshot?.meta?.version || ''),
    checksum: String(snapshot?.meta?.checksum || ''),
    rows: snapshot?.rows || [],
    catalog: snapshot?.catalog || [],
    history: snapshot?.history || [],
  });
}
function dqSnapshotFingerprint(snapshot) {
  // Hash only projection fields row-by-row. Building the complete DQ object
  // merely to decide that nothing changed used to temporarily duplicate the
  // ~100 MiB projection on every successful refresh.
  const hash = crypto.createHash('sha256');
  hash.update(`dq:${DQ_CACHE_SCHEMA_VERSION}:${toHubPeriod(snapshot?.period)}:`);
  hash.update(`${String(snapshot?.meta?.version || '')}:${String(snapshot?.meta?.checksum || '')};`);
  const catalog = snapshot?.catalog || [];
  hash.update(`catalog:${catalog.length};`);
  for (const row of catalog) hash.update(stableHash({
    c4: row.c4, c5: row.c5, c7: row.c7, c10: row.c10,
    c15: row.c15, c16: row.c16, c17: row.c17, c25: row.c25, c31: row.c31,
  }));
  const rows = snapshot?.rows || [];
  hash.update(`rows:${rows.length};`);
  for (const row of rows) hash.update(stableHash({
    type: row.type, unit_code: row.unit_code, unit_name: row.unit_name,
    qlnb_code: row.qlnb_code, label: row.label,
  }));
  return hash.digest('hex');
}
/* ‼ 26 GIÂY MÀN HÌNH QUAY NẰM Ở ĐÂY (bot audit đợt 17 vòng 7 — đo tận nơi).
 *
 * CEO chụp màn 21:59 ngày 11/08: bấm F5 quay mãi không ra. Bot bổ nhỏ 30 giây đó:
 *   · đọc file LKG      **14.100 ms**
 *   · JSON.parse        **9.443 ms**
 *   · kiểm hợp lệ        **2.455 ms**
 *   · gọi mạng               **0 ms**
 * File LKG là **377.416.106 byte (377 MB)**, và `readCache()` cũ **đọc + phân tích lại
 * TOÀN BỘ file cho MỖI lượt gọi**. Nó được gọi ở năm chỗ, nhân ba kỳ ⇒ cùng một file
 * 377 MB bị nhai đi nhai lại. Không có lượt gọi mạng nào — chậm hoàn toàn do tự làm.
 *
 * Đây mới là **gốc bệnh của cả đợt này**. Toàn bộ cơ chế đóng dấu — và bảy vòng lỗi
 * quanh nó — sinh ra chỉ vì dựng lại quá chậm. Chữa chỗ này thì con dấu bớt phải gánh.
 *
 * Cách chữa: nhớ bản ĐÃ PHÂN TÍCH trong RAM, khoá theo **căn cước file** (inode, cỡ,
 * mtime, ctime) — file đổi thì căn cước đổi và bản nhớ tự hết hiệu lực. Kèm hạn giờ để
 * không ghim 377 MB trong RAM mãi.
 *
 * ‼ KHÔNG khoá theo đường dẫn suông: file bị ghi đè tại chỗ thì đường dẫn y nguyên mà
 * nội dung đã khác — đúng lỗi đã mất một vòng để gỡ bên `persist`. */
/* ‼ VÒNG 8 — BỐN CA KIỂM CỦA TÔI XANH GIẢ, VÀ BẢN NHỚ CÒN BỐN LỖ (bot audit, đúng cả).
 *
 * Nặng nhất: bốn ca kiểm memo tôi viết vòng trước dùng **fixture không hợp lệ**, nên
 * `readCache` ném lỗi và trả `null` — mà ca kiểm chỉ ĐẾM LƯỢT ĐỌC ĐĨA, nên vẫn xanh.
 * Chúng chứng minh đúng một điều: "không đọc đĩa hai lần khi không có gì để đọc".
 * Lần thứ SÁU trong đợt dính "xanh vì lý do sai". Ca kiểm nay đòi snapshot KHÁC null.
 *
 * Bốn lỗ của bản nhớ:
 *   ① Bản trả ra dùng CHUNG tham chiếu `rows`/`catalog`/`history` — người gọi sửa một
 *      phần tử là làm bẩn luôn bản trong RAM, và mọi lượt đọc sau ăn phải bản bẩn.
 *   ② Căn cước thiếu `dev`, dùng mili giây thay vì nano giây ⇒ hai file khác thiết bị
 *      có thể trùng khoá, và file sửa trong cùng một mili giây thì khoá KHÔNG đổi.
 *   ③ Chỉ `stat` TRƯỚC khi đọc. File đổi ngay trong lúc đọc thì ta gắn nội dung mới vào
 *      căn cước cũ — đúng lỗi TOCTOU đã gặp bên `persist`.
 *   ④ Ghim cả bản 377 MB đã phân tích ⇒ bot đo **RSS 1,37 GiB mỗi tiến trình**. Quá đắt.
 *      Nay giữ bản phân tích rất ngắn (đủ gộp một chùm request), còn snapshot từng kỳ
 *      thì giữ lâu hơn — chúng nhỏ hơn cả file gốc rất nhiều.
 */
const HAN_BAN_PHAN_TICH_MS = 10_000;  // đủ gộp một chùm request, không ghim 377 MB lâu
const HAN_SNAPSHOT_MS = 60_000;
let nhoLkg = null;             // { print, value, hetHanLuc } — bản phân tích, sống ngắn
const nhoSnapshot = new Map(); // `${print}|${period}` -> snapshot đã kiểm, đã đóng băng

/* Căn cước file: thêm `dev` (khác thiết bị thì inode trùng nhau là chuyện thường) và
 * dùng nano giây dạng bigint — mili giây không phân biệt được hai lần ghi sát nhau. */
function canCuocFile(duongDan) {
  try {
    const st = fs.statSync(duongDan, { bigint: true });
    return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  } catch { return null; }
}

/* ‼ HẠN GIỜ THỤ ĐỘNG KHÔNG THẢ RAM (bot audit vòng 10 — đo tận nơi, đúng).
 *
 * Bản trước tôi chỉ kiểm `hetHanLuc` **lúc có người gọi**. Không ai gọi thì `nhoLkg.value`
 * vẫn trỏ vào bản 377 MB đã phân tích, nên GC **không được phép** thu. Bot đo: sau 30
 * giây rảnh, **3/6 tiến trình vẫn giữ 1,36 GiB**; phải tới 60–75 giây mới về 659 MiB.
 * Tức "hạn 10 giây" của tôi chỉ là hạn **dùng lại**, không phải hạn **giữ**.
 *
 * Nay thả CHỦ ĐỘNG bằng hẹn giờ: tới hạn là bỏ tham chiếu, không chờ ai gọi. `unref()`
 * để cái hẹn giờ này không giữ tiến trình sống thêm. */
let henGioThaLkg = null;
function henGioTha(sauBaoLau) {
  if (henGioThaLkg) clearTimeout(henGioThaLkg);
  henGioThaLkg = setTimeout(() => { nhoLkg = null; henGioThaLkg = null; }, sauBaoLau);
  if (typeof henGioThaLkg.unref === 'function') henGioThaLkg.unref();
}

/** Xoá bản nhớ — GỌI SAU MỌI LƯỢT GHI LKG, nếu không lượt đọc sau ăn phải bản cũ. */
function quenLkg() {
  nhoLkg = null;
  nhoSnapshot.clear();
  if (henGioThaLkg) { clearTimeout(henGioThaLkg); henGioThaLkg = null; }
}

/* Đóng băng SÂU: bản trong RAM được nhiều lượt đọc dùng chung, nên phải cấm sửa. Không
 * đóng băng thì một người gọi lỡ tay `push`/`sort` là mọi lượt sau đọc phải bản bẩn —
 * và bẩn kiểu đó không có gì kêu lên. */
function dongBangSau(nut) {
  if (!nut || typeof nut !== 'object' || Object.isFrozen(nut)) return nut;
  Object.freeze(nut);
  for (const con of Object.values(nut)) dongBangSau(con);
  return nut;
}

/* Đọc kèm HẬU KIỂM: `stat` trước, đọc, rồi `stat` lại. Lệch nghĩa là file đổi ngay
 * trong lúc đọc ⇒ nội dung ta cầm không thuộc căn cước nào cả ⇒ đọc lại. */
function docLkg() {
  const now = Date.now();
  const printTruoc = canCuocFile(CACHE_FILE);
  if (!printTruoc) return { print: null, value: null };
  if (nhoLkg && nhoLkg.print === printTruoc && nhoLkg.hetHanLuc > now) return nhoLkg;

  for (let lan = 0; lan < 3; lan += 1) {
    const truoc = canCuocFile(CACHE_FILE);
    if (!truoc) return { print: null, value: null };
    const tho = fs.readFileSync(CACHE_FILE, 'utf8');
    const sau = canCuocFile(CACHE_FILE);
    if (truoc !== sau) continue; // file đổi giữa chừng — bản vừa đọc là hàng trộn đời
    const value = JSON.parse(tho);
    if (!nhoLkg || nhoLkg.print !== truoc) nhoSnapshot.clear();
    nhoLkg = { print: truoc, value, hetHanLuc: Date.now() + HAN_BAN_PHAN_TICH_MS };
    henGioTha(HAN_BAN_PHAN_TICH_MS); // thả chủ động, không chờ lượt gọi kế tiếp
    return nhoLkg;
  }
  return { print: null, value: null }; // đổi liên tục ⇒ không kết luận, để người gọi dựng lại
}

function readCache(period) {
  try {
    /* Snapshot từng kỳ giữ LÂU hơn bản phân tích: chúng nhỏ, và giữ chúng mới là thứ
     * cứu được 26 giây. Khoá có căn cước file nên file đổi là tự trượt. */
    const printHienTai = canCuocFile(CACHE_FILE);
    if (printHienTai) {
      const khoaSom = `${printHienTai}|${period || ''}`;
      const hit = nhoSnapshot.get(khoaSom);
      if (hit && hit.hetHanLuc > Date.now()) return hit.value;
    }
    const { print, value } = docLkg();
    if (!value) return null;
    const khoaSnapshot = `${print}|${period || ''}`;
    const snapshot = value?.snapshots && period
      ? value.snapshots[period] || null
      : value && Array.isArray(value.rows) && (!period || value.period === period) ? value : null;
    if (snapshot) {
      // Validate only the requested snapshot. Scanning every retained month makes a
      // cold DQ request synchronously walk hundreds of MB and blocks even /health.
      assertCatalogFieldPolicy(snapshot, `catalogLkg.${period || snapshot.period || 'legacy'}`);
      assertCatalogSnapshotContract(snapshot, `catalogLkg.${period || snapshot.period || 'legacy'}`);
    }
    // Nhớ cả `null`: "kỳ này không có trong LKG" cũng là kết luận, khỏi phân tích lại.
    const daDongBang = dongBangSau(snapshot);
    nhoSnapshot.set(khoaSnapshot, { value: daDongBang, hetHanLuc: Date.now() + HAN_SNAPSHOT_MS });
    return daDongBang;
  } catch { return null; }
}
function dataQualityProjection(snapshot, periodInput) {
  const period = toHubPeriod(periodInput || snapshot?.period);
  return {
    period,
    catalog: (snapshot?.catalog || []).map((row) => ({
      c4: row.c4, c5: row.c5, c7: row.c7, c10: row.c10,
      c15: row.c15, c16: row.c16, c17: row.c17, c25: row.c25, c31: row.c31,
    })),
    rows: (snapshot?.rows || []).map((row) => ({
      type: row.type, unit_code: row.unit_code, unit_name: row.unit_name,
      qlnb_code: row.qlnb_code, label: row.label,
    })),
    meta: snapshot?.meta || {},
  };
}
function readDataQualityCache(period) {
  try {
    const value = JSON.parse(fs.readFileSync(DQ_CACHE_FILE, 'utf8'));
    const snapshot = value?.snapshots?.[period] || null;
    if (snapshot) {
      assertCatalogFieldPolicy(snapshot, `employeeCostDqCatalogLkg.${period}`);
      assertCatalogSnapshotContract(snapshot, `employeeCostDqCatalogLkg.${period}`);
    }
    return snapshot;
  } catch { return null; }
}
function writeDataQualityCacheAtomic(snapshot, { index = readCacheIndex() } = {}) {
  const fingerprint = dqSnapshotFingerprint(snapshot);
  const period = toHubPeriod(snapshot?.period);
  let current = null;
  const indexedDqFileMatches = sameCacheFile(DQ_CACHE_FILE, index.dqFile);
  let sameProjection = indexedDqFileMatches
    && index.periods?.[period]?.dqFingerprint === fingerprint;
  // Only seed a legacy/missing sidecar by parsing the monolith. Once an exact
  // file identity has been indexed, a mismatch means replacement/corruption and
  // must force an atomic repair rather than silently blessing the new file.
  if (!sameProjection && !index.dqFile && cacheFileUsable(DQ_CACHE_FILE)) {
    try {
      current = JSON.parse(fs.readFileSync(DQ_CACHE_FILE, 'utf8')) || {};
      const persisted = current?.snapshots?.[period] || null;
      sameProjection = Boolean(persisted && dqSnapshotFingerprint(persisted) === fingerprint);
    } catch { current = {}; }
  }
  if (sameProjection) {
    return { projected: null, written: false, fingerprint };
  }
  const projected = dataQualityProjection(snapshot, period);
  assertCatalogFieldPolicy(projected, `employeeCostDqCatalogLkg.${projected.period}`);
  assertCatalogSnapshotContract(projected, `employeeCostDqCatalogLkg.${projected.period}`);
  fs.mkdirSync(path.dirname(DQ_CACHE_FILE), { recursive: true });
  if (!current) {
    try { current = JSON.parse(fs.readFileSync(DQ_CACHE_FILE, 'utf8')) || {}; } catch { current = {}; }
  }
  const snapshots = current.snapshots && typeof current.snapshots === 'object' ? current.snapshots : {};
  snapshots[projected.period] = projected;
  const periods = Object.keys(snapshots).sort().slice(-18);
  const value = { source: 'data-hub-dq-lkg', snapshots: Object.fromEntries(periods.map((period) => [period, snapshots[period]])) };
  const tmp = `${DQ_CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, DQ_CACHE_FILE);
  return { projected, written: true, fingerprint };
}
function getCachedDataQualitySnapshot(periodInput) {
  const period = toHubPeriod(periodInput);
  const cachedProjection = readDataQualityCache(period);
  const projected = cachedProjection || (() => {
    const cached = readCache(period);
    return cached ? writeDataQualityCacheAtomic(cached).projected : null;
  })();
  if (!projected) return null;
  return {
    ...projected,
    period,
    readOnly: true,
    meta: {
      ...projected.meta,
      source: 'data-hub-dq-lkg',
      stale: true,
      readOnly: true,
      message: 'Đang dùng snapshot Data Hub đã kiểm định cho kỳ yêu cầu.',
    },
  };
}
function safeRestoredSnapshots(restoredSnapshots = {}) {
  const safe = {};
  for (const [period, restored] of Object.entries(restoredSnapshots || {})) {
    try {
      assertCatalogFieldPolicy(restored, `restoredCatalogLkg.${period}`);
      assertCatalogSnapshotContract(restored, `restoredCatalogLkg.${period}`);
      safe[period] = restored;
    }
    catch { /* permanently omit contaminated snapshots during the next rewrite */ }
  }
  return safe;
}
function writeCacheAtomic(snapshot) {
  assertCatalogFieldPolicy(snapshot, 'catalogSnapshot');
  assertCatalogSnapshotContract(snapshot, 'catalogSnapshot');
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const index = readCacheIndex();
  const indexBefore = JSON.stringify(index);
  const fingerprint = snapshotFingerprint(snapshot);
  let current = null;
  const indexedMainFileMatches = sameCacheFile(CACHE_FILE, index.mainFile);
  let sameMain = indexedMainFileMatches
    && index.periods?.[snapshot.period]?.fingerprint === fingerprint;
  // Sidecars from older releases do not have a content-complete fingerprint.
  // Parse the monolith at most once to seed it without rewriting an unchanged
  // LKG. If an indexed file identity later changes, force an atomic repair.
  if (!sameMain && !index.mainFile && cacheFileUsable(CACHE_FILE)) {
    try {
      current = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {};
      const persisted = current?.snapshots?.[snapshot.period]
        || (current?.period === snapshot.period && Array.isArray(current?.rows) ? current : null);
      sameMain = Boolean(persisted && snapshotFingerprint(persisted) === fingerprint);
    } catch { current = {}; }
  }
  let mainWritten = false;
  if (!sameMain) {
    if (!current) {
      try { current = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch { current = {}; }
    }
    const restoredSnapshots = current.snapshots || (Array.isArray(current.rows) && current.period ? { [current.period]: current } : {});
    // A reset/restore may bring back an old poisoned snapshot. Never carry it
    // into the next LKG: retain only snapshots that pass the current policy.
    const snapshots = safeRestoredSnapshots(restoredSnapshots);
    snapshots[snapshot.period] = snapshot;
    const periods = Object.keys(snapshots).sort().slice(-18);
    const value = {
      source: 'data-hub-lkg', version: snapshot.meta.version, checksum: snapshot.meta.checksum,
      updatedAt: snapshot.meta.updatedAt, snapshots: Object.fromEntries(periods.map((p) => [p, snapshots[p]])),
    };
    assertCatalogFieldPolicy(value, 'catalogLkg');
    const tmp = `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, CACHE_FILE);
    quenLkg(); // xem `atomicJson` — ghi xong là bản nhớ hết hiệu lực
    mainWritten = true;
  }
  // Materializers run out-of-process, so keep a small DQ-only projection ready
  // for the API instead of forcing the web process to parse the full LKG.
  const dq = writeDataQualityCacheAtomic(snapshot, { index });
  index.periods[snapshot.period] = {
    fingerprint,
    dqFingerprint: dq.fingerprint,
    version: String(snapshot.meta?.version || ''),
    checksum: String(snapshot.meta?.checksum || ''),
  };
  index.mainFile = cacheFileIdentity(CACHE_FILE);
  index.dqFile = cacheFileIdentity(DQ_CACHE_FILE);
  // Bound the tiny sidecar to the same retention window as the LKG. It is
  // written only after all required LKG writes succeeded, so a crash can at
  // worst cause one harmless retry, never a false skip.
  const retained = Object.keys(index.periods).sort().slice(-18);
  index.periods = Object.fromEntries(retained.map((period) => [period, index.periods[period]]));
  const indexWritten = indexBefore !== JSON.stringify(index) || !cacheFileUsable(CACHE_INDEX_FILE);
  if (indexWritten) atomicJson(CACHE_INDEX_FILE, index);
  return { written: mainWritten || dq.written, mainWritten, dqWritten: dq.written, indexWritten, fingerprint };
}
function unwrap(value) {
  if (value && typeof value === 'object' && value.data && typeof value.data === 'object') return value.data;
  return value || {};
}
function arrayOf(value, names) {
  for (const name of names) if (Array.isArray(value?.[name])) return value[name];
  return [];
}
function normalizeRow(row = {}) {
  const scope = String(row.scope || '').trim().toLowerCase();
  const type = String(row.type || row.category_type || row.assignment_type || ({ unit_qlnb: 'unit_qlnb', qlnb: 'iit', don_vi: 'unit', route: 'route', all: 'all' }[scope]) || '').trim().toLowerCase();
  const value = String(row.value ?? row.code ?? row.category_key ?? row.assignment_value ?? '').trim();
  const emp = String(row.emp_code || row.employee_code || row.owner_emp_code || '').trim().toUpperCase();
  const unitCode = row.unit_code || null;
  return {
    id: String(row.id || row.assignment_id || `${emp}:${type}:${value}`),
    emp_code: emp,
    emp_name: String(row.emp_name || row.employee_name || store.findUserByCode(emp)?.name || emp),
    type,
    value,
    label: String(row.label || row.category_label || (type === 'unit_qlnb'
      ? `${row.unit_code || value.split('\u001f')[0] || '—'} · ${row.qlnb_code || value.split('\u001f')[1] || '—'}`
      : `${TYPE_LABELS[type] || type}${value && value !== 'all' ? ` · ${value}` : ''}`)),
    unit_code: unitCode,
    qlnb_code: row.qlnb_code || null,
    route: row.route || null,
    province: provinceOf(unitCode, row.unit_name || unitCode, row.province),
    contractor_code: row.contractor_code || row.c4 || null,
    product_name: row.product_name || row.c16 || null,
    active_ingredient: row.active_ingredient || row.c15 || null,
    strength: row.strength || row.ham_luong || row.c17 || null,
    uom: row.uom || row.c25 || null,
    bid_price: row.bid_price ?? row.c31 ?? null,
    effective_from: toHubPeriod(row.effective_from || row.from_period || row.from_ky || '01.1970'),
    effective_to: row.effective_to || row.to_period || row.to_ky ? toHubPeriod(row.effective_to || row.to_period || row.to_ky) : null,
    active: row.active !== false,
    source: String(row.source || 'data-hub'),
    transfer_batch_id: row.transfer_batch_id || row.batch_id || null,
    actor: row.actor || row.by || null,
    internal_note: row.internal_note || row.note || null,
  };
}
function enrichRowsFromCatalog(rows, catalog) {
  assertCatalogFieldPolicy(catalog, 'catalogProjection');
  const byPair = new Map();
  for (const row of catalog || []) {
    const key = `${String(row.c7 || '').trim()}\u001f${String(row.c5 || '').trim()}`;
    if (key !== '\u001f' && !byPair.has(key)) byPair.set(key, row);
  }
  return rows.map((row) => {
    const item = byPair.get(`${String(row.unit_code || '').trim()}\u001f${String(row.qlnb_code || '').trim()}`);
    // c10 = nhóm ưu tiên (SSOT cho Thưởng P2). Đưa xuống UI để CEO nhìn NGAY cạnh mã
    // QLNB, khỏi phải đi tra chỗ khác; thiếu c10 thì để trống (KHÔNG suy đoán, không
    // chặn danh mục) — chính chỗ trống đó là dấu hiệu cần bổ sung.
    return item ? { ...row, contractor_code: item.c4 || null, product_name: item.c16 || null, active_ingredient: item.c15 || null, strength: item.c17 || null, uom: item.c25 || null, bid_price: item.c31 ?? null, c10: item.c10 || null } : row;
  });
}
function assertContractorCoverage(catalog = []) {
  if (!Array.isArray(catalog) || !catalog.length) {
    throw Object.assign(new Error('Data Hub trả catalog rỗng; từ chối ghi đè cache tốt gần nhất.'), {
      status: 502,
      upstream: true,
      code: 'CATALOG_SOURCE_EMPTY',
    });
  }
  const missing = catalog.filter((row) => !String(row?.c4 || '').trim()).length;
  if (missing) {
    throw Object.assign(new Error(`Data Hub thiếu C4/Mã nhà thầu ở ${missing}/${catalog.length} dòng catalog; từ chối ghi đè cache tốt gần nhất.`), {
      status: 502,
      upstream: true,
      code: 'CATALOG_CONTRACTOR_C4_MISSING',
    });
  }
  return true;
}
const CRITICAL_CATALOG_FIELDS = Object.freeze([
  'contractor_code', 'unit_code', 'qlnb_code', 'product_name',
  'active_ingredient', 'strength', 'uom', 'bid_price',
]);
const CRITICAL_CATALOG_SOURCE_FIELDS = Object.freeze(['c4', 'c5', 'c7', 'c15', 'c16', 'c17', 'c25', 'c31']);
function presentValue(value) {
  return value !== null && value !== undefined && !(typeof value === 'string' && !value.trim());
}
function firstPresentValue(row, fields) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row || {}, field) && presentValue(row[field])) return row[field];
  }
  return null;
}
function cstValue(value) {
  if (!presentValue(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw Object.assign(new Error(`Nguồn CST có giá trị số không hợp lệ: ${String(value)}`), {
      status: 502,
      code: 'CATALOG_CST_INVALID_NUMBER',
    });
  }
  return number;
}
function assertCatalogSourceContract(catalog = [], rows = [], pathName = 'dataHubCatalogPayload') {
  assertContractorCoverage(catalog);
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('Data Hub trả danh sách phân công rỗng; từ chối ghi đè cache tốt gần nhất.'), {
      status: 502, upstream: true, code: 'CATALOG_ASSIGNMENTS_EMPTY',
    });
  }
  for (const field of CRITICAL_CATALOG_SOURCE_FIELDS) {
    const missing = catalog.filter((row) => !presentValue(row?.[field])).length;
    if (missing) {
      throw Object.assign(new Error(`Data Hub thiếu ${field} ở ${missing}/${catalog.length} dòng catalog; từ chối ghi đè cache tốt gần nhất.`), {
        status: 502, upstream: true, code: 'CATALOG_CRITICAL_SOURCE_MISSING', details: { field, missing, total: catalog.length, pathName },
      });
    }
  }
  const invalidUnitQlnb = rows.filter((row) => row.type === 'unit_qlnb'
    && (!String(row.unit_code || '').trim() || !String(row.qlnb_code || '').trim()));
  if (invalidUnitQlnb.length) {
    throw Object.assign(new Error(`Data Hub có ${invalidUnitQlnb.length} phân công đơn vị + QLNB thiếu khóa; từ chối ghi đè cache tốt gần nhất.`), {
      status: 502, upstream: true, code: 'CATALOG_ASSIGNMENT_KEY_MISSING', details: { missing: invalidUnitQlnb.length, total: rows.length, pathName },
    });
  }
  const catalogPairs = new Set(catalog.map((row) => `${String(row.c7 || '').trim()}\u001f${String(row.c5 || '').trim()}`));
  const pairRows = rows.filter((row) => String(row.unit_code || '').trim() && String(row.qlnb_code || '').trim());
  const missingPairs = pairRows.filter((row) => !catalogPairs.has(`${String(row.unit_code).trim()}\u001f${String(row.qlnb_code).trim()}`));
  if (missingPairs.length) {
    throw Object.assign(new Error(`Data Hub thiếu catalog cho ${missingPairs.length}/${pairRows.length} cặp đơn vị + QLNB; từ chối ghi đè cache tốt gần nhất.`), {
      status: 502, upstream: true, code: 'CATALOG_PAIR_COVERAGE_MISSING', details: { missing: missingPairs.length, total: pairRows.length, pathName },
    });
  }
  return { catalogRows: catalog.length, assignmentRows: rows.length, pairRows: pairRows.length };
}
function assertCatalogSnapshotContract(snapshot = {}, pathName = 'catalogSnapshot') {
  return assertCatalogSourceContract(snapshot.catalog, snapshot.rows, pathName);
}
function cstRowsByPair(cstRows = []) {
  const byPair = new Map();
  for (const item of cstRows || []) {
    const unit = String(item.unit_code ?? item.unitCode ?? '').trim();
    const qlnb = String(item.iit_code ?? item.productCode ?? '').trim();
    if (!unit || !qlnb) continue;
    const key = `${unit}\u001f${qlnb}`;
    const current = byPair.get(key) || { cst_initial: null, cst_remaining: null, cst_source: null };
    const initial = cstValue(firstPresentValue(item, ['bid_qty_initial', 'slTrungThau']));
    const remaining = cstValue(firstPresentValue(item, ['remain_qty', 'slConLai']));
    // Sparse overlays may enrich another dataset (for example C30) but must
    // never erase a complete CST baseline. Explicit zero remains a valid value.
    if (initial !== null) current.cst_initial = initial;
    if (remaining !== null) current.cst_remaining = remaining;
    if (initial !== null || remaining !== null) current.cst_source = item.cst_source || item.source || current.cst_source;
    if (initial !== null || remaining !== null) byPair.set(key, current);
  }
  return byPair;
}
function enrichRowsWithCst(rows, cstRows) {
  const byPair = cstRowsByPair(cstRows);
  return rows.map((row) => {
    const cst = byPair.get(`${String(row.unit_code || '').trim()}\u001f${String(row.qlnb_code || '').trim()}`);
    return cst ? { ...row, ...cst } : { ...row, cst_initial: null, cst_remaining: null, cst_source: null };
  });
}
function projectionError(message, details = {}) {
  return Object.assign(new Error(message), {
    status: 502,
    code: 'CATALOG_CRITICAL_FIELD_COVERAGE_LOSS',
    details,
  });
}
function assertCriticalProjectionCoverage(beforeRows = [], afterRows = []) {
  if (beforeRows.length !== afterRows.length) {
    throw projectionError(`Projection danh mục đổi số dòng bất thường: ${beforeRows.length} → ${afterRows.length}.`, {
      before: beforeRows.length, after: afterRows.length,
    });
  }
  for (let index = 0; index < beforeRows.length; index += 1) {
    const before = beforeRows[index] || {};
    const after = afterRows[index] || {};
    for (const field of CRITICAL_CATALOG_FIELDS) {
      if (presentValue(before[field]) && before[field] !== after[field]) {
        throw projectionError(`Projection làm thay đổi hoặc mất cột trọng yếu ${field} tại dòng ${index + 1}.`, {
          field, index, id: before.id || null, expected: before[field], actual: after[field] ?? null,
        });
      }
    }
  }
  return true;
}
function assertCstProjectionCoverage(rows = [], cstRows = []) {
  const expectedByPair = cstRowsByPair(cstRows);
  let matched = 0;
  for (const row of rows || []) {
    const key = `${String(row.unit_code || '').trim()}\u001f${String(row.qlnb_code || '').trim()}`;
    const expected = expectedByPair.get(key);
    if (!expected) continue;
    matched += 1;
    for (const field of ['cst_initial', 'cst_remaining']) {
      if (expected[field] !== null && (!presentValue(row[field]) || Number(row[field]) !== expected[field])) {
        throw projectionError(`Projection CST sai ${field} tại ${row.unit_code || '—'} + ${row.qlnb_code || '—'}.`, {
          field, key, expected: expected[field], actual: row[field] ?? null,
        });
      }
    }
  }
  return { sourcePairs: expectedByPair.size, matchedRows: matched };
}
function buildCatalogRows(rows = [], cstRows = []) {
  const enriched = enrichRowsWithCst(rows, cstRows);
  assertCriticalProjectionCoverage(rows, enriched);
  assertCstProjectionCoverage(enriched, cstRows);
  return enriched;
}
function localSnapshot(period, reason = 'Data Hub chưa được cấu hình') {
  const ky = toUiPeriod(period);
  const rows = assignmentAdmin.listAssignments({}).map((row) => normalizeRow({ ...row, source: 'local-fallback' }));
  const catalog = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8')); }
    catch { return {}; }
  })();
  // Audit local chỉ đi qua adminView; employeeView luôn dựng response từ whitelist riêng.
  const history = typeof assignmentAdmin.listAudit === 'function' ? assignmentAdmin.listAudit() : [];
  const body = { rows, catalog, history, period, readOnly: true };
  assertCatalogFieldPolicy(body, 'localCatalogSnapshot');
  return {
    ...body,
    meta: {
      source: 'local-fallback', version: 'local-phase1', checksum: checksum({ rows, catalog }),
      updatedAt: new Date().toISOString(), lastSyncAt: null, stale: true, readOnly: true,
      message: `${reason}. Hiển thị phân công local kỳ ${ky} ở chế độ chỉ đọc; không thay đổi quyền production.`,
    },
  };
}
async function fetchJson(url, options = {}) {
  const timeoutMs = Math.max(1000, Number(process.env.DATA_HUB_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: {
      accept: 'application/json', 'content-type': 'application/json',
      'x-assignment-key': String(process.env.DATA_HUB_ASSIGNMENT_KEY || ''),
      ...(options.headers || {}),
    } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `Data Hub HTTP ${response.status}`), { status: response.status, upstream: true });
    return unwrap(body);
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error(`Data Hub timeout sau ${timeoutMs}ms`), { upstream: true });
    throw error;
  } finally { clearTimeout(timer); }
}
function baseUrl() { return String(process.env.DATA_HUB_BASE_URL || '').trim().replace(/\/$/, ''); }
async function remoteSnapshot(period) {
  const root = `${baseUrl()}/api/integrations/app-report`;
  // Một snapshot kết hợp bảo đảm catalog + timeline cùng version/checksum, tránh ghép hai lần đọc lệch thời điểm.
  const payload = await fetchJson(`${root}/assignments/catalog-management?ky=${encodeURIComponent(period)}`);
  assertCatalogFieldPolicy(payload, 'dataHubCatalogPayload');
  const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
  const assignmentRows = arrayOf(payload, ['rows', 'assignments', 'items']).map(normalizeRow);
  assertCatalogSourceContract(catalog, assignmentRows);
  const rows = enrichRowsFromCatalog(assignmentRows, catalog);
  const history = arrayOf(payload, ['history', 'audit', 'events']);
  const version = String(payload.version || payload.meta?.version || 'unknown');
  /* ‼ HAI HỆ ĐÁNH SỐ KHÁC NHAU — nguồn gốc của hiểu lầm kéo dài (CEO hỏi lại 09/08):
   *   · `version`       = số hiệu CỬA DANH MỤC của DataHub (đang là "3.10");
   *   · `sourceVersion` = số hiệu FILE CP_TOTAL sinh ra dữ liệu (CEO đang chờ "V31.4").
   * DataHub xác nhận 27.719 dòng hiện tại CHÍNH LÀ CP_TOTAL V31.4, nhưng chưa gửi số
   * hiệu đó sang. App Report chép nguyên cái nguồn gửi và KHÔNG BAO GIỜ tự đặt số —
   * bịa một số hiệu lên màn là loại nói dối tệ nhất trong app này. Trường dưới đây
   * chờ sẵn: ngày DataHub gửi là huy hiệu tự hiện đúng, không phải sửa code. */
  const sourceVersion = String(payload.sourceVersion || payload.source_version
    || payload.meta?.sourceVersion || payload.meta?.source_version || '').trim();
  const upstreamChecksum = payload.checksum || payload.meta?.checksum;
  const syncedAt = new Date().toISOString();
  const snapshot = {
    rows, catalog, history, period, readOnly: false,
    meta: { source: 'data-hub', version, sourceVersion, checksum: String(upstreamChecksum || checksum({ rows, catalog })), updatedAt: payload.updatedAt || syncedAt, lastSyncAt: syncedAt, stale: false, readOnly: false, message: 'Đã đồng bộ Data Hub.' },
  };
  writeCacheAtomic(snapshot);
  return snapshot;
}
const SNAPSHOT_CACHE_TTL_MS = Math.max(5 * 1000, Number(process.env.CATALOG_SNAPSHOT_CACHE_TTL_MS || 2 * 60 * 1000) || 2 * 60 * 1000);
const SNAPSHOT_CACHE_MAX = Math.max(1, Math.min(8, Number(process.env.CATALOG_SNAPSHOT_CACHE_MAX || 4) || 4));
const SNAPSHOT_IN_FLIGHT_MAX = Math.max(SNAPSHOT_CACHE_MAX, 8);
const snapshotCache = new Map();
const snapshotInFlight = new Map();
function rememberSnapshot(period, value) {
  snapshotCache.delete(period);
  // Ghi kèm CĂN CƯỚC FILE lúc nhớ — xem lý do ở `getSnapshot`.
  snapshotCache.set(period, { at: Date.now(), value, print: canCuocFile(CACHE_FILE) });
  while (snapshotCache.size > SNAPSHOT_CACHE_MAX) snapshotCache.delete(snapshotCache.keys().next().value);
  return value;
}
/* ‼ ĐỌC BẢN ĐÃ KÉO VỀ MÁY TRƯỚC — KHÔNG gọi DataHub mỗi lần mở màn (CEO bắt lỗi
 * thiết kế 09/08/2026: "danh mục đã kéo về hẳn bên App Report rồi, sao mỗi lần
 * refresh nó cứ báo đang đồng bộ và gọi từ DataHub — tao nghĩ mày đang thiết kế sai").
 *
 * CEO ĐÚNG. Bản cũ chỉ nhớ snapshot trong RAM 2 phút; quá hạn hoặc restart là đi
 * kéo lại NGUYÊN bộ danh mục (27.719 dòng) từ DataHub dù trên đĩa đã có bản y hệt.
 * Hệ quả kép: màn nào cũng chờ mạng, và cú kéo nặng làm nghẽn luôn các request nhỏ
 * bên cạnh (bảng "đơn vị → nhóm" chết oan thành "Lỗi máy chủ").
 *
 * Thứ tự mới: RAM → BẢN TRÊN ĐĨA (LKG) → chỉ khi đĩa không có kỳ đó mới gọi DataHub.
 * Muốn số mới thì bấm "Đồng bộ lại" (forceRemote) — đúng nghĩa cái nút.
 *
 * ‼ ĐƯỜNG ĐỌC KHÔNG ĐƯỢC CÓ TÁC DỤNG PHỤ (bot chặn Gate 1 đúng, 09/08/2026).
 * Bản đầu có thêm một lượt "làm tươi ngầm" 10 phút/kỳ ngay trong `loadSnapshot`:
 * một lượt GET bình thường lại lặng lẽ gọi DataHub và GHI ĐÈ cache trên đĩa. Sai hai
 * nhẽ: (a) CEO bảo đừng gọi DataHub khi xem — gọi ngầm vẫn là gọi, chỉ khác là không
 * ai thấy; (b) DataHub từng tự restart vì bị đọc dồn (951,8 MB RSS, 08/08), thêm một
 * nguồn tải vô hình là thêm một thứ không ai truy được. Muốn bản mới thì có ĐÚNG MỘT
 * đường: bấm "Đồng bộ lại". Bản trên máy cũ tới đâu thì huy hiệu ghi rõ tới đó.
 */
async function loadSnapshot(period, { forceRemote = false } = {}) {
  // Data Hub is the only source of truth. Never present the legacy 1,808-row
  // local seed as the managed sales catalog — only a previously validated Data Hub
  // snapshot (LKG) or a fresh pull may be shown.
  if (!forceRemote) {
    const cached = readCache(period);
    if (cached) {
      // Bản local là BẢN SAO Y của lần đồng bộ thành công gần nhất — không phải
      // "hàng dự phòng lúc hỏng", nên KHÔNG gắn stale/readOnly. Ghi rõ nguồn để
      // huy hiệu nói thật "đang đọc từ máy, đồng bộ lúc nào".
      return { ...cached, period, meta: { ...cached.meta, source: 'data-hub-local', servedFrom: 'local', message: 'Đọc từ bản đã kéo về máy. Bấm "Đồng bộ lại" khi cần bản mới nhất từ Data Hub.' } };
    }
  }
  if (!configured()) {
    const cached = readCache(period);
    if (cached) return { ...cached, period, readOnly: true, meta: { ...cached.meta, source: 'data-hub-lkg', stale: true, readOnly: true, message: 'Data Hub chưa được cấu hình; đang giữ bản đồng bộ tốt gần nhất ở chế độ chỉ đọc.' } };
    throw Object.assign(new Error('Data Hub chưa được cấu hình và chưa có bản đồng bộ tốt gần nhất.'), { status: 503 });
  }
  try { return await remoteSnapshot(period); }
  catch (error) {
    const cached = readCache(period);
    if (cached) return { ...cached, period, readOnly: true, meta: { ...cached.meta, source: 'data-hub-lkg', stale: true, readOnly: true, message: `Data Hub tạm lỗi; giữ bản đồng bộ tốt gần nhất. ${error.message}` } };
    throw Object.assign(new Error(`Data Hub tạm lỗi và chưa có bản đồng bộ tốt gần nhất: ${error.message}`), { status: 503 });
  }
}
/**
 * Vứt bản nhớ tạm của MỘT kỳ để lượt đọc kế tiếp buộc phải hỏi lại Data Hub.
 * Dùng cho nút "Đồng bộ lại" (CEO yêu cầu 09/08/2026): số ở Data Hub vừa đổi mà
 * App Report còn giữ bản cũ tới 2 phút thì người dùng tưởng đồng bộ hỏng.
 *
 * ‼ CHỈ xoá bộ nhớ tạm trong tiến trình. KHÔNG đụng bản LKG trên đĩa — mất bản đó
 * là Data Hub chết kéo theo màn danh mục trắng, đúng thứ LKG sinh ra để chặn.
 * Lượt đang bay (in-flight) cứ để chạy nốt; nó ghi vào ô nhớ mới, không ghi đè
 * lại ô vừa xoá vì `rememberSnapshot` luôn ghi bản mới nhất.
 */
/**
 * Căn cước bản ĐANG NẰM TRÊN ĐĨA, đọc trực tiếp, KHÔNG gọi mạng.
 *
 * ‼ Dùng để trả lời câu hỏi quan trọng nhất sau khi bấm "Đồng bộ lại": *nội dung có
 * thật sự đổi không?* CEO chỉnh đúng 09/08/2026: *"số dòng thì đúng rồi, nhưng tao
 * đã sửa nhiều đợt trong đó, nên nó mới nâng lên bản V31.4"* — tức **đếm dòng KHÔNG
 * chứng minh được nội dung mới**; sửa hàng trăm dòng bên trong thì tổng vẫn y nguyên.
 * Thứ phân biệt được là `checksum` (băm toàn bộ nội dung) — đổi một ô là đổi băm.
 */
function cachedMeta(periodInput) {
  const period = toHubPeriod(periodInput);
  const snapshot = readCache(period);
  if (!snapshot) return null;
  return {
    period,
    version: String(snapshot.meta?.version || ''),
    sourceVersion: String(snapshot.meta?.sourceVersion || ''),
    checksum: String(snapshot.meta?.checksum || ''),
    updatedAt: snapshot.meta?.updatedAt || null,
    lastSyncAt: snapshot.meta?.lastSyncAt || null,
    rows: (snapshot.rows || []).length,
    catalog: (snapshot.catalog || []).length,
  };
}

function invalidateSnapshot(periodInput) {
  const period = toHubPeriod(periodInput);
  const had = snapshotCache.delete(period);
  return { period, had };
}
async function getSnapshot(periodInput, { forceRemote = false } = {}) {
  const period = toHubPeriod(periodInput);
  if (!forceRemote) {
    const hit = snapshotCache.get(period);
    /* ‼ HẠN GIỜ KHÔNG THAY ĐƯỢC CĂN CƯỚC (bot audit vòng 8, dựng bằng HAI TIẾN TRÌNH
     * THẬT). Ô nhớ này sống 2 phút và trước đây chỉ tính theo giờ. Một tiến trình khác
     * (materializer) ghi bản MỚI xuống đĩa thì tiến trình đang chạy **không có cách nào
     * biết** — `getSnapshot()` vẫn trả bản CŨ cho tới khi hết 2 phút.
     * Đường đọc thẳng LKG thì đã thấy bản mới, nên hai đường trong cùng một app trả hai
     * số khác nhau. Nay ô nhớ phải khớp CẢ căn cước file: file đổi ⇒ trượt ⇒ đọc lại. */
    const printHienTai = canCuocFile(CACHE_FILE);
    if (hit && Date.now() - hit.at < SNAPSHOT_CACHE_TTL_MS && hit.print === printHienTai) {
      // LRU touch without cloning the giant snapshot.
      snapshotCache.delete(period);
      snapshotCache.set(period, hit);
      return hit.value;
    }
    if (hit && hit.print !== printHienTai) snapshotCache.delete(period);
    if (snapshotInFlight.has(period)) return snapshotInFlight.get(period);
  }
  // Same-period callers always share one promise. Fail closed rather than
  // launching untracked duplicate fetches if arbitrary periods fill the cap.
  if (snapshotInFlight.size >= SNAPSHOT_IN_FLIGHT_MAX) {
    throw Object.assign(new Error('Quá nhiều kỳ danh mục đang được đồng bộ; vui lòng thử lại.'), {
      status: 503,
      code: 'CATALOG_SNAPSHOT_IN_FLIGHT_LIMIT',
    });
  }
  const task = loadSnapshot(period, { forceRemote })
    .then((value) => rememberSnapshot(period, value))
    .finally(() => { if (snapshotInFlight.get(period) === task) snapshotInFlight.delete(period); });
  snapshotInFlight.set(period, task);
  return task;
}
function activeIn(row, period) {
  return row.active !== false && row.effective_from <= period && (!row.effective_to || row.effective_to >= period);
}
function employeeItem(row, status) {
  return { id: row.id, type: row.type, value: row.value, label: row.label, route: row.route, province: row.province || provinceOf(row.unit_code, row.unit_code), contractor_code: row.contractor_code, unit_code: row.unit_code, qlnb_code: row.qlnb_code, c10: row.c10 || null, product_name: row.product_name, active_ingredient: row.active_ingredient, strength: row.strength, uom: row.uom, bid_price: row.bid_price, cst_initial: row.cst_initial, cst_remaining: row.cst_remaining, effective_from: row.effective_from, effective_to: row.effective_to, status };
}
function assertEmployeeSafe(value, pathName = 'response') {
  if (Array.isArray(value)) return value.forEach((v, i) => assertEmployeeSafe(v, `${pathName}[${i}]`));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && EMPLOYEE_FORBIDDEN_PHRASES.test(value)) throw new Error(`Employee privacy phrase at ${pathName}`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (EMPLOYEE_FORBIDDEN_KEYS.test(key) || isPermanentlyBlockedCatalogField(key)) throw new Error(`Employee privacy field at ${pathName}.${key}`);
    assertEmployeeSafe(child, `${pathName}.${key}`);
  }
}
function employeeView(snapshot, empCode, periodInput) {
  assertCatalogFieldPolicy(snapshot, 'employeeCatalogSnapshot');
  const period = toHubPeriod(periodInput);
  const emp = String(empCode || '').trim().toUpperCase();
  const own = snapshot.rows.filter((row) => row.emp_code === emp);
  const current = own.filter((row) => activeIn(row, period)).map((row) => employeeItem(row, 'current'));
  const ending = own.filter((row) => row.active !== false && row.effective_to === period).map((row) => employeeItem(row, 'ending'));
  const starting = own.filter((row) => row.active !== false && row.effective_from === period).map((row) => employeeItem(row, 'starting'));
  const response = {
    period, period_ui: toUiPeriod(period), employee: { code: emp, name: store.findUserByCode(emp)?.name || emp },
    sections: { current, ending, starting },
    meta: { source: snapshot.meta.source, version: snapshot.meta.version, checksum: snapshot.meta.checksum, updatedAt: snapshot.meta.updatedAt, lastSyncAt: snapshot.meta.lastSyncAt, stale: !!snapshot.meta.stale, readOnly: true, message: snapshot.meta.message },
  };
  assertEmployeeSafe(response);
  return response;
}
/* ‼ GỬI KÈM BẢNG "MÃ ĐƠN VỊ → NHÓM" NGAY TRONG DANH MỤC (CEO kẹt 3 lần, 10/08/2026).
 *
 * Thiết kế cũ của Claude: trình duyệt gom cả nghìn mã đơn vị rồi POST lên hỏi nhóm.
 * Sai từ gốc — nhóm chỉ là **tiền tố số trước dấu chấm**, máy chủ đã cầm sẵn toàn bộ
 * mã trong chính danh mục vừa trả. Bắt gửi ngược cả nghìn mã lên chỉ để nhận lại tiền
 * tố là tự dựng thêm một lượt gọi mạng có thể trượt — và nó trượt thật ("Failed to
 * fetch"), làm CẢ menu phân quyền mù, tới mức mục "việc cần rà" khuyên xoá quyền đúng.
 *
 * Nay bảng tra đi KÈM danh mục: 0 lượt gọi thêm ⇒ không còn đường nào để hỏng.
 * Luật tách nhóm vẫn nằm NGUYÊN ở máy chủ (`catalogCostColumnGrants.groupOf`) —
 * frontend chỉ đọc kết quả, không chép luật.
 *
 * Gửi theo ĐƠN VỊ RIÊNG (vài trăm mục), không gắn vào từng dòng (27.719 dòng) — cùng
 * một thông tin nhưng nhẹ hơn hai bậc.
 */
function unitGroupMap(rows = []) {
  const catalogCostColumnGrants = require('./catalogCostColumnGrants');
  const units = [...new Set(rows.map((row) => String(row?.unit_code || '').trim()).filter(Boolean))];
  const nameOf = new Map();
  for (const unit of units) {
    const group = catalogCostColumnGrants.groupOf(unit);
    if (!group) continue;
    const name = unit.replace(/^\s*\d{1,4}\s*[.\-]\s*/, '').trim();
    const current = nameOf.get(group);
    if (!current || name.length < current.length) nameOf.set(group, name);
  }
  const byUnit = {};
  for (const unit of units) {
    const group = catalogCostColumnGrants.groupOf(unit);
    // Không phân giải được ⇒ null (nói thẳng), đúng như route POST cũ.
    byUnit[unit] = group ? { key: group, label: `${group} · ${nameOf.get(group) || group}` } : null;
  }
  return byUnit;
}
function adminView(snapshot) {
  assertCatalogFieldPolicy(snapshot, 'adminCatalogSnapshot');
  // The browser only needs the resolved unit+QLNB timeline. Keep the full
  // restricted catalog server-side in the versioned LKG snapshot to avoid
  // sending a duplicate ~6 MB payload on every CEO page load.
  const rows = snapshot.rows.map((row) => row.province ? row : { ...row, province: provinceOf(row.unit_code, row.unit_code) });
  return { period: snapshot.period, period_ui: toUiPeriod(snapshot.period), rows, catalog_total: Array.isArray(snapshot.catalog) ? snapshot.catalog.length : 0, history: snapshot.history || [], meta: snapshot.meta, unitGroups: unitGroupMap(rows) };
}
async function getHistory() {
  if (!configured()) return { history: [], source: 'unavailable' };
  const payload = await fetchJson(`${baseUrl()}/api/integrations/app-report/assignments/history?limit=300`);
  return { history: arrayOf(payload, ['history', 'rows', 'events']), source: 'data-hub' };
}
async function transfer(payload, session) {
  if (!configured()) throw Object.assign(new Error('Data Hub chưa được cấu hình. Đợt 1 không ghi local và không thay đổi quyền production.'), { status: 503 });
  const effectiveFrom = toHubPeriod(payload.effective_period || payload.period || payload.ky);
  const toEmp = String(payload.to_emp_code || payload.to_emp || '').trim().toUpperCase();
  const type = String(payload.type || '').trim().toLowerCase();
  const scope = ({ unit_qlnb: 'unit_qlnb', iit: 'qlnb', qlnb: 'qlnb', unit: 'don_vi', don_vi: 'don_vi', route: 'route', all: 'all' })[type];
  if (!scope) throw Object.assign(new Error('Loại điều chuyển không hợp lệ'), { status: 400 });
  if (!toEmp) throw Object.assign(new Error('Thiếu nhân viên tiếp nhận'), { status: 400 });
  const values = Array.isArray(payload.values) && payload.values.length ? payload.values : [payload.value];
  const items = values.map((value) => ({ scope, code: scope === 'all' ? 'ALL' : String(value || '').trim() })).filter((item) => item.code);
  if (!items.length) throw Object.assign(new Error('Thiếu mã điều chuyển'), { status: 400 });
  const body = { effective_from: effectiveFrom, to_emp: toEmp, items, reason: String(payload.note || payload.reason || '').trim() };
  return fetchJson(`${baseUrl()}/api/integrations/app-report/assignments/transfer`, {
    method: 'POST', headers: { 'x-app-report-actor': String(session.emp_code || session.name || 'App Report CEO') }, body: JSON.stringify(body),
  });
}
function diagnostics() {
  let cacheRoot = null;
  try { cacheRoot = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); assertCatalogFieldPolicy(cacheRoot, 'catalogLkg'); } catch { cacheRoot = null; }
  const count = cacheRoot?.snapshots ? Object.keys(cacheRoot.snapshots).length : (cacheRoot?.rows ? 1 : 0);
  return { configured: configured(), endpoint: configured() ? `${baseUrl()}/api/integrations/app-report` : null, timeoutMs: Math.max(1000, Number(process.env.DATA_HUB_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS), cache: count ? { available: true, periods: count, version: cacheRoot.version || cacheRoot.meta?.version || null, checksum: cacheRoot.checksum || cacheRoot.meta?.checksum || null, updatedAt: cacheRoot.updatedAt || cacheRoot.meta?.updatedAt || null } : { available: false }, phase1NoCutover: true };
}

module.exports = {
  quenLkg,
  /* Xuất ra để ca kiểm gọi THẲNG. `writeCacheForTests` dùng chính đường ghi của app, nên
   * fixture không thể sai hình — bốn ca kiểm vòng trước xanh giả vì tôi tự bịa fixture
   * rồi nó trượt kiểm hợp lệ và trả `null` (bot audit vòng 8). */
  readCacheForTests: readCache,
  // Ca kiểm cần soi tham chiếu có được THẢ thật không, không chỉ có hết hạn không.
  conGiuBanPhanTichForTests: () => nhoLkg !== null,
  writeCacheForTests: writeCacheAtomic, configured, toHubPeriod, toUiPeriod, getSnapshot, invalidateSnapshot, cachedMeta, unitGroupMap, getCachedDataQualitySnapshot, getHistory, employeeView, adminView, transfer, diagnostics, assertEmployeeSafe, assertNoPermanentCatalogFields, assertCatalogFieldPolicy, assertContractorCoverage, assertCatalogSourceContract, assertCatalogSnapshotContract, assertCriticalProjectionCoverage, assertCstProjectionCoverage, buildCatalogRows, safeRestoredSnapshots, isPermanentlyBlockedCatalogField, PERMANENTLY_BLOCKED_CATALOG_FIELDS, APPROVED_OPTIONAL_CATALOG_FIELDS, CRITICAL_CATALOG_FIELDS, CRITICAL_CATALOG_SOURCE_FIELDS, normalizeRow, enrichRowsFromCatalog, enrichRowsWithCst, activeIn, CACHE_FILE, DQ_CACHE_FILE, CACHE_INDEX_FILE, writeCacheAtomic, snapshotFingerprint, dqSnapshotFingerprint };
