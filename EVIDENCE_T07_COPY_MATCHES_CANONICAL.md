# EVIDENCE T07 COPY VS CANONICAL — FAIL-CLOSED

Checked on **2026-08-13 GMT+7**. Approved comparison code: exact commit `90146448895cd4d6b845e24925f40e603d8569fb`.

## Verdict

**Canonical equality is NOT proven. Stop: do not publish or serve this custody corpus as a T07 snapshot.**

The reason is not a numeric mismatch in a preserved model. The required T07 snapshot model/generation is absent: no T07 `model.json`, `manifest.json`, `current.json`, or employee payload files survived or were ever published by the observed 13:36/13:38 shadow runs. Both retained T07 `status.json` files state:

- `state=failed`
- `errorCode=EMPLOYEE_COST_SNAPSHOT_CLOSED_INCOMPLETE`
- `generationId=""`
- `availableCount=0`
- `rosterCount=21`
- `complete=false`

Therefore exact candidate `9014644` has no preserved 13:38 snapshot payload to consume offline. Running the candidate against the detached 13:35 runtime-data corpus would create a **new reconstruction**, not rebuild the absent 13:38 generation; it could also require source calls. That action was deliberately not represented as a comparison.

## Values that can be cross-checked from retained independent evidence

The retained live read-only result immediately before the failed shadow publish reports:

| Measure | Canonical requested | Retained live evidence | Difference |
|---|---:|---:|---:|
| Rows | 2,091 | 2,091 | 0 |
| Employee roster | 21/21 | 21/21 | 0 |
| Revenue including VAT | 30,982,248,913đ | 30,982,248,913đ | 0 |

Evidence boundaries:

- `live-result.json` records T07 digest `551f783f24dc6d39133994fc83bc664d33ba7b9920df58c131fdb6b112ea2ac0`, `rows=2091`, `employees=21`, no unavailable employee, and balanced revenue.
- `FINAL-AUDIT.md` traces `30,982,248,913đ` to the active T07 upload slot and its revenue projection: CRM MISA `20,264,743,043đ` + APP WEB partner `10,717,505,870đ`.
- `30,982,248,913đ` is revenue, not total cost. The retained live T07 total cost is `3,232,065,145đ`.

These top-line checks establish parity of the retained **live observation** with the stated canonical values. They do **not** establish parity of a snapshot copy, because there is no snapshot model to hash or compare.

## Unresolved checks

- Candidate-built snapshot digest: **not available**.
- Candidate-built per-employee subtotals: **not available**.
- Cell-by-cell difference: **not executable without preserved payload/model**.
- Required network-call count for an offline rebuild: **not executable; no rebuild was attempted**.

Per the instruction “any difference or inability to match: state it and stop”, the comparison stops here. A valid next comparison requires either:

1. discovery of a genuine retained T07 generation containing model + manifest + payloads, or
2. fresh source recovery followed by a newly approved snapshot/seal build from DataHub, which must be identified as a new generation rather than the 13:38 copy.

Custody reference: `/home/osboxes/app-report-custody/t07-shadow-20260813-1338`; aggregate checksum `8b6e11ade8f011efee1a0f290863730692fe392c80114e0675cef937c039790f`.
