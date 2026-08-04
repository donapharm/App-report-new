import React from 'react';

/**
 * TẢI BIỂU ĐỒ THEO NHU CẦU — CEO duyệt 04/08.
 *
 * `recharts` nặng **163KB sau nén**, trước đây nằm thẳng trong gói chính nên MỌI
 * trang đều phải tải, kể cả những trang không vẽ biểu đồ nào (Chi phí, Thanh toán,
 * Cơ số thầu…). Nay nó thành một gói riêng, chỉ tải khi thật sự có biểu đồ cần vẽ.
 *
 * Khung xương giữ đúng chỗ trong lúc chờ ⇒ trang KHÔNG bị giật/nhảy layout.
 * Số liệu không đổi một đồng nào — đây thuần tuý là chuyện tải file.
 */
const loadCharts = () => import('./charts.jsx');

function ChartSkeleton({ height }) {
  return <div className="chart-skeleton" aria-busy="true" aria-label="Đang tải biểu đồ"
    style={{ height, borderRadius: 8, background: 'rgba(127,127,127,.08)' }} />;
}

function lazyChart(name, fallbackHeight) {
  const Loaded = React.lazy(() => loadCharts().then((module) => ({ default: module[name] })));
  function LazyChart(props) {
    return <React.Suspense fallback={<ChartSkeleton height={fallbackHeight} />}>
      <Loaded {...props} />
    </React.Suspense>;
  }
  LazyChart.displayName = `Lazy(${name})`;
  return LazyChart;
}

export const RevenueTrendChart = lazyChart('RevenueTrendChart', 260);
export const TopBarChart = lazyChart('TopBarChart', 320);
export const TargetGauge = lazyChart('TargetGauge', 140);
export const DonutChart = lazyChart('DonutChart', 260);
