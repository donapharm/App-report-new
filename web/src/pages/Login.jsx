import React, { useEffect, useRef, useState } from 'react';
import { api, getLastPhone, setToken } from '../api.js';
import { roleLabel } from '../util.js';
import Logo from '../logo.jsx';
import { OfficialZaloQr } from '../components.jsx';

// Dùng đúng component QR chính thức dùng chung toàn ứng dụng.
function ZaloOA() {
  return (
    <div style={{ textAlign: 'center', marginTop: 22 }}>
      <div style={{ fontSize: 12.5, opacity: .85, marginBottom: 8 }}>Theo dõi Zalo OA DONAPHARM</div>
      <div style={{ display: 'inline-block', background: '#fff', padding: 6, borderRadius: 10 }}>
        <OfficialZaloQr size={76} />
      </div>
    </div>
  );
}

const cardStyle = { background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff' };

/* ═══════════════════════════════════════════════════════════════════════════════
   MÀN LOGIN PHẢI CHO CHỌN CÁCH ĐĂNG NHẬP — VÀ ĐƯỜNG SĐT PHẢI CÓ Ô NHẬP SĐT
   (CEO bực 10/08/2026)

   CEO: *"Tao đã yêu cầu có nhiều cách đăng nhập… nhưng quan trọng là phải nhập số
   điện thoại muốn đăng nhập vào. Hiện tại tao muốn đăng nhập vào tài khoản khác để
   kiểm tra thì tao phải nhập đúng số điện thoại của tài khoản đó để trả OTP về.
   Nhưng ở đây nó bỏ qua bước nhập số điện thoại là sao — vậy nó mặc định nhảy vào
   bot devreport."*

   Nguyên nhân: bản trước có hằng `SHOW_ZALO_OTP_UI = false` **viết cứng trong web**
   để tạm giấu đường OTP lúc dịch vụ Zalo lỗi. Giấu xong thì trên màn chỉ còn MỘT
   cửa — Telegram — nên nhìn như hệ thống "tự nhảy vào bot". Công tắc vận hành mà
   nằm trong bundle thì phải sửa code + build + deploy mới bật lại được.

   Nay: **backend nói kênh nào đang bật** (`mode.otp`, `mode.telegram`), web chỉ bày
   ra. Có từ hai kênh thì hiện hàng chọn; **ưu tiên mặc định là SĐT + OTP** vì đó là
   đường duy nhất chọn được TÀI KHOẢN NÀO đăng nhập.

   ‼ RANH GIỚI AN NINH GIỮ NGUYÊN: nhập SĐT của người khác thì OTP vẫn **về máy của
   người đó**, không về máy người đang gõ. Đây là chủ ý — màn hình phải NÓI RÕ điều
   này thay vì để người dùng tưởng nhập số là vào được.
   ═══════════════════════════════════════════════════════════════════════════════ */

/** Kênh SĐT+OTP có dùng được không — do BACKEND quyết, web không tự đoán.
 *  `otp` là cờ mới; `live` giữ lại làm đường lui cho backend bản cũ chưa có cờ. */
const otpAvailable = (mode) => !!mode && (mode.otp === undefined ? !!mode.live : !!mode.otp);

export default function Login({ onLogin }) {
  const [mode, setMode] = useState(null);        // { live, otp, demo, telegram }
  const [demoUsers, setDemoUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [channel, setChannel] = useState('');    // 'phone' | 'telegram' — cách đang chọn

  // Telegram flow
  const [tg, setTg] = useState(null);            // { login_code, poll_secret, bot_link }
  const [tgLeft, setTgLeft] = useState(0);       // đếm ngược giây
  const [tgErr, setTgErr] = useState('');
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  // OTP flow
  const [step, setStep] = useState('phone');     // phone | code | choose
  const [phone, setPhone] = useState(() => getLastPhone());
  const [code, setCode] = useState('');
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function initLogin() {
      const params = new URLSearchParams(window.location.search);
      const ssoToken = params.get('sso_token') || '';
      if (ssoToken) {
        // Xóa token Home khỏi thanh địa chỉ/history ngay khi đã đọc để tránh lộ
        // qua ảnh chụp, copy URL hoặc referrer.
        params.delete('sso_token');
        params.delete('_v');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
        setBusy(true);
        try {
          const r = await api.sso(ssoToken);
          if (!cancelled) await finish(r.token);
          return;
        } catch (e) {
          if (!cancelled) setErr(`Đăng nhập từ Home không thành công: ${e.message}`);
        } finally {
          if (!cancelled) setBusy(false);
        }
      }
      try {
        const m = await api.mode();
        if (cancelled) return;
        setMode(m);
        // Ưu tiên SĐT vì chỉ đường này mới CHỌN ĐƯỢC tài khoản muốn vào. Telegram
        // luôn nhận diện theo chính tài khoản Telegram đang mở, không đổi được.
        setChannel(otpAvailable(m) ? 'phone' : (m.telegram ? 'telegram' : ''));
        if (m.demo) api.demoUsers().then((x) => !cancelled && setDemoUsers(x)).catch(() => {});
      } catch {
        if (!cancelled) { setMode({ live: false, otp: false, demo: false, telegram: true }); setChannel('telegram'); }
      }
    }
    initLogin();
    return () => { cancelled = true; stopTelegram(); };
  }, []);

  async function finish(token) {
    setToken(token);
    const me = await api.me();
    onLogin(me);
  }

  /* ---------- Telegram ---------- */
  function stopTelegram() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    pollRef.current = null; tickRef.current = null;
  }
  async function startTelegram() {
    setTgErr(''); setErr(''); setBusy(true);
    try {
      const r = await api.telegramStart();
      setTg(r);
      setTgLeft(r.expires_in || 120);
      stopTelegram();
      tickRef.current = setInterval(() => setTgLeft((s) => {
        if (s <= 1) { stopTelegram(); setTgErr('Mã đã hết hạn. Bấm “Tạo mã mới”.'); return 0; }
        return s - 1;
      }), 1000);
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.telegramStatus(r.poll_secret);
          if (st.status === 'confirmed' && st.token) { stopTelegram(); await finish(st.token); }
          else if (st.status === 'expired') { stopTelegram(); setTgErr('Mã đã hết hạn. Bấm “Tạo mã mới”.'); setTgLeft(0); }
        } catch { /* rate-limit/lỗi tạm — bỏ qua, lần poll sau */ }
      }, 2500);
    } catch (e) { setTgErr(e.message); }
    setBusy(false);
  }

  /* ---------- Demo ---------- */
  async function doDemoLogin(emp_code) {
    setBusy(true); setErr('');
    try { const r = await api.login(emp_code); await finish(r.token); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  /* ---------- OTP ---------- */
  async function sendOtp() {
    const p = phone.trim();
    if (!/^\d{9,11}$/.test(p.replace(/\s/g, ''))) { setErr('Nhập số điện thoại hợp lệ.'); return; }
    setBusy(true); setErr('');
    try {
      // A trusted App Sale device may skip OTP only after the Report backend
      // consumes a valid one-time assertion. Any bridge failure continues to OTP.
      if (mode?.trustedDeviceSso) {
        try {
          const trusted = await api.trustedDeviceLogin(p);
          if (trusted?.token) { await finish(trusted.token); return; }
        } catch { /* fail closed: keep the normal OTP flow */ }
      }
      await api.otpRequest(p);
      setStep('code');
    }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function verifyOtp() {
    setBusy(true); setErr('');
    try {
      const r = await api.otpVerify(phone.trim(), code.trim());
      if (r.token) { await finish(r.token); return; }
      if (r.accounts && r.accounts.length) { setAccounts(r.accounts); setStep('choose'); return; }
      setErr('Không xác định được tài khoản.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function pickAccount(emp_code) {
    setBusy(true); setErr('');
    try { const r = await api.otpSelect(phone.trim(), emp_code); await finish(r.token); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const ceo = demoUsers.filter((u) => u.role !== 'sale');
  const sale = demoUsers.filter((u) => u.role === 'sale');
  const showTelegram = !!(mode && mode.telegram);
  const showOtpFlow = otpAvailable(mode);
  const bothChannels = showTelegram && showOtpFlow;
  // Đổi cách đăng nhập thì dọn sạch dấu vết cách cũ — không để mã Telegram còn đếm
  // ngược phía sau ô nhập SĐT, cũng không để lỗi của cách này bám sang cách kia.
  const pickChannel = (next) => {
    if (next === channel) return;
    stopTelegram(); setTg(null); setTgErr(''); setErr('');
    if (next === 'phone') { setStep('phone'); setCode(''); }
    setChannel(next);
  };

  return (
    <div className="login">
      <div style={{ marginBottom: 16 }}><Logo full /></div>
      <h1>Đăng nhập App Report</h1>
      <p>Xem doanh thu, target, cơ số thầu theo quyền được phân công.</p>

      {!mode ? null : (
        <>
          {/* (0) CHỌN CÁCH ĐĂNG NHẬP — có từ hai cửa thì phải thấy cả hai.
                 Bản trước chỉ còn một cửa nên nhìn như hệ thống tự nhảy vào bot. */}
          {bothChannels && (
            <div className="login-channels" role="group" aria-label="Chọn cách đăng nhập">
              <button type="button" className={`login-channel${channel === 'phone' ? ' is-active' : ''}`}
                      aria-pressed={channel === 'phone'} onClick={() => pickChannel('phone')}>
                <b>📱 Số điện thoại</b><small>Nhập SĐT của tài khoản cần vào · OTP về Zalo/SMS</small>
              </button>
              <button type="button" className={`login-channel${channel === 'telegram' ? ' is-active' : ''}`}
                      aria-pressed={channel === 'telegram'} onClick={() => pickChannel('telegram')}>
                <b>✈️ Telegram</b><small>Vào bằng chính tài khoản Telegram đang mở</small>
              </button>
            </div>
          )}

          {/* Chỉ còn Telegram ⇒ NÓI RÕ VÌ SAO không có ô nhập SĐT, thay vì để trống. */}
          {showTelegram && !showOtpFlow && (
            <div className="card" style={{ ...cardStyle, fontSize: 12.5, lineHeight: 1.5 }}>
              ⓘ Đường <b>SĐT + OTP</b> đang <b>tắt trên máy chủ</b> (biến <code>LOGIN_OTP_ENABLED</code>), nên màn này chỉ còn Telegram.
              Bật lại được ngay bằng cấu hình, không cần sửa code.
            </div>
          )}

          {/* (1) ĐĂNG NHẬP TELEGRAM */}
          {showTelegram && channel === 'telegram' && (
            <div className="card" style={cardStyle}>
              {!tg ? (
                <>
                  <div style={{ fontSize: 13, opacity: .92, marginBottom: 10 }}>
                    Đăng nhập nhanh & an toàn qua <b>Telegram</b>.
                  </div>
                  {/* ‼ Trả lời thẳng câu CEO hỏi: vì sao cửa này KHÔNG có ô nhập SĐT. */}
                  <div style={{ fontSize: 12, opacity: .85, lineHeight: 1.5, marginBottom: 10 }}>
                    Cửa này <b>không có ô nhập số điện thoại</b>: Telegram nhận diện theo chính tài khoản Telegram đang mở,
                    nên luôn vào đúng tài khoản của bạn. Muốn vào <b>tài khoản khác</b> thì chọn <b>📱 Số điện thoại</b>.
                  </div>
                  <div style={{ fontSize: 12.5, opacity: .9, lineHeight: 1.55, marginBottom: 10 }}>
                    1. Mở <b>một trong các bot</b> bên dưới → 2. Gửi mã đăng nhập → 3. Bấm ✅ xác nhận.
                  </div>
                  <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={startTelegram}>
                    {busy ? 'Đang tạo mã…' : '✈️  Đăng nhập bằng Telegram'}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, opacity: .92, marginBottom: 8 }}>Gửi mã này cho <b>một trong các bot</b> dưới đây trên Telegram rồi bấm ✅ xác nhận:</div>
                  <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, textAlign: 'center',
                                background: 'rgba(255,255,255,.16)', borderRadius: 10, padding: '10px 0', marginBottom: 8 }}>
                    {tg.login_code}
                  </div>
                  {/* ‼ MỘT NÚT CHO MỖI BOT ĐANG BẬT (CEO xin thêm kênh 09/08/2026).
                      Danh sách do BACKEND cấp — bot nào chưa cấu hình đủ thì không
                      hiện, để không bao giờ mời người dùng đi vào một cửa chết.
                      Bản web cũ chỉ có `bot_link`; giữ lại làm đường lui. */}
                  {(tg.bots && tg.bots.length ? tg.bots : (tg.bot_link ? [{ key: 'login', label: 'Report Bot', link: tg.bot_link }] : []))
                    .map((bot) => (
                      <a key={bot.key} href={bot.link} target="_blank" rel="noreferrer"
                         className="btn" style={{ width: '100%', display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: 8 }}>
                        Mở {bot.label} ›
                      </a>
                    ))}
                  {tg.bots && tg.bots.length > 1 && (
                    <div style={{ fontSize: 11.5, opacity: .85, textAlign: 'center', marginBottom: 8 }}>
                      Gửi cho <b>bất kỳ bot nào</b> ở trên đều được — bot này kẹt thì dùng bot kia.
                    </div>
                  )}
                  <div style={{ fontSize: 12, opacity: .85, textAlign: 'center' }}>
                    {tgLeft > 0 ? `Mã hết hạn sau ${tgLeft}s · đang chờ xác nhận…` : 'Mã đã hết hạn.'}
                  </div>
                  <div style={{ fontSize: 11.5, opacity: .8, marginTop: 8, lineHeight: 1.4 }}>
                    ⚠ Không gửi mã này theo yêu cầu của người khác. Chỉ bấm ✅ khi chính bạn đang đăng nhập.
                  </div>
                  {(tgLeft <= 0 || tgErr) && (
                    <button className="btn ghost" style={{ width: '100%', marginTop: 10 }} disabled={busy}
                            onClick={() => { setTg(null); setTgErr(''); startTelegram(); }}>↻ Tạo mã mới</button>
                  )}
                  {tgErr && <div style={{ color: '#ffd7d7', fontSize: 13, marginTop: 8 }}>{tgErr}</div>}
                </>
              )}
            </div>
          )}

          {/* (2) ĐĂNG NHẬP BẰNG SỐ ĐIỆN THOẠI + OTP — đường DUY NHẤT chọn được tài khoản */}
          {showOtpFlow && channel === 'phone' && (
            <div className="card" style={cardStyle}>
              {(
                <>
                  {step === 'phone' && (
                    <>
                      <div style={{ fontSize: 13, opacity: .92, marginBottom: 8 }}>Đăng nhập bằng <b>số điện thoại</b></div>
                      <input type="tel" inputMode="numeric" placeholder="Số điện thoại của tài khoản cần vào"
                             aria-label="Số điện thoại của tài khoản cần đăng nhập"
                             value={phone} onChange={(e) => setPhone(e.target.value)}
                             onKeyDown={(e) => e.key === 'Enter' && !busy && sendOtp()} style={{ marginBottom: 10 }} />
                      <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={sendOtp}>
                        {busy ? 'Đang gửi…' : 'Gửi mã OTP'}
                      </button>
                      {/* ‼ RANH GIỚI AN NINH — nói trước, đừng để người dùng gõ số xong mới ngã ngửa.
                          Nhập SĐT người khác thì OTP về MÁY CỦA HỌ, không về máy đang gõ. Đây là
                          chủ ý: nếu gửi được sang máy khác thì bất kỳ ai biết SĐT đều vào được. */}
                      <div style={{ fontSize: 11.5, opacity: .82, marginTop: 10, lineHeight: 1.45 }}>
                        ⚠ Mã OTP luôn gửi về <b>đúng máy của số này</b> (Zalo/SMS), không gửi sang máy khác.
                        Muốn kiểm tra tài khoản của nhân viên thì nhập SĐT của họ và <b>nhờ họ đọc mã</b>.
                      </div>
                    </>
                  )}
                  {step === 'code' && (
                    <>
                      <div style={{ fontSize: 13, opacity: .9, marginBottom: 8 }}>Nhập mã OTP gửi tới {phone}</div>
                      <input inputMode="numeric" placeholder="Mã OTP" value={code}
                             onChange={(e) => setCode(e.target.value)}
                             onKeyDown={(e) => e.key === 'Enter' && !busy && verifyOtp()} style={{ marginBottom: 10 }} />
                      <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={verifyOtp}>
                        {busy ? 'Đang kiểm tra…' : 'Xác nhận'}
                      </button>
                      <button className="btn ghost" style={{ width: '100%', marginTop: 8 }}
                              onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>‹ Đổi số khác</button>
                    </>
                  )}
                  {step === 'choose' && (
                    <>
                      <div style={{ fontSize: 13, opacity: .9, marginBottom: 8 }}>Số này có nhiều tài khoản — chọn để tiếp tục:</div>
                      <div className="demo-list">
                        {accounts.map((a) => (
                          <div key={a.emp_code} className="demo-item" onClick={() => !busy && pickAccount(a.emp_code)}>
                            <div><b>{a.name || a.emp_code}</b><div style={{ fontSize: 12, opacity: .8 }}>{a.emp_code}</div></div>
                            <span className="role-tag">{roleLabel(a.role)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {err && <div style={{ color: '#ffd7d7', fontSize: 13, marginTop: 10 }}>{err}</div>}
                  {/* Dịch vụ OTP chết thì đưa NGAY đường thoát, đừng bắt người dùng
                      tự mò lên đầu trang. Đây chính là tình huống từng khiến cả cửa
                      SĐT bị giấu đi bằng hằng viết cứng. */}
                  {!!err && showTelegram && (
                    <button className="btn ghost" style={{ width: '100%', marginTop: 8 }}
                            onClick={() => pickChannel('telegram')}>Thử cách khác: ✈️ Telegram ›</button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ĐĂNG NHẬP DEMO: chỉ hiện khi còn bật demo */}
          {mode.demo && (
            <div className="card" style={cardStyle}>
              <div style={{ fontSize: 13, opacity: .9, marginBottom: 4 }}>
                {showOtpFlow || showTelegram ? 'Hoặc xem thử (demo):' : 'Bản demo — chọn tài khoản để xem:'}
              </div>
              {!showOtpFlow && !showTelegram && err && <div style={{ color: '#ffd7d7', fontSize: 13 }}>{err}</div>}
              <div className="demo-list">
                {ceo.map((u) => (
                  <div key={u.emp_code} className="demo-item" onClick={() => !busy && doDemoLogin(u.emp_code)}>
                    <div><b>{u.name}</b><div style={{ fontSize: 12, opacity: .8 }}>{u.emp_code}</div></div>
                    <span className="role-tag">{roleLabel(u.role)}</span>
                  </div>
                ))}
              </div>
              {sale.length > 0 && (
                <>
                  <div style={{ fontSize: 12, opacity: .8, margin: '14px 4px 6px' }}>Nhân viên Sale (xem phạm vi riêng):</div>
                  <div className="demo-list">
                    {sale.slice(0, 5).map((u) => (
                      <div key={u.emp_code} className="demo-item" onClick={() => !busy && doDemoLogin(u.emp_code)}>
                        <div><b>{u.name}</b><div style={{ fontSize: 12, opacity: .8 }}>{u.emp_code}</div></div>
                        <span className="role-tag">Sale</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      <ZaloOA />

      <p style={{ fontSize: 12, marginTop: 18, opacity: .7, textAlign: 'center' }}>
        {mode && (showOtpFlow || showTelegram) ? 'Đăng nhập theo tài khoản nhân viên · dữ liệu bảo mật theo phân quyền.'
          : 'Dữ liệu mẫu đã ẩn danh — không có PII/số liệu thật.'}
      </p>
      <p style={{ fontSize: 11, marginTop: 6, opacity: .5, textAlign: 'center' }}>
        Bản {typeof __BUILD_VER__ !== 'undefined' ? __BUILD_VER__ : 'dev'}
        {typeof __BUILD_AT__ !== 'undefined' ? ` · build ${__BUILD_AT__}` : ''}
      </p>
    </div>
  );
}

/* globals __BUILD_VER__, __BUILD_AT__ */
