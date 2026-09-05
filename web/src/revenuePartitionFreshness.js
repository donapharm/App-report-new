const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function freshnessDate(value) {
  const date = String(value || '').slice(0, 10);
  if (!ISO_DATE.test(date)) return '—';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function partitionFreshnessWarning(generations) {
  const appWeb = String(generations?.APP_WEB?.dataThrough || '').slice(0, 10);
  const debts = String(generations?.DEBTS_DONA_AFP?.dataThrough || '').slice(0, 10);
  if (!ISO_DATE.test(appWeb) || !ISO_DATE.test(debts) || appWeb === debts) return null;
  const stale = appWeb < debts
    ? { label: 'APP_WEB', date: appWeb }
    : { label: 'DONA+AFP', date: debts };
  const fresh = appWeb > debts
    ? { label: 'APP_WEB', date: appWeb }
    : { label: 'DONA+AFP', date: debts };
  return Object.freeze({ stale, fresh,
    text: `⚠ Dữ liệu lệch ngày: ${stale.label} còn cũ, mới đến ${freshnessDate(stale.date)}; ${fresh.label} đến ${freshnessDate(fresh.date)}.` });
}
