import React from 'react';

// Logo Donapharm (placeholder dạng SVG). TODO(BRAND): thay bằng file logo chính thức.
export default function Logo({ size = 30, light = false }) {
  const fg = light ? '#ffffff' : '#0b5e4f';
  const accent = light ? '#8fe3cf' : '#12876f';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <rect x="3" y="3" width="42" height="42" rx="12" fill={fg} />
        <path d="M24 13v22M13 24h22" stroke={light ? '#0b5e4f' : '#fff'} strokeWidth="5.5" strokeLinecap="round" />
        <circle cx="34" cy="14" r="4.5" fill={accent} />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <b style={{ fontSize: size * 0.5, letterSpacing: '.02em', color: light ? '#fff' : fg }}>DONAPHARM</b>
        <span style={{ fontSize: size * 0.3, color: light ? 'rgba(255,255,255,.8)' : 'var(--muted)', fontWeight: 600 }}>App Report</span>
      </span>
    </span>
  );
}
