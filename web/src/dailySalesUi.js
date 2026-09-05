export function dailySalesLoadFailure(error) {
  if (!error) return null;
  const code = String(error.code || 'DAILY_SALES_LOAD_FAILED').trim() || 'DAILY_SALES_LOAD_FAILED';
  return {
    code,
    message: 'Không tải được doanh số trong ngày.',
  };
}
