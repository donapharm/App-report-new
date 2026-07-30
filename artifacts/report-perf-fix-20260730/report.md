# App Report — Performance/RAM/navigation fix 2026-07-30

## Scope and safety

- Approval: `APPROVE_REPORT_PERF_FIX_20260730` — code/build/test only.
- Branch: `perf/report-ram-nav-20260730`; approved base: `0c4c5b60753cdb28fe988c55ddaad7bfde9bf528`.
- Validated code HEAD before this evidence-only update: `2068b25`.
- Work stayed in the isolated worktree. **No deploy, PM2 restart, PROD config/env or data change, `current` symlink change, cleanup, or external message.**

## Implemented

### 1. Catalog/LKG, RAM and I/O

- Added content-complete fingerprints and a small atomic sidecar index for the main catalog LKG and DQ projection.
- Index trust is bound to device/inode/size/mtime. If an indexed LKG is replaced or corrupt, the next refresh atomically repairs it instead of silently accepting it.
- Unchanged snapshots preserve main/DQ/index bytes, inode and mtime; changed content still writes atomically even when upstream version/checksum was not bumped.
- Added same-period single-flight and bounded snapshot cache: maximum 4 periods, TTL 2 minutes.
- Reduced canonical assignment retention from 24 potentially large entries to 6.
- Changed Employee Cost ALL warm interval from 10 to 30 minutes. An unchanged revenue heartbeat no longer triggers another giant ALL warm.

### 2. Revenue materialization

- Added exact payload SHA-256 plus versioned semantic identity.
- Exact match validates the active artifact; ordering-only changes use semantic comparison.
- Unchanged data keeps the active slot and returns successful `skipped: "unchanged"`; it creates no duplicate payload, slot or artifact.
- Legacy slots receive a one-time atomic hash metadata backfill. Changed data still uses the existing guard, race check, lock and atomic commit path.
- No historical files are deleted.

### 3. Faster menu/employee switching

- Added a bounded 12-entry request coordinator:
  - concurrent identical GETs coalesce;
  - short private cache: default 12 seconds, Employee Cost 20 seconds, point/xu 30 seconds;
  - successful mutations and auth/data-generation changes invalidate cache.
- Cache keys are isolated by opaque local auth generation, device, full path/query/body and backend data generation. **Bearer tokens are not stored in cache keys.**
- Backend data header is SHA-256 opaque; internal slot IDs/periods/timestamps are not exposed.
- Employee Cost and point/xu use latest-request-wins and AbortController, preventing an old employee/filter response from overwriting the latest selection.
- Removed the old module-global point/xu cache whose key lacked auth/device/data-generation isolation.

## Benchmarks

Synthetic fixtures in fresh Node processes; see `benchmarks.json`.

| Scenario | Before | After |
|---|---:|---:|
| Catalog 8,000 rows, unchanged fresh process | 1,235.93 ms; 2 writes; 10,306,300 B | 935.02 ms; 0 writes; 0 B |
| Catalog unchanged max RSS | 172.2 MiB | 111.1 MiB (-35.5%) |
| Revenue 30,000 rows / 5.95 MB unchanged | duplicate commit path possible | identity pass 170.44 ms; 0 duplicate writes |
| 10 identical concurrent frontend requests | up to 10 loads | 1 network load |
| 1,000 frontend cache reads | network/remount dependent | 2.05 ms total |

Trade-off: the first optimized catalog publication is slower in the synthetic fixture (1,450.28 ms vs 907.90 ms) because it creates the sidecar and computes complete fingerprints. The recurring unchanged refresh is 24.35% faster, avoids 10.3 MB and 2 writes in this small fixture, and lowers max RSS by 61.1 MiB. Production LKG/DQ are much larger, but production impact was intentionally not measured without deploy approval.

## Verification

- Complete server tests: **558/558 pass**.
- Complete web tests: **92/92 pass**.
- Total: **650/650 pass**.
- Final Vite production build: **pass**, 645 modules, 8.11 s.
- Syntax, `git diff --check`, focused persistence/revenue/request tests: **pass**.
- Existing non-blocking build warning remains: Recharts chunk >500 kB.

The earlier 3 trusted-device failures were traced to missing `server/data/users.json` in the clean worktree (`server/data/*.json` is ignored). With the same runtime fixture used by PROD, the trusted-device file passes 4/4 on both base and optimized branches; final full suite passes 558/558. This was a TEST fixture issue, not a regression.

## Deploy gate and rollback

1. A **separate CEO deploy approval** is required.
2. Before deploy: record active revenue slot/hash, LKG/DQ identity, process RSS/heap and API timings.
3. Deploy via the normal atomic App Report release path; do not manually alter `current`.
4. Verify two consecutive 30-minute refresh slots, CEO plus employee scope, and rapid switching across at least 3 employees/modules.
5. Monitor RSS/heap, event-loop delay, Data Hub latency, skipped/changed counters and cache warm logs for 24 hours.
6. Rollback by redeploying the previous approved commit. LKG/revenue formats remain backward-compatible; optional sidecar/hash metadata can remain harmlessly.

A later month-sharded catalog migration could reduce cold parse/write further, but it is intentionally outside this safe incremental change and requires a separate migration/rollback approval.
