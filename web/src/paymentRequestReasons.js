const EMPTY = Object.freeze({ schemaVersion: 0, early: [], reject: [] });
const NOTE_MAX_LENGTH = 300;

function normalizeOption(raw) {
  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
  if (!id || !label) return null;
  const requiresDetail = raw.requiresDetail === true;
  const minLength = requiresDetail && Number.isInteger(raw.minLength) ? raw.minLength : 0;
  if (requiresDetail && minLength < 5) return null;
  return { id, label, requiresDetail, minLength };
}

function normalizeGroup(rows) {
  if (!Array.isArray(rows)) return [];
  const options = rows.map(normalizeOption).filter(Boolean);
  const ids = new Set(options.map((option) => option.id));
  const detailOptions = options.filter((option) => option.requiresDetail);
  const other = options.find((option) => option.id === 'other');
  if (!options.length || ids.size !== options.length || detailOptions.length !== 1 || !other?.requiresDetail
    || paymentReasonDetailMaxLength(other) < other.minLength) return [];
  return options;
}

export function normalizePaymentRequestReasons(payload) {
  if (payload?.schemaVersion !== 1) return EMPTY;
  const early = normalizeGroup(payload.early);
  const reject = normalizeGroup(payload.reject);
  if (!early.length || !reject.length) return EMPTY;
  return { schemaVersion: 1, early, reject };
}

export function paymentReasonDetailMaxLength(option) {
  return Math.max(0, NOTE_MAX_LENGTH - `${String(option?.label || '')}: `.length);
}

export function composePaymentRequestNote(options, selectedId, detail = '') {
  const selected = Array.isArray(options) ? options.find((option) => option.id === selectedId) : null;
  if (!selected) return { ok: false, note: '', error: 'Chọn một lý do.' };
  if (!selected.requiresDetail) return { ok: true, note: selected.label, error: '' };
  const clean = String(detail || '').trim();
  const minLength = Math.max(5, Number(selected.minLength) || 5);
  const maxLength = paymentReasonDetailMaxLength(selected);
  if (clean.length < minLength) return { ok: false, note: '', error: `Ghi rõ ít nhất ${minLength} ký tự.` };
  if (clean.length > maxLength) return { ok: false, note: '', error: `Nội dung tối đa ${maxLength} ký tự.` };
  return { ok: true, note: `${selected.label}: ${clean}`, error: '' };
}
