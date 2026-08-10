# App Report Reconciliation Allocation V4

## Server-only configuration

V4 reuses the existing server-only App Sale connection by default:

- `APP_SALE_RECON_BASE_URL`
- `APP_SALE_RECON_KEY`
- Existing bounded timeout/cache/concurrency controls

Dedicated `APP_SALE_RECON_ALLOCATION_V4_*` URL/key/control values may override those defaults. The reconciliation version and `reconciliation_rows_checksum_v2` come only from the already accepted VP018 v3 snapshot for the same period + contractor. Allocation version defaults to immutable version `1`; `APP_SALE_RECON_ALLOCATION_V4_VERSION` is an explicit future-version pin.

Endpoint:
`/api/integrations/app-report/reconciliation-allocation/v4/{YYYY-MM}/{contractor}?phien_ban={reconciliationVersion}&allocation_version={allocationVersion}&offset={offset}`

Authentication uses the server-side `x-datahub-key`; no key or private rate is sent to the web client. If URL, key, or the accepted v3 version/checksum is absent, V4 performs no request and leaves the shadow values unchanged.

## Contract and fail-closed boundary

The consumer requires:

- contract `app-sale-reconciliation-allocation-v4`;
- `shadow_only=true` and `effective_values_changed=false`;
- exact page/group/child/variance key allowlists;
- `confirmed_by` exactly `VP018` plus byte-for-byte v3/v4 reconciliation version/checksum/confirmation-time agreement;
- NFC contractor code and canonical percent-encoded path, including `20.HĐS`;
- pinned reconciliation/allocation versions, allocation checksum, confirmation provenance, and monotonic pages;
- page size 250 while `has_more=true`, 1 MiB cap, bounded timeout/cache/concurrency;
- canonical decimals, page/allocation/bridge/immutable-identity SHA-256 checksums;
- independently unique confirmed-line, partner-line, row-ordinal, and order-item identities, plus valid employee-group/mixed-employee variance provenance;
- exact three-decimal quantity conversion bounded to JavaScript-safe scaled integers.

Malformed, oversized, unauthenticated, timed-out, duplicated, partially matched, drifted, or unavailable V4 data projects nothing. Existing v3 shadow handling remains unchanged.

## Employee Cost behavior

- Exact children map atomically one-to-one by immutable `order_item_id + order_code + employee_code`.
- Employee-group variance becomes a separate row labeled `Chênh lệch chưa phân bổ theo đơn` with quantity/reconciled quantity/delta `20 / 20 / +20` in the sealed preview.
- The variance row has no order identity and no revenue, VAT, cost, KPI, bid price, monthly/annual amount, notification, or export effect.
- Mixed-employee/unallocated variance never enters an employee view.
- Synthetic rows exist only in interactive employee-cost views (and their warm cache); notification, payment, preview, calculation, and export paths suppress them.

## Sealed preview

For `2026-07`, contractor `20.HĐS`, employee `DN005`:

- source line `2524`, order `DT-260708-0176`: reconciled `2400`, delta `0`;
- source line `2783`, order `DT-260723-0346`: reconciled `4000`, delta `0`;
- synthetic variance: quantity/reconciled/delta `20 / 20 / +20`;
- explicit shadow totals: ordered `6400`, reconciled `6420`, delta `+20`.
