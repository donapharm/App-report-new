# Handoff — Revenue single-writer T09+

Candidate goal: prevent App Sale CRM/MISA and App Debts from double-counting or replacing each other in App Report from T09.2026 onward.

Rules enforced:

- Group-Dona (`DONA` + `AFP`) is supplied only by verified `DEBTS_INVOICE_SHADOW` rows.
- The retained App Sale partition contains only `APP_WEB_PARTNER` rows outside Group-Dona.
- Generic upload/commit cannot create or replace T09+ revenue slots.
- Generic activation can restore only a Debts composite slot carrying selector policy `GROUP_DONA_DEBTS_FROM_2026_09`.
- Every row must have a stable `source_line_id`; identities must be disjoint across partitions.
- Debts, partner and complete composite checksums are persisted. Idempotency compares content checksums, not only row counts.
- The pre-T09 source policy is unchanged.

This candidate performs no source-system write, no revenue materialization, no scheduler enablement and no deployment. Review the focused regressions in `revenueSingleWriterGuard.test.js`, `debtsRevenueSlot.test.js`, `debtsRevenueJob.test.js`, and `groupDonaRevenuePolicy.test.js`.
