import React from 'react';

export function productQd(r = {}) {
  const explicit = String(r.qd || '').trim().toUpperCase().replace(/QD/g, 'QĐ');
  if (/^QĐ\s*\d+$/.test(explicit)) return `QĐ${explicit.replace(/\D/g, '')}`;
  const m = String(`${r.iit_code || ''} ${r.bid_package || ''}`).match(/QĐ\s*(\d+)|QD\s*(\d+)/i);
  if (m) return `QĐ${m[1] || m[2]}`;
  const bidDigits = String(r.bid_package || '').trim().replace(/\D/g, '');
  return bidDigits && bidDigits === String(r.bid_package || '').trim() ? `QĐ${bidDigits}` : '';
}

export function productQdClass(r = {}) {
  const qd = productQd(r);
  return qd === 'QĐ139' ? 'qd139-card' : (qd === 'QĐ141' ? 'qd141-card' : '');
}

export function productIngredientText(r = {}) {
  return [r.active_ingredient, r.ham_luong]
    .map((v) => String(v || '').trim())
    .filter((v) => v && v !== '—')
    .join(' · ');
}

export function shouldShowIngredient(r = {}, duplicateName = false) {
  const qd = productQd(r);
  if (qd === 'QĐ141') return false;
  const text = productIngredientText(r);
  return !!text && (qd === 'QĐ139' || duplicateName);
}

// Khối nhận diện dùng chung ở Doanh thu đầy đủ và Sản phẩm để các quy tắc
// QLNB/hoạt chất/QĐ141 không bị lệch giữa hai tab.
export default function ProductIdentity({ row, duplicateName = false, headingAside = null }) {
  const r = row || {};
  const qd = productQd(r);
  const ingredient = productIngredientText(r);
  return (
    <div className="product-identity">
      <div className="product-identity-title-line">
        <div className="detail-title">{r.product_name || '—'}</div>
        {headingAside}
      </div>
      <div className="detail-sub mono qlnb-line" title={r.iit_code || ''}>
        <span className={`qd-badge ${productQdClass(r)}`}>{qd || r.bid_package || '—'}</span>
        <span className="qlnb-code">{r.iit_code || '—'}</span>
      </div>
      {shouldShowIngredient(r, duplicateName) && (
        <div className="detail-sub product-ingredient" title={ingredient}>{ingredient}</div>
      )}
    </div>
  );
}
