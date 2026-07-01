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
      <div style={{ display: 'inline-block', background: '#fff', padding: 8, borderRadius: 14 }}>
        {ok ? (
          <img src="/zalo-oa-qr.png" alt="Zalo OA DNPHARMA" width={132} height={132}
               style={{ display: 'block', borderRadius: 8 }} onError={() => setOk(false)} />
        ) : (
          <div style={{ width: 132, height: 132, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: 10 }}>
            Đặt file<br /><b>zalo-oa-qr.png</b><br />vào web/public/
          </div>
        )}
      </div>
    </div>
  );
}

// Màn đăng nhập DEMO: chọn nhanh tài khoản mẫu.
// TODO(LIVE): thay bằng nhập SĐT → OTP → chọn mã NV (SSO/OTP nội bộ).
export default function Login({ onLogin }) {
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.demoUsers().then(setUsers).catch(() => {}); }, []);

  async function doLogin(emp_code) {
    setBusy(true); setErr('');
    try {
      const r = await api.login(emp_code);
      setToken(r.token);
      const me = await api.me();
      onLogin(me);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  const ceo = users.filter((u) => u.role !== 'sale');
  const sale = users.filter((u) => u.role === 'sale');

  return (
    <div className="login">
      <div style={{ marginBottom: 18 }}><Logo size={44} light wordmark /></div>
      <h1>App Report</h1>
      <p>Báo cáo doanh thu thông minh · DNPHARMA</p>

      <div className="card" style={{ background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: .9, marginBottom: 4 }}>Bản demo — chọn tài khoản để xem:</div>
        {err && <div style={{ color: '#ffd7d7', fontSize: 13 }}>{err}</div>}

        <div className="demo-list">
          {ceo.map((u) => (
            <div key={u.emp_code} className="demo-item" onClick={() => !busy && doLogin(u.emp_code)}>
              <div><b>{u.name}</b><div style={{ fontSize: 12, opacity: .8 }}>{u.emp_code}</div></div>
              <span className="role-tag">{roleLabel(u.role)}</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, opacity: .8, margin: '14px 4px 6px' }}>Nhân viên Sale (xem phạm vi riêng):</div>
        <div className="demo-list">
          {sale.slice(0, 5).map((u) => (
            <div key={u.emp_code} className="demo-item" onClick={() => !busy && doLogin(u.emp_code)}>
              <div><b>{u.name}</b><div style={{ fontSize: 12, opacity: .8 }}>{u.emp_code}</div></div>
              <span className="role-tag">Sale</span>
            </div>
          ))}
        </div>
      </div>

      <ZaloOA />

      <p style={{ fontSize: 12, marginTop: 18, opacity: .7, textAlign: 'center' }}>
        Dữ liệu mẫu đã ẩn danh — không có PII/số liệu thật.
      </p>
    </div>
  );
}
