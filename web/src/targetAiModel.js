// Target AI là số tiền nguyên. Chỉ nhận chuỗi số thuần hoặc phân nhóm nghìn
// nhất quán bằng dấu chấm, dấu phẩy hay khoảng trắng. Không được "lọc bỏ" chữ
// rồi vô tình biến ô trống/chữ thành 0 hoặc một con số khác.
export function parseAiTargetInput(raw) {
  const text = String(raw ?? '').trim().replace(/\u00a0/g, ' ');
  if (!text) return { target: null, valid: false };

  const plainInteger = /^\d+$/.test(text);
  const groupedInteger = /^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/.test(text);
  if (!plainInteger && !groupedInteger) return { target: null, valid: false };

  const target = Number(text.replace(/[., ]/g, ''));
  if (!Number.isSafeInteger(target) || target < 0) return { target: null, valid: false };
  return { target, valid: true };
}
