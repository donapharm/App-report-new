# T08 SHADOW SOURCE OUTCOMES

- Trace: **2026-08-13T15:10:25+07:00** GMT+7; trace harness `e1094dba3f124a7cc52759fbac9f03301e667342`; source-classification modules byte-identical to candidate `39f007be8d6cb6e08f991395dc699fb129190779`.
- Mode: direct read-only shadow; serving flag **0/absent**; no snapshot publication and no production-data write.
- Roster: **21/21** configured employees.
- Raw outcome is the direct contract result. Snapshot refresh reason is separately normalized only on failure; successful rows show “— (accepted)”.

| NV | HTTP status | raw fetch outcome | snapshot refresh reason | refresh action | duration ms |
|---|---:|---|---|---|---:|
| DN001 | 200 | ok | — (accepted) | accepted | 750 |
| DN002 | 200 | ok | — (accepted) | accepted | 34 |
| DN003 | 200 | ok | — (accepted) | accepted | 73 |
| DN004 | 200 | ok | — (accepted) | accepted | 26 |
| DN005 | 200 | ok | — (accepted) | accepted | 19 |
| DN006 | 200 | ok | — (accepted) | accepted | 39 |
| DN007 | 200 | ok | — (accepted) | accepted | 13 |
| DN008 | 200 | ok | — (accepted) | accepted | 121 |
| DN009 | 200 | ok | — (accepted) | accepted | 70 |
| DN010 | 200 | ok | — (accepted) | accepted | 60 |
| DN011 | 200 | ok | — (accepted) | accepted | 381 |
| DN012 | 200 | ok | — (accepted) | accepted | 23 |
| DN016 | 200 | ok | — (accepted) | accepted | 66 |
| DN017 | 200 | ok | — (accepted) | accepted | 22 |
| DN018 | 200 | ok | — (accepted) | accepted | 63 |
| DN019 | 200 | ok | — (accepted) | accepted | 60 |
| DN021 | 200 | ok | — (accepted) | accepted | 15 |
| DN022 | 200 | ok | — (accepted) | accepted | 24 |
| DN023 | 200 | ok | — (accepted) | accepted | 11 |
| DN024 | 200 | ok | — (accepted) | accepted | 135 |
| VP004 | 200 | ok | — (accepted) | accepted | 18 |

## Groups

- **409 / upstream_rejected:** 0 — none
- **deadline:** 0 — none
- **other failure:** 0 — none
- **ok:** 21 — DN001, DN002, DN003, DN004, DN005, DN006, DN007, DN008, DN009, DN010, DN011, DN012, DN016, DN017, DN018, DN019, DN021, DN022, DN023, DN024, VP004

## Verdict

T08 direct shadow tại thời điểm đo: **21/21 HTTP 200, raw outcome ok; 0 rejected, 0 deadline, 0 other failure**. Đây là raw source trace, không phải bằng chứng snapshot đã publish/serve. Snapshot refresh reason không phát sinh cho các fetch thành công; action giả lập là accepted.


## Evidence boundary

- Đây là direct source-outcome diagnosis read-only, không phải chứng nhận snapshot complete/pinned/activated.
- T08 DN001 là đối chứng thành công cho đường contract/xác thực khi so với T07 409; không suy diễn rằng T07 đã thành công.
- Không có request ID trong response; không giữ credential, host, raw URL, message/details values hoặc row values.
