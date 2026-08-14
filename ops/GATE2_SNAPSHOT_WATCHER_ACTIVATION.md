# Gate 2 activation preview — T08 watcher / T07 marker / RSS guard

Nothing in this change installs cron/systemd, changes PM2, changes `current`, writes PROD data, or enables snapshot serving.

## Preconditions (fail closed)

1. Deploy a clean release whose commit/tree match the approved Gate2 artifact.
2. Keep `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT=0`.
3. Disable the in-app warm, legacy snapshot loop, and any independent employee-cost cron (`EMPLOYEE_COST_ALL_WARM_DISABLED=1`, `EMPLOYEE_COST_LOCAL_SNAPSHOT_SYNC_ENABLED=0`, `EMPLOYEE_COST_CRON_DISABLED=1`) so they cannot overlap the external watcher. The runner also refuses while the snapshot period lock/status is active.
4. Create root-readable state/log/lock directories. Copy the example environment without secrets.
5. First activate `EMPLOYEE_COST_SNAPSHOT_WATCH_MODE=probe`, notifications off, and manually run one invocation under the built-in `flock`.
6. Verify T08 exact roster 21/21, non-stale, exact `2026-08..2026-08`, one pinned dependency generation; review `status.json`. Five stale employees observed on the controlled 14-Aug retry were `DN021`, `DN022`, `DN023`, `DN024`, `VP004`; the sanitized evidence recorded exact-range T08 requests and observation times but did not expose an authoritative upstream effective timestamp. The watcher records source effective ranges/timestamps when supplied and never guesses absent timestamps.
7. If ready, separately approve `WATCH_MODE=sync`. Each successful dependency/source generation can sync once only; post-publish generation, roster, dependency identity, manifest and model digest are verified. Failure restores the prior pointer and removes only generations created by that invocation.
8. Only after acceptance may the example 30-minute cron line be installed. Notification is disabled by default; when Gate 2 sets `EMPLOYEE_COST_SNAPSHOT_WATCH_NOTIFY=1`, the runner sends at most one queued status per invocation through `TELEGRAM_BOT_TOKEN`, hard-refuses every recipient except CEO `1748199545`, retains failed deliveries, and deduplicates unchanged event states. A stale-source notice names each employee and the saved-rate timestamp (GMT+7) when provenance provides it.

## T07

Every watcher invocation separately probes exact T07. When 21/21 opens with stable dependencies it writes `t07-priority.json` with `priority=high`, `requestedAction=fresh_seal_snapshot`, `executed=false`. Seal/snapshot creation needs a separate approval and is not performed by this watcher.

## RSS / rollback

Record every sample above 1.8 GiB with app/job context and suspected LKG load. Rollback qualifies only after continuous >1.8 GiB for **more than** 10 minutes, OOM/unexpected restart in the observation window, or a numeric mismatch signal. The checked-in systemd file is a Gate2 preview with execution flag OFF; changing it to `APP_REPORT_RSS_GUARD_EXECUTE=1` needs the separate Gate2 approval. The only accepted target is `3a3a47d8ac2634ffd0bdecfb46f71db24667a823`; dirty, missing, or commit-mismatched releases are refused and `7870f10` is forbidden. Even when qualified, rollback is inert until Gate2 enables it. Runtime implementation must atomically swap `current` and restart only PM2 `app-report`; it must not restart `app-report-tgbot`.

## Rollback of watcher activation

Remove only the installed cron entry, set watcher mode back to `probe`/disabled, and preserve state/evidence. No snapshot serve flag change is involved. If a sync invocation fails, its publication state is restored automatically; never point `current` at an unverified generation.
