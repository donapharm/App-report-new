import React, { useState } from 'react';

// Nguồn duy nhất: file logo chính thức đã được CEO duyệt trong web/public.
// Tuyệt đối không tự vẽ, không ghép biểu tượng/chữ thành một logo thay thế.
const OFFICIAL_LOGO = '/logo-dnpharma.png';

export default function Logo({ size = 30, full = false, className = '' }) {
  const [ok, setOk] = useState(true);
  const width = full ? 150 : Math.max(76, Math.round(size * 3.6));
  return (
    <span className={`official-logo${full ? ' official-logo-full' : ''}${className ? ` ${className}` : ''}`}>
      {ok ? (
        <img
          src={OFFICIAL_LOGO}
          alt="Logo chính thức DNPHARMA"
          width={width}
          style={{ width, height: 'auto', display: 'block' }}
          onError={() => setOk(false)}
        />
      ) : (
        <span className="official-logo-error" role="alert">Không tải được logo chính thức</span>
      )}
    </span>
  );
}
