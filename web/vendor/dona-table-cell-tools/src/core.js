const INSTANCES = new WeakMap();

export const VERSION = '1.0.0';
export const DEFAULT_LINES = 3;
export const LINE_OPTIONS = Object.freeze([1, 2, 3, 'all']);
export const DEFAULT_EXCLUDE_SELECTOR = [
  '[data-cell-action]',
  '[data-no-cell-preview]',
  '[data-sensitive]',
  '.col-act',
  '.grid-empty'
].join(',');
export const DEFAULT_INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-cell-action]',
  '[data-no-cell-preview]',
  '[data-sensitive]'
].join(',');

export function normalizeLines(value, fallback = DEFAULT_LINES) {
  if (value === 'all') return 'all';
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 || numeric === 3 ? numeric : fallback;
}

export function storageKey(appId, tableId) {
  const app = String(appId || 'app').trim() || 'app';
  const table = String(tableId || 'table').trim() || 'table';
  return `dona.table-cell-tools.v1:${encodeURIComponent(app)}:${encodeURIComponent(table)}:lines`;
}

export function readStoredLines(storage, key, fallback = DEFAULT_LINES) {
  if (!storage || typeof storage.getItem !== 'function') return fallback;
  try { return normalizeLines(storage.getItem(key), fallback); } catch { return fallback; }
}

export function writeStoredLines(storage, key, lines) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try { storage.setItem(key, String(normalizeLines(lines))); return true; } catch { return false; }
}

export function isMountableRoot(root) {
  return Boolean(root && root.nodeType === 1 && typeof root.addEventListener === 'function' && typeof root.contains === 'function');
}

export function isInteractiveTarget(target, selector = DEFAULT_INTERACTIVE_SELECTOR) {
  return Boolean(target?.closest?.(selector));
}

export function canActivateCell(cell, target = cell, options = {}) {
  if (!cell || typeof cell.matches !== 'function') return false;
  const cellSelector = options.cellSelector || 'td';
  const excludeSelector = options.excludeSelector || DEFAULT_EXCLUDE_SELECTOR;
  const interactiveSelector = options.interactiveSelector || DEFAULT_INTERACTIVE_SELECTOR;
  if (!cell.matches(cellSelector) || cell.matches(excludeSelector)) return false;
  if (cell.closest?.('[data-no-cell-preview],[data-sensitive]')) return false;
  if (cell.querySelector?.(interactiveSelector)) return false;
  const interactive = target?.closest?.(interactiveSelector);
  return !interactive || !cell.contains?.(interactive);
}

export function getCellValue(cell) {
  if (!cell) return '';
  const explicit = cell.getAttribute?.('data-full-value');
  if (explicit !== null && explicit !== undefined) return String(explicit);
  return String(cell.innerText ?? cell.textContent ?? '');
}

export function resolveIdentity(root, options = {}) {
  const table = root.matches?.('table') ? root : root.querySelector?.('table');
  return {
    appId: options.appId || root.getAttribute?.('data-app-id') || 'app',
    tableId: options.tableId || root.getAttribute?.('data-table-id') || table?.id || root.id || 'table'
  };
}

function resolveRoot(rootOrSelector, doc) {
  if (typeof rootOrSelector === 'string') return doc?.querySelector?.(rootOrSelector) || null;
  return rootOrSelector || null;
}

function safeStorage(win, supplied) {
  if (supplied !== undefined) return supplied;
  try { return win?.localStorage || null; } catch { return null; }
}

function closestCell(target, root, selector) {
  const cell = target?.closest?.(selector);
  return cell && root.contains(cell) ? cell : null;
}

function setButtonText(button, lines) {
  button.textContent = lines === 'all' ? 'Tất cả' : String(lines);
}

function createLineControl(doc, current, onChange, labels) {
  const group = doc.createElement('div');
  group.className = 'dona-cell-tools-lines';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', labels.lineChoice);
  const prefix = doc.createElement('span');
  prefix.className = 'dona-cell-tools-lines-label';
  prefix.textContent = labels.lines;
  group.append(prefix);
  for (const option of LINE_OPTIONS) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'dona-cell-tools-line-button';
    button.dataset.lines = String(option);
    setButtonText(button, option);
    button.setAttribute('aria-pressed', String(option === current));
    button.addEventListener('click', () => onChange(option));
    group.append(button);
  }
  return group;
}

export function mount(rootOrSelector, options = {}) {
  const doc = options.document || globalThis.document;
  const root = resolveRoot(rootOrSelector, doc);
  if (!isMountableRoot(root)) throw new TypeError('dona-table-cell-tools: root must be a DOM Element or a selector matching one');
  if (INSTANCES.has(root)) return INSTANCES.get(root);

  const win = options.window || doc?.defaultView || globalThis.window;
  const identity = resolveIdentity(root, options);
  const key = storageKey(identity.appId, identity.tableId);
  const storage = safeStorage(win, options.storage);
  const cellSelector = options.cellSelector || 'td';
  const labels = {
    lines: 'Số dòng:', lineChoice: 'Số dòng hiển thị trong ô', dialog: 'Nội dung đầy đủ của ô',
    copy: 'Sao chép', close: 'Đóng', empty: '—', ...(options.labels || {})
  };
  let lines = options.lines == null ? readStoredLines(storage, key) : normalizeLines(options.lines);
  let activeCell = null;
  let popover = null;
  let observer = null;
  let lastFocus = null;

  root.classList.add('dona-cell-tools');

  const applyLines = () => {
    root.dataset.cellLines = String(lines);
    if (lines === 'all') root.style.removeProperty('--dona-cell-lines');
    else root.style.setProperty('--dona-cell-lines', String(lines));
    if (control) for (const button of control.querySelectorAll('[data-lines]')) {
      button.setAttribute('aria-pressed', String(button.dataset.lines === String(lines)));
    }
  };

  const setLines = (next, persist = true) => {
    lines = normalizeLines(next, lines);
    applyLines();
    if (persist) writeStoredLines(storage, key, lines);
    root.dispatchEvent?.(new (win?.CustomEvent || CustomEvent)('dona-cell-tools:lines', { detail: { lines } }));
    return lines;
  };

  const control = options.showLineControl === false ? null : createLineControl(doc, lines, setLines, labels);
  if (control) {
    const host = typeof options.controlHost === 'string' ? doc.querySelector(options.controlHost) : options.controlHost;
    (host && typeof host.append === 'function' ? host : root).prepend(control);
  }
  applyLines();

  const syncFocusable = (scope = root) => {
    const cells = [];
    if (scope.matches?.(cellSelector)) cells.push(scope);
    for (const cell of scope.querySelectorAll?.(cellSelector) || []) cells.push(cell);
    const ancestor = scope.closest?.(cellSelector);
    if (ancestor && root.contains(ancestor) && !cells.includes(ancestor)) cells.push(ancestor);
    for (const cell of cells) {
      if (canActivateCell(cell, cell, options)) {
        if (!cell.hasAttribute('tabindex')) {
          cell.setAttribute('tabindex', '0');
          cell.setAttribute('data-dona-owned-tabindex', '');
        }
      } else if (cell.hasAttribute('data-dona-owned-tabindex')) {
        cell.removeAttribute('tabindex');
        cell.removeAttribute('data-dona-owned-tabindex');
      }
    }
  };
  syncFocusable();
  if (typeof win?.MutationObserver === 'function') {
    observer = new win.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) if (node.nodeType === 1) syncFocusable(node);
        if (record.target?.nodeType === 1) syncFocusable(record.target);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  const close = ({ restoreFocus = false } = {}) => {
    if (!popover) return;
    popover.remove();
    popover = null;
    activeCell?.removeAttribute?.('aria-expanded');
    activeCell = null;
    if (restoreFocus && lastFocus?.isConnected) lastFocus.focus?.();
  };

  const copyText = async (value) => {
    try {
      if (!win?.navigator?.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await win.navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const area = doc.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.className = 'dona-cell-tools-copy-fallback';
        doc.body.append(area);
        area.select();
        const ok = doc.execCommand?.('copy') !== false;
        area.remove();
        return ok;
      } catch { return false; }
    }
  };

  const open = (cell) => {
    if (!canActivateCell(cell, cell, options) || !root.contains(cell)) return false;
    if (activeCell === cell && popover) { close({ restoreFocus: true }); return false; }
    close();
    activeCell = cell;
    lastFocus = doc.activeElement;
    const value = getCellValue(cell);
    const rect = cell.getBoundingClientRect();
    popover = doc.createElement('div');
    popover.className = 'dona-cell-tools-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', labels.dialog);
    popover.setAttribute('aria-modal', win?.matchMedia?.('(max-width: 639px)').matches ? 'true' : 'false');
    popover.style.setProperty('--dona-anchor-left', `${rect.left}px`);
    popover.style.setProperty('--dona-anchor-top', `${rect.bottom + 6}px`);

    const body = doc.createElement('div');
    body.className = 'dona-cell-tools-popover-value';
    body.textContent = value || labels.empty;
    const actions = doc.createElement('div');
    actions.className = 'dona-cell-tools-popover-actions';
    const copy = doc.createElement('button');
    copy.type = 'button'; copy.className = 'dona-cell-tools-button'; copy.textContent = labels.copy;
    copy.addEventListener('click', () => copyText(value));
    const closeButton = doc.createElement('button');
    closeButton.type = 'button'; closeButton.className = 'dona-cell-tools-button is-secondary'; closeButton.textContent = labels.close;
    closeButton.addEventListener('click', () => close({ restoreFocus: true }));
    actions.append(copy, closeButton);
    popover.append(body, actions);
    doc.body.append(popover);
    cell.setAttribute('aria-expanded', 'true');
    closeButton.focus();
    return true;
  };

  const onClick = (event) => {
    const cell = closestCell(event.target, root, cellSelector);
    if (cell && canActivateCell(cell, event.target, options)) open(cell);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { close({ restoreFocus: true }); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const cell = closestCell(event.target, root, cellSelector);
    if (!cell || !canActivateCell(cell, event.target, options)) return;
    event.preventDefault();
    open(cell);
  };
  const onOutside = (event) => {
    if (!popover || popover.contains(event.target) || activeCell?.contains?.(event.target)) return;
    close();
  };
  const onDocumentKey = (event) => { if (event.key === 'Escape') close({ restoreFocus: true }); };
  const onScroll = (event) => { if (!popover?.contains(event.target)) close(); };
  const onResize = () => close();

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  doc.addEventListener('pointerdown', onOutside);
  doc.addEventListener('keydown', onDocumentKey);
  doc.addEventListener('scroll', onScroll, true);
  win?.addEventListener?.('resize', onResize);

  const api = Object.freeze({
    root, key,
    getLines: () => lines,
    setLines,
    open,
    close,
    destroy() {
      close();
      observer?.disconnect();
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('pointerdown', onOutside);
      doc.removeEventListener('keydown', onDocumentKey);
      doc.removeEventListener('scroll', onScroll, true);
      win?.removeEventListener?.('resize', onResize);
      control?.remove();
      for (const cell of root.querySelectorAll?.('[data-dona-owned-tabindex]') || []) {
        cell.removeAttribute('tabindex');
        cell.removeAttribute('data-dona-owned-tabindex');
        cell.removeAttribute('aria-expanded');
      }
      root.classList.remove('dona-cell-tools');
      root.removeAttribute('data-cell-lines');
      root.style.removeProperty('--dona-cell-lines');
      INSTANCES.delete(root);
    }
  });
  INSTANCES.set(root, api);
  return api;
}

export function getMounted(root) { return INSTANCES.get(root) || null; }
export function destroy(root) { const instance = INSTANCES.get(root); if (!instance) return false; instance.destroy(); return true; }

export default { mount, destroy, getMounted, canActivateCell, getCellValue, normalizeLines, storageKey, VERSION };
