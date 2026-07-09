import React, { useState } from 'react';

/**
 * Logo DONAPHARM (dùng ảnh thật trong web/public/):
 *   - full=true  : logo lockup đầy đủ (logo-dnpharma.png) — dùng ở màn login.
 *   - mặc định   : biểu tượng DP (logo-mark.png) + chữ — dùng ở header/sidebar.
 * Nếu thiếu ảnh sẽ tự vẽ SVG capsule thay thế (không lỗi).
 */
function MarkSVG({ size, light }) {
  const blue = light ? '#ffffff' : '#1568b8';
  const orange = '#f5a11e';
  const s = size * 1.42;
  return (
    <svg width={s} height={size} viewBox="0 0 71 50" fill="none" aria-hidden style={{ flex: 'none' }}>
      <rect x="4.5" y="6.5" width="40" height="37" rx="18.5" fill="none" stroke={orange} strokeWidth="8" />
      <rect x="26.5" y="6.5" width="40" height="37" rx="18.5" fill="none" stroke={blue} strokeWidth="8" />
    </svg>
  );
}

export default function Logo({ size = 30, light = false, full = false }) {
  const [markOk, setMarkOk] = useState(true);
  const [fullOk, setFullOk] = useState(true);

  // Màn login: logo lockup đầy đủ, đặt trên thẻ trắng cho nổi trên nền xanh.
  if (full) {
    return fullOk ? (
      <span style={{ display: 'inline-block', background: '#fff', padding: '7px 11px', borderRadius: 11, boxShadow: '0 2px 9px rgba(0,0,0,.13)' }}>
        <img src="/logo-dnpharma.png" alt="DONAPHARM" style={{ display: 'block', width: 96, maxWidth: '32vw', height: 'auto' }} onError={() => setFullOk(false)} />
      </span>
    ) : (
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <MarkSVG size={size} light={light} />
        <b style={{ fontSize: size * 0.6, color: '#fff' }}>DONAPHARM</b>
      </span>
    );
  }

  // Header/sidebar: biểu tượng DP + chữ.
  const markImg = markOk ? (
    <span style={{ display: 'inline-flex', background: light ? '#fff' : 'transparent', padding: light ? 4 : 0, borderRadius: 8 }}>
      <img src="/logo-mark.png" alt="DP" height={size} style={{ height: size, width: 'auto', display: 'block' }} onError={() => setMarkOk(false)} />
    </span>
  ) : (
    <MarkSVG size={size} light={light} />
  );

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      {markImg}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.06 }}>
        <b style={{ fontSize: size * 0.58, letterSpacing: '.02em', color: light ? '#fff' : '#1568b8' }}>DONAPHARM</b>
        <span style={{ fontSize: size * 0.3, color: light ? 'rgba(255,255,255,.85)' : '#f5a11e', fontWeight: 700 }}>App Report</span>
      </span>
    </span>
  );
}
