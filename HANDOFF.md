# HANDOFF — App Report

Cập nhật: **2026-07-27** (Claude Code). Người tiếp nhận: bot report / phiên Claude kế tiếp.
Đọc theo thứ tự: `CLAUDE.md` → `CHANGELOG.md` (mới nhất trên cùng) → file này.

> ⚠ Bản HANDOFF cũ (01/07) đã lỗi thời nặng: không có module Chi phí, thưởng P1/P2,
> cột C10, đồng bộ "mã thiếu %", Kiểm soát dữ liệu. Đừng dùng lại bản đó.

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

### Còn 8 nhánh cũ hơn (đợt 19–25/07) — CHƯA xoá, chưa ai yêu cầu
Claude đã kiểm từng dòng, **không nhánh nào chứa công bị mất**:

| Nhánh | Kết luận |
|---|---|
| `fix/c30-freshness-20260719` | main đã có đủ |
| `fix/c7-canonical-latest-20260727` | main đã có đủ |
| `fix/ceo-bell-safe-mobile-20260719` | main đã có đủ |
| `fix/qlnb-unit-workflow-20260719` | main đã có đủ |
| `fix/report-crosswalk-publication-hardening-20260725` | main đã có đủ |
| `fix/report-uom-crosswalk-s2s-20260725` | main đã có đủ |
| `fix/kpi-match-all-display-20260725` | main thiếu 2/17 dòng — là **bản KPI cũ đã bị thay** |
| `hotfix/report-p0-warm-worker-20260724` | main thiếu 47/77 dòng — là **hook test warm-worker cũ đã bị thay** |

Cùng loại rủi ro: đều **cũ hơn `main`**, merge nhầm là lùi mất công bên kia.
**Không ảnh hưởng app đang chạy.** Khi nào CEO cho phép thì xoá nốt, dùng đúng lệnh có chốt
`git merge-base --is-ancestor a82381f origin/main` như đợt 15 nhánh.

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
