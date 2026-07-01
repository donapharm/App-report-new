import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';

const SUGGEST = ['Doanh thu kỳ này bao nhiêu?', 'Top sản phẩm', 'Top đơn vị', 'Tôi đạt bao nhiêu % target?', 'Cơ số thầu sắp cạn?'];

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
