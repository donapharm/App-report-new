import React, { useEffect, useRef, useState } from 'react';
import { api, setToken } from '../api.js';
import { roleLabel } from '../util.js';
import Logo from '../logo.jsx';

// QR Zalo OA DONAPHARM. Bỏ file thật vào web/public/zalo-oa-qr.png là tự hiện.
function ZaloOA() {
  const [ok, setOk] = useState(true);
  return (
    <div style={{ textAlign: 'center', marginTop: 22 }}>
      <div style={{ fontSize: 12.5, opacity: .85, marginBottom: 8 }}>Theo dõi Zalo OA DONAPHARM</div>
      <div style={{ display: 'inline-block', background: '#fff', padding: 6, borderRadius: 10 }}>
        {ok ? (
          <img src="/zalo-oa-qr.png" alt="Zalo OA DONAPHARM" width={76} height={76}
               style={{ display: 'block', borderRadius: 6 }} onError={() => setOk(false)} />
        ) : (
          <div style={{ width: 76, height: 76, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: 10 }}>
            Đặt file<br /><b>zalo-oa-qr.png</b><br />vào web/public/
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle = { background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff' };

export default function Login({ onLogin }) {
  const [mode, setMode] = useState(null);        // { live, demo, telegram }
  const [demoUsers, setDemoUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showOtp, setShowOtp] = useState(false); // mở form SĐT/OTP (dự phòng)

  // Telegram flow
  const [tg, setTg] = useState(null);            // { login_code, poll_secret, bot_link }
  const [tgLeft, setTgLeft] = useState(0);       // đếm ngược giây
  const [tgErr, setTgErr] = useState('');
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  // OTP flow
  const [step, setStep] = useState('phone');     // phone | code | choose
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    api.mode().then((m) => {
      setMode(m);
      if (m.demo) api.demoUsers().then(setDemoUsers).catch(() => {});
    }).catch(() => setMode({ live: false, demo: true, telegram: false }));
    return () => stopTelegram();
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
    try { await api.otpRequest(p); setStep('code'); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function verifyOtp() {
    setBusy(true); setErr('');
    try {
      const r = await api.otpVerify(phone.trim(), code.trim());
      if (r.token) { await finish(r.token); return; }
      if (r.accounts && r.accounts.length) { setAccounts(r.accounts); setStep('choose'); setBusy(false); return; }
      setErr('Không xác định được tài khoản.'); setBusy(false);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  async function pickAccount(emp_code) {
    setBusy(true); setErr('');
    try { const r = await api.otpSelect(phone.trim(), emp_code); await finish(r.token); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  const ceo = demoUsers.filter((u) => u.role !== 'sale');
  const sale = demoUsers.filter((u) => u.role === 'sale');
  const showTelegram = mode && mode.telegram;
  const showOtpFlow = mode && mode.live;

  return (
    <div className="login">
      <div style={{ marginBottom: 16 }}><Logo full /></div>
      <h1>Đăng nhập App Report</h1>
      <p>Xem doanh thu, target, cơ số thầu theo quyền được phân công.</p>

      {!mode ? null : (
        <>
          {/* (1) ĐĂNG NHẬP TELEGRAM — CHÍNH */}
          {showTelegram && (
            <div className="card" style={cardStyle}>
              {!tg ? (
                <>
                  <div style={{ fontSize: 13, opacity: .92, marginBottom: 10 }}>
                    Đăng nhập nhanh & an toàn qua <b>Telegram</b>.
                  </div>
                  <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={startTelegram}>
                    {busy ? 'Đang tạo mã…' : '✈️  Đăng nhập bằng Telegram'}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, opacity: .92, marginBottom: 8 }}>Gửi mã này cho Report Bot trên Telegram rồi bấm ✅ xác nhận:</div>
                  <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, textAlign: 'center',
                                background: 'rgba(255,255,255,.16)', borderRadius: 10, padding: '10px 0', marginBottom: 8 }}>
                    {tg.login_code}
                  </div>
                  {tg.bot_link && (
                    <a href={tg.bot_link} target="_blank" rel="noreferrer"
                       className="btn" style={{ width: '100%', display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: 8 }}>
                      Mở Report Bot ›
                    </a>
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

          {/* (2) ĐĂNG NHẬP SĐT / OTP ZALO — DỰ PHÒNG */}
          {showOtpFlow && (
            <div className="card" style={cardStyle}>
              {!showOtp && showTelegram ? (
                <button className="btn ghost" style={{ width: '100%' }} onClick={() => setShowOtp(true)}>
                  Hoặc đăng nhập bằng SĐT (OTP Zalo)
                </button>
              ) : (
                <>
                  {step === 'phone' && (
                    <>
                      <div style={{ fontSize: 13, opacity: .9, marginBottom: 8 }}>Đăng nhập bằng số điện thoại</div>
                      <input type="tel" inputMode="numeric" placeholder="Số điện thoại"
                             value={phone} onChange={(e) => setPhone(e.target.value)}
                             onKeyDown={(e) => e.key === 'Enter' && sendOtp()} style={{ marginBottom: 10 }} />
                      <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={sendOtp}>
                        {busy ? 'Đang gửi…' : 'Gửi mã OTP'}
                      </button>
                    </>
                  )}
                  {step === 'code' && (
                    <>
                      <div style={{ fontSize: 13, opacity: .9, marginBottom: 8 }}>Nhập mã OTP gửi tới {phone}</div>
                      <input inputMode="numeric" placeholder="Mã OTP" value={code}
                             onChange={(e) => setCode(e.target.value)}
                             onKeyDown={(e) => e.key === 'Enter' && verifyOtp()} style={{ marginBottom: 10 }} />
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
                </>
              )}
            </div>
          )}

          {/* ĐĂNG NHẬP DEMO: chỉ hiện khi còn bật demo */}
          {mode.demo && (
            <div className="card" style={cardStyle}>
              <div style={{ fontSize: 13, opacity: .9, marginBottom: 4 }}>
                {mode.live || showTelegram ? 'Hoặc xem thử (demo):' : 'Bản demo — chọn tài khoản để xem:'}
              </div>
              {!mode.live && !showTelegram && err && <div style={{ color: '#ffd7d7', fontSize: 13 }}>{err}</div>}
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
        {mode && (mode.live || showTelegram) ? 'Đăng nhập theo tài khoản nhân viên · dữ liệu bảo mật theo phân quyền.'
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
