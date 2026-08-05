# DIRECTIVE — SỬA CỔNG QUYỀN "CEO", KHÔNG ĐƯỢC NỚI CHO ADMIN

> Claude review bản `b01a182` (đã tự rollback về `b49e585`). Ngày 05/08/2026, giờ VN.
> **Kết luận: rollback ĐÚNG. Nhưng nguyên nhân sâu hơn báo cáo, và cách sửa hiển nhiên
> nhất — "cho admin qua" — là SAI, phải cấm.**

---

## 1. Việc rollback: làm đúng

Backup + SHA-256 + PID/restart của bot + xác nhận T06/T07 lệch 0 + notify vẫn tắt —
đủ bằng chứng, không phải báo miệng. Giữ nguyên cách làm này.

## 2. ‼ Phát hiện lớn hơn: luồng duyệt thanh toán ĐANG CHẾT SẴN TRÊN PROD

Báo cáo ghi *"API mới chỉ nhận `ceo`"*. Không chính xác — **API cũ cũng chỉ nhận `ceo`**.
`b01a182` không tạo ra lỗi, nó chỉ **làm lỗi lộ ra**, vì cái chuông thông báo có vòng
lặp gọi lại nên 403 hiện lên màn hình. Trước đó lỗi vẫn có, chỉ là im lặng.

Claude chạy thử trên chính code đang chạy PROD (`b49e585`, là tổ tiên của `main`):

```
{"role":"ceo","emp_code":"CEO"}     → requireCeo: ĐI QUA
{"role":"admin","emp_code":"CEO"}   → requireCeo: 403 CEO_ONLY     ← tài khoản CEO thật
{"role":"admin","emp_code":"VP002"} → requireCeo: 403 CEO_ONLY
{"role":"sale","emp_code":"DN009"}  → requireCeo: 403 CEO_ONLY
```

`auth.requireCeo` đang gác **6 route tiền**: `approve` · `reject` · `unlock` ·
`second` · `record` · `undo` (`routes.js` dòng 2305 · 2323 · 2335 · 2351 trên `main`).
Nghĩa là **tài khoản CEO thật trên PROD không duyệt được bất kỳ khoản nào.**

Vì sao cả tuần không ai kêu: `web/src/pages/PaymentSchedule.jsx:177` để
`canRecord={role === 'ceo'}` ⇒ với tài khoản role `admin`, **nút Duyệt/Từ chối/Mở khoá
không hiện ra**, nên chưa ai bấm để ăn 403. Nút bị giấu che mất cổng bị khoá.

**Đây là lỗi của Claude**, không phải của bản `b01a182`. Ghi ra đây để không ai đi sửa
nhầm chỗ.

## 3. Gốc rễ: repo đang có BỐN định nghĩa "ai là CEO"

| Nơi | Định nghĩa | Đúng/Sai |
|---|---|---|
| `auth.js:624` `isCeo(role)` | chỉ `role === 'ceo'` | ✗ hỏng với tài khoản PROD |
| `routes.js:87` `requireCeoQlnb` | `role==='ceo'` **hoặc** `emp_code==='CEO'` | ✓ |
| `routes.js:3028` | `role==='ceo'` **hoặc** `emp_code==='CEO'` | ✓ |
| `App.jsx:271`, `CeoNotificationBell.jsx:80`, `DormantReports.jsx:89` | hai vế | ✓ |
| `PaymentSchedule.jsx:177` `canRecord` | chỉ `role` | ✗ |

Bốn bản sao của cùng một luật thì kiểu gì cũng có bản lệch. **Sửa từng chỗ là vài hôm
nữa lại nổ ở chỗ thứ năm.**

## 4. ⛔ CẤM sửa bằng cách cho `admin` đi qua

CEO đã chốt **04/08**: *"chỉ duy nhất CEO được phép ghi thôi"* — **admin cũng không**.
Luật này đã khoá bằng test đang chạy, `server/test/paymentLedgerRoutes.test.js`:

```
test('‼ cả 3 route ghi sổ chỉ CEO được vào, admin KHÔNG được', …)
assert.equal(result.passed, false, `role ${role} không được đi qua`)   // role='admin'
```

Nới thành `auth.isAdmin` là **trao quyền duyệt tiền cho mọi tài khoản admin**, và làm
đỏ chính cái test ghi lại lệnh của CEO. Ai định sửa test đó thì dừng lại.

Trong feed thông báo còn nặng hơn: **số tiền chỉ chiếu vào feed CEO**
(`paymentNotifications.js` — `...(ceo && … ? { amount } : {})`). Cho admin vào vai CEO
là **lộ tiền của toàn bộ NV** — phạm thẳng nguyên tắc trong `CLAUDE.md`:
*"KHÔNG để lộ số người khác/tổng payout"*.

## 5. ✅ Cách sửa được duyệt — theo DANH TÍNH, không theo vai trò

### 5.1 Một định nghĩa duy nhất, đặt ở `auth.js`

```js
// Ai là CEO? Hỏi DANH TÍNH, đừng hỏi chuỗi role — role trên PROD là 'admin'.
// Một bản duy nhất. Thêm bản thứ hai ở bất kỳ đâu = tái lập đúng lỗi 05/08.
function isCeoActor(session) {
  return isCeo(session?.role) || CEO_EMP_CODES.has(String(session?.emp_code || '').trim().toUpperCase());
}
```

`CEO_EMP_CODES` đọc từ config/env (mặc định `['CEO']`), **không rải chuỗi 'CEO' khắp code**.

Tài khoản admin khác (vd `VP002`) **vẫn bị chặn** — giữ đúng lệnh 04/08.

### 5.2 Bốn chỗ phải đổi, không hơn

1. `auth.requireCeo` → dùng `isCeoActor(req.session)` thay cho `isCeo(req.session.role)`.
2. Hai route feed thông báo → `const ceo = auth.isCeoActor(req.session)`.
3. `requireCeoQlnb` và `routes.js:3028` → gọi lại `auth.isCeoActor`, **xoá bản chép tay**.
4. Frontend **KHÔNG tự đoán nữa**: `/me` trả thêm `is_ceo` (backend tính bằng chính
   `isCeoActor`), `PaymentSchedule.jsx` dùng `canRecord={me?.is_ceo}`. Ba chỗ frontend
   còn lại đổi theo. Frontend đoán quyền là chuyện đã cấm trong `CLAUDE.md` — lần này
   nó vừa gây ra vụ giấu nút.

### 5.3 ‼ Trước khi code: dán bằng chứng

Cách sửa trên đứng được **chỉ khi** tài khoản CEO trên PROD có `emp_code = 'CEO'`.
Báo cáo mới nói role, chưa nói mã. **Dán đúng hai trường của phiên CEO trên PROD:**

> `emp_code = ____` · `role = ____`   (chỉ hai trường này, KHÔNG dán token/session id)

Nếu `emp_code` **không phải** `CEO` thì đừng tự chế: khai mã thật vào `CEO_EMP_CODES`
rồi báo lại, để CEO biết chính xác tài khoản nào cầm quyền duyệt tiền.

### 5.4 Vòng lặp gọi lại: lỗi RIÊNG, phải sửa dù có đổi quyền hay không

`CeoNotificationBell.jsx` đang `setTimeout(… 20s)` rồi `if (!stopped) schedule()` —
`refresh()` tự nuốt lỗi nên **403 vẫn hẹn giờ gọi lại mãi mãi**. Lỗi quyền là lỗi
**vĩnh viễn**, gọi lại 4.320 lần/ngày cũng không thành công.

Sửa: gặp **401/403 thì DỪNG hẳn vòng lặp**, hiện một câu tĩnh. Lỗi mạng/5xx thì mới
được thử lại, và phải giãn dần (20s → 40s → 80s, trần 5 phút).

## 6. Test bắt buộc có, không có thì không duyệt

1. `isCeoActor`: `{role:'admin',emp_code:'CEO'}` ⇒ **true**; `{role:'admin',emp_code:'VP002'}` ⇒ **false**; `{role:'sale',…}` ⇒ false.
2. Test 04/08 hiện có **giữ nguyên chữ**, chỉ đổi ca `admin` thành `admin + emp_code KHÁC CEO`. **Cấm xoá, cấm nới thành `isAdmin`.**
3. Feed thông báo: phiên admin-không-phải-CEO **không** thấy `amount` của người khác.
4. Đếm số bản định nghĩa: cả `server/src` và `web/src` chỉ được có **một** nơi so chuỗi `'CEO'` cho việc phân quyền — test quét mã nguồn, giống cách `bonusFormulaVersion.test.js` canh version.
5. Chuông: giả lập 403 ⇒ **không có lần gọi thứ hai**.

## 7. Cổng deploy — một câu, CEO chỉ gật

Gói đúng mẫu này, đừng để nguyên chữ "xin duyệt deploy":

> *"Sửa cổng quyền CEO theo danh tính (`emp_code=____`), admin khác vẫn bị chặn ·
> bằng chứng: N test mới xanh, ca `admin+VP002` vẫn 403, chuông dừng sau 403 ·
> lùi được: `git revert <sha>` + gói `app-report-pre-…tgz` đã có SHA-256."*

Kèm theo, ghi rõ **"deploy PASS · acceptance PASS/FAIL"** tách bạch — lần này nghiệm
thu màn hình mới là thứ bắt lỗi, không phải deploy.

## 8. Thứ tự làm

1. Dán `emp_code` + `role` của phiên CEO trên PROD (§5.3) — **chặn mọi bước sau**.
2. Sửa §5.1 → §5.2 → §5.4. Một commit cho quyền, một commit cho chuông.
3. Chạy đủ test §6 + bộ server đầy đủ (nền hiện tại **897/903**, 6 lỗi `pdfinfo` môi trường).
4. Xin duyệt theo mẫu §7. **Chưa gật thì chưa đưa lên PROD.**

‼ Notify Telegram/email **vẫn để tắt** cho tới khi cổng quyền xong — V3 lùi lại sau
việc này. Bật tin tiền trong lúc CEO chưa duyệt được gì là chỉ tổ gây hoang mang.
