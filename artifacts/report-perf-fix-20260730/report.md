# App Report — Performance/RAM/navigation fix 2026-07-30

## Scope and safety

- Branch: `perf/report-ram-nav-20260730`; approved base: `0c4c5b60753cdb28fe988c55ddaad7bfde9bf528`.
- Changes and tests stayed in the isolated worktree. No deploy, PM2 restart, production config/env change, production data write/delete, symlink change, or external message.
- Existing fail-closed catalog validation, revenue materialization guard, active-slot race check, common file lock, and atomic rename remain in place.

## Changes

### Catalog/LKG and backend RAM

- Added content-complete semantic fingerprints plus a tiny atomic sidecar index for the main catalog LKG and DQ projection.
- Sidecar trust is tied to file device/inode/size/mtime identity. A replaced/corrupt file cannot be skipped merely because metadata matches.
- Unchanged refreshes preserve main/DQ/index bytes, inode and mtime; changed content still atomically rewrites even if upstream version/checksum was not bumped.
- DQ fingerprint is computed row-by-row from approved projection fields; an unchanged refresh no longer creates duplicate ~100 MiB projections just to compare them.
- Added period single-flight and bounded snapshot LRU: max 4 snapshots, TTL 2 minutes. Canonical assignment retention reduced from 24 potentially-large entries to 6.
- Employee-cost ALL warm interval changed from 10 to 30 minutes, matching the revenue refresh cadence and avoiding redundant warm work. An unchanged revenue heartbeat no longer rebuilds the ALL cache.

### Revenue materialization

- Candidate JSON receives an incremental exact-byte SHA-256 and a versioned semantic identity.
- Exact-byte fast path streams and validates the active file; row/key ordering-only changes use a canonical semantic comparison.
- An equivalent candidate keeps the active slot, records a successful `skipped: unchanged` heartbeat, and creates no candidate payload, new slot, or artifact.
- Legacy active slots get a one-time small atomic manifest metadata backfill; subsequent runs do not parse the giant active JSON. Changed data still follows the original guarded atomic commit/history path.
- No historical production files are deleted.

### Frontend navigation/employee switching

- Added a bounded 12-entry request coordinator: concurrent GET coalescing and short private response cache (default 12 s; employee-cost 20 s; point/xu 30 s).
- Cache keys include method, full path/query, body, auth token digest, device ID, and backend data signature. Raw tokens are never retained as cache keys.
- Successful mutations clear response cache. Token changes clear cache and generation. Backend sends only an opaque data-generation header for immediate file/slot invalidation.
- Employee cost and point/xu use latest-request-wins gates and AbortController. Old employee/filter requests cannot overwrite the latest employee; shared requests abort only after all consumers leave.
- Removed the previous module-global point/xu cache whose key lacked session/device/data-generation scope.

## Benchmarks

Synthetic temp fixtures on Node 22.22.0; details in `benchmarks.json`.

| Scenario | Before | After |
|---|---:|---:|
| Catalog 8,000 rows, unchanged call | 1,566.63 ms; 2 writes; 10,786,300 B | 0.02 ms warm; 0 writes; 0 B |
| Catalog max RSS in fixture | 192.9 MiB | 141.6 MiB (-26.6%) |
| Revenue 30,000 rows / 5,954,984 B | duplicate candidate write | 0 payload/slot/artifact writes |
| Frontend 10 same concurrent consumers | up to 10 loads without coordination | 1 network load |
| Frontend 1,000 bounded-cache reads | network/remount dependent | 2.28 ms total |

Trade-off: revenue identity verification took 204.19 ms on the 5.95 MB fixture versus 57.14 ms for a bare duplicate payload write. This bounded CPU cost removes large duplicate files, slot history and downstream warm work; the normal exact-byte path avoids full semantic parsing after one-time metadata backfill.

The production audit baseline (~700 MiB RSS, 77–80 s cold/start warm, 12–14 s revenue-refresh warm) was not rerun because this task explicitly used local fixtures/test processes only. Production impact must be measured after a separately approved deployment.

## Verification

- Focused changed-area server tests: **47/47 pass**.
- All web tests: **92/92 pass**.
- Vite production build: **pass**, 645 modules, 6.22 s.
- Syntax and `git diff --check`: **pass**.
- Broad server run: 553/556 pass. Three pre-existing date/fixture failures in `authTrustedDevice.test.js` reproduce in isolation; those files are unchanged from the approved base. See `test-evidence.txt`.

Focused tests cover unchanged no-write and inode/mtime stability, changed snapshot rewrite, concurrent catalog single-flight, exact/semantic revenue equivalence, changed revenue, versioned metadata, request coalescing, latest response, auth/device/query/data-generation isolation, per-consumer cancellation, and LRU limits.

## Risks and rollout plan

1. **Before deploy:** back up current manifest/LKG sidecar area; record active revenue slot, file hashes, process RSS/heap and cold/warm endpoint timings.
2. **Deploy only with a new CEO approval:** deploy the committed SHA using the normal App Report process; do not alter the current symlink manually.
3. **First refresh:** expect one-time catalog index creation and legacy revenue manifest hash backfill. Verify no active slot change when payload is unchanged.
4. **Acceptance:** compare LKG/DQ/slot write count and bytes over at least two 30-minute slots; test CEO and one employee scope; rapidly switch 3 employees and modules; confirm no stale overwrite or cross-scope data.
5. **Monitor:** RSS/heap, event-loop delay, Data Hub latency, refresh duration, skipped/changed counters, active-slot ID, and cache warm logs for 24 hours.
6. **Rollback:** revert this commit and redeploy through the approved path. Existing LKG and revenue payload formats stay backward-compatible; the sidecar and optional slot hash fields can remain harmlessly.

## Follow-up

A larger schema migration (month-sharded catalog LKG instead of one monolith) would further reduce cold parse/write amplification, but was intentionally not introduced in this safe incremental fix. It needs a separate migration/rollback plan and production-sized acceptance dataset.
