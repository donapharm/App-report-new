import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dailySalesLoadFailure } from '../src/dailySalesUi.js';

const overview = fs.readFileSync(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');
const components = fs.readFileSync(new URL('../src/components.jsx', import.meta.url), 'utf8');

test('lỗi API doanh số ngày trở thành trạng thái lỗi có mã thay vì loading vô hạn', () => {
  assert.deepEqual(dailySalesLoadFailure({ code: 'UPSTREAM_TIMEOUT' }), {
    code: 'UPSTREAM_TIMEOUT',
    message: 'Không tải được doanh số trong ngày.',
  });
  assert.deepEqual(dailySalesLoadFailure(new Error('mất nguồn')), {
    code: 'DAILY_SALES_LOAD_FAILED',
    message: 'Không tải được doanh số trong ngày.',
  });
  assert.match(overview, /analysisError: analysisResult\.status === 'rejected'/);
  assert.match(overview, /<DailySalesKpi[^>]*error=\{analysisInsightsError\}[^>]*onRetry=\{reload\}/);
  assert.match(components, /if \(error\)[\s\S]*role="alert"[\s\S]*Mã lỗi:[\s\S]*Thử lại/);
});
