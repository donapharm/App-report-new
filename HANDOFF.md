# HANDOFF — App Report

Cập nhật: **2026-07-29 khuya** (Claude Code). Người tiếp nhận: bot report / phiên Claude kế tiếp.
Đọc theo thứ tự: `CLAUDE.md` → `CHANGELOG.md` (mới nhất trên cùng) → file này.

## ‼ ĐỌC NGAY — 2 việc gấp tối 29/07

1. **`DIRECTIVE_HOAN_TIN_CUOI_THANG_072026.md`** — hai cờ `EMP_COST_NOTIFY` / `BONUS_NOTIFY` **VẪN ĐANG BẬT**.
   Ngày **31/07** hệ thống sẽ tự gửi tin thưởng bằng **số cũ đã SAI** (DN008 thiếu ~1,92 triệu).
   CEO **đã duyệt tắt**. Làm trước 31/07.
2. **Gửi tin báo chậm cho NV** — nội dung CEO đã duyệt, nằm trong directive trên.
   Bắt buộc **in danh sách người nhận cho CEO duyệt trước** khi gửi thật.

## Chốt ngày 29/07 — vụ đối chiếu doanh thu đã KHÉP

Từ **384.977.920đ** lệch giữa App Sale và App Report, đã truy ra **100%**:

| Khoản | Nguyên nhân | Xử lý |
|---|---|---|
| **382.578.400đ** | `HOLD_GOLIVE` — cờ kỹ thuật soft-launch, hàng đã giao thật | **Đã tính vào**, slot T07 ghi lại xong |
| **2.399.520đ** | 1 dòng MISA thiếu `revenue_date` (`DH479815711`) | Kế toán nhập ngày; App Report **không được tự đoán** |

Slot T07 active: `rev_2src_072026_20260729153232_2916955_6ffe9252-de1e-4c2f-a922-ff341998e76c`
Tổng **28.957.771.643đ** · CRM 1.319 dòng · Partner 585 dòng · guard PASS · trùng `source_line_id` = 0.

**Bốn spec mới ngày 29/07 — đọc trước khi code:**
- `SPEC_BONUS_PENALTY_V33.md` — Phạt v3.3 (nhánh `feat/bonus-penalty-v3.3` Claude đã duyệt, **chưa merge**)
- `SPEC_REVENUE_DELIVERY_PERIOD.md` — quy kỳ theo ngày thực giao, khoá sổ ngày 5
- `SPEC_REVENUE_SYNC_EXCEPTIONS.md` — màn "Chưa đồng bộ" + cảnh báo Telegram
- `DIRECTIVE_DEPLOY_RELEASE_SAFETY.md` mục **P4** — cấm build trong cây production

**Sự cố 29/07:** bản frontend nhánh phạt lỡ lên production do build tại chỗ. Đã khôi phục.
**Auto-deploy vô can** — build trong cây đang phục vụ là cửa sau chưa có khoá. Xem P4.

---

## 1. Trạng thái: ĐANG CHẠY THẬT trên server nội bộ

- `main` = `a82381f`. Nhánh làm việc của Claude = `claude/new-session-eifd44`.
- Deploy: `scripts/auto-deploy.sh` chạy bằng cron + PM2, ra ngoài qua Cloudflare Tunnel.
- **Auto-deploy đang KHÓA: `DISABLED_BY_CEO_20260727`.** Muốn deploy phải mở khóa có chủ đích.

### Kết quả test trên `a82381f` (chạy lại 27/07)
| Bộ | Kết quả |
|---|---|
| server `node --test "test/**/*.test.js"` | **405/412** — đúng 7 fail baseline (3 OTP + 4 font PDF của container này), **0 regression** |
| `npm run test:gap-sync` (E2E) | **28/28** |
| web `node --test "test/**/*.test.mjs"` | **83/83** |
| `npm run build` (web) | PASS |
| `bash scripts/test_release_safety.sh` | **41/41** |

7 fail baseline là **của môi trường container**, không phải lỗi app — 3 ca OTP cần backend OTP thật,
4 ca PDF cần font Unicode nhúng chỉ có trên server. Đừng "sửa" chúng.

---

## 2. Bản đồ nghiệp vụ hiện tại (ngoài 6 lõi trong `CLAUDE.md`)

### 2.1 Chi phí của tôi (ngoại lệ CEO chốt 20/07) — `SPEC_REPORT_EMP_COST_SELFVIEW.md`
- Số **do DataHub tính (SSOT)**, App Report chỉ hiển thị. **KHÔNG dựng engine chi phí riêng.**
- Self-scoped: NV chỉ thấy chi phí/hoa hồng của chính mình; backend khóa quyền.
- `server/src/employeeCost.js` · `employeeCostTable.js` · `employeeCostExport.js`
- Cache nền ALL: **6 giờ** (`EMPLOYEE_COST_ALL_BASE_TTL_MS`), có **self-heal trong vòng warm**
  (`SPEC_EMP_COST_SOURCE_SELFHEAL.md`) để không kẹt 6h khi 1 NV lỗi nguồn.
- **Fail-closed về SỐ:** NV lỗi nguồn KHÔNG bị suy thành "thiếu %"; tổng bị khóa `null`,
  UI hiện nhánh "tạm tính" riêng + banner nêu **đích danh mã NV**.

### 2.2 Thưởng P1 / P2 — `SPEC_BONUS_P2_TOTAL_TARGET_GATE.md`
- `server/src/employeeBonus.js`.
- **P1 (coach) = `baseAmount` — CEO chốt ĐÚNG RỒI, TUYỆT ĐỐI KHÔNG SỬA.**
- **P2 v3.2** (`priorityAmount`), nhóm ưu tiên theo cột **C10**: `H.A* · H.A · H.B · H.C · H.D`.
  1. **Cổng tổng:** `R` (tổng doanh thu C10) `< T` (tổng target) → **P2 = 0** (`total_below_target`).
  2. Phần vượt `E = R − T` **chia theo TỶ TRỌNG DOANH THU THỰC của từng nhóm** — không dồn hạng cao.
  3. Mỗi nhóm ăn rate của chính nó; dư làm tròn dồn nhóm doanh thu lớn nhất (Σ == E, không tạo/mất tiền).
- **Hệ quả đã cảnh báo CEO:** có NV **GIẢM** nếu phần vượt rơi nhiều vào H.C/H.D — đúng bản chất.
- Rate **chỉnh tay được** và **có ghi audit**.
- ‼ Từng làm SAI 1 lần (dồn phần vượt vào H.A* trước → thổi phồng: DN006 7.048.940đ thay vì 5.479.768đ).
  Test `server/test/employeeBonus.test.js` đã khóa cả ca đúng lẫn ca chống-thổi-phồng. **Đừng gỡ.**

### 2.3 Mặt hàng thiếu % + đồng bộ DataHub
- `server/src/employeeCostGaps.js` · `employeeCostGapSync.js`.
- **Join key là MÃ C7 canonical** (vd `135.HTNT-FPT LONG CHÂU`), **KHÔNG BAO GIỜ gửi tên hiển thị**.
  Thiếu C7 → **fail-closed 502 `GAP_SYNC_UNIT_CODE_REQUIRED`**, không lấy tên thay thế.
  → Đây chính là gốc của vòng lặp "báo thiếu oan" kéo dài cả tuần. Đừng nới lỏng.
- Worklist canonical (sort + dedup) → `worklist_checksum` độc lập thứ tự đầu vào.
- `assertNoForbiddenKeys` chặn tiền/%/PII lọt sang DataHub; sanitize `/[\p{Cc}\p{Cf}]/gu`
  (chặn cả C1, zero-width, và RLO giả mạo hiển thị).
- **"Đồng bộ sang DataHub" chỉ GỬI worklist.** DataHub phải thực sự gán % thì mã mới hết —
  code còn nằm đó là bình thường, không phải app hỏng.

### 2.4 Kiểm soát dữ liệu (DQ) — `server/src/employeeCostDataQuality.js`
- ĐVT tương đương khai báo tường minh, fail-closed: hiện chỉ `gói ≡ ống`
  (`DEFAULT_UOM_EQUIVALENTS`). Muốn thêm cặp phải khai, **không suy đoán**.
- Badge số trên 2 tab đọc `exceptionCount` (không phải `count`) và phải truyền `from/to`.

### 2.5 Cột C10
- Xuyên suốt: `catalogManagement.js` → `employeeCost.js` → `web/src/employeeCostModel.js`.
- ‼ Bẫy đã dính: `template.columns` **GHI ĐÈ** `DEFAULT_PREFIX`. Thêm cột vào default là **không đủ** —
  phải chèn vào layout của template nữa, nếu không cột không bao giờ hiện.
- Thiếu C10 → để trống + badge đỏ. **Không suy đoán, không chặn danh mục.**

---

### 2.6 Thông báo tự động Telegram + email — `SPEC_NOTIFY_COST_BONUS_SCHEDULE.md`
Chạy thật từ 28/07/2026. Bộ lịch nằm ở `server/telegram-bot.js` (PM2 `app-report-tgbot`).

| Tin | Giờ (GMT+7) | Module |
|---|---|---|
| Mốc target + mốc thưởng (**gộp 1 tin/người**) | 07:30 ngày | `targetNotify` + `bonusNotify` |
| Digest tổng quan | 07:30 ngày · 13:00 T7 | `telegram-bot.js` |
| Báo cáo doanh thu NGÀY (**số hôm trước**) | 07:30 ngày | `salesReport` |
| Báo cáo doanh thu TUẦN / THÁNG | 13:00 T7 · 18:00 ngày cuối tháng | `salesReport` |
| Tổng chi phí NV tự nhận | 12:30 T7 · **17:30 ngày cuối tháng** | `employeeCostNotify` |
| Tổng thưởng tháng | **17:40 ngày cuối tháng** | `bonusNotify` |

**Cờ bật — fail-closed, phải đúng chuỗi `"1"`:** `TARGET_NOTIFY` · `DIGEST_NOTIFY` (tắt bằng `0`) ·
`EMP_COST_NOTIFY` · `BONUS_NOTIFY` · `SALES_REPORT_NOTIFY` + `SALES_REPORT_DAILY_NOTIFY`.

#### ‼ Bốn cái bẫy đã trả giá — đừng lặp lại
1. **"Không có tiền" ≠ "số 0".** `Number(null) === 0`, và `employeeBonus` trả `baseAmount = 0`
   (số thật) khi dưới ngưỡng. Cả hai đều suýt gửi tin **"0đ"** cho NV. Mọi nơi đụng tiền phải
   phân biệt tường minh *chưa có số* với *số bằng 0*.
2. **Bản tin sáng phải báo số NGÀY HÔM TRƯỚC** (`previousDay(day)`). Lấy "hôm nay" lúc 07:30 thì
   luôn rỗng → gặp chốt "không có dữ liệu thì không gửi" → **câm vĩnh viễn**.
3. **Chặn thông báo dùng ĐÚNG MỘT nguồn:** `targetNotify.isMuted`
   (= `config/notify_optout.json` + cờ `no_auto_notify`). **KHÔNG** dùng `diemXu.EXCLUDE` —
   đó là danh sách *"không tính điểm xu"*, khác mục đích và có DN022 (người CEO chốt phải nhận tin).
4. **Thêm chốt bỏ qua thì phải sửa log tương ứng.** Nếu không, mọi lần bỏ qua hợp lệ đều trông
   như sự cố (`ceo=fail` khi thực ra không có dữ liệu).

#### Bắt buộc trước ngày chốt tháng
```bash
node scripts/test_notify_dryrun.js --all     # chạy y hệt đường thật, KHÔNG gửi gì
```
Hai đường lấy số cho tin cuối tháng chỉ chạy 12:30 T7 / 17:30 / 17:40, và bộ lịch **nuốt lỗi rồi
bỏ qua** — hỏng thì cả công ty không nhận được gì mà không ai biết. Lần chạy đầu đã bắt được
lỗi thật ở bẫy số 1.

#### Ai nhận (chốt 28/07/2026)
- **18 NV** bật công tắc "Chi phí của tôi": `DN001–DN012, DN016, DN017, DN018, DN019, DN022, DN024`.
- **Chặn hoàn toàn:** `DN021, DN023, VP004, VP018`.
- **DN022** nhận đủ như NV chính thức (doanh thu, target, thưởng) nhưng **vẫn không tính điểm xu**.
- Công tắc "Chi phí của tôi" **chỉ** chi phối tin chi phí, **không** chi phối target/thưởng.

## 3. Ba "dây cắm LIVE" (tìm `// TODO(LIVE)`)
1. `auth.js` → OTP (port 3848) + SSO verify (port 3862).
2. `store.js` → slot upload active + fallback ORDS (`SALES_REPORT`), targets (`V_TEM_TARGET_BONUS`).
3. `.env` → `ANTHROPIC_API_KEY` bật AI diễn giải.

---

## 4. An toàn phát hành — `DIRECTIVE_DEPLOY_RELEASE_SAFETY.md`
Bộ script trong `scripts/` (**41/41 PASS**, hiện **đứng độc lập, CHƯA nối vào `auto-deploy.sh`**):

| Script | Việc |
|---|---|
| `release_lib.sh` | hàm dùng chung, fail-closed |
| `release_manifest.sh` | chốt manifest (bắt cả đổi quyền file / UID / GID / `node_modules`) |
| `backup_data.sh` | sao lưu `data/` trước khi động vào |
| `verify_approval.sh` | chặn phát hành chưa duyệt |
| `safe_pm2_cutover.sh` | chuyển PM2 an toàn |
| `safe_rollback.sh` | lùi bản, chạy lệnh **của bản cũ** |
| `test_release_safety.sh` | 41 ca diễn tập |

`auto-deploy.sh` bản `a82381f` đã tự vá 2 nguyên nhân sập ngày 27/07:
đổi `web/dist` **nguyên khối**, chỉ reload backend **khi file server đổi**, build hỏng thì **giữ bản đang chạy**.

---

## 5. Việc còn treo (KHÔNG thuộc App Report)

| Bên | Việc | Trạng thái |
|---|---|---|
| **DataHub** | Gán % cho **8 mã thiếu thật** | Cần **ticket duyệt riêng của CEO** (đụng dữ liệu chi phí) |
| **DataHub** | Đóng/thay worklist cũ `cgw_139caea571e69f1c_202607_202607` | Còn `open`, 0/13 |
| **DataHub** | Siết test âm (bảng `{input, expectedCode}`), revalidate C7 lúc commit | Bot tự nêu |
| **App Sale** | **P1:** validate bất biến V2 **lúc IMPORT**, hỏng thì loại cả lô, giữ bản tốt cuối | REJECT, phải sửa trước |
| **App Sale** | Thêm đơn vị `175.BVĐK Vũng Tàu`; điền crosswalk "hàng nhiều mã" đủ 6 trường (`sub_code`, `master_code`, `sub_uom`, `master_uom`, `relation`, `convert_factor`), map 1-1 không mập mờ | Chờ P1 xong |

Kết quả đã đạt: **13 mã → 8 mã / 11 cặp** (loại 5 báo oan, xác nhận 6 cặp FPT đã có sẵn).

---

## 6. Dọn nhánh — ✅ ĐÃ XONG 27/07

**15 nhánh cũ đã xoá hết** (bot Report thực hiện, có kiểm `origin/main` chứa `a82381f` trước khi xoá).
Claude đã xác minh độc lập: cả 15 ref không còn · `main` vẫn `a82381f`, không mất commit nào ·
6 mốc bắt buộc + P2 bản đúng còn nguyên.

Trong đó 2 nhánh nguy hiểm nhất đã biến mất: `release/bonus-v32-c10` (bản P2 **SAI**, thổi phồng
thưởng — CEO đã bác) và `fix/c7-cost-gap-worklist-20260727` (`b70cab9` — merge vào là mất
sanitizer + badge + perf).

### Đợt 2 — 8 nhánh cũ hơn (19–25/07): xoá 7, GIỮ 1

| Nhánh | Kết luận |
|---|---|
| `fix/c30-freshness-20260719` | main đã có đủ → xoá |
| `fix/c7-canonical-latest-20260727` | main đã có đủ → xoá |
| `fix/ceo-bell-safe-mobile-20260719` | main đã có đủ → xoá |
| `fix/qlnb-unit-workflow-20260719` | main đã có đủ → xoá |
| `fix/report-crosswalk-publication-hardening-20260725` | main đã có đủ → xoá |
| `fix/report-uom-crosswalk-s2s-20260725` | main đã có đủ → xoá |
| `fix/kpi-match-all-display-20260725` | chỉ giữ **bản KPI cũ**; main có bản mới hơn → xoá |
| ‼ `hotfix/report-p0-warm-worker-20260724` | **GIỮ LẠI** — xem dưới |

**‼ `hotfix/report-p0-warm-worker-20260724` là ngoại lệ, ĐỪNG xoá.**
Nhánh này giữ **`server/src/employeeCostWarmWorker.js` — file chưa bao giờ có trên `main`**
(chỉ tồn tại ở đúng commit `c7fa85b`). Đó là hướng giải khác: đẩy warm cache sang **worker thread**,
làm 25/07 00:02 +07. `main` sau đó chọn hướng **vòng warm định kỳ inline** (`0f659d2`, muộn hơn ~16 giờ)
nên bản worker bị bỏ dở. Xoá nhánh = **mất bản duy nhất**. Không ảnh hưởng app đang chạy
(`main` chưa từng dùng), nhưng mất hẳn một phương án tăng tốc dự phòng → **giữ**.

Cách kiểm trước khi xoá bất kỳ nhánh nào (đừng chỉ so dòng — phải so **file**):
```bash
comm -23 <(git ls-tree -r --name-only origin/<nhánh> | sort) \
         <(git ls-tree -r --name-only origin/main    | sort)
```
Ra rỗng = không có file nào chỉ nhánh mới có → xoá an toàn.

**Luật thường trực:** ❌ **Không merge nhánh `release/*` / `fix/*` / `hotfix/*` cũ.** Cần nội dung
nào thì nhặt lại từ `main` hoặc làm mới trên nhánh rẽ từ `main`.

---

## 7. Luật bất di bất dịch (nhắc lại, đã trả giá để có)
1. **Quyền quyết ở backend** — mọi query qua `auth.scopeOf(session)`. Frontend không tự lọc quyền.
2. **Không hardcode PII/nhân viên** trong bundle frontend.
3. **AI không bịa số** — chỉ diễn giải trên FACTS đã tính.
4. **Export đi qua backend** + kiểm quyền.
5. **Fail-closed:** thiếu dữ liệu thì **báo thiếu**, tuyệt đối không đoán, không tự điền %.
6. **C32/C47 khóa vĩnh viễn.** Không gửi tiền/%/PII sang DataHub.
7. **Mọi thay đổi ghi 1 mục vào `CHANGELOG.md`** (mới nhất trên cùng).
8. Chỉ nói **"xong"** khi đã **lên app thật** — không phải khi mới lên `main`.
