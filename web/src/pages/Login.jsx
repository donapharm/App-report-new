import React, { useEffect, useState } from 'react';
import { api, setToken } from '../api.js';
import { roleLabel } from '../util.js';
import Logo from '../logo.jsx';

// QR Zalo OA DNPHARMA. Bỏ file thật vào web/public/zalo-oa-qr.png là tự hiện.
function ZaloOA() {
  const [ok, setOk] = useState(true);
  return (
    <div style={{ textAlign: 'center', marginTop: 22 }}>
      <div style={{ fontSize: 12.5, opacity: .85, marginBottom: 8 }}>Theo dõi Zalo OA DNPHARMA</div>
      <div style={{ display: 'inline-block', background: '#fff', padding: 6, borderRadius: 10 }}>
        {ok ? (
          <img src="/zalo-oa-qr.png" alt="Zalo OA DNPHARMA" width={76} height={76}
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

export default function Login({ onLogin }) {
  const [mode, setMode] = useState(null);        // { live, demo }
  const [demoUsers, setDemoUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // OTP flow state
  const [step, setStep] = useState('phone');     // phone | code
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    api.mode().then((m) => {
      setMode(m);
      if (m.demo) api.demoUsers().then(setDemoUsers).catch(() => {});
    }).catch(() => setMode({ live: false, demo: true }));
  }, []);

  async function finish(token) {
    setToken(token);
    const me = await api.me();
    onLogin(me);
  }

  async function doDemoLogin(emp_code) {
    setBusy(true); setErr('');
    try { const r = await api.login(emp_code); await finish(r.token); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

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
      setErr('Số điện thoại này có nhiều tài khoản — vui lòng liên hệ quản trị để cấu hình.');
      setBusy(false);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  const ceo = demoUsers.filter((u) => u.role !== 'sale');
  const sale = demoUsers.filter((u) => u.role === 'sale');

  return (
    <div className="login">
      <div style={{ marginBottom: 18 }}><Logo full /></div>
      <h1>App Report</h1>
      <p>Báo cáo doanh thu thông minh · DNPHARMA</p>

      {!mode ? null : (
        <>
          {/* ĐĂNG NHẬP THẬT: SĐT → OTP */}
          {mode.live && (
            <div className="card" style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff' }}>
              {step === 'phone' ? (
                <>
                  <div style={{ fontSize: 13, opacity: .9, marginBottom: 8 }}>Đăng nhập bằng số điện thoại</div>
                  <input type="tel" inputMode="numeric" placeholder="Số điện thoại"
                         value={phone} onChange={(e) => setPhone(e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && sendOtp()} style={{ marginBottom: 10 }} />
                  <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={sendOtp}>
                    {busy ? 'Đang gửi…' : 'Gửi mã OTP'}
                  </button>
                </>
              ) : (
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
              {err && <div style={{ color: '#ffd7d7', fontSize: 13, marginTop: 10 }}>{err}</div>}
            </div>
          )}

          {/* ĐĂNG NHẬP DEMO: chỉ hiện khi còn bật demo */}
          {mode.demo && (
            <div className="card" style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff' }}>
              <div style={{ fontSize: 13, opacity: .9, marginBottom: 4 }}>
                {mode.live ? 'Hoặc xem thử (demo):' : 'Bản demo — chọn tài khoản để xem:'}
              </div>
              {!mode.live && err && <div style={{ color: '#ffd7d7', fontSize: 13 }}>{err}</div>}
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
        {mode && mode.live ? 'Đăng nhập bằng SĐT nhân viên · dữ liệu bảo mật theo phân quyền.'
          : 'Dữ liệu mẫu đã ẩn danh — không có PII/số liệu thật.'}
      </p>
    </div>
  );
}
