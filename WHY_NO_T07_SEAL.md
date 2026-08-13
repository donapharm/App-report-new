# WHY T07 DID NOT GET A CLOSED SEAL

## Kết luận

T07 không ghi `employee_cost_closed_seal.json` vì bản dựng đúng 21/21 nhân viên bị `closedSeal.isSealable(...)` từ chối tại cổng **lai lịch dữ liệu remote**:

- `remoteProvenance` có 16 scope kết thúc bằng `:THIEU`;
- `employeeCostClosedSeal.isSealable` trả `false` ngay khi gặp bất kỳ `:THIEU` nào;
- vì vậy code không đi vào `closedSeal.write(...)`.

Đây **không phải** lỗi căn cước công thức, không phải thiếu roster, không phải số liệu mất cân, và không phải stale/unavailable nhân viên.

## Bằng chứng động khớp đúng bản T07 đã phục vụ

Tái hiện cô lập bằng exact source `3a3a47d8ac2634ffd0bdecfb46f71db24667a823` trên corpus dữ liệu detached chụp khoảng 13:30 GMT+7, không ghi PROD:

- roster: `21`;
- báo cáo gốc: `21`, toàn bộ `sourceOutcome=ok`;
- doanh thu: `balanced=true`, `gap=0`;
- unavailable: `0`;
- stale: `0`;
- `remoteProvenance`: 16 scope `:THIEU`;
- `closedSeal.isSealable(...)`: `false`.

Quan trọng nhất, digest projection của lần tái hiện là:

`551f783f24dc6d39133994fc83bc664d33ba7b9920df58c131fdb6b112ea2ac0`

Digest này **khớp byte-for-byte** digest retained của bản live T07 lúc 13:35, đồng thời khớp `2.091` dòng và `21` nhân viên. Vì vậy cổng `:THIEU` được đo trên chính model nghiệp vụ đã phục vụ, không phải một model gần giống.

Evidence:

- `/home/osboxes/.openclaw/workspace-report-dev/artifacts/t07-seal-gate-repro-20260813.json`
  - SHA-256 `e021a22bda1c5042f06a8406b6024cd3a18e24d9ef840fb10bffb721acba9006`
- `/home/osboxes/.openclaw/workspace-report-dev/artifacts/t07-seal-gate-model-match-20260813.json`
  - SHA-256 `4be3190a65c5cf3e1c95ad8770f7b476286df28b9659731cc2b246775b9aa0f8`

## Vì sao log không có dòng đóng dấu

Release `3a3a47d` chỉ ghi log khi:

1. `closedSeal.write(...)` thành công: `[employee-cost] đã đóng dấu kỳ khoá sổ`; hoặc
2. đã gọi write nhưng write ném lỗi: `[employee-cost] đóng dấu thất bại`.

Nhánh `isSealable(...) === false` không ghi log. T07 dừng ở nhánh này nên việc PM2 log không có cả hai chuỗi trên là đúng với flow code, không phải bằng chứng write đã chạy rồi mất log.

## Loại trừ các cổng khác

- Formula identity: kiểm tra runtime trả `dangTinCay().tinCay === true`.
- Roster/report evidence: 21/21, `sourceOutcome=ok`.
- Revenue reconciliation: `balanced=true`, `gap=0`.
- Employee availability: unavailable `0`.
- Rate freshness: stale `0`.
- Model retained: đúng `2.091` dòng, 21 nhân viên, digest canonical nêu trên.

Cổng chặn còn lại và đã được gọi động là `remoteProvenance.some(...endsWith(':THIEU'))`.

## Phân biệt với lỗi snapshot sync T07

Lỗi snapshot là một cổng khác:

- trace 13:38 có 21/21 payload và `sourceOutcome=ok`, nhưng `sourceRangePresent=false`, `verified=false`;
- vì không có exact verified prefetch evidence, snapshot closed-period kết thúc bằng `EMPLOYEE_COST_SNAPSHOT_CLOSED_INCOMPLETE`, `availableCount=0`, không publish generation.

Do đó:

- **không có closed seal**: bị chặn bởi remote provenance `:THIEU`;
- **không có snapshot generation T07**: bị chặn bởi thiếu exact source range/evidence.

Hai cổng đều fail-closed nhưng không được nhập làm một.

## Trạng thái vận hành sau OOM

JavaScript heap OOM lúc khoảng 22:22 GMT+7 đã kích hoạt tiêu chí rollback độc lập. PROD đã rollback atomic về exact `7870f10e0d60b9b635bfe28d57b7a9f8ef63f5d4`; candidate `9014644` chưa cutover.

DataHub T07 lúc 23:20 vẫn `0/21`, `21 × upstream_409`, nên chưa thể dựng seal/snapshot nguồn tươi. Không dùng `employee_cost_rate_snapshot.json` thay closed seal và không dựng generation giả.
