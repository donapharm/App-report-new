// Reference implementation for reading xu from vat.db with better-sqlite3.
// Install in App Report-New server if chosen: npm i better-sqlite3

const Database = require('better-sqlite3');

const VAT_DB = process.env.VAT_DB_PATH || '/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/vat.db';
const XU_PER_500K = 1.3;
const XU_BASE_AMOUNT = 500000;

function readVatXu({ startDate, endDate, empCode } = {}) {
  const db = new Database(VAT_DB, { readonly: true, fileMustExist: true });
  const where = ["IFNULL(hidden_at, '') = ''", 'date(ngay) BETWEEN date(@startDate) AND date(@endDate)'];
  const params = { startDate, endDate };
  if (empCode) {
    where.push('emp_code = @empCode');
    params.empCode = empCode;
  }
  const sql = `
    SELECT
      emp_code,
      emp_name,
      COUNT(*) AS bill_count,
      SUM(COALESCE(NULLIF(tong_tien, 0), so_tien, 0)) AS amount,
      SUM(COALESCE(NULLIF(tong_tien, 0), so_tien, 0)) / ${XU_BASE_AMOUNT}.0 * ${XU_PER_500K} AS xu
    FROM vat_bills
    WHERE ${where.join(' AND ')}
    GROUP BY emp_code, emp_name
    ORDER BY emp_code
  `;
  try {
    return db.prepare(sql).all(params);
  } finally {
    db.close();
  }
}

module.exports = { readVatXu, VAT_DB, XU_PER_500K, XU_BASE_AMOUNT };

if (require.main === module) {
  console.log(readVatXu({ startDate: '2026-06-01', endDate: '2026-06-30' }));
}
