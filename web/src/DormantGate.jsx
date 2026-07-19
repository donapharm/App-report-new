import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { money } from './util.js';

const STATUS_OPTIONS = [
  ['', 'Chọn kết quả xử lý…'],
  ['contacted', '📞 Đã liên hệ đơn vị'],
  ['scheduled', '📅 Đã lên lịch liên hệ'],
  ['waiting_forecast', '🏥 Đơn vị đang chờ dự trù'],
  ['expected_order', '📦 Đơn vị dự kiến có đơn'],
  ['blocked', '⚠️ Vướng thầu, cơ số hoặc hàng hóa'],
  ['no_demand', '⏸️ Đơn vị đã ngưng nhu cầu'],
  ['inactive_assignment', '🔄 Không còn đúng người phụ trách'],
  ['other', '📝 Lý do khác'],
];
const NEED_DATE = new Set(STATUS_OPTIONS.map(([value]) => value).filter(Boolean));
const NEED_NOTE = new Set(['blocked', 'no_demand', 'inactive_assignment', 'other']);
const fmt = (v, digits = 2) => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: digits });
const dateVi = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (v || '—');
};
function nextDay(v) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? new Date(`${v}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function itemId(item) { return item.key || item.id || `${item.emp_code}|${item.unit_code}|${item.iit_code}`; }
function initialForm(items = [], today = '', defaultFollowUp = '') {
  return Object.fromEntries(items.map((item) => {
    const a = item.action || item.current_action || {};
    const savedFollow = String(a.next_follow_up || '');
    const nextFollow = savedFollow && (!today || savedFollow > today) ? savedFollow : defaultFollowUp;
    return [itemId(item), { status: a.status || '', next_follow_up: nextFollow, note: a.note || '' }];
  }));
}
function complete(value = {}, today = '', maxFollowUp = '') {
  if (!value.status) return false;
  if (NEED_DATE.has(value.status) && (!value.next_follow_up || (today && value.next_follow_up <= today) || (maxFollowUp && value.next_follow_up > maxFollowUp))) return false;
  if (NEED_NOTE.has(value.status) && String(value.note || '').trim().length < 3) return false;
  return true;
}

function XuStrip({ data }) {
  if (!data?.score) return null;
  const s = data.score;
  const a = data.adjustment || {};
  return <section className="dormant-xu-card">
    <div className="dormant-section-title"><span>🪙 Nhịp Xu tuần này</span><small>{dateVi(data.ranges?.week?.from)}–{dateVi(data.ranges?.week?.to)}</small></div>
    <div className="dormant-xu-grid">
      <span><em>Xu tuần thực</em><b>{fmt(s.xu_tuan_thuc)}</b></span>
      <span><em>Điểm / Xu quý</em><b>{fmt(s.diem_quy)} / {fmt(s.xu_quy)}</b></span>
      <span className={s.thieu_xu_quy > 0 ? 'warn' : 'ok'}><em>Xu thiếu quý</em><b>{fmt(s.thieu_xu_quy)}</b></span>
      <span className={a.quarter_total_estimated > 0 ? 'danger' : 'ok'}><em>Điều chỉnh tạm tính</em><b>{money(a.quarter_total_estimated || 0)}</b></span>
    </div>
    {s.thieu_xu_quy > 0 && <p><b>Nếu chốt tại thời điểm này:</b> số tiền điều chỉnh chi phí bán hàng quý đang tạm tính {money(a.quarter_total_estimated || 0)}. Cuối quý sẽ đối trừ phần đã ghi nhận để không tính hai lần.</p>}
    <p className="dormant-spend-note">{data.warning?.wording}</p>
  </section>;
}

function DormantItem({ item, value, onChange, index, minFollowUp, maxFollowUp }) {
  const reasons = item.reasons || item.priority_reasons || [];
  return <article className="dormant-item">
    <div className="dormant-item-head">
      <span className="dormant-rank">{index + 1}</span>
      <div><b>{item.product_name || item.iit_code || 'Mã QLNB'}</b><code>{item.iit_code || '—'}</code></div>
      <strong>{Number(item.days_idle || 0).toLocaleString('vi-VN')} ngày</strong>
    </div>
    <div className="dormant-unit">🏥 {item.unit_name || item.unit_code || '—'} <small>· Mã đơn vị: {item.unit_code || '—'} · {item.route || '—'}</small></div>
    <div className="dormant-facts">
      <span>Đơn gần nhất <b>{dateVi(item.last_order_date || item.last_activity_date)}</b></span>
      <span>Cách tính <b>{item.date_precision === 'month' ? 'Theo tháng tổng hợp' : 'Theo ngày'}</b></span>
      {item.remain_qty != null && <span>Cơ số còn <b>{Number(item.remain_qty || 0).toLocaleString('vi-VN')}</b></span>}
    </div>
    <div className="dormant-ai-reason">🎯 {item.selection_reason === 'follow_up_due' ? `Đến hạn review · Chu kỳ ${Number(item.action?.cycle || 1)}` : 'Chưa có kế hoạch xử lý hợp lệ'}</div>
    {!!reasons.length && <div className="dormant-ai-reason">🤖 {reasons.slice(0, 3).join(' · ')}</div>}
    <div className="dormant-action-grid">
      <label><span>Kết quả xử lý *</span><select value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })}>{STATUS_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label><span>Ngày review lại · tối đa 14 ngày{NEED_DATE.has(value.status) ? ' *' : ''}</span><input type="date" min={minFollowUp} max={maxFollowUp} value={value.next_follow_up} onChange={(e) => onChange({ ...value, next_follow_up: e.target.value })} /></label>
      <label className="dormant-note"><span>Ghi chú{NEED_NOTE.has(value.status) ? ' *' : ''}</span><input value={value.note} maxLength={300} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder="VD: Khoa Dược chờ duyệt dự trù…" /></label>
    </div>
  </article>;
}

export default function DormantGate({ me, tab }) {
  const eligible = !!me && !me.isAdmin && ['revenue', 'analysis', 'revenueFull'].includes(tab);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const items = data?.required_items || data?.items || [];
  const minFollowUp = nextDay(data?.generated_on);
  const maxFollowUp = data?.follow_up_max || '';

  useEffect(() => {
    if (!eligible) { setData(null); return; }
    let cancelled = false;
    setError('');
    api.dormantGate({ source: tab }).then((result) => {
      if (cancelled) return;
      setData(result);
      setForm(initialForm(result.required_items || result.items || [], result.generated_on, result.follow_up_max));
    }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [eligible, tab]);

  const ready = useMemo(() => items.length > 0 && items.every((item) => complete(form[itemId(item)], data?.generated_on, data?.follow_up_max)), [items, form, data?.generated_on, data?.follow_up_max]);
  if (!eligible || !data?.must_answer || !items.length) return null;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.dormantActions({
        source: tab,
        checkpoint_key: data.checkpoint_key,
        actions: items.map((item) => ({ key: itemId(item), ...form[itemId(item)] })),
      });
      const next = result.gate || result;
      setData(next);
      setForm(initialForm(next.required_items || next.items || [], next.generated_on, next.follow_up_max));
      requestAnimationFrame(() => { const body = document.querySelector('.dormant-gate-body'); if (body) body.scrollTop = 0; });
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return <div className="dormant-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="dormant-gate-title">
    <div className="dormant-gate-card">
      <header className="dormant-gate-head">
        <div><span>AI CANH CỬA · VIỆC CẦN LÀM</span><h2 id="dormant-gate-title">QLNB đủ 60 ngày chưa có đơn trở lại</h2></div>
        <div className="dormant-count"><b>{Number(data.focus_unit?.eligible_total || items.length).toLocaleString('vi-VN')}</b><small>QLNB tại đơn vị ưu tiên</small></div>
      </header>
      <div className="dormant-gate-body">
        <XuStrip data={data.xu} />
        <div className="dormant-intro"><b>Đơn vị ưu tiên: {data.focus_unit?.unit_name || data.focus_unit?.unit_code} · Mã {data.focus_unit?.unit_code}</b><span>Lô {data.focus_unit?.batch_number || 1}: lập kế hoạch cho {items.length} QLNB. Xong lô này, App tiếp tục QLNB còn lại của đúng đơn vị; mỗi kế hoạch được review trong tối đa 14 ngày.</span></div>
        {items.map((item, index) => <DormantItem key={itemId(item)} item={item} index={index} minFollowUp={minFollowUp} maxFollowUp={maxFollowUp} value={form[itemId(item)] || { status: '', next_follow_up: '', note: '' }} onChange={(value) => setForm((old) => ({ ...old, [itemId(item)]: value }))} />)}
        {error && <div className="dormant-error">{error}</div>}
      </div>
      <footer className="dormant-gate-foot">
        <span>🔒 AI lưu từng chu kỳ, review sau tối đa 14 ngày và tự đóng khi có đơn dương trở lại.</span>
        <button type="button" className="btn" disabled={!ready || busy} onClick={submit}>{busy ? 'Đang lưu…' : (data.focus_unit?.remaining_after_batch > 0 ? `Lưu và xem ${Math.min(5, data.focus_unit.remaining_after_batch)} QLNB tiếp theo` : 'Hoàn tất đơn vị và xem báo cáo')}</button>
      </footer>
    </div>
  </div>;
}
