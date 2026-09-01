# Claude handoff — Employee Cost owned by App Report

Status: Gate 1 candidate only. Do not deploy or write production custody from this branch without a separate CEO deployment approval.

## Contract fixed

- Full52 ingestion verifies the signed manifest, all page/file checksums, exact C1–C52 and the declared period.
- Before plaintext is released, App Report now materializes `cost-projection.json` inside its 0700 custody package directory (file mode 0600).
- The projection contains only the join dimensions required by Employee Cost, employee identity C6, and C33–C46. It is bound to the Full52 package checksum and has its own canonical checksum.
- Employee Cost display, watcher and snapshot rebuild read this App Report-owned projection. Normal production configuration remains local-only and therefore has zero runtime DataHub fallback.
- Missing, corrupt, wrong-period, incomplete-roster or non-numeric projection data fails closed.
- Projection identity participates in the closed-seal fingerprint so a changed generation cannot reuse an old financial seal.

## Existing T08/T09 packages

Existing encrypted packages predate the projection. `server/scripts/build_catalog52_cost_projection.js` is the one-time backfill command, but running it writes custody and therefore belongs to Gate 2. It pulls the already-published signed Full52 package, verifies it again, requires its checksum to match the active encrypted package, and writes only the local projection.

Read-only Gate 1 verification against the published packages passed:

- T08: 28,006 rows, 21 employees, 14 cost columns.
- T09: 28,212 rows, 21 employees, 14 cost columns.

No secret, raw row, percentage, monetary amount or employee payload is included in this handoff.
