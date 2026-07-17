# @donapharm/dona-table-cell-tools

Canonical shared UI package approved under `OK_UICMP1_0717`. It adds line-density controls and a read-only full-cell preview to ordinary HTML or React tables.

- Shows **1, 2, 3, or all** lines; default is **3**.
- Remembers the choice per `appId` + `tableId` in `localStorage`.
- Click, **Enter**, or **Space** opens the full value.
- **Copy** and **Close** actions; **Escape**, outside click, page/table scroll, and resize close it.
- Desktop popover and mobile (`<=639px`) dialog/bottom sheet.
- Event delegation and a small accessibility observer tolerate React row/cell rerenders.
- Core and browser bundle have no runtime dependencies and make no network requests.
- It does not modify application data. `data-full-value` is read as text, never interpreted as HTML.

## Files

| File | Purpose |
| --- | --- |
| `src/core.js` | ESM core/API |
| `dist/dona-table-cell-tools.iife.js` | dependency-free browser IIFE (`window.DonaTableCellTools`) |
| `dist/dona-table-cell-tools.css` | shared styles |
| `react/index.js` | optional React hook and wrapper source |
| `manifest.json` | package/API version manifest |

## Vanilla / ESM

```html
<link rel="stylesheet" href="/shared-ui/dona-table-cell-tools/dist/dona-table-cell-tools.css">
<div id="orders-grid" data-app-id="sale" data-table-id="orders">
  <table>
    <tbody>
      <tr><td data-full-value="Complete canonical value"><span class="dona-cell-value">Complete canonical value</span></td></tr>
    </tbody>
  </table>
</div>
<script type="module">
  import { mount } from '/shared-ui/dona-table-cell-tools/src/core.js';
  const cells = mount('#orders-grid', { appId: 'sale', tableId: 'orders' });
  // Later: cells.setLines(2); cells.close(); cells.destroy();
</script>
```

`mount(root, options)` is idempotent for the same root. Calling it again returns the existing controller. `destroy()` removes package-owned listeners, UI, classes, style variables, and package-owned `tabindex` attributes. After destroy, the root can be mounted again.

## Plain browser / IIFE

```html
<link rel="stylesheet" href="/shared-ui/dona-table-cell-tools/dist/dona-table-cell-tools.css">
<script src="/shared-ui/dona-table-cell-tools/dist/dona-table-cell-tools.iife.js"></script>
<script>
  const cells = DonaTableCellTools.mount(document.querySelector('#orders-grid'), {
    appId: 'sale',
    tableId: 'orders'
  });
</script>
```

No CDN is needed or used.

## React

React is optional and is imported only by the `/react` subpath.

```js
import { DonaTableCellTools } from '@donapharm/dona-table-cell-tools/react';
import '@donapharm/dona-table-cell-tools/css';

export function OrdersTable({ rows }) {
  return (
    <DonaTableCellTools options={{ appId: 'sale', tableId: 'orders' }}>
      <table><tbody>{rows.map((row) => (
        <tr key={row.id}>
          <td data-full-value={String(row.note ?? '')}>
            <span className="dona-cell-value">{row.note}</span>
          </td>
        </tr>
      ))}</tbody></table>
    </DonaTableCellTools>
  );
}
```

Or mount onto an existing stable wrapper:

```js
const { rootRef, instanceRef } = useDonaTableCellTools({ appId: 'sale', tableId: 'orders' });
return <div ref={rootRef}>{/* table */}</div>;
```

Keep the wrapper stable. Rows and cells may rerender freely because activation uses delegated events.

## Default eligibility and safety

A cell is excluded when it is, contains, or is protected by any applicable default marker:

- `button`, `a`, `input`, `select`, `textarea`, or editable content;
- `[data-cell-action]`, `[data-no-cell-preview]`, `[data-sensitive]`;
- `.col-act` or `.grid-empty` cells.

Use `data-sensitive` on a cell or ancestor to prevent previews. Use `data-no-cell-preview` for any region that must never activate. These are UI guards, not authorization controls; sensitive data must still be protected by the application/backend.

`data-full-value` wins over visible text. Values are assigned with `textContent`, so HTML is not executed. For exact cross-browser line clamping, put cell content in `.dona-cell-value` (existing `.smart-cell-value` is also supported). The package does not wrap or rewrite cell content.

## Options

```js
mount(root, {
  appId: 'sale',              // default: root data-app-id, then "app"
  tableId: 'orders',          // default: root data-table-id/table id/root id
  lines: 3,                   // 1 | 2 | 3 | "all"; stored value used when omitted
  showLineControl: true,      // inject 1/2/3/all selector
  controlHost: element,       // optional external host or selector
  cellSelector: 'td',
  excludeSelector: '...',     // replaces the default cell exclusion selector
  interactiveSelector: '...', // replaces the default descendant selector
  storage: localStorage,      // null disables persistence
  labels: { copy: 'Copy' }    // optional localization
});
```

Public controller methods: `getLines()`, `setLines(value, persist?)`, `open(cell)`, `close()`, and `destroy()`. The root emits `dona-cell-tools:lines` with `{ detail: { lines } }` after changes.

## Development checks

```sh
npm run build
npm test
npm run check
```

The build script only regenerates the local IIFE from the ESM source. It does not download dependencies or access the network.
