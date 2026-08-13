# T07 PROD SERVING TRACE

- Trace window: **2026-08-13 18:40–19:25 GMT+7**.
- PROD serving release: `3a3a47d-20260813-085826-163`; public `/version.json` commit `3a3a47d`.
- Scope: read-only diagnosis. No deploy, restart/reload, symlink/config/DB/cache/DataHub write, or external send was performed.
- Candidate documentation branch before this trace: `bot/candidate-fb616d1-on-1c7d6f5` at `90146448895cd4d6b845e24925f40e603d8569fb`.

## Verdict

1. The five reported missing employees have direct DataHub error-log evidence for T07: HTTP **409** with code **`EMPLOYEE_COST_C32_SIDECAR_REQUIRED`**.
2. PROD has **no `employee_cost_closed_seal.json`** in the shared runtime auth-data directory and no seal-file override in the running App Report process. Therefore there is no T07 seal payload whose checksum/roster/provenance can be accepted.
3. `laiLichConDung` (`closedSeal.remoteProvenanceStillValid`) cannot pass without a seal payload. The prerequisite for `hotfix/t07-seal-fallback` is false, so the hotfix was **not created**. `employee_cost_rate_snapshot.json` is not a closed seal and was not substituted for one.
4. The remaining serving protection is RAM memo/stale behavior, not an employee-by-employee durable seal. Exact per-employee collapse times are not retained; claiming them would be guesswork.

## Direct 409 evidence for the five reported employees

Source: local retained DataHub PM2 error log `data-hub-error-14.log`. The records themselves do not carry timestamps; the file was last modified at **2026-08-13 15:11:19 GMT+7**, consistent with the reported incident window around 15:10. Line numbers below identify the retained records at trace time.

| Employee | T07 source-error line | HTTP status | code | retryable |
|---|---:|---:|---|---|
| DN019 | 168993 | 409 | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | false |
| DN018 | 169015 | 409 | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | false |
| DN022 | 169037 | 409 | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | false |
| DN024 | 169103 (and four later repeats) | 409 | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | false |
| VP004 | 169125 (and four later repeats) | 409 | `EMPLOYEE_COST_C32_SIDECAR_REQUIRED` | false |

The retained direct log also contains the same T07 409/C32 result for DN001, DN009, DN010, DN011, DN012, DN016, DN017, DN021, and DN023. It does not contain a retained 409/C32 record for DN002–DN008, so this trace does **not** independently claim the direct status for those seven codes even though the incident report says all T07 requests were rejected.

App Report operational logs normalize source failures and do not preserve enough per-code HTTP detail; the direct DataHub records above are the stronger evidence.

## Closed-seal and provenance gate

Runtime topology at trace time:

- `current/server/data` resolves to the shared `/home/osboxes/.openclaw/workspace-report/App-report/server/data`.
- The running App Report process has neither `AUTH_DATA_DIR` nor `EMPLOYEE_COST_CLOSED_SEAL_FILE` set.
- Search of the shared runtime `server/data/auth` found no `employee_cost_closed_seal.json` and no `*seal*` file.
- The expected default read in `employeeCostClosedSeal.js` is `employee_cost_closed_seal` via the shared persistence store; absent entry/file returns no payload.

Consequences:

- Checksum, roster completeness, seal identity, and remote provenance cannot be validated because there is no sealed T07 model to validate.
- `laiLichConDung` is not a source-reconstruction mechanism; it only validates provenance attached to an existing seal. With no seal, the live fallback condition is false.
- `employee_cost_rate_snapshot.json` does contain T07 entries, but it is a rate snapshot, lacks the closed-model seal contract/provenance, and must not be treated as the missing seal.

**Hotfix gate: BLOCKED.** No branch `hotfix/t07-seal-fallback` was created and no local numbers were manufactured.

## Cache horizons and decline estimate

The PROD serving cache in `server/src/routes.js` is aggregate by query/data fingerprint, not one durable timer per employee:

| Layer/state | TTL | Effect |
|---|---:|---|
| ALL base, healthy | 6 hours | Returns the resolved aggregate while fresh. |
| ALL base, degraded | 2 minutes | A rebuilt result containing unavailable/stale employees is retried quickly. |
| Expired base stale window | 10 minutes after its applicable TTL | Returns the old aggregate while one background rebuild runs; failed rebuild keeps the old entry eligible only inside this window. |
| Derived view | 1 minute | Short session/query-specific presentation cache over the base. |
| Warm loop | 30 minutes by default | Warms the current period; it does not create a durable T07 closed seal. Other request/event/self-heal paths can still rebuild T07. |

The 16 codes outside the reported missing set are:

`DN001`, `DN002`, `DN003`, `DN004`, `DN005`, `DN006`, `DN007`, `DN008`, `DN009`, `DN010`, `DN011`, `DN012`, `DN016`, `DN017`, `DN021`, `DN023`.

Honest timing boundary:

- For an aggregate created at time `t`, a healthy base can be fresh until `t + 6h`, then stale-served at most through `t + 6h + 10m`; a derived view can lag the selected base by up to another 1 minute.
- Once a rebuild publishes a degraded model, its next fresh horizon is only `t + 2m`, with a stale ceiling of `t + 12m` and up to 1 minute of view lag.
- Rebuilds are triggered by cache miss/expiry and can also occur through startup warm, interval/event warming, revenue refresh, or self-heal. Single-flight prevents duplicate simultaneous builds but does not prevent a later T07 source request.
- Therefore the likely failure pattern is **aggregate rebuild waves** (counts changing after a base/view refresh), not deterministic one-NV-at-a-time expiry.

The persisted audit does not expose the RAM memo insertion timestamp or key owner, so exact expiry clocks cannot be reconstructed. At 18:39:06–18:39:19 GMT+7, retained `view_all` audit rows recorded `outcome: ok`, `attempts: 0` for 19 codes and no row for DN024/VP004. Those per-code rows do not preserve the final aggregate unavailable list; in particular, they cannot disprove the CEO screen observation that DN018/DN019/DN022 were absent a minute later. They are unsuitable for assigning individual expiry times.

A cold process has no RAM memo protection. Because no closed seal exists, restart/reload would remove the only time-bounded aggregate cache protection; this trace therefore performed neither.

## Runtime unchanged at close of trace

- Current release target remained `release-app-report-3a3a47d-20260813-085826`.
- `app-report` PID remained `784273` during the trace.
- Observed RSS was about **982 MiB** (`1,005,112 KiB`), below the rollback threshold of 1.8 GiB.
- Public health returned HTTP 200 and public version remained commit `3a3a47d`.
- None of the three authorized rollback criteria was observed.

## Required next condition

Do not implement or deploy the seal fallback unless PROD first has a genuine T07 closed seal that passes checksum, exact roster/model validation, and provenance validation. Any future implementation must still prove: locked T07 + rejected upstream + valid seal gives 21/21 from the seal, with **zero compensating network calls**, and invalid/missing seal remains fail-closed with the true reason.
