/**
 * revenueRefresh.js — scheduler refresh doanh thu kỳ đang chạy.
 * - Chạy theo khung giờ VN cấu hình env.
 * - MISA snapshot: gọi endpoint/command nếu được cấu hình; nếu chưa cấu hình thì dùng snapshot DB mới nhất.
 * - Materialize App Report slot bằng script 2-source, idempotent.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TZ = 'Asia/Bangkok';
const DEFAULT_INTERVAL_MIN = 60;
const DEFAULT_WEEKDAY = '07:30-18:00';
const DEFAULT_SAT = '07:30-13:00';
const DEFAULT_SUN = 'off';
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'revenue_refresh_state.json');
const state = {
  started: false,
  timer: null,
  inFlight: false,
  lastSlot: '',
  lastRun: null,
  lastSkip: null,
};

function enabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.REVENUE_REFRESH_ENABLED || 'true'));
}
function intervalMin() {
  const n = Number(process.env.REVENUE_REFRESH_MINUTES || DEFAULT_INTERVAL_MIN);
  return Number.isFinite(n) && n > 0 ? Math.max(5, Math.round(n)) : DEFAULT_INTERVAL_MIN;
}
function vnParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hourCycle: 'h23',
  }).formatToParts(d).reduce((m, p) => (m[p.type] = p.value, m), {});
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day),
    hh: Number(parts.hour), mm: Number(parts.minute), ss: Number(parts.second),
    dow: weekdayMap[parts.weekday] || 0,
  };
}
function pad(n) { return String(n).padStart(2, '0'); }
function vnIsoNow() {
  const p = vnParts();
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}+07:00`;
}
function currentKy(now = new Date()) {
  const p = vnParts(now);
  return `${pad(p.mo)}.${p.y}`;
}
function kyFromParts(p) { return `${pad(p.mo)}.${p.y}`; }
function previousKyFromParts(p) {
  const mo = p.mo === 1 ? 12 : p.mo - 1;
  const y = p.mo === 1 ? p.y - 1 : p.y;
  return `${pad(mo)}.${y}`;
}
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { return {}; }
}
function writeState(o) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(o, null, 2) + '\n', 'utf8');
}
function wasFinalClosed(ky) {
  const st = readState();
  return !!(st.finalClosed && st.finalClosed[ky]);
}
function markFinalClosed(ky, meta = {}) {
  const st = readState();
  st.finalClosed = st.finalClosed || {};
  st.finalClosed[ky] = { at: new Date().toISOString(), ...meta };
  writeState(st);
}
function kyToRange(ky) {
  const [mm, yyyy] = String(ky || '').split('.').map(Number);
  if (!mm || !yyyy) throw new Error(`INVALID_KY:${ky}`);
  const from = `${yyyy}-${pad(mm)}-01`;
  const last = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  const to = `${yyyy}-${pad(mm)}-${pad(last)}`;
  return { from, to };
}
function parseWindow(s) {
  const raw = String(s || '').trim().toLowerCase();
  if (!raw || raw === 'off' || raw === 'none' || raw === 'false') return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start > end) return null;
  return { start, end, text: `${pad(m[1])}:${m[2]}-${pad(m[3])}:${m[4]}` };
}
function windowForDow(dow) {
  if (dow >= 1 && dow <= 5) return parseWindow(process.env.REVENUE_REFRESH_WEEKDAY || DEFAULT_WEEKDAY);
  if (dow === 6) return parseWindow(process.env.REVENUE_REFRESH_SAT || DEFAULT_SAT);
  return parseWindow(process.env.REVENUE_REFRESH_SUN || DEFAULT_SUN);
}
function isDue(now = new Date()) {
  if (!enabled()) return { due: false, reason: 'disabled' };
  const p = vnParts(now);
  const win = windowForDow(p.dow);
  if (!win) return { due: false, reason: 'outside_window', parts: p };
  const minute = p.hh * 60 + p.mm;
  if (minute < win.start || minute > win.end) return { due: false, reason: 'outside_window', parts: p, window: win.text };
  const every = intervalMin();
  const aligned = ((minute - win.start) % every === 0) || minute === win.end;
  if (!aligned) return { due: false, reason: 'not_aligned', parts: p, window: win.text };
  const slot = `${p.y}-${pad(p.mo)}-${pad(p.d)}-${pad(p.hh)}${pad(p.mm)}`;
  return { due: true, slot, parts: p, window: win.text, every };
}
function runCommand(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env, shell: !!opts.shell });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ code, stdout, stderr }) : reject(Object.assign(new Error(stderr || stdout || `${cmd} exited ${code}`), { code, stdout, stderr })));
  });
}
async function syncMisaSnapshot({ ky } = {}) {
  const { from, to } = kyToRange(ky || currentKy());
  const url = process.env.APPSALE_MISA_SYNC_URL;
  const token = process.env.APPSALE_MISA_SYNC_TOKEN;
  const command = process.env.APPSALE_MISA_SYNC_COMMAND;
  if (command) {
    const r = await runCommand(command, [], { shell: true, env: { ...process.env, SYNC_FROM: from, SYNC_TO: to } });
    return { status: 'command_ok', from, to, stdout: r.stdout.slice(-1000) };
  }
  if (url && token) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ from, to, snapshotVersion: 1 }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`MISA_SYNC_HTTP_${res.status}:${text.slice(0, 300)}`);
    let json = null;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 1000) }; }
    return { status: 'http_ok', from, to, result: json };
  }
  return { status: 'skipped_not_configured', from, to, note: 'APPSALE_MISA_SYNC_URL/TOKEN hoặc APPSALE_MISA_SYNC_COMMAND chưa cấu hình; dùng snapshot MISA success mới nhất trong DB.' };
}
async function materialize({ ky } = {}) {
  const script = path.join(__dirname, '..', 'scripts', 'materialize_july_revenue.js');
  const env = { ...process.env, REVENUE_REFRESH_KY: ky || currentKy(), REVENUE_DATA_AS_OF: vnIsoNow() };
  const r = await runCommand(process.execPath, [script], { cwd: path.join(__dirname, '..', '..'), env });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = { stdout: r.stdout.slice(-2000) }; }
  return parsed;
}
async function runOnce({ force = false, reason = 'manual', ky } = {}) {
  if (state.inFlight) return { ok: false, skipped: true, reason: 'in_flight', lastRun: state.lastRun };
  if (!force) {
    const due = isDue();
    if (!due.due) return { ok: false, skipped: true, ...due };
    if (due.slot && due.slot === state.lastSlot) return { ok: false, skipped: true, reason: 'already_ran_slot', slot: due.slot };
    state.lastSlot = due.slot;
  }
  state.inFlight = true;
  const run = { ok: false, reason, ky: ky || currentKy(), startedAt: new Date().toISOString(), dataAsOf: null };
  try {
    run.misa = await syncMisaSnapshot({ ky: run.ky });
    run.materialize = await materialize({ ky: run.ky });
    run.dataAsOf = vnIsoNow();
    run.finishedAt = new Date().toISOString();
    run.ok = true;
    state.lastRun = run;
    console.log('[revenue-refresh] success', JSON.stringify({ reason, ky: run.ky, dataAsOf: run.dataAsOf, materialize: run.materialize }));
    return run;
  } catch (e) {
    run.finishedAt = new Date().toISOString();
    run.error = String(e?.message || e);
    state.lastRun = run;
    console.error('[revenue-refresh] failed; keeping previous data', JSON.stringify({ reason, ky: run.ky, error: run.error }));
    throw e;
  } finally {
    state.inFlight = false;
  }
}
async function runScheduled(due) {
  // Ngày 01 tháng mới: chốt sổ kỳ vừa đóng đúng 1 lần để bắt hóa đơn về trễ,
  // rồi mới materialize kỳ hiện tại. State lưu file để restart trong ngày 01 không chốt lặp.
  if (due?.parts?.d === 1) {
    const prevKy = previousKyFromParts(due.parts);
    if (!wasFinalClosed(prevKy)) {
      const r = await runOnce({ force: true, reason: `final_close:${prevKy}`, ky: prevKy });
      markFinalClosed(prevKy, { slot: due.slot, ok: !!r?.ok, materialize: r?.materialize || null });
    }
  }
  return runOnce({ force: true, reason: `schedule:${due.slot}`, ky: due?.parts ? kyFromParts(due.parts) : undefined });
}
function tick() {
  const due = isDue();
  if (!due.due) { state.lastSkip = { at: new Date().toISOString(), ...due }; return; }
  if (due.slot === state.lastSlot) return;
  // Slot có YYYY-MM-DD-HHmm nên qua ngày 01/tháng mới không thể bị lastSlot tháng cũ chặn.
  state.lastSlot = due.slot;
  runScheduled(due).catch((e) => console.error('[revenue-refresh] scheduled run failed', String(e?.message || e)));
}
function start() {
  if (state.started) return;
  state.started = true;
  if (!enabled()) {
    console.log('[revenue-refresh] disabled');
    return;
  }
  state.timer = setInterval(tick, 60 * 1000);
  state.timer.unref?.();
  console.log('[revenue-refresh] scheduler armed', JSON.stringify(config()));
  tick();
}
function config() {
  return {
    enabled: enabled(), timezone: TZ, minutes: intervalMin(),
    weekday: process.env.REVENUE_REFRESH_WEEKDAY || DEFAULT_WEEKDAY,
    sat: process.env.REVENUE_REFRESH_SAT || DEFAULT_SAT,
    sun: process.env.REVENUE_REFRESH_SUN || DEFAULT_SUN,
    misaSyncConfigured: !!(process.env.APPSALE_MISA_SYNC_COMMAND || (process.env.APPSALE_MISA_SYNC_URL && process.env.APPSALE_MISA_SYNC_TOKEN)),
  };
}
function status() { return { ...config(), inFlight: state.inFlight, lastSlot: state.lastSlot, lastRun: state.lastRun, lastSkip: state.lastSkip, nowVn: vnIsoNow(), dueNow: isDue() }; }

module.exports = { start, runOnce, status, isDue, currentKy, kyToRange, vnIsoNow, kyFromParts, previousKyFromParts, runScheduled };
