# Evidence — Catalog LKG Phase 1 live sidecar build (read flag OFF)

Date: 15/08/2026 GMT+7

## Identity and safety state

- Candidate/materializer exact: `dedce8a189e10422607965cca01065a48a6113a6`.
- PROD remained exact `1b61089088ece63ede82d27f2f199207873fd496`.
- Live monolith identity:
  `2050:20593848:377813964:1786765195731177847:1786765198755085811`.
- Sidecar root: `server/data/catalog_lkg/v1`, mode `0700`; fragment/index files mode `0600`.
- `CATALOG_PERIOD_LKG_READ_ENABLED` stayed OFF. No release cutover, PM2 reload,
  writer change, DataHub call or monolith mutation occurred.

## Offline materialization

- Watcher probe at 18:32 finished first: 21/21 and
  `WATCHER_PROBE_READY_GATE2_REQUIRED`. Materialization did not overlap it.
- The tool wrote a hidden staging directory on the same filesystem and published
  it atomically only after validation. `index.json` was the final generation marker.
- Elapsed from root creation to index publication: approximately 61 seconds.
- Peak directly observed RSS for the materializer process: 1,145,164 KiB
  (about 1.09 GiB). This is process RSS from `/proc`/`ps`, not PM2 cache.
- Nine fragments T01–T09 were produced. Total fragment bytes: `369,417,429`;
  total including index: `369,419,591`.
- T08 is `41,390,877` bytes; every other fragment is `41,003,319` bytes.
- Index SHA-256:
  `801cfaabe1311eb08b3aee03bf39c093baef70b8bdc15202d5b4849106c15f35`.

## Validation and discovered boundary

- All 9 raw fragment checksums, envelopes, period identities, snapshot metadata
  and permissions PASS. `sourceFileIdentity` exactly matches the current monolith.
- The current monolith metadata index retains only T04–T09. Therefore reader
  freshness validation PASSes for T04–T09 (including T07/T08 and the full six-month
  cap), while T01–T03 deliberately return `CATALOG_PERIOD_STALE` and fall back to
  monolith. The writer index was not modified to fabricate coverage.
- Six-period sequential reader validation PASS; each fragment was released after
  consumption and the sidecar index was read once.

## Shadow gate blocker

`dedce8a` contains direct dual-read selection: when the read flag is ON and the
sidecar validates, it returns sidecar data. It does **not** independently build the
monolith result, compare rows/catalog/history/version/checksum/DQ, then select the
monolith on mismatch. Therefore the approved 24h/200-request shadow acceptance
cannot be started safely by only toggling the existing flag.

The flag remains OFF. A separate Gate 1 candidate must add explicit shadow mode,
mismatch counters/reasons, fail-back-to-monolith behavior and an immediate flag-off
interlock before any runtime observation window begins.
