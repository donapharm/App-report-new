import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { money, short } from '../util.js';
import { DrillNav } from '../drillNav.jsx';

const SUGGEST = ['Doanh thu kỳ này bao nhiêu?', 'Top sản phẩm', 'Top đơn vị', 'Tôi đạt bao nhiêu % target?', 'Cơ số thầu sắp cạn?'];

function priceText(g) {
  if (g == null) return null;
  return Array.isArray(g) ? g.map((v) => money(v)).join(' / ') : money(g);
}
function ProductCard({ p }) {
  return (
    <div className="lookup-card">
      <div className="lookup-title">📌 {p.ten} <span className="lookup-code">({p.ma}{p.ham_luong ? ` · ${p.ham_luong}` : ''})</span></div>
      <div className="lookup-facts">
        <span>Doanh thu: <b>{money(p.doanh_thu)}</b>{p.so_luong ? ` · SL ${(p.so_luong).toLocaleString('vi-VN')}` : ''}</span>
        {priceText(p.gia_thau) && <span>Giá thầu: <b>{priceText(p.gia_thau)}</b></span>}
        {p.con_lai != null && <span>Cơ số còn lại: <b>{(p.con_lai).toLocaleString('vi-VN')}{p.co_so_ban_dau ? `/${(p.co_so_ban_dau).toLocaleString('vi-VN')}` : ''}</b>{p.con_lai_pct != null ? ` (${p.con_lai_pct}%)` : ''}</span>}
      </div>
      {p.don_vi_dang_ban?.length > 0 && (
        <div className="lookup-chips">Đơn vị bán: {p.don_vi_dang_ban.map((u, i) => <span key={i} className="chip">{u.ten}: {short(u.doanh_thu)}</span>)}</div>
      )}
    </div>
  );
}
function UnitCard({ u, mine }) {
  return (
    <div className="lookup-card">
      <div className="lookup-title">🏥 {u.ten}</div>
      <div className="lookup-facts">
        <span>Doanh thu: <b>{money(u.doanh_thu)}</b>{u.so_luong ? ` · SL ${(u.so_luong).toLocaleString('vi-VN')}` : ''}</span>
        {u.so_dong_co_so ? <span>Cơ số: <b>{u.so_dong_co_so}</b> dòng{u.co_so_sap_can ? `, ${u.co_so_sap_can} sắp cạn` : ''}</span> : null}
      </div>
      {u.ai_ban?.length > 0 && (
        <div className="lookup-chips">{mine ? 'Bạn bán' : 'Ai bán'}: {u.ai_ban.map((e, i) => <span key={i} className="chip">{e.ten}: {short(e.doanh_thu)}</span>)}</div>
      )}
      {u.top_san_pham?.length > 0 && (
        <div className="lookup-chips">Top SP: {u.top_san_pham.map((s, i) => <span key={i} className="chip">{s.ten}: {short(s.doanh_thu)}</span>)}</div>
      )}
    </div>
  );
}
function LookupPanel({ mine }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  async function run() {
    const term = q.trim();
    if (term.length < 2 || busy) return;
    setBusy(true); setTouched(true);
    try { setData(await api.lookup(term)); } catch (e) { setData({ error: e.message, products: [], units: [] }); }
    setBusy(false);
  }
  const empty = touched && !busy && data && !data.error && !(data.products?.length) && !(data.units?.length);
  return (
    <div className="card lookup-panel">
      <div className="section-head">🔎 Tra cứu nhanh — thuốc / mã QLNB / đơn vị</div>
      <div className="lookup-bar">
        <input value={q} placeholder="Gõ tên thuốc, mã QLNB, hoặc mã/tên đơn vị… (VD: Paracetamol, QLNB102, BV007)"
               onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
        <button className="btn" onClick={run} disabled={busy || q.trim().length < 2}>{busy ? '…' : 'Tra cứu'}</button>
      </div>
      {data?.error && <div className="lookup-empty">Lỗi: {data.error}</div>}
      {empty && <div className="lookup-empty">Không tìm thấy thuốc/đơn vị khớp. Thử gõ đúng tên hoặc mã.</div>}
      {data && !data.error && (data.products?.length > 0 || data.units?.length > 0) && (
        <div className="lookup-results">
          {data.products?.map((p, i) => <ProductCard key={'p' + i} p={p} />)}
          {data.units?.map((u, i) => <UnitCard key={'u' + i} u={u} mine={mine} />)}
        </div>
      )}
    </div>
  );
}

export default function AiChat({ me }) {
  const [msgs, setMsgs] = useState([
    { who: 'bot', text: `Chào ${me.name}. Hỏi nhanh về doanh thu, đơn vị, sản phẩm, cơ số thầu, target. Số liệu do hệ thống tính, không phải AI đoán.`, lines: [] },
  ]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  async function send(q) {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText(''); setBusy(true);
    setMsgs((m) => [...m, { who: 'me', text: question }]);
    try {
      const a = await api.ask(question);
      setMsgs((m) => [...m, { who: 'bot', text: a.text, lines: a.lines || [], src: a.source }]);
    } catch (e) {
      setMsgs((m) => [...m, { who: 'bot', text: 'Lỗi: ' + e.message, lines: [] }]);
    }
    setBusy(false);
  }

  return (
    <>
      <DrillNav crumbs={[{ label: 'Hỏi nhanh' }]} onReload={() => setMsgs([{ who: 'bot', text: `Chào ${me.name}. Hỏi nhanh về doanh thu, đơn vị, sản phẩm, cơ số thầu, target. Số liệu do hệ thống tính, không phải AI đoán.`, lines: [] }])} busy={busy} />
      <LookupPanel mine={!me.isAdmin} />
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={'msg ' + (m.who === 'me' ? 'me' : 'bot')}>
            <div>{m.text}</div>
            {m.lines?.map((l, j) => <div key={j} className="line">{l}</div>)}
            {m.src === 'code' && <div className="src">✓ Số liệu từ hệ thống</div>}
            {m.src === 'llm' && <div className="src">🤖 AI diễn giải · số từ hệ thống</div>}
          </div>
        ))}
        {busy && <div className="msg bot">Đang tính…</div>}
        <div ref={endRef} />
      </div>

      <div style={{ height: 120 }} />
      <div className="ask-bar">
        <div style={{ flex: 1 }}>
          <div className="suggest">
            {SUGGEST.filter((s) => me.isAdmin || !/nhân viên/i.test(s)).slice(0, 3).map((s) => (
              <button key={s} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
          <input value={text} placeholder="Nhập câu hỏi… (gõ có dấu hay không dấu đều được)"
                 onChange={(e) => setText(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && send()} />
        </div>
        <button className="btn" onClick={() => send()} disabled={busy}>Gửi</button>
      </div>
    </>
  );
}
