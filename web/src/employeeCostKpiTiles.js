import React from 'react';

export const EMPLOYEE_COST_KPI_SOURCE_NOTE = 'Chưa lấy được tỷ lệ chi phí ở lượt này — số sẽ hiện lại khi nguồn trả lời. Doanh thu và bảng vẫn đúng.';

// Component nhỏ, không giữ số: chỉ khóa hành vi render của cụm KPI để payload
// thiếu cột không thể biến thành một `.map()` rỗng và mất cả cụm im lặng.
export function EmployeeCostKpiTiles({ items = [], fallback = false, renderTile }) {
  const tiles = Array.isArray(items) && typeof renderTile === 'function'
    ? items.map((item) => renderTile(item)) : [];
  return React.createElement(React.Fragment, null,
    fallback ? React.createElement('div', {
      className: 'employee-cost-match-warning employee-cost-kpi-source-note',
      role: 'status',
    }, EMPLOYEE_COST_KPI_SOURCE_NOTE) : null,
    ...tiles,
  );
}
