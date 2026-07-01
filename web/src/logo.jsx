import React, { useState } from 'react';

/**
 * Logo DNPHARMA.
 * - Mặc định: mark SVG (2 vòng capsule lồng nhau xanh–cam) — hiển thị ngay, không cần file.
 * - Nếu bỏ file thật vào web/public/logo-dnpharma.png thì tự dùng ảnh đó (đẹp/chuẩn hơn).
 * TODO(BRAND): thay logo-dnpharma.png bằng file logo chính thức (nền trong suốt, dạng icon/mark vuông).
 */
function Mark({ size, light }) {
  const blue = light ? '#ffffff' : 'var(--brand)';
  const orange = 'var(--accent)';
  const w = size * 1.35;
  return (
    <svg width={w} height={size} viewBox="0 0 68 50" fill="none" aria-hidden style={{ flex: 'none' }}>
      <rect x="4" y="7" width="38" height="36" rx="18" fill="none" stroke={orange} strokeWidth="7.5" />
      <rect x="26" y="7" width="38" height="36" rx="18" fill="none" stroke={blue} strokeWidth="7.5" />
    </svg>
  );
}

export default function Logo({ size = 30, light = false, wordmark = true }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      {imgOk ? (
        <img
          src="/logo-dnpharma.png"
          alt="DNPHARMA"
          height={size + 6}
          style={{ maxHeight: size + 8, width: 'auto', objectFit: 'contain' }}
          onError={() => setImgOk(false)}
        />
      ) : (
        <Mark size={size} light={light} />
      )}
      {wordmark && !imgOk && (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
          <b style={{ fontSize: size * 0.52, letterSpacing: '.01em', color: light ? '#fff' : 'var(--brand)' }}>DNPHARMA</b>
          <span style={{ fontSize: size * 0.3, color: light ? 'rgba(255,255,255,.85)' : 'var(--accent-2)', fontWeight: 700 }}>App Report</span>
        </span>
      )}
    </span>
  );
}
