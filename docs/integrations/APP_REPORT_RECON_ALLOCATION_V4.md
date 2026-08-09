# App Report Reconciliation Allocation V4

## Server-only configuration

The integration is disabled unless all four dedicated values are present:

- `APP_SALE_RECON_ALLOCATION_V4_BASE_URL`
- `APP_SALE_RECON_ALLOCATION_V4_KEY`
- `APP_SALE_RECON_ALLOCATION_V4_RECONCILIATION_VERSION`
- `APP_SALE_RECON_ALLOCATION_V4_VERSION`

Optional bounded controls: `APP_SALE_RECON_ALLOCATION_V4_TIMEOUT_MS`, `APP_SALE_RECON_ALLOCATION_V4_CACHE_TTL_MS`, `APP_SALE_RECON_ALLOCATION_V4_CACHE_MAX`, and `APP_SALE_RECON_ALLOCATION_V4_CONCURRENCY`.

Endpoint:
`/api/integrations/app-report/reconciliation-allocation/v4/{YYYY-MM}/{contractor}?phien_ban={reconciliationVersion}&allocation_version={allocationVersion}&offset={offset}`

Authentication uses the dedicated server-side `x-datahub-key`; no key or private rate is sent to the web client.

## Contract and fail-closed boundary

The server consumer requires:

- contract `app-sale-reconciliation-allocation-v4`;
- `shadow_only=true` and `effective_values_changed=false`;
- exact page/group/child/variance key allowlists;
- NFC contractor code and canonical percent-encoded path, including `20.HĐS`;
- pinned reconciliation/allocation versions, reconciliation checksum, allocation checksum, confirmation provenance, and monotonic pages;
- page size 250 while `has_more=true`, 1 MiB response cap, bounded timeout/cache/concurrency;
- canonical decimal values, page/allocation/bridge/immutable-identity SHA-256 checksums;
- unique group and child identities and valid employee-group/mixed-employee variance provenance.

Malformed, oversized, unauthenticated, timed-out, duplicated, partially matched, drifted, or unavailable v4 data projects nothing. Existing v3 shadow handling remains the fallback.

## Employee Cost behavior

- Exact children map atomically one-to-one by immutable `order_item_id + order_code + employee_code`.
- Employee-group variance becomes a separate row labeled `Chênh lệch chưa phân bổ theo đơn` with only the two shadow quantities.
- The variance row has no order identity and no revenue, VAT, cost, KPI, bid price, monthly/annual amount, notification, or export effect.
- Mixed-employee/unallocated variance never enters an employee view; only authorized aggregate metadata may expose its count.
- Synthetic rows are suppressed from exports.

## Sealed preview

For `2026-07`, contractor `20.HĐS`, employee `DN005`:

- source line `2524`, order `DT-260708-0176`: reconciled `2400`, delta `0`;
- source line `2783`, order `DT-260723-0346`: reconciled `4000`, delta `0`;
- synthetic variance: reconciled `20`, delta `+20`;
- explicit shadow totals: ordered `6400`, reconciled `6420`, delta `+20`.
