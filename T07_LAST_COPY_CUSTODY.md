# T07 LAST COPY CUSTODY

- Custody action: **2026-08-13 19:38–19:47 GMT+7**.
- Source observation: shadow work at **2026-08-13 13:36–13:38 GMT+7**.
- Approved candidate source frozen in custody: `90146448895cd4d6b845e24925f40e603d8569fb`.
- Serving flag remained off; no shadow sync, publication, serving activation, runtime reload/restart, DB/config/cache/DataHub write, or external send was performed by this custody action.

## Safe custody location

`/home/osboxes/app-report-custody/t07-shadow-20260813-1338`

This directory is outside the App Report runtime-data tree, outside the active snapshot root, outside `/tmp`, and outside the dev evidence/artifact tree. Directory mode is `0700`; all contained files have no group/world access.

Contents preserved:

1. Detached runtime-data corpus copied at approximately 13:35, under `source-data-1335/`.
2. All retained 13:36/13:38 shadow result, comparison, source trace, status and log artifacts, under `observed-shadow-artifacts/`.
3. An independent Git archive of exact candidate `90146448895cd4d6b845e24925f40e603d8569fb`, under `provenance-code/`.
4. `SHA256SUMS` with one SHA-256 entry per preserved file, `VERIFY-COPY.log`, and `SHA256SUMS.sha256`.

Custody inventory:

- Files covered by `SHA256SUMS`: **1,144**.
- Verification: **1,144/1,144 OK**, bad entries `0`.
- Custody size at close: **1,730,189,146 bytes** including checksum/verification metadata.
- Aggregate custody checksum (SHA-256 of `SHA256SUMS`):

`8b6e11ade8f011efee1a0f290863730692fe392c80114e0675cef937c039790f`

Representative file checksums:

- 13:38 T07 status: `aff5024631454784b9c1bd4e3033928898cf0b3083124ea893c755d8918fa4c4`
- 13:38 source trace: `be0d3cff1db5886bde65101799bfe6ea0346b22f228bfeb64ee2878c4022ce5e`
- 13:36 live summary: `e6bd93375f7169d6ec1d9e8eed79cf41f252f48daaf1986f80b95633c0a5eeba`
- Exact candidate archive: `636241e284b9a0d84c0d62ae965ff13afa7660251792b059c88375cc30e42529`

## Critical integrity finding

The retained 13:38 T07 store is **not a complete snapshot generation**. Its only T07 store file is `status.json`, whose payload states:

- `state: "failed"`
- `errorCode: "EMPLOYEE_COST_SNAPSHOT_CLOSED_INCOMPLETE"`
- `generationId: ""`
- `availableCount: 0`
- `rosterCount: 21`
- `complete: false`

The earlier 13:36 T07 store has the same failed state. Exhaustive searches of the relevant App Report runtime, development evidence and custody source paths found no T07 `generations/<id>/model.json`, `manifest.json`, `current.json`, or employee payload files. The 13:38 source trace lists 21 successful fetch results, but deliberately retained only outcome metadata; it did not retain their payloads and its publish attempt failed closed because exact source-range evidence was absent.

Therefore this custody record does **not** claim that a complete “payload 21 NV + manifest + status” generation existed. It preserves every surviving input/trace/status artifact and the detached runtime-data corpus without alteration, but it cannot turn an absent generation into a valid snapshot. No new sync was run, because a new T07 sync after the 409 incident could overwrite state or produce a misleading degraded result.

## Consequence for canonical comparison

A byte/model comparison against the requested “13:38 generation” cannot start until an actual preserved `model.json` + `manifest.json` generation is found. Reconstructing a new model from the detached 13:35 data corpus would be a new reconstruction, not proof that it equals a nonexistent retained generation. Any such reconstruction must be reported separately and must not be used as a basis to publish/serve T07 without a new CEO approval.
