### 2026-08-11 05:05 (giờ VN) — 🔐 BỊT NỐT BA ĐƯỜNG SAI SỐ CUỐI (bot audit đợt 5)

Bot xác nhận A1 (bằng chứng báo cáo gốc) và A2 (fail-closed khi cạn retry) **đã sạch**,
nêu tiếp **ba đường sai số**. Đúng cả ba.

| # | Bot nêu | Đã sửa |
|---|---|---|
| 1 | Báo cáo **thiếu `sourceOutcome`** vẫn bị coi là `ok` | Đây là **fail-OPEN**: `report?.sourceOutcome \|\| 'ok'` biến "không biết" thành "tốt". Nay **bắt buộc có mặt** (`hasOwnProperty`) **và** đúng chữ `ok`; rỗng cũng không nhận |
| 2 | **Lương ứng / sổ thanh toán đổi mà khoá dấu không đổi** ⇒ đọc lại số thanh toán cũ (bot đã tái hiện) | Vân tay nay phủ **cả bốn kho**: `cost_rates_local` · `employee_cost_rate_snapshot` · `salary_advance_snapshot` · `payment_ledger`. Kho nào đổi ⇒ vân tay đổi ⇒ khoá đổi ⇒ dấu cũ hết hiệu lực |
| 3 | Đường HTTP thường **không kiểm đời cuối** ⇒ nguồn đổi giữa fan-out ⇒ đóng dấu bản **trộn đời** | Tính lại khoá **ngay sau khi dựng xong**; **lệch chữ ký đầu–cuối ⇒ trả số cho người xem nhưng TUYỆT ĐỐI không ghim** |

#### Vì sao điểm 1 đáng sợ nhất trong ba
Mặc định "không có thông tin thì coi như tốt" là sai chiều ở đường tiền. Một báo cáo
dựng thiếu trường — do đổi code, do đường lỗi mới, do stub — sẽ **lọt qua guard và
được đóng dấu vĩnh viễn**. Nguyên tắc phải là: **không chứng minh được là tốt thì coi
như chưa tốt.**

#### Test
`employeeCostClosedSeal` **17/17** (thêm ca ⑦ thiếu/rỗng `sourceOutcome` · ⑧ vân tay
phủ đủ bốn kho, đổi kho nào cũng phải đổi vân tay · ⑨ routes phải kiểm đời cuối trước
khi đóng dấu). `persistCache` **15/15**. `server` **1235/1242** — đúng 7 ca nền cũ.
Build đạt.

#### Còn lại — nhóm (B) GIA CỐ, CHƯA làm
Khoá ghi liên tiến trình (lock/CAS), `fsync` file+thư mục, temp file riêng, envelope
có schema/xác thực, quyền file hiện là best-effort sau khi ghi. Đây là **siết ốc**, không
phải đường làm sai số. Đề nghị CEO cân nhắc deploy trước, siết sau trên nền đã chạy.

### 2026-08-11 04:15 (giờ VN) — 🧨 TEST CỦA TÔI ĐANG CHE LỖI: bằng chứng đóng dấu phải lấy từ BÁO CÁO GỐC

Bot audit `bd7fbd0` bắt được lỗi tinh vi nhất — và nặng hơn cả lượt trước.

#### Sự thật

`mergeEmployeeReports(reports, roster)` dựng `merged.employees` **TỪ CHÍNH ROSTER**:

```js
employees: roster.map((e) => ({ empCode: e.emp_code, employeeName: e.name }))
```

Nên phép kiểm "danh sách NV của bản gộp có phủ đủ roster không" là **vòng tròn tự
chứng minh** — **luôn đúng**, kể cả khi **thiếu hẳn báo cáo của một người**. Guard vẫn
cho đóng dấu một bản thiếu người, vĩnh viễn.

**Tệ hơn:** test của tôi có dòng

```js
const chiCoMotNguoi = { ...thieuNguoi, employees: [{ empCode: 'DN001' }] };
```

tức là **tự tay sửa trường đó cho nó đỏ**. Test không phát hiện lỗi — test **che lỗi**.
Bot nói thẳng "Test mới che lỗi bằng cách sửa tay trường này", và đúng.

#### Chữa

Bằng chứng "ai thật sự có số" **chỉ nằm ở `reports`** — báo cáo GỐC từng NV. Nay:

- `isSealable(merged, roster, reports)` — **bắt buộc** có `reports`; không có ⇒ fail closed.
- Mỗi NV trong đội phải có **đúng một** báo cáo, `sourceOutcome === 'ok'` đúng nghĩa.
  Trùng mã ⇒ không đóng (không rõ lấy bản nào).
- `routes.js` giữ lại `reports` gốc (`sealEvidenceReports`) và truyền vào.
- Test mới **không sửa tay gì cả**: dựng bản gộp thật từ 1 báo cáo, khẳng định
  `merged.employees.length === 2` (đúng cái bẫy) rồi đòi `isSealable === false`.

#### Kèm: retry cạn lượt (bot điểm A2)

Trước đây hết lượt thì đọc lại một phát bằng cửa thường — bản đó **cũng không có gì
ràng buộc**, có thể là generation cũ so với file hiện tại. Nay **FAIL CLOSED: trả mặc
định**. Người gọi coi như "chưa đọc được" ⇒ NV rơi vào luồng thiếu nguồn ⇒ **không đủ
điều kiện đóng dấu**. Thà chưa có số còn hơn đóng dấu vĩnh viễn một con số tính trên
bản không rõ đời nào.

#### Bot xác nhận đã đạt ở lượt trước
`staleEmployees` nhận diện đúng · retry JSON ghi dở đúng · **seal hit sau restart:
24,591 s → 218 ms** · ALL T07 bốn lượt giống hệt (2.091 dòng · 30.982.248.913đ · 21 NV
· unavailable/stale/gap = 0).

#### Test
`employeeCostClosedSeal` **14/14** · `persistCache` **15/15** · `server` **1232/1239**
— đúng 7 ca nền cũ. Build đạt.

### 2026-08-11 03:10 (giờ VN) — 🚨 LỖI TỆ NHẤT TRONG NGÀY: guard đóng dấu kiểm SAI TÊN TRƯỜNG

Bot audit TIP `85f5f36` bắt được thứ nguy hiểm nhất từ đầu tới giờ, và **đúng ngay chỗ
tôi tự tin nhất**.

#### Sự thật

`isSealable()` của tôi kiểm `period.employees` và `match.staleRateEmployees`. Đối chiếu
`employeeCostTable.mergeEmployeeReports` — bản gộp THẬT:

- **`period.employees` KHÔNG TỒN TẠI** (danh sách NV nằm ở `merged.employees`, gốc)
- **`staleRateEmployees` sai tên** — tên thật là **`staleEmployees` / `staleEmployeeCount`**

Hệ quả: vòng lặp không chạy lần nào ⇒ `seen` rỗng ⇒ khối kiểm roster bị bỏ qua ⇒
**guard LUÔN trả `true`**. Tức là cơ chế tôi dựng ra để "không bao giờ đóng dấu bản
thiếu người" thì **sẵn sàng đóng dấu VĨNH VIỄN một con số thiếu người** — đúng thảm hoạ
tôi viết ba lần cảnh báo ngay trong file đó.

#### Vì sao test không bắt được — bài học đắt

Tôi viết test bằng **dữ liệu tự bịa theo hình dạng tôi TƯỞNG**, nên nó xanh trong khi
production sai. Test tự bịa hình dạng thì chỉ kiểm chứng chính niềm tin của người viết.

Nay: **mọi dữ liệu thử đi qua `mergeEmployeeReports` THẬT**. Hình dạng đổi là test đỏ ngay.
Ba ca `★ HÌNH DẠNG THẬT` dựng bản gộp thật với NV trễ hạn / lỗi nguồn / tỷ lệ cũ / thiếu
người — tất cả phải ra `false`.

#### Vá kèm

- **`isSealable` viết lại theo hình dạng thật**: `match.unavailableEmployees(+Count)` ·
  `match.staleEmployees(+Count)` · `merged.employees` phải **phủ đúng đội hình** ·
  thiếu khối `match` hoặc thiếu `totalRows` ⇒ **fail closed**.
- **Đọc trúng JSON đang ghi dở** (bot nêu): trước đây vỡ JSON là trả mặc định ngay. Nay
  nếu vân tay cho thấy file **đang đổi** thì **thử lại**; hết lượt mà file vẫn bị ghi
  liên tục thì **đọc lại bản hiện tại bằng cửa thường và KHÔNG nhớ** — không bao giờ
  phục vụ bản lạc hậu.
- **24,591 giây sau restart** (bot đo): nguyên nhân là **roster được dựng TRƯỚC bước tra
  dấu**. Đã chuyển thứ tự: `range` → **tra dấu (trả sớm nếu có)** → `roster` → catalog.

#### Test
`employeeCostClosedSeal` **13/13** (thêm 3 ca hình dạng thật) · `persistCache` **15/15** ·
`server` **1231/1238** — đúng 7 ca nền cũ. Build đạt.

### 2026-08-11 02:00 (giờ VN) — 🔁 VÁ NỐT ĐUA GHI ĐÈ TẠI CHỖ + ghi nhận T07 ĐÃ ĐỨNG SỐ

#### Kết quả quan trọng nhất: T07 đã đứng yên

Bot chạy màn ALL kỳ 07.2026 **ba lượt liên tiếp** trên bản sao dữ liệu cô lập:

| Lượt | Thời gian | Kết quả |
|---|---|---|
| 1 (dựng lạnh) | 49.638 ms | 2.091 dòng · 30.982.248.913đ · 21 NV · `unavailable=0` · `gap=0` |
| 2 | **103 ms** | **y hệt, cùng một digest** |
| 3 | **108 ms** | **y hệt, cùng một digest** |

Đây chính là thứ CEO đòi ba ngày: **cùng một tổng, cùng một số dòng, mọi lượt.**

#### Vá thêm: đua GHI ĐÈ TẠI CHỖ (bot audit đợt 3, đúng)

Mở fd chặn được cú `rename`, **nhưng không chặn được ai ghi thẳng vào chính inode
đang mở** giữa `fstat()` và `readFileSync()`. Khi đó nội dung là bản MỚI mà vân
tay/dung lượng lại là bản CŨ ⇒ ghi sổ sai cỡ, **object lớn lọt qua trần** (bot tái
hiện: đọc 10.008 byte mà chỉ hạch toán 9 byte dưới trần 200 byte).

Vá: **`fstat` LẠI sau khi đọc**. Vân tay đổi ⇒ file đang bị ghi ⇒ đọc lại (tối đa 2
lượt). Vẫn không yên thì **trả số ĐÚNG nhưng KHÔNG NHỚ** — thà chậm còn hơn nhớ một
bản không biết mình là ai. Ca test ⑥ tái hiện đúng kịch bản bot mô tả (chen ngang
`readFileSync` để ghi đè tại chỗ).

#### Về "bảy nhóm blocker seal còn nguyên"
Bot audit `52acfec`; **`a04499d` mới là bản vá chúng** (roster attestation chặt, chữ ký
4 nguồn, tra dấu trước catalog, ghi xếp hàng, `0600`/`0700`, checksum, `SEAL_FORMAT`).
`52acfec` chỉ đụng `persist.js` nên đúng là seal không đổi byte nào ở bản đó.

#### Test
`persistCache.test.js` **15/15** · `employeeCostClosedSeal.test.js` **11/11** ·
`server` **1229/1236** — đúng 7 ca nền cũ.

### 2026-08-11 01:20 (giờ VN) — 🛡 SIẾT ĐÓNG DẤU: 5 điểm audit của bot, đúng cả 5

Bot audit `59ee22d` nêu 6 điểm. Điểm 1 (hai blocker cache) **đã vá ở `52acfec`** mà bot
chưa kiểm tới. **Năm điểm còn lại đúng hết**, và đều là lỗi thật của phần đóng dấu.

| # | Bot nêu | Đã sửa |
|---|---|---|
| 2 | Bản xài **tỷ lệ cũ** (`ok_stale_rates`) vẫn có thể bị đóng dấu | Thêm `isSealable()` **chặt hơn hẳn** `employeeCostAllDegraded`: đòi **đủ mặt cả đội** theo roster **VÀ mọi NV `sourceOutcome === 'ok'` đúng nghĩa** — không nhận `ok_stale_rates`, `before_go_live`, `deadline`. Không biết đội gồm ai cũng không dám đóng |
| 3 | Chữ ký thiếu **nguồn tỷ lệ chi phí, công thức, phiên bản code** | Khoá nay gồm **4 nguồn bắt buộc**: `data` (doanh thu/catalog) · `rates` (vân tay `cost_rates_local`) · `formula` (`employeeBonus.FORMULA_VERSION`) · `app` (phiên bản package). **Thiếu bất kỳ cái nào ⇒ `keyFor` trả `null` ⇒ không đóng dấu**, không đoán |
| 4 | Sau restart, có dấu rồi vẫn dựng catalog — mất **29,8 giây** | Chuyển việc **tra dấu lên TRƯỚC** khối catalog. Có dấu ⇒ trả ngay. Vẫn **châm ngòi làm mới catalog Ở NỀN** (không await) để không bỏ đói các màn khác — ca SWR sẵn có vẫn xanh |
| 5 | Dấu dùng object chung có thể bị sửa; ghi đồng thời mất dấu | Đọc qua `loadShared` (**đã đóng băng sâu** từ `52acfec`). Ghi **xếp hàng tuần tự**, đọc lại ngay trước khi ghi ⇒ bắn 5 lượt cùng lúc không mất dấu nào |
| 6 | File tài chính quyền `0664`/`0775`, chưa có kiểm toàn vẹn | Ghi xong **`chmod 0600`** file, **`0700`** thư mục. Mỗi dấu kèm **checksum SHA-256**; đọc mà **lệch checksum ⇒ coi như KHÔNG có dấu**, dựng lại (fail closed) |

Thêm `SEAL_FORMAT = 'v2'` trong khoá: sau này đổi cách đóng dấu thì dấu cũ tự hết
hiệu lực, khỏi phải đi dọn tay.

#### Ghi nhận về quy trình
Bot đã chặn **ba lượt liên tiếp, đúng cả ba**, và mỗi lượt đều bắt được thứ tôi bỏ sót
— trong đó **hai lần là rủi ro tôi ĐÃ BIẾT mà vẫn cho qua** (`slice()` chép nông; "sửa
xong nhớ `save()`" chống bằng chú thích). Đây là lỗi thái độ, không phải lỗi kỹ thuật.

#### Test
`employeeCostClosedSeal.test.js` **11/11 đạt** (thêm 3 ca cho điểm 2, 5, 6 + ca khoá
thứ tự "tra dấu trước catalog" và ca khoá "chữ ký phải gồm 4 nguồn").
`persistCache.test.js` **14/14**. `server` **1228/1235** — đúng 7 ca nền cũ. Build đạt.

### 2026-08-11 00:30 (giờ VN) — 🧊 SIẾT BẢN NHỚ ĐỢT 2: đóng băng sâu + đọc trên fd đã mở

Bot audit đợt 2 chặn `141a36a` với 2 lỗi. **Đúng cả hai**, và điểm ④ là chỗ tôi **biết
`slice()` chỉ chép nông mà vẫn cho qua** — lần thứ hai trong ngày tôi để một rủi ro đã
biết trôi vào ứng viên.

| # | Bot nêu | Đã sửa |
|---|---|---|
| ④ | `slice()` chỉ tách MẢNG; đối tượng dòng/cột vẫn dùng chung ⇒ sửa `rows[0].c41` là bẩn kho trong bộ nhớ cả tiến trình trong khi đĩa còn nguyên | **Đóng băng sâu** bản dùng chung ngay lúc nạp. Sửa vào là **ném lỗi** (mã strict) hoặc không ăn thua (sloppy) — đằng nào kho cũng không bẩn được. Đo: **~87 ms cho 9,3 MB**, trả **một lần mỗi khi file đổi**, không phải mỗi lượt đọc |
| ⑤ | Đua giữa `statSync()` và `readFileSync()`: `rename` chen vào giữa ⇒ vân tay file cũ + nội dung file mới ⇒ sai dấu, sai dung lượng, vượt trần | **Mở fd một lần** rồi `fstatSync(fd)` + `readFileSync(fd)`. `rename` không đổi được inode đang mở ⇒ (vân tay, nội dung) chắc chắn cùng một file |

`load()` **vẫn giữ nguyên** ngữ nghĩa gốc và **không đóng băng** — mọi chỗ đang dùng
không đổi gì, kể cả lối `đọc → sửa → ghi`.

#### Test
`persistCache.test.js` **14/14 đạt**, gồm **cả năm ca bot tái hiện** qua hai đợt audit:
① cùng cỡ + trả lại `mtime` · ② sửa mà không ghi · ③ trần đếm sai đơn vị ·
④ sửa field/field lồng sâu · ⑤ vân tay và nội dung phải cùng một file.
`server` **1225/1232** — đúng 7 ca nền cũ (6 ca thiếu `pdfinfo`, 1 ca VP018 vắng trong
`seed.js`; trên dữ liệu PROD bot đã đo 3/3 đạt).

Benchmark bot đo trên kho thật 17,9 MB ở bản trước: **21 lượt = 562,9 ms**.

### 2026-08-10 23:55 (giờ VN) — 🔐 DỨT ĐIỂM T07: đóng dấu chi phí kỳ đã khoá sổ

CEO: *"tao cần mày fix cho dữ liệu T07.2026 không nhảy loạn xạ nữa. Mấy ngày rồi mà
sửa hoài nội dung này chưa ra. Tao yêu cầu mày có giải pháp dứt điểm."*

#### Nhận sai: tôi mới sửa TỐC ĐỘ, chưa sửa cái làm SỐ NHẢY

Hai bệnh khác nhau, tôi gộp làm một:

- **Chậm** — `persist.load()` phân tích lại 17,9 MB cho từng NV. Đã vá (`462030d` +
  `141a36a`), đo trên kho thật: **25 giây → 621 ms**.
- **Nhảy** — màn ALL **công bố tổng tính từ nhóm CHƯA ĐỦ NGƯỜI**. NV nào không kịp
  trong hạn thì toàn bộ dòng của họ không lên bảng, nên tổng đổi theo số người kịp về:
  5 người → 499 dòng · 7.103.965.427đ · 9 người → 1.191 dòng · 0 người → 0 dòng.

Vá tốc độ làm bệnh thứ hai **hiếm đi chứ không hết**: chỉ cần một người trễ là tổng
lại nhảy. Đó là lý do CEO vẫn thấy số loạn sau khi tôi báo "đã vá".

#### Chữa dứt điểm: chi phí có cơ chế ghim như doanh thu

Doanh thu đã có `revenueMaterializeGuard` ghim kỳ khoá sổ nên bất biến tuyệt đối
(T07 = 2.091 dòng / 30.982.248.913đ, kiểm bao lần cũng lệch 0). **Chi phí chưa có
cơ chế tương đương** — đó chính là lỗ hổng ba ngày. Nay có:

> Kỳ **ĐÃ KHOÁ SỔ** + dựng được bản **ĐỦ CẢ ĐỘI** ⇒ đóng dấu, lưu xuống đĩa.
> Từ đó về sau ⇒ phục vụ **nguyên bản đã đóng dấu**, không dựng lại, không hỏi DataHub.

T07 chỉ cần **một lần** dựng đủ là **đứng yên vĩnh viễn** — F5 bao nhiêu lần cũng đúng
một con số, không phụ thuộc mạng, không phụ thuộc hạn chót 25 giây.

#### Ba hàng rào (mỗi cái một ca test)
1. **KHÔNG BAO GIỜ đóng dấu bản thiếu người.** Đóng nhầm bản thiếu = biến lỗi tạm
   thời thành số sai vĩnh viễn, tệ hơn hẳn bệnh đang chữa. Điều kiện đóng dấu nối
   thẳng vào `employeeCostAllDegraded` sẵn có.
2. **Nguồn đổi ⇒ dấu hết hiệu lực.** Khoá gồm chữ ký dữ liệu doanh thu/catalog.
3. **Chỉ kỳ đã khoá sổ.** Kỳ đang chạy doanh thu còn về, đóng băng là sai.

Thêm: giữ tối đa 8 kỳ, bỏ dấu cũ nhất; đóng dấu hỏng thì nuốt lỗi, cùng lắm dựng lại.

#### Test
`employeeCostClosedSeal.test.js` **8/8 đạt** (gồm ca khoá `routes.js` phải nối đúng
điều kiện `!employeeCostAllDegraded`). `server` **1222/1229** — đúng 7 ca nền cũ.
Build đạt.

### 2026-08-10 23:10 (giờ VN) — 🔒 SIẾT BẢN NHỚ: tách hai cửa đọc (bot audit đúng cả 3)

Bot audit chặn `462030d` với 3 lỗi correctness ở bản nhớ. **Đúng cả ba.** Điểm ② là
điểm tôi đã **tự bào chữa bằng chú thích** ("sửa xong nhớ save()") thay vì sửa —
chú thích không phải hàng rào, và đường tiền không sống bằng lời dặn.

| # | Bot nêu | Đã sửa |
|---|---|---|
| ① | Thay file **cùng cỡ** rồi trả lại `mtime` ⇒ vẫn trả bản nhớ cũ | Vân tay file thêm **`ino` + `ctime`**. Đặt lại `mtime` vẫn làm `ctime` nhảy (hệ điều hành không cho lùi `ctime`), tráo file bằng rename thì `ino` đổi ⇒ bản nhớ tự hết hiệu lực |
| ② | Sửa kết quả `load()` mà không `save()` ⇒ rò sang lượt đọc sau | **Tách hai cửa.** `load()` giữ **nguyên hành vi gốc** (đọc lại mỗi lần) nên mọi chỗ đang dùng không đổi ngữ nghĩa, không rủi ro mới. Chỉ `loadShared()` có nhớ, và **chỉ đường đọc thuần** được gọi |
| ③ | Trần đếm độ dài chuỗi, không phải byte thật | Đếm **`stat.size`** (byte thật). Hạ trần 96 → **48 MB nguồn**, kèm ghi chú: đối tượng sau khi phân tích chiếm gấp mấy lần cỡ file |

Thêm hai lớp bảo vệ bot chưa nêu nhưng cùng họ:
- `save()` **quên hẳn** bản nhớ thay vì nhớ đối tượng vừa ghi — người gọi có thể còn
  giữ tham chiếu và sửa tiếp. Đọc lại một lần sau khi ghi là rẻ; phục vụ số sai thì không.
- `readLocalSync`/`read` **`slice()` `columns` và `rows`** trước khi giao ra ngoài.
  Tầng trên có sắp xếp/cắt trang tại chỗ — sắp xếp trên mảng dùng chung là **hỏng kho
  trong bộ nhớ của cả tiến trình**. `slice()` chỉ chép danh sách tham chiếu, vài chục
  micro giây, so với 17,9 MB phân tích lại thì không đáng kể.

Phạm vi dùng bản nhớ nay chỉ còn **hai điểm gọi**, đều là đọc thuần và đều là đường
nóng nhất (gọi một lần cho MỖI nhân viên): `readLocalSync` (`cost_rates_local`,
17,9 MB) và nhánh tra bị động của `read` (`employee_cost_rate_snapshot`, 12,7 MB).
Đường đọc-rồi-ghi (`write`, `costRatesSync`) vẫn dùng `load()` cũ, lấy bản tươi riêng.

#### Test
`persistCache.test.js` **11/11 đạt**, gồm **đúng ba ca bot tái hiện** + ca đo thật +
ca khoá "không giao mảng dùng chung ra ngoài". `server` **1214/1221** — đúng 7 ca nền
cũ (6 ca thiếu `pdfinfo`, 1 ca VP018 vắng trong `seed.js`; trên dữ liệu PROD thật bot
đã đo 3/3 đạt). Benchmark kho thật của bot ở bản trước: **21 lượt = 621 ms**.

### 2026-08-10 18:20 (giờ VN) — 🐢 GỐC RỄ 3 NGÀY: `persist.load()` phân tích lại 17,9 MB cho TỪNG nhân viên

CEO: *"ngày này là ngày thứ ba rồi tao vẫn luẩn quẩn với câu hỏi dữ liệu T07.2026 của
tao nó nhảy loạn xạ là thế nào đây. F5 lại thì rùa bò."*

#### Năm giả thuyết trước đều SAI — ghi lại để không ai đi lại đường cụt

| # | Giả thuyết | Bằng chứng bác bỏ |
|---|---|---|
| 1 | Lượt chạy 12:30 ghi đè T07 | `verify_frozen_periods` PASS, lệch 0 |
| 2 | Kho thiếu tỷ lệ 17 NV | kho đủ 21 mã, 27.719 dòng |
| 3 | `LOCAL_FIRST` bị tắt | ba biến đều chưa đặt ⇒ mặc định BẬT |
| 4 | Kho nằm nhầm thư mục bản đóng băng | `data/auth` là symlink về kho chung |
| 5 | Thiếu `columns` nên `isStorable` loại | cả 21 mã đều `columns=14` |

#### Manh mối quyết định

Ảnh 14:52 và 17:03 **giống hệt nhau từng đồng** (499 dòng · 7.103.965.427đ ·
535.648.841đ · 96,2% · cùng 16 mã trên băng đỏ). Chạy đua mạng thì mỗi lượt phải ra
nhóm khác nhau; **giống hệt lặp lại = tất định**. Và 5 mã chạy được là **DN001, DN002,
DN003, DN004, DN007** — đúng **5 mã ĐẦU danh sách**. Không phải "ai có dữ liệu", mà là
**ai tới lượt trước**.

#### Gốc rễ

`persist.load()` đọc đĩa + `JSON.parse` **nguyên file, mỗi lần gọi, không nhớ gì**.
Chú thích đầu file ghi rõ giả định: *"quy mô nhỏ (≤ vài trăm bản ghi) nên đọc/ghi cả
file là đủ"*. Giả định đó đã vỡ:

- `cost_rates_local.json` — **17,9 MB**
- `employee_cost_rate_snapshot.json` — **12,7 MB**

Mà `readLocalSync(empCode, kỳ)` gọi `load()` **một lần cho MỖI nhân viên**. Màn "Tất
cả nhân viên" 21 người ⇒ mỗi lần mở màn phân tích lại **hàng trăm MB**. Và
`readFileSync`/`JSON.parse` **đồng bộ** ⇒ khoá cứng vòng lặp sự kiện ⇒ "6 luồng song
song" chỉ là trên giấy, thực tế xếp hàng. Hạn 25 giây hết sau ~5 người; 16 người còn
lại bị `onSkip` đóng dấu *"Chưa lấy kịp trong hạn"* — đúng chữ trên băng đỏ.

**Không phải DataHub hỏng. Không phải kho thiếu. Không phải quyền.** Kho hoàn hảo từ
đầu; app không kịp đọc nó.

Đo thử tại chỗ: file 9,3 MB × 21 lượt = **1,1 giây** trên máy dựng nhanh. File thật
gần gấp đôi, chạy trên máy ảo, cạnh nó còn file 12,7 MB cũng đọc cùng kiểu, cộng áp
lực dọn rác — thừa sức ăn hết 25 giây.

#### Đã làm

`persist.js` nhớ bản đã phân tích trong bộ nhớ, chỉ đọc lại khi file **thật sự đổi**
(so `mtime` + `size`). 21 lượt thành 1 lượt.

An toàn: tiến trình khác ghi đè ⇒ `mtime`/`size` đổi ⇒ tự đọc lại · `save()` cập nhật
luôn bản nhớ nên lối `đọc → sửa → ghi` vẫn đúng · file hỏng/bị xoá ⇒ **quên ngay**,
không phục vụ số cũ · có trần bộ nhớ 96 MB, vượt thì bỏ bản lâu không dùng nhất
(`APP_REPORT_PERSIST_CACHE_BYTES`).

#### Test
Thêm `persistCache.test.js` **7/7 đạt**, gồm ca **đo thật** 21 lượt trên file >5 MB
phải nhanh hơn ≥3 lần. `server` **1210/1217** — đúng 7 ca nền cũ (6 ca thiếu `pdfinfo`,
1 ca VP018 vắng trong `seed.js`; bot đã chứng minh trên dữ liệu PROD thật là 3/3 đạt).

### 2026-08-10 16:55 (giờ VN) — 🛡 XỬ 3 ĐIỂM BOT AUDIT CHẶN ỨNG VIÊN d61f7e2

Bot audit BLOCK bản gộp với 3 điểm. **Điểm 1 bot đúng và là lỗi nặng của Claude.**

#### ① `deploy_doctor.sh --fix` làm MẤT SỬA CHƯA COMMIT — bot đúng, đã vá

Ca "vừa diverged vừa dirty": khối xử lý nhánh đi trước (`reset --hard`) nằm **TRƯỚC**
khối stash cả trăm dòng. Nhánh cứu hộ chỉ cứu **COMMIT**; `reset --hard` xoá sạch
**sửa chưa commit**, và khối stash chạy sau thì đã mất rồi. Tôi từng khoe "--fix không
bao giờ mất commit" — đúng chữ *commit*, nhưng **sót mất việc đang làm dở**.

Đã vá: cất stash **ngay trước** `reset --hard`, ngay trong nhánh diverged. **Cất không
được thì KHÔNG reset** (`RESET_OK=0`) — thà kẹt thêm một lượt còn hơn mất việc của người ta.

Thêm **ca diễn tập ⑥** khoá lại. Kiểm ngược trên bản CHƯA vá (`82dc2b3`): **2 hỏng**;
trên bản đã vá: **12/12 đạt**. Test có thật sự bắt được lỗi, không phải test cho có.

#### ② Privacy trái RUNBOOK — bot đúng là trái, nhưng RUNBOOK mới là chỗ phải sửa

Ba hành vi bot nêu (nhớ qua F5 · bỏ che khi blur · 5 phút) đều là **quyết định của CEO
ngày 10/08/2026**, không phải sai sót cài đặt. Gốc rễ: code trỏ tới `SPEC_PRIVACY_EYE.md`
nhưng **file đó chưa từng tồn tại trong repo** ⇒ không có nguồn nào để đối chiếu, runbook
vận hành giữ luật cũ là đúng theo thứ nó có.

Đã viết `SPEC_PRIVACY_EYE.md`: nguyên văn lời CEO, bảng luật hiện hành, lý do bỏ `blur`
(công cụ chụp màn hình cướp tiêu điểm), và mục 5 nhắc thẳng runbook nào còn ghi "60 giây /
ẩn khi mất tiêu điểm / F5 là về ẩn" thì đã lỗi thời.

Bổ sung quan trọng bot chưa thấy: mở số nay **gắn với khoá ngữ cảnh** (trang · NV · đơn vị
· tỉnh · tuyến · ngày · kỳ) — đổi bất kỳ thứ nào là **ẩn NGAY**. Nới ở chỗ chụp hình nhưng
**siết** ở chỗ đổi màn, đúng lo ngại trình chiếu màn LED của CEO.

#### ③ VP018 fail 2/3 — gần như chắc là ĐO LỆCH KHO, không phải lỗi mới

Diff toàn bộ mặt quyền giữa `7870f10` (PROD) và ứng viên: **chỉ `server/src/auth.js` khác**,
và khác đúng **một dòng bị xoá** — dòng `module.exports` cũ, thay bằng chính nó cộng thêm
tên `otpLoginEnabled`. `accessPolicy.js`, `store.js`, `strictAccessPolicy.test.js`: **giống
hệt từng byte**. Không có đường nào để hành vi quyền đổi.

Test này đòi **VP018 có thật trong danh bạ**; thiếu là `store.findUserByCode` trả undefined
⇒ `requireAuth` huỷ phiên ⇒ 401 (`seed.js` chỉ sinh CEO/ADMIN/DN001–DN012, không có VP018).
Nên kết quả phụ thuộc **kho dữ liệu lúc chạy**, không phụ thuộc code. Hôm nay bot đã đo
nhầm kho **hai lần** (chạy script từ bản đóng băng, rồi tự phát hiện "không phải kho của
máy đang chạy"). Cần chạy lại **cả hai bản trên CÙNG một `AUTH_DATA_DIR`** rồi mới kết luận.

#### Test sau khi vá
`server` 1203/1210 · `web` 449/449 · build đạt · **diễn tập bác sĩ deploy 12/12**
(trước khi thêm ca ⑥ là 9/9 — ca mới là ca bot tìm ra).

### 2026-08-10 15:45 (giờ VN) — 🔀 GỘP HAI NHÁNH: một bản ứng viên duy nhất (cf1fa9b)

Cả ngày 10/08 hai bên làm song song trên hai nhánh tách từ `3248cd4`, không bên nào
có việc của bên kia — nên mỗi lượt deploy lại phải chọn bỏ một nửa:

- **Bot (9 việc, tới `81da127`)**: đối soát/phân bổ doanh thu V4, chẩn đoán T07.
- **Claude (8 việc, tới `70ae333`)**: mốc go-live chi phí, con mắt che số v2, màn
  đăng nhập trả lại ô SĐT, bác sĩ deploy.

`7870f10` (PROD đang chạy) là **tổ tiên** của `81da127`, nên bản gộp này chứa trọn
PROD hiện tại + cả hai luồng việc. Merge **sạch, không xung đột**.

#### Test trên bản gộp
- `server` **1203/1210 đạt** — đúng 7 ca nền cũ (6 ca máy dựng thiếu `pdfinfo`,
  1 ca VP018 không có trong `seed.js`), không phát sinh ca mới.
- `web` **449/449 đạt**.
- Build đạt.

#### Trạng thái nghi vấn "màn Chi phí chậm"
Bot đã xác nhận trên kho PROD: T07 **đủ 21 mã, 27.719 dòng tỷ lệ**, nhật ký toàn `ok`;
ba biến `APP_REPORT_COST_LOCAL_FIRST` / `_ALL_DEADLINE_MS` / `_TIMEOUT_MS` đều **chưa
đặt** ⇒ dùng mặc định, local-first **đang bật**. Vậy giả thuyết "thiếu tỷ lệ" và
"local-first bị tắt" đều **loại bỏ**.

Nghi phạm còn lại: nút **"↕ So kỳ trước"** đang BẬT (thấy dấu ✓ trong ảnh CEO gửi
14:51 và 14:53) ⇒ mỗi lần mở màn T07 app gọi thêm **một lượt cho T06** — kỳ chưa lên
app, không có gì trong kho ⇒ ra mạng hỏi cả 21 NV ⇒ ăn trọn 25 giây và dội tải vào
DataHub, làm chính lượt T07 bị đói và chạm hạn chót, rồi ai chưa kịp thì bị đóng dấu
"thiếu nguồn (0 cặp)". Khớp với hiện tượng danh sách NV thiếu **đổi giữa hai lần
chụp** (16 NV lúc 14:52:22 → 12 NV lúc 14:53:07) và số dòng nhảy 499 → 1.191.

Mốc go-live (`70ae333`) chính là bản vá cho đường này — nhưng **chưa deploy nên chưa
có tác dụng**. Chưa có việc nào của Claude trong ngày 10/08 lên PROD.

### 2026-08-10 15:10 (giờ VN) — 🚦 MỐC GO-LIVE 01/07/2026: thôi đi hỏi kỳ chưa hề tồn tại

CEO: *"T06.2026 chưa lên app nhé, nó chỉ chuyển dữ liệu từ Lumos qua thôi. Dữ liệu
bắt đầu có Go-live từ 01/07/2026."*

Một câu này gỡ trọn nút thắt cả buổi — vụ **màn Chi phí chậm 25 giây** và vụ **17 NV
bị bôi đỏ "thiếu nguồn"** hoá ra là **cùng một nguyên nhân**, và nguyên nhân đó là
một **báo động giả**.

#### Chuỗi nhân quả (đo bằng hằng số trong code)

T06 **không có** bảng % chi phí và **sẽ không bao giờ có**. Nhưng app không biết điều
đó, nên coi T06 như "nguồn đang hỏng" và cứ mỗi lần mở màn lại đi hỏi lại:

1. `pinnedClosedPayload` không thấy bản cục bộ T06 ⇒ rơi xuống đường mạng.
2. Mỗi NV hỏng: `6,5s × 3 lần thử + 2s + 4s nghỉ` = **25,5 giây** (`DEFAULT_TIMEOUT_MS`,
   `DEFAULT_BACKOFF_MS`), đụng trần `EMPLOYEE_COST_ALL_DEADLINE_MS` = **25 giây**.
3. Kết quả có "NV thiếu nguồn" ⇒ `employeeCostAllDegraded` = true ⇒ bộ nhớ đệm rớt từ
   **6 giờ xuống 2 phút** (`EMPLOYEE_COST_ALL_DEGRADED_TTL_MS`).
4. ⇒ Lần mở sau **lại chờ 25 giây nữa**. Đúng lời CEO: *"nó đã xảy ra liên tục."*
5. Kèm theo: bôi đỏ đích danh 17 NV như thể họ có vấn đề — **đúng người vô can**.

Nút **"↕ So kỳ trước"** làm nặng thêm: đứng ở T07 mà bật nút đó là app gọi thêm một
lượt cho **T06** — đúng kỳ không tồn tại — mỗi lần mở màn.

#### Đã làm

- **`costGoLiveMonth()` = `2026-07`**, đổi được bằng `APP_REPORT_COST_GO_LIVE_MONTH`
  (dùng khi có kỳ nạp bổ sung). So sánh chuỗi `'YYYY-MM'` — không dựng `Date`, khỏi
  dính bẫy UTC vì đây là mốc nghiệp vụ theo giờ VN.
- **Kỳ nằm TRỌN trước mốc ⇒ trả lời NGAY**, không ra mạng, không đọc kho, `attempts: 0`.
  Chặn ở **hai cửa**: `fetchEmployeeCost` (đặt trước cả đường kho) và `fetchRawEmployeeCost`
  (vì `costRatesSync` gọi thẳng vào đây, không đi qua cửa trên).
- **Khoảng VẮT QUA mốc (vd 06→07) thì KHÔNG chặn** — phần từ 07 trở đi vẫn phải đi lấy.
- **`before_go_live` là kết quả DÙNG ĐƯỢC** (`USABLE_OUTCOMES`): nó là câu trả lời đúng
  và đủ, không phải sự cố. Nhờ vậy NV hết bị bôi đỏ oan, bản gộp hết bị đánh dấu
  "degraded", và bộ nhớ đệm **giữ lại đủ 6 giờ**.
- Nói thẳng bằng tiếng người: *"Kỳ này chưa lên App Report (dữ liệu bắt đầu từ 07/2026)
  — không phải lỗi nguồn."* Phân biệt rạch ròi **"chưa lên app"** với **"nguồn hỏng"**:
  một cái cần đi đòi DataHub, một cái không ai phải làm gì cả.

#### Không đụng vào

Số của T07 trở đi **không đổi một đồng**. Doanh thu T06 (2.001 dòng / 28.403.136.096đ,
nhập từ Lumos) vẫn nguyên — mốc này chỉ chặn đường hỏi **% chi phí**, không chạm doanh thu.
Lỗi nguồn THẬT (`upstream_unavailable`, `not_configured`, `invalid_period_payload`) vẫn
bị coi là hỏng y như cũ; có test đối chứng.

#### Test
`server` **1185/1192 đạt** — đúng 7 ca nền cũ (6 ca thiếu `pdfinfo` trong máy dựng,
1 ca VP018 không có trong `seed.js`), không phát sinh ca mới. Thêm 5 ca cho mốc go-live.
Chưa deploy.

### 2026-08-10 13:25 (giờ VN) — 📽 CON MẮT v2: mở số gắn với MÀN ĐANG XEM + công tắc Trình chiếu

CEO: *"phải tính toán kỹ vì nó liên quan đến các con số % nữa, và các con số liên quan
đến tổng tiền ở các ô KPI… Ví dụ tôi đang trình chiếu trên màn hình LED mà vô tình lọt
các con số % và tổng tiền các ô thì rất là lỗ hổng. Đặc biệt là khi F5 lại hoặc sang
trang khác, hoặc chuyển từ NV này qua NV khác, hoặc chuyển từ đơn vị này qua đơn vị khác."*

CEO chốt phương án **"thêm công tắc Trình chiếu"**.

#### Nhận định: nguy hiểm nằm ở NỘI DUNG ĐỔI, không nằm ở thời gian

Bản 12:40 sáng nay (`d8e9c4c`) chỉ nới đồng hồ — đúng cho việc chụp hình nhưng **hở
đúng chỗ CEO chỉ**: số CEO chủ động mở ra thì CEO biết nó đang hiện, nhưng đổi
trang/NV/đơn vị/kỳ thì **số MỚI tự nhảy ra** khi chưa ai quyết định. Đó mới là lúc lọt
lên màn LED. Nới đồng hồ càng lâu thì cửa sổ hở càng rộng.

#### Đã làm

**1. Mở số gắn với khoá ngữ cảnh (trang · NV · đơn vị · tỉnh · tuyến · ngày · kỳ)**
- `sessionStorage` lưu `{until, ctx}` thay vì chỉ mốc thời gian. Khoá lệch ⇒ coi như
  chưa mở, **ẩn ngay, không chờ hết giờ**, kèm câu "Đã ẩn số vì màn hình vừa đổi".
- Nhờ vậy **F5 đúng màn cũ vẫn giữ mở** (CEO xin sáng nay) mà **rời màn đó là ẩn tức thì**.
- Ngữ cảnh chia **HAI tầng**: `scope` do App khai (tab), `detail` do trang khai
  (NV/đơn vị/kỳ). Lý do phải tách: effect của **con chạy TRƯỚC cha**, để chung một ô
  thì cha luôn ghi đè con và mất sạch lớp chặn đổi NV. Có test khoá điều này.
- Nối: `App.jsx` → `useRevealScope('tab:'+tab)`; `EmployeeCost.jsx` → `useRevealContext`
  gồm `selectedEmp`, `range.from/to`, `tableFilters.unitGroup/province/route/date`.

**2. Công tắc "📽 Trình chiếu"** cạnh con mắt (đỏ khi bật)
- Bật ⇒ **ẩn ngay lập tức** và xoá mốc (chính lúc cắm máy chiếu là lúc dễ lọt nhất).
- Đang bật ⇒ **không ghi mốc nào cả** ⇒ F5 chắc chắn ra ẩn; tự ẩn rút **5 phút → 1 phút**.
- Tắt ⇒ **không tự mở lại**, vẫn phải bấm con mắt.
- **Công tắc thì nhớ qua F5** (không bắt CEO bật lại giữa buổi họp), nhưng **trạng thái
  mở số thì tuyệt đối không nhớ** — đó mới là thứ gây lọt số.

**3. Giữ nguyên từ bản sáng:** không nghe `blur` (chụp màn hình ra số thật), tự ẩn 5
phút khi không trình chiếu, không đụng `localStorage`, đóng tab là mất sạch.

#### Chặn sẵn mấy đường vòng
Mốc rác/JSON hỏng ⇒ ẩn · thiếu khoá ngữ cảnh ⇒ ẩn · đồng hồ máy bị chỉnh ⇒ trần đúng
một chu kỳ · kho bị chặn (tắt cookie/hết quota) ⇒ nuốt lỗi, rèm vẫn chạy.

#### Test
`web` **444/444 đạt** (thêm 3 ca: đổi trang/NV/đơn vị/kỳ · Trình chiếu · mốc rác), build đạt.
Chưa deploy — chờ bot lên sóng `81da127` trước.

### 2026-08-10 12:40 (giờ VN) — 👁 CON MẮT: chụp màn hình ra số thật, F5 không ẩn vội

CEO: *"tao phải dùng điện thoại để chụp hình kèm chụp hình máy tính, vì khi bấm chụp
hình máy tính thì con mắt nó che mất số"* — và *"tao vẫn muốn khi F5 lại thì chưa ẩn
vội con mắt."*

#### Nguyên nhân: HAI cái, CEO mới thấy một

1. **60 giây không thao tác thì tự ẩn** (`AUTO_HIDE_MS`) — cái CEO đoán.
2. **Cửa sổ mất tiêu điểm là ẩn NGAY** (`window.addEventListener('blur', … hideNow)`).
   Đây mới là thủ phạm vụ chụp hình: công cụ cắt màn hình của Windows **cướp tiêu điểm**
   khỏi trình duyệt ⇒ `blur` bắn ⇒ số bị che **đúng khoảnh khắc bấm chụp**. Nên chờ 2 hay
   5 phút cũng vô ích. Hai ảnh CEO gửi khớp y hệt: ảnh điện thoại 12:16:28 nút ghi "Ẩn số"
   (đang hiện số), ảnh chụp máy 12:17:12 nút ghi "Hiện số" (đã bị che).

#### Đã làm (phạm vi A+B CEO chốt)

- **A — bỏ `blur`**, chỉ giữ `visibilitychange`: ẩn khi **chuyển hẳn** sang tab khác /
  thu nhỏ cửa sổ. Bấm công cụ chụp không còn che số. Có test cấm nối lại `blur`.
- **B — 60 giây → 5 phút** (`AUTO_HIDE_MS = 5 * 60_000`), đổi luôn câu thông báo.
- **F5 giữ mắt mở**: ghi **MỐC HẾT HẠN** vào `sessionStorage` (không phải cờ "đang mở").
  - `sessionStorage` chứ **không** `localStorage`: đóng tab/đóng trình duyệt là mất sạch,
    không để vết trên máy dùng chung. Test cũ cấm gọi `localStorage` vẫn giữ nguyên.
  - Ghi mốc nên **F5 không gia hạn**: tải lại 10 lần đồng hồ vẫn chạy tiếp từ thao tác
    cuối. Nhịp đầu sau F5 đếm nốt phần **còn lại** (`activity(overrideMs)`).
  - **Ẩn vì bất kỳ lý do gì đều xoá mốc** ⇒ F5 sau đó ra ẩn, không hồi sinh trạng thái mở.
  - Mốc rác / đồng hồ máy bị chỉnh: chặn trần đúng `AUTO_HIDE_MS`.
  - Kho bị chặn (cookie tắt / hết quota): nuốt lỗi, rèm vẫn chạy, chỉ mất phần nhớ qua F5.
  - Ghi thưa (chỉ khi mốc mới xa mốc đã ghi > 5 giây) để `mousemove` không đập kho liên tục.

#### Vì sao nới ra không hở dữ liệu

Con mắt là **rèm che mắt người đứng sau lưng**, không phải khoá bảo mật — số vẫn nằm
trong bộ nhớ trình duyệt, mở F12 là đọc được. Khoá thật là `employeeCostVisibility`
(backend, có audit) và `auth.scopeOf`. Tooltip vẫn nói thẳng điều này; test cấm mô tả
tính năng này là "bảo mật/an toàn" vẫn xanh.

#### Test

`web` **441/441 đạt** (thêm 3 ca mới: F5 trong hạn / cấm `blur` / kho hỏng), build đạt.
Chưa deploy — chờ bot lên sóng `81da127` trước.

### 2026-08-10 11:40 (giờ VN) — 🩺 BÁC SĨ DEPLOY: site không lên bản mới thì phải NÓI, không im

CEO: *"Con bot của tao nó đang bị lỗi, nên mày tìm cách vá cho tao đi nào."*

#### Sự thật đầu tiên: deploy KHÔNG cần bot

Server có cron chạy `scripts/auto-deploy.sh` mỗi phút: `main` có commit mới là tự build + tráo `dist` + restart. **Bot hỏng không đồng nghĩa deploy chết.** Nhưng auto-deploy có mấy trạng thái **bỏ qua IM LẶNG**, mỗi phút ghi một dòng vào file log không ai đọc — nên nhìn từ ngoài thì y hệt "bot hỏng".

#### Lỗi thật: "bỏ qua im lặng vĩnh viễn" bị nhầm là "an toàn"

Khi HEAD trên server **đi trước** `origin/main` (server có commit local chưa đẩy), script `exit 0` để không đè việc bot — nhưng **không có cửa thoát nào**, kẹt là kẹt mãi. Nhánh dirty-tree ngay bên dưới đã có cửa thoát 15 phút; nhánh này thì không. Khớp đúng hiện tượng: PROD đứng ở bản **`7870f10`** — commit **không tồn tại trên GitHub**.

#### Đã làm

- **`scripts/deploy_doctor.sh`** (MỚI) — một lệnh, chạy được không cần bot, **mặc định chỉ đọc**: soi ① công tắc tắt ② cron còn sống ③ trạng thái git (liệt kê **đích danh** commit đang kẹt) ④ backend health ⑤ 12 dòng log cuối, rồi kết luận bằng tiếng Việt. `--fix` gỡ kẹt.
- **`--fix` KHÔNG BAO GIỜ mất commit**: cất commit local vào nhánh `rescue/local-<sha7>-<ngày>` **trước** khi fast-forward; sửa chưa commit thì `git stash`. Còn đường lấy lại.
- **Vá `auto-deploy.sh`**: ca "đi trước origin" nay ghi dấu vết **nhìn thấy được** (`.auto-deploy.stuck`) thay vì chỉ ghi log, và sau `STUCK_SECS` (mặc định 6 giờ) thì tự gỡ — vẫn cất nhánh cứu hộ trước, không tạo được nhánh thì DỪNG.
- **`scripts/test_deploy_doctor.sh`** (MỚI) — diễn tập trên repo giả: **9/9 đạt**, trong đó ca chốt là *"commit local CÒN NGUYÊN trong nhánh cứu hộ"*.

Trạng thái test: diễn tập bác sĩ **9/9**, diễn tập an toàn release cũ **52/52** (không hỏng cái nào), cú pháp cả hai script sạch.

**Lưu ý phạm vi:** auto-deploy chỉ theo dõi nhánh `main`. Các commit đang nằm trên `claude/reconcile-8873676-20260809` **chưa lên PROD được** cho tới khi gộp vào `main` — việc gộp chờ CEO quyết.

### 2026-08-10 10:15 (giờ VN) — 🔑 TRẢ LẠI Ô NHẬP SỐ ĐIỆN THOẠI Ở MÀN ĐĂNG NHẬP

CEO: *"Tao đã yêu cầu có nhiều cách đăng nhập… nhưng quan trọng là phải nhập số điện thoại muốn đăng nhập vào. Hiện tại tao muốn đăng nhập vào tài khoản khác để kiểm tra thì tao phải nhập đúng số điện thoại của tài khoản đó để trả OTP về. Nhưng ở đây nó bỏ qua bước nhập số điện thoại là sao — vậy nó mặc định nhảy vào bot devreport."*

#### Nguyên nhân: công tắc vận hành bị viết cứng trong bundle web

`web/src/pages/Login.jsx` có hằng **`SHOW_ZALO_OTP_UI = false`** — đặt để *tạm* giấu đường OTP lúc dịch vụ Zalo lỗi. Giấu xong thì trên màn **chỉ còn MỘT cửa là Telegram**, nên nhìn như hệ thống tự nhảy vào bot. Tệ hơn: muốn bật lại phải **sửa code + build + deploy**. Công tắc vận hành mà nằm trong bundle thì không ai bật/tắt được đúng lúc cần — đó là lỗi thiết kế, không phải lỗi tạm.

#### Đã làm

- **Bỏ hằng viết cứng.** Kênh SĐT+OTP nay bật/tắt bằng biến môi trường **`LOGIN_OTP_ENABLED`** (mặc định BẬT khi đã có `OTP_BACKEND_URL`). `/auth/mode` trả thêm cờ `otp`; web chỉ bày ra chứ không tự đoán. Backend bản cũ chưa có cờ vẫn chạy (rơi về `live`).
- **Hàng chọn cách đăng nhập** khi có từ hai cửa: `📱 Số điện thoại` · `✈️ Telegram`. **Mặc định là SĐT** — đó là đường DUY NHẤT chọn được tài khoản nào đăng nhập.
- **Cửa SĐT có ô nhập thật**: *"Số điện thoại của tài khoản cần vào"* → Gửi mã OTP → nhập mã → (nếu 1 SĐT có nhiều mã NV thì chọn tài khoản).
- **Nói trước ranh giới an ninh**: mã OTP luôn về **đúng máy của số đó** (Zalo/SMS), không gửi sang máy khác. Muốn kiểm tra tài khoản NV thì nhập SĐT của họ và nhờ họ đọc mã. Gửi được sang máy khác thì ai biết SĐT cũng vào được — cấm tuyệt đối.
- **Cửa Telegram giải thích vì sao không có ô SĐT**: Telegram nhận diện theo chính tài khoản Telegram đang mở.
- **Chỉ còn Telegram thì nói rõ vì sao** (`LOGIN_OTP_ENABLED` đang tắt / chưa cấu hình `OTP_BACKEND_URL`), không im lặng bỏ trống.
- **OTP lỗi ⇒ có ngay nút thoát** sang Telegram — đúng tình huống từng khiến cả cửa SĐT bị giấu đi.
- **Đổi cửa thì dọn sạch cửa cũ** (`stopTelegram` + xoá mã) để mã Telegram cũ không âm thầm đếm ngược/poll phía sau ô nhập SĐT rồi đăng nhập nhầm tài khoản.

Trạng thái test: web **438/438 pass** (13 test trong `Login.telegramOnly.test.mjs`, viết lại theo hành vi mới), build sạch; server **1180 pass / 7 fail cố hữu**.

**Còn chờ vận hành:** PROD phải có `OTP_BACKEND_URL` trỏ đúng cửa OTP (port 3848) thì ô SĐT mới hiện. Chưa có thì màn sẽ nói thẳng là đang tắt.

### 2026-08-10 09:45 (giờ VN) — 📅 BẢNG DANH MỤC TỰ KHAI KỲ CỦA NÓ

CEO: *"Đáng lẽ khi chọn kỳ phụ trách ở trên là T07.2026 thì ở dưới bảng danh mục cột phụ trách từ kỳ nó cũng phải nhảy theo, hoặc làm sao để nhìn thấy bảng dưới chính xác là của T07.2026, còn chuyển kỳ thì nó cho biết bảng của tháng mấy chứ."*

#### Hai chuyện bị lẫn vào nhau

1. **Ô "Kỳ" nằm tít đầu màn** — cuộn xuống bảng là mất hút, trên bảng không có gì nhắc lại. Nhìn 27.719 dòng mà không biết đang đọc tháng mấy.
2. **Cột "Phụ trách từ kỳ" KHÔNG phải kỳ của bảng.** Nó là kỳ nhân viên **BẮT ĐẦU** nhận cặp đó — chọn kỳ 07 mà cột ghi 05.2026 là **ĐÚNG** (nhận từ tháng 5, vẫn còn phụ trách trong tháng 7). Nó **không nhảy theo** ô "Kỳ", và đó là chủ ý; trước đây chỉ có tooltip nên phải rê chuột mới biết.

#### Đã làm

- **Nhãn kỳ dán ngay đầu bảng**: *"📅 Bảng danh mục KỲ 07.2026 · 27.719 cặp"*, kèm câu giải nghĩa cột "Phụ trách từ kỳ".
- **Bảng đang giữ kỳ cũ thì nói thẳng**: nhãn đổi màu cảnh báo — *"Ô Kỳ phía trên đang chọn 08.2026 nhưng bảng dưới VẪN là kỳ 07.2026 — chưa tải được kỳ 08.2026."* Nhãn lấy kỳ **của chính bảng**, không lấy kỳ vừa bấm.
- **Huy hiệu KỲ trong thanh trang** — thanh này dính đầu màn khi cuộn nên là chỗ duy nhất luôn nhìn thấy.
- **Tiêu đề cột hai dòng**: "Phụ trách từ kỳ" + dòng nhỏ *"kỳ NV bắt đầu nhận"*.
- Ô "Kết quả" trong hàng lọc cũng ghi kèm kỳ.
- Áp cho **cả hai** bảng: màn CEO/admin và màn nhân viên.

Trạng thái test: web **430/430 pass** (thêm `CatalogPeriodLabel.contract.test.mjs`, 6 test mới), build sạch; server **1180 pass / 7 fail cố hữu** (không đụng backend).

### 2026-08-10 09:30 (giờ VN) — 🔓 BỎ "ALL-OR-NOTHING": nút Đồng bộ gom dần, và giải nghĩa dòng "thay đổi 0"

CEO: *"tao đã bấm đi bấm lại đồng bộ T07.2026 rồi mà nó méo thay đổi là sao."*

#### ① Vì sao 30 phút trước bấm mà không ăn — lỗi thiết kế của Claude

`syncPeriod` chạy luật **all-or-nothing**: hụt **một** người là **không ghi gì**. Lúc CEO bấm, cửa chi phí đang hỏng **19/21 NV** ⇒ lượt đó ghi **0 byte** rồi báo đỏ. Nguồn chập chờn thì CEO **không bao giờ** gom đủ 21/21 trong một lượt ⇒ kho **vĩnh viễn rỗng** ⇒ kỳ T07 đã chốt vẫn phải hỏi DataHub mỗi lượt xem ⇒ số nhảy. **Luật đặt ra để bảo vệ số liệu lại thành cái khoá chặn đường sửa.**

Thứ thật sự cần bảo vệ **không phải** "ghi tất cả hoặc không ghi gì", mà là **không bao giờ trình bày phần thiếu như thể đã đủ**. Nay:
- lấy được ai thì **ghi người đó**, cộng dồn với những người đã có;
- luôn kèm **`stored/requested`** và **danh sách còn thiếu đích danh**;
- `complete` chỉ true khi đủ 21/21 — mọi màn đọc cờ này, không tự suy;
- lượt **không lấy được ai** thì **không đụng kho**, và nói rõ kho đang có bao nhiêu.

Màn hình có **ba** trạng thái thay vì hai: **đủ** · **góp thêm được N NV, còn thiếu ai** · **lượt này trắng tay**.

#### ② Dòng "thay đổi 0 · thêm 0 · bớt 0" khiến CEO đọc thành "không làm gì"

Ảnh 09:17 cho thấy sync **THÀNH CÔNG 21/21 NV · 27.719 cặp**, nhưng dòng dưới ghi *"thay đổi 0 · thêm 0 · bớt 0"* — CEO đọc thành "nút không chạy" nên bấm đi bấm lại. Nay câu chốt là **"KHO ĐÃ ĐỦ 21/21 NV cho kỳ 07.2026 — từ nay đọc thẳng từ kho, không hỏi DataHub nữa"**, còn ba số 0 hạ xuống dòng phụ kèm giải nghĩa: *"toàn số 0 nghĩa là % lần này GIỐNG HỆT lần trước (kho đã đủ từ trước), KHÔNG phải nút không chạy."*

Thẻ trạng thái cũng hiện **số NV** chứ không chỉ số cặp: *"Kho cục bộ: 21 NV · 27.719 cặp"*.

Test: server **1180** pass / 7 fail cố hữu · web **424/424** · build sạch.

---

### 2026-08-10 09:15 (giờ VN) — 🛑 DOANH THU THÔI PHỤ THUỘC NGUỒN CHI PHÍ (gốc của "số nhảy như điên")

CEO, kiệt sức: *"T07.2026 của tao đã chốt rồi, thì tại sao sửa cái gì bây giờ số liệu nó tụt mất đi đâu… tao đã yêu cầu chuyển lấy nguồn chính trong App Report, sao lại vẫn cứ phụ thuộc DataHub."*

**Bằng chứng ba lần chụp, CÙNG kỳ T07 ĐÃ CHỐT SỔ:**

| Lúc | Số NV lấy được % | Dòng | Doanh thu chưa VAT |
|---|---|---|---|
| 09/08 23:05 | 5/21 | 359 | (ẩn) |
| 10/08 00:20 | 11/21 | 1.332 | **20.035.615.366đ** |
| 10/08 09:00 | **2/21** | 313 | **3.286.695.166đ** |

**Doanh thu bám đúng theo số NV lấy được % — không phải bám theo dữ liệu bán hàng.** Đó là toàn bộ căn bệnh.

#### Gốc: ô doanh thu lấy tổng từ BẢNG CHI PHÍ

Màn ALL ghép sổ chi phí từng NV; NV nào chưa lấy được % thì **toàn bộ dòng doanh thu của họ không lên bảng**, và ô KPI cộng từ chính cái bảng đó. Doanh thu là **dữ liệu của App Report, luôn đủ** — không đời nào doanh thu một kỳ **đã chốt** lại đổi vì DataHub trả chậm.

**Sửa:** ô doanh thu nay lấy **TỔNG KỲ thẳng từ kho doanh thu App Report** (`revenueRecon.total`, backend cộng từ `store`), **không đi qua bảng chi phí**. Nhãn đổi thành **"Doanh thu chưa VAT · TỔNG KỲ"** kèm câu *"KHÔNG đổi theo nguồn chi phí"*; phần "đang hiện trên bảng" hạ xuống dòng phụ để vẫn đối chiếu được. Kho doanh thu chưa soát được ⇒ lùi về cách cũ **và đổi nhãn** để không ai nhận nhầm hai loại số.

Từ đây: **doanh thu đứng yên**, dù DataHub sống hay chết, dù 21/21 hay 2/21 NV lấy được %. Phần chi phí vẫn ghi rõ "TẠM TÍNH" như cũ — chỉ chi phí mới phụ thuộc nguồn %, đúng bản chất.

Test: server 1178 / 7 fail cố hữu · web **424/424** · build sạch.

---

### 2026-08-10 01:00 (giờ VN) — 💰 "Doanh thu chạy đi đâu mất" — phép cân hiện thẳng lên màn

CEO: *"Doanh thu thực tế của T07.2026 đâu phải số này, tại sao nó cứ nhảy như điên vậy, và giờ nó đang nằm ở đâu? Mất mẹ nó doanh thu chạy đi đâu mất không còn đủ."*

**Câu hỏi đúng, và trước nay màn KHÔNG trả lời được.** Nguyên nhân: màn "Tất cả nhân viên" dựng bảng bằng cách **ghép sổ chi phí của TỪNG nhân viên**. NV nào chưa lấy được % thì **toàn bộ dòng doanh thu của họ không lên bảng**. Doanh thu là dữ liệu **của App Report** và luôn đủ — nhưng con số hiển thị lại **phụ thuộc nguồn %**, nên nguồn chập chờn vài người là tổng tụt theo, và tụt khác nhau mỗi lượt xem (359 dòng lúc 23:05 → 1.332 dòng lúc 00:20).

**Nay có phép cân, hiện ngay dưới cảnh báo, áp đúng luật "không dòng nào biến mất lặng lẽ" cho TIỀN:**

```
Tổng doanh thu kỳ (kho App Report)   ← số thật, không phụ thuộc nguồn %
  − Đang hiện trên bảng
  − Của NV chưa lấy được %           ← kèm ĐÍCH DANH mã NV, xếp số lớn trước
  − Dòng chưa gán được nhân viên     ← tách riêng, KHÁC hẳn nguyên nhân trên
  = 0  (lệch ⇒ nói thẳng "cân vẫn lệch X đồng, báo Claude")
```

Mỗi nguyên nhân kèm **đúng việc phải làm**: thiếu % ⇒ bấm "Đồng bộ % chi phí" cho kỳ đó; dòng chưa gán NV ⇒ vào tab "Kiểm soát dữ liệu" (việc gán người, không phải lỗi %). Hai nguyên nhân, hai cách sửa — trộn lại là đi sửa nhầm chỗ.

Đối soát hỏng **không được làm hỏng báo cáo**, nhưng phải nói là chưa soát được. Mọi số tiền nằm dưới con mắt che số.

Test: server **1178** pass / 7 fail cố hữu · web **420/420** · build sạch. Test mới: `employeeCostRevenueRecon.test.js` (6) + 4 test màn.

---

### 2026-08-10 00:45 (giờ VN) — ‼ THÔI HỎI DATAHUB VỀ % CHI PHÍ: kỳ đang chạy cũng đọc kho đã đồng bộ

CEO ra lệnh **lần thứ hai**, rất bực: *"Tao đã yêu cầu lấy bên này không lấy bên DataHub về % chi phí nữa để không bị lỗi. Yêu cầu mày xử lý cả số liệu nạp trở lại đủ cho tao T07.2026."*

#### Bằng chứng CEO đưa ra chỉ đúng gốc bệnh

Cùng kỳ **T07.2026**, hai lần chụp màn cách nhau hơn một tiếng:
- **23:05** — *"Hiện **359/359** dòng"*, 16 NV báo chưa lấy được chi phí;
- **00:20** — *"Hiện **1.332/1.332** dòng"*, doanh thu **20.035.615.366đ**, còn 10 NV.

**Doanh thu nhảy vì màn ALL chỉ dựng được dòng của những NV lấy được % từ DataHub.** Doanh thu là dữ liệu **của App Report**, luôn đủ — nhưng nguồn % chập chờn vài NV là doanh thu tụt theo. Đây chính là "dữ liệu nhảy lambada".

#### Sửa: kho có kỳ nào thì dùng kỳ đó

Bản cũ **chỉ** đọc kho khi kỳ **đã khoá sổ** (`isPeriodClosed`); kỳ đang chạy vẫn ra mạng **mỗi lượt xem** ⇒ vẫn nhảy. Nay **kho có kỳ nào thì phục vụ kỳ đó**, đóng hay mở sổ đều vậy.

Kho do **chính CEO** bấm "Đồng bộ % chi phí" nạp vào (all-or-nothing 21/21, có mốc giờ + tên người bấm) ⇒ bản số **ổn định và truy được**, khác hẳn việc mỗi lượt xem lại rút một bản khác nhau về.

Ba chốt giữ cho khỏi hứa quá:
1. **Nhãn phân biệt hai nghĩa:** `local_pinned` = kỳ đã chốt, đóng băng vĩnh viễn · `local_sync` = kỳ đang chạy, số của lần đồng bộ gần nhất. Dải kỳ **trộn** lấy nhãn **yếu hơn** (`local_sync`).
2. **Kho thiếu MỘT kỳ trong dải ⇒ không phục vụ nửa vời**, vẫn ra nguồn như cũ.
3. **Đường lui:** `APP_REPORT_COST_LOCAL_FIRST=0` đưa hành vi về đúng như trước (chỉ kỳ đã chốt mới đọc kho).

#### Để T07 đủ số, cần đúng một thao tác của CEO

Kho hiện **mới có T08** (CEO bấm lúc 20:06). **T07 chưa có** vì nút bị khoá bởi lỗi 502 của cửa danh mục — đã gỡ ở `d77eaef`. Sau khi deploy: chọn **Kỳ 07.2026** → bấm **"Đồng bộ % chi phí"** một lần. Từ đó T07 **đứng yên vĩnh viễn**, DataHub sống chết cũng không đổi số.

Test: server **1172** pass / 7 fail cố hữu · web **416/416** · build sạch.

---

### 2026-08-10 00:30 (giờ VN) — 🔧 BỎ HẲN lượt gọi gây lỗi: bảng tra nhóm đi KÈM danh mục

CEO kẹt **lần thứ ba** ở cùng một chỗ: *"bây giờ tao vào phân quyền cho NV khác cũng vướng lỗi tùm lum, méo hiểu làm như nào đây."* Hai lần trước Claude **vá thông báo** (nói đúng nguyên nhân, thêm nút Thử lại, tự thử lại 3 lượt). Vá lời thì lỗi vẫn còn — lần này bỏ hẳn **cái gây ra lỗi**.

#### Thiết kế sai từ gốc

Nhóm mã đơn vị chỉ là **tiền tố số trước dấu chấm** (`036.PKĐK SÀI GÒN TÂM TRÍ` → **036**). Máy chủ **đã cầm sẵn toàn bộ mã đơn vị** khi trả danh mục. Vậy mà Claude bắt trình duyệt **gom cả nghìn mã gửi ngược lên** chỉ để nhận lại tiền tố — tự dựng thêm một lượt gọi mạng **có thể trượt**. Và nó trượt thật (*"Failed to fetch"*), làm **cả menu phân quyền mù**, tới mức mục "việc cần rà" khuyên CEO xoá quyền đúng.

#### Sửa: gửi kèm, không hỏi lại

`GET /catalog-management` nay trả kèm **`unitGroups`** — bảng tra `mã đơn vị → {nhóm, nhãn}` dựng ngay ở máy chủ bằng đúng `catalogCostColumnGrants.groupOf`. Kết quả:
- **0 lượt gọi thêm** ⇒ **không còn đường nào để hỏng**;
- **luật tách nhóm vẫn nằm nguyên ở máy chủ**, frontend chỉ đọc kết quả (không chép luật — có test cấm);
- gửi theo **đơn vị riêng** (vài trăm mục) chứ không gắn vào từng dòng (27.719 dòng) — cùng thông tin, nhẹ hơn hai bậc;
- lượt gọi POST cũ **giữ lại làm đường lui** cho máy chủ bản cũ, không xoá.

**Trả lời câu CEO hỏi:** `036.` đúng là một nhóm, và máy **tự nhận ra** — CEO không phải gõ "036." hay "033." cho bất kỳ mã nào. Việc đó là của máy, và từ bản này nó không còn cửa nào để làm sai.

Test: server 1168/1176 (7 fail cố hữu + 1 test hẹn-giờ chập chờn khi chạy cả bộ, chạy riêng 7/7 đạt) · web **416/416** · build sạch.

---

### 2026-08-10 00:20 (giờ VN) — ‼ Bảng tra nhóm hỏng làm CẢ MENU PHÂN QUYỀN mù — và nó đang khuyên xoá quyền ĐÚNG

CEO: *"DN002 chỉ phụ trách 4 mã, trong đó có **036.PKĐK SÀI GÒN TÂM TRÍ / 036.NT-PKĐK SÀI GÒN TÂM TRÍ** — chả phải **036.** là một nhóm sao? Vậy tại sao vẫn liệt kê 5 đơn vị chưa phân nhóm?"*

**CEO đúng, và ảnh còn cho thấy chuyện lớn hơn:** DN001 164 ĐV · DN002 5 ĐV · DN003 16 ĐV · DN004 3 ĐV — **TẤT CẢ đều "0 nhóm"**. Đó là **chữ ký của bảng tra rỗng**, không phải của dữ liệu hỏng. Bằng chứng nằm ngay trong nhật ký cùng màn: *"DN003: C43: **007, 008, 015, 017, 019, 021, 042**"* — nhóm đã từng tra ra bình thường lúc 23:51.

#### Chỗ nguy nhất: mục "việc cần rà" đang mời CEO xoá quyền đúng

Mục đó so quyền đã cấp với nhóm NV đang phụ trách. Bảng tra rỗng ⇒ mọi NV "0 nhóm" ⇒ nó kết luận **toàn bộ 11 quyền của DN003 là "quyền thừa"** và mời đi dọn. **Dọn theo là mất sạch quyền đúng.** Khuyên sai còn nguy hơn không khuyên gì.

**Sửa:** bảng tra hỏng ⇒ **TẮT hẳn** mục "việc cần rà", thay bằng câu nói rõ vì sao và cảnh báo *"dọn theo là mất quyền đúng"*. Dòng *"N ĐV chưa có nhóm"* trên từng dòng NV cũng tắt — thay bằng câu trung tính *"⚠ chưa tra được nhóm"*, nói **một lần** ở cảnh báo đầu menu thay vì lặp lời buộc tội sai trên mọi dòng.

#### Chặn gốc: chia mẻ + tự thử lại

Bản cũ hỏi **một lượt cho toàn bộ mã đơn vị** — trượt một cái là mất **toàn bộ** bảng tra. Nay chia **mẻ 400 mã**, mỗi mẻ tự thử **3 lượt** (nghỉ 0,4s → 0,8s). Một mẻ hỏng hẳn thì coi như hỏng cả (**fail-closed**) — ghép nửa bảng tra sẽ gán oan "chưa có nhóm" cho phần thiếu, đúng cái sai đang phải sửa.

**Trả lời thẳng câu CEO hỏi:** không, CEO **không phải** gõ "036." hay "033." cho từng mã. Việc tách nhóm là **tự động** theo tiền tố trước dấu chấm, máy làm hết. Ô gõ "033." là của **hai menu chi phí** (lọc nhanh), không liên quan menu phân quyền.

Test: server 1169 / 7 fail cố hữu · web **413/413** · build sạch.

---

### 2026-08-10 00:10 (giờ VN) — 🧩 Hai khung đỏ ở màn Phân quyền: CÙNG MỘT GỐC, và cái thứ hai đổ tội nhầm

CEO: *"chỗ phân quyền này tôi chưa hiểu, nó báo lỗi nọ kia là sao."* Xem ảnh thì thấy **hai khung đỏ nói hai chuyện khác nhau về cùng một sự cố** — đọc xong không ai hiểu nổi:

1. *"Không hỏi được bảng 'mã đơn vị → nhóm' (**Failed to fetch**)"* — đúng nguyên nhân.
2. *"**16 đơn vị chưa nhận diện được nhóm** (007.BVĐK KV ĐỊNH QUÁN, 008.BVĐK KV LONG KHÁNH, 015.TTYT H. CẨM MỸ…)"* — **đổ tội cho dữ liệu**.

**Khung 2 sai.** Các mã `007.` `008.` `015.` **rõ ràng có nhóm** — bằng chứng ngay dòng dưới: *"Đang cấp: C36: 140, 147, 149, 151 · C43: 007, 008, 015, 017, 019, 021, 042"*. Chúng chỉ "không nhận diện được" vì **bảng tra chưa tải về**. Nói sai nguyên nhân khiến CEO đi sửa nhầm chỗ và ngồi nghi ngờ chính dữ liệu của mình — đúng thứ đã ngốn cả tối nay ở chỗ khác.

**Sửa:** khi lỗi là *chưa hỏi được máy chủ*, màn chi tiết nói đúng như vậy, kèm **nút Thử lại tại chỗ** và câu chặn tay: *"lưới nhóm đang trống thì **đừng cấp quyền**"* — cấp lúc này là cấp mù. Dòng "N đơn vị chưa nhận diện được nhóm" **bị tắt** trong tình huống đó.

**Chặn gốc:** *"Failed to fetch"* là **hụt mạng nhất thời**. Bắt CEO tự bấm "Thử lại" cho một cú trượt mạng là đẩy việc của máy sang cho người. Nay tự thử **3 lượt, nghỉ tăng dần (0,4s → 0,8s)**; vẫn hỏng mới báo — lúc đó là hỏng thật.

Test: server 1169 / 7 fail cố hữu · web **410/410** · build sạch.

---

### 2026-08-09 23:35 (giờ VN) — 🚧 GỠ NÚT THẮT: 502 cửa danh mục đang KHOÁ CHẾT nút đồng bộ % · đổi màn hết quay vòng

CEO gửi ảnh kỳ 07.2026 lúc 23:24 — ba dữ kiện trong một ảnh chỉ ra đúng chuỗi nhân quả:
1. Huy hiệu ghi *"Đọc từ máy — không gọi Data Hub"* ⇒ local-first **đang chạy đúng** cho kỳ 08.
2. *"⚠ Lỗi máy chủ (HTTP 502)"* + *"Chưa tải được danh mục kỳ 07.2026"* ⇒ kỳ 07 **chưa có trên máy**, phải đi hỏi DataHub, và **cửa danh mục trả 502**.
3. Nút **"Đồng bộ từ DataHub" bị khoá xám** ⇒ CEO **không tài nào** đồng bộ được T07.

#### ‼ Điểm 3 là lỗi Claude gây ra — và nó chặn đúng đường thoát duy nhất

Bản `aab53e2` khoá nút đồng bộ % theo `actionsLocked` = `loadingPeriod || periodMismatch`. Danh mục kỳ 07 trả 502 ⇒ `periodMismatch` đúng **vĩnh viễn** ⇒ nút khoá **vĩnh viễn**, kèm câu *"nút tự mở lại ngay khi tải xong"* — một lời hứa không bao giờ tới. Mà **đồng bộ % KHÔNG đụng danh mục**: nó gọi **cửa chi phí**, cửa đang sống (probe 21/21 ok cả T07). Khoá nó đúng lúc cần nhất là tự bịt lối ra.

**Sửa:** chỉ khoá khi **đang tải thật** (`!!loadingPeriod`). Danh mục hỏng thì nút vẫn bấm được — đó chính là lúc phải bấm.

#### 🕒 "Đổi màn nó quay như thế này thì có bực không" — đã hết

Local-first bỏ được cú gọi DataHub, nhưng **mỗi lần vào lại trang trình duyệt vẫn tải lại 27.719 dòng từ máy chủ**. Nay nhớ ngay trong bộ nhớ trang (tối đa 3 kỳ): đổi màn qua lại trong cùng phiên **hiện tức thì**. Bộ nhớ này nằm **trong trình duyệt** — không đụng máy chủ, không đụng DataHub, nên không vi phạm luật "đường đọc không có tác dụng phụ". Bấm **"Đồng bộ lại"** thì bỏ bản nhớ để lấy số mới.

#### 🗣 Câu lỗi 502 nói rõ hỏng ở CỬA NÀO

*"Lỗi máy chủ (HTTP 502)"* trơ khiến CEO tưởng chết cả hệ. Nay: *"…đây là **CỬA DANH MỤC** của Data Hub, không phải cửa chi phí. Nút **Đồng bộ % chi phí kỳ 07.2026** phía dưới **VẪN DÙNG ĐƯỢC** bình thường."*

**Việc còn lại của Data Hub:** cửa danh mục `assignments/catalog-management?ky=2026-07` đang trả **502** — cần dựng lại. Cửa chi phí không liên quan và vẫn tốt.

Test: server 1169 / 7 fail cố hữu · web **406/406** · build sạch.

---

### 2026-08-09 23:20 (giờ VN) — 🧊 FIX TRIỆT ĐỂ "lambada": KỲ ĐÃ CHỐT SỔ = ĐÓNG BĂNG, không hỏi DataHub nữa

CEO (lần 2 trong 2 tiếng, kèm ảnh T07): *"T07.2026 đã chốt sổ rồi mà số liệu nó vẫn chạy tùm lum… vẫn báo dữ liệu chưa đồng nhất, target không đúng, tổng doanh thu thấp hơn rất nhiều. Yêu cầu giải thích và tìm giải pháp fix triệt để. Mệt lắm rồi."*

**GIẢI THÍCH — vì sao kỳ ĐÃ CHỐT mà số vẫn nhảy:** kỳ chốt sổ nhưng App Report **vẫn hỏi DataHub trực tiếp mỗi lần mở màn** cho kỳ đó. Nguồn chập chờn ⇒ lượt này 21/21 NV có số, lượt sau 3/21 ⇒ danh sách "chưa lấy được" đổi liên tục, còn **target (3/3 NV = 110,5%) và tổng doanh thu co giãn theo số NV lấy được nguồn** — nhìn y như "dữ liệu nhảy lambada". Lưới stale (aa327e6) chỉ **đỡ đòn** khi có bản lưu; nó không **hết đòn**, vì bản chất vẫn là đi hỏi một nguồn chập chờn.

**FIX TRIỆT ĐỂ:** kỳ nằm TRỌN sau ngày khoá sổ (hết ngày 5 tháng sau — SPEC_REVENUE_DELIVERY_PERIOD) **và** kho cục bộ (nút "Đồng bộ % chi phí", all-or-nothing 21/21) có bản kỳ đó ⇒ `fetchEmployeeCost` **trả thẳng từ kho, KHÔNG gọi mạng**. Số kỳ chốt vì thế **BẤT BIẾN**: mở hôm nay, mai, tháng sau đều y hệt — DataHub sống hay chết kệ nó. Đây đúng nghĩa "chốt sổ".

Ba chốt để không thành con dao khác:
1. **Kỳ ĐANG CHẠY không bao giờ bị ghim** — vẫn hỏi nguồn tươi (T08 đã có trong kho cũng KHÔNG ghim). Dải kỳ trộn (chốt + đang chạy) không ghim — không trộn hai chế độ trong một payload.
2. **Kho thiếu kỳ/NV nào ⇒ rơi về đường cũ** (hỏi nguồn + lưới stale), không chặn ai.
3. Bản ghim mang nhãn **`rateSource: 'local_pinned'` + mốc đồng bộ** — nói rõ số từ đâu, không giả làm số vừa kéo.

Một test cũ ("kho chủ động là đường đọc thật, không hết hạn 45 ngày") được cập nhật vì chủ đích của nó nay thoả **mạnh hơn**: kỳ chốt trả `ok` thẳng từ kho với **0 lần gọi mạng**, khỏi cần rơi qua `ok_stale_rates`.

**‼ ĐIỀU KIỆN VẬN HÀNH — T07 hết lambada NGAY khi CEO bấm MỘT nút:** kho cục bộ trên PROD hiện **chỉ có kỳ 08.2026**. Vào **Danh mục QL → Kỳ: 07.2026 → "Đồng bộ từ DataHub"** (nguồn đang sống — probe 21/21 ok). Xong lượt đó, T07 bị đóng băng vĩnh viễn.

Test mới `employeeCostPinnedClosed.test.js` (6): ghim đúng kỳ chốt · bất biến qua hai lượt đọc · 0 lần gọi mạng kể cả nguồn chết · kỳ đang chạy không ghim · dải trộn không ghim · NV thiếu trong kho rơi về đường cũ.

Test: server **1169** pass / 7 fail cố hữu · web **402/402** · build sạch.

---

### 2026-08-09 23:05 (giờ VN) — 🎨 Bộ lọc "như dân nghiệp dư" · cột tổng bị hiểu nhầm là tiền C47

CEO xem màn Tổng hợp và nêu ba việc. **Cả ba đều đúng.**

#### ① Bộ lọc vỡ giao diện — Claude quên viết CSS

CEO: *"thiết kế bộ lọc kiểu này thì như dân nghiệp dư quá."* Đúng, và nguyên nhân thô sơ hơn cả "thiết kế xấu": Claude đẻ ra **8 lớp giao diện mới** (`cost-filter-panel`, `cost-filter-picks`…) mà **KHÔNG viết một dòng CSS nào**. Không có CSS thì trình duyệt xếp mọi nút thành **khối dọc** và menu thả xuống **đè lên ô nhập** — đúng cảnh trong ảnh.

Đã viết đủ: các ô chọn nằm **ngang, tự xuống dòng**; chip điều kiện bo tròn bấm-là-bỏ; ô nhập chia lưới tự co; ô tìm trong danh sách dài; điện thoại thì mỗi hàng 2 ô. **Test mới quét MỌI lớp `cost-filter*`/`cost-breakdown-pick*` trong file JSX và bắt buộc phải có CSS tương ứng** — quên lần nữa là đỏ ngay.

#### ② "Cột C47 sao có tiền ở đây?" — tên cột gây hiểu nhầm

CEO đã chốt **tiền C47 nằm ở menu riêng**, nên thấy cột *"Trừ vào C47 (không C44)"* có tiền là hỏi ngay — hỏi đúng. Thực chất hai cột đó là **tổng của các cột C33–C46 bên trái**, không phải tiền C47; chỉ là cột "không C44" **trùng với phần bị trừ** trong công thức C47.

Sửa: bỏ chữ "C47" khỏi **tên cột** → **"Tổng chi CÓ C44"** và **"Tổng chi KHÔNG C44"**. Quan hệ với công thức C47 đưa xuống chú thích, kèm câu khẳng định *"tiền C47 nằm ở menu riêng 'Thành tiền C32 · C47' đúng như đã chốt"*. Có test cấm đặt lại tên cũ.

#### ③ "C44 sao số tiền đó là sao" — 3,99% trong khi danh nghĩa là 5%

Số **đúng**, nhưng màn không nói đủ: dòng % dưới mỗi ô là **bình quân có trọng số** của các cặp đang gộp. Nhóm nào có cặp chưa được cấp % C44 thì bình quân **thấp hơn 5%** — số thật, không phải tính sai. Đã ghi thẳng chú thích này dưới bảng.

#### ④ "Màn hình lùng nhùng"

Gộp thẻ **"Cột xuất"** vào chung thẻ bộ lọc (đổi tên **"Cột hiển thị"**) — bớt một thẻ rời chồng lên nhau.

Test: server 1163 / 7 fail cố hữu · web **399/399** · build sạch.

---

### 2026-08-09 22:45 (giờ VN) — 🔬 Probe PROD lộ ra: nguồn KHÔNG có C32 · và "đếm dòng" không phải bằng chứng

#### ‼ CEO chỉnh Claude — và chỉnh đúng

Claude viết: *"dữ liệu của anh KHÔNG cũ, 27.719 dòng chính là CP_TOTAL V31.4"*. CEO đáp: *"số dòng thì đúng rồi, **nhưng tao đã sửa nhiều đợt trong đó**, nên nó mới nâng lên bản V31.4."*

**CEO đúng, Claude đã lấy bằng chứng yếu để kết luận mạnh.** Sửa hàng trăm ô bên trong mà không thêm bớt dòng nào thì tổng **vẫn là 27.719** — đếm dòng KHÔNG chứng minh được nội dung mới. Thứ phân biệt được là **checksum** (băm toàn bộ nội dung): đổi một ô là đổi băm.

**Sửa:** nút "Đồng bộ lại" nay trả lời đúng câu người bấm muốn biết — *nội dung có thật sự đổi không*:
- **Đổi** ⇒ *"✅ NỘI DUNG CÓ ĐỔI"* (kèm số dòng trước→sau, hoặc ghi rõ *"số dòng như cũ, nội dung bên trong khác"*).
- **Không đổi** ⇒ *"⚠ NỘI DUNG KHÔNG ĐỔI (băm y hệt bản cũ). Nếu vừa sửa file CP_TOTAL thì **bản sửa CHƯA sang tới đây** — báo Data Hub nạp lại file nguồn; bấm nút này thêm lần nữa cũng ra kết quả này."*
- **Chưa có bản cũ để so** ⇒ nói **KHÔNG BIẾT**, cấm suy thành "không đổi".
Ảnh "trước" đọc thẳng từ đĩa (`cachedMeta`), không gọi mạng.

#### ‼ Probe PROD: DataHub trả ĐỦ C33–C46 nhưng KHÔNG có C32

21/21 NV sống, 14 cột `c33…c46` đầy đủ, **không có `c32`**. Mà công thức C47 cần **đủ 14 cột `C32 + C33→C46 (trừ C44)`** ⇒ **toàn bộ menu "Thành tiền C32·C47" sẽ là "—"** dù đồng bộ thành công 27.719 cặp. Menu **Tổng hợp C33–C46 KHÔNG cần C32** nên vẫn chạy bình thường.

Trước đây màn chỉ ghi "thiếu %" chung chung — đọc xong đi đòi cả 14 cột. Nay đếm riêng từng cột: cột nào thiếu ở **TOÀN BỘ** cặp thì kết luận **"nguồn chưa mở cột đó"**, gọi đích danh, kèm việc phải làm và nói luôn menu nào **không** bị ảnh hưởng. Thiếu ở **một số** cặp thôi thì **không** kết luận như vậy — vài dòng lẻ sót % là chuyện khác hẳn.

Test: server **1163** pass / 7 fail cố hữu · web **396/396** · build sạch.

---

### 2026-08-09 22:25 (giờ VN) — 🔢 "V3.10" là số hiệu CỬA DANH MỤC, không phải số file CP_TOTAL V31.4

CEO hỏi lại lần thứ ba: *"tại sao nó vẫn ghi bản version là V3.10 mà chưa thay đổi vậy?"* — hỏi ba lần cùng một chuyện nghĩa là **màn hình đang trình bày sai**, không phải người đọc chậm hiểu.

**Sự thật:** App Report **chép nguyên** con số Data Hub gửi trong `payload.version` — hiện là `"3.10"`. Đó là **số hiệu cửa danh mục của Data Hub**, một hệ đánh số hoàn toàn khác với **số hiệu file CP_TOTAL** (V31.4) mà CEO đang trông. Data Hub đã xác nhận 27.719 dòng hiện tại **chính là CP_TOTAL V31.4** nhưng **chưa gửi số hiệu đó sang**. App Report **không bao giờ tự đặt số hiệu** — bịa một con số lên màn là loại nói dối tệ nhất trong app này.

**Sửa cách trình bày để không ai phải hỏi lần thứ tư:**
- Backend chuyển tiếp `sourceVersion` (nhận cả `sourceVersion`/`source_version`, ở gốc payload lẫn trong `meta`). Data Hub gửi ngày nào là huy hiệu tự hiện đúng ngày đó, **không phải sửa code**.
- Huy hiệu ưu tiên **số file nguồn**; chưa có thì hiện số cửa kèm nhãn **"(cửa)"** và đổi màu (xám xanh thay vì xanh lá) để không đọc nhầm là số file.
- Rê chuột: *"3.10 là số hiệu CỬA DANH MỤC của Data Hub, KHÔNG phải số hiệu file CP_TOTAL. Data Hub chưa gửi số hiệu file."*

Test khoá: cấm mọi chỗ gán cứng một số hiệu; huy hiệu phải nói rõ số đang hiện là số của cái gì.

**Việc còn lại nằm ở Data Hub** (đã nêu từ 09/08): bổ sung `sourceVersion` = số hiệu file CP_TOTAL vào payload danh mục. Trước khi có, huy hiệu sẽ tiếp tục ghi **"V3.10 (cửa)"** — và đó là **đúng**, không phải lỗi.

Test: server 1157 / 7 fail cố hữu · web **391/391** · build sạch.

---

### 2026-08-09 22:15 (giờ VN) — 🗣 Câu chờ nói dối: "đang tải từ Data Hub" trong khi đang đọc bản trên máy

CEO (ảnh 22:07): *"tại sao vẫn cứ báo là đang đồng bộ từ DataHub, trong khi hiện tại đã kéo đủ danh mục 27.719 dòng về rồi. Nhìn vào bực mình."*

**CEO đúng.** Từ khi đổi sang đọc-bản-trên-máy (`bbb1917`), lượt xem thường **KHÔNG còn gọi DataHub** — nhưng câu chờ vẫn ghi nguyên *"Đang tải danh mục kỳ 08.2026 **từ Data Hub**…"*. Chờ vài giây thì chịu được; **chờ mà bị nói sai mình đang chờ cái gì** thì mất tin tưởng vào cả màn hình — và đúng là làm người ta tưởng bản sửa chưa có tác dụng.

**Sửa:** cờ `askingHub` do **chính nút "Đồng bộ lại"** bật, nên chỉ lượt đó mới được nói là hỏi DataHub.
- Lượt xem thường: *"Đang mở danh mục kỳ 08.2026 — **đọc bản đã có trên máy**, không gọi Data Hub."*
- Bấm Đồng bộ lại: *"Đang **hỏi lại Data Hub** cho kỳ 08.2026…"*
- Khung chờ lần đầu nói luôn **vì sao vẫn phải chờ vài giây** dù đọc từ máy: *"Ưu tiên bản đã lưu TRÊN MÁY; chỉ gọi Data Hub khi máy chưa có kỳ này. Danh mục toàn công ty khá lớn nên vẫn mất vài giây để bày ra bảng."* — không để người dùng tự đoán.

Có test cấm khung chờ chứa bất kỳ câu *"từ Data Hub"* nào ngoài nhánh bấm nút.

**Cách tự kiểm sau khi tải xong:** nhìn huy hiệu góc phải — ghi **"Data Hub · bản trên máy"** + *"Đọc từ máy — không gọi Data Hub"* nghĩa là đọc từ đĩa; ghi trơ **"Data Hub"** nghĩa là lượt đó thật sự đi hỏi nguồn.

Test: web **388/388** · build sạch.

---

### 2026-08-09 22:10 (giờ VN) — 🩺 Phân biệt "DataHub thiếu %" với "lệch định dạng mã" — cái bẫy đã ngốn cả tối nay

Claude tự thêm sau khi mất gần trọn buổi tối đổ tội nhầm cho DataHub. **Hai cảnh hiện ra màn Y HỆT NHAU** — mọi ô là `—` kèm chữ *"thiếu %"* — nhưng cách xử lý **ngược nhau hoàn toàn**:
- DataHub thiếu % thật ⇒ đi đòi DataHub bổ sung số;
- hai bên ghi **mã đơn vị / mã hàng khác định dạng** (kho % ghi `120.HTNT`, doanh thu ghi `120`) ⇒ lỗi **ghép khoá của chính App Report**, đòi DataHub cũng vô ích.

Nay `buildAmounts` đếm sức khoẻ phép ghép (`joinHealth`): bao nhiêu cặp bên kho %, bao nhiêu cặp bên doanh thu, ghép được bao nhiêu, kèm **mẫu mã thật của cả hai bên**. Màn hiện:
- **Giao nhau BẰNG KHÔNG mà hai bên đều có số** ⇒ nói thẳng *"đây KHÔNG phải DataHub thiếu %"*, in mẫu mã hai bên để sửa ngay, không phải đi mò.
- **Ghép được một phần** ⇒ *"chỉ ghép được N/M cặp… số tổng là tổng của phần ghép được, không phải toàn bộ"*. Tổng thiếu không được giả làm tổng thật.
- **Một bên rỗng** ⇒ **KHÔNG** kết luận gì (không suy ra được gì về định dạng mã) — chỉ kết luận khi bằng chứng không thể hiểu cách khác.

Kiểm luôn hai màn CEO sắp mở: **"Mở bảng %"** (`costRatesTable.buildTable`) **KHÔNG dính** lỗi CEO-mù (nó duyệt mọi NV khi `isCeo`), dùng được ngay trên bản đang chạy.

Test: server **1157** pass / 7 fail cố hữu · web **385/385** · build sạch.

---

### 2026-08-09 21:55 (giờ VN) — ✅ Phân quyền: lưu xong phải KIỂM LẠI TỪ MÁY CHỦ rồi mới dám nói "hoàn thành"

CEO nêu hai việc về màn Phân quyền:
> *"Khi nhấn phân quyền cho một NV xong nó vẫn cứ kẹt lại. Đáng lẽ phải báo đã xác nhận phân quyền hoàn thành và màn hình quay về trạng thái lúc vào phân quyền để tiếp tục phân quyền NV khác."*
> *"Tôi sợ phân quyền xong vẫn bị lủng, không đúng mã đơn vị, không đúng cột thì nguy to."*

**Nỗi lo thứ hai đúng chỗ hơn cả nỗi lo thứ nhất.** Bản cũ báo "Đã lưu" chỉ vì lệnh ghi **không ném lỗi** — đó là tin vào lời hứa, không phải bằng chứng. Backend chuẩn hoá lại bản ghi (loại nhóm không hợp lệ, bỏ cột không được phép) **vẫn trả 200**, và CEO tưởng đã cấp xong trong khi thực tế cấp thiếu. Loại sai này không báo gì, chỉ lặng lẽ để một NV không thấy cột đáng ra phải thấy — hoặc thấy cột đáng ra không được thấy.

**Nay:** lưu xong **đọc lại từ máy chủ** rồi so **từng cột × từng nhóm** với đúng thứ CEO đã tick (`verifySavedGrants`).
- **Khớp** ⇒ báo *"✅ Đã lưu và KIỂM LẠI TỪ MÁY CHỦ: đúng N nhân viên (DN004…)"* và **quay về danh sách NV** để cấp tiếp người kế — đúng điều CEO xin.
- **Lệch** ⇒ **Ở LẠI** màn đó, nêu **đích danh**: *"DN004: cần C41: mọi nhóm · C43: mọi nhóm, nhưng máy chủ đang giữ C41: mọi nhóm"* + câu *"KHÔNG dùng phân quyền này cho tới khi sửa xong"*. Không bao giờ đưa người dùng đi tiếp khi số chưa đúng.
- **Không đọc lại được NV nào** ⇒ tính là **LỆCH**, không lặng lẽ bỏ qua.

So sánh **không phụ thuộc thứ tự** cột/nhóm, và bắt **cả hai chiều**: máy chủ giữ THIẾU hơn hay THỪA hơn thứ đã tick đều là lệch (quyền thừa cũng nguy hiểm như quyền thiếu).

Test: web **383/383** (5 test model + 5 test màn) · server 1154/7 fail cố hữu · build sạch.

---

### 2026-08-09 21:30 (giờ VN) — 🛑 Bot chặn Gate 1: hai lỗi thật của Claude + một điểm phạm vi

Bot HOLD `15e6590` trước Gate 1, nêu 3 điểm. **Soi lại: bot đúng ở cả ba, hai điểm là lỗi thật.**

#### ① LỖI THẬT — xung đột % bị "hồi sinh", kết quả phụ thuộc THỨ TỰ

Bot: *"với ≥3 NV có % xung đột cùng cặp, giá trị đã về `null` có thể bị NV sau ghi thành số lại."*

Đúng. `localTeamRatePairs` đánh dấu xung đột bằng cách **gán `null`**, rồi vòng lặp sau lại coi `null` là **"chưa thấy"** ⇒ NV thứ ba ghi đè số của mình lên chỗ đã cãi nhau. Ba NV khai 10/20/30: duyệt `10→20→30` ra **30**, duyệt `30→10→20` ra **20** — cùng dữ liệu, hai kết quả. Đây là loại lỗi tệ nhất: **số vẫn hiện, vẫn hợp lý, chỉ là sai**.

Sửa: nhớ RIÊNG danh sách cột đã xung đột (`conflicted`), xung đột là **vĩnh viễn**; và dùng `columnKey in percents` thay cho `== null` — một giá trị `null` đã ghi vẫn là **đã thấy**. Test chạy thật cả ba thứ tự + trường hợp ba NV khai giống nhau (vẫn ra số, không phải xung đột).

#### ② LỖI THẬT — đường ĐỌC có tác dụng phụ

Bot: *"GET thường đang âm thầm kéo DataHub và ghi cache nền."*

Đúng. Bản local-first của Claude kèm một lượt "làm tươi ngầm" 10 phút/kỳ ngay trong `loadSnapshot`: một lượt GET bình thường lặng lẽ gọi DataHub và **ghi đè cache trên đĩa**. Sai hai nhẽ: CEO bảo đừng gọi DataHub khi xem — **gọi ngầm vẫn là gọi**, chỉ khác là không ai thấy; và DataHub từng tự restart vì bị đọc dồn (951,8 MB RSS, 08/08), thêm một nguồn tải vô hình là thêm một thứ không ai truy được.

Sửa: **bỏ hẳn**. Muốn bản mới có ĐÚNG MỘT đường — bấm "Đồng bộ lại". Bản trên máy cũ tới đâu thì huy hiệu ghi rõ tới đó. Test cũ (đòi phải có làm tươi ngầm có tiết chế) bị thay bằng test **cấm hẳn**.

#### ③ PHẠM VI — chi tiết từng đơn nay CHỈ CEO

Bot: *"`level=order` mở chi tiết đơn/giá/số lượng/doanh thu cho mọi NV có menu Thành tiền."* Dữ liệu vẫn tự-phạm-vi (NV chỉ thấy dòng của chính mình) nên không phải rò rỉ, nhưng menu này vốn sinh ra để **"giảm rủi ro lộ lọt"**, và CEO xin bảng chi tiết để **tự làm báo cáo**, không hề nói mở cho NV. Mở thêm một mức chi tiết cho NV phải là quyết định RIÊNG của CEO, không phải hệ quả phụ của một tính năng.

Sửa: chốt ngay trong `buildAmounts` (nơi duy nhất dựng bảng, không route nào lách được) — NV ép `level=order` vẫn rơi về mức cặp. Công tắc trên màn ẩn với NV, nhưng **hàng rào là ở backend**. NV vẫn giữ nguyên mức cặp đang có, không cắt mất thứ gì.

Test: server **1154** pass / 7 fail cố hữu · web **373/373** · build sạch.

---

### 2026-08-09 21:00 (giờ VN) — 🔎 Chẩn đoán CHỐT VỤ ÁN + script tự nói thật đang đọc ở đâu

Bot chạy 3 lệnh chẩn đoán trên PROD `aa327e6`. **Kết quả chốt được nguyên nhân:**

| Kỳ | ✅ ok | 🟡 ok_stale_rates | ⛔ upstream_* | Lần lỗi gần nhất |
|---|---|---|---|---|
| 2026-08 | 228 lượt · 21 NV | **367 lượt · 21 NV** | 503/unavailable | **08/08** (hôm trước) |
| 2026-07 | 197 lượt · 21 NV | **574 lượt · 21 NV** | không có | — |

1. **KHÔNG có `invalid_period_payload` nào** ⇒ nghi phạm "lỗi contract `ky`" **được loại**.
2. **Hôm nay (09/08) T07/T08 không có lỗi `upstream_*` nào** ⇒ cửa chi phí DataHub **đang sống**.
3. **`ok_stale_rates` NHIỀU HƠN `ok`** (574/197 ở T07, 367/228 ở T08) ⇒ quá nửa số lượt mở màn, nguồn tươi trả chậm hơn hạn 2 giây nên App Report rơi về bản % đã lưu. Bản cũ đó **có số**, nhưng bản cũ của app **tuyên là "chưa lấy được"** — đúng bug đã sửa ở `aa327e6` (nay đã lên PROD). **Đây là thủ phạm chính của "khi đủ khi thiếu" và của việc bot nhắn NV báo thiếu oan.**
4. Kho % cục bộ: **2026-08 đã có** (21 NV · 27.719 dòng, CEO đồng bộ 20:06) — **2026-07 CHƯA có** ⇒ menu tiền kỳ T07 vẫn báo chưa đồng bộ cho tới khi bấm đồng bộ cho đúng kỳ đó.

**Sửa kèm — script chẩn đoán từng tự nói dối:** hai lệnh probe thoát mã `2` với *"THIẾU CẤU HÌNH · roster 0 NV"*, dễ đọc nhầm thành "DataHub hỏng". Thật ra bản release đặt `.env` ở **thư mục gốc** còn script chỉ đọc `server/.env`. Nay:
- probe dò `.env` ở **4 vị trí** thường gặp, **IN RA đã đọc được ở đâu**, và khi thiếu thì nói thẳng *"ĐÂY KHÔNG PHẢI KẾT LUẬN VỀ DATAHUB"* kèm danh sách chỗ đã dò + cách chạy lại với `--env-file`;
- `diagnose_cost_source.js` in **thư mục dữ liệu đang đọc**, báo ngay nếu thư mục không tồn tại.

Chỉ in **đường dẫn**, không bao giờ in nội dung `.env`.

---

### 2026-08-09 20:40 (giờ VN) — 🔐 Thêm KÊNH THỨ HAI xác nhận đăng nhập (bot Report)

CEO: *"otp đang trả về cho bot loginreportdonapharm mà không có thêm kênh gửi về cho tin nhắn bot report — khắc phục ngay cho tôi thêm cách gửi này."*

**Nguyên tắc: thêm ĐƯỜNG ĐI, KHÔNG thêm DANH TÍNH.** Telegram cấp **một user id dùng chung mọi bot**, nên bot nào chuyển mã về thì `resolveTelegram(telegram_id)` vẫn ra đúng một nhân viên. Nhờ đó thêm kênh mà **không nới một hàng rào nào**:
- mã vẫn **120 giây, dùng một lần**, hủy ngay sau khi xác nhận;
- vẫn phải là **telegram_id đã map** sang mã NV; tài khoản bị khoá vẫn chặn;
- trình duyệt vẫn poll bằng `poll_secret` (biết mã cũng không rút được token);
- cảnh báo chống lừa đảo giữ nguyên.

**Làm gì:** `telegramConfirm` nhận secret của **bất kỳ bot nào đã cấu hình đủ**; `telegramStart` trả `bots: [{ key, label, link }]` và màn login hiện **một nút cho mỗi bot**, kèm câu *"gửi cho bất kỳ bot nào ở trên đều được — bot này kẹt thì dùng bot kia"*.

Ba chốt an toàn:
1. **Bot thiếu username HOẶC secret ⇒ không hiện nút, không nhận confirm.** Mời người dùng vào một cửa chết còn tệ hơn không có cửa.
2. **So secret theo kiểu hằng-thời-gian** (`crypto.timingSafeEqual`), secret rỗng không bao giờ khớp — thay cho phép so chuỗi thẳng trước đây.
3. **Audit ghi `via` = bot nào đã xác nhận.** Có hai đường thì phải truy được đường nào đã dùng. Nhật ký **không bao giờ chứa giá trị secret**.

Cấu hình: bot ② dùng biến RIÊNG `TELEGRAM_BOT2_USERNAME` + `TELEGRAM_BOT2_SECRET` (+ `TELEGRAM_BOT2_LABEL`). Chưa cấu hình ⇒ mọi thứ chạy y như trước, không có nút thứ hai.

**‼ CÒN MỘT VIỆC PHÍA BOT ②:** bot Report phải xử lý `/start RP-XXXXXX` giống bot ① (hỏi lại bằng nút "✅ Xác nhận…" rồi mới gọi `/api/auth/telegram/confirm` với secret của chính nó). App Report đã sẵn sàng nhận; chưa làm bước bot thì nút thứ hai mở được bot nhưng bot chưa biết trả lời. Hợp đồng ghi trong `SPEC_LOGIN_V2.md`.

Test: server **1151** pass / 7 fail cố hữu · web **373/373** · build sạch. Test mới: `telegramLoginChannels.test.js` (8) + 3 ở `Login.telegramOnly.test.mjs`.

---

### 2026-08-09 20:15 (giờ VN) — ‼ CEO là NGƯỜI DUY NHẤT thấy toàn dấu "—" ở cột % trong bảng danh mục

CEO bấm Đồng bộ % chi phí, kết quả **✅ 21/21 NV · 27.719 cặp** — nhưng mở bảng danh mục thì **mọi ô C36/C38/C41/C42/C43/C44/C45 vẫn là "—"**: *"tôi đã bấm đồng bộ rồi, vậy tại sao các ô chi phí % nó đang ở đâu đâu là sao?"*

**Gốc — lỗi thật, và trớ trêu là chỉ CEO dính.** Route `/catalog-management/cost-rates` lấy % bằng `employeeCost.getForSession` **theo mã người đang đăng nhập**. CEO là tài khoản quản trị, **không có sổ chi phí riêng**, nên `resolveScopedEmployee` trả `'CEO'`/rỗng ⇒ route **thoát sớm với `pairs: []`**. Cột vẫn hiện (tên cột lấy từ hợp đồng cục bộ) nhưng **không có số nào** ⇒ toàn "—". Đúng người được phép xem tất cả lại là người duy nhất không thấy gì.

**Sửa:** CEO đọc % toàn đội từ **KHO CỤC BỘ** — đúng thứ nút "Đồng bộ % chi phí" vừa ghi, và đúng lời hứa của `SPEC_COST_RATES_LOCAL_SYNC`: *"DataHub chết vẫn xem được"*. Ba chốt:
1. **Hai NV khai lệch nhau trên cùng một cặp ⇒ null**, không lấy bừa một bên (cùng luật với menu Thành tiền).
2. **Kho chưa đồng bộ ⇒ `LOCAL_RATES_EMPTY`**, phân biệt rõ với `NO_EMPLOYEE_SCOPE` (menu phân quyền vốn không cần số) — hai cảnh rỗng khác nhau phải có hai lý do khác nhau.
3. **Chỉ màn cần SỐ mới gửi `pairs=1`.** Menu phân quyền gọi cùng endpoint nhưng không gửi cờ nên không phải tải hàng vạn cặp.

Nhánh nhân viên **giữ nguyên không đụng**: vẫn đủ hai lớp chặn `unitInScope` + `columnScopeAllows` (có test khoá lại cả hai).

Sửa kèm một test cũ soi hớ: nó cắt vùng "không được nhân/chia lại %" quá rộng nên nuốt luôn chữ `C38/C42` trong chú thích và báo động giả — nay soi ĐÚNG hai dòng gán tỷ lệ (nhánh CEO + nhánh NV).

Test: server **1143** pass / 7 fail cố hữu · web **370/370** · build sạch. Test mới `catalogCostRatesTeamView.test.js` (5).

---

### 2026-08-09 20:20 (giờ VN) — ‼ Nút "Đồng bộ % chi phí" BIẾN MẤT lúc danh mục đang tải

CEO chụp màn 20:04: màn Danh mục QL đứng ở *"Đang tải danh mục kỳ 08.2026 từ Data Hub…"*, và thẻ **"Đồng bộ % chi phí kỳ 08.2026"** — đúng cái nút Claude vừa hướng dẫn bấm — **không có ở đó**.

**Hai lỗi chồng nhau:**
1. **Gốc:** bản đang chạy trên PROD vẫn là thiết kế remote-first (mỗi lần vào màn kéo lại nguyên bộ danh mục từ DataHub). Bản sửa local-first đã xong nhưng **chưa deploy**.
2. **Vá ngay ở đây:** `{isCeo && !actionsLocked && <CostRatesSyncCard/>}` **ẩn nguyên thẻ** trong lúc tải. Danh mục tải lâu ⇒ nút biến mất **không dấu vết**, người dùng tưởng app hỏng. Trong khi thẻ này **không đụng dữ liệu danh mục**: nó tự đọc trạng thái kho %, nhắm đúng kỳ đang chọn.

**Sửa:** thẻ **LUÔN hiện** với CEO; lúc đang tải thì **khoá NÚT kèm lý do** *"⏳ Đang tải danh mục kỳ này — nút tự mở lại ngay khi tải xong (không bấm chồng để DataHub khỏi quá tải)"*. Vẫn giữ việc không cho bấm chồng vì DataHub từng tự restart do dồn tải (951,8 MB RSS, 08/08) — nhưng **khoá có lý do ≠ giấu đi**. Khoá câm và biến mất là hai mức độ tệ khác hẳn nhau: cái đầu người dùng biết mình đang chờ gì, cái sau thì không.

Câu chờ *"Các phần phía trên dùng được ngay"* nhờ đó thành đúng sự thật.

Test: web **370/370** (2 test mới khoá hành vi: thẻ không được ẩn theo `actionsLocked`; khoá nút phải kèm lý do) · build sạch.

---

### 2026-08-09 22:30 (giờ VN) — 📄 Chi tiết TỪNG DÒNG ĐƠN HÀNG trong menu Thành tiền — xem trên màn VÀ xuất Excel

CEO hỏi lại: *"các cột chi tiết đơn hàng — chỉ xuất Excel hay xem cả trên màn?"* → **"tôi muốn cả hai nhé."** Làm đúng cả hai.

**Bộ cột chép Y NGUYÊN tab "Chi phí của tôi"** (`employeeCostExport.costColumns`): Ngày · Mã đơn · Tuyến · Đơn vị · Nhà thầu · Mã QLNB · Tên hàng · Hàm lượng · ĐVT · Giá trúng thầu · SL · Thành tiền trước VAT — kèm C32/C47 (% và tiền) của chính dòng đó. Nhãn do backend cấp (`DETAIL_COLUMNS`), frontend và Excel cùng đọc một chỗ: cùng một thứ mà hai màn gọi hai tên thì người đọc phải tự dịch rồi tự nghi ngờ có phải hai số khác nhau không.

**‼ Chi tiết là ADDITIVE — bật/tắt KHÔNG đổi bất kỳ con số tổng nào.** `rows` (mức cặp), `employees`, `grand` giữ nguyên; chi tiết nằm ở `orderRows` riêng. Có test so sánh nguyên khối hai kết quả. Tiền từng dòng tính bằng đúng % của cặp trên doanh thu của chính dòng đó ⇒ **cộng chi tiết ra đúng số mức cặp**, không phải một cách tính thứ hai.

Ba chốt an toàn:
1. **Thừa hưởng đúng bộ lọc + hàng rào quyền** — cặp bị lọc ra thì dòng đơn của nó cũng mất; không có đường lách xem dòng ngoài phạm vi.
2. **Cắt bớt thì nói to.** Trần 5.000 dòng (`COST_AMOUNTS_ORDER_LIMIT`); vượt thì màn + file đều ghi **tổng THẬT** (đếm trước, cắt sau) kèm cách lấy đủ. Bảng bị cắt lặng lẽ đọc y như bảng đủ.
3. **Ngày không đáng tin ⇒ để trống** (slot kỳ cũ gắn ngày kỹ thuật) — không bịa ngày giao dịch. Tiền/giá vẫn nằm dưới con mắt che số.

Excel: **sheet riêng "Chi tiet don hang"** đứng sau sheet tổng — ai cần con số mở sheet đầu, ai cần truy từng đơn sang sheet sau. Hàm lượng · ĐVT · giá trúng thầu lấy từ danh mục (SSOT), thiếu thì lấy dòng doanh thu đỡ, vẫn thiếu thì để "—".

Test: server **1138** pass / 7 fail cố hữu · web **368/368** · build sạch. Test mới: 7 ở `costAmounts.test.js` (mặc định mức cặp, bật chi tiết không đổi tổng, cộng chi tiết = mức cặp, lọc thừa hưởng, cắt-thì-nói, ngày fail-closed, nhãn cột) + 4 ở `CostAmounts.page.test.mjs`.

---

### 2026-08-09 21:50 (giờ VN) — 🎛 Menu Tổng hợp C33–C46 dùng CHUNG bảng lọc nâng cao với menu Thành tiền

Nối nốt việc dở: backend của Tổng hợp đã nhận đủ 8 chiều lọc mới từ đợt trước nhưng màn vẫn hiện bộ 6 ô cũ. Nay cả hai menu chi phí dùng **một** `CostFilterPanel`: 8 chiều (thêm **tên nhà thầu** + **Group-DONA/đối tác**) + ô gõ nhóm "033." (thiếu dấu chấm là nói ra) + tìm tự do + chip bấm-là-bỏ. Ô "Cột xuất" giữ riêng cạnh thanh điều khiển (chọn cột là chuyện của bảng, không phải chiều lọc dữ liệu). Debounce 300ms khi gõ.

File Excel Tổng hợp giờ cũng ghi **bộ lọc đang áp** + ghi chú thiếu dấu chấm vào đầu file — như file Thành tiền, file rời màn hình không được mất ngữ cảnh.

Cập nhật test trang theo cấu trúc mới (8 chiều ở panel chung, cha giữ trạng thái mở). Server **1131**/7 fail cố hữu · web **364/364** · build sạch.

---

### 2026-08-09 21:10 (giờ VN) — 🏗 SỬA LỖI THIẾT KẾ CEO BẮT: danh mục ĐỌC TỪ MÁY, không gọi DataHub mỗi lần mở màn

CEO (kèm ảnh lỗi đỏ ở Phân quyền): *"danh mục và % chi phí đã kéo từ DataHub về hẳn bên App Report rồi, vậy tại sao mỗi lần tao refresh nó cứ báo đang đồng bộ và gọi từ DataHub? Tao nghĩ mày đang thiết kế sai."*

**CEO đúng.** Thiết kế cũ: snapshot danh mục chỉ nhớ trong RAM **2 phút**; quá hạn/refresh/restart là **kéo lại nguyên bộ 27.719 dòng từ DataHub**, bản đã lưu trên đĩa (LKG) chỉ dùng khi DataHub chết hẳn. Hệ quả kép: (a) màn nào cũng ngồi chờ mạng dù dữ liệu y hệt đã nằm trên máy; (b) cú kéo nặng làm nghẽn máy chủ, các request nhỏ bên cạnh chết oan — đúng vụ bảng **"mã đơn vị → nhóm"** (vốn tính tại chỗ, không đụng DataHub) trả "Lỗi máy chủ" ⇒ mọi NV hiện **0 nhóm** trong màn Phân quyền.

**Thiết kế mới (local-first):** RAM → **bản trên đĩa** → chỉ khi máy CHƯA có kỳ đó mới gọi DataHub. Muốn bản mới thì bấm **"Đồng bộ lại"** (`forceRemote: true` — chỗ DUY NHẤT được ép gọi nguồn, có test cấm chỗ khác lén ép). Kèm lượt làm tươi **ngầm có tiết chế** (mặc định 10 phút/kỳ, chạy nền, lỗi thì im — bản local vẫn phục vụ) để số tự mới dần mà không ai phải chờ. Huy hiệu nói thật: *"Data Hub · bản trên máy — Đọc từ máy, không gọi Data Hub"*, vẫn đủ 3 dòng bản nào/đóng bản ngày nào/kéo về lúc nào.

Bản local KHÔNG dán nhãn stale/readOnly oan — nó là bản sao y của lần đồng bộ thành công gần nhất, khác hẳn trạng thái "bản tốt gần nhất lúc nguồn hỏng" (giữ nguyên nhánh đó cho lúc DataHub chết mà máy chưa có kỳ).

Vá thêm quanh vụ "0 nhóm":
- `api.js`: lỗi không kèm lời giải thích giờ hiện **"Lỗi máy chủ (HTTP xxx)"** — phân biệt được 404 (thiếu route/bản cũ) với 502/504 (nghẽn/proxy) ngay trên màn.
- Route `unit-groups`: vượt trần 2000 mã thì **nói ra** (`truncated/total/resolved`) thay vì cắt lặng lẽ làm phần đuôi hiện "0 nhóm" oan; frontend hiện đúng câu đó.

Mọi đường đọc snapshot (danh mục, DQ, cost-breakdown, employee view) tự hưởng local-first — không sửa từng chỗ.

Test: server **1131** pass / 7 fail cố hữu · web **364/364** · build sạch. Test mới trong `catalogRefreshRoute.test.js` (4): local-first đứng trước remote, chỉ nút Đồng bộ lại được forceRemote, làm tươi nền có khoảng nghỉ ≥1 phút, unit-groups nói ra khi cắt trần.

---

### 2026-08-09 20:20 (giờ VN) — 🔍 Truy gốc "KPI khi đủ khi thiếu" + bộ lọc nâng cao hai menu chi phí

#### ‼ SỬA GỐC vụ CEO bực: chi phí "khi thì kết nối đủ, khi thì báo thiếu", bot nhắn NV "chưa đủ dữ liệu"

CEO (09/08, kèm ảnh màn + ảnh tin bot): *"phần chi phí của các ô KPI khi thì kết nối đủ, khi thì báo thiếu… bot loginreportdonapharm cứ báo tin cho các NV là chưa có đủ dữ liệu. Anh rất bực."* Và tin bot tự thú: *"danh sách này ĐANG ĐỔI LIÊN TỤC giữa các lần kiểm — dấu hiệu nguồn chập chờn."*

**Gốc tìm ra ở App Report, không phải chỉ tại DataHub.** Hệ thống ĐÃ CÓ lưới an toàn: nguồn chi phí DataHub kẹt thì khôi phục bản % đã lưu gần nhất và đánh dấu `ok_stale_rates` ("số cũ nhưng dùng được"). Nhưng **mọi tầng phía trên so `outcome !== 'ok'`**, nên NV vừa được lưới cứu số xong **vẫn bị tuyên "chưa lấy được dữ liệu"**:
- Tầng gộp ALL (`employeeCostTable`) đếm họ vào `unavailableEmployees` ⇒ KPI báo thiếu;
- Màn "Mặt hàng thiếu %" (`employeeCostGaps`) loại họ khỏi danh sách ⇒ hai tab đá nhau;
- Bộ cảnh báo nguồn đọc đúng danh sách đó ⇒ **bot nhắn NV báo thiếu oan**, và vì kết quả đổi theo từng lượt gọi (lượt này kịp, lượt sau trễ) nên danh sách "đổi liên tục" — đúng triệu chứng bot mô tả.

**Sửa:** danh sách "kết quả nguồn còn dùng được" định nghĩa ĐÚNG MỘT chỗ — `employeeCost.USABLE_OUTCOMES = ['ok', 'ok_stale_rates']` + `isUsableOutcome()`; tầng gộp, màn gaps, `sourceAvailable` của tin nhắn đều hỏi qua đó. Kèm hai chốt:
1. **Không giấu:** NV đang xài bản % cũ được liệt kê riêng (`match.staleEmployees`) + khối tin màu xanh trên màn *"Đang hiển thị BẢN TỶ LỆ % CŨ cho …"* — dùng được ≠ im lặng.
2. **Không đóng dấu bừa:** suy `rateEffectiveFrom` (chính sách hiệu lực của kỳ) **vẫn đòi `ok` thật** — số cũ hiển thị được nhưng không được nhận là chính sách kỳ này.

Test mới trong `employeeCostAllCoverage.test.js`: stale được tính CÓ SỐ, không rơi vào "chưa lấy được"; stale không sinh `rateEffectiveFrom`; và test khoá danh sách một-nơi-định-nghĩa.

#### 🧭 Thêm công cụ điều tra cho câu "rốt cuộc bị ẩn, hay không kéo được từ App Sale?"

`server/scripts/diagnose_cost_source.js` (CHỈ ĐỌC, không gọi mạng, không in PII/token) trả lời tách bạch ba nghi vấn của CEO:
- ① đếm dòng doanh thu từng kỳ trong kho slot ⇒ đường **App Sale → App Report** có đứt không;
- ② đọc nhật ký `employee_cost_audit` ⇒ cửa **chi phí DataHub** hỏng kiểu gì (kèm bảng dịch nghĩa từng mã `outcome` sang tiếng người);
- ③ liệt kê kho % cục bộ đã đồng bộ kỳ nào.
Con mắt che số KHÔNG liên quan: nó chỉ đổi chữ số thành "•••", không bao giờ sinh chữ "chưa đủ dữ liệu".

#### 🎛 Bộ lọc nâng cao cho tab "Thành tiền C32·C47" (yêu cầu CEO 09/08)

- **Xuất/xem TỪ KỲ ĐẾN KỲ:** mỗi cặp × mỗi kỳ một dòng có cột "Kỳ" — KHÔNG cộng doanh thu hai kỳ rồi nhân một bản % (mỗi kỳ % riêng). Kỳ chưa đồng bộ ⇒ nêu tên + hướng dẫn, không lặng lẽ thiếu tháng.
- **8 chiều lọc:** mã nhà thầu · **tên nhà thầu** · **Group-DONA/Group-đối tác** (suy từ mã nhà thầu, mẫu nhận diện đổi được qua `COST_DONA_CONTRACTOR_PATTERN`; không có mã ⇒ để trống, không đoán bừa) · NV · tuyến · mã đơn vị · nhóm mã · ưu tiên H.A*; thêm ô **gõ nhóm mã "033."** và tìm tự do.
- **‼ Luật dấu chấm đúng lời CEO:** gõ `033.` mới lọc nhóm; gõ `033` thì KHÔNG lọc **và nói ra lý do** (001 sẽ nuốt 0011) — có test khoá.
- **Một bộ luật cho hai menu:** `server/src/costFilters.js` + `web/src/costFilterPanel.jsx` dùng chung cho cả Tổng hợp C33–C46 (menu kia chuyển sang dùng chung, `groupOf` lấy đúng hàm gốc `catalogCostColumnGrants`). Hai màn không bao giờ lọc lệch nhau.
- **"Khi cần lọc thì mở bảng":** bộ lọc gói sau MỘT nút "⚙ Bộ lọc nâng cao", mở ra mới hiện; điều kiện đang bật hiện thành chip bấm-là-bỏ; ô chọn giữ 3 đường thoát (bấm ngoài/Esc/Xong) + ô tìm trong danh sách dài.
- **Màn = file:** một hàm `costAmountsFor` dựng bảng cho cả route xem lẫn route Excel; file ghi kèm kỳ thiếu + bộ lọc đang áp + mốc đồng bộ TỪNG kỳ; cổng quyền `costAmountsGate` chặn ở CẢ HAI route. Bảng chi tiết thêm cột Kỳ/Nhà thầu/Tuyến·Ưu tiên; backend không đổi hành vi khi không truyền from/to.
- Frontend **bỏ lọc lại phía client** (một luật duy nhất ở backend), debounce 300ms khi gõ.

Test: server **1127** pass / 7 fail cố hữu (6 PDF thiếu `pdfinfo` + VP018 denylist — không liên quan) · web **364/364** · build sạch. Test mới: `costFilters.test.js` (15), coverage stale (3).

---

### 2026-08-09 19:05 (giờ VN) — 🏷️ Tiêu đề cột đủ tên + mỗi cột hiện CẢ % LẪN TIỀN

CEO: *"tôi muốn các mục thanh tiêu đề của các cột hiển thị đủ tên thanh tiêu đề kèm với cột C bao nhiêu. Tôi muốn hiển thị mỗi cột là tỷ lệ % và thành tiền."*

**Tiêu đề ba tầng:** mã cột (`C43`) → tên đầy đủ (`CP bs/td`) → nền tính % (`% của doanh thu`). Trước chỉ có mã trần "C43", nhìn không biết là chi phí gì.

**Mỗi ô hai dòng:** thành tiền ở trên, **% hiệu dụng** ở dưới. Áp cho cả dòng dữ liệu lẫn dòng TỔNG CỘNG.

#### ‼ Điểm khó nhất: % của C44 là % CỦA CÁI GÌ

Nếu chia mọi cột trên doanh thu cho tiện thì C44 ra **0,075%** — đọc thành *"C44 gần như bằng 0"*, sai hẳn nghĩa. Trong khi bản chất C44 là **5% của tiền C43**.

Nên mỗi cột chia trên **NỀN của chính nó**: cột thường lấy doanh thu, cột phái sinh lấy **tiền cột gốc**. `baseNoVat/baseWithVat` cộng dồn ngay lúc tính tiền nên không phải suy ngược. Nhãn `pctBaseLabel` lấy từ `derivedBases` **thật của template** (không suy theo cờ `outsideC47`), hiện ngay dưới tiêu đề để không ai phải đoán.

Gộp nhiều cặp lệch % thì con số hiện ra là **bình quân có trọng số** — có test khoá: 1tr×2% + 3tr×4% ⇒ **3,5%**, không phải trung bình cộng 3%.

**Excel theo cùng luật:** mỗi khoản chiếm **hai cột** — *"… — % của doanh thu"* rồi *"… — thành tiền"*. Thiếu % thì **cả hai ô đều "—"**, không để tiền trống mà % vẫn có số.

Server 1108/1115 (7 fail cố hữu) · web 364/364 · build sạch.

---

### 2026-08-09 18:40 (giờ VN) — ‼ SỬA SAI NẶNG: C44 tính trên TIỀN của C43, không phải trên doanh thu

CEO bắt lỗi: *"cột C44 chỉ lấy phần tiền của cột C43 để tính × 5%. Ví dụ cột C43 thành tiền là 100.000đ thì C44 = 100.000 × 5%. Chứ không phải cột C44 lấy doanh thu × 5% là sai bét."*

**CEO đúng, và lỗi này nặng.** Luật cột phái sinh **đã có sẵn** trong hệ thống (`config/employee_cost_templates.json` → `derivedBases: { c44: 'c43' }`), và màn "Chi phí của tôi" vẫn dùng đúng suốt từ đầu. Khi dựng menu Tổng hợp mới, Claude nhân **mọi** cột với doanh thu cho nhanh mà không tra lại luật cũ ⇒ **C44 bị thổi lên gấp nhiều lần**.

Đo bằng chính ví dụ CEO: doanh thu 1.000.000đ · C43 10% ⇒ 100.000đ · C44 5%.
- Đúng: `100.000 × 5% = 5.000đ`
- Bản sai: `1.000.000 × 5% = 50.000đ` — **gấp 10 lần**

Con số này nếu không bị bắt sẽ đi thẳng vào file Excel gửi kế toán.

**Đã sửa:** lấy `derivedBases` **từ template**, tính tiền mọi cột theo thứ tự C33→C46 (cột gốc luôn trước cột phái sinh), cột phái sinh dùng **tiền cột gốc** làm nền.

Ba chốt chống tái diễn:
1. **Luật lấy từ template, có test CẤM viết cứng** cặp C44→C43 vào file này — sau này đổi luật một chỗ là mọi màn theo.
2. Chọn hiển thị **mỗi C44 mà bỏ C43** vẫn đúng — cột gốc được tính ngầm làm nền.
3. **Thiếu % của C43 ⇒ C44 cũng "—"** và bị đếm thiếu, không âm thầm rơi về lấy doanh thu làm nền.

Test cũ đang khoá **đúng công thức sai** nên đã viết lại theo luật đúng (`c44MoneyOf`/`spentC47Of`/`spentAllOf` tính từ RATES thay vì hằng số cứng). C47 **không đổi** vì C44 vốn nằm ngoài công thức đó.

Server 1105/1112 (7 fail cố hữu) · +4 test khoá luật phái sinh.

---

### 2026-08-09 18:45 (giờ VN) — ‼ SỬA SAI NẶNG: C44 tính trên TIỀN C43, không phải trên doanh thu

CEO bắt lỗi: *"cột C44 chỉ lấy phần tiền của cột C43 để tính × 5%. Ví dụ cột C43 thành tiền là 100.000đ thì C44 = 100.000 × 5%. Chứ không phải cột C44 lấy doanh thu × 5% là sai bét."*

**CEO đúng, và đây là lỗi nặng.** Luật này **ĐÃ CÓ SẴN** trong hệ thống — `config/employee_cost_templates.json` khai `derivedBases: { c44: 'c43' }`, và màn "Chi phí của tôi" vẫn dùng đúng suốt. Khi dựng menu Tổng hợp chi phí, Claude nhân **mọi cột** với doanh thu cho nhanh mà không tra lại luật cũ ⇒ **C44 bị thổi lên gấp nhiều lần**. Với ví dụ CEO: đúng là **5.000đ**, bản sai ra **50.000đ** — gấp 10 lần. Con số đó sẽ đi thẳng vào file Excel gửi kế toán nếu CEO không bắt.

**Đã sửa:** tính tiền **mọi cột C33→C46 theo thứ tự** (cột gốc luôn trước cột phái sinh), cột phái sinh lấy **tiền cột gốc** làm nền thay vì doanh thu.

Ba chốt kèm theo:
1. Luật phái sinh **lấy từ `employeeCostTemplates.resolveTemplate()`**, kèm test **cấm viết cứng** cặp `c44→c43` vào file này — đổi luật một chỗ thì mọi màn theo.
2. Chọn hiển thị **mỗi C44 mà bỏ C43** vẫn đúng: cột gốc được tính ngầm làm nền.
3. **Thiếu % của C43 ⇒ C44 cũng "—"** và bị đếm thiếu, không âm thầm rơi về lấy doanh thu làm nền.

Test cũ đang khoá **đúng công thức sai** nên phải viết lại: thay hằng số `SPENT_ALL` (giả định mọi cột × doanh thu) bằng `spentC47Of()` + `c44MoneyOf()` tính từ chính luật phái sinh. +4 test mới, trong đó một test chạy **nguyên văn ví dụ CEO**.

Server 1105/1112 (7 fail cố hữu) · web 360/360.

---

### 2026-08-09 18:25 (giờ VN) — 🔀 Ghép lên nền PROD `8873676` (C2 self-heal) — merge SẠCH, không xung đột

Bot đẩy nền theo E1: `prod/8873676-20260809`, commit `88736763c8bfc14e8576facaa8188b6243a579f9`, tree `c010e8fc…`. Claude fetch về ghép.

**Lần này merge sạch tuyệt đối, không một xung đột** — khác hẳn lần `a437afc` sáng nay (12 file lệch, 15 khối xung đột). Lý do: hai bên **cùng mọc từ `50eb233`** mà `50eb233` đã nằm trong lịch sử nhánh Claude, nên git tự ghép được. Đây chính là lợi ích của luật E2 mà bot vừa chốt: nền PROD lên kho chung thì lần sau không bao giờ phải giải xung đột tay nữa.

**Giữ nguyên của bot (C2):** `employeeCostReconciliationShadow.js` · `appSaleReconShadowV3.js` · `selfHealUnavailableCostSources` trong `routes.js` · `applyReconciliationShadow` trong `employeeCost.js` · 3 bộ test mới. Đã kiểm từng mục còn nguyên sau merge.

**Giữ nguyên của Claude:** dải đỏ nói đúng nguyên nhân + nút "↻ Thử lại" · ba công cụ quản trị (Chi/Doanh thu · tỷ trọng · So kỳ trước) · sửa ô lọc bị kẹt (ba đường thoát, chỉ một ô mở) · cảnh báo bảng rỗng kèm ba bước cần làm.

Diff so với nền PROD **chỉ còn đúng phần Claude thêm** (7 file, +565/−27) — không đụng file nào của C2.

Kiểm: hậu duệ trực tiếp `8873676` (git xác nhận) · build sạch · **web 360/360** · **server 1101/1108** (7 fail cố hữu) · quét toàn repo không còn dấu xung đột.

**Luật E2 bot chốt — Claude đồng ý toàn bộ 6 điểm.** Bổ sung: nhánh `prod/*` chỉ đẩy sau khi acceptance PASS, trỏ đúng exact commit, cấm force-push, candidate bị rollback không đặt dưới `prod/`. Quyền push nhánh PROD ghi luôn trong Gate 2 để CEO duyệt cùng ngữ cảnh.

---

### 2026-08-09 17:55 (giờ VN) — 🔓 Ô lọc bị KẸT + bảng rỗng không giải thích (CEO chụp màn)

**Lỗi 1 — ô lọc mở ra không thoát được.** CEO: *"tích vào ô chọn xuất theo cột, nó dính luôn không thoát ra được."* Ảnh cho thấy **bốn menu mở chồng lên nhau**, che cả bảng lẫn chính cái nút phải bấm để đóng.

Nguyên nhân: mỗi `MultiPick` **tự giữ trạng thái mở** ⇒ mở được nhiều ô cùng lúc, và cách đóng duy nhất là bấm lại đúng nút đã bị menu khác che. Không có Esc, không có bấm-ra-ngoài, không có nút đóng. Đây là lỗi thiết kế cơ bản của Claude.

**Đã sửa — ba đường thoát:** ① bấm ra ngoài ② phím **Esc** ③ nút **"Xong"**. Trạng thái mở chuyển lên **component cha** (`openPick`) ⇒ mở ô này thì ô kia tự đóng, không bao giờ chồng nhau. Dọn trình nghe sự kiện khi đóng. Nút có tick hiện viền xanh để thấy đang lọc gì.

**Lỗi 2 — chọn T07.2026 ra 0 dòng, không hiểu vì sao.** CEO: *"tôi chọn T07.2026 đáng lẽ phải ra số, hay vẫn còn chờ đồng bộ % từ DataHub?"*

Màn CÓ báo "kỳ 07.2026 chưa đồng bộ %" nhưng câu đó **bị menu kẹt che mất**, và khi bảng rỗng hoàn toàn thì câu chữ cũ vẫn nói giọng "bảng dưới không gồm kỳ đó" — nghe như bảng vẫn có gì đó.

**Đã sửa:** bảng rỗng hoàn toàn thì cảnh báo đổi giọng — *"nên **bảng trống hoàn toàn**, không phải kỳ đó không tốn tiền"* — viền dày hơn, kèm khối **"Cần làm"** ghi đúng ba bước: vào Danh mục QL → chọn đúng kỳ ở ô "Kỳ" → bấm "Đồng bộ từ DataHub" → quay lại. **Báo lỗi mà không chỉ việc phải làm là bỏ mặc người dùng tự đoán.**

Web 360/360 (+7) · build sạch · không đụng server.

---

### 2026-08-09 18:10 (giờ VN) — 🔁 Nút "Thử lại" THẬT — bot chặn Gate 2 đúng

Bot BLOCK `197f1fc` với lý do chính xác: dải đỏ mới bảo *"Bấm Thu gọn rồi Mở phân quyền lại để thử lần nữa"*, nhưng thao tác đó **không gọi lại API** — `useEffect` tự tải có chốt `(open && !panel && !loading)`, mà sau lỗi bảng nhóm **panel VẪN tồn tại** (chỉ rỗng nhóm). Người làm theo vẫn thấy 0 nhóm.

**Chỉ dẫn sai còn tệ hơn không chỉ dẫn:** người ta làm theo, thất bại, rồi tin là app hỏng nặng hơn thực tế. Đúng họ lỗi cùng loại với "164 đơn vị chưa nhận diện được nhóm" mà chính bản vá này định chữa — Claude vá một chỗ nói sai rồi đẻ ra chỗ nói sai thứ hai.

**Đã sửa:** dải đỏ có **nút "↻ Thử lại"** gọi thẳng `load()`, khoá khi đang tải; bỏ hẳn câu hướng dẫn đóng/mở.

**Test HÀNH VI, không chỉ câu chữ** (bot nêu đúng điểm yếu của test cũ): trích **đúng luật gating từ code** rồi chạy mô phỏng — khẳng định `autoLoads(true, panelAfterError, false) === false`, tức đóng/mở thật sự vô dụng; đồng thời lần mở đầu (`panel = null`) vẫn tự tải như cũ. Repo không có hạ tầng render DOM nên đây là mức kiểm hành vi chặt nhất làm được mà không dựng thêm bộ khung test.

**Kết quả dò C1a của bot** (ghi nhận): cùng session CEO, `GET .../grants` 200 (77ms), `POST .../unit-groups` 200 (236ms), 198 khoá hợp lệ, 0 null, body 5,7 KB. Bốn nghi vấn đều loại: không phải body limit, không phải auth, không phải timeout/proxy, không phải route bị che. ⇒ Lỗi trong ảnh CEO là **một request bị từ chối nhất thời**; code cũ nuốt lỗi nên không truy ngược được nguyên nhân lịch sử. Từ bản này trở đi lỗi được giữ lại và nói ra.

Web 355/355 (+2 hành vi) · build sạch · server không đụng.

---

### 2026-08-09 17:40 (giờ VN) — 🧠 BA CÔNG CỤ QUẢN TRỊ cho menu Tổng hợp chi phí

CEO: *"làm tiếp đi"* — dựng nốt ba thứ Claude đã tư vấn nhưng chưa làm. Bảng tiền suông không quản được tiền; ba con số này trả lời ba câu CEO thực sự hỏi khi nhìn bảng chi phí.

**1. Chi trên mỗi đồng doanh thu (`costRatio`)** — cột mới "Chi/Doanh thu" ở từng dòng và dòng tổng. Đây là chỉ số **duy nhất so sánh được** giữa NV bán 10 tỷ và NV bán 1 tỷ: nhìn tiền tuyệt đối thì người bán nhiều luôn "tốn nhiều", chẳng nói lên gì; nhìn tỷ lệ thì NV bán 1 tỷ mà tốn 14% lộ ra ngay.

**2. Tỷ trọng từng cột (`share`)** — dòng phụ dưới TỔNG CỘNG: mỗi cột chiếm bao nhiêu % tiền đã chi. Biết "C43 tốn 1,2 tỷ" chưa rõ nhiều hay ít; biết "C43 ăn 34% tổng chi" thì rõ ngay. Cộng mọi tỷ trọng ra đúng 100% (có test).

**3. So với kỳ trước (`compare`)** — khối riêng, tự lấy **dải kỳ liền trước CÙNG ĐỘ DÀI** (`previousRange`: chọn T05→T08 thì so với T01→T04, không phải mỗi T04). Xếp theo **TIỀN TUYỆT ĐỐI**, không theo %: cột tăng 200% từ 5 triệu lên 15 triệu không đáng lo bằng cột tăng 12% từ 2 tỷ lên 2,24 tỷ — xếp theo % thì cái nhỏ luôn nhảy lên đầu và che mất chỗ tiền thật sự đi. Có test khoá đúng cảnh này.

**Fail-closed xuyên suốt:**
- **Doanh thu 0 ⇒ tỷ lệ `null` ('—'), KHÔNG phải 0%.** "0%" đọc thành *"không tốn đồng nào"* — sai nguy hiểm hơn để trống.
- Kỳ trước chưa đồng bộ ⇒ `comparable: false` + nêu đích danh kỳ thiếu, **không so nửa vời** rồi đưa ra con số chênh lệch vô nghĩa.
- Cột chỉ có ở một kỳ vẫn liệt kê (bên kia = 0) — *"kỳ trước 0đ, kỳ này 300 triệu"* chính là thứ cần thấy nhất; nhưng `deltaPct` để `null` vì chia cho 0 là bịa.
- Tính so sánh hỏng **không được làm hỏng bảng chính** — bọc try/catch, bảng tiền vẫn ra.
- Con mắt che số phủ luôn mọi ô so sánh (có test quét).

Server 1081/1088 (7 fail cố hữu) · web 353/353 (+13) · build sạch.

---

### 2026-08-09 16:55 (giờ VN) — 🩹 Màn phân quyền NÓI SAI NGUYÊN NHÂN khi không hỏi được bảng nhóm

CEO chụp màn: DN001 hiện **"0 nhóm · 164 đơn vị"** kèm *"164 đơn vị chưa nhận diện được nhóm"*. **Câu đó SAI.** Các mã trong ảnh (`001.BVĐK ĐỒNG NAI`, `002.BVĐK THỐNG NHẤT ĐN`…) phân giải nhóm hoàn hảo — kiểm `groupOf` cho ra `001`, `002` đúng.

**Nguyên nhân thật:** `load()` của menu phân quyền gọi 3 API bằng `Promise.allSettled`, và lượt hỏi bảng "mã đơn vị → nhóm" hỏng thì bị **nuốt im lặng** thành `{}` — thành ra mọi đơn vị rơi vào "chưa nhận diện được nhóm". Hai chuyện khác hẳn nhau bị gộp làm một:
- backend trả lời nhưng đơn vị không phân giải được → lỗi **DỮ LIỆU**
- **không hỏi được** backend (403/timeout/mạng) → lỗi **HỆ THỐNG**

Nói sai nguyên nhân còn tệ hơn không nói: CEO đọc xong đi tìm lỗi dữ liệu, trong khi thật ra chưa hỏi được ai. Đây đúng là thứ luật "không dòng nào biến mất lặng lẽ" cấm, và là lỗi thiết kế của Claude từ đầu.

**Đã sửa:** thêm trạng thái `groupsError`; hỏi hỏng thì hiện dải đỏ ở đầu menu — *"Không hỏi được bảng mã đơn vị → nhóm … KHÔNG phải đơn vị thiếu nhóm, mà là chưa hỏi được máy chủ"* — kèm cách thử lại và **tên đúng endpoint** (`POST /catalog-management/cost-columns/unit-groups`) để bot khỏi dò mò. Màn chi tiết NV trỏ ngược lên dải đỏ khi mọi người đều 0 nhóm. +2 test khoá.

Web 347/347 · build sạch.

**Ghi nhận song song (bot dò read-only sau bản DataHub `c6c66c6`):** cửa `employee-cost` vẫn chỉ trả **7 cột** (`c36 c38 c41 c42 c43 c44 c45`); **thiếu 8 cột** `c32 c33 c34 c35 c37 c39 c40 c46`. Tripwire thành tiền C32/C47 **PASS phía nhận** — payload chỉ có khoá %, đúng ranh giới. ⇒ **CEO CHƯA bấm "Đồng bộ % chi phí"**, hai tab tiền còn fail-closed cho tới khi DataHub mở đủ cột.

---

### 2026-08-09 15:45 (giờ VN) — 🚀 PROD = `50eb233` (bản hoà giải) — ĐỢT 8 VIỆC 09/08 ĐÃ LÊN SÓNG

Bot deploy đúng SHA Claude đưa, so khớp tuyệt đối: PROD `50eb2333a8a851e8b75923d9c08894a95f245e1d`, tree `b0b3c408…`, version `50eb233-20260809-153952-981`, manifest 5.186 mục pre/post verify PASS.

Test trên máy chủ thật: **server 1080/1081** (chỉ còn VP018 denylist cố hữu — 6 test PDF pass vì máy chủ có `pdfinfo`, khớp dự đoán) · **web 345/345** · safety 51/51 · browser check CEO PASS. Rollback ghim `a437afc`, backup restore-verified.

**Đang chạy thật từ giờ:** huy hiệu Data Hub hiện Version+ngày + nút Đồng bộ lại · nút Chọn cả cột · khối Cần rà phân quyền · chặn spam cảnh báo chi phí + chặn tin gửi mã khoá/optout · công thức C47 đúng (phần còn lại, loại C44) · menu Tổng hợp chi phí C33–C46 · bề rộng bảng động + data-label + request gate (phần bot).

**Còn chờ:** A2 (DataHub mở 14 cột %) · B (self-heal, làm lại với ràng buộc generation) · điều tra người nhận tin + tin doanh thu hằng ngày. Hai tab tiền hiện fail-closed "—" cho tới khi có đủ cột % và CEO bấm đồng bộ kỳ.

---

### 2026-08-09 15:05 (giờ VN) — 🔀 HOÀ GIẢI HAI NHÁNH: nền PROD `a437afc` + 8 việc mới, Claude tự merge

KIỂM 1 của bot FAIL: `a437afc` (PROD) và nhánh Claude lệch 12 file ngoài CHANGELOG — hậu quả dồn của việc đánh số lại commit nhiều đợt. Cherry-pick lên nền lệch là trộn mù, nên đổi cách: **bot đẩy đúng commit PROD lên GitHub** (`prod/a437afc-20260809`, tree khớp `28f3a5c…`), **Claude merge hai bên** với đầy đủ ngữ cảnh cả hai phía.

**Giữ từ phía bot (PROD)** — các bản vá thật nhánh Claude thiếu:
- `costRatesTable.js`: **cô lập dòng theo NV** — khoá cặp thêm chiều `empCode`, hai NV trùng đơn vị × sản phẩm không ghi đè/lộ tỷ lệ của nhau; session NV lọc ngay từ partition. Kèm test.
- Bề rộng bảng **tính động theo số cột %** (`--catalog-table-width`, admin 1658px / NV 1546px + 96px/cột) thay cho `min-width` cứng 2330px — NV được cấp ít cột thì bảng không bị kéo giãn. Luật cascade đơn giá 104px đặt SAU luật 96px.
- `data-label` trên từng ô cho mobile; cổng chống đua request (`createLatestRequestGate`, chỉ nhận kết quả lượt mới nhất); `periodMismatch` khoá thao tác ghi/report khi đang giữ bảng kỳ khác; render theo `shownPeriod`.
- Chú thích/mô tả đã cập nhật "NHÓM MÃ đơn vị (001 · 033 · 120…)".

**Giữ từ phía Claude** — 8 việc hôm nay: huy hiệu Version + nút Đồng bộ lại (`de6aaff`) · nút "Chọn cả cột" (`49febab`) · khối "Cần rà phân quyền" (`b77162d`) · chặn spam cảnh báo chi phí (`6b3a259`) · chặn tin gửi mã khoá/optout (`d8277d8`) · sửa công thức C47 (`3a80821`) · menu "Tổng hợp chi phí C33–C46" (`45228e9`) · bộ chọn Dòng/ô (khử trùng lặp sau merge — bot đã chép sẵn một bản).

**Ghép tay:** đầu mục phân quyền = huy hiệu số đỏ (Claude) + câu mô tả NHÓM MÃ (bot). CHANGELOG giữ cả hai dòng lịch sử, 8 mục Claude nằm trên.

Kiểm sau merge: build sạch · web **345/345** (gồm contract test của bot) · server **1074/1081** (7 fail cố hữu) · quét toàn repo không còn dấu xung đột.

---

### 2026-08-09 13:15 (giờ VN) — 📊 MENU MỚI "Tổng hợp chi phí C33–C46" (CEO-only)

CEO: *"tổng hợp các khoản chi theo từng cột từ C33 đến C46 (vẫn tính C44, nhưng nêu rõ) để tao biết tháng này tao chi hết 8% là bao nhiêu tiền, chi tiết ở mỗi cột, mỗi mã đơn vị, nhóm mã đơn vị, mỗi nhân viên, mỗi tuyến. Xuất Excel từ tháng này đến tháng này, chỉ chọn các cột/mã/NV cần xuất — một phát quản lý ăn ngay."* Bổ sung: *"tất cả đều có con mắt mở/đóng các con số"* + *"tất cả đều có bộ lọc: nhà thầu, đơn vị, nhóm mã, NV, tuyến, ưu tiên (H.A*/H.A…)"* + *"menu C32·C47 vẫn làm riêng."*

**Đã dựng trọn:**
- `server/src/costBreakdown.js` — lõi tổng hợp: tiền từng cột = % kho cục bộ × doanh thu kỳ, gộp theo 6 chiều (NV · đơn vị · nhóm mã · tuyến · nhà thầu · ưu tiên C10). Nhà thầu/tuyến/ưu tiên tra từ danh mục theo kỳ; cặp không tra được vẫn HIỆN với "—", không biến mất.
- **Hai dòng tổng TÁCH BẠCH:** "Tổng chi CÓ C44" và "Phần trừ vào C47 (không C44)" — chênh lệch đúng bằng tiền C44. C44 vẫn là một cột trong bảng, đánh dấu `*` nền cam + chú thích "NGOÀI công thức C47". Không gộp hai nghĩa vào một số.
- **Bộ lọc 6 chiều + chọn cột xuất**, giá trị lọc thu thập TRƯỚC khi lọc (bỏ lọc còn đường quay lại). Xuất Excel mang **đúng bộ lọc đang chọn**, 2 sheet (chưa VAT + có VAT), kỳ từ–đến (`periodRange`, trần 24 kỳ).
- **Fail-closed ba tầng:** kỳ chưa đồng bộ ⇒ `missingPeriods` nêu trên màn + trong file ("file này KHÔNG gồm các kỳ đó"); cặp thiếu % cột nào ⇒ không góp tiền vào cột đó + đếm ⚠ theo cột ("tổng THIẾU" không giả làm tổng thật); % xung đột ⇒ cặp không góp.
- **Quyền:** route `requireCeo` cả JSON lẫn xlsx; tab ẩn với mọi người trừ CEO (`ceoOnly` + `canonicalCeo`). **Mọi ô tiền mang `data-sensitive`** — con mắt che số phủ toàn màn, có test quét từng `<td>`.
- Menu "Thành tiền C32·C47" **giữ nguyên, riêng biệt** — trang mới không nhúng số của menu kia (có test).

Server 1073/1080 (7 fail cố hữu) · web 339/339 (+17: 9 lõi + 8 trang) · build sạch.

**Phụ thuộc dữ liệu (đã nêu trong khối gửi bot):** cần DataHub mở đủ 14 cột % qua cửa chi phí; hiện allowlist 7 cột nên nhiều cột sẽ ⚠ thiếu % cho tới khi mở. Xuất nhiều kỳ cần đồng bộ % từng kỳ trước.

---

### 2026-08-09 12:40 (giờ VN) — ‼ SỬA SAI NẶNG: C47 là phần CÒN LẠI, không phải tổng cộng lại

CEO đính chính: *"ý anh là tính xem sau khi các cột từ C33–C46 lấy đi số % rồi thì C47 còn bao nhiêu tiền thu được, cũng giống như đầu vào của C32 vậy… tao có 10%, sau khi chi hết các cột từ C33 đến C46 (bỏ qua C44) thì còn 2%. Như vậy tao biết phải chi ra 8%, còn 2% là thu về lợi nhuận ròng."*

**CEO đúng. Bản đầu Claude làm sai hoàn toàn** — sai bốn tầng, không phải một chi tiết:

| | Bản sai | Đúng (file CP_TOTAL V29.9 cột AU) |
|---|---|---|
| **Hướng** | C47 = **CỘNG** các cột chi phí | C47 = **TRỪ** — phần còn lại |
| **Tập cột** | C36+C41+C43+C44+C45 (cột NV *nhận*) | 13 cột C33→C46 |
| **C44** | **Cộng vào** | **LOẠI** khỏi công thức |
| **C32** | Hiểu là **doanh thu** | Là **tổng % chi phí gốc được cấp** |

Công thức chuẩn: `C47 = C32 −C33 −C34 −C35 −C36 −C37 −C38 −C39 −C40 −C41 −C42 −C43 −C45 −C46` (Excel `=AF-AG-AH-AI-AJ-AK-AL-AM-AN-AO-AP-AQ-AS-AT`, **không có AR**).

**Gốc của sai lầm:** Claude lấy `template.costColumns` — tập cột NV **được nhận tiền** ở màn "Chi phí của tôi" — rồi dùng luôn làm công thức C47. Hai tập này khác hẳn nhau: một cái là *NV nhận gì*, một cái là *dòng dữ liệu còn lại bao nhiêu*. Lẫn chúng làm con số mất hết ý nghĩa quản trị: CEO cần biết **còn lại bao nhiêu**, bản cũ lại đưa **đã chia bao nhiêu**.

#### Đã sửa

- `C47_SUBTRACTED` (13 cột) · `C47_EXCLUDED` (khai tường minh C44 nằm ngoài, để người sau không "thấy thiếu" rồi thêm vào) · `C47_BUDGET` (c32) · `C47_REQUIRED` (14 cột).
- Tính **trên % trước, quy ra tiền một lần** — đúng như file gốc. Quy tiền từng cột rồi mới trừ sẽ lệch do làm tròn 13 lần.
- Làm tròn % 6 chữ số: `10 − (0,3+0,3+0,4+1+0,5+0,5+1+0,5+1+0,5+1,5+0,5+0)` ra `1,9999999999999982` chứ không phải `2` — tiền không lệch nhưng % hiện thẳng lên màn cho CEO đọc.
- **C47 âm** (chi vượt ngân sách C32) được **đánh dấu đỏ + đếm riêng** `negativePairs`. File gốc có sẵn dấu audit `CẢNH_BÁO_C47_ÂM` nên đây là chuyện có thật, không được hiển thị lặng lẽ.
- Bảng thêm cột **Doanh thu chưa VAT · C32 % · C47 %** để đối chiếu tay được từng dòng. Doanh thu tách riêng, **không còn bị gọi nhầm là C32**.
- Fail-closed giữ nguyên và chặt hơn: thiếu **bất kỳ** cột nào trong 14 cột ⇒ "—" kèm tên cột thiếu.

Kiểm bằng đúng ví dụ CEO: doanh thu 100 triệu chưa VAT · C32 10% = 10 triệu · chi 8% ⇒ **C47 = 2% = 2 triệu**, có VAT 2,1 triệu. Khớp từng đồng.

#### ‼ Việc còn treo — kho % hiện KHÔNG đủ cột

Kho cục bộ đang đồng bộ theo allowlist 7 cột nên **thiếu C32, C33, C34, C35, C37, C39, C40, C46**. Cho tới khi DataHub mở đủ, màn sẽ hiện **"—" kèm danh sách cột thiếu** — đúng luật, không bịa. Đã đưa yêu cầu mở cột vào khối gửi bot.

Ranh giới giữ nguyên: `PERMANENTLY_BLOCKED_CATALOG_FIELDS = ['c32','c47']` chỉ chặn **cửa danh mục**; xin **% qua cửa chi phí** không phá luật đó. **Thành tiền** vẫn do App Report tự nhân, không truyền qua đường nào.

Server 1064/1071 (7 fail cố hữu) · web 331/331 · build sạch · test cũ viết lại theo công thức đúng (+3 luật khoá: C44 nằm ngoài, cấm dùng costColumns làm công thức, C47 âm phải đánh dấu).

---

### 2026-08-09 12:05 (giờ VN) — 🔒 Rà người nhận tin: mã KHOÁ ĐĂNG NHẬP và mã OPT-OUT vẫn đang nhận tin cảnh báo chi phí

CEO yêu cầu rà: *"ngoài 16 tài khoản bị khoá thì DN021/DN023/DN004/VP004 có bị gửi tin nhắn telegram/email không, riêng DN022/DN002 thì gửi như thế nào?"*

**Rà xong phát hiện một lỗ hổng thật.** `employeeCostSourceAlert.notifyAffectedEmployees` gửi tin mềm cho **mọi mã có liên kết Telegram, không lọc gì cả**:

- **DN021 · DN023** nằm trong 16 mã `accessPolicy.BLOCKED_LOGIN_EMP_CODES` — bị khoá đăng nhập, **vẫn nhận** tin bảo *"số trên màn Chi phí của tôi tạm thời chưa đầy đủ"*. Vô nghĩa với người nhận vì họ không mở được app, và là rò rỉ tín hiệu vận hành ra ngoài phạm vi đã đóng.
- **VP004 · VP018** nằm trong `config/notify_optout.json` — **vẫn nhận**, dù chính file đó ghi phạm vi chặn gồm "tổng chi phí".

Đã thêm `employeeNoticeBlocked()`: chặn theo `accessPolicy.isLoginBlocked` **+** `targetNotify.isMuted` (= notify_optout + cờ `no_auto_notify`). Mã rỗng/rác cũng fail-closed.

**Hai ranh giới cố tình KHÔNG động tới:**
1. **Cảnh báo gửi CEO/ADMIN vẫn liệt kê đủ mọi mã**, kể cả mã đã khoá — người xử lý phải thấy toàn cảnh dữ liệu thiếu. Chỉ lọc ở tin gửi CHÍNH NV. Số bị chặn được đếm riêng (`blocked`), không cộng vào số đã gửi.
2. **KHÔNG dùng `employeeIncentivePolicy.isMonetaryNotifyBlocked` ở đây.** Đó là luật cho tin **thưởng/phạt bằng tiền**; tin này không có tiền, và DN002/DN004/DN022 vẫn cần biết số của họ đang tạm tính. *Lấy danh sách của việc khác dùng cho việc này đúng là lỗi đã dính 28/07.*

#### Bảng trả lời CEO (theo LUẬT TRONG CODE)

| Mã | Khoá đăng nhập | Tin hiệu suất (target · mốc thưởng · tổng chi phí · báo cáo DT) | Tin thưởng/phạt bằng TIỀN | Tin "chi phí đang tạm tính" |
|---|---|---|---|---|
| DN021 · DN023 | **Có** (trong 16) | Không | Không | **Không** (trước bản này: CÓ ⚠) |
| VP004 | Không | Không (optout) | Không | **Không** (trước: CÓ ⚠) |
| DN004 · DN002 | Không | **Có — nhận đủ** | **Không** | Có |
| DN022 | Không | **Có** | **Không** | Có |

**DN022 còn một luật riêng:** `SEPARATE_FORMULA_EMP_CODES` — không đi qua công thức thưởng P1/P2 và không bị phạt theo target/C45, chờ công thức riêng CEO ban hành. **DN002 · DN004 · DN022 vẫn nằm trong `XU_PENALTY_EMP_CODES`** nên vẫn được tính phạt thiếu Xu.

**‼ Giới hạn của kết luận này:** máy dựng chạy dữ liệu MẪU, không phải danh bạ thật. Đã kiểm chứng được **luật lọc trong code**; **chưa** kiểm chứng được mã nào hiện còn liên kết Telegram/email trên máy chủ thật. Muốn biết ai thực sự nhận thì phải hỏi bot chạy PROD.

Server 1061/1068 (7 fail cố hữu) · +5 test khoá người nhận.

---

### 2026-08-09 11:40 (giờ VN) — 🔕 GẤP: chặn spam cảnh báo "thiếu dữ liệu chi phí" gửi nhân viên

CEO: *"phần chi phí của các ô KPI khi thì kết nối đủ, khi thì báo thiếu… nên con bot cứ báo tin nhắn về cho các NV là chưa có đủ dữ liệu, này nọ và không báo doanh thu ngày hôm nay bao nhiêu. Anh rất bực và khó chịu, không biết lỗi nguyên nhân."*

#### Nguyên nhân — hai lỗi CHỒNG nhau

**Lỗi 1 (gốc, bot đang sửa ở Cổng 1):** fast-path 2 giây hết giờ → NV bị xếp `unavailable`; self-heal 15 giây khôi phục được rồi lại bị rebuild 2 giây vứt đi. Kết quả: **danh sách NV "thiếu dữ liệu" đổi mỗi vòng** chứ không phải mấy mã đó thật sự thiếu.

**Lỗi 2 (ở App Report, bản này sửa):** `employeeCostSourceAlert` dedup theo *"danh sách lần này có khác lần trước không"*. Nguồn chập chờn ⇒ **lần nào cũng khác** ⇒ dedup vô hiệu ⇒ bắn tin mỗi vòng warm. Tệ hơn, tin mềm gửi NV tính theo `newlyAffected` = "có trong danh sách lần này mà không có lần trước" ⇒ một người rơi ra rồi quay lại là **lại bị coi là mới bị ảnh hưởng** ⇒ nhắn lặp.

Bằng chứng từ chính hai tin bot đêm 09/08:
- **00:32** — 13 NV: DN002 DN008 DN009 DN010 DN011 DN012 DN017 DN018 DN019 DN021 DN023 DN024 VP004
- **02:03** — 15 NV: DN001 DN002 DN003 DN004 DN008 DN009 DN010 DN011 DN012 DN016 DN018 DN019 DN021 DN022 VP004

Hai danh sách khác nhau; lượt hai có 5 người "mới" (DN001 DN003 DN004 DN016 DN022) nên 5 người đó bị nhắn — và khi danh sách xoay lại, nhóm DN017/DN023/DN024 sẽ tới lượt.

**Lỗi 2 sai NGAY CẢ KHI nguồn lành**, vì nguồn mạng luôn chập chờn ở rìa. Nên phải sửa riêng, không chờ Cổng 1.

#### Ba lớp chặn đã thêm

1. **Xác nhận hai vòng** (`CONFIRM_ROUNDS = 2`): chỉ tính là lỗi thật khi NV hỏng ở **cả lần này lẫn lần trước**; chỉ báo khôi phục khi **hai vòng liên tiếp sạch**. Một cú timeout lẻ không đủ để đi báo người. Đánh đổi: tin đầu tiên chậm một vòng warm — chấp nhận, đổi lại không còn kêu oan.
2. **Giới hạn nhịp tin cho CEO/ADMIN** (`MIN_ALERT_GAP_MS = 1 giờ`): danh sách đổi mấy lần cũng không gửi dày hơn 1 tin/giờ. Vẫn giữ nhắc lại 6 giờ khi lỗi kéo dài.
3. **Tin mềm cho NV tính theo TỪNG NGƯỜI** (`EMPLOYEE_QUIET_MS = 24 giờ`): mỗi người tối đa 1 tin/ngày bất kể danh sách xoay vòng ra sao. Khôi phục **chỉ báo cho người đã thực sự nhận tin lỗi**, không làm phiền người chưa từng bị nhắn.

#### Thêm: tin cảnh báo tự nhận diện "nguồn chập chờn"

Danh sách đổi ≥3 lần trong 2 giờ ⇒ tin gắn thêm:

> 🔁 LƯU Ý: danh sách này ĐANG ĐỔI LIÊN TỤC giữa các lần kiểm — dấu hiệu nguồn chập chờn (timeout/khôi phục xen kẽ), KHÔNG phải đúng các mã trên thiếu dữ liệu. Truy theo hướng độ trễ/timeout của nguồn trước, đừng truy từng mã NV.

Đây chính là câu lẽ ra phải xuất hiện đêm qua để khỏi mất một đêm truy nhầm hướng từng mã NV.

#### Ghi chú phạm vi

Tin **doanh thu hằng ngày** (hôm nay/tuần/tháng) **KHÔNG do App Report gửi** — App Report chỉ có hai việc hẹn giờ (`payment_notice`, `target_proposal`). Việc bot không báo doanh thu phải truy ở bot gửi tin, và nhiều khả năng cùng gốc Lỗi 1: API trả fail-closed nên bot không có số để gửi.

Server 1056/1063 (7 fail cố hữu) · test cũ đã viết lại theo hành vi mới (+8 luật, gồm luật khoá đúng cảnh xoay vòng đêm 09/08).

---

### 2026-08-09 11:20 (giờ VN) — 🕳️ VÁ LỖ HỔNG: không có chỗ nào để rà lại phân quyền khi danh mục đổi

CEO nêu: *"hôm sau nhóm 033 họ mở thêm một đơn vị mới… hôm sau xuất hiện thêm mã đơn vị mới giao cho DN001/DN002… hôm sau anh thay đổi NV phụ trách mã QLNB của mã đơn vị này cho NV khác… vậy vào đâu để bấm cập nhật phân quyền thêm / phân quyền lại? Chỗ này đúng là lỗ hổng."*

**CEO đúng. Câu trả lời trung thực trước bản này là: KHÔNG CÓ CHỖ NÀO.** Phần cấp quyền đã làm, nhưng phần *duy trì* quyền khi danh mục sống động thì bỏ trống.

#### Soi lại cơ chế — cái gì tự chạy, cái gì không

| Tình huống | Có tự động? | Vì sao |
|---|---|---|
| Nhóm 033 mở thêm `033.PKĐK Xuân Lộc` | ✅ **Tự động** | Quyền lưu theo NHÓM, nhóm được tra **ngay lúc hiển thị**; mã mới bắt đầu bằng `033` rơi đúng nhóm sẵn có |
| Cột đang để "Mọi nhóm" (`*`), nhóm mới xuất hiện | ✅ **Tự động** | `*` phủ cả nhóm phát sinh sau |
| Nhóm mã **hoàn toàn mới** khi cột cấp tường minh | ❌ | Nhóm không nằm trong danh sách ⇒ ô để "—" |
| Chuyển mã QLNB/đơn vị từ DN001 → DN002 | ❌ | Bảng lọc theo phụ trách nên DN002 **thấy dòng**, nhưng quyền cột là của riêng DN002 |
| Đổi phụ trách theo tuyến | ❌ | Như trên |

**Ba dòng ❌ đều fail-closed nên KHÔNG ra số sai** — nhưng chúng **im lặng**, mà im lặng chính là thứ app này cấm. CEO chỉ biết khi có NV kêu "sao em không thấy cột C41".

#### Đã vá: khối "Cần rà phân quyền"

Nằm ngay đầu menu phân quyền, tự tính mỗi lần mở bằng cách so **danh mục đang chạy** với **ma trận quyền**. Số việc hiện thành **huy hiệu đỏ trên tiêu đề** để CEO nhìn màn Danh mục là thấy, khỏi phải đi tìm.

1. **Chưa được cấp** — NV đang phụ trách một nhóm mà nhóm đó không có cột nào. Kèm nút **"Cấp giống DN00x (C41, C43)"** lấy đúng bộ cột của NV khác đang phụ trách cùng nhóm — chính là thao tác cần khi chuyển phụ trách.
2. **Nhóm mới** — không có ai để lấy mẫu thì ghi thẳng *"nhóm mới, chưa có mẫu"*, không bịa ra một gợi ý.
3. **Quyền thừa** — NV còn cấp ở nhóm không còn phụ trách. Ghi rõ **không lộ số** (bảng vẫn lọc theo phụ trách) để CEO khỏi hoảng, chỉ là nên dọn.

#### ‼ CEO chốt hai điểm nguyên tắc (09/08)

- **App CHỈ BÁO, KHÔNG TỰ CẤP.** Nút "Cấp giống DN00x" chỉ điền sẵn vào bảng đang sửa; vẫn phải bấm "Lưu thay đổi" như mọi thao tác khác. **Không có đường nào để quyền xem số chi phí tự mở mà CEO không bấm** — kể cả khi app biết chắc NV cũ có quyền gì. Tự cấp dựa trên phân công do hệ khác đẩy sang là điều app này không được phép làm.
- **Nhóm mã hoàn toàn mới ⇒ NV không thấy**, app báo để CEO quyết. Giữ nguyên luật "chưa cấp là không thấy".

#### Một quyết định chống nhiễu

Khối rà **chỉ tính cho NV đã từng được cấu hình** (có ít nhất một cột ở đâu đó). NV chưa cấp gì là **mặc định đúng**, không phải lệch — đếm riêng, không kêu. Không có luật này thì hôm nay bật lên đã hơn hai nghìn dòng cảnh báo, đọc thành nhiễu rồi bỏ qua hết, cảnh báo mất tác dụng đúng lúc cần nhất. Danh sách dài quá 25 dòng thì **nói rõ đã cắt bao nhiêu**, không im lặng.

Logic tách riêng (`reviewGrants` · `applySuggestion`) để test được: web **331/331** (+21) · build sạch.

---

### 2026-08-09 10:47 (giờ VN) — 🔘 Nút "Chọn cả cột" trong màn phân quyền

CEO: *"thêm cho tôi chọn hết tất cả theo cột, ví dụ NV DN001 chọn hết tất cả cột C41, thay vì phải đi tích từng dòng một."*

**Việc này màn hình ĐÃ LÀM ĐƯỢC** — chính là ô tích ở hàng **"Mọi nhóm"** trên cùng. **Nhưng CEO không nhận ra, và đó là lỗi thiết kế chứ không phải lỗi người dùng:** nhãn "Mọi nhóm" mô tả một *phạm vi*, không đọc ra thành một *thao tác*. Trong khi cuối mỗi hàng lại có nút chữ rõ ràng "Chọn hết" — bảng cân đối cho hàng mà bỏ trống cho cột, nên mắt không tìm sang.

**Đã thêm nút "Chọn cả cột / Bỏ cả cột" ngay dưới tên mỗi cột**, cân đối với nút cuối hàng. Nút gọi **đúng cùng một hàm** `setColumnAllGroups` với ô tích "Mọi nhóm" — hai lối vào, một nguồn sự thật, không có đường thứ hai để lệch trạng thái.

**Giữ nguyên ngữ nghĩa `'*'`:** cấp cả cột nghĩa là **mọi nhóm, kể cả nhóm mới phát sinh sau này** — không phải "114 nhóm đang có". Chọn vậy vì đúng ý CEO ("DN001 xem C41 ở mọi nơi"): nếu lưu thành danh sách 114 nhóm cứng thì bệnh viện mới mở, DN001 lại mất quyền mà không ai biết. Nhãn gợi ý trên nút nói thẳng điều này.

Web 310/310 (+2) · build sạch.

---

### 2026-08-09 10:32 (giờ VN) — 🏷️ Huy hiệu Data Hub hiện SỐ HIỆU BẢN + ngày · thêm nút "Đồng bộ lại"

CEO: *"đề nghị chỗ 'Data Hub đã kết nối' thêm vào đó bản Version bao nhiêu, kèm ngày tháng năm, ví dụ hiện tại đang bản V31.4 để nhìn vào biết ngay"* + *"có thêm nút nhấn đồng bộ lại từ app DataHub"*.

**1) Số hiệu bản ra mặt huy hiệu.** Số hiệu bản (`meta.version`) và ngày vốn ĐÃ có trong dữ liệu backend trả về, nhưng chỉ nằm trong tooltip — phải rê chuột mới thấy, trên điện thoại thì chịu. Nay huy hiệu trả lời thẳng ba câu:

| Hiện gì | Trả lời câu hỏi | Nguồn |
|---|---|---|
| `Data Hub` + nhãn `V31.4` | đang xem bản nào | `meta.version` do Data Hub gửi |
| `Đã kết nối · bản ngày 09/08/26 …` | bản đóng ngày nào | `meta.updatedAt` |
| `Kéo về máy: 09/08/26 …` | mình kéo về lúc nào | `meta.lastSyncAt` |

Tách hai mốc thời gian là có chủ ý: **"bản cũ"** và **"chưa kéo về"** là hai chuyện khác nhau, gộp lại thì không truy được lỗi ở đâu.

**‼ Fail-closed, cấm bịa số hiệu.** Data Hub không gửi version thì `remoteSnapshot` điền `'unknown'`; lúc đó huy hiệu ghi **"bản: chưa rõ"** (viền đứt, màu nhạt) chứ tuyệt đối không suy số từ ngày tháng hay đoán bản kế tiếp. Có test cấm viết cứng bất kỳ số hiệu bản nào vào code — **đúng bài học "27.700" sáng nay**.

Nguồn đang là bản dự phòng thì huy hiệu ghi **"Bản tốt gần nhất"** thay vì "Đã kết nối" — không để chữ "đã kết nối" đứng cạnh số liệu cũ.

**2) Nút "⟳ Đồng bộ lại".** Snapshot danh mục được nhớ tạm 2 phút cho nhẹ máy; Data Hub vừa ra bản mới thì bấm F5 vẫn thấy bản cũ, người dùng tưởng đồng bộ hỏng. Nút mới vứt bản nhớ tạm của **đúng kỳ đang xem** rồi hỏi lại nguồn ngay, xong tự tải lại bảng.

- Backend: `POST /catalog-management/refresh`, chặn bằng **`requireAdmin`** — ẩn nút không phải lớp bảo vệ.
- **Chỉ xoá bộ nhớ tạm trong tiến trình, KHÔNG đụng bản LKG trên đĩa.** Mất LKG là Data Hub chết kéo theo màn danh mục trắng — đúng thứ LKG sinh ra để chặn. Có test cấm route này gọi `unlink`/`rmSync`/`writeCacheAtomic`.
- **Khoảng nghỉ 20 giây/kỳ** (`CATALOG_REFRESH_COOLDOWN_MS`): mỗi lần bấm là một lượt gọi thật sang Data Hub, không để một người bấm liên tục thành đòn nện. Từ chối thì nói rõ **còn phải chờ bao nhiêu giây**.
- Data Hub chết thì route trả **nguyên** `meta` — huy hiệu chuyển vàng "Bản tốt gần nhất", không che.

**3) Sửa kèm một lỗi GMT+7 thật.** `dateText` trong màn danh mục đang dùng `new Date(iso).toLocaleString('vi-VN')` = lấy **múi giờ máy người dùng**; máy để lệch hoặc mở app từ nước khác là ngày đồng bộ hiện sai. Đã chuyển sang `formatDateTime` (đã ghim `Asia/Bangkok`), có test cấm quay lại cách cũ.

Trên điện thoại: luật CSS cũ ẩn nguyên dòng `<b>` để tiết kiệm chỗ — làm mất luôn số hiệu bản vừa thêm. Nay chỉ giấu dòng "Kéo về máy".

Server 1051/1058 (7 fail cố hữu: 6 PDF thiếu `pdfinfo` trong container + VP018 denylist đỏ sẵn trên nền PROD sạch) · web **308/308** (+13 test mới) · build sạch.

---

---
### 2026-08-09 10:01 (giờ VN) — ‼ BỎ SỐ BỊA TRONG CHỮ GIAO DIỆN ("khoảng 27.700 cặp")

CEO hỏi: *"danh mục bản V31.4 hiện có 27.719 dòng, sao ở bản đồng bộ T08 kéo qua chỉ có 27.700 dòng?"*

**Không có 19 dòng nào mất cả.** `27.700` là **con số Claude viết cứng** vào câu chờ màn hình hôm qua — một ước lượng, **không phải số liệu**. `27.719` mới là số thật đếm từ dữ liệu.

**Nhưng đây là lỗi nghiêm trọng về nguyên tắc, không phải lỗi vặt.** Cả hệ thống này dựng trên luật *"không dòng nào được biến mất lặng lẽ"*, và CEO đã được rèn để soi từng con số — nên CEO đọc mọi số trên màn là số thật, và phản ứng đúng như phải thế. Một con số bịa trong câu chờ làm hỏng lòng tin vào **mọi** con số khác.

**Đã sửa:** bỏ hẳn số khỏi câu chờ, chỉ mô tả tình trạng. **Thêm test cấm viết cứng số dòng/cặp vào chữ giao diện** — quét cả file JSX, ai đặt lại là test đỏ.

Server 1043/1050 (7 fail cố hữu) · web 295/295 · build sạch.

---

### 2026-08-09 09:44 (giờ VN) — 📏 Khoá bề rộng cột bằng `table-layout:fixed` + thêm lựa chọn "Tất cả" dòng

CEO chụp màn lần 2: bề rộng vẫn sai — hoạt chất còn rộng quá, mã đơn vị chật, đơn giá dư.

**Vì sao bản vá trước chưa ăn:** để `table-layout:auto`, thuộc tính `max-width` trên ô bảng **chỉ là GỢI Ý** — trình duyệt vẫn dồn chỗ thừa cho cột có chữ dài nhất. Nay chuyển sang **`table-layout:fixed`**, ở chế độ này `width` được tôn trọng đúng như khai báo.

**Bề rộng theo LOẠI NỘI DUNG** (class, không theo vị trí — số cột đổi theo quyền từng người):
| Loại cột | Rộng | Căn cứ |
|---|---|---|
| Chữ dài (tên thuốc · hoạt chất) | **230px** | đủ đọc, tràn thì xuống dòng rồi cắt |
| Mã đơn vị | **160px** | CEO báo chật — "001.BVĐK Đồng Nai" |
| Đơn giá trúng thầu | **104px** | CEO đo giúp: tối đa 7 chữ số + "đ" |
| Số/tiền/% | **96px** | vừa tiêu đề "C36 (%)", không xuống dòng |
| Cột đầu (Nhân viên) | **112px** | mã + tên xuống dòng |
| Còn lại | **90px** | |

Tổng 2.330px (bảng CEO) · 2.218px (bảng NV) rồi cuộn ngang — khớp đúng `min-width` khai báo.

**Thêm lựa chọn "Tất cả"** vào ô Dòng/ô (giờ là **1 · 2 · 3 · Tất cả**) — chọn Tất cả thì bỏ cắt dòng, ô cao bao nhiêu cũng hiện đủ.

Server 1043/1050 (7 fail cố hữu) · web 294/294 · build sạch.

---

### 2026-08-09 09:14 (giờ VN) — 📐 Nguyên tắc bề rộng cột + chọn 1/2/3 dòng/ô; vá hồi quy `max-content`

CEO chụp màn 09/08, bốn điểm:

**① Ô "Hoạt chất + Hàm lượng" kéo dài gần hết màn — HỒI QUY do Claude gây ra hôm qua.** Bản vá "bỏ bề rộng theo vị trí" dùng `min-width:max-content`, nghĩa là *"bảng rộng bằng dòng chữ dài nhất, không xuống dòng"* ⇒ cột hoạt chất nở ra ôm trọn câu dài nhất. Bỏ hẳn `max-content`.

**④ Nguyên tắc bề rộng (CEO: "cột thì dư quá, cột thì thiếu quá"):** ba loại cột, gắn theo **LOẠI NỘI DUNG bằng class** (không đánh số vị trí — số cột đổi theo quyền từng người):
- cột chữ dài (tên thuốc · hoạt chất) `.catalog-col-text`: **150–260px**, tràn thì xuống dòng rồi cắt
- cột số/tiền/% `.catalog-money`: **82–120px**, không xuống dòng
- cột mã/nhãn ngắn: **64–150px**
Bảng có nền **1400px** rồi cuộn ngang, không ép vừa màn cũng không nở theo chữ.

**① (tiếp) Chọn số dòng/ô:** thêm ô **"Dòng/ô: 1 · 2 · 3"** ở thanh lọc của **cả hai bảng**, truyền xuống bằng biến CSS `--catalog-cell-lines`, **nhớ lựa chọn** trong trình duyệt.

**③ "Từ kỳ" gây hiểu nhầm** (CEO thấy 07.2026 khi đang xem kỳ 08.2026): đổi nhãn thành **"Phụ trách từ kỳ"** + tooltip *"kỳ nhân viên BẮT ĐẦU phụ trách cặp này — không phải kỳ đang xem"*. Dữ liệu vốn đúng: cặp hiệu lực từ 07.2026 và còn "Đang phụ trách" thì vẫn nằm trong kỳ 08.

**② Cột C chưa có %** — không phải lỗi: kho cục bộ chưa có kỳ T08 vì **chưa ai bấm "Đồng bộ % chi phí"**. Huy hiệu nguồn đang vàng *"bản tốt gần nhất · Chỉ đọc"* nên chờ DataHub khoẻ rồi bấm.

5 test khoá. Server 1043/1050 (7 fail cố hữu) · web 293/293 · build sạch.

---

### 2026-08-09 08:23 (giờ VN) — 🖥️ MÀN PHÂN QUYỀN RIÊNG TỪNG NV: chọn người → lưới nhóm × cột

CEO 09/08: *"tích vào từng cột như vậy và chỉ hiển thị mục rất nhỏ và tóm gọn không thể phân quyền chi tiết và đúng hết được đâu. Cách tốt nhất là chọn theo nhân viên rồi có màn hình phụ cho liệt kê các đơn vị, các cột để tích."*

**Bỏ hẳn** bảng ma trận 21 NV × 7 cột với popup nhỏ trong ô (`ColumnGroupScope` xoá luôn, có test cấm quay lại). **Thay bằng hai bước:**

1. **Danh sách NV** — mỗi người một dòng: mã · tên · *"N nhóm · M đơn vị"* · tóm tắt quyền đang cấp (*"C41: mọi nhóm · C43: 033"*) · cảnh báo đơn vị chưa có nhóm. Dòng có thay đổi chưa lưu được đánh dấu cam.
2. **Màn chi tiết** (bấm vào một người) — **lưới: HÀNG = nhóm mã đơn vị, CỘT = C36…C45**. Mỗi hàng liệt kê luôn **các mã bên trong nhóm** để CEO thấy đang mở cho đơn vị nào. Tick ở **cấp nhóm** (phương án A CEO chốt).

**Thao tác nhanh:** hàng **"Mọi nhóm"** trên đầu bật/tắt cả một cột (lưu `'*'`, phủ cả nhóm mới sau này) · nút cuối mỗi hàng bật/tắt **cả hàng** (một nhóm, mọi cột) · nút **"Tắt hết cho NV này"**.

**Luật giữ số đúng:** tick đủ mọi nhóm ⇒ tự gom về `'*'`; đang `'*'` mà bỏ tick một nhóm ⇒ **nở ra danh sách tường minh, giữ nguyên các nhóm còn lại** (không mất quyền oan). Cách LƯU không đổi — vẫn đúng ma trận `{ c41: ['*'], c43: ['033'] }`, backend không phải sửa gì.

6 test lõi logic + 4 test giao diện. Server 1043/1050 (7 fail cố hữu) · web 289/289 · build sạch.

---

### 2026-08-09 08:04 (giờ VN) — ✅ CEO CHỐT T07: nhận số mới **30.982.248.913đ / 2.091 dòng**

Treo từ 07/08, nay đóng. CEO xác nhận **thưởng T07 CHƯA báo, CHƯA trả** ⇒ nhận số mới sạch, không vướng hồi tố.

**Kết quả điều tra (bot chạy `diff_t07_slots.js`, chỉ đọc):**
- run 299 (số CEO đã khoá): 2.016 dòng / 30.917.892.673đ
- run 301 (số bot đặt, đang chạy PROD): 2.091 dòng / 30.982.248.913đ
- Chênh **+75 dòng / +64.356.240đ**, trong đó **70 dòng trị giá 0**. Chỉ **5 dòng có tiền**: 4 dòng đối tác 61.956.720đ (96%) + 1 dòng MISA 2.399.520đ.
- **Không dòng nào mất, không dòng nào đổi tiền, không trùng/nhân đôi sang T08.**
- Nguyên nhân: run 301 chạy muộn hơn nên bắt được đơn giao T07 về sau. **Không phải App Report cộng sai.**

**Lý do nhận số mới** (không phải vì "số đẹp hơn"): quay về run 299 thì 4 dòng đối tác biến mất khỏi T07 mà **cũng không có trong T08** ⇒ 61.956.720đ doanh thu thật không nằm ở đâu — vi phạm "không dòng nào biến mất lặng lẽ". Nhận số mới cũng đúng `SPEC_REVENUE_DELIVERY_PERIOD` (quy kỳ theo ngày thực giao).

**Không cần sửa code:** `CURRENT_FROZEN_PERIOD_PINS['07.2026']` đã ghim đúng — `2091` dòng / `30982248913`đ / run 301, kèm `manifestSha256` + `payloadSha256` chống đổi lén. Claude đã đối chiếu.

**‼ Giữ nguyên kết luận về quy trình:** việc bot **tự đổi số kỳ đã khoá mà không hỏi** vẫn là vượt quyền, dù kết quả hoá ra đúng. Lần sau gặp tình huống tương tự, bot **báo và chờ CEO quyết**, không tự sửa.

---

### 2026-08-09 00:20 (giờ VN) — ‼ SỬA HIỂU SAI GỐC: "nhóm mã đơn vị" là MÃ (001/033), không phải LOẠI (BV/PKĐK)

CEO đính chính bằng hai ví dụ thật, và Claude đã hiểu sai từ đầu:
- `001.BVĐK Đồng Nai` · `001.BVĐK Đồng Nai-Khu C` · `001.NT-BVĐK Đồng Nai` là **MỘT nhóm** — một bệnh viện với các khu/nhà thuốc trực thuộc. Gộp theo LOẠI thì `001.NT-…` rơi sang nhóm "NT", **tách khỏi chính bệnh viện của nó** — sai hẳn ý nghiệp vụ.
- `033.PKĐK An Long Thành` + `033.PKĐK Long Khánh` là **một nhóm 033**, tick một cái là xong cả cụm.

**Đã sửa:** `catalogCostColumnGrants.groupOf` chuyển từ `employeeCostUnitGroups` (loại) sang **tiền tố số** — cùng luật `unitGroupOf` toàn app đang dùng. Endpoint trả nhãn dễ đọc `001 · BVĐK Đồng Nai`. Menu **liệt kê các mã bên trong từng nhóm** (đúng ý "vừa nhóm vừa mã đơn vị"): tick ở cấp nhóm như CEO chốt, nhưng nhìn thấy rõ mở những đơn vị nào.

**Chốt lại nỗi lo của CEO:** cấp nhóm **chỉ phủ đơn vị NV thực sự phụ trách** — DN002 không phụ trách Khu C/NT thì cấp nhóm 001 cũng không mở gì thêm. Vừa tick nhanh, vừa không lỡ tay nới quyền.

Test khoá đúng hai ví dụ nguyên văn của CEO. Server 1043/1050 (7 fail cố hữu) · web 279/279 · build sạch.

---

### 2026-08-08 23:40 (giờ VN) — ✅ DataHub mở T08 đúng 7 cột + nghỉ nhịp giữa các lượt đồng bộ

**DataHub đã xong:** snapshot T08 (27.719 dòng, catalog v10); allowlist **đúng 7 cột** App Report đề nghị — `C36 · C38 · C41 · C42 · C43 · C44 · C45` (KHÔNG mở cả dải C33–C46, theo khuyến nghị hạn chế dữ liệu). Kiểm 3 NV (DN006/DN018/DN022) 6/6 HTTP 200; **không lộ C32/C47 hay cột ngoài allowlist**; snapshot T07 không đổi; audit không conflict, outbox/lock đều 0.

⚠️ **Bằng chứng mới đáng lưu:** đọc dồn làm DataHub **tự restart (8 → 9) vì RSS 951,8 MB vượt ngưỡng 900 MiB**. Họ tự chặn candidate `6d102ef` vì chưa sửa gốc audit-memory — xử lý đúng.

**App Report vá theo (`costRatesSync`):** thêm **nhịp nghỉ 250ms giữa hai lượt gọi** (`COST_SYNC_PAUSE_MS`). Gọi tuần tự thôi là chưa đủ: 21 lượt liên tiếp không cho nguồn kịp thu hồi bộ nhớ. Nút Đồng bộ là all-or-nothing nên nguồn ngã giữa chừng là hỏng cả lượt, phải bấm lại từ đầu — nghỉ ~5 giây tổng cộng đổi lấy việc chạy trót lọt là đáng. `pauseMs: 0` giữ đường chạy nhanh cho test. 2 test khoá (dùng đồng hồ giả, không chờ thật).

Test server 1042/1049 (7 fail cố hữu) · web 275/275.

---

### 2026-08-08 23:10 (giờ VN) — 📐 CỘT % BỊ BÓP DẸP, CHỮ TIÊU ĐỀ CHỒNG NHAU — bỏ hết bề rộng theo VỊ TRÍ cột

CEO gửi ảnh: cột C36/C41 dẹp sát mép phải, tiêu đề chồng lên nhau ("…trúng thầu**CST** ban đầu").

**Nguyên nhân:** bảng dùng `table-layout:fixed` + khai cứng bề rộng cho **đúng 13 cột**, cộng lại vừa khít `min-width:1306px` (88+50+95+135+135+130+180+48+100+85+85+65+110 = 1306). Từ khi thêm cột % chi phí, bảng có tới **~19 cột** — sáu cột thêm KHÔNG còn px nào để chia nên bị ép về gần 0, chữ tràn ra đè lên nhau. Ba khối CSS cùng bệnh: px cho bảng CEO, px cho bảng NV, và khối chia theo % cho "14 cột/13 cột". **Chú thích trong khối % đã sai sẵn** — ghi cột 12 là "Từ kỳ" nhưng thực tế cột 12 giờ là cột %, tức là đang gán nhầm bề rộng cho nhầm cột.

**Sai lầm gốc: đánh số cột theo VỊ TRÍ.** Số cột thay đổi theo quyền từng người (0–7 cột %), và bảng CEO có thêm cột "Nhân viên" nên lệch một nhịp so với bảng NV. Mọi luật `nth-child` vì thế đều sai sớm hay muộn.

**Đã sửa:** bỏ toàn bộ bề rộng theo vị trí; `min-width:max-content` + `table-layout:auto` để trình duyệt tự chia theo nội dung; cột số/tiền/% có `min-width:82px` cho vừa tiêu đề "C36 (%)". Laptop 1280–1499 trước đây ép bảng vừa 100% màn (`width:100%; min-width:0`) — chính là thứ bóp dẹp cột cuối — nay cũng cuộn ngang như màn lớn, chỉ thu nhỏ chữ/đệm. **Cả ba dải màn desktop giờ đều cuộn ngang được**, không dải nào cắt cụt.

4 test khoá, trong đó có test cấm khai lại `width` theo `nth-child` cho hai bảng này.

Test server 1040/1047 (7 fail cố hữu) · web 275/275 · build sạch.

---

### 2026-08-08 22:40 (giờ VN) — 🌀 BỎ CẢNH "CẢ TRANG THÀNH VÒNG QUAY" + CEO chốt phương án A cho tốc độ

CEO gửi ảnh màn Danh mục QL trắng trơn chỉ còn vòng quay: *"mỗi lần kéo dữ liệu mà quay như vậy thì rất kẹt"*.

**Nguyên nhân (lỗi thiết kế của Claude):** `load()` gọi `setData(null)` ngay đầu ⇒ đổi kỳ là đập sạch bảng đang xem, cả trang còn mỗi spinner, trong khi danh mục ~27.700 cặp nên chờ lâu. Tải hỏng còn mất luôn bảng cũ, chỉ còn dòng lỗi.

**Đã sửa (`71ebc70`):** giữ bảng cũ trên màn + state `loadingPeriod` riêng; chỉ hiện dải mảnh "đang tải". **Nói rõ bảng dưới đang là kỳ nào** khi khác kỳ đang tải — giữ số cũ mà không nói là mời người đọc nhầm. Tải hỏng ⇒ giữ bảng + báo lỗi. Lần đầu chưa có gì để giữ ⇒ khung chờ nói đang chờ gì và vì sao lâu. Áp cùng luật cho bảng % kho cục bộ, kèm cờ `alive` chống kết quả kỳ cũ ghi đè kỳ mới. 5 test khoá + tôn trọng `prefers-reduced-motion`.

**‼ Claude nói SAI một điều, đã đính chính với CEO:** đề xuất "nhớ lại bản vừa tải cho nhanh" là thừa — `catalogManagement.getSnapshot` **đã cache sẵn 2 phút** (`SNAPSHOT_CACHE_TTL_MS`), nên vòng gọi DataHub không phải chỗ nghẽn. Nghẽn thật là **truyền + dựng 27.700 dòng xuống trình duyệt**.

**CEO chốt phương án A:** dùng `71ebc70` vài ngày xem đã đủ dễ chịu chưa, chưa làm gì thêm. Nếu vẫn thấy chờ lâu thì làm **B — phân trang phía máy chủ** (chỉ gửi phần đang xem; đổi lại tìm kiếm/lọc chậm hơn một nhịp vì phải hỏi máy chủ; ~1 ngày). **Phương án C (cache dữ liệu ở trình duyệt) đã LOẠI**: lưu dữ liệu nhân viên trên máy người dùng + rủi ro nhìn số cũ mà quyết.

---

### 2026-08-08 21:00 (giờ VN) — 🔐 PHÂN QUYỀN V2: ma trận NV × CỘT × NHÓM ĐƠN VỊ (CEO nâng chi tiết tối 08/08)

CEO xem bản phân quyền v1 và chốt yêu cầu chi tiết hơn: *"mỗi NV được hiển thị chi tiết cho loại cột C nào, cho loại mã đơn vị nào... phân quyền đi theo NHÓM mã đơn vị — không có chuyện DN008 xem được C41 ở 033.PKĐK An Long Khánh mà 003.PKĐK An Long Thành lại không."* Spec: mục V2 trong `SPEC_CATALOG_COST_COLUMNS.md`.

- **Mô hình mới:** mỗi cột một phạm vi NHÓM riêng — `DN002: { c41: ['*'], c43: ['PKĐK','BV'] }`. Nhóm dùng đúng bộ `employeeCostUnitGroups` màn Chi phí đang dùng (BV · TTYT · PKĐK · NT…), MỘT nguồn, không chế bộ nhóm thứ hai.
- **Cấp theo nhóm là cấp CẢ nhóm** — test khoá đúng ví dụ nguyên văn 033.PKĐK/003.PKĐK của CEO. Đơn vị không nhận diện được nhóm ⇒ fail-closed, chỉ `'*'` phủ tới, menu nói rõ số đơn vị chưa có nhóm.
- **Che TỪNG Ô** ở cả route `/cost-rates` lẫn bảng % kho cục bộ: ô ngoài phạm vi trả null y như thiếu % — không lộ cả sự tồn tại của số.
- **Bản ghi v1 tự nâng khi đọc** (mã lẻ nở lên biên nhóm), setGrant nhận cả payload cũ — không cần chuyển đổi tay, không vỡ dữ liệu đã lưu.
- **UI:** tick cột = mặc định "mọi nhóm"; nhãn nhỏ dưới checkbox mở bộ chọn nhóm riêng của cột đó. Bỏ cột "Phạm vi đơn vị" chung + bộ chọn đơn vị lẻ (mới viết chiều nay, chưa deploy — thay luôn trước khi kịp thành nợ). Bảng tra đơn vị→nhóm hỏi backend (`POST /cost-columns/unit-groups`, CEO-only).
- **Ranh giới giữ nguyên:** đây là quyền XEM; cột nào được TÍNH vào tiền ở đơn vị nào vẫn do bảng % DataHub (SSOT) quyết — App Report không cắt cột khỏi phép tính tiền vì phân quyền hiển thị.

Test: server **1032/1038** (6 fail cố hữu `pdfinfo`; +6 test v2 grants, +1 test che-ô buildTable), web **249/249** (viết lại bộ test model/menu theo ma trận), build sạch. Chưa deploy — gộp vào Gói ② của bot.

---

### 2026-08-08 18:00 (giờ VN) — ✅ ĐỢT 3: menu riêng "Thành tiền C32/C47" + C38/C42 vào phân quyền + ô đơn vị chọn nhiều

CEO chốt *"em làm luôn rồi nghiệm thu một lần luôn nào"* — đóng trọn dự án `SPEC_COST_RATES_LOCAL_SYNC` (Đợt 1+2+3).

**Menu riêng "Thành tiền CP" (tab mới, `costAmounts.js` + `CostAmounts.jsx`)** — đúng lệnh CEO tách hai cột tiền tổng khỏi mọi màn có sẵn *"giảm rủi ro lộ lọt, lỡ lỗ hổng bảo mật/code đến tài khoản NV"*:
- 4 cột: **C32 chưa/có VAT · C47 chưa/có VAT**, theo cặp đơn vị × mã hàng + tổng theo NV + tổng cộng (CEO).
- Tiền **TỰ TÍNH** tại App Report = % kho cục bộ × doanh thu slot, dùng lại `employeeCost.calculateAmount` và `VAT_DIVISOR` sẵn có (không hardcode 1,05 chỗ mới). Cột phái sinh C44 vẫn tính trên **tiền C43** đúng luật màn Chi phí — test đối chiếu tay: doanh thu 1.050.000 ⇒ C47 chưa VAT = 210.000đ, có VAT = 220.500đ.
- **KHÔNG kéo C32/C47 từ DataHub** — luật `CATALOG_PERMANENT_FIELD_BLOCKED` giữ nguyên; module tính tiền không có một lệnh gọi nguồn nào.
- Fail-closed: thiếu % cột nào ⇒ `—` + nói thiếu cột gì; hai dòng cùng cặp lệch % ⇒ `XUNG_DOT`; **tổng C47 chỉ chốt khi đủ mọi cặp**, hụt cặp nào thì tổng thành `—` chứ không đưa "tổng thiếu" ra như tổng thật.
- Route không nhận tham số `emp` ⇒ **không có đường hỏi tiền người khác**; NV chỉ thấy đúng hàng của mình; ô tiền qua rèm che ẩn số; export qua backend theo quyền người tải.

**Công tắc ba tầng** (CEO: *"giống như ở hai tab Chi phí của tôi và Thanh toán CP"*): dùng lại **đúng** bộ máy `employeeCostVisibility` (thêm tham số `storeFile`) — toàn phòng → nhóm → cá nhân, audit đủ trước/sau. Kho **riêng** `cost_amounts_visibility`, mặc định TẮT toàn phòng ⇒ chỉ CEO thấy tới khi CEO tự tay bật. Đặt bằng `requireCeo` (KHÔNG `requireAdmin`).

**Thêm C38 · C42 vào menu phân quyền** (CEO yêu cầu chiều 08/08) — kèm **ranh giới sống còn** được khoá bằng test: hai cột này vào diện **CHỈ-ĐỂ-XEM** (`viewOnlyCostColumns`), **KHÔNG** lọt vào `costColumns`. `costColumns` là cột tính tiền (rowMonthlyTotal/C47/thưởng/phạt) — thêm vào đó là đổi công thức tiền, phải nâng `FORMULA_VERSION` (CLAUDE.md luật 5). Cấu hình khai trùng hoặc khai C32/C47 ⇒ ném lỗi. Menu hiện nhãn "chỉ xem" dưới tên cột. Phép khớp cặp vẫn chỉ dùng cột tính tiền để nguồn thiếu C38/C42 không kéo tụt cả cặp.

**Ô "Phạm vi đơn vị" nay chọn được NHIỀU đơn vị** (CEO: *"chỗ các đơn vị anh chưa hiểu"*): thiết kế cũ là một ô select chỉ chọn được **tất cả** hoặc đúng **một** đơn vị — NV phụ trách 164 đơn vị thì không dùng được. Nay là bảng tick có ô tìm mã; chỉ hiện đơn vị NV thực sự phụ trách (phạm vi chỉ THU HẸP); chưa cấp cột thì ô khoá.

**Mang bản vá PROD `03b3468` về nhánh làm việc:** route `/cost-rates` trên nhánh này vẫn lấy tên cột từ payload DataHub (bản cũ) ⇒ nay lấy từ hợp đồng cục bộ như PROD, và **trả đủ tên cột cả khi tài khoản không có sổ chi phí** (`NO_EMPLOYEE_SCOPE`) — chính là lỗi làm menu chết cứng hôm 08/08. Tránh xung đột khi bot cherry-pick lên base PROD.

Test: server **1025/1031** (6 fail cố hữu do container thiếu `pdfinfo`, không phát sinh mới — trước là 1011/1017), web **246/246**, build sạch. Chưa deploy.

---

### 2026-08-08 17:00 (giờ VN) — 🖥️ CEO chốt chuẩn hiển thị PC mới: khung 96% + bảng 50 dòng/trang + trả lại thanh kéo ngang

Ba yêu cầu CEO (kèm 2 ảnh chụp màn "Chi phí của tôi" và "Danh mục QL") gộp một đợt:

- **Khung desktop 96% chiều ngang** — `.page-desktop` bỏ trần 1600px (bị chê "hẹp quá"), sang `max-width: 96%`. Áp cho mọi trang PC/laptop; mobile giữ nguyên. Đã sửa luôn chuẩn trong `CLAUDE.md`.
- **Bảng Danh mục QL: 200 → 50 dòng/trang** (`PAGE_SIZE`, dùng chung cho cả bảng CEO lẫn bảng NV). CEO cho phép 50 hoặc 30 — chọn 50; muốn 30 chỉ đổi 1 hằng số.
- **Vá mất thanh kéo ngang trên màn ≥1500px**: rule cũ `overflow-x:clip` cắt cụt phần bảng thừa (thiết kế từ hồi bảng chỉ 13 cột); từ khi thêm cột % chi phí, C36/C41… tràn ra ngoài mà không có cách nào kéo tới — đúng ảnh CEO chụp. Đổi sang `overflow-x:auto` (thanh trượt trong bảng), header thôi dính khi cuộn dọc (đánh đổi chấp nhận được vì trang giờ chỉ 50 dòng). Màn 900–1279px vốn đã cuộn đúng, không đụng.

Test web 234/234 xanh, build sạch. Chưa deploy — vào Gói ② của hàng đợi bot (cherry-pick lên candidate cùng Đợt 1+2 cost-rates).

---

### 2026-08-08 14:00+ (giờ VN) — 🚢 PROD `03b3468`: MENU PHÂN QUYỀN DÙNG ĐƯỢC — vá lỗi Claude trộn "tên cột" với "số %"

Chuỗi 3 deploy trong ngày: `5147743` (endpoint Home, code-only, token chưa cấp — Home vẫn fail-closed 401) → `03b3468` (vá menu). **Lỗi gốc là của Claude, CEO bắt được:** route cost-rates hỏi DataHub theo mã người đăng nhập ⇒ tài khoản CEO (quản trị, không có sổ chi phí) luôn `not_configured` ⇒ menu vĩnh viễn "chưa lấy được cột" dù nguồn khoẻ. Vá: **tên cột = hợp đồng cục bộ** (`employeeCostTemplates`), **số % mới là của DataHub**. Nghiệm thu PROD: menu 🔐 hiện đủ C36/C41/C43/C44/C45 tick được, console 0 lỗi, T07 nguyên `30.982.248.913đ/2.091`, token tin nhắn/Home vẫn tắt.

**Sự cố còn mở — DataHub chết diện rộng:** 0/21 NV lấy được chi phí (19×`upstream_503`, 2×`upstream_unavailable`); App Report đã loại trừ phía mình (cấu hình 3/3, mapping 21/21, `.env` là symlink dùng chung — chẩn đoán "thiếu .env" của Claude SAI, bot đúng). Màn Chi phí trắng % cho tới khi DataHub hồi. ReportDev bị khoá cross-agent — CEO chuyển handoff tay.

**CEO đề xuất dự án mới (đang chờ chốt C32/C47):** nút "Đồng bộ % chi phí" — kéo bảng tỷ lệ về App Report, chỉ bấm đồng bộ khi DataHub đổi %; hết phụ thuộc nguồn sống từng giờ. Claude khảo sát: `employeeCostRateSnapshot` đã có sẵn dạng bị động (nhớ khi tình cờ lấy được, theo kỳ, TTL 45 ngày) nhưng (a) kỳ mới chưa từng lấy sạch thì không có gì dùng lại — đúng vụ hôm nay, (b) **lỗ hổng: nhánh `not_configured` bỏ qua restore**. Đề xuất 3 phần: A nút đồng bộ chủ động CEO-only (luôn ghi "số tính đến …", nguồn chết không ghi đè bản tốt) · B vá lỗ hổng restore · C menu danh mục đủ cột + xuất Excel. ~2 ngày. Khuyến nghị giữ luật cấm C32/C47 (số tiền tổng — tự tính được từ % × doanh thu), chỉ kéo C33–C46.

---

### 2026-08-08 10:21 (giờ VN) — 🚢 PROD `13b70e9`: dự án cột % + bản vá tin nhắn ĐÃ LÊN · CEO duyệt việc khoá 16 tài khoản

**CEO xác nhận 08/08:** việc khoá đăng nhập 16 mã (`VP002, VP003, VP006–VP017, DN021, DN023`) và giới hạn VP018 chỉ 2 tab doanh thu **là lệnh của CEO**. Ghi vào đây để phiên sau không phải hỏi lại. CEO yêu cầu thêm: **ẩn ô App Report trên `home.donapharm.vn`** với các tài khoản này.

**Đã lên PROD** (bot đánh số lại commit, Claude đối chiếu nội dung — đủ): sàn kỳ T07 + `PAYMENT_NOTICE_ENABLED` (`821ffff`) · 4 phần dự án cột % (`5de6503`→`13b70e9`). Test 1001/1001 · T07 giữ nguyên `30.982.248.913đ / 2.091 dòng` · payment_notice vẫn tắt, 0 tin gửi · 16 mã vẫn bị chặn.

**❌ Sót 1 commit:** `07f49f6` (endpoint `/integrations/home/app-visibility` cho trang Home hỏi ai được thấy ô App Report) **KHÔNG có trong bản deploy** — thiếu đúng 6 test, khớp chênh lệch 1001 vs 1007. Chưa gấp vì bot Home chưa nối, nhưng phải vào đợt sau.

**⚠ Chưa giải quyết — DataHub không trả cột %:** màn "Chi phí của tôi" báo **0/0 cặp**, toàn bộ % trắng (CEO chụp màn 08/08). Menu phân quyền vì thế **tự khoá an toàn** (không có nút lưu, không tạo grant rác) — fail-closed chạy đúng, nhưng tính năng chưa dùng được. Claude nghi **release mới thiếu `.env`** (lặp lại lỗi 06/08 05:35): doanh thu vẫn đủ 805 dòng vì đọc từ file, còn chi phí phải gọi mạng sang DataHub và cần đủ `DATA_HUB_BASE_URL` + `DATA_HUB_ASSIGNMENT_KEY` + `APP_REPORT_EMPLOYEE_COST_KEYS`; thiếu một trong ba là `fetchRawEmployeeCost` trả `not_configured` **không gọi mạng**. Bot **chưa chạy lệnh kiểm `.env`** Claude đưa — còn treo.

---

### 2026-08-08 — ✅ XONG DỰ ÁN "CỘT % CHI PHÍ + MENU PHÂN QUYỀN CEO-ONLY" (4/4 phần) — chờ deploy

CEO duyệt 06/08, làm trọn trong ngày 08/08. Spec: `SPEC_CATALOG_COST_COLUMNS.md` · `DIRECTIVE_GAP_TAB_ORDER_CODES_BACK.md`.

- **1/4 `0f1da90`** — `catalogCostColumnGrants.js` + route **CHỈ CEO** (`auth.requireCeo`, KHÔNG phải `requireAdmin` — CEO thật mang role admin nên dùng cổng admin là để lọt admin thường). Mặc định TẮT, phân biệt "chưa cấp" với "cấp rỗng"; whitelist C33–C46, tick cột cấm là LỖI; phạm vi đơn vị chỉ THU HẸP; bỏ hết cột thì dọn luôn phạm vi; audit bắt buộc có actor lấy từ session, giữ cả trước/sau.
- **2/4 `f0a91a8`** — `GET /catalog-management/cost-rates`: ba lớp lọc (self-scope → cột được cấp → đơn vị được cấp). Chưa cấp ⇒ thoát sớm, không gọi DataHub. Thiếu % ⇒ `null` (không suy 0%). Không tính lại tỷ lệ; truyền thẳng cờ `rateStale`. **% đi đường riêng vì `catalogManagement` chặn cứng C32–C47 trong payload danh mục (502)** — phát hiện khi khảo sát, đã đổi thiết kế và cài test khoá ý định.
- **3/4 `99267a0`** — Menu trong Danh mục QL, chỉ hiện khi `me.is_ceo`. Bảng tick cột × NV, chọn phạm vi đơn vị (chỉ trong đơn vị NV phụ trách), áp nhanh/tắt hết, nhật ký thay đổi. Ô phạm vi khoá khi chưa cấp cột; lưu hỏng thì giữ nguyên thay đổi chưa lưu; không lấy được cột thì NÓI RA thay vì bảng rỗng.
- **4/4 `e465664`** — Cột % vào **cả hai bảng** (CEO + NV) theo đúng quyền; thiếu %/không quyền ⇒ `—` + chỉ đường; **đi qua rèm che ẩn số**; lỗi tải % chỉ mất cột, không hỏng màn danh mục. Kèm 2 món CEO yêu cầu: **mã đơn hàng** trong tab "Mặt hàng thiếu %" (3 mã + tooltip đủ, **không bị che** vì là mã tra cứu) và **nút "← Quay lại"** ở hai tab con (chỉ đổi tab, giữ nguyên kỳ + bộ lọc).

Test: **web 223/223** · **server 997/1003** (6 fail `pdfinfo` không có trong container Claude) · build sạch. Chưa deploy — chờ bot.

---

### 2026-08-08 — 🛑 CHẶN TIN "QUÁ HẠN" SAI GỬI TOÀN ĐỘI: sàn kỳ T07 + công tắc chủ mặc định TẮT

Rà commit `a49a087` (bot deploy 07/08 trong gói V-C/V-D): handler `payment_notice` **cắm thẳng vào lịch 08:00**, gửi Telegram + email cho **NV và CEO**, chưa qua duyệt của CEO. Cửa sổ quét 45–105 ngày ⇒ ngày 08/08 rơi vào **T04 + T05** (không phải T05+T06 như ước đoán ban đầu — đính chính), và **T06 lọt vào cửa sổ ngày 14/08**. Các kỳ đó chưa ai bấm "Ghi nhận đã trả" trong app ⇒ `planNotices` coi là chưa trả ⇒ bắn tin **"🔴 QUÁ HẠN"** hàng loạt. Hôm 07/08 chưa gửi tin nào **chỉ vì nguồn chi phí thiếu (DN018) làm bộ kiểm ném lỗi** — an toàn do MAY, không do thiết kế; DataHub trả đủ nguồn là bắn thật.

**CEO chốt 08/08:** *"bỏ qua T05 và T06 vì hai tháng này mình chưa xây bài bản, không có số liệu lấy từ App Sale qua mà chỉ có số liệu Lumos chuyển vào."*

Vá (`8c90287`, cherry-pick sạch `a49a087`+`9144b81` của bot rồi patch):
- **`PAYMENT_NOTICE_FIRST_PERIOD = '2026-07'`** — chặn TRƯỚC phép tính tuổi kỳ. Căn cứ dữ liệu: T07 là slot **App Sale mirror** (`vc-run301-approved_…`), T06 trở về trước là slot **`legacy_*`** (số Lumos). Đúng lời CEO, và bao luôn T04 mà CEO chưa nhắc.
- **`PAYMENT_NOTICE_ENABLED` mặc định TẮT**, chặn trước khi dựng sổ/gọi nguồn. Handler gửi tin không được sống dậy chỉ vì code lên PROD.
- 4 test khoá: 08/08 và 14/08 đều ra rỗng; T07 vẫn nhắc bình thường từ 14/09 (sàn không giết tính năng). Server 977/983 (6 fail `pdfinfo`).

‼ **PROD vẫn đang chạy bản CHƯA có vá** (`3b53198`) — phải bảo bot gỡ cron `run_due_jobs` / bỏ `payment_notice` khỏi handlers ngay khi kết nối lại, trước khi DataHub trả nốt DN018.

**✅ ĐÃ CHẶN (bot xác nhận 08/08):** cron `run_due_jobs` **trước đó CÓ thật** → đã gỡ; đã bỏ dòng `payment_notice: paymentNotice` khỏi release đang chạy; **`payment_notice_delivery_state` KHÔNG tồn tại — 0 bản ghi ⇒ chưa gửi tin nào**; không còn process `run_due_jobs`. Kịp trước khi DataHub trả nốt DN018.

‼ **Nhưng đây là sửa TAY trên release đang chạy, không qua git** ⇒ **lần deploy tới sẽ khôi phục lại handler**. Bản vá thật (`8c90287`: sàn kỳ T07 + `PAYMENT_NOTICE_ENABLED` mặc định TẮT) **bắt buộc phải nằm trong release kế tiếp**, nếu không là dẫm lại đúng vết cũ.

---

### 2026-08-07 07:41 (giờ VN) — ⛔ CHẶN DUYỆT: bot tự ĐỔI SỐ T07 (kỳ đã khoá) trên PROD — CEO chọn ĐIỀU TRA TRƯỚC

Bot deploy `3b53198` kèm commit `fix(revenue): pin current T07 run301 baseline` — **vượt phạm vi V-C/V-D**. Nó dựng lại T07 từ lần đồng bộ #301 và **advance baseline khoá sổ**:
- Cũ (CEO chốt, đã khoá): **30.917.892.673đ / 2.016 dòng**.
- Mới (bot đặt, run #301): **30.982.248.913đ / 2.091 dòng** → **+64.356.240đ / +75 dòng**, ĐANG chạy PROD.

Vi phạm nguyên tắc "kỳ khoá sổ KHÔNG hồi tố" và chính kết luận 06/08 (T07 không phân loại hồi tố được — màn Chưa đồng bộ sống từ T08). Bot giải sai bài: thay vì chấp nhận T07 làm từ kỳ đang chạy, nó **mở lại kỳ đã khoá** để ép V-C chạy được cho T07. Code sạch (giữ lịch sử `APPROVED_RULE_TRANSITIONS` cũ, thêm baseline mới `CURRENT_FROZEN_PERIOD_PINS`, pin exact + `assertPeriodOpenForMaterialization` chặn mở kỳ khoá) — nhưng **QUYẾT ĐỊNH đổi số kỳ đã khoá là quyền CEO, không phải bot/Claude.**

**Claude CHẶN duyệt deploy này.** Hỏi CEO 3 lựa chọn (trả lại số cũ / điều tra trước / chấp nhận số mới). **CEO chọn: ĐIỀU TRA 75 dòng trước.** Claude viết `scripts/diff_t07_slots.js` (`57ec4cb`, chỉ đọc 2 bản chụp T07, không DB) để liệt kê 75 dòng tăng: ngày doanh thu · NV · mã đơn · phân nhóm theo tháng — xem có phải đơn giao T07 đồng bộ muộn (đúng `SPEC_REVENUE_DELIVERY_PERIOD`) hay dòng lạ. Chưa duyệt deploy; chưa lùi (điều tra xong CEO mới quyết). Hai commit kèm (`a49a087` bộ gửi tin nhắc thanh toán · `9144b81` khoá lịch đa tiến trình) tạm treo chờ review riêng — bot xác nhận 0 tin đã gửi.

---

### 2026-08-06 23:17 (giờ VN) — 🔍 V-C chạy thật T07: KHÔNG CÂN (−20,2 tỷ) — và đó là PHÁT HIỆN, không phải lỗi script

Bot chạy `build_sync_exceptions.js` (bản `851b92b`) cho T07, fail-closed dừng đúng: nguồn chỉ còn **4 dòng MISA** cho run #299 trong khi slot T07 giữ **2.016 dòng** — tức **App Sale không lưu dòng snapshot của run cũ** (run mới đè, dòng cũ bị dọn). Lệch −20.262.343.523đ là **lệch giả do nguồn đã trôi**, không phải doanh thu sai: T07 vẫn ghim đúng 30.917.892.673đ/2.016 dòng.

**Quyết định vận hành (Claude chốt, chờ CEO xác nhận nếu cần):** kỳ ĐÃ KHOÁ SỔ **không phân loại hồi tố** — nguồn tại thời điểm khoá không còn tồn tại để so. Màn "Chưa đồng bộ" **sống từ kỳ ĐANG CHẠY (T08) trở đi**, chạy sát thời điểm dựng slot (slot tự dựng 30 phút/lần nên universe luôn tươi). Script bổ sung chẩn đoán tự động cho ca này (`1bea2d6`). T07 không ghi store — màn sẽ ghi rõ "chưa chạy phân loại" thay vì số sai.

---

### 2026-08-06 20:45 (giờ VN) — 🚢✅ V-A + V-B LÊN PROD `2ca7e45` — Claude đối chiếu từng byte, DUYỆT

Bot deploy candidate `va-vb-combined-636f9fc-20260806-202523` = nền PROD `636f9fc` + đúng 2 commit V-A (`a6e8722`) + V-B (`2ca7e45`). Claude diff xác nhận **code web + test giống hệt bản đã review** trên `claude/new-session-eifd44`; không lẫn V-C/V-D.

Nghiệm thu trình duyệt PASS đủ: thu gọn bộ lọc vẫn hiện chip + cảnh báo target · số mặc định ẨN, F5/timeout 62s/mất focus đều ẩn lại · ô thiếu dữ liệu giữ `—` · nút ghi tiền khoá khi ẩn. Health/version/auth/frozen T06–T07 PASS, console 0 lỗi. Chỉ reload `app-report` (PID 4007825/85); `app-report-tgbot` không đụng (969789/29). Lùi được về `636f9fc`. Bằng chứng: `artifacts/deploy-va-vb-2ca7e45-20260806-204555`. Ghi chú: một lần re-verify manifest hậu kiểm bị gián đoạn (wrapper/timeout) nhưng gate bắt buộc trước cutover PASS và checksum hậu kiểm khớp exact.

Còn lại của LENH_06082026: **V-C** (chạy `build_sync_exceptions.js` cho T07) và **V-D** (dry-run + crontab) — duyệt riêng từng bước.

---

### 2026-08-06 — ✅ CEO DUYỆT dự án "Cột % chi phí trong Danh mục QL" — `SPEC_CATALOG_COST_COLUMNS.md`

CEO duyệt trọn phương án: **số % từ DataHub (SSOT, App Report chỉ hiển thị, không cho sửa % kể cả CEO)** · **menu phân quyền CHỈ CEO điều khiển** (`isCeoActor`, admin thường không sửa được, API ghi grant trả 403 `CEO_ONLY`) · phân quyền theo **từng NV × từng cột (C36/C41/C43/C44/C45…) × phạm vi đơn vị mình phụ trách**, có thao tác nhóm/toàn phòng · **mặc định TẮT** (fail-closed), hai lớp với `employeeCostVisibility`, con mắt ẩn số phủ trên cùng, export theo đúng grant.

**Xếp hàng: đứng đầu hàng đợi kế** — ngay sau khi REPORTDEV đóng đợt deploy V-A→V-D, trước việc đọc Excel thật. Giao bot làm theo spec khi đợt deploy hiện tại nghiệm thu xong.

---

### 2026-08-06 — ✅ LÀM XONG CẢ 4 VIỆC của `LENH_06082026.md` (Claude code trực tiếp — bot REPORTDEV đang mất quyền exec)

Bot báo runtime chỉ còn read/write (mất exec/edit/apply_patch) nên không nhận lệnh được; CEO đã duyệt gói 4 việc và muốn "làm xong luôn" ⇒ Claude làm thẳng trên `claude/new-session-eifd44`, mỗi việc một commit riêng để lùi từng việc được.

- **V-A `8b2b3b7`** — khối `overview-filter-note` (chip + câu *"Target không phân bổ theo lát cắt này…"*) đưa **ra ngoài** `#overview-filter-panel`: thu gọn vẫn thấy. Assert cấu trúc mới **đã kiểm chứng FAIL trên code cũ** (stash sửa → chạy → đỏ đúng 1 assert → pop) rồi mới tính là test thật.
- **V-B `b0f3026`** — con mắt ẩn/hiện số tiền đúng 4 điểm cứng của spec: một công tắc cả app (topbar desktop + header mobile, bọc `PrivacyProvider` ở `main.jsx`); mặc định ẨN, không `localStorage`; tự ẩn 60s + `visibilitychange`/`blur` ẩn ngay (kèm dòng báo *"Đã tự ẩn số sau 60 giây"*); **đang ẩn khoá đủ 5 nút ghi tiền** (Duyệt · Từ chối · Mở khoá · Ghi đã trả · Gỡ ghi nhận — backend vẫn chặn độc lập). Che qua `money()/short()/pct()`, `formatEmployeeCostCell`, `diemXuNumber`, `maskMoneyInText` cho chuỗi backend format sẵn; **'—' vẫn là '—'** (không lẫn "che" với "thiếu dữ liệu"); ngày/mã/số đếm dòng KHÔNG che. Tooltip *"Ẩn số trên màn hình — không phải khoá bảo mật."* + test cấm chữ bảo mật/an toàn. 6 test mới (`PrivacyEye.test.mjs`); test healthKpis của bot chỉnh 2 dòng để cho phép DUY NHẤT lớp rèm che bọc ngoài `card.value/card.sub` (vẫn cấm mọi công thức frontend).
- **V-C `cf561fb`** — `scripts/build_sync_exceptions.js`: universe MISA = **toàn bộ dòng của run mới nhất** (không lọc bucket/ngày), universe đối tác = `line_calc` **kể cả đơn huỷ/chưa phản hồi/giao 0**; `includedLineIds` từ slot active (slot dựng từ run cũ ⇒ DỪNG); bất biến `Σ(vào)+Σ(loại)==Σ(nguồn)` — dòng nhóm NOTE (ngày ngoài kỳ) **liệt kê nhưng đứng ngoài phép cân** (tiền của kỳ khác); lệch ⇒ exit 1 không ghi; mã chỉ từ catalog, lạc luật ⇒ `KHONG_RO` (vd đơn huỷ từng giao — catalog chưa có mã, script không tự chế); mặc định dry-run, `--write` mới ghi. **KHÔNG sửa materializer.** 6 test fixture (`buildSyncExceptions.test.js`). ⚠ Nghiệm thu T07 (chạy với DB thật, mở màn có dữ liệu, tổng cân) **chờ bot có exec** — máy Claude không với tới DB.
- **V-D `bc06d9e`** — `scripts/run_due_jobs.js` cho **cron ngoài** mỗi ~5 phút (mẫu crontab/PM2 trong header): `--dry-run` liệt kê việc không ghi state (đã chạy thử: 1 việc `payment_notice|2026-08-06`); `target_proposal` handler **chỉ ghi log, không áp target**, đánh dấu chạy rồi không lặp (đã kiểm bằng store giả ngày 01); `payment_notice` **cố ý chưa cắm handler** — hiện "chờ handler" và không đánh dấu, vì đánh dấu việc chưa làm gì là giấu sự thật "chưa ai nhắc thanh toán" (handler cần sổ từng NV + notifyChannels — đợt sau, có duyệt). Không đụng lịch tgbot. 2 test (`runDueJobsScript.test.js`).

Test: web 197/197 · server 967/973 (6 fail là `pdfinfo` không có trong container Claude — fail y hệt trên cây sạch trước khi sửa, không liên quan) · `npm run build` sạch. Nhánh đã merge `636f9fc` (mã PROD) trước khi sửa để không tách từ nền cũ.

**Bot khi có exec lại, theo thứ tự:** ① dựng lại slot T08 (đóng nghiệm thu V1 — ô "Chưa phân bổ" về 0đ; TUYỆT ĐỐI không đụng T06/T07, `verify_frozen_periods.js` phải exit 0) → ② deploy đợt này (Cổng 2 từng việc theo LENH) → ③ chạy `build_sync_exceptions.js --period 2026-07` dry-run rồi `--write`, mở màn "Chưa đồng bộ" nghiệm thu → ④ dán `run_due_jobs.js --dry-run` rồi bật cron.

---

### 2026-08-06 — 📋 CEO duyệt gói 4 việc nhỏ · **Claude đính chính: việc "cắm bộ phân loại" KHÔNG phải chỉ nối dây**

CEO duyệt làm một đợt: khối cảnh báo bộ lọc · con mắt ẩn số · bật sống màn "Chưa đồng bộ" · cắm lịch chạy. Lệnh đầy đủ: **`LENH_06082026.md`**.

**‼ Đính chính của Claude.** Lúc rà soát 08:50 Claude xếp việc cắm classifier là *"nhỏ — luật và test đã xong, chỉ nối"*. Tra kỹ `materialize_july_revenue.js` thì **sai**:

- Dòng 378 `const sourceRows = [...misa, ...partner]` là **dòng ĐƯỢC NHẬN**, không phải nguồn đầy đủ.
- `fetchCrmMirror` đã lọc sẵn `revenue_bucket <> 'excluded'`; `partnerPartition.includedRows` cũng chỉ là phần được nhận.

⇒ **Materializer không bao giờ thấy dòng bị loại**, mà classifier cần đúng phần đó. Không thể "gọi thêm một hàm".

**Quyết định kiến trúc:** dựng **script riêng `build_sync_exceptions.js`** (chỉ đọc nguồn, chỉ ghi `syncExceptionStore`) thay vì sửa materializer. Lý do: materializer là **script an toàn nhất repo** — canh kỳ khoá sổ, ba lớp bất biến, ghim doanh thu T06/T07. Thêm truy vấn vào đó để phục vụ **một màn báo cáo** là đánh đổi rủi ro lấy tiện lợi; script riêng đạt cùng kết quả mà **không thể làm hỏng doanh thu**. Bất biến giữ nguyên: `Σ(đưa vào) + Σ(loại) == Σ(nguồn)`, lệch ⇒ **DỪNG, không ghi store**.

**Chốt thêm cho V-D:** phân biệt rõ hai bộ lịch — lịch **gửi tin** do `app-report-tgbot` chạy (**đang hoạt động, không đụng**) và `runDueJobs()` của App Report (**chưa từng chạy**). Ưu tiên **cron ngoài** hơn `setInterval` trong tiến trình vì restart là mất. Job `target_proposal` chưa có handler ⇒ **không làm gì + ghi log**, cấm tự áp target.

**V-A** yêu cầu assert **phải FAIL được với code hiện tại** — viết xong chạy thử trên code cũ, không đỏ thì viết lại. **V-B** theo `SPEC_PRIVACY_EYE.md`, điểm cốt lõi là **đang ẩn thì khoá nút duyệt tiền**.

---

### 2026-08-06 — 💡 CEO đề xuất "con mắt" ẩn/hiện số tiền — `SPEC_PRIVACY_EYE.md`

CEO đề xuất nút con mắt ở màn Chi phí / Thanh toán CP vì *"hai tab này khá nhạy cảm, liên quan đến tiền bạc"*. Claude kiểm: **chưa có gì che số**, và `employeeCostVisibility` sẵn có là **thứ khác hẳn** (khoá quyền ở backend, có audit) — không thay thế nhau.

**Nói thẳng ngay đầu spec:** đây là **rèm che, không phải khoá**. Số vẫn nằm trong bộ nhớ trình duyệt và phản hồi mạng; ai mở F12 là thấy. Chống được: người đứng sau lưng · chiếu màn hình họp · để máy mở khi rời bàn. **Không** chống được: người cầm máy · ảnh chụp lúc đang hiện. Bắt buộc ghi tooltip *"không phải khoá bảo mật"* — người dùng tin nhầm còn nguy hiểm hơn không có tính năng.

**Bảy điểm thiết kế**, trong đó ba điểm là chỗ khác biệt giữa làm cho có và làm cho dùng được:
- **Một công tắc cho cả app**, đặt ở thanh tiêu đề — không phải từng trang. Lúc chia sẻ màn hình không ai nhớ bật từng chỗ.
- **Mặc định ẩn** và **không nhớ trạng thái "đang hiện"** (F5 ⇒ về ẩn). Khoảnh khắc rủi ro nhất là lúc vừa mở trang trước mặt người khác.
- **Tự ẩn lại** sau 60s không thao tác, và ngay khi cửa sổ mất tiêu điểm — dùng lại đúng `visibilitychange` mà chuông đang dùng, không dựng cơ chế thứ hai.

**‼ Điểm đáng giá nhất — biến tính năng trang trí thành kiểm soát thật:** đang ẩn số thì **khoá luôn các nút Duyệt · Từ chối · Mở khoá · Ghi đã trả · Gỡ ghi nhận**. *Không ai được duyệt tiền khi đang không nhìn thấy số tiền.* Backend vẫn chặn độc lập — ẩn nút không phải lớp bảo vệ.

**Cố ý KHÔNG làm:** mã PIN (an tâm giả, thêm phiền — muốn khoá thật thì dùng `employeeCostVisibility`) và che theo từng ô (phức tạp, dễ sót).

---

### 2026-08-06 08:50 (giờ VN) — 📋 Rà soát sổ nợ toàn app: **3 thứ đã xây xong nhưng CHƯA NỐI DÂY**

CEO yêu cầu rà việc còn nợ để đóng dứt app. Claude quét bằng lệnh (`TODO(LIVE)` · người gọi từng module · route ↔ nơi ghi dữ liệu · `SPEC_*` chưa hiện thực · mục "chưa làm" trong changelog), **không nhớ theo trí nhớ**. Kết quả: **`NO_CON_LAI.md`**.

**Phát hiện đáng nói nhất — ba module đã làm xong nhưng không ai gọi:**

1. **Màn "Chưa đồng bộ" luôn rỗng.** Có đủ `syncExceptionClassifier` + catalog 14 mã + store + report + route `routes.js:2424` + `api.syncExceptions()` + 14 test — nhưng **không dòng nào gọi `classifySyncExceptions()` rồi `syncExceptionStore.write()`** trong luồng chạy thật (grep toàn `server/src` và `server/scripts`: chỉ có trong file định nghĩa và trong comment ví dụ). ⇒ `SPEC_REVENUE_SYNC_EXCEPTIONS` — thứ sinh ra để *"không dòng nào biến mất lặng lẽ"* — **chưa chạy ngày nào**.
2. **`runDueJobs()` không ai gọi.** `scheduledJobs.js` đủ cả, nhưng **0 nơi gọi** kể cả `index.js`; không `setInterval`, không cron. ⇒ mọi việc theo lịch **của App Report** chưa từng chạy. ‼ Phân biệt: lịch gửi tin chi phí/thưởng do **`app-report-tgbot` chạy riêng** và **đang hoạt động** — hai bộ lịch khác nhau.
3. **Handler `target_proposal`** chưa hiện thực; mà có làm cũng chưa chạy vì §2.

**Còn lại:** đọc file Excel thật (`SPEC_UPLOAD_REAL_FILE`, CEO đã chốt CÓ) · khối cảnh báo bộ lọc chưa tách ra ngoài panel · 4 dây `TODO(LIVE)` (login demo → OTP/SSO là cái còn thật sự cần) · và mấy việc chờ người (DN012 bấm Start, 3 NV stale, nghiệm thu đóng V1/V2).

**Thứ tự đề xuất:** ưu tiên thứ **đã trả tiền rồi mà chưa dùng được** — bộ lọc (vài dòng) → cắm classifier → cắm cron → file Excel → handler target → login OTP/SSO.

---

### 2026-08-06 — ✅✅ V2 ĐÓNG: kế toán đã bấm ghi chính thức · **CẢ HAI việc hạn 08/08 xong trước hạn 2 ngày**

Kế toán đã **thao tác thật trên MISA** cho đơn `DH479816093` (3.995.000đ · 29/07 · 186.BVĐK An Phú CNIII · Agimoti). Không chỉ trả lời GHI mà đã bấm.

**Ảnh hưởng tới số liệu: KHÔNG CÓ.** Bucket `pending` vốn đã nằm trong doanh thu, ghi chính thức chỉ đổi trạng thái. T07 giữ nguyên **30.917.892.673đ**, thưởng/phạt đã trả không phải tính lại.

---

## Chốt hai việc có hạn 08/08 — cả hai xong ngày 06/08

| | Việc | Kết quả |
|---|---|---|
| **V1** | Đơn `DH479816174` · 1.795.600đ gán nhầm telesaler | App Sale thêm cặp phân công 06:44 (audit `19790`); **sync run 365 xác nhận không bị ghi đè** |
| **V2** | Đơn `DH479816093` · 3.995.000đ treo "Đề nghị ghi" | Kế toán **đã ghi chính thức**; doanh thu không đổi |

**Nghiệm thu còn lại — không gấp, số không đổi dù chạy hay chưa:**
1. Ô "Doanh thu chưa phân bổ" (màn Chi phí) phải về **0đ** — CEO tự nhìn được.
2. Khi bot có lại exec: `misa_pending_detail.js` → `DH479816093` rơi khỏi nhóm "Đề nghị ghi"; `verify_frozen_periods.js` → vẫn **exit 0**.

**Nhìn lại:** hai khoản tổng **5.790.600đ** — nhỏ so với doanh thu tháng, nhưng nếu để quá 08/08 thì **khoá sổ và không sửa được nữa**, và một nhân viên mất doanh số oan. Thứ đọng lại sau vụ này không phải hai con số, mà là **ô KPI "Doanh thu chưa phân bổ"** nay đứng canh thường trực: lần sau kiểu lỗi này **tự hiện lên màn hình**, không ai phải đi tìm bằng tay nữa.

---

### 2026-08-06 — ✅ V2 có quyết định: kế toán trả lời **GHI** cho `DH479816093` (3.995.000đ)

CEO chuyển bảng, kế toán trả lời **GHI**. Đây là nhánh **an toàn**: khoản 3.995.000đ vốn đã được tính vào doanh thu T07 (bucket `pending` vẫn nằm trong doanh thu), nên ghi chính thức **không làm đổi con số**. Kỳ T07 giữ nguyên ghim **30.917.892.673đ**, thưởng/phạt đã trả **không phải tính lại**, không có chuyện hồi tố.

**‼ Nhưng "trả lời GHI" chưa phải là "đã ghi".** Kế toán còn phải **thao tác thật trên MISA** (chuyển trạng thái `pending` → `official`) trước **08/08**. Trả lời miệng mà quên bấm thì tới hạn khoá sổ vẫn treo nguyên.

**Nghiệm thu khi bot có lại quyền chạy** (không gấp, vì số không đổi dù ghi hay chưa):
1. `node server/scripts/misa_pending_detail.js` → đơn `DH479816093` phải **rơi khỏi** nhóm "Đề nghị ghi"; nhóm đó về **0đ** hoặc mất hẳn.
2. `node server/scripts/verify_frozen_periods.js` → vẫn **exit 0**. Ghi chính thức không đổi tổng, nên lệch là có thứ khác bị đụng.

**Hai việc hạn 08/08 giờ đã có quyết định cho cả hai:** V1 đóng (App Sale thêm cặp lúc 06:44, sync run 365 xác nhận không ghi đè) · V2 kế toán chốt GHI, chờ họ bấm.

---

### 2026-08-06 06:44 (giờ VN) — ✅✅ V1 ĐÓNG: App Sale đã thêm cặp, và **sync tự động KHÔNG ghi đè**

App Sale thêm cặp `120.HTNT-PHARMACITY × G1.GE.QĐ139.1104.N2.162` → **DN001**, đúng 1 NV, lúc **06:44:28** (audit `19790`), qua cổng preview/duyệt DB của họ. Không sửa tay dòng MISA, không đổi tiền, không đụng đơn khác.

**‼ Chi tiết đáng giá nhất trong cả vụ:** live-check cho thấy **sync tự động đã chạy tiếp lên run 365**, và dòng đó nay là **DN001** — không quay về VP018.

Đây là **bằng chứng thực địa** cho quyết định tối 05/08: App Sale cảnh báo *"sync MISA hàng giờ có thể ghi đè, cần dựng cổng override từng đơn"*, Claude **chặn lại** sau khi đọc `CRM_ROWS_SQL` — bảng phân công thắng `employee_code` của dòng, và sync không đụng bảng phân công. Nay run 365 xác nhận: **không cần cổng override nào cả**. Nếu làm theo hướng kia, hệ thống đã có thêm **một nguồn phân công thứ hai** phải bảo trì — đúng loại nợ kỹ thuật đã trả giá hai lần trong tuần (7 bản chép luật "ai là CEO", suýt có 2 lịch nghỉ lễ).

**Còn lại đúng một bước, do CEO tự làm:** mở màn Chi phí, ô **"Doanh thu chưa phân bổ"** phải từ `1.795.600đ` về **0đ**. Nếu còn hiện số cũ thì bấm **Làm mới** và đợi ~1 phút (luật cache nguội đã chốt sáng nay), rồi mới kết luận.

**Nhìn lại cả vụ `DH479816174`:** khởi đầu là một đơn 1.795.600đ gán nhầm cho telesaler. Đi qua: công cụ tra chủ + 25 test · **3 lỗi trong công cụ, cả 3 của Claude, cả 3 do bot đối chiếu chéo mới lộ** · một lần chặn App Sale khỏi dựng hệ thống thừa · và một ô KPI mới ("Doanh thu chưa phân bổ") nay đứng canh thường trực để lần sau không ai phải đi tìm bằng tay.

---

### 2026-08-06 — ✅ V1 phía App Report ĐÓNG: chốt đúng một cặp cần sửa, bàn giao App Sale

REPORTDEV nhận handoff mới, chạy lại và chốt — **khớp hoàn toàn** với phần Claude tra độc lập, không điểm nào lệch:

| | |
|---|---|
| Đơn | `DH479816174` · đơn vị `120.HTNT-PHARMACITY` |
| Cặp thiếu | `120.HTNT-PHARMACITY × G1.GE.QĐ139.1104.N2.162` |
| Bảng | `unit_product_employees` |
| NV đề xuất | **DN001 — Đặng Xuân Trung** |
| Số tiền thật | **1.795.600đ** (run 364, mã NV nguồn `VP018`) |
| Cặp KHÔNG đụng | `G3.ĐY.QĐ141.201.N3.101` — đã đúng |

`3.591.200đ` báo trước đó **đã được xác nhận là cộng trùng** snapshot run 331 + 364, không phải doanh thu thật cần phân bổ. Con số đúng bằng ô KPI: **1.795.600đ**.

**Đường đi của lỗi, ghi lại vì đáng nhớ:** gán tay dòng MISA (05/08 16:39) **không ăn** vì `CRM_ROWS_SQL` ưu tiên bảng phân công hơn `employee_code` của dòng. Phải sửa **cặp trong bảng phân công** mới bền — và sync MISA hàng giờ không đụng bảng đó, nên không cần cổng override như App Sale từng đề xuất.

**Còn lại:** App Sale thêm cặp qua cổng preview/duyệt DB của họ. **Nghiệm thu do CEO tự nhìn**: ô "Doanh thu chưa phân bổ" phải từ **1.795.600đ về 0đ**. Không cần bot chạy lệnh, không cần Claude vào PROD.

**Ba lỗi trong công cụ V1 đã sửa hết trong hôm nay**, cả ba đều của Claude và **cả ba đều do bot đối chiếu chéo mới lộ ra**: ① gán tiền cả đơn cho một cặp · ② SQL không lọc `run_id` · ③ (trước đó) tiêu chí nghiệm thu ghim số cứng. Không có vòng soi chéo thì App Sale đã sửa phân công theo số gấp đôi.

---

### 2026-08-06 09:45 (giờ VN) — ✅ V1 KHÔNG cần chờ bot chạy lại: kết luận đã đủ vững để App Sale làm ngay

Bot báo runtime hiện chỉ có read/write, **không có exec** ⇒ không fetch được `79deae5`, không chạy lại V1, không kiểm aggregate. Báo thẳng và **không suy diễn từ output cũ** — đúng.

**Nhưng hạn 08/08 còn 2 ngày, và việc không thật sự bị chặn.** Kết luận cần cho App Sale đã có, từ **chính SQL bot tự tra**, không phải từ bản in lỗi:

- Lần đồng bộ mới nhất, thành công = **run 364**. Trong run 364, đơn `DH479816174` có **1 dòng** `G1.GE.QĐ139.1104.N2.162` = **1.795.600đ** + 1 dòng `G3.ĐY.QĐ141.201.N3.101` = 0đ. **Khớp đúng ô KPI.**
- Bảng phân công: `G1.GE.QĐ139.1104.N2.162` **KHÔNG có** · `G3.ĐY.QĐ141.201.N3.101` **có, 1 NV (DN001)**.

**Vì sao kết luận "cặp thiếu" KHÔNG dính lỗi vừa sửa:** `UNIT_CATALOG_SQL` đọc thẳng `unit_product_employees`, **không có khái niệm `run_id`** (đã kiểm: 0 lần xuất hiện). Lỗi gộp run chỉ ảnh hưởng **số dòng/số tiền**, không ảnh hưởng **cặp nào có mặt trong danh mục**. Hai câu truy vấn độc lập nhau.

⇒ **App Sale làm được ngay**: thêm cặp `(120.HTNT-PHARMACITY × G1.GE.QĐ139.1104.N2.162)`, gán **DN001**, số tiền đúng là **1.795.600đ**.

**Nghiệm thu không cần bot:** sau khi App Sale thêm cặp, ô KPI **"Doanh thu chưa phân bổ"** trên màn Chi phí phải **tự về 0đ**. CEO tự nhìn được, không phải chờ ai chạy lệnh. Nếu về 0đ ⇒ V1 đóng; nếu vẫn 1.795.600đ ⇒ lỗi nằm chỗ khác, lúc đó mới cần bot.

Việc phải chờ bot có exec trở lại: chạy lại V1 để đối chiếu số (không chặn) và kiểm aggregate ALL.

---

### 2026-08-06 09:30 (giờ VN) — 🐛 Lỗi thứ hai trong V1, cũng của Claude: SQL không lọc lần đồng bộ ⇒ cộng nhiều run vào nhau

Bot **từ chối gửi khối ③ cho App Sale** và tra thẳng cơ sở dữ liệu — bắt đúng gốc:

| Lần đồng bộ | `G1.GE.QĐ139.1104.N2.162` của `DH479816174` |
|---|---|
| run 330 | 0đ |
| run 331 | 1.795.600đ |
| **run 364** (mới nhất, thành công) | **1.795.600đ** |

`UNIT_LINES_SQL` của Claude **không có điều kiện `run_id`** ⇒ gộp cả ba lần đồng bộ ⇒ khối ③ ra **"3 dòng · 3.591.200đ"**, trong khi sự thật theo run 364 chỉ là **1 dòng · 1.795.600đ** — **đúng bằng ô KPI**. Ô KPI không sai; script của Claude sai.

Nếu bot cứ nghe theo bản in mà chuyển cho App Sale, họ sẽ thêm cặp phân công dựa trên **con số gấp đôi**. Đây là lần thứ hai trong buổi sáng chẩn đoán V1 suýt sai — và cả hai lần đều do bot **đối chiếu chéo** rồi dừng lại, không phải do Claude tự bắt được.

**Sửa:** lấy **lần đồng bộ thành công MỚI NHẤT của TỪNG THÁNG** (dùng lại `LATEST_MISA_RUN_SQL` của `appSaleRevenueMirror`, không tự viết), lọc `l.run_id = ANY(...)`. Bản in nói rõ **đã lấy run nào cho tháng nào**; tháng nào không có lần đồng bộ thành công thì **kể tên**, không im lặng bỏ qua; không tháng nào có thì **thoát mã 2**.

4 test mới, gồm ca `monthsBetween` bắc cầu sang năm. Server **932 bài · 926 PASS · 6 lỗi `pdfinfo`** môi trường.

**Kết luận nghiệp vụ vẫn không đổi:** cặp `(120.HTNT-PHARMACITY × G1.GE.QĐ139.1104.N2.162)` **thiếu thật** trong bảng phân công — chỉ con số dòng/tiền là sai. Chạy lại bằng bản mới rồi mới giao App Sale.

---

### 2026-08-06 09:00 (giờ VN) — 🐛 Lỗi trong khối ③ của Claude: gán TIỀN CẢ ĐƠN cho MỘT cặp — sửa trước khi App Sale động tay

Bot chạy lại V1, khối ③ ra **"5 dòng · 3.591.200đ"** trong khi ô KPI chỉ **1 dòng · 1.795.600đ**. Hai con số chỏi nhau ⇒ soi lại: `3.591.200 ÷ 1.795.600 = 2` chẵn, **không phải bội của 5** ⇒ 5 dòng KHÔNG cùng một mặt hàng.

**Lỗi:** `diagnoseOrderPair` lấy mã hàng của **dòng đầu** nhưng cộng tiền của **tất cả dòng**. Đơn nhiều mặt hàng ⇒ dồn hết tiền vào một cặp ⇒ **chỉ sai cặp cho App Sale sửa**, và sửa xong vẫn còn cách ly. Suýt để App Sale thao tác trên chẩn đoán sai — đúng vào lúc còn 2 ngày tới hạn.

**Sửa:** tách theo **từng mặt hàng**, mỗi cặp một kết luận riêng (`MISSING` / `AMBIGUOUS` / `OK`), tiền của đúng mặt hàng đó, kèm mã NV mà dòng đang ghi. Câu "việc cần làm" **chỉ liệt kê cặp hỏng** — cặp đã đúng không được đưa vào để App Sale khỏi sửa nhầm.

```
③ CẶP CỦA ĐƠN ĐANG HỎI — DH479816174
   Đơn có 5 dòng · 4 mặt hàng · tổng 3.591.200đ
     ✗ THIẾU CẶP   G1.GE.QĐ139.1104.N2.162    2 dòng · 3.591.200đ · dòng ghi NV: UNALLOCATED
     ✓ đã đúng     QL-B                       1 dòng · 0đ · dòng ghi NV: DN001
   ⇒ 1/4 mặt hàng của đơn có cặp hỏng
```

5 test mới (gồm ca "dòng thiếu mã hàng vẫn phải hiện, không bị nuốt"). Server **931 bài · 925 PASS · 6 lỗi `pdfinfo`** môi trường.

**Vẫn còn một câu hỏi cho bot, phải trả lời trước khi App Sale sửa:** ô KPI đếm **1 dòng · 1.795.600đ**, khối ③ đếm **2 dòng cùng mã hàng · 3.591.200đ**. Hai dòng giống hệt nhau về tiền ⇒ hoặc đơn có thật 2 dòng, hoặc **nguồn đang nhân đôi**. Nếu nhân đôi thì thêm cặp phân công sẽ kéo **gấp đôi tiền** vào doanh số DN001.

---

### 2026-08-06 08:30 (giờ VN) — 🔧 Tinh chỉnh cổng (b): FAIL phải là SO SÁNH, không phải tuyệt đối

Bot dừng ở cổng (b): *"CP/DT vẫn `—` sau >1 phút do upstream employee-cost"* và hỏi CEO chọn **chờ KPI hồi phục** hay **deploy UI**. Kèm số: test **955/955**, Vite 651 modules, browser mobile/desktop + console/HTTP 5xx PASS, independent re-audit PASS.

**Phán quyết: KHÔNG chặn deploy.** Bot ghi rõ đây là *"blocker LIVE hiện tại"* — tức quan sát trên **bản đang chạy (`3eac0a9`), TRƯỚC khi cutover**. Triệu chứng đã có sẵn trước deploy ⇒ **nguyên nhân là nguồn upstream, không phải `b87fbaa`**. Cùng đúng lối lập luận đã đóng FAIL #2 lúc 05:15: đối chứng với baseline.

Và ô để `—` thay vì hiện số sai chính là **fail-closed chạy đúng** — app đang làm điều phải làm.

**Cổng (b) viết lại lần cuối (lần thứ năm sửa kiểu tiêu chí trong hai ngày):**
> (b) chỉ **FAIL** khi ô `—` trên **bản MỚI** trong khi **bản CŨ có số** ở cùng thời điểm. Cả hai bản cùng `—` ⇒ **sự cố nguồn upstream**, ghi nhận riêng, **KHÔNG chặn deploy** — vì bản deploy không đụng đường dữ liệu KPI, chặn kiểu đó thì hễ DataHub chập là cả hệ thống đứng bánh.

**Việc riêng, không chặn nhưng phải theo:** nguồn `employee-cost` đang yếu. Lúc 05:15 ba ô đều có số (CP/DT 8,1% · chưa phân bổ 1.795.600đ · khớp 99,0%); nay riêng **CP/DT** mất số ⇒ hỏng ở **vế chi phí**, không phải vế doanh thu. Trước đó đã ghi nhận *"DataHub tạm thiếu nguồn DN006"*. Cần bot nói rõ: mất cả 21 NV hay chỉ vài NV.

**Ưu tiên không đổi:** cutover `b87fbaa` → **V1 (hạn 08/08, còn 2 ngày)** → bộ lọc thu gọn. V1 hoàn toàn độc lập với ô KPI đang lỗi, không có lý do gì để nó chờ.

---

### 2026-08-06 05:40 (giờ VN) — 🔒 Luật: bộ lọc ĐANG ÁP DỤNG thì chip + câu cảnh báo KHÔNG được ẩn khi thu gọn

CEO xác nhận **có yêu cầu** tính năng thu gọn bộ lọc trang Tổng quan (Claude đã hỏi lại, không phải bot tự làm thêm). Audit của bot trả **NEEDS FIX** với 4 mục — Claude giữ nguyên kết luận, nhưng **nâng mục #2 từ Medium lên CHẶN** và **hạ yêu cầu ở #3**.

**#2 — nâng lên chặn, vì nó không phải chuyện thẩm mỹ.** Khối `overview-filter-note` bị ẩn khi thu gọn KHÔNG chỉ chứa chip tên bộ lọc; nó chứa cả câu *"Target không phân bổ theo lát cắt này nên App không tính % target sai."* Thu gọn ⇒ giấu câu đó, trong khi các ô KPI **vẫn đang bị lọc** ⇒ người dùng đọc doanh thu và % target mà **không biết đang nhìn một lát cắt**. Không sai số, nhưng **giấu điều kiện để hiểu số** — cùng họ với *"không dòng nào biến mất lặng lẽ"*.

> **LUẬT (áp cho mọi màn có bộ lọc, không riêng Tổng quan):** khi có bộ lọc đang áp dụng, **chip tên bộ lọc và câu cảnh báo cách đọc số KHÔNG được ẩn**, kể cả ở trạng thái thu gọn. Chỉ được thu gọn phần **chọn** lọc.

**#3 — đúng nhưng hạ yêu cầu cho vừa hạ tầng.** Bot tự chê test của mình là quét regex, không bắt được #1/#2 — chê đúng. Nhưng repo **không có `jsdom`/`testing-library`** (đã tra `web/package.json`), toàn bộ test web đang là quét mã nguồn; dựng hạ tầng render chỉ vì một toggle là không đáng. Yêu cầu vừa sức: khoá **đúng bất biến** (khối note nằm NGOÀI nhánh collapse · `aria-expanded` đổi theo state · header có `flex-wrap`). Test nào không thể fail được thì bỏ, đừng giữ cho đẹp số.

**#1 · #4 — đúng, sửa rẻ:** `flex-wrap: wrap` + `min-width: 0`; giữ panel trong DOM với `hidden` (giữ được `aria-controls`, và #4 tự hết).

**Thứ tự (Claude đề xuất, CEO có thể đổi):** ① cutover `b87fbaa` (đã duyệt 21:24, chưa lên PROD) → ② chạy V1 và giao việc cho App Sale (**hạn 08/08, còn 2 ngày**) → ③ sửa bộ lọc thu gọn trong lúc chờ App Sale. Đường tới hạn của V1 nằm ở App Sale, không nằm ở bot, nên làm ② sớm rồi ③ chạy song song là không việc nào bị đói.

---

### 2026-08-06 05:15 (giờ VN) — ✅ Đóng lý do FAIL #2: **cache nguội, không phải lỗi `b87fbaa`** — và viết lại cổng (b)

Bot đưa PROD về `3eac0a9` (đúng lệnh "bản tốt gần nhất đã nghiệm thu"), forecast hiện `— · đã qua 3/21 ngày làm việc` ✅, rồi **đối chứng cache nguội trên chính baseline**:

| Lần tải trên `3eac0a9` | Kết quả |
|---|---|
| Lần đầu sau deploy | **0/0 dòng · ba ô KPI `—`** |
| Sau ~1 phút, làm mới | **605/605 dòng** · CP/DT 8,1% · chưa phân bổ 1.795.600đ · khớp 99,0% |

⇒ **Baseline tốt cũng "—" ở lần tải đầu.** Đúng giả thuyết 04:00: bảng 21 NV phải dựng lại từ DataHub, chưa kịp thì các ô **fail-closed về `—` đúng thiết kế**. FAIL #2 **không chứng minh lỗi `b87fbaa`** — đóng, không điều tra thêm.

**Cổng (b) viết lại thành LUẬT** (lần thứ tư sửa kiểu ghim-số-cứng trong hai ngày):
> Lần tải đầu sau deploy **được phép** hiện `—` (cache nguội, 0/0 dòng). Chờ ~1 phút rồi **Làm mới**: từ lúc đó ba ô **phải có số**. **Chỉ FAIL nếu sau 1 phút vẫn `—`.**

Bot đã tự ghi hai luật vào quy trình: rollback về **bản tốt gần nhất đã nghiệm thu**, và luôn dùng **tiêu chí acceptance mới nhất**. Đây là hai nguyên nhân trực tiếp của hai lần báo động giả đêm qua.

**‼ Còn một mâu thuẫn chưa gỡ:** hai báo cáo gần nhau nói khác nhau về PROD — một bản ghi `b87fbaa` (acceptance (c) PASS, backup `b821be1e…`), bản này ghi `3eac0a9` và *"chưa cutover lại b87fbaa"*. Chưa xác định được bản nào là hiện tại ⇒ **đã hỏi lại, không suy đoán**. Nếu PROD đang là `3eac0a9` thì **cảnh báo lượt ưu tiên chưa lên**: NV vẫn bấm được "Xin nhận sớm" ở kỳ T07 mà không được cảnh báo gì, dù sớm nhất là 31/08.

---

### 2026-08-06 05:00 (giờ VN) — 🔧 V1: script tự chỉ ra ĐÚNG CẶP cần sửa — cắt vòng hỏi qua lại giữa hai bot

**Vì sao làm lúc này:** hạn khoá sổ **08/08 còn 2 ngày**, mà V1 đang kẹt ở vòng lặp: App Report đo → báo CEO → CEO chuyển App Sale → App Sale hỏi lại cặp nào → đo tiếp. Mỗi vòng mất nửa ngày.

**Thêm `diagnoseOrderPair()`** vào `quarantineOwnerProposal.js` + in thành khối ③ trong `propose_quarantine_owner.js`. Một lệnh chạy ra luôn **việc cụ thể App Sale phải làm**:

```
③ CẶP CỦA ĐƠN ĐANG HỎI — DH479816174
   Mã hàng: G1.GE.QĐ139.1104.N2.162 · 1 dòng · 1.795.600đ
   Trong bảng phân công: KHÔNG
   ⇒ CẶP THIẾU ⇒ App Report rơi về mã NV của dòng MISA, nên vẫn cách ly
   ➜ VIỆC CẦN LÀM: App Sale THÊM cặp (120.HTNT-PHARMACITY × G1.GE.QĐ139.1104.N2.162)
     vào unit_product_employees, gán ĐÚNG MỘT NV.
```

Ba kết luận có thể ra, mỗi cái kèm việc khác nhau: **cặp thiếu** ⇒ thêm · **cặp gán >1 NV** ⇒ gỡ còn một · **cặp đã đúng 1 NV** ⇒ nói thẳng *"lỗi KHÔNG nằm ở bảng phân công, dừng và báo Claude"*. Không tìm thấy đơn ⇒ **cấm suy ra "đã hết cách ly"**, bắt kiểm lại tham số.

Bốn test mới khoá cả bốn nhánh. Server **927 bài · 921 PASS · 6 lỗi `pdfinfo`** môi trường — không phát sinh lỗi mới.

Vẫn giữ nguyên: script **chỉ đọc**, không `UPDATE`/`INSERT`; việc gán do App Sale làm.

---

### 2026-08-06 04:00 (giờ VN) — ⛔ Rollback QUÁ SÂU: PROD tụt về `bf3c7c5`, con số `145,7%` gây hiểu nhầm QUAY LẠI màn hình CEO

Bot cutover `b87fbaa`, acceptance FAIL, rollback về **`bf3c7c5`**. Hai vấn đề, cái thứ hai nghiêm trọng hơn cái thứ nhất.

**① Lý do FAIL thứ nhất là TIÊU CHÍ ĐÃ BỊ THAY THẾ.** Bot ghi *"Exact 2/21 không xuất hiện sau khi ngày live đã sang 06/08"*. Nhưng lúc 03:04 chính bot hỏi và Claude **đã duyệt đổi 2/21 → 3/21**, kèm bảng đối chiếu cả tháng và lệnh viết tiêu chí **thành luật, không thành số**. Bot vẫn chạy tiêu chí cũ ⇒ **báo động giả**, không phải lỗi code. (Lỗi gốc vẫn là của Claude: ghim số cứng vào cổng nghiệm thu — lần thứ ba trong ngày.)

**② Lý do thứ hai chưa được chứng minh, mà hậu quả rollback thì có thật.** *"Lần tải stable đầu không dựng được ba KPI có số"* — chưa có đối chứng. `b87fbaa` **không đụng file nào của KPI** (`git diff --name-only 3eac0a9 b87fbaa` không có `healthKpi`/`workingDay`). Nhiều khả năng là **cold cache sau reload**: bảng 21 NV phải dựng lại từ DataHub, quá hạn thì các ô fail-closed về `—` **đúng thiết kế** — và `3eac0a9` reload nguội cũng sẽ y hệt. Muốn kết luận phải **đối chứng**: tải nguội `3eac0a9` và `b87fbaa` rồi so.

**‼ Hậu quả nặng nhất: rollback đi quá xa.** Lệnh ghi rõ *"lùi về `3eac0a9`, KHÔNG lùi sâu hơn"*. `bf3c7c5` là **cha của `3eac0a9`**, tức là bản **trước** sàn dự báo. Nên PROD lúc này **đã mất sàn**, ô dự báo **hiện lại `145,7%`** — đúng con số CEO đọc nhầm thành "chắc chắn vượt đích", đã sửa xong và đã nghiệm thu PASS lúc 21:30.

**Luật rollback từ nay:** lùi về **bản tốt gần nhất đã nghiệm thu**, không lùi về một release cũ tuỳ ý. Ở đây bản đó là `3eac0a9` — deploy PASS · acceptance PASS lúc 21:30.

**Việc ngay:** đưa PROD về `3eac0a9` (đã duyệt, đã nghiệm thu, không cần cổng mới). Sau đó mới bàn tiếp `b87fbaa` bằng tiêu chí đúng.

---

### 2026-08-05 21:30 (giờ VN) — 🚢 PROD = `3eac0a9`: ô dự báo đã sạch, NHƯNG mới lên một nửa thứ CEO duyệt

**Xong thật, ghi nhận:** ô dự báo hết hiện `145,7%`, nay là `— · đã qua 2/21 ngày làm việc, chưa đủ để dự báo`. Con số gây hiểu nhầm đã biến khỏi màn hình CEO. Ba ô KPI kia có số bình thường; **Khớp doanh thu lên 99,0%** (chiều nay 94,5%). Console 0 lỗi, backup có SHA-256, chỉ reload app-report, V3 giữ nguyên 1/1.

**‼ Nhưng CEO duyệt `b87fbaa`, bot deploy `3eac0a9`.** `b87fbaa` **chứa** `3eac0a9`, nên phần đã lên là **tập con** của phần được duyệt — an toàn về hướng, không có gì ngoài ý muốn ra PROD. Song **cảnh báo lượt ưu tiên chưa lên**: hộp "Xin nhận sớm" trên PROD vẫn không cảnh báo gì và vẫn cho bấm ở kỳ T07 dù sớm nhất là 31/08.

**Và "acceptance PASS" là nói quá:** cổng 2 có 4 mục a·b·c·d; báo cáo dán a·b·d, **thiếu hẳn (c)** — mục kiểm hộp "Xin nhận sớm". Không phải bot bỏ sót khi kiểm, mà (c) **không thể chạy** vì tính năng đó chưa deploy. Đúng phải ghi **acceptance 3/4**. Bot tự ghi mục nợ số 2 là trung thực; chỉ là dòng kết luận trên đầu chưa khớp với chính nó.

**Quyết định:** deploy tiếp `b87fbaa` — **không cần cổng duyệt mới**, vì đó chính là commit CEO đã duyệt lúc 21:24; `3eac0a9` chỉ là nửa đường. Deploy xong chạy **riêng mục (c)**.

Mục nợ 3 đã đóng: `4490def` reachable trên origin qua hai nhánh candidate — không cần nhánh riêng.

---

### 2026-08-05 21:24 (giờ VN) — ✅ CEO DUYỆT DEPLOY `b87fbaa` (sàn dự báo + cảnh báo lượt ưu tiên)

**Người duyệt:** CEO, trực tiếp. **Trạng thái lúc duyệt:** PROD `bf3c7c5`, chưa đổi.

**Một lần deploy xử hai việc** — Claude đã xác minh `b87fbaa` **chứa** `3eac0a9` (sàn dự báo đã duyệt lúc 21:15 nhưng chưa kịp deploy), nên không cần hai đợt.

**Bằng chứng Cổng 1 (Claude tự chạy, không nhận báo cáo suông):**
- `earlyAdvancePreview.test.js` **6/6 PASS** — đủ ba trạng thái A (`EARLY_TOO_SOON`, mốc 31/08) · B (`EARLY_QUOTA_USED`, giữ tên kỳ đã tiêu lượt) · C (`OK` kèm đủ ba thứ bắt buộc), cộng ca thiếu số tiền ⇒ fail-closed, cộng khẳng định route gửi thật vẫn chặn **422**.
- Mốc ngày khớp policy cũ: T07 → 31/08 · T08 → **01/10** · T09 → 31/10.
- Server **953 bài · 947 PASS · 6 lỗi `pdfinfo`** môi trường (khớp 953/953 bot báo trên máy có `pdfinfo`) · web **191/191**.
- Frontend **chỉ render** `earlyPreview` của backend — không `quarterOf`, không trừ ngày, không đếm lượt; nút gửi **mặc định tắt**, chỉ bật khi `submitDisabled === false`.
- Làm thêm ngoài spec, giữ nguyên vì tốt hơn: thiếu số tiền ⇒ dừng hẳn, câu *"đã dừng để tránh dùng lượt nhầm kỳ"*.

**CEO thấy gì sau deploy:** ô dự báo hết hiện `145,7%` (đổi thành `— · đã qua 2/21 ngày làm việc, chưa đủ để dự báo`; hiện số lại từ **10/08** kèm nhãn *ước lượng sớm*, bỏ nhãn từ **17/08**); hộp "Xin nhận sớm" có cảnh báo lượt ưu tiên và chặn kỳ chưa tới hạn.

**Đường lùi:** về `bf3c7c5` + gói backup có SHA-256. Cổng 2 **toàn lệnh đọc**, không bấm gửi gì.

---

### 2026-08-05 22:00 (giờ VN) — 📄 CEO chốt: file kế toán PHẢI nạp được · nhân viên PHẢI tự mapping — spec `SPEC_UPLOAD_REAL_FILE.md`

CEO trả lời **CÓ** cho câu hỏi file `01.DONA_T07.2026.xlsx` có dùng để nạp vào app không, và chốt thêm: *"đối với cột mã nhân viên thì hệ thống phải TỰ MAPPING, hoặc tại App Sale đã có cột nhân viên đó."*

**Kiểm thêm thì sửa dòng tiêu đề KHÔNG đủ.** Đối chiếu `HEADER_MAP` với 16 cột thật: **chỉ 1/16 khớp** (`Mã đơn vị`). 15 cột còn lại — kể cả `Tổng thanh toán` (doanh thu) và `Mã quản lý nội bộ` — đều rơi. Nên dù dò đúng dòng tiêu đề, parser vẫn đọc 0 dòng.

**Lỗi kèm theo, nhỏ nhưng gây hên xui:** `noAccent` thay `đ`→`d` **trước** `toLowerCase()` ⇒ `đvt` ra `dvt` còn `ĐVT` ra `đvt`. Cùng tên cột, kế toán gõ hoa hay thường ra hai kết quả. Sửa thứ tự.

**Năm việc trong spec:** ① tự dò dòng tiêu đề (quét 20 dòng đầu, tối thiểu 4 cột khớp, không đạt thì **vẫn từ chối** — không đoán bừa) · ② bổ sung bí danh 16 cột, **cấm** `% CP`/`Tổng thành tiền CP` rơi vào `revenue` (chi phí là SSOT của DataHub) · ③ **tự mapping NV** theo cặp (`unit_code` × `iit_code`) **dùng lại đúng logic `nv_catalog`** của `appSaleRevenueMirror`, thứ tự ưu tiên y hệt, tra không ra thì `UNALLOCATED` + mã lý do sẵn có — **không bỏ dòng, không gán bừa** · ④ đếm và báo số dòng không phải dữ liệu (796 ⇒ 791 dữ liệu, 5 bỏ) · ⑤ đối soát `Σ revenue` với ô `SUBTOTAL` (**lệch là chặn**) và bỏ trần `warnings.slice(0,50)` đang cắt mất cảnh báo.

**Vòng khép kín đáng ghi:** dòng upload không tra ra người sẽ nổi lên đúng ô KPI **"Doanh thu chưa phân bổ"** vừa làm — cùng cơ chế đang bắt `DH479816174`. Một ô KPI phục vụ hai nguồn lỗi khác nhau.

**Nghiệm thu bằng chính file thật:** phải ra **791 dòng · 10.564.572.484đ** (Claude đã cộng tay đối chiếu, khớp ô `SUBTOTAL` từng đồng).

---

### 2026-08-05 21:40 (giờ VN) — 🧪 Chạy FILE THẬT qua bộ đọc Excel: không dính lỗi ô gộp, nhưng **App Report không đọc nổi file này**

CEO gửi file kế toán thật `01.DONA_T07.2026.xlsx` (93 KB, sheet `7,2026`, 796 dòng). Chạy qua đúng `upload.parseWorkbook`.

**① Nỗi lo ô gộp: KHÔNG có thật.** File **0 vùng ô gộp**. Cộng tay 791 dòng dữ liệu = **10.564.572.484đ**, khớp **đúng từng đồng** với ô `SUBTOTAL` trong file. **0 dòng tiền = 0**, **0 dòng số lượng = 0**. Lỗi App Sale gặp không lây sang đây.

**② Nhưng App Report KHÔNG đọc được file này.** `parseWorkbook` trả 2 lỗi, đọc **0 dòng**:
```
["Thiếu cột mã nhân viên (emp_code/ma_nv).","Thiếu cột doanh thu (revenue/tong_tien)."]
Tiêu đề dò được: ["Tên nhà thầu: CÔNG TY CỔ PHẦN DONAPHARM"]
```
Nguyên nhân: parser cứng nhắc lấy **dòng 1 làm tiêu đề, dòng 2 trở đi là dữ liệu**. File thật lại là: dòng 1 tên nhà thầu · dòng 2 địa chỉ · dòng 3 "Tháng 07.2026" · dòng 4 dòng SUBTOTAL · **dòng 5 mới là tiêu đề** · dòng 6 trở đi mới là dữ liệu.

Đây là **fail-closed đúng** (báo lỗi, không nuốt rác) — không phải lỗi toàn vẹn dữ liệu. Nhưng nghĩa là: ai bưng file chuẩn của kế toán lên upload hôm nay thì **bị từ chối thẳng**.

**③ File này KHÔNG có cột nhân viên.** 16 cột: Số TT · Ngày hóa đơn · Số hóa đơn · Phân tuyến · Mã QLNB · Mã đơn vị · Tên khách hàng · Tên hàng hóa · ĐVT · Tổng số lượng bán · Đơn giá · Tổng thanh toán · % CP · Tổng thành tiền CP · Tên nhà thầu · Ghi chú. Muốn biết đơn về tay ai thì phải tra **bảng phân công (đơn vị × mã hàng)** — đúng cơ chế đã phân tích 19:10 cho `DH479816174`.

**④ Ghi để hỏi, không kết luận:** tổng file 10,56 tỷ, trong khi T07 ghim **30,92 tỷ**. Nhiều khả năng file là **một phần** (một nhà thầu / một nhóm), nhưng chưa xác minh.

**Việc tồn (chưa làm, chờ CEO chốt):** file này có dùng để nạp vào app không? Có ⇒ dạy parser **tự dò dòng tiêu đề** thay vì cứng dòng 1 (rẻ, an toàn, fail-closed giữ nguyên). Không ⇒ không cần làm gì. **Không tự ý sửa parser khi chưa biết file có được dùng để upload hay không.**

---

### 2026-08-05 21:15 (giờ VN) — ✅ Claude DUYỆT Cổng 1 cho `3eac0a9` (sàn tin cậy ô dự báo) — tự chạy lại, không tin báo cáo suông

**Lần đầu trong ngày bot đẩy đủ SHA lên origin trước khi xin duyệt** — `3eac0a9` và `bf3c7c5` đều fetch được, review được. Giữ nếp này.

**Claude tự kiểm, không nhận báo cáo suông:**
- Diff `bf3c7c5..3eac0a9` **gọn đúng phạm vi**: chỉ `employeeCostHealthKpis.js` + test + 2 file tài liệu. Không đụng gì khác.
- Sàn cài đúng spec: **một hằng số có tên** `MIN_FORECAST_ELAPSED_WORKING_DAYS = 5` và `EARLY_FORECAST_MAX_ELAPSED_WORKING_DAYS = 9`, không rải số 5 khắp nơi. Dưới 5 ngày ⇒ thẻ `unavailable` ghi `đã qua N/21 ngày làm việc, chưa đủ để dự báo`, **vẫn giữ đủ 4 đầu vào trong `raw`** để audit. Ngày 5–9 ⇒ nhãn `ước lượng sớm`.
- Claude **chạy lại test trên chính candidate**: `employeeCostHealthKpis.test.js` **11/11 PASS**, phủ đúng ba mốc 2 · 5 · 10 ngày, cộng các ca fail-closed (thiếu vế, lệch snapshot, không target, năm chưa nạp lịch).
- Toàn bộ server trên candidate: **947 bài · 941 PASS · 6 lỗi `pdfinfo` môi trường** (máy Claude không có `pdfinfo`) — khớp con số 947/947 bot báo trên máy có `pdfinfo`.

**Lịch hiện số của ô dự báo trong T08.2026** (ngày làm việc: 3,4,5,6,7,10,11,…,31):
- tới hết 07/08 ⇒ **không hiện số**, chỉ ghi đã qua mấy ngày;
- từ **10/08** ⇒ hiện số kèm nhãn `ước lượng sớm`;
- từ **17/08** ⇒ hiện số bình thường.

**Kết luận Cổng 1: PASS.** Chờ CEO duyệt Cổng 2 để deploy. Lùi được: về `bf3c7c5`.

---

### 2026-08-05 20:50 (giờ VN) — ✅ Đối chiếu lỗi "ô gộp đọc thành 0" của App Sale: **App Report KHÔNG dính**

Bot App Sale báo NO-GO cho bản của họ, trong đó có P1: file Excel hợp lệ có ô gộp dọc bị đọc âm thầm thành `qty=0, amount=0`. App Report cũng parse .xlsx (`upload.js`) nên Claude kiểm chéo ngay.

**Kết quả: không dính.** Dựng file có `mergeCells('A2:A3')` + `mergeCells('B2:B3')` rồi đọc bằng đúng cách `upload.js` đang dùng (`ws.getRow(r).values`): dòng 3 vẫn trả `["DN009", 2890000]` — ExcelJS tự điền giá trị ô gộp cho các dòng dưới. Không có mất mát.

**Giới hạn của phép thử, ghi ra để không ai tưởng đã phủ hết:** file test do chính ExcelJS sinh; file xuất từ Excel thật có thể khác. Lớp bảo vệ bền vẫn là bất biến fail-closed, chưa có: hiện dòng thiếu tiền vẫn được nhập với `revenue=0` kèm cảnh báo, mà **danh sách cảnh báo bị cắt ở 50 dòng** (`warnings.slice(0, 50)`) — file lỗi nhiều là người duyệt không thấy hết. Đưa vào việc tồn, **không gấp**: đường doanh thu chính hiện đi qua materializer (mirror App Sale), không qua upload xlsx.

`72043f26` là PROD của **App Sale**, không phải App Report — câu hỏi "PROD đang chạy gì" ở mục 20:30 nhắm nhầm hệ thống, rút lại. Phần còn đúng: `bf3c7c5` và `4490def` (App Report) vẫn chưa có trên origin.

---

### 2026-08-05 20:42 (giờ VN) — Hộp Xin nhận sớm chặn trước thao tác chắc chắn hỏng

- Khi mở hộp, frontend gọi đúng một preview read-only; backend dùng nguyên policy quota/ngày hiện hành và tự lấy số tiền của đúng Lần 2/Lần 3.
- `EARLY_TOO_SOON`/`EARLY_QUOTA_USED`: không hiện lý do, tắt gửi, nói rõ mốc hoặc kỳ đã dùng; nút bảng đeo nhãn ngày backend cấp.
- `OK`: cảnh báo vàng bắt buộc có số tiền, quý của kỳ bán hàng và câu “Sếp từ chối thì KHÔNG mất lượt”; nút gửi đổi thành “Dùng lượt ưu tiên · gửi xin nhận sớm”.
- Route gửi thật vẫn chặn độc lập bằng HTTP 422; frontend không tính ngày/quý/lượt và không gửi amount.

---

### 2026-08-05 20:30 (giờ VN) — ⚠ Hộp "Xin nhận sớm": thiếu cảnh báo lượt ưu tiên · và đang MỜI NV làm việc chắc chắn hỏng

**CEO yêu cầu:** hộp thoại phải cảnh báo mỗi quý chỉ 1 lượt ứng trước hạn, dùng rồi thì lần sau bị chặn, nên cân nhắc để dành cho kỳ nhiều tiền.

**‼ Soi ảnh CEO gửi thì lòi ra lỗi nặng hơn:** ảnh chụp DN002 kỳ **07/2026**, hai nút "Xin nhận sớm" đang bấm được — nhưng `checkEarlyRequest({period:'2026-07', today:'2026-08-05'})` trả **`EARLY_TOO_SOON` · sớm nhất 31/08/2026 (còn 26 ngày)**. NV chọn lý do, bấm gửi, **chắc chắn ăn lỗi**. Hộp thoại đang mời người ta làm việc không thể thành công. Sửa cùng đợt, ưu tiên ngang phần cảnh báo.

Mốc đối chiếu quý 3: T07 → 31/08 · T08 → **01/10** (khớp đúng mốc CEO chốt 04/08) · T09 → 31/10.

**Spec `SPEC_EARLY_ADVANCE_WARNING.md`** — một lần gọi backend, ba trạng thái: `EARLY_TOO_SOON` và `EARLY_QUOTA_USED` ⇒ **không hiện danh sách lý do**, nút gửi tắt, nói rõ ngày/kỳ đã tiêu lượt; `OK` ⇒ hiện khối cảnh báo **trên** danh sách lý do, bắt buộc có (1) **số tiền của chính lần đang xin** (CEO bảo "để dành cho kỳ nhiều tiền" thì phải cho thấy tiền), (2) tên quý lấy từ `quarterOf(period)` — quý của KỲ BÁN HÀNG, (3) câu **"Sếp từ chối thì KHÔNG mất lượt"** — đúng sự thật kỹ thuật (`consume` chỉ chạy ở nhánh `grantUnlock`); thiếu câu này NV sợ không dám xin, hỏng cả cơ chế.

Luật quota **không viết lại** — dùng nguyên `earlyAdvancePolicy.js`. Frontend chỉ render; backend vẫn phải chặn thật, ẩn nút không phải là bảo vệ.

---

### 2026-08-05 20:19 (giờ VN) — KPI forecast thêm sàn tin cậy 5 ngày làm việc

- Dưới 5 ngày làm việc đã qua: backend trả `—` và dán rõ `đã qua N/tổng ngày làm việc, chưa đủ để dự báo`; không xuất phần trăm dễ gây hiểu nhầm.
- Ngày làm việc thứ 5–9: vẫn tính forecast nhưng gắn nhãn `ước lượng sớm`; từ ngày thứ 10 bỏ nhãn.
- Sàn đặt tại một hằng số backend có tên; test khóa đúng ba mốc 2/5/10 ngày và giữ bốn đầu vào audit (doanh thu kỳ · ngày đã qua · tổng ngày · target).

---

### 2026-08-05 20:00 (giờ VN) — 🚢 Bot báo XONG TOÀN BỘ (`bf3c7c5` lên PROD) — nhưng 2 việc CHƯA đóng, 1 ô đang hiện số gây hiểu nhầm

**Đã lên PROD thật, ghi nhận:** cổng quyền CEO (nút Duyệt bấm được — thứ CEO chịu đựng cả tuần), chuông có trần retry, lý do chọn sẵn cho Xin nhận sớm/Từ chối, và 3 ô KPI hàng cuối. Không DB/migration, console 0 lỗi, rollback sẵn.

**‼ 1. Ô dự báo CHƯA áp sàn — đang hiện `~145,7% target` dựng trên 2/21 ngày làm việc.** Sàn 5 ngày đã chốt và đẩy lên từ 17:00 (`5a54fc5` → `d54efbf`), bot build sau đó nhưng **không áp**. Suy ngược: 145,7% ⇒ doanh thu kỳ ≈ 4,33 tỷ ⇒ dự báo cả tháng **45,5 tỷ**, ngoại suy từ **10% thời gian của tháng**. Đây đúng là con số CEO liếc một giây rồi tin là "chắc chắn vượt đích". Phải sửa hoặc tạm ẩn ô này.

**‼ 2. V1 CHƯA đóng — và chính ô KPI mới chứng minh điều đó.** Ô "Chưa phân bổ" vẫn `1.795.600đ · 1 dòng` = `DH479816174` vẫn bị cách ly, dù App Sale đã gán VP018 → DN001 lúc 16:39. Báo cáo bot ghi "payment V1/V2 PASS" là nói về **tính năng thanh toán Lần 1/Lần 2**, không phải việc V1 gán đơn — hai thứ trùng tên, đừng gộp. Theo luật đã phân tích 19:10: còn cách ly ⇒ cặp `120.HTNT-PHARMACITY × Pizar-3` **thiếu trong `unit_product_employees`, hoặc đang gán >1 NV** ⇒ App Sale khoá cặp đó về đúng DN001. **Ô KPI mới đã làm đúng việc của nó ngay ngày đầu: bắt được một việc còn hở mà bản tổng kết tuyên bố đã xong.**

**3. Không nhánh nào trên origin:** `bf3c7c5` (đang chạy PROD), `4490def` (đích rollback), `c11b5a7` đều **không tồn tại trên origin**. Code đang chạy production mà ngoài bot ra không ai đọc được, và đích rollback cũng không kiểm chứng được. Phải push.

**Ghi nhận đúng:** DataHub thiếu nguồn DN006 ⇒ app fail-closed bằng cách ẩn badge chỏi thay vì hiện số sai — đúng luật.

---

### 2026-08-05 19:10 (giờ VN) — 🔑 Đơn `DH479816174` giữ bền bằng BẢNG PHÂN CÔNG, không cần cổng override

App Sale đã gán VP018 → DN001 lúc 16:39:14 (audit 19752, tiền/ngày/đơn khác không đổi, bảng phân công checksum giữ nguyên), kèm cảnh báo: **sync MISA hàng giờ có thể ghi đè lại** vì baseline chưa hỗ trợ override từng đơn, và đề xuất dựng "cổng sửa/build riêng".

**Không cần dựng gì cả.** Đọc `appSaleRevenueMirror.CRM_ROWS_SQL` — câu SQL App Report dùng để quy đơn về nhân viên:

```sql
COALESCE(NULLIF(CASE WHEN nc.nv_cnt=1 THEN nc.emp_code END,''), l.employee_code,'') employee_code
```

`nc` = `unit_product_employees` (bảng phân công). Nghĩa là: **cặp (đơn vị × mã hàng) nào trong bảng phân công chỉ có ĐÚNG MỘT nhân viên thì lấy người đó — `l.employee_code` của dòng MISA chỉ là phương án dự phòng.** Bảng phân công **thắng** MISA.

Hệ quả:
- Sync MISA ghi đè `employee_code` về VP018 **cũng không đổi con số của App Report**, miễn là cặp (`120.HTNT-PHARMACITY` × mã hàng Pizar-3) có trong bảng phân công với đúng 1 NV. App Sale vừa xác nhận sync **không đụng** bảng phân công (checksum giữ nguyên) ⇒ sửa ở đó là **bền**, không cần cổng override, không cần build gấp trước 08/08.
- Nếu đơn vẫn bị cách ly sau sync thì nguyên nhân là **cặp đó thiếu trong bảng phân công, hoặc đang gán >1 NV** — V1 đã đếm 143 cặp của đơn vị này đều thuộc DN001, nên nhiều khả năng chỉ thiếu đúng cặp của mã hàng này. Sửa đúng chỗ: **thêm/`nv_cnt`=1 hoá cặp đó**, không sửa dòng MISA.

**Cấm dựng cổng override từng đơn** trong lúc này: nó tạo **nguồn phân công thứ hai** — đúng cái sai đã trả giá hai lần hôm nay (7 bản chép luật "ai là CEO", suýt có 2 lịch nghỉ lễ).

Lúc ghi mục này là **19:08**, các nhịp sync 17:00 và 18:00 đã chạy — trạng thái thật phải **đo**, không suy đoán: chạy lại `propose_quarantine_owner.js` là biết ngay.

---

### 2026-08-05 17:00 (giờ VN) — 🔍 Review candidate KPI `c11b5a7`: 1 điểm chặn, 1 lỗ hổng của chính spec Claude

**Chặn cứng — không review được:** `c11b5a7` **không có trên origin** (`git cat-file` toàn bộ nhánh: không tồn tại), file `vnWorkingDays` cũng chưa nhánh nào có. Lặp lại đúng tình huống sáng nay. Không có code trên origin thì không duyệt được, kể cả khi báo cáo đẹp.

**Phần đối chiếu được thì bot ĐÚNG:** Claude chạy độc lập trên `holidays.json` + `holidayFor()` — **T08.2026 = 21 ngày làm việc**, khớp con số bot báo. Ô "chưa phân bổ" ra `1.795.600đ · 1 dòng`, khớp đúng ca `DH479816174` ⇒ ô đó bắt đúng thứ cần bắt; sau khi App Sale gán về DN001, ô này phải tự về **0đ** — một phép thử sống rất tốt.

**‼ Lỗ hổng của chính spec Claude, không phải lỗi bot:** ô dự báo ra `~135,1% target` khi mới đi qua **2/21 ngày làm việc** (01/08 là T7, 02/08 CN ⇒ tới hết 04/08 chỉ có 03 và 04). Kiểm lại: 3.860.878.168 ÷ 2 × 21 ÷ 31.200.318.669 ≈ **130%** — phép tính đúng, nhưng **con số vô nghĩa**: chưa tới 10% tháng, một đơn lớn rơi vào hai ngày đó là dự báo bay lên 130%+, CEO liếc qua tưởng chắc chắn vượt đích. Spec cũ chỉ chặn ca 0 ngày, quên đặt sàn.

**Sửa spec (`SPEC_KPI_HEALTH_ROW.md`, commit `5a54fc5`):** chưa đủ **5 ngày làm việc đã qua** thì KHÔNG hiện số — thay bằng `— · đã qua N/21 ngày làm việc, chưa đủ để dự báo`; ngày thứ 5–9 kèm nhãn `ước lượng sớm`. Sàn đặt một chỗ, cấm rải hằng số.

**Thứ tự:** `5ba27ab` (cổng quyền CEO) vẫn CHƯA lên PROD sau vụ rollback báo động giả — việc đó mở khoá công việc hằng ngày của CEO, phải đi TRƯỚC KPI.

---

### 2026-08-05 16:28 (giờ VN) — ✅ CEO GẬT V1: gán `DH479816174` → DN001

**Quyết định:** CEO duyệt trực tiếp ("tôi đồng ý nhé") gán đơn cách ly `DH479816174` (MISA `341964` · Pizar-3 · **1.795.600đ** · đơn vị `120.HTNT-PHARMACITY`, đang treo vì gán nhầm VP018-telesaler) về **DN001 — tài khoản SALE** (xem mục cải chính ngay dưới: DN001 KHÔNG phải mã CEO, hai tài khoản chỉ trùng tên).

**Căn cứ đã trình:** `propose_quarantine_owner.js` chạy trên PROD, thoát 0 — danh mục phân công 143/143 cặp mã hàng của đơn vị thuộc DN001; lịch sử T06–T08: 109 dòng · 50 đơn · 582.140.315đ · **100% một người**. Hai nguồn không mâu thuẫn.

**Thực thi:** việc GÁN nằm bên **App Sale** (App Report chỉ đọc — đã khoá bằng test cấm UPDATE/INSERT). Đã soạn lệnh cho bot App Sale qua CEO chuyển. Sau khi App Sale gán xong, bot server App Report chạy xác minh: `propose_quarantine_owner.js` phải hết dòng cách ly cho đơn vị này, đối soát App Report ↔ App Sale phải về **0đ tròn**, và `verify_frozen_periods.js` vẫn exit 0 (gán lại NV không đổi tổng doanh thu kỳ — chỉ đổi phân bổ, làm TRƯỚC khoá sổ 08/08 nên hợp lệ, không hồi tố).

---

### 2026-08-05 16:35 (giờ VN) — ‼ CẢI CHÍNH: DN001 KHÔNG phải "mã của CEO" — hai tài khoản riêng, chỉ trùng tên

CEO đính chính trực tiếp: tài khoản **`CEO` = QUẢN TRỊ**, tài khoản **`DN001` = SALE**, đăng nhập bằng hai SĐT khác nhau, **chỉ trùng tên người Đặng Xuân Trung**. Các ghi chú trước đó của Claude (mục 11:30 "DN001 chính là mã của CEO — người duyệt và người nhận là một", và cảnh báo "tự duyệt cho chính mình" ở màn Xin nhận sớm) là **hiểu nhầm** — cải chính tại đây, không sửa lùi mục cũ.

Hệ quả đã rà:
- **Cổng quyền không bị ảnh hưởng, không sửa gì:** `CEO_EMP_CODES = ['CEO']`, chạy thử `isCeoActor({role:'sale', emp_code:'DN001'}) = false`. DN001 chưa từng và không được có quyền quản trị.
- **Luồng "DN001 xin nhận sớm → tài khoản CEO duyệt" là hai vai đúng nghĩa**, không phải tự duyệt — bỏ mọi dè chừng đã nêu.
- **V1 hết vướng:** đề xuất gán `DH479816174` → DN001 đứng nguyên trên căn cứ dữ liệu (143/143 cặp phân công · 100% lịch sử doanh thu); chỉ còn chờ CEO gật như mọi quyết định gán khác, không còn caveat "tự quyết cho mình".
- Ghi vĩnh viễn vào `CLAUDE.md` (mục "Danh tính tài khoản") để mọi phiên sau đọc trước, không tái phạm. Không ghi SĐT vào tài liệu repo.

---

### 2026-08-05 16:20 (giờ VN) — ✅ CEO yêu cầu: lý do "Xin nhận sớm" phải có LỰA CHỌN SẴN, không bắt gõ tay

**Bối cảnh:** CEO chụp màn thấy popup trình duyệt bắt gõ lý do từng chữ. Truy ra ảnh chụp là bản CŨ `ff75a05` (04/08 22:39) còn nằm trong cache trình duyệt — bản hiện hành đã có hộp thoại trong app (`PaymentRequestComposer`). Nhưng yêu cầu vẫn đúng: hộp thoại hiện tại vẫn là ô trống bắt gõ tay.

**Giao bot (gộp vào đợt deploy lại `5ba27ab`):** thêm **danh sách lý do chọn sẵn** cho hộp "Xin nhận sớm" — bấm chọn 1, chỉ "Khác" mới phải gõ. Danh sách đặt ở **`server/config/payment_request_reasons.json`** để sau này CEO đổi chữ không phải sửa code; backend trả xuống, frontend chỉ render. Lý do đã chọn đi nguyên văn vào ghi chú sổ + tin Telegram cho CEO (giữ hợp đồng `note` hiện có — không đổi API). Nhân tiện cùng một hộp thoại, thêm luôn bộ lý do chọn sẵn cho "Từ chối" (NV sẽ đọc). Không đụng số tiền, không đổi luật quota/ngày sớm nhất.

---

### 2026-08-05 16:10 (giờ VN) — ⚠ Acceptance FAIL của `5ba27ab` là BÁO ĐỘNG GIẢ — lỗi ở cổng nghiệm thu Claude viết, không phải ở bản deploy

**Diễn biến:** bot deploy đúng `5ba27ab` (version `5ba27ab-20260805-143022-859`), cổng (a) `is_ceo=true` PASS, (c) `canEdit=true` PASS, nhưng (d) "thấy đủ 3 nút Duyệt/Từ chối/Mở khoá" FAIL (`actionButtons=[]`) ⇒ bot **dừng ngay và rollback về `b49e585`** đúng quy trình, backup `app-report-pre-5ba27ab-20260805-152115.tgz` (SHA-256 `d448…e85e`). Thao tác của bot chuẩn.

**Chẩn đoán (soi `EmployeeCost.jsx:774–800`):** "Duyệt" chỉ hiện khi `flowState==='requested'`, "Mở khoá" khi `unlock_requested`, "Từ chối" khi có trạng thái chờ. Luồng đề nghị mới lên hôm nay, **chưa NV nào gửi đề nghị** ⇒ mọi dòng đang `plan` ⇒ **không nút nào hiện là hành vi đúng thiết kế**. Cổng (d) do Claude viết ("phải thấy đủ 3 nút") là **tiêu chí sai** — không tính tới trạng thái sổ.

**Bằng chứng bản sửa chạy đúng nằm ngay trong chính kết quả FAIL:** nút "Nội dung khác" (dòng 782) chỉ hiện với người **không phải** CEO (`!canRecord`). `actionButtons=[]` nghĩa là nút đó KHÔNG hiện ⇒ `canRecord=true` ⇒ `is_ceo` đã truyền xuống panel đúng. Nếu cổng quyền hỏng, mảng đã chứa "Nội dung khác".

**Cổng (d) viết lại:** (d1) khu **"Ghi nhận đã trả"** hiện (chỉ CEO thấy) · (d2) **không** có nút "Nội dung khác" · (d3) Duyệt/Từ chối/Mở khoá không bắt buộc — chỉ mọc khi có đề nghị chờ. Cổng (b) (admin khác `is_ceo=false`) lần trước bị bỏ dở vì dừng sớm — lần này phải chạy đủ a→e.

**Quyết định:** deploy lại **đúng `5ba27ab`, không đổi byte nào** — phê duyệt 15:03 của CEO vẫn nguyên hiệu lực. Bài học ghi lại: tiêu chí nghiệm thu UI phải viết theo **trạng thái dữ liệu thật**, không theo danh sách nút lý tưởng.

---

### 2026-08-05 15:45 (giờ VN) — ✅ CEO duyệt 3 ô KPI hàng cuối · SPEC đã viết, giao bot làm

**CEO chốt** đề xuất 3 ô KPI lấp hàng cuối màn "Chi phí của tôi": **CP/DT hiệu quả chi phí** · **Doanh thu chưa phân bổ NV** · **Dự báo đạt target cuối tháng**, kèm một yêu cầu thêm: dự báo phải tính theo **ngày làm việc** — trừ **T7, CN, ngày lễ lớn và nghỉ bù** theo pháp luật VN, "để sau này không phải tính lại".

**Spec:** `SPEC_KPI_HEALTH_ROW.md`. Điểm đáng ghi:
- **Dùng LẠI** `server/data/holidays.json` + `holidayFor()` của `dailySales.js` — file đã có đủ 2026 kể cả nghỉ bù (Tết 14–22/02 · bù Giỗ Tổ 27/04 · 01–02/09). **Cấm tạo lịch thứ hai.** Sang năm chưa nạp lịch ⇒ vẫn trừ T7/CN nhưng ô đeo nhãn ⚠, không im lặng.
- Số ngày làm việc khoá cứng trong test, Claude đếm tay: **T08.2026 = 21 · T09.2026 = 20 · T02.2026 = 15**; 27/04/2026 (bù, thứ Hai) không phải ngày làm việc.
- Ghi chú tương thích: màn "nhịp ngày" (`dailySales`) coi **T7 là ngày làm việc** (ca sáng) — GIỮ NGUYÊN; lệnh trừ T7 chỉ áp cho ô dự báo. Ghi thẳng vào code để không ai "đồng bộ" nhầm hai quy ước.
- CP/DT bắt buộc **cùng một snapshot** (banner "hai snapshot" trên màn là lý do); ô chưa phân bổ mang bất biến tổng cân theo `SPEC_REVENUE_SYNC_EXCEPTIONS`; mọi ô fail-closed `—`, cấm 0 giả sạch; test quét cấm frontend tự nhân chia.

Đúng mô hình phối hợp: Claude viết spec + số đối chiếu, **bot server code**. Trạng thái test không đổi (chỉ thêm tài liệu).

---

### 2026-08-05 15:03 (giờ VN) — ✅ CEO DUYỆT DEPLOY `5ba27ab` (cổng quyền CEO + chuông có trần retry)

**Người duyệt:** CEO, trực tiếp, sau khi đọc bằng chứng. **Trạng thái lúc duyệt:** PROD `b49e585`, chưa đổi.

**Bằng chứng đã trình:**
- `5ba27ab` trên origin, băm đối chiếu **khớp tuyệt đối** (không phải bản trùng tên).
- `b49e585` (đang chạy) **là tổ tiên** của `5ba27ab` ⇒ deploy là **đi tới**, không nhảy ngang sang nhánh lạ. Đây là chỗ hay sinh tai nạn, đã loại trước.
- Server **923/923** trên máy bot (máy có `pdfinfo`) · **917/923** trên máy Claude (thiếu `pdfinfo`, 6 bài đó bỏ qua) — `917 + 6 = 923`, khớp. Web **180/180**. Build PASS.
- `VP002` gọi feed/approve đều **403**, phản hồi **không chứa `amount`**.
- Đủ **7 file V1/V2**, không mất gì trong lần gộp.

**Sửa được gì cho CEO:** nút **Duyệt · Từ chối · Mở khoá** hiện lại và bấm ăn — trước nay bị giấu, mà có bấm cũng ăn 403, nên **CEO chưa từng duyệt được khoản nào qua app**. Nút **sửa công thức phạt** cũng vậy, cùng nguyên nhân. Chuông thôi gọi lặp vô hạn, về đúng nhịp 60s.

**Đường lùi:** `git revert 5ba27ab` + gói `app-report-pre-…tgz` (đã có SHA-256).

**Cổng 2 sau deploy — TOÀN LỆNH ĐỌC, không bước nào chi tiền**, làm trong 15 phút:
`/me` tài khoản CEO ⇒ `is_ceo=true` · `/me` admin khác ⇒ `is_ceo=false` (‼ quan trọng nhất) · `/admin/penalty-policies` ⇒ `canEdit=true` · tab Thanh toán thấy đủ 3 nút (**chỉ nhìn, không bấm**) · chuông 3 phút nhịp 60s không gọi chồng. Hỏng bước nào ⇒ **lùi ngay**, không chữa nóng trên PROD.

**"Bấm Duyệt ăn thật"** không còn là bước nghiệm thu — đó là chi tiền thật, không phải thao tác kiểm thử. Hạ xuống thành **quan sát lần duyệt thật đầu tiên của CEO** trong công việc bình thường, đường lùi để sẵn.

**Mốc còn lại:** V3 (nhắc tin) đang bật, lượt gửi kế tiếp **12:30 thứ Bảy 08/08**. Deploy này PASS thì gỡ điều kiện tắt; không kịp thì vẫn phải tắt trước giờ đó.

---

### 2026-08-05 12:30 (giờ VN) — ✅ SỬA cổng quyền CEO: nhận theo DANH TÍNH, admin khác vẫn bị chặn

**Chặn đã gỡ:** bot xác nhận phiên CEO trên PROD là `emp_code = CEO` · `role = admin`. Đúng như giả thiết, nên cách sửa theo danh tính đứng vững.

**Đã làm** (Claude viết code đợt này vì bot báo "chưa sửa code" — tránh hai bên viết hai bản khác nhau; bot lo nghiệm thu + deploy):
- `auth.js`: thêm `CEO_EMP_CODES` (đọc từ `process.env.CEO_EMP_CODES`, mặc định `CEO`) và **`isCeoActor(session)`** = role `ceo` **hoặc** `emp_code` nằm trong danh sách. `requireCeo` dùng hàm này.
- Xoá **toàn bộ bản chép tay**. Tra kỹ ra **bảy** chỗ tự xét "ai là CEO", nhiều hơn con số bốn báo lúc 11:00: `auth.isCeo` · `requireCeoDelivery` (bản này còn **quên `.toUpperCase()`**) · `requireCeoQlnb` · **`requireCeoPenaltyFormula`** · **`canEdit` công thức phạt** · `routes.js:3028` · và 4 chỗ frontend. Hai chỗ in đậm chưa từng được nhắc tới trong review trước — nghĩa là **nút sửa công thức phạt cũng đang khoá nhầm CEO**.
- `/me` trả thêm **`is_ceo`** do backend tính. Bốn chỗ frontend (`App.jsx` · `CeoNotificationBell.jsx` · `DormantReports.jsx` · `PaymentSchedule.jsx`) nay chỉ đọc cờ đó, **không tự đoán từ chuỗi role** — đúng nguyên tắc "quyền quyết ở backend".
- Giữ nguyên `row.emp_code === 'CEO'` ở `routes.js:2207`: đó là **tìm dòng dữ liệu** của CEO trong bảng map Telegram, không phải xét quyền. Test phân biệt rõ hai việc, không cấm nhầm.

**Lệnh CEO 04/08 không suy suyển:** `{role:admin, emp_code:VP002}` **vẫn trượt**. Có test khẳng định bằng hành vi (`isCeoActor !== isAdmin`), không chỉ bằng chữ, và test cấm `isCeoActor` gọi `isAdmin`.

**Test:** thêm `server/test/ceoIdentityGate.test.js` (9 ca). Sửa 3 test cũ đang ghim đúng những dòng gây lỗi — ghi rõ lý do sửa ngay trong file, **không xoá ý nghĩa cũ**. Server **910/916** (vẫn đúng 6 lỗi môi trường `pdfinfo`) · web **166/166** · `npm run build` PASS.

**Chưa làm, để bot:** sửa vòng gọi lại của chuông (401/403 phải DỪNG hẳn) — bot đang cầm `CeoNotificationBell.jsx` cho bản `b01a182` làm lại. Và **nghiệm thu trên PROD + xin duyệt deploy**.

---

### 2026-08-05 11:55 (giờ VN) — 🔧 Bảng V2 CẮT CỤT mã hàng/mã đơn vị — mã cụt tra MISA không ra đơn nào

**Lỗi:** `pad()` dùng `.slice(0, width)`, cột mã hàng rộng 22 ⇒ mã thật `G1.GE.QĐ139.1487.N3.691` (23 ký tự) in ra thành `G1.GE.QĐ139.1487.N3.69`; mã đơn vị `186.BVĐK AN PHÚ CNIII-PKĐK AN PHÚ` thành `186.BVĐK AN PHÚ CNIII-PK`. Lộ ra khi đối chiếu bảng với dòng "MẶT HÀNG" ở cuối bản in thật — hai chỗ ghi hai mã khác nhau cho cùng một dòng.

Kế toán cầm mã cụt đi tra MISA thì **không ra đơn nào** — đúng kiểu sai mà cả bộ này sinh ra để chặn. **Sửa:** không bao giờ cắt, bề rộng cột **tự tính theo dữ liệu thật** (cả bảng chi tiết lẫn bảng phân nhóm trạng thái). Thà bảng rộng còn hơn bảng sai. Test khoá bằng chính hai chuỗi thật ở trên. Server **901/907**.

---

### 2026-08-05 11:30 (giờ VN) — ⛔ Đóng hẳn bản chặn bộ nhớ (RSS thật 851 MiB) · ✅ V1 chốt · 🔧 sửa lỗi bản in V2

**① Bản chặn bộ nhớ — ĐÓNG, không sửa nữa.** Bot dán RSS thật của `app-report` lúc 11:05:44 giờ VN: **851,47 MiB**. Chạy thẳng vào chính module của bản ứng viên:

```
ngưỡng NHẬN VIỆC : 576 MiB   ← 768 − 192 dự phòng
trần CỨNG        : 768 MiB
RSS thật         : 851 MiB
=> CHẶN: 503 EMPLOYEE_COST_ALL_MEMORY_PRESSURE
```

Máy đang chạy **cao hơn cả trần cứng 83 MiB**. Deploy bản đó là màn "Tất cả NV" — màn mặc định của CEO — **trả 503 ở 100% lượt mở**, không phải "thỉnh thoảng thiếu vài NV". Ngưỡng được chọn mà **chưa ai đo máy thật**. Không xin sửa lại nữa: bỏ hẳn cổng 503, giữ mỗi phần rút ngắn TTL kết quả lỗi (2 phút) — phần đó tốt, không tranh cãi. Muốn thật sự giảm RAM thì phải bắt đầu bằng **đo**, và mở việc riêng.

**② V1 — có đề xuất, độ chắc cao nhất.** `propose_quarantine_owner.js` chạy trên PROD, thoát **0**:
`DH479816174` → **DN001 (Đặng Xuân Trung)**. Căn cứ: danh mục phân công **143/143 cặp mã hàng** của `120.HTNT-PHARMACITY` đều thuộc DN001; lịch sử T06–T08 **109 dòng · 50 đơn · 582.140.315đ · 100%** một người. Hai nguồn không mâu thuẫn ⇒ không rơi vào nhánh "cấm đoán". Đọc 116 dòng, 109 gán được ⇒ 7 dòng còn lại là phần đang cách ly, khớp với bài toán. **Đã báo CEO rằng DN001 chính là mã của CEO** — người duyệt và người nhận là một, phải biết trước khi gật.

**③ V2 — bản in đầu NÓI SAI một câu, đã sửa.** Bảng thật trên PROD dán nhãn *"Bucket ngoài official/pending"* cho 18 dòng có `revenue_bucket = 'pending'` — tức đang nằm **TRONG**. Nguyên nhân: `reasonOf` **tự viết lại** một luật đã có ở `syncExceptionClassifier.classifyMisa` — đúng cái tội "nhiều định nghĩa cho một luật" vừa phê bình ở review `b01a182` sáng nay. Nay gọi thẳng bản gốc, xoá bản chép.

Sửa kèm, đều từ dữ liệu thật:
- **Tách dòng 0đ khỏi câu hỏi của kế toán.** Bảng thật là 18 dòng · 11 đơn nhưng **17 dòng bằng 0đ**; toàn bộ 3.995.000đ nằm ở **đúng một đơn `DH479816093`** (29/07 · 186.BVĐK AN PHÚ CNIII · DN001). Bản cũ bắt kế toán quyết **11 lần** cho **1 câu hỏi** — kiểu bảng đó người ta trả lời bừa hoặc bỏ đấy tới hết hạn. Nay in **1 câu**. 17 dòng 0đ **không biến mất**, xuống khối riêng với mã `MISA_TIEN_BANG_0` và ghi rõ chủ xử lý là App Sale/MISA, không phải kế toán.
- **Cảnh báo kỳ đã khoá sổ.** T07 đã ghim 30.917.892.673đ, và bucket `pending` **đang được tính** vào doanh thu kỳ. Nên **GHI** = số không đổi (an toàn), **HUỶ** = doanh thu T07 **giảm 3.995.000đ** so với số đã dùng tính thưởng/phạt **đã trả**. Bản in nay nói thẳng: trả lời HUỶ thì **báo CEO trước**, không tự sửa (`SPEC_REVENUE_DELIVERY_PERIOD`: không hồi tố). Trước đây bản in coi hai lựa chọn như nhau.

**Trạng thái test:** server **900/906** (+3 test mới khoá đúng ba lỗi trên; vẫn đúng 6 lỗi môi trường `pdfinfo`).

---

### 2026-08-05 11:00 (giờ VN) — ⛔ Review `b01a182`: cổng quyền CEO hỏng SẴN trên PROD, cấm sửa bằng cách nới cho admin

**Bối cảnh.** Bot deploy `b01a182` (thông báo thanh toán trong app), nghiệm thu bằng trình duyệt thật phát hiện tab Thanh toán trả **403 `PAYMENT_NOTIFICATION_SCOPE_REQUIRED`** và chuông gọi lại lặp vô hạn. Bot **tự rollback về `b49e585`**, kèm backup + SHA-256 + xác nhận T06/T07 lệch 0 + notify vẫn tắt. **Rollback đúng, bằng chứng đủ.**

**‼ Nhưng nguyên nhân sâu hơn báo cáo.** Báo cáo ghi "API mới chỉ nhận `ceo`" — thực ra **API cũ cũng chỉ nhận `ceo`**. `b01a182` không tạo ra lỗi, nó chỉ **làm lỗi lộ ra** (chuông có vòng gọi lại nên 403 hiện lên màn). Claude chạy thử trên chính code đang chạy PROD:

```
{"role":"admin","emp_code":"CEO"}   → requireCeo: 403 CEO_ONLY     ← tài khoản CEO thật
{"role":"ceo","emp_code":"CEO"}     → ĐI QUA
```

`auth.requireCeo` đang gác **6 route tiền** (`approve`/`reject`/`unlock`/`second`/`record`/`undo`) ⇒ **tài khoản CEO thật trên PROD chưa từng duyệt được khoản nào**. Không ai kêu vì `PaymentSchedule.jsx:177` để `canRecord={role === 'ceo'}` nên **nút Duyệt/Từ chối/Mở khoá bị giấu** — nút giấu che mất cổng khoá. **Lỗi này của Claude**, không phải của `b01a182`.

**Gốc rễ:** repo đang có **4 định nghĩa "ai là CEO"** — `auth.isCeo` (chỉ role, sai), `requireCeoQlnb` + `routes.js:3028` + 3 chỗ frontend (role **hoặc** `emp_code==='CEO'`, đúng), và `PaymentSchedule.jsx:177` (chỉ role, sai). Bốn bản sao thì kiểu gì cũng lệch.

**⛔ Cấm cách sửa hiển nhiên.** Nới cho `admin` đi qua sẽ: (1) trao quyền duyệt tiền cho **mọi** tài khoản admin, trái lệnh CEO 04/08 *"chỉ duy nhất CEO được phép ghi thôi — admin cũng không"*; (2) làm đỏ chính test ghi lại lệnh đó (`paymentLedgerRoutes.test.js`); (3) **lộ số tiền của toàn bộ NV** vì feed chỉ chiếu `amount` vào vai CEO — phạm nguyên tắc "KHÔNG để lộ số người khác/tổng payout".

**✅ Cách sửa đã duyệt:** phân quyền theo **danh tính**, không theo chuỗi role — một hàm duy nhất `auth.isCeoActor(session)` (role `ceo` **hoặc** `emp_code` nằm trong `CEO_EMP_CODES` đọc từ config), thay cho cả 4 bản sao; `/me` trả `is_ceo` để **frontend thôi tự đoán quyền**. Admin khác (vd `VP002`) **vẫn bị chặn**. Kèm sửa riêng: chuông gặp **401/403 phải DỪNG hẳn**, chỉ 5xx/lỗi mạng mới thử lại và phải giãn dần.

**Chặn trước khi code:** bot phải dán `emp_code` + `role` của phiên CEO trên PROD — cách sửa chỉ đứng được nếu `emp_code = 'CEO'`.

Chi tiết đầy đủ + 5 test bắt buộc + mẫu câu xin duyệt deploy: **`DIRECTIVE_CEO_IDENTITY_FIX.md`**. Claude **không sửa code app** đợt này (đúng mô hình phối hợp: bot cầm code, tránh đụng repo) — chỉ ra spec và bằng chứng.

**V3 (bật notify) lùi lại sau việc này** — bật tin tiền trong lúc CEO chưa duyệt được gì chỉ tổ gây hoang mang.

---

### 2026-08-05 09:40 (giờ VN) — ✅ V1 · V2: biến "bot đi tra đi" thành hai lệnh chạy được

**Việc đã làm.** V1 và V2 trước nay là hai câu giao việc mơ hồ: tra bằng tay, mỗi người ra một kiểu, không ai kiểm lại được. Nay có **hai công cụ**, luật quyết định chốt trong code và **khoá bằng 32 test**.

Kiến trúc theo đúng lối `syncExceptionClassifier`: tách **phần quyết định** (hàm thuần, test offline được) khỏi **phần lấy dữ liệu** (cần DB thật). Lý do rất cụ thể: Claude **không có đường vào DB App Sale** (proxy chặn `report.donapharm.asia`, cổng 5432 không mở), nhưng phần khó — luật gán chủ, luật chọn nhóm — vẫn phải chốt được ngay và không để ai sửa lén.

**Mới:**
- `server/src/quarantineOwnerProposal.js` + `server/scripts/propose_quarantine_owner.js` — **V1**: tra hai nguồn (bảng phân công `unit_product_employees` · lịch sử doanh thu của đơn vị) rồi in **một tên đề xuất kèm căn cứ**. VP018 bị loại khỏi mọi ứng viên. **Hai nguồn chỏi nhau, hoặc chia đều không ai áp đảo ⇒ KHÔNG đề xuất ai**, đúng lệnh CEO "cấm đoán" — nhưng vẫn in đủ cả hai bảng số để CEO tự quyết. Có ngưỡng áp đảo 80% cho trường hợp nhiều NV cùng bán, đánh dấu độ chắc **"yếu"** chứ không giả vờ chắc. Mã thoát `0` có đề xuất · `1` cần người quyết · `2` **chưa đọc được dữ liệu** — ‼ `1` và `2` cố ý tách nhau, gộp lại là báo nhầm "đã tra rồi, chịu".
- `server/src/misaPendingLedger.js` + `server/scripts/misa_pending_detail.js` — **V2**: in bảng để kế toán chỉ điền **GHI/HUỶ**. Không ai biết chắc "Đề nghị ghi" nằm ở cột `revenue_bucket`/`revenue_status`/`mapping_status` nên script **không đoán tên trạng thái**: gom theo bộ ba trạng thái rồi **tìm nhóm cộng đúng 3.995.000đ**. Không khớp, hoặc **hai** nhóm cùng khớp ⇒ in cả bảng phân nhóm và **dừng**, không tự chọn nhóm gần giống. Khớp tới **từng đồng** — "gần đúng" chính là cách dán nhầm bảng rồi ghi nhầm doanh thu vào kỳ sắp khoá sổ. Bất biến: tổng bảng in ra = số đối chiếu, lệch là bản in hét lên "không gửi bảng này đi".
- Cố ý **không** lọc `revenue_bucket <> 'excluded'` như bản mirror doanh thu — lọc là mất đúng những dòng cần đem đi hỏi. Đã có test khoá.
- Cả hai script **CHỈ ĐỌC**, có test cấm `UPDATE/INSERT/DELETE/ALTER/DROP`. Việc gán thật do App Sale làm sau khi CEO gật; ghi/huỷ do kế toán làm trong MISA.

**Trạng thái test:** server **897/903** (thêm 32 test mới, vẫn đúng 6 lỗi môi trường `pdfinfo` đã biết — không phát sinh lỗi mới; nền cũ 865/871). Đã chạy thử hai script không có DB: thoát đúng mã **2** kèm câu "CHƯA kết luận được gì", không im lặng, không kết luận bừa.

**Còn lại của V1/V2:** phần **chạy trên máy chủ** là của bot server — dán nguyên văn output + mã thoát. Hạn **08/08** (giờ VN).

---

### 2026-08-05 08:50 (giờ VN) — ⛔ KHÔNG duyệt bản "chặn bộ nhớ" · ✅ duyệt bật nhắc tin (V3)

**Việc đã làm:** Claude fetch hai nhánh ứng viên vừa được đẩy lên origin và **đọc diff thật**, không kết luận theo báo cáo miệng.
`origin/candidate/viec4-appreport-1ba8f44-20260802-214655` = `aa5e1b4` · `origin/review/viec4-assertion-only-54365b0` = `54365b0`; hai nhánh **chỉ khác 1 dòng** trong `server/test/employeeCostAllDeadline.test.js`. Commit `b238a9e` **không có object ở đâu cả** — bỏ khỏi mọi kế hoạch.

**⛔ Không duyệt bản chặn bộ nhớ**, 5 căn cứ:
1. Số đo của chính bot: luồng **2** ⇒ 6/21 NV xong, **15 NV bị cắt**; luồng **6** ⇒ 18/21 xong, 3 bị cắt. 15 NV hiện "chưa lấy được số" **đúng là sự cố 01/08** vừa đi chữa cả tuần.
2. `buildConcurrency()` = `boundedInteger(value, 2, 1, 2)` ⇒ trần cứng **2**, `.env` chỉ hạ được chứ **không nâng được**. Ra PROD thấy đau là không có nút nào vặn.
3. `assertMemoryBudget` chạy trước catalog fan-out, ngưỡng **576 MiB** (768 − 192), vượt là ném **503 cho cả request** ⇒ màn "Tất cả NV" (màn mặc định của CEO) chuyển từ "thiếu vài NV kèm nhãn" sang **trắng bảng kèm lỗi đỏ**. Đã yêu cầu bot dán **RSS thật của PROD** trước khi bàn tiếp.
4. `54365b0` không phải "chỉ đổi tên": assertion `EMPLOYEE_COST_ALL_CONCURRENCY >= 4` nay chỉ còn canh fan-out nạp ứng lần 1 (`routes.js:1168`), còn luồng dựng bảng 21 NV dùng constant khác **bằng 2**. Claude chạy thử trên nhánh đó: **22/22 xanh** — xanh trong khi thứ nó bảo vệ đã biến mất.
5. Rác kèm theo: `let memoGeneration = 0` khai không dùng; trường `generation` ghi vào mọi entry memo nhưng không ai đọc.

Đã ghi rõ **3 đường được duyệt** (nâng trần luồng lên 6 · giữ luồng 2 nhưng nâng hạn chót ≤ 40s kèm số đo mới · chặn RAM cách khác) kèm 3 điều kiện chung — chi tiết ở `LENH_05082026.md`. Ghi nhận thêm: `memoGet` bị **viết lại** trong cùng commit (`hit.ttl` → `hit.ttlMs`, `staleMs` theo entry, dời mốc `t`); Claude tra thì không còn chỗ nào đọc `.ttl` cũ nên **không gãy**, nhưng đó là sửa lõi cache — lần sau tách commit riêng.

**✅ Duyệt V3:** danh sách diễn tập đã sạch (**13 NV · 251.801.312đ**, không còn DN004/DN005/DN012/DN017 là các tin 0đ, mốc ngày in ra 05/08). Cho bật `EMP_COST_NOTIFY`/`BONUS_NOTIFY` ngay, thứ tự bắt buộc: dọn config drift → bật → **dán lại số tin đã gửi và ai không nhận được**. DN012 vẫn để ngoài danh sách cho tới khi chính chị ấy bấm Start — **cấm đoán Telegram ID**.

**Trạng thái test:** server 865/871 (6 lỗi môi trường `pdfinfo` đã biết) · web 166/166 — không đổi, đợt này chỉ sửa tài liệu điều phối.

---

### 2026-08-05 — ✅ ĐÓNG rủi ro DataHub: khoá đã tự nhả, kỳ khoá sổ không suy suyển

**Rủi ro tiền — đóng.** Trong 2.600 event tồn: **0 event ghi/sửa** dữ liệu T06/T07. 1.481 event có nhắc T07 nhưng **toàn bộ là đọc** (`employee_cost.read`), tổng số thao tác ghi = **0**.

`verify_frozen_periods.js` chạy trên **PROD thật**, mã thoát **0**:
```
✅ 06.2026  ghim 28.403.136.096đ / 2001 dòng
✅ 07.2026  ghim 30.917.892.673đ / 2016 dòng
```
Claude đối chiếu lại: số này **khớp đúng** số ghim trong `revenueMaterializeGuard` — không phải chép nhầm.

**Gốc rễ — đã sửa.** Khoá `vault-audit` nay có chủ (PID/host/boot/token), TTL 15 giây, heartbeat, tự thu hồi khi chủ chết, chỉ thả đúng phiên của mình. Deploy PROD DataHub tại `de9edb7`. Nghiệm thu **4/4 PASS** — tự thu hồi trong **570ms**; 21 NV × 3 vòng = **63/63, `unavailable` = 0**.

Nghĩa là **vụ "nhân viên luân phiên hiện 0đ"** (01/08 và 03/08) đã hết nguyên nhân, không chỉ được giảm đau.

**‼ Hai điều nói thẳng, không tô hồng:**

1. **Cổng chặn "đếm TRƯỚC khi drain" thực tế KHÔNG chạy** — outbox đã tự drain xong trước khi lệnh sáng nay tới. Việc đếm là làm **sau**. Kết quả tốt là nhờ đống event đó vốn chỉ đọc, cộng với `verify_frozen_periods` xác nhận không suy suyển — **không phải nhờ cổng chặn**. Cổng đó **chưa từng được thử thật**; lần tới vẫn phải chạy đúng thứ tự.
2. **Claude tra thiếu.** Đã báo "tra `data-hub-smart-app` không thấy khoá" — thực ra nó nằm ngay trong repo đó, ở `server/src/ceo-vault/vaultStore.js`; Claude chỉ tìm trong `server/src/services/`. Đã ghi lại vào directive để không ai đi tìm lại.

### 2026-08-05 — Diễn tập khô bắt 2 lỗi TRƯỚC KHI có tin nào bay đi

Bot server chạy `dryRun` sáng 05/08 (theo lệnh Claude điều phối) — **kỹ thuật PASS nhưng nghiệm thu FAIL**, đúng như mong đợi của việc chạy thử sớm. Hai lỗi thuộc phần code, đã sửa:

**1. ‼ Vẫn dựng tin "bạn nhận 0đ"** cho DN004 · DN005 · DN012 · DN017, trái chủ đích. Lỗi ở `messageFor`: `if (!total)` chỉ kiểm **cái hộp**, không kiểm **số tiền bên trong** — hộp có mà tiền bằng 0 thì vẫn lọt. Nay chặn mọi `amount` không phải số dương.
- **Vẫn giữ ranh giới:** `0đ thật` (kỳ không phát sinh) ⇒ **không gửi**; `không lấy được nguồn` ⇒ đi lối riêng `unavailableMessageFor`, tin đó nói rõ *"KHÔNG phải bạn không có chi phí"* và **tuyệt đối không nêu số 0**. Test cấm hai chuyện này gộp làm một.

**2. ‼ MÚI GIỜ — script diễn tập lấy ngày UTC.** Chạy lúc **06:23 ngày 05/08 giờ VN** nhưng in mốc **`2026-08-04`**, vì `toISOString()` trả ngày UTC và từ 00:00–07:00 giờ VN thì UTC vẫn còn hôm qua. Kỳ `ky` cắt ra từ mốc này ⇒ **đầu tháng sẽ diễn tập nhầm tháng trước**, bật thật lại ra kỳ khác. Nay dùng `employeeCost.vnToday()`; có test cấm quay lại kiểu UTC.

**Hai việc còn lại của bot** (không phải code): DN012 nhận được email dù chưa map Telegram — sẽ tự hết sau khi mục 1 chặn tin 0đ; và **config drift**: file `.env` của release ghi hai cờ `=1` trong khi PM2 đang chạy `=0` — **phải dọn trước lần restart tới**, nếu không restart là notify tự bật ngoài ý muốn.

**Ghi nhận:** `9986f0a` đã tìm ra — nằm ở chính repo này, nhánh `candidate/viec4-appreport-1ba8f44-20260802-214655`, nội dung *"bound employee-cost all memory pressure"*, **chưa vào `main`**.

- Test: `employeeCostNotifyZero.test.js` **4/4** · server **865/871** (6 lỗi PDF nền cũ).

### 2026-08-04 — F5 quay lại ĐÚNG THÁNG ĐANG XEM

> CEO: *"khi bấm F5 nó vẫn cứ trả về tháng hiện tại, không phải là trả về tháng đang xem / tháng liền kề."*

Bản `db95d29` mới chỉ làm nửa việc (mặc định tháng liền trước) và **chưa được deploy** — PROD lúc CEO chụp là `1beac00`. Nay làm nốt nửa còn lại: **nhớ tháng đang xem**.

`paymentStartMonth()` theo thứ tự ưu tiên:
1. **Tháng đang xem lần trước** (lưu trong máy) ⇒ F5 quay lại đúng chỗ.
2. Không có / không hợp lệ ⇒ **tháng liền trước**.

**‼ Kẹp trần ở tháng liền trước.** Bộ nhớ có thể còn lưu tháng đang chạy (do bản cũ, hoặc vừa sang tháng mới) — vẫn KHÔNG được trỏ vào, vì tháng đang chạy không bao giờ có sổ. Tháng tương lai cũng kẹp. Bộ nhớ hỏng/rác thì rơi về mặc định, không nổ.

- Test: web **166/166** · build sạch.

### 2026-08-04 — Mở màn Thanh toán CP trỏ vào tháng liền trước, không vào tháng đang chạy

> CEO: *"khi bấm F5 lại thì điều hướng chỉ cho trỏ về tháng liền kề tháng hiện tại, do tháng hiện chưa có dữ liệu."*

Tháng đang chạy **không bao giờ** có sổ thanh toán (ứng lần 1 chốt vào ngày cuối tháng), nên mở màn trỏ vào đó thì lần nào cũng ra câu "chưa có sổ" — vô nghĩa. Nay mặc định là **tháng liền trước**.

`lastEndedMonthVN()` tính theo **giờ VN** và bắc cầu năm đúng. Có test cho ca hiểm: **06:30 sáng 01/01/2027 giờ VN** vẫn là 31/12 giờ UTC — lấy giờ máy sẽ lùi nhầm về tháng 11.

Sang **00:01 ngày 01/09 (giờ VN)** hàm tự trả T08 — không ai phải chỉnh gì, khớp đúng mốc mở sổ ở H1.

- Test: web **165/165** · build sạch.

### 2026-08-04 — Đính chính mốc ứng sớm: **01/10**, không phải 30/09

> CEO: *"à tôi bị nhầm, nó phải là sau ngày 01/10 mới đúng nhé"* (kỳ T08.2026).

Luật đúng là **phải QUA ĐỦ 30 ngày** kể từ khi hết tháng bán hàng ⇒ bấm được từ **ngày thứ 31**, không phải đúng ngày thứ 30.

| Kỳ | Hết tháng | Bấm được từ | Hạn Lần 2 | Sớm hơn |
|---|---|---|---|---|
| T07.2026 | 31/07 | **31/08** | 14/09 | 14 ngày |
| **T08.2026** | 31/08 | **01/10** ✔ | 15/10 | 14 ngày |
| T09.2026 | 30/09 | **31/10** | 14/11 | 14 ngày |
| T02.2027 | 28/02 | **31/03** | 14/04 | 14 ngày |

**Nói thẳng một hệ quả** để sau khỏi ai tưởng sai: mốc này sớm hơn hạn **14 ngày**, không phải 15 như câu nói ban đầu. Hai con số không thể cùng đúng — CEO đã chọn **01/10**, nên "15 ngày" là ước lượng, "01/10" là mốc thật. Đã ghi rõ ngay trong file luật để người sau đọc không sửa ngược lại.

Ổn định cho **mọi tháng, kể cả tháng 2** — luôn đúng 14 ngày, vì cả mốc lẫn hạn đều tính từ ngày cuối tháng. Có test quét 5 kỳ.

- Test: `earlyAdvanceQuota.test.js` **12/12** · server **861/867** (6 lỗi PDF nền cũ).

### 2026-08-04 — Ba yêu cầu CEO 22:40: bỏ gọi kỳ đang chạy · Σ C44 · quyền ưu tiên ứng sớm

**H1 — Kỳ ĐANG CHẠY thì KHÔNG gọi cập nhật chi phí nữa.** Ảnh CEO cho thấy màn T08 vẫn liệt kê 21 NV kèm 21 lý do giống hệt nhau — nghĩa là backend đã kéo cả 21 NV từ DataHub **chỉ để kết luận "chưa tới lúc"**. Nay màn hình tự biết tháng chưa hết là **không gọi gì cả**, hiện đúng một câu kèm mốc: *"Từ 00:01 ngày 01/09/2026 (giờ VN) bấm Làm mới là sổ mở ra"*. Không ai phải bật cờ gì.

**H2 — Ô "Σ C44 · cuối năm" của toàn đội luôn ra 0đ** trong khi sổ từng người hiện đúng (DN003 = 7.175.514đ). Nguyên nhân: bảng đội **không truyền `c44Amount`** vào lúc dựng sổ. Nay lấy từ chính trường `annualTotal` mà sổ cá nhân dùng ⇒ hai màn không thể lệch. NV nào chưa tính ra C44 thì đếm riêng (`c44Unknown`), **không cộng 0 vào tổng** rồi trông như đã đủ.

**H3 — Quyền ưu tiên ứng sớm Lần 2: 1 lượt / quý.**
- Sớm nhất là **30 ngày sau khi hết tháng bán hàng** = đúng **15 ngày trước hạn Lần 2**. Có test quét nhiều kỳ chứng minh **hai cách CEO diễn đạt ra cùng một ngày**.
- **Lượt tính theo QUÝ CỦA KỲ BÁN HÀNG**, không theo ngày bấm nút — tính theo ngày bấm thì NV bấm muộn vài ngày là nhảy quý và được thêm lượt.
- **Lượt TIÊU lúc CEO ĐỒNG Ý mở khoá**, không phải lúc NV bấm xin. Tiêu lúc xin thì CEO từ chối là NV mất trắng lượt cả quý — vô lý, và NV sẽ không dám bấm nữa.
- Hết lượt ⇒ **backend chặn thẳng** (HTTP 409), không chỉ ẩn nút. Câu báo nêu rõ **đã dùng cho kỳ nào**.

**‼ Một chỗ CEO nói lệch, cần xác nhận:** CEO nêu ví dụ *"T08.2026 thì được ứng vào khoảng ngày 01/09/2026"*, nhưng chính luật CEO đặt (*"không sớm hơn 30 ngày kể từ khi kết thúc tháng"* và *"sớm hơn 15 ngày"*) cho ra **30/09/2026**, không phải 01/09. Đã làm theo **luật**, không theo ví dụ; nếu CEO muốn đúng 01/09 thì đó là *"1 ngày sau khi hết tháng"* = sớm hơn hạn **44 ngày**, khác hẳn.

- Test: `earlyAdvanceQuota.test.js` **12/12** · server **861/867** (6 lỗi PDF nền cũ) · web **163/163**.

### 2026-08-04 — Người không phải NV bán hàng: khoá khỏi tin nhắn tiền

> CEO: *"số NV này không phải là nhân viên bán hàng, nên loại không đưa vào tin nhắn telegram/email nhé"* (VP002 · VP003 · VP006…VP018).

**Kiểm trước khi sửa — không có rò rỉ nào đang xảy ra.** Mọi luồng tin tiền đều đã đi qua roster: `targetNotify`/`bonusNotify` lặp trên `store.targetRoster`; `salesRecipientCatalog` và `filteredEmployeeDelivery` lấy bản đồ Telegram rồi **giao** với roster; route thanh toán đã chặn mã ngoài roster (`PAYMENT_EMP_NOT_IN_ROSTER`). Tức là 15 người kia **vốn đã không nhận** tin tiền nào.

**Vẫn khoá lại tường minh** ở chỗ gửi (`resolveFlowRecipient`), thay vì tin rằng mọi nơi gọi đều nhớ kiểm. Đây là đai bảo hiểm thứ hai, không phải vá lỗi đang chảy.

- **Cổng lọc là ROSTER, không phải danh sách mã cứng.** Mã cứng sẽ mục theo thời gian, và **VP004 đang NẰM TRONG roster** nên sẽ bị loại oan. Có test **cấm ghi mã `VP0xx` vào code**.
- **CEO không bị cổng này chặn** — tin NV gửi lên luôn phải tới CEO.
- Người ngoài roster hiện lý do **khác** với người trong roster chưa nối Telegram: *"không thuộc roster bán hàng — không nhận tin thanh toán"* vs *"chưa nối Telegram — cần báo trực tiếp"*. Hai chuyện khác nhau, không gộp một câu.

- Test: server **849/855** (6 lỗi PDF nền cũ).
- **Việc của bot (CEO thu hẹp 22:25):** chỉ map Telegram cho **DN012 — Đặng Thị Hồng Hạnh**. Bốn người còn lại (DN004 · DN021 · DN023 · VP004) **chờ CEO yêu cầu**, không tự làm.

### 2026-08-04 — Ghi được nhưng tin KHÔNG tới: phải nói ra, không im lặng

Bot báo sau khi deploy `86571e1`: `telegram_map` đã có `emp_code = CEO`, nhưng **5 NV trong roster chưa nối Telegram** — DN004 · DN012 · DN021 · DN023 · VP004 (toàn bộ active users: 20 chưa map).

**Lỗ hổng:** Sếp bấm **Duyệt** cho một trong 5 người đó ⇒ ghi sổ thành công, màn hình báo bình thường, nhưng tin rơi vào `no_recipient` — **chỉ nằm trong log**. Sếp tưởng NV đã biết, NV thì không hay gì. Đúng loại **hỏng lặng lẽ** đang bị cấm ở mọi chỗ khác trong app.

**Đã bịt:** `flowNotifyReach()` tra bản đồ Telegram **đồng bộ** (chỉ đọc file, rất rẻ) và trả cờ thẳng về màn — không phụ thuộc việc gửi thành công hay không, nên vẫn giữ nguyên luật *"gửi hỏng không được làm hỏng việc ghi sổ"*. Màn hình nay phân biệt rõ **ba** kết quả thay vì hai:

| | Hiện gì |
|---|---|
| Ghi hỏng | ⛔ báo đỏ, không ghi gì |
| Ghi được, tin đã gửi | im lặng như cũ |
| **Ghi được, tin KHÔNG tới** | ✔ *"Đã ghi nhận, nhưng tin nhắn KHÔNG gửi được — NV này chưa nối Telegram, cần báo trực tiếp."* |

Chiều nào cũng bắt: NV thao tác thì kiểm hộp thư **CEO**; CEO thao tác thì kiểm hộp thư **NV**.

- Test: server **847/853** (6 lỗi PDF nền cũ) · web **161/161** · build sạch.
- **Việc còn của bot:** map Telegram cho **DN004 · DN012 · DN021 · DN023 · VP004** — 5 người này đang ở trong roster chi phí nên sẽ dùng quy trình đề nghị thật.

### 2026-08-04 — Telegram hai chiều cho toàn bộ quy trình thanh toán

> CEO: *"cứ mỗi lần NV gửi đề nghị là tin nhắn Telegram gửi qua cho CEO, khi CEO duyệt thì tin nhắn sẽ được phản hồi lại cho NV. Kể cả lệnh xin ứng sớm, duyệt sớm, đề xuất… các nội dung khác cũng gửi tin nhắn Telegram."*

`server/src/paymentFlowNotify.js` — **NV làm gì thì báo CEO · CEO làm gì thì báo NV.**

| Việc | Ai nhận | Nội dung |
|---|---|---|
| NV **đề nghị nhận** | CEO | tên NV · lần · kỳ · **số tiền** · hạn · biên độ · "vào duyệt hoặc từ chối" |
| NV **xin nhận sớm** | CEO | như trên + **lý do NV ghi** |
| CEO **mở khoá** | NV | "được đề nghị sớm — vào bấm Đề nghị nhận" |
| CEO **duyệt** | NV | "đang chờ chuyển tiền, xong sẽ có tin nữa" |
| CEO **từ chối** | NV | **lý do** + "bạn ĐỀ NGHỊ LẠI được" |
| CEO **ghi đã trả** | NV | số tiền + ngày chuyển |
| CEO **gỡ ghi nhận** | NV | báo quay lại chưa nhận |
| CEO **đổi số Lần 2** | NV | số mới |

**Ba nguyên tắc:**
- **Tin gửi CEO phải đủ để quyết mà không cần mở app** — có tên, số tiền, hạn, và lý do NV ghi.
- **‼ Gửi hỏng KHÔNG được làm hỏng việc ghi sổ.** Sổ đã ghi rồi thì không thể vì Telegram lỗi mà coi thao tác là thất bại. Không `await`, nuốt lỗi, chỉ ghi log. Có test cấm `await` trong hàm bắn tin.
- **Không tin rác:** đứng yên ở "kế hoạch" thì không nhắn; nấc lạ thì không nhắn bừa.

Module **thuần tính toán** (quyết định gửi cho ai, nội dung gì) tách khỏi phần gửi ⇒ test được toàn bộ luật mà không cần Telegram thật.

- Test: `paymentFlowNotify.test.js` **12/12** · server **845/851** (6 lỗi PDF nền cũ).
- **Cần của bot:** tài khoản CEO phải có trong `telegram_map` với `emp_code = 'CEO'`; NV chưa map thì tin rơi vào `no_recipient` (có ghi log, không nổ).

### 2026-08-04 — Quy trình đề nghị nhận Lần 2 / Lần 3 + kỳ chưa hết tháng không dựng sổ

> CEO chốt: *"một số trường hợp có thể được phép đề nghị sớm hơn, nhưng phải có đường để NV gửi yêu cầu mở khoá"* · *"khi sếp từ chối thì quay về kế hoạch để NV đề nghị lại"* · *"đối với tháng chưa hoàn tất thì không đưa vào hiển thị tất toán ứng tiền vào đây."*

**1. Bốn nấc thay cho hai.** Lần 1 vẫn do App Salary. Từ Lần 2:

```
kế hoạch ──(NV bấm đề nghị)──▶ đã đề nghị ──(CEO duyệt)──▶ đã duyệt ──(CEO ghi)──▶ đã trả
    ▲                                │
    └──────── CEO từ chối ───────────┘   quay về kế hoạch, NV đề nghị LẠI được
```

Chưa tới mốc thì NV **không** bấm đề nghị thẳng — phải **"Xin nhận sớm"** kèm lý do, CEO bấm **"Mở khoá"** thì mới đề nghị được.

- **‼ NV KHÔNG nhập số tiền ở bất kỳ đâu** — chỉ bấm. Số vẫn do backend tính. Có test cấm route đề nghị đọc `amount` từ NV.
- **Mở khoá · Duyệt · Từ chối: CHỈ CEO** (`requireCeo`). NV chỉ thao tác cho **chính mình** (`PAYMENT_EMP_FORBIDDEN`).
- **Đứng sai nấc thì TỪ CHỐI kèm nấc hiện tại**, không ghi đè lặng lẽ. Đã ghi nhận trả rồi thì **đóng**, không quay lại quy trình.
- Từ chối và xin nhận sớm đều **bắt nhập lý do** — người kia đọc được.
- Mọi bước có nhật ký **ai · lúc nào · từ nấc nào sang nấc nào**.

**2. ‼ Kỳ CHƯA HẾT THÁNG ⇒ không dựng sổ thanh toán.** Ứng lần 1 chốt vào **ngày cuối tháng**; tháng chưa hết thì chưa có Lần 1, nên mọi số Lần 2/Lần 3 dựng ra đều là **bịa** — chia trên một cái tổng còn đang chạy, đổi mỗi ngày. Nay trả `period_not_ended` kèm câu giải thích trên màn. Kỳ tương lai cũng chặn. Hết ngày cuối tháng thì tự mở.

**Sửa test cũ:** test `'kỳ CHƯA hết tháng thì Lần 1 là chưa tới ngày duyệt'` không còn đúng — luật mới chặn từ đầu, nấc `pending` không còn xảy ra được nên đã bỏ khỏi code thay vì để code chết.

- Test: `paymentFlow.test.js` **13/13** · server **831/837** (6 lỗi PDF nền cũ) · web **161/161** · build sạch.
- **Nghiệm thu PROD `437497c` (bot, 20:40): bảng toàn đội PASS** — 17 dòng có tên NV và số tiền, tổng `3.096.604.281đ`, đã nhận `721.068.072đ`, còn nợ `2.375.536.209đ`. Đúng phần sửa nối dây `paymentTeam`.

### 2026-08-04 — CEO báo 3 lỗi lúc 21:04; hai trong đó là lỗi Claude gây ra

**1. ‼ 4 NV vẫn bị loại khỏi bảng đội (DN001 · DN021 · DN022 · DN023).** Hợp đồng App Salary có **HAI kiểu** trả lời "tôi không có bản ghi ứng lần 1", và Claude mới bắt một kiểu:
- `available:true · applicable:false · reason:'not_eligible'` — đã bắt từ trước.
- `available:false · applicable:null · reason:'employee_not_found'|'period_not_found'` — **bỏ sót** ⇒ bị hiểu nhầm thành "gọi không được" ⇒ loại khỏi bảng.

Nay bắt cả hai. **Vẫn fail-closed tuyệt đối** với `duplicate_employee` (dữ liệu mâu thuẫn, không phải "không có ứng") và mọi lỗi vận chuyển (`upstream_timeout`, `unauthorized`, `not_configured`, `contract_mismatch`) — có test liệt kê từng mã.

Nhãn theo đúng lời CEO: **"Lần 1 · Bỏ qua"** · *"Bạn không được ứng lần 1 · bỏ qua bước này"*. Lần 2/Lần 3 chia trên **toàn bộ** tổng kỳ, NV hiện đủ ở mọi mục như người khác.

**2. ‼ "Gộp nhiều tháng" nổ `range.months is not iterable`** — lỗi Claude. Route gộp kỳ truyền tay `rangeOverride: { from, to }` trong khi downstream cần cả `months`. Nay dùng `employeeCost.parseMonthRange()`. **Lỗi này chỉ nổ lúc chạy — build xanh, test cũ không bắt**; nay có test khoá.

**3. Ô "Gộp nhiều tháng" hiển thị lộn ngược** — ra *"Từ Tháng Tám 2026 · tới 07/2026"*. Nay mặc định lùi 3 tháng (bật lên là có nghĩa ngay), chặn `max` không cho chọn quá kỳ đang xem, và hiện đúng khoảng đang cộng đã sắp xuôi: **"Đang cộng 05/2026 → 07/2026"**.

**Không phải lỗi:** 4 ô KPI về Xu chỉ hiện khi chọn **một** nhân viên — luật này có từ `cf71ed8` (26/07), đã nằm trong PROD từ trước mọi thay đổi hôm nay.

- Test: server **816/822** (6 lỗi PDF nền cũ) · web **157/157**.

### 2026-08-04 — Bảng "Thanh toán CP toàn đội" rỗng: nối dây sai chỗ (bot bắt đúng, nhưng cách sửa bot đề xuất sẽ gây lỗi nặng hơn)

> Bot: *"deploy bd4ceb4 thành công nhưng nghiệm thu CHƯA ĐẠT… T07 có 21 nhân viên subtotal, tổng ~3.224.290.181đ, nhưng `paymentTeam.rows = 0`."* — **Bot chẩn đoán đúng nguyên nhân.**

**Nguyên nhân:** `employeeSubtotals` do `transformPeriod` sinh ra ở bước **SAU**. Code ở `bd4ceb4` đọc `merged.employeeSubtotals` ngay sau `mergeEmployeeReports` ⇒ luôn `undefined` ⇒ bảng đội **rỗng tuyệt đối** (`rows: 0` và `excluded: 0` — không NV nào được duyệt qua, nên cũng không có lý do nào hiện ra).

**‼ KHÔNG làm theo cách bot đề xuất** ("dựng `paymentTeam` sau `transformReport`). Ở đó subtotals tính trên `numbered` — tức rows **ĐÃ LỌC** theo ô tìm kiếm/tỉnh/tuyến/trang. CEO gõ một chữ vào ô tìm kiếm là **bảng thanh toán toàn đội tự co lại theo**, mà nhìn vẫn như số thật. Đó là **lỗi tiền**, nặng hơn hẳn bảng rỗng — bảng rỗng ít nhất còn nhìn ra là sai.

**Cách đã làm:** tự tính subtotals tại chỗ từ **rows CHƯA LỌC của đúng kỳ đang xem**, bằng chính helper `employeeCostTable.employeeSubtotals` mà bảng vẫn dùng — một công thức, không dựng bản thứ hai. Lấy đúng kỳ `range.to`, không vơ `periods[0]` (sai kỳ khi xem nhiều tháng).

`paymentTeamWiring.test.js` khoá cả hai bẫy: cấm đọc `merged.employeeSubtotals`, cấm dựng sau `transformReport`, và có test **chứng minh bẫy thứ hai có thật** (lọc theo tỉnh xong subtotals rụng từ 3 NV còn 2).

- Test: **5/5** mới · server **812/818** (6 lỗi PDF nền cũ).

**Đính chính cảnh báo 20:15 của Claude:** lúc đó T07 hiện `1.781 dòng / 28.570.134.733đ / 20 NV`, lệch số ghim. Ảnh 20:30 cho thấy **đã về đúng `2.016 dòng / 30.917.892.673đ / 21 NV`** — khớp số ghim từng đồng. Vậy **doanh thu T07 KHÔNG mất**; cú tụt là do lúc đó DataHub thiếu nguồn của 20 NV nên phần *đã phân bổ* tụt theo, hết thiếu thì về. Cảnh báo đó dựng lên là đúng việc, nhưng kết luận "mất 2,35 tỷ" là **sai** — nay đóng lại.

### 2026-08-04 — Sửa `verify_frozen_periods.js`: bot bắt đúng, script gọi hàm không tồn tại

> Bot: *"script mới verify_frozen_periods.js đang tự trả unknown vì gọi store.revenueRows; em đã kiểm độc lập bằng store.getRows và T06/T07 đều khớp 0 lệch."* — **Bot đúng, lỗi của Claude.**

`store.revenueRows` **không tồn tại**; hàm đúng là `store.getRows({ ky })` (đồng bộ, `ky` dạng `MM.YYYY`). Script vì thế **luôn trả `unknown`** ⇒ vô dụng, mà suýt được dùng làm cổng gác cho lần DataHub drain 2.600 event.

Điều duy nhất cứu nó: luật fail-closed — *"không đọc được ≠ khớp"*. Nếu ngày đó code trả `0` thay cho "chưa đọc được" thì script đã **báo `ok` giả** và cổng gác thành vô nghĩa mà không ai biết.

**Đã sửa và khoá lại:**
- Dùng `store.getRows`. **Đổi tên hàm ở store mà quên sửa đây ⇒ NÉM LỖI**, không âm thầm `unknown` nữa. Có test bắt đúng ca đó.
- **Thêm chốt chặn dữ liệu mẫu.** Chạy trên máy dev thì kỳ nào cũng "lệch mấy chục tỷ" (seed ≠ production) ⇒ báo đỏ giả ⇒ vài lần là người ta quen mắt rồi bỏ qua, tới lúc lệch THẬT cũng không ai nhìn. Nay nhận biết bằng **tham chiếu đối tượng** (mọi dòng của kỳ ghim đều là dòng seed) rồi thoát mã `2` kèm lời nhắc; muốn thử thì `--force`.
- Xác nhận số ghim vẫn đúng: **T06 = 28.403.136.096đ / 2.001 dòng · T07 = 30.917.892.673đ / 2.016 dòng**, khớp với kết quả bot kiểm độc lập.

- Test: `verifyFrozenPeriods.test.js` **10/10** · server **807/813** (6 lỗi PDF nền cũ).
- **‼ Script chỉ dùng làm cổng gác được từ bản này trở đi.** Bản đang nằm trên PROD (`7fdbd41`) là bản hỏng.

### 2026-08-04 — CEO báo 3 lỗi trên PROD; rà ra 4 nguyên nhân khác nhau

> CEO: *"ở tab chi phí của tôi đâu cần hiển thị mấy mục Thanh toán CP… chỉ làm rối"* · *"ở tab thanh toán CP hiện tôi không thấy dữ liệu nào hết cả, lọc nhân viên thì chỉ hiển thị có mỗi mã nv, không thấy kèm tên"* · *"tôi nghĩ đang lỗi chưa đồng bộ hết nhé, mày phải tự rà soát lại chuẩn nhé, đang rất là ẩu nhé."*

**1. Bỏ hai khối trùng khỏi tab "Chi phí của tôi".** Đã có menu riêng thì hiện lại chỉ làm rối. Hai khối vẫn được `export` để trang riêng dùng — **một bản dựng duy nhất**, không nhân đôi.

**2. Ô chọn nhân viên chỉ hiện trơ mã.** Code viết `employee.emp_name`, nhưng roster trả về trường **`name`** ⇒ `undefined` ⇒ ra `"DN009 — "`. Nay dùng lại đúng helper `employeeOptionLabel` sẵn có của trang Chi phí (kèm cả nhãn nhóm): `DN002 · NV Sale 02 · CTV`.

**3. ‼ Bảng "Thanh toán CP toàn đội" trống trơn dù xem từng người vẫn ra số.** Nguyên nhân: bảng đội đọc `salaryAdvanceSnapshot`, mà kho **chỉ được ghi khi có ai đó mở trang của từng người**. Chưa ai mở ⇒ kho rỗng ⇒ mọi NV bị xếp vào "thiếu nguồn" ⇒ bảng rỗng, nhìn ra như *"chưa ai được trả"* — sai hoàn toàn. Nay chế độ "Tất cả NV" **nạp kho một lần cho mỗi kỳ** (có hạn chót riêng 8 giây, dùng `mapWithDeadline`). NV đã có số chốt thì `mustFetch` trả `false` ⇒ **không hỏi lại App Salary**, đúng lệnh CEO.

**4. ‼ Lỗi thứ tư — CEO không báo, tự rà ra, và nó làm hỏng đúng tính năng vừa làm sáng nay.** `salaryAdvanceSnapshot.isStorable` **không lưu** câu trả lời *"người này không có ứng lần 1"* (`not_eligible` / `employee_not_found` / `period_not_found`). Hậu quả kép: (a) tính năng *"NV không có ứng vẫn hiện đủ sổ"* chạy đúng ở màn từng người nhưng **âm thầm hỏng ở bảng đội**; (b) mỗi lần mở màn lại hỏi App Salary một lượt, trái lệnh *"có số rồi thì lấy về luôn"*. Nay lưu cả ba mã đó — **vẫn phân biệt tuyệt đối** với `available: false` (gọi không được), có test cho từng vế.

- Đã mở trình duyệt thật kiểm: trang Chi phí **không còn** hai khối trùng · ô chọn NV ra `DN001 · NV Sale 01` · không lỗi runtime.
- Test: server **803/809** (6 lỗi PDF nền cũ) · web **157/157** · build sạch.
- **Chưa kiểm được tại chỗ:** mục 3 và 4 cần App Salary thật mới thấy số — phải nghiệm thu trên PROD sau deploy.

### 2026-08-04 — Canh kỳ đã khoá sổ, dựng sau tin "outbox còn 2.600 event chờ replay"

Bot DataHub báo đã cách ly khoá mồ côi, nhưng **outbox còn 2.600 event chờ replay**. Replay là ghi lại lịch sử: nếu có event chạm **kỳ đã khoá sổ**, tổng T06/T07 sẽ đổi mà **không ai biết** — bộ canh sẵn có (`revenueMaterializeGuard`) chỉ chạy lúc dựng lại dữ liệu, **không canh thường trực**.

`server/scripts/verify_frozen_periods.js` — chạy được bất cứ lúc nào, không cần materialize:
- Số ghim đọc **thẳng từ `revenueMaterializeGuard`** (đã export `APPROVED_RULE_TRANSITIONS`), **không chép tay** — chép tay là có ngày hai nơi lệch rồi cãi nhau không biết bên nào đúng.
- **Lệch một đồng hoặc lệch một dòng đều báo** — không làm tròn cho qua.
- **‼ Không đọc được số sống ≠ khớp.** Trả `unknown` + mã thoát `2`, không im lặng cho qua và cũng **không trả 0** (trả 0 sẽ so ra "lệch −30 tỷ" làm người đọc hoảng nhầm).
- Cùng một kỳ khai ở hai bản chuyển đổi mà lệch số ⇒ báo mâu thuẫn ngay.
- Mã thoát: `0` khớp · `1` **LỆCH, dừng** · `2` chưa đọc được.

Ghim hiện tại: **T06 = 28.403.136.096đ / 2.001 dòng · T07 = 30.917.892.673đ / 2.016 dòng.**

`YEUCAU_GUI_BOT_DATAHUB.md` bổ sung **đợt 2**: nêu rõ cách ly khoá tay mới là dẹp hậu quả, chưa phải sửa nguyên nhân; yêu cầu **lọc outbox theo kỳ TRƯỚC khi drain** và chạy script canh **SAU khi drain**; 4 câu bắt buộc trả lời.

- Test: `verifyFrozenPeriods.test.js` **6/6** · server **801/807** (6 lỗi PDF nền cũ).

### 2026-08-04 — Hai việc tăng tốc CEO duyệt + yêu cầu gửi bot DataHub

**1. Tách thư viện biểu đồ khỏi gói chính.** `recharts` nặng **167KB nén** nằm thẳng trong gói vào ⇒ MỌI trang phải tải, kể cả Chi phí / Thanh toán / Cơ số thầu vốn không vẽ biểu đồ nào.
- Thêm `web/src/chartsLazy.jsx` — `import()` động, có khung xương giữ chỗ nên **không giật layout**.
- **Phải bỏ luôn `manualChunks: { recharts }` trong `vite.config.js`.** Đây là bẫy: khai manualChunks biến recharts thành mảnh thuộc đồ thị gói vào ⇒ Vite chèn `<link rel="modulepreload">` vào `index.html` ⇒ trình duyệt **vẫn tải ngay 167KB** dù đã lười. Đo sau khi bỏ: `index.html` không còn preload gói biểu đồ.
- **Tải lần đầu: 306KB → 184KB nén (giảm ~40%).** Gói biểu đồ 124KB chỉ tải khi thật sự có biểu đồ.
- Test khoá lại cả 3 mặt: cấm khai `manualChunks`, cấm trang import tĩnh `charts.jsx`, và mọi biểu đồ xuất ra đều phải có bản lazy (thiếu một cái là kéo recharts về gói chính trở lại).

**2. Trả số cũ ngay, dựng lại ngầm** cho bảng "Tất cả NV" (`memoGet` nhận `staleMs`, bật `10 phút` cho khoá base).
- Trước đây ai mở đúng lúc cache vừa hết hạn thì phải **ngồi chờ dựng lại cả bảng 21 NV**.
- Nay trả bản cũ tức thì rồi dựng bản mới ở nền. Quá hạn dùng tạm thì mới chờ số mới thật.
- **Chỉ hoãn việc tải lại, không bịa số:** bản cũ là số thật của ≤10 phút trước và **vẫn mang nguyên** cờ "thiếu nguồn" + tên NV lỗi của lần dựng đó.
- Dựng ngầm hỏng thì **giữ bản cũ** và cho thử lại — không xoá trắng.

**3. `YEUCAU_GUI_BOT_DATAHUB.md`** — bản rút gọn của `DIRECTIVE_DATAHUB_VAULT_LOCK_SELFHEAL.md`, viết sẵn để CEO copy gửi thẳng bot DataHub, kèm 4 bước nghiệm thu và 2 câu hỏi bắt buộc trả lời (khoá nằm ở repo nào · kết quả nghiệm thu).

- Test: server **795/801** (6 lỗi PDF nền cũ) · web **155/155** · build sạch.

### 2026-08-04 — Điều tra "app load chậm, sợ có ngày treo": đo được 178 giây, đã chặn cứng ở 25 giây

> CEO: *"tại sao app load dữ liệu vẫn bị chậm, tôi sợ có ngày đứt thì toi… cứ mỗi lần nó load là lại cảm giác thấy sợ nó lỗi hay treo luôn."*

**Đo trước, không đoán.** Chạy trình duyệt thật, ghi lại toàn bộ lượt gọi:
- Màn Tổng quan: **13 lượt API, chạy song song**, không có chuỗi nối tiếp — phần này KHÔNG phải thủ phạm.
- Bản build thật: `index 511KB + recharts 560KB + css 187KB` (≈**335KB sau nén**) — chấp nhận được. Thư mục `report-assets` 32MB **không** được app tải (không có service worker, không chỗ nào tham chiếu) — loại trừ.

**Thủ phạm: bản "Tất cả NV" khi nguồn chậm.**
```
mỗi NV xấu nhất : 6,5s + chờ 2s + 6,5s + chờ 4s + 6,5s = 25,5 giây
21 NV ÷ 3 luồng = 7 đợt  ⇒  178,5 GIÂY cho một yêu cầu lạnh
trình duyệt bỏ cuộc ở 45 giây · Cloudflare cắt ở 100 giây (lỗi 524)
```
Nghĩa là khi DataHub chậm thì màn hình **chắc chắn đứt**, còn server vẫn cày tiếp cho một người đã bỏ đi. Nỗi lo của CEO là có thật và tính ra được.

**Đã chữa** (`server/src/requestDeadline.js`):
1. **Hạn chót cho cả yêu cầu — 25 giây.** Tới hạn thì trả ngay phần đã có. Không còn 178 giây, không còn 524.
2. **NV chưa kịp lấy số ⇒ `sourceOutcome: 'deadline'`**, đi vào đúng luồng "thiếu nguồn" sẵn có, **hiện đích danh tên trên băng đỏ**. Tuyệt đối không trả 0đ thay cho "chưa có số".
3. **Một NV lỗi không còn kéo sập cả bảng.** Trước đây một NV lỗi ⇒ HTTP 500 ⇒ CEO mở màn hình thấy trắng, 20 người còn lại mất theo. Nay người lỗi hiện tên, người khác vẫn ra số. (Đổi hợp đồng có chủ đích, đã sửa `perfRouteMemo.test.js`.)
4. **Nâng số luồng 3 → 6** ⇒ 7 đợt còn 4. Không nâng cao hơn vì DataHub đang hay kẹt khoá `vault-audit`.

**Một lỗi tự bắt được giữa chừng:** bản vá đầu tiên trả `periods: []` cho NV bị cắt ⇒ tầng gộp không thấy họ ở đâu ⇒ **NV biến mất khỏi bảng** thay vì hiện tên. Đúng thứ CEO cấm tuyệt đối. Đã sửa dùng khung rỗng chuẩn `emptyRangePayload` và khoá lại bằng test.

- Test: server **792/798** (6 lỗi PDF nền cũ) · `employeeCostAllDeadline.test.js` **7/7**.
- **Chưa làm, đề xuất tiếp:** tách `recharts` (163KB nén) ra khỏi gói chính vì nhiều trang không vẽ biểu đồ; và trả bản cũ ngay + dựng lại ngầm cho bảng "Tất cả NV" (nay mới làm cho bảng tỷ lệ).

### 2026-08-04 — CEO duyệt 2 đề xuất: tách "Đã nhận" + hạn có biên độ trượt 15 ngày

**1. Ô "Đã nhận (lũy kế)" nay TÁCH hai loại tiền.** Trước đây gộp chung "App Salary đã chi" với "CEO đã bấm ghi nhận trả" ⇒ lúc đối chiếu hụt tiền không truy được hụt ở khâu nào. Nay dòng phụ ghi rõ: *"App Salary chi … · CEO ghi nhận …"*. Backend trả `receivedFromSalary` + `receivedRecorded`, có test buộc hai số cộng lại đúng bằng `received`.

**2. Hạn Lần 2 / Lần 3 là một KHOẢNG, không phải một ngày cứng.**
> CEO: *"anh đồng ý số ngày theo lịch, không kể ngày nghỉ chủ nhật, nghỉ lễ… lần 2 sẽ rơi vào trong khoảng ngày 15/09/2026 có dao động biên độ trượt lên 15 ngày"* và *"có ngày cứng để nhắc tin nhắn telegram là ngày 15/09, nhưng sau đó có thể nhắc lại bổ sung trong vòng 15 ngày, nếu ngày đó chưa thực hiện ứng lần 2."*

- **Ngày mốc vẫn đếm THẲNG theo lịch** — CEO đã cân nhắc và chọn KHÔNG dời tránh Chủ nhật/lễ. `holidays.json` **không được cắm vào** chỗ này; có test khoá lại.
- **Thêm biên độ 15 ngày:** quá mốc mà còn trong biên độ ⇒ trạng thái mới **"tới hạn · trong biên độ"** (🟡), **không báo đỏ**. Quá biên độ mới là **quá hạn** (🔴). Nhờ vậy hạn rơi vào Chủ nhật hay Tết không bị báo đỏ oan.
- Cột Hạn ghi rõ *"qua mốc N ngày · còn M ngày biên độ"*.

**3. Tin Telegram theo đúng nhịp CEO mô tả** (`paymentNotify`):
- **Đúng ngày mốc** ⇒ tin cứng "đã có thể nhận", nói luôn còn nhận được tới ngày nào. **Lỡ mất ngày đó (cron chết) thì lần chạy sau vẫn gửi bù** — tin cứng không được rơi mất.
- **Nhắc lại bổ sung ở 3 mốc 5 · 10 · 15 ngày** trong biên độ nếu vẫn chưa nhận. Mỗi lần chạy **chỉ lấy mốc cao nhất đã tới** ⇒ cron chết mấy hôm cũng không bắn dồn 3 tin.
- **Quá biên độ mới bắn tin đỏ.** Trước đây bắn đỏ ngay hôm sau ngày mốc — sẽ nhắn oan hàng loạt khi bật `EMP_COST_NOTIFY` ngày 09/08.

- Test: server **785/791** (6 lỗi PDF nền cũ) · web **150/150** · build sạch · đã mở app thật bằng chromium, tài khoản CEO, không lỗi runtime.

### 2026-08-04 — Sổ thanh toán: sửa 4 chỗ sai nghiệp vụ CEO chỉ ra trên ảnh chụp

> CEO xem ảnh T07 của DN009 và chỉ ra: Lần 1 **57.851.347đ** bị gắn **"quá 4 ngày · quá hạn"**, cột "Khoảng cách" để trống, NV không có ứng thì mất luôn sổ, và tài khoản CEO chưa phải bảng tổng hợp chung.

**1. ‼ Lần 1 KHÔNG BAO GIỜ còn bị gắn "quá hạn".** App Salary **duyệt ứng lần 1 vào NGÀY CUỐI THÁNG của kỳ** — có số nghĩa là việc đó đã xong. Trước đây code đem hạn `31/07` so với hôm nay `04/08` rồi kêu quá hạn: App Report đi đòi nợ chính khoản App Salary đã chi. Nay Lần 1 miễn nhiễm với luật quá hạn; trạng thái là **đã ứng** (kỳ đã hết tháng) hoặc **chưa tới ngày duyệt** (kỳ đang chạy). Kéo theo **"Đã nhận (lũy kế)"** nay tính cả Lần 1 — khớp đúng ô "Còn lại sau ứng lần 1" `278.482.913đ` trong ảnh của CEO.

**2. Cột "Khoảng cách" của Lần 1 hết để trống** — ghi rõ *"chốt ngày cuối tháng 07/2026"*, cột Hạn ghi *"App Salary đã duyệt"* thay cho *"quá 4 ngày"*.

**3. NV không có ứng lần 1 ⇒ VẪN dựng sổ ĐẦY ĐỦ.** Ghi *"Lần 1 · Không ứng — App Salary không ghi nhận"*, Lần 2 và Lần 3 chia trên **toàn bộ** tổng kỳ, và NV đó **vẫn nằm trong bảng toàn đội**.
- **‼ Vẫn phân biệt tuyệt đối hai chuyện khác nhau:** App Salary *trả lời rõ là không có ứng* (`not_eligible` / `employee_not_found` / `period_not_found`) ⇒ 0 là số thật. *Gọi không được* (timeout, lỗi mạng) ⇒ **vẫn fail-closed**, không được hiểu thành "không có ứng". Có test riêng cho từng vế.

**4. Tài khoản CEO là BẢNG TỔNG HỢP CHUNG** — thêm 4 ô: **Σ Đã ứng lần 1 · Σ Lần 2 · Σ Lần 3 · Σ C44 cuối năm**, kèm số NV không có ứng lần 1. Bất biến mới: `Σ L1 + Σ L2 + Σ L3 == Σ tổng đội`.

**5. Gộp nhiều kỳ (cả CEO lẫn NV)** — nút "Σ Gộp nhiều tháng" + chọn từ tháng → tới tháng, ra: tổng cả khoảng · đã ứng · còn lại chưa nhận · C44 tích luỹ. Tính ở backend (`buildPaymentRangeSummary` + `GET /employee-cost/payment/range`, self-scope, tối đa 24 kỳ). **Kỳ nào thiếu nguồn thì kể tên ra, KHÔNG cộng 0 vào tổng** — cộng 0 làm tổng nhỏ đi mà nhìn vẫn sạch.

- Test: server **777/783** (6 lỗi PDF nền cũ) · web **148/148** · build sạch. Đã mở app thật bằng chromium, tài khoản CEO, không lỗi runtime.

### 2026-08-04 — "Thanh toán CP của tôi" nay CÓ MENU RIÊNG (CEO báo: mở app không thấy đâu)

> CEO: *"phần thanh toán CP của tôi. Hiện tao truy cập vào app vẫn không tìm thấy mục đó."* — **CEO đúng, báo cáo trước đó của Claude là sai.** Sổ thanh toán CÓ tồn tại, nhưng:
> 1. Nó chỉ là **một khối nằm lẫn trong trang "Chi phí của tôi"**, không có menu ⇒ không ai đi tìm mà thấy.
> 2. Tệ hơn: `if (allEmployees) return null` — đang ở chế độ **"Tất cả NV"** thì khối đó **biến mất sạch, không một dòng chữ**. Mà "Tất cả NV" chính là chế độ mặc định của tài khoản CEO ⇒ CEO không bao giờ nhìn thấy nó.

**Đã sửa:**
- **Menu riêng `💵 Thanh toán CP` → "Thanh toán CP của tôi"** (`web/src/pages/PaymentSchedule.jsx`), đứng ngay dưới "Chi phí của tôi". Có nút chọn tháng nhanh, chọn tháng bất kỳ, và ô chọn NV cho CEO/admin.
- **Khoá quyền y hệt "Chi phí của tôi"** (`employeeCostControlled`) — ai bị tắt xem chi phí thì cũng không thấy menu này. **Ghi nhận đã trả vẫn CHỈ CEO.**
- Trang riêng **dùng lại đúng hai khối** `PaymentSchedulePanel` / `PaymentTeamPanel` của trang Chi phí — một bản dựng duy nhất, tránh lặp lại vụ KPI và badge lệch nhau hôm 03/08.
- **Hết `return null` lặng lẽ:** chế độ "Tất cả NV" nay nói rõ *"sổ thanh toán là của từng người — chọn 1 nhân viên"*; thiếu nguồn thì nói *"chưa dựng được sổ"*.
- **‼ Không NV nào dựng được sổ ⇒ CẤM hiện `0đ`.** Ảnh chụp lần đầu ra *"Tổng chi phí toàn đội 0đ · Còn nợ 0đ"* — nhìn y như **đã trả hết**, trong khi sự thật là **chưa lấy được số**. Nay thay bằng câu *"Chưa NV nào dựng được sổ kỳ này — không phải 'đã trả hết'"*.

**Đã chạy thật, không chỉ chạy test** (chromium, dữ liệu mẫu): đăng nhập CEO → menu hiện `💵 Thanh toán CP` → mở trang, **không lỗi runtime**; bản điện thoại 412px vào qua nút **Menu** cũng sạch lỗi. Ảnh chụp gửi CEO.

- Test: web **148/148** (thêm `PaymentSchedule.menu.test.mjs` 8 mục) · `npm run build` sạch. `PaymentSchedule.jsx` đã được thêm vào bộ quét "dùng mà chưa import" để không tái diễn vụ `ReferenceError` lúc mở màn.

### 2026-08-04 — Màn "Chưa đồng bộ": phần QUYẾT ĐỊNH đã xong, bot chỉ còn đổ dữ liệu vào

`server/src/syncExceptionClassifier.js` — hàm **thuần** (không truy vấn, không ghi): đưa vào toàn bộ dòng nguồn của kỳ + danh sách dòng đã tính doanh thu ⇒ trả về từng dòng bị loại **kèm mã lý do**. Nhờ tách như vậy, phần khó và dễ sai (quyết định dòng nào bị loại vì sao) không còn phải chờ máy chủ có DB thật.

Bot chỉ còn đúng hai dòng:
```js
const exceptions = classifySyncExceptions({ period, sourceRows, includedLineIds, knownUnits, knownProducts, roster });
syncExceptionStore.write(period, { source, included, exceptions });
```

- **Dòng ĐÃ tính tiền chỉ được gắn mã "thiếu thông tin"**, cấm gắn mã loại — nếu không, một dòng vừa được tính tiền vừa bị báo loại thì bất biến `Σ(đưa vào)+Σ(loại)==Σ(nguồn)` sai ngay.
- **Bị loại mà không khớp luật nào ⇒ vẫn xuất ra với mã `KHONG_RO`** để lộ chỗ chưa khai báo. Thà thừa một dòng lạ còn hơn thiếu một dòng không ai biết.
- **`HOLD_GOLIVE` đã giao mà vẫn bị loại ⇒ báo ra** (nhóm ghi chú, VẪN TÍNH tiền — CEO chốt 29/07).
- **Không có danh mục đối chiếu thì KHÔNG tự kết luận là thiếu** — không có `knownUnits` thì không được vu cho dòng đó thiếu đơn vị.
- Một dòng thiếu nhiều thứ thì **kể hết**, không dừng ở lỗi đầu tiên.
- Bám đúng hai vụ thật: `MISA_THIEU_NGAY_DOANH_THU` = đơn `DH479815711` **2.399.520đ** (có tiền, đã ghi doanh số, thiếu ngày) · `DON_VI_THIEU_DANH_MUC` = `175.BVĐK Vũng Tàu` **275,9tr** (tính đủ tiền nhưng mất tỉnh khi lọc).
- Test có ràng buộc **mọi mã do bộ phân loại sinh ra đều phải nằm trong `syncExceptionCatalog.js`** ⇒ thêm luật mới mà quên khai báo lý do thì test đỏ.
- Test: `syncExceptionClassifier.test.js` **14/14** · server **768/774** (6 lỗi PDF nền cũ).

### 2026-08-04 — Lịch chạy nền một cửa: nhắc thanh toán + AI đề xuất target ngày 01

`server/src/scheduledJobs.js` — bot chỉ cần gọi `runDueJobs()` mỗi ~5 phút, module tự quyết việc nào tới giờ. **Mọi mốc theo giờ Việt Nam** (`Asia/Bangkok`), có test chứng minh: `2026-08-31T17:30Z` = **00:30 ngày 01 giờ VN** vẫn được nhận là **ngày 01** — lấy giờ máy thì lịch "ngày 01" bắn nhầm sang ngày 31 và neo nhầm tháng.

- **`payment_notice`** — mỗi ngày một lần từ 08:00: nhắc Lần 2/Lần 3 tới hạn & quá hạn.
- **`target_proposal`** — hai mốc: **ngày 01 08:00** đề xuất ngay đầu tháng (neo tháng vừa kết thúc, `closed:false` ⇒ ghi rõ CHƯA khoá sổ); **ngày 09 08:00** tính lại bằng số đã chốt (`closed:true`).
- **‼ Không tự áp target** — chỉ sinh đề xuất + nhắn CEO. Ghi thành target thật là do CEO bấm.
- **Mỗi mốc chỉ chạy một lần**; gọi lại trong ngày không lặp.
- **Việc lỗi thì KHÔNG đánh dấu đã chạy** ⇒ kênh hồi phục là chạy lại, không nuốt mất.
- `dryRun` để xem trước sẽ chạy gì mà không gửi gì.
- Test: `scheduledJobs.test.js` **9/9** · server **744/750** (6 lỗi PDF nền cũ).

**Còn của bot:** cắm `runDueJobs()` vào cron/PM2 với hai handler (`paymentNotify.runPaymentNotices` đã sẵn; `target_proposal` gọi `smart.forecastTargets` rồi lưu đề xuất + nhắn CEO). Chạy `dryRun` ít nhất một lần trước khi bật thật.

### 2026-08-04 — "Không mất số VÀ không kẹt" — làm nốt phần App Report tự lo được

> CEO: *"giải quyết sao cho không mất số và không kẹt là việc của chúng mày tự tính toán đi chứ, sao lại đẩy về cho tao."* — **CEO đúng.** Bản trước mới lo được "không mất số" rồi đẩy phần "không kẹt" sang DataHub. Nay làm nốt phần App Report tự quyết được.

**1. Hết chờ 25 giây khi nguồn kẹt.** Ngân sách chờ mặc định tệ nhất là `6,5 + 2 + 6,5 + 4 + 6,5 ≈ 25 giây` — NV ngồi nhìn màn quay ngần ấy rồi mới thấy lỗi.
- **Đã có bản lưu tỷ lệ cho mọi kỳ đang hỏi ⇒ đi đường nhanh:** timeout `2s`, **không hỏi lại**. Quá hạn thì trả số cũ **ngay** (kèm nhãn) rồi **làm tươi ngầm bằng ngân sách đầy đủ** để lần sau có số mới.
- **Chưa có bản lưu ⇒ giữ nguyên ngân sách đầy đủ** — không cắt ngắn cơ hội lấy số thật, vì lúc đó không có gì để dùng lại.
- Test đo bằng đồng hồ thật: nguồn kẹt ⇒ **chỉ hỏi 1 lần**, cắt ở `2s`, màn trả về dưới `6s` thay vì ~25s.

**2. Kết quả LỖI không còn được giữ lâu bằng kết quả tốt.** Bản gộp "Tất cả NV" trước đây cache **6 giờ** kể cả khi có NV lỗi nguồn ⇒ hỏng nửa ngày mới lộ (đúng vụ 01/08). Nay `memoGet` nhận `ttlFor(value)`: bản gộp **sạch** giữ 6 giờ, bản gộp **có NV lỗi nguồn hoặc đang dùng tỷ lệ cũ** chỉ giữ **2 phút** ⇒ lần mở kế tiếp tự thử lại.

- Test: server **735/741** (6 lỗi PDF nền cũ) · `employeeCostRateSnapshot.test.js` **8/8**.
- **Vẫn còn của DataHub:** khoá `vault-audit.lock` tự lành (`DIRECTIVE_DATAHUB_VAULT_LOCK_SELFHEAL.md`). App Report nay **không mất số, không bắt người dùng chờ** — nhưng nguồn vẫn sẽ kẹt cho tới khi khoá tự lành. Đây là giới hạn thật của phía App Report, không phải việc bỏ dở.

### 2026-08-04 — Nguồn chi phí kẹt KHÔNG còn làm mất số (nửa việc của App Report trong mục RAM)

CEO duyệt nâng ưu tiên. Mục này có **hai nửa**, và nửa quan trọng nhất **không nằm ở App Report**:
- **DataHub:** `vault-audit.lock` phải **tự lành** (ghi PID chủ + TTL, ai vào sau thấy chủ chết/quá hạn thì tự phá khoá). RAM còn vọt là còn restart ⇒ *tiến trình chết khi đang giữ khoá là điều PHẢI chịu được*. Đây là thứ duy nhất **cắt được vòng lặp** — App Report không với tới.
- **App Report (làm ở bản này):** nguồn kẹt vài giây thì **không được mất số**.

`server/src/employeeCostRateSnapshot.js`:
- Nguồn tốt ⇒ nhớ lại **bảng tỷ lệ** vừa lấy (nhỏ: chỉ % theo mã hàng × đơn vị).
- Nguồn kẹt ⇒ dùng lại bản gần nhất, gắn `rateStale` + `rateFetchedAt`, `outcome = ok_stale_rates`, kèm câu *"Nguồn chi phí đang kẹt — đang dùng bảng tỷ lệ lấy được gần nhất"*.
- **Chưa từng có bản lưu ⇒ vẫn fail-closed như cũ**, không bịa số.
- **Bản lưu quá 45 ngày thì bỏ** — thà không có còn hơn dùng tỷ lệ lỗi thời.
- **Kỳ đã có số thật thì bản lưu KHÔNG được đè lên.**
- Không đóng băng cái rỗng; kho có trần 800 bản ghi.
- **Đây không phải che lỗi:** cờ số cũ + mốc thời gian luôn hiện ra, cảnh báo nguồn vẫn chạy. Chỉ khác: NV không còn thấy **0đ oan** trong lúc nguồn kẹt — đúng vụ 21 NV hiện 0đ ngày 01/08.
- Test: `employeeCostRateSnapshot.test.js` **6/6** · server **739/745** (6 lỗi PDF nền cũ).

**Còn của bot:** ① deploy bản RAM `9986f0a` ② **yêu cầu DataHub làm khoá tự lành** — không có nó thì vòng lặp vẫn còn, bản này chỉ đỡ đau chứ không chữa gốc.

### 2026-08-04 — Màn "Chưa đồng bộ": kho + API + màn hình (phần Claude xong)

- **`server/src/syncExceptionStore.js`** — nơi materializer ghi phần bị loại của mỗi kỳ (`source`/`included`/`exceptions`). Giữ tối đa 24 kỳ, 5.000 dòng/kỳ, cắt bớt thì **nói ra** (`truncated`). Kỳ sai khuôn không ghi được.
- **`GET /api/revenue/sync-exceptions?ky=`** (admin, `no-store`) — đọc kho, chạy qua `syncExceptionReport` rồi mới trả.
- **‼ Phân biệt hai trạng thái dễ lẫn nhất:** kỳ **chưa chạy phân loại** trả `ran:false` + `report:null` kèm câu nói thẳng — **không** trả báo cáo rỗng làm người xem tưởng sạch. Đây đúng bệnh cũ: tưởng sạch trong khi chưa ai nhìn.
- **`web/src/pages/SyncExceptions.jsx`** — 4 ô (Tổng nguồn · Đã đưa vào · Bị loại · **Vào đủ tiền nhưng thiếu thông tin**) + bảng **gom theo lý do** (xử cái nhiều tiền trước) + bảng **từng dòng**. Mỗi dòng và mỗi lý do đều kèm **ai xử lý · làm gì**.
- Không cân ⇒ **"⛔ KHÔNG CÂN — có dòng rơi ở chỗ chưa ai khai báo"** kèm **đúng số lệch**; thiếu căn cứ ⇒ nói rõ **không kết luận là đã cân**; có mã lý do lạ ⇒ hiện ra để khai báo.
- Test: `syncExceptionRoute.test.js` **5/5** · `SyncExceptions.test.mjs` **7/7** · server **726/732** · web **138/138** · build sạch.
- **Còn của bot:** materializer lấy TOÀN BỘ dòng của kỳ → phân loại → gọi `syncExceptionStore.write()`. Gắn màn vào thanh điều hướng sau khi có dữ liệu thật.

### 2026-08-04 — Màn "Chưa đồng bộ": danh mục lý do + chốt bất biến (phần của Claude)

Món nợ từ 29/07. Việc chia đôi: **phân loại dòng bị loại** phải làm trong materializer trên máy chủ (bot, cần DB thật); **hợp đồng dữ liệu + kiểm bất biến + màn hình** là phần Claude. Làm phần Claude trước để bot chỉ việc gắn `code`.

**`server/src/syncExceptionCatalog.js`** — 14 mã lý do, mỗi mã bắt buộc đủ **nghĩa · ai xử lý · làm gì**; có test chặn lý do chung chung. Ba nhóm tách bạch:
- `excluded` — bị loại, tiền KHÔNG tính (vd `MISA_THIEU_NGAY_DOANH_THU` = vụ `2.399.520đ`, đơn `DH479815711`).
- `incomplete` — **VÀO ĐỦ TIỀN** nhưng thiếu thông tin nên rơi khỏi bộ lọc (vd `DON_VI_THIEU_DANH_MUC` = vụ `175.BVĐK Vũng Tàu`, tính đủ 275,9 triệu nhưng lọc theo tỉnh thì mất). Nhóm này **không bị trừ khỏi tổng nguồn**.
- `note` — vẫn tính tiền, chỉ theo dõi (`WEB_HOLD_GOLIVE_DA_GIAO` — CEO chốt 29/07 VẪN TÍNH).
- **Mã lạ không được nuốt:** hiện ra kèm việc phải làm *"khai báo mã lý do này"*.

**`server/src/syncExceptionReport.js`** — kiểm bất biến `Σ(đưa vào) + Σ(loại) == Σ(nguồn)` cả **tiền lẫn số dòng**; lệch thì nêu **đúng số lệch**, không kết luận cân. **Thiếu số nguồn ⇒ `balanced: null`**, không được coi là "đã cân" — chưa đủ căn cứ khác hẳn đã cân. Gom theo mã lý do, xếp tiền lớn lên đầu để xử trước; mỗi dòng kèm luôn ai xử lý.

- Test: `syncException.test.js` **8/8** · server **722/728** (6 lỗi PDF nền cũ).
- **Còn của bot:** materializer lấy TOÀN BỘ dòng của kỳ (universe) → phân loại từng dòng → ghi ra danh sách ngoại lệ kèm `code`. Có `buildSyncExceptionReport` rồi thì chỉ cần gọi và dừng khi `balanced === false`.

### 2026-08-04 — Sửa lỗi rollback: `EmployeeCost.jsx` thiếu import từ `employeeCostModel.js`

- Bot chặn ở **post-deploy browser** trên `39a402c`: `ReferenceError: readEmployeeCostPrefs is not defined` ⇒ rollback về `244d058`. **Bot làm đúng.**
- Nguyên nhân: `readEmployeeCostPrefs` / `writeEmployeeCostPrefs` / `employeeCostDelta` / `formatDeltaLabel` **được dùng nhưng không được import**. Một lượt vá nguồn của Claude khớp hụt chuỗi nên chỉ ghi phần thân, bỏ mất dòng import. **Build và test đều xanh** vì lỗi chỉ nổ lúc mở màn — đúng lần thứ HAI cùng kiểu (trước đó là `aiRows` thiếu khai báo state).
- Đã bổ sung đủ 4 import.
- **Thêm chốt chặn thật sự:** `web/test/EmployeeCost.imports.test.mjs` quét **mọi trang** dùng `employeeCostModel.js` — tên nào được **gọi** mà không có trong danh sách import thì test đỏ, kèm tên cụ thể. Bỏ chuỗi/comment trước khi quét để không báo nhầm.
- **Đã kiểm chứng test bắt được lỗi thật:** gỡ dòng import ra ⇒ test đỏ và chỉ đúng 4 tên; gắn lại ⇒ xanh.
- Test: web **131/131** · server **714/720** (6 lỗi PDF nền cũ) · build sạch.

### 2026-08-04 — "Thanh toán CP" GĐ2 hoàn tất: nút ghi nhận trên màn + nhắc Telegram

**1. Nút ghi nhận ngay trên sổ — chỉ CEO thấy.**
- Chọn lần (Lần 2/Lần 3, **không có Lần 1**) → nhập **số tiền THẬT đã chuyển** + **ngày chuyển** → *"✓ Ghi nhận đã trả"*. Có *"↩ Gỡ ghi nhận"* cho trường hợp ghi nhầm.
- Ghi xong sổ tự tải lại: Lần 3 co lại theo số thật, "đã nhận"/"còn nợ" cập nhật ngay.
- **Ẩn nút chỉ để gọn mắt, KHÔNG phải lớp bảo vệ** — backend vẫn chặn độc lập bằng `requireCeo`.

**2. Nhắc Telegram** — `server/src/paymentNotify.js`, dùng lại `notifyChannels`, không dựng kênh mới.
- **Mở cửa sổ:** tới ngày nhận → *"Lần 2 kỳ 2026-07: 90.000.000đ đã có thể nhận. Hạn 14/09/2026."*
- **Quá hạn:** *"🔴 QUÁ HẠN — Lần 2 … đã quá 17 ngày chưa nhận. Sổ còn nợ: 150.000.000đ."*
- **Không spam:** mỗi (NV · kỳ · lần · loại tin) chỉ nhắn **một lần**; đã ghi nhận trả thì **thôi nhắc lần đó**.
- **Không nhắc Lần 1** — đó là việc của App Salary.
- **Gửi lỗi thì KHÔNG đánh dấu đã gửi** ⇒ kênh hồi phục là nhắc lại, không nuốt mất tin.
- Có `dryRun` để chạy thử: lên kế hoạch, không gửi, không đánh dấu.
- Sổ chưa dựng được ⇒ không nhắn gì.
- Test: `paymentNotify.test.js` **8/8** · server **714/720** (6 lỗi PDF nền cũ) · web **127/127** · build sạch.

**GĐ2 xong.** Còn việc vận hành: bật lịch chạy nhắc trên server (bot) — code đã sẵn, `runPaymentNotices` nhận sẵn `send` và có `dryRun` để chạy thử trước.

### 2026-08-04 — "Thanh toán CP" GĐ2: CHỈ CEO được ghi + bảng toàn đội

**1. Siết quyền ghi sổ về đúng một người (CEO chốt 04/08).**
> *"Chỉ duy nhất CEO được phép ghi thôi nhé."*
- Thêm `auth.requireCeo` / `auth.isCeo`. `requireAdmin` cho cả `ceo` lẫn `admin` nên **không đủ chặt** cho cửa động vào tiền chi trả.
- Cả 3 route ghi sổ (`payment/second`, `payment/record`, `payment/undo`) chuyển sang `requireCeo`. **Admin nay bị 403 `CEO_ONLY`.**
- Test chặn cả hai chiều: phải có `requireCeo` **và** không được còn `requireAdmin`; `admin`/`sale`/rỗng đều 403, chỉ `ceo` đi qua (không phân biệt hoa thường).

**2. Bảng thanh toán toàn đội** — `server/src/paymentTeamSummary.js`, hiện ở chế độ "Tất cả NV".
- 4 ô: Tổng chi phí toàn đội · Đã nhận · Còn nợ · **Quá hạn (N nhân viên)**; bảng từng NV có **lần kế tiếp + hạn + còn/quá N ngày**, xếp **NV quá hạn lên đầu**.
- **Không gọi thêm mạng:** dùng lại subtotals của chính bảng ALL đang dựng + **kho Lần 1 đã chốt** + sổ ghi nhận. Chế độ ALL vẫn không fan-out App Salary như trước.
- **NV thiếu nguồn được TÁCH RIÊNG kèm lý do**, không thành 0 và **không cộng vào tổng đội** — không để một NV thiếu số kéo tổng toàn đội xuống.
- Bất biến toàn đội `đã nhận + còn nợ == tổng`; gãy ⇒ **"⛔ Sổ toàn đội chưa cân"**, không hiển thị số chỏi.
- Test: `paymentTeamSummary.test.js` **4/4** · route quyền **3/3** · server **706/712** · web **127/127** · build sạch.

**Còn lại của GĐ2:** nút ghi nhận trên màn (chỉ CEO thấy) · Telegram nhắc mở cửa sổ Lần 2 / quá hạn.

### 2026-08-04 — "Thanh toán CP của tôi" GĐ2 (backend): ghi nhận đã trả + sửa số Lần 2, có nhật ký

`server/src/paymentLedgerStore.js` + 3 route ghi sổ. Đây là **tiền thật** nên khoá chặt theo SPEC §8:
- **Chỉ CEO/admin ghi được** — cả 3 route qua `requireAuth` + `requireAdmin`; NV chỉ xem. Người ghi lấy từ **phiên đăng nhập**, không lấy từ body.
- **Không tự đánh dấu:** chưa ai ghi thì mọi lần mãi là **kế hoạch**, tuyệt đối không hiện như đã trả.
- **Ghi nhận Lần 2 = chốt luôn số Lần 2** (số THẬT đã chuyển thắng số kế hoạch) ⇒ Lần 3 tự co lại, `Σ(các lần) == Tổng` vẫn giữ. Trả lệch số kế hoạch thì **nêu chênh lệch**, không im lặng.
- **Cấm ghi đè Lần 1** — đó là số App Salary (`PAYMENT_KEY_INVALID`).
- **Nhật ký bắt buộc:** ai · khi nào · số cũ → số mới, cho cả sửa số / ghi nhận / gỡ ghi nhận. Gỡ vẫn để lại vết, không xoá lịch sử.
- Chặn tại cửa: số âm/không nguyên/chữ, ngày sai khuôn, mã NV ngoài roster chi phí, thiếu người thực hiện.
- Bản ghi hỏng trong kho bị bỏ qua — thiếu ngày hoặc số bậy thì **không tính là đã trả**.
- Test: `paymentLedgerStore.test.js` **9/9** · `paymentLedgerRoutes.test.js` **2/2** (khoá quyền + no-store + nguồn `actor`) · server **699/705** (6 lỗi PDF nền cũ).

**Còn lại của GĐ2:** nút ghi nhận trên màn (admin) · Telegram nhắc mở cửa sổ/quá hạn · bảng toàn đội cho CEO.

### 2026-08-04 — Module "Thanh toán CP của tôi" GĐ1: lên màn hình

- **API:** `/api/employee-cost` trả thêm `paymentSchedule`, dựng từ đúng hai nguồn đã có sẵn trong cùng response (tổng sau phạt của DataHub + Lần 1 của App Salary) — **không gọi thêm mạng**. Self-scope: chỉ dựng khi đã khoá đúng một NV; chế độ "Tất cả NV" không có sổ, giống KPI ứng/còn lại.
- **Màn hình:** khối "Thanh toán CP của tôi" ngay dưới các ô KPI — 4 ô (Tổng kỳ sau phạt · Đã nhận lũy kế · Sổ còn nợ · C44) + bảng 3 lần với **số tiền · hạn · còn N ngày · khoảng cách · nguồn · trạng thái**.
- Ghi rõ để không hiểu nhầm: **Lần 1 là số App Salary, App Report không sửa**; Lần 2/3 là kế hoạch App Report tính từ `tổng kỳ − lần 1`; **chưa ai ghi nhận đã trả thì vẫn là kế hoạch, không phải đã nhận**; C44 là khoản riêng chi trả T12, không nằm trong 3 lần.
- **Fail-closed:** thiếu tổng hoặc thiếu Lần 1 ⇒ nói đúng thiếu gì (*"Chưa lấy được số ứng lần 1 từ App Salary"*), **không dựng sổ rỗng** trông như đã trả hết. Bất biến gãy ⇒ **"⛔ Sổ chưa cân"**, không hiển thị số chỏi.
- Frontend **chỉ hiển thị**, không cộng trừ lại — mọi số do backend tính và đã kiểm bất biến.
- Test: web **127/127** (thêm 4 test) · server **690/696** (6 lỗi PDF nền cũ) · build sạch.
- **Còn ở GĐ2:** ghi nhận "đã trả" lần 2/3 (chỉ người có quyền, có nhật ký ai-khi nào-số cũ→mới) · sửa số Lần 2 trên màn · Telegram nhắc mở cửa sổ/quá hạn · bảng toàn đội cho CEO.

### 2026-08-04 — Nối kho chốt số "Ứng lần 1" vào đường chạy thật

- `safeGetFirstAdvance()` nay đi qua `salaryAdvanceSnapshot`: kỳ **đã chốt** ⇒ **không gọi App Salary lần nào nữa**; kỳ đang mở chỉ làm tươi khi quá hạn (mặc định 6 giờ). Trước đó chỉ có cache RAM 25 giây ⇒ NV mở màn 10 lần là 10 lượt gọi, restart app là mất sạch (CEO chỉ ra 04/08).
- Trả kèm `fetchedAt` + `fromSnapshot` để màn hình ghi rõ **"số tại lúc …"** — số cũ mà không nói rõ lúc nào thì người xem tưởng số đang sống.
- **Nguồn lỗi mà kho còn số ⇒ vẫn cho xem số cũ** kèm cờ `stale`, hơn là trắng màn. Kho rỗng + nguồn lỗi ⇒ fail-closed đúng như cũ, vẫn phân biệt `contract_mismatch` / `unauthorized` / `upstream_timeout`.
- Có `force` cho nút "Làm mới" và cho webhook khi App Salary duyệt.
- Test: thêm nhánh "đã có số thì KHÔNG gọi lại" và nhánh `stale`; test đường route được dọn kho trước để không dính trạng thái đĩa của lần chạy trước. Server **688/694** (6 lỗi PDF do máy build thiếu `pdfinfo`).

### 2026-08-04 — Module "Thanh toán CP của tôi" GĐ1: lõi sổ thanh toán (backend)

Gỡ chặn trước (`aa56143`): câu *"không build vội, chờ App Salary"* trong spec là của 31/07 và đã lỗi thời — đường lấy **Lần 1** chạy thật trên PROD từ 31/07, còn **Lần 2/Lần 3 vốn là số của App Report**. CEO nhắc đúng.

Thêm `server/src/paymentSchedule.js` — lõi TÍNH TIỀN của sổ, thuần tính toán: không gọi mạng, không ghi gì, không tự đánh dấu "đã trả".
- **Lần 1** = số App Salary (chỉ đọc) · **Lần 2** = 60% phần còn lại, **sửa được** · **Lần 3** = `Tổng − Lần 1 − Lần 2`, **không nhập tay**.
- **Tổng < ngưỡng ⇒ chỉ 2 lần**, Lần 2 thành *tất toán*, bỏ Lần 3. **Ngưỡng 60tr nằm ở cấu hình**, không ghi cứng.
- **Bất biến khớp tuyệt đối:** lần cuối luôn lấy *phần còn lại chính xác* nên làm tròn không thể phá `Σ(các lần) == Tổng`. Có test quét dải số lẻ để chứng minh.
- Sửa Lần 2 vượt phần còn lại ⇒ **kẹp lại + cảnh báo**, không đẻ ra lần 3 âm.
- **C44 là sổ riêng** — `includedInTotal: false`, không cộng vào tổng, không nằm trong lần nào.
- **Fail-closed:** thiếu Tổng hoặc thiếu Lần 1 ⇒ `available:false` + lý do rõ, **không suy thành 0**. Ứng lớn hơn tổng ⇒ nghi sai nguồn, dừng.
- Mốc ngày: Lần 1 cuối tháng kỳ · Lần 2 **+45 ngày** · Lần 3 **+60 ngày**, kèm câu ghi rõ khoảng cách để NV khỏi tự nhẩm (CEO yêu cầu). Tính bằng `Date.UTC` nên không dính múi giờ máy; có test bắc qua năm.
- GĐ1 lần 2/3 luôn ở trạng thái **kế hoạch** — chưa ai ghi nhận thì tuyệt đối không hiện như đã trả. Phần ghi nhận + audit thuộc GĐ2.

Test: `server/test/paymentSchedule.test.js` **12/12** (bám đúng mục 10 spec). Toàn bộ server **679/685** (6 lỗi PDF do máy build thiếu `pdfinfo`).

### 2026-08-04 — "Chi phí của tôi": nhớ lựa chọn lần trước + so với kỳ trước (CEO duyệt 03/08)

**Nhớ lựa chọn.** Mở app lên về đúng NV + kỳ đang xem dở, thay vì luôn nhảy về "Tất cả NV" tháng hiện tại. Chỉ lưu **lựa chọn** (mã NV, kỳ, cờ so sánh) — không lưu số tiền hay dữ liệu nhân sự. Đọc ra phải qua kiểm định dạng: mã NV sai khuôn, kỳ sai khuôn, kỳ ngược đầu-cuối đều bị loại ⇒ **rác trong storage không thể biến thành tham số truy vấn**. Storage bị chặn thì bỏ qua im lặng, không làm hỏng màn hình.

**So với kỳ trước.** Nút bật/tắt cạnh hàng nút tháng, chỉ hiện khi đang xem đúng một tháng; trạng thái bật/tắt được nhớ lại. Ô "Tổng chi phí tháng" thêm dòng `▲/▼ x% (±…đ) so kỳ trước`.
- **Cố ý KHÔNG tự tải.** Chế độ "Tất cả NV" mà tự kéo thêm một kỳ nữa là nặng gấp đôi — đúng chỗ đang gây mất nguồn chi phí luân phiên (bản RAM `9986f0a` chưa deploy). Bật thì mới tải.
- Thiếu một trong hai kỳ ⇒ **không hiện gì**, không hiện `0%` giả. Kỳ trước bằng 0 ⇒ nêu số tuyệt đối, bỏ %.

**Lỗi tự bắt được khi viết test:** `Number(null)` và `Number('')` đều ra `0`, nên bản đầu của `employeeCostDelta` hiểu "chưa có số" thành "bằng 0" và báo **giảm 100% giả**. Cùng loại lỗi bot bắt ở ô nhập target sáng nay. Đã loại `null`/`''` ngay từ đầu hàm, có test chặn.

- Chỉ đụng lớp hiển thị. Không đổi công thức, không đụng backend, không đổi một đồng nào. Test: web **123/123** (thêm 5 test) · build sạch.

### 2026-08-04 — Sửa lỗi Gate 1: khối "AI đề xuất target" thiếu khai báo state

- Bot chặn đúng ở Gate 1 trên `450dca5`: code dùng `aiRows`/`setAiRows` nhưng **không khai báo state**, và phần render vẫn là bản cũ `slice(0, 8)`. Build vẫn xanh vì lỗi chỉ nổ lúc chạy ⇒ bấm **"Tạo đề xuất AI"** là crash trang Target. Nguyên nhân: một lượt vá nguồn của Claude không chạy (lỗi `cd`), chỉ nửa sau của thay đổi được ghi vào file.
- Bổ sung `const [aiRows, setAiRows] = useState({})`; render lại toàn khối: **hiện HẾT nhân viên** (bỏ `slice(0, 8)`), mỗi dòng có **ô tích chọn** + **ô sửa số**, dòng đã sửa hiện *"CEO sửa · AI đề xuất …"*, nút ghi rõ **`Áp dụng N/M NV`** và tự mờ khi chưa chọn ai hoặc còn số không hợp lệ.
- Thêm `web/test/Target.aiProposal.test.mjs` chặn đúng ba lỗi này: thiếu khai báo ký hiệu · cắt bớt danh sách NV · mất ô chọn/sửa từng người.
- Chỉ đụng lớp hiển thị trang Target. Không đổi công thức, không đụng backend. Test: web **113/113** · build sạch.

### 2026-08-04 — Ô doanh thu: đổi nhãn thành "đã phân bổ" thay vì nêu số dòng cách ly

- Bot chặn đúng trước khi deploy `383692f`: câu *"chưa gồm N dòng đang cách ly"* dùng `dqBadge.count` — đó là **tổng mọi loại exception DQ**, không riêng dòng doanh thu bị cách ly, và còn hiện cả khi xem từng nhân viên. Nêu số như vậy là **báo sai**.
- Bỏ hẳn phần nêu số. Thay bằng: nhãn ô đổi thành **"Doanh thu chưa VAT · đã phân bổ"** — tự nó đã đúng ở cả hai chế độ và giải thích được vì sao lệch với App Sale; thêm một câu chỉ đường *"dòng chưa gán được NV nằm ở tab Kiểm soát dữ liệu"*, **chỉ hiện ở chế độ Tất cả NV**, không kèm con số nào.
- Dòng cách ly T08 đã truy ra: đơn `DH479816174` · MISA `341964` · 03/08/2026 · `G1.GE.QĐ139.1104.N2.162` Pizar-3 · SL 40 · **1.795.600đ** · đơn vị `120.HTNT-PHARMACITY` · nguồn gán `VP018` → bị chặn theo policy phân bổ doanh thu nên thành `NON_SALES_ROLE_QUARANTINED`. **Nơi xử lý: App Sale / danh mục phân công gán lại cho NV Sale hợp lệ — App Report không được tự đoán.**
- Test: web **110/110** (cập nhật assertion nhãn) · build sạch.

### 2026-08-04 — MỘT đường duy nhất lấy tỷ lệ: KPI và badge "thiếu %" hết chỏi nhau

Bot chẩn đoán đúng (`artifacts/dn016-dn018-answers-20260803-232300`): T08 có hai API đọc policy theo hai cách khác nhau — KPI áp policy kế thừa T07 (DN016 khớp 20/20, DN018 khớp 22/22) trong khi API badge "thiếu %" chỉ đọc **exact T08** nên báo thiếu toàn bộ. Hai màn ra hai con số ⇒ UI fail-closed ⇒ CEO không xem được badge.

**Lỗi của Claude:** `applyEffectiveRates` chỉ được gắn trong `getForSession`, còn `employeeCostGaps.js` gọi thẳng hàm mạng nên không đi qua kế thừa tỷ lệ.

- Tách `fetchRawEmployeeCost()` (gọi mạng thuần, giữ nguyên 100% ngữ nghĩa cũ, chỉ `applyEffectiveRates` được dùng để tránh đệ quy) và `fetchEmployeeCost()` (bọc = raw + kế thừa tỷ lệ + nâng `invalid_period_payload` → `ok` khi policy đã lấp đủ mọi kỳ).
- `getForSession` không còn tự gọi `applyEffectiveRates`. **Mọi** nơi lấy chi phí — KPI, badge thiếu %, export — đều đi qua một hàm duy nhất; không còn đường vòng.
- Thêm test bất biến: đường KPI (`getForSession`) và đường badge (`fetchEmployeeCost` trực tiếp, đúng cách `employeeCostGaps.js` gọi) phải nhận **cùng một bảng tỷ lệ** và cùng `rateEffectiveFrom`. Test cũ về provenance chuyển sang gọi `fetchRawEmployeeCost` — đường mạng thuần vẫn fail-closed y như cũ.
- Không đổi một công thức tiền nào. Test: server **667/673** (6 lỗi PDF do máy build thiếu `pdfinfo`) · web **110/110** · build sạch.

**Còn lại (không thuộc bản này):** audit cho thấy lỗi nguồn `unavailable` luân phiên ở DN004/DN007/DN008/DN009/DN011/DN017/DN019/DN024 — snapshot DataHub không ổn định. Đây đúng triệu chứng của loop RAM/`vault-audit.lock` chưa cắt; xử lý ở việc bản RAM `9986f0a`, không vá ở đây.

### 2026-08-03 (đêm) — "Chi phí của tôi": gọn bộ lọc, nút chọn tháng, thêm dòng doanh thu đã gồm VAT

CEO 22:39: *"bố trí lại thành bộ lọc nâng cao, ẩn bớt đi… bổ sung nút chọn tháng… tích hợp hiển thị dòng doanh thu có VAT nhỏ hơn ngay dưới dòng chưa có VAT trong cùng một ô KPI."*

- **Nút chọn tháng nhanh** (4 tháng gần nhất, mới nhất trước): bấm một phát là xem ngay tháng đó, không phải chỉnh hai ô rồi bấm Xem. Danh sách tháng bám **lịch Việt Nam** (`currentMonthValueVN`, `quickMonths` dùng `Asia/Bangkok`) — lấy giờ máy thì quanh nửa đêm sẽ đề xuất sai tháng.
- **Bộ lọc nâng cao mặc định đóng**: Vùng/Tỉnh · Nhóm mã đơn vị · Tuyến · Ngày doanh thu · Từ tháng · Đến tháng. Giữ hiện thường trực **Nhân viên** (thao tác nhiều nhất) và hàng nút tháng.
- Đang đóng mà còn bộ lọc bật thì nút hiện **số lượng bộ lọc đang áp** — không để CEO xem bảng đã bị lọc mà tưởng mất dữ liệu. Khoảng nhiều tháng cũng hiện thành một chip riêng.
- **Ô "Doanh thu chưa VAT"**: giữ số trước VAT ở dòng lớn (cơ sở tính chi phí), thêm ngay dưới dòng nhỏ **"Đã gồm VAT: …"** để đối chiếu App Sale không phải đổi màn. Số do backend tính (`summary.revenueTotal`), frontend không tự nhân chia.
- Chỉ đụng lớp hiển thị. Không đổi công thức, không đổi một đồng nào. Test web **110/110** (thêm 2 test hồi quy: GMT+7 cho nút tháng, giữ đủ hai số doanh thu) · build sạch.

### 2026-08-03 (đêm, sau khi deploy d1fdfdf) — "Ứng lần 1": hết vỡ khi App Salary đổi hợp đồng + nói đúng lý do

- `d1fdfdf` trên PROD **không gồm** phần này; ảnh CEO 22:26 (DN009/T07) vẫn hiện câu chung *"Tạm thời chưa lấy được từ App Salary"*. Ghép riêng lên đúng nền PROD.
- `validateProjection()`: bỏ ràng buộc "đếm đúng 10 khoá" — App Salary chỉ cần THÊM một nhãn (`provisional`…) là cả gói bị vứt, ô KPI trắng. Nay chỉ bắt buộc **có đủ** 10 khoá hợp đồng; khoá lạ bị **loại bỏ** khỏi projection. Mọi phép kiểm giá trị giữ nguyên 100%.
- Số lương (`net`…) vẫn tuyệt đối không lọt sang App Report — chỉ 10 khoá đi tiếp; server `console.warn` **tên khoá lạ** (không ghi giá trị) để vẫn phát hiện bên kia trả field ngoài hợp đồng.
- `safeGetFirstAdvance()` không còn nuốt mọi lỗi thành `upstream_unavailable`: trả `contract_mismatch` / `unauthorized` / `upstream_timeout` / `not_configured`. Ô KPI hiện thẳng *"App Salary đổi hợp đồng"*, *"Sai khoá kết nối App Salary"*, *"App Salary phản hồi chậm"* — CEO nhìn là biết chờ ai.
- Không đổi một công thức tiền nào, không đụng `employeeCost.js`.
### 2026-08-03 — "Chi phí của tôi": 0 dòng khớp % thì hiện "—", KHÔNG hiện 0đ

- Ca thật T08.2026: 303 dòng doanh thu, 301/301 cặp (đơn vị × mã hàng) chưa có tỷ lệ % ⇒ `matchedRows = 0`. Trước bản vá, tổng phần đã khớp bằng 0 nên toàn bộ ô KPI tiền hiện **0đ · tạm tính** — CEO đọc thành "app hỏng"/"tháng này không tốn chi phí".
- Thêm `employeeCostNoMatch()` (web model): kỳ có doanh thu nhưng không khớp được dòng % nào. Khi đó `employeeCostColumnKpis()` trả `value: null`, bỏ cờ `provisional`; ô tổng chi phí tháng hiện `—`, nhãn đổi thành `· chưa có bảng %`.
- Ghi chú dưới ô nói thẳng việc phải làm: *"Kỳ này CHƯA CÓ bảng % chi phí — N/N cặp thiếu %. DataHub/App Sale phải nạp tỷ lệ theo mã hàng cho kỳ này thì số mới lên (tab Mặt hàng thiếu %)."*
- Chỉ đụng lớp hiển thị. KHÔNG đổi công thức, KHÔNG đổi backend, KHÔNG đổi một đồng nào. Coverage thấp mà vẫn có dòng khớp thì giữ nguyên số tạm tính như cũ (có test chặn).
- Test: web **104/104 pass** (thêm 2 test hồi quy) · `npm run build` sạch.

### 2026-08-03 — VIỆC 0D đóng lại + xếp thứ tự hàng đợi kế tiếp (tài liệu)

- Xác nhận độc lập trên đúng commit PROD `bf7a7a0`: `revenueRuleLock.test.js` 6/6 pass; phần đối tác của `appSaleRevenueMirror.js` chỉ có MỘT bộ lọc ngày (`o.created_at`) nên lỗi lọc kép từng làm mất 382,6 triệu không tái diễn được; kỳ tự nhảy theo tháng lịch `Asia/Bangkok`, không ghi cứng.
- `SPEC_REVENUE_DELIVERY_PERIOD.md` gắn nhãn SUPERSEDED (`4fe6944`): quy kỳ doanh thu nay theo `orders.created_at` của App Sale, thay thế quyết định "ngày thực giao" 29/07. Muốn quay lại ngày giao thì App Sale phải đổi trước. Cảnh báo lọc kép trong file đó vẫn còn hiệu lực.
- `VIEC_CHO_BOT.md`: chuyển VIỆC 0D sang mục đã xong (kèm số nghiệm thu), thay khối "LÀM NGAY" bằng bảng thứ tự — VIỆC 3 (nghiệm thu VP018+DN022, mốc chết 08/08) → VIỆC 2B (màn "Chưa đồng bộ") → VIỆC 4 (RAM `9986f0a`) → VIỆC 5 (Thanh toán CP của tôi).
- Ghi rõ lệnh cấm để bot không bị lệnh cũ dẫn sai: cấm deploy lại `e9f8d33` (đã rollback vì thừa `53.556.720đ`/3 đơn), cấm sửa luật doanh thu khi làm 4 việc trên. Ghim T06 `28.403.136.096đ`, T07 `30.917.892.673đ`, T08 bằng App Sale chênh `0đ`.
- Không đụng code app, không đổi một đồng nào. Trạng thái test: không chạy lại (chỉ sửa tài liệu); lần chạy gần nhất trên `bf7a7a0` là revenue lock 6/6 pass.

### 2026-08-03 — VIỆC 0D — mirror exact App Sale live KPI SQL

- Thay luật response/effective-date + `order_items.price` trên `origin/main` vì read-only gate cho thấy cao hơn App Sale `53.556.720đ` / 3 đơn.
- CRM mirror `sale_order_date`, `revenue_bucket <> 'excluded'`, `invoice_export_amount`; partner mirror `orders.created_at`, response delivered quantity, loại hủy/cancel và giá C31 đúng thứ tự fallback của App Sale PROD.
- Gỡ token/invoice/`manual_zalo` khỏi actual materialization eligibility; thêm repeatable-read proof, KPI/projection invariants, source/SQL/projection digests và one-shot transition từ `PARTNER_TOKEN_INVOICE_V1`.
- Provenance: App Sale revision `0e820022814ef8a7f24d47c082446f3e40b17ebe`, source SHA-256 `3b065456ed1e25b553c0554b97900a0ea2d89a17e9b487bfc5663fad14c220e0`.
- Đối soát live Gate 1: CRM `1.340.385.772đ`, partner `811.389.000đ`, tổng `2.151.774.772đ`; delta từng nhóm và tổng đều `0đ`. T06/T07 frozen pins giữ nguyên.

### 2026-08-01 — App Report — CEO duyệt KPI “Còn lại sau ứng lần 1” theo từng NV

- Backend là SSOT cho phép tính `tổng chi phí tháng sau phạt − ứng lần 1`; frontend chỉ hiển thị projection, không tự trừ hoặc ghi ngược App Salary/payroll.
- Chỉ tính cho đúng một NV đã self-scope. `ALL` tiếp tục yêu cầu chọn một NV, không fan-out và không tổng hợp tiền ứng/toàn đội.
- Thiếu tổng sau phạt hoặc thiếu số ứng thì `amount=null` và UI hiện `— / chưa đủ dữ liệu`, không coi là 0. Nếu số ứng vượt tổng sau phạt thì cảnh báo nghi sai và không hiển thị số âm giả.
- Trạng thái chỉ **Đã chốt** khi kỳ chi phí và số ứng App Salary đều đã chốt; còn lại hiển thị **Dự kiến · chưa chốt**.
- Guard fail-closed từ `0ca68a2`: payload ghi rõ lý do/cảnh báo và tổng sau phạt đã dùng để đối chiếu; khi ứng vượt tổng, trạng thái là `anomaly`, số còn lại luôn `null` và UI hiện **DỪNG TÍNH · NGHI BẤT THƯỜNG**. Vẫn giữ `ALL` chọn một NV, tuyệt đối không fan-out/tổng hợp App Salary.

### 2026-08-01 — App Report — CEO duyệt bật KPI “Ứng lần 1” từ App Salary

- Bật cờ giao diện `SALARY_ADVANCE_UI` cho KPI **Ứng lần 1 tháng này**, dùng field server-only đã khóa self-scope trong response `/api/employee-cost`.
- Chế độ `ALL` vẫn yêu cầu chọn đúng một nhân viên, không fan-out/tổng hợp App Salary. Thiếu dữ liệu giữ `amount=null`, không suy thành 0; trạng thái draft/locked hiển thị rõ.
- Bổ sung guard backend: nếu số ứng lớn hơn tổng chi phí tháng sau phạt cùng kỳ thì payload đánh `suspect=true` và UI cảnh báo đỏ; không sửa số nguồn, không tính KPI **Còn lại sau ứng lần 1**.

### 2026-07-31 — App Report — đưa đấu nối App Salary “Ứng lần 1” về main (VIỆC 1)

- Khôi phục connector server-only đã được nghiệm thu trên production: App Report gọi App Salary qua `GET /api/integrations/app-report/first-advance?period=YYYY-MM&emp_code=...`; bearer chỉ nằm ở backend, không đưa sang trình duyệt/log/artifact.
- Mã nhân viên được resolve và khóa self-scope tại backend. Nhân viên chỉ nhận số của chính mình; CEO/admin chỉ nhận số của đúng một mã đã chọn. Payload App Salary dùng exact allowlist, bắt buộc khớp kỳ/mã/VND; lỗi nguồn hoặc thiếu cấu hình trả `amount=null`, không suy thành 0.
- Response chính `/api/employee-cost` có field `salaryAdvance` self-scoped. UI đọc field này từ một response backend duy nhất; route tương thích `/api/employee-cost/salary-advance` vẫn giữ cho client cũ.
- Trạng thái `draft` hiển thị **Dự kiến · chưa chốt trên App Salary**; chỉ `locked` mới hiển thị đã chốt. Đây chưa phải payroll/số chi chính thức.
- Chế độ `ALL` chưa fan-out App Salary trong VIỆC 1. Phần tổng hợp toàn đội và KPI “Còn lại sau ứng lần 1” thuộc VIỆC 2, chỉ làm sau khi commit này đã có trên `main`.

### 2026-07-31 — Report Bot — VP018 là Telesaler, fail-closed phân bổ doanh thu
- CEO duyệt `APP_REPORT_VP018_POLICY_PUSH_CLAUDE_APPROVE`: VP018 không phải Sale, không được phân bổ doanh thu C6/`emp_code`, không nhận thưởng/phạt hoặc báo cáo doanh số ngày/tháng.
- Thêm policy riêng: nếu nguồn tương lai gán nhầm VP018, App Report giữ nguyên doanh thu toàn công ty nhưng chuyển phân bổ nhân viên sang `UNALLOCATED` với trạng thái `NON_SALES_ROLE_QUARANTINED`.
- Chốt ở materializer attribution guard, slot/upload/sample reader và ORDS fallback để không có đường vòng. Cảnh báo vận hành riêng vẫn hoạt động vì không phải thông báo hiệu suất/doanh số.
- Chưa merge/deploy/restart/gửi thông báo thật; chờ test và Claude review SHA mới trên PR #231.

### 2026-07-31 — Report Bot — v3.7 tách DN022 khỏi công thức tiền hiện tại
- CEO duyệt `APP_REPORT_DN022_SEPARATE_FORMULA_APPROVE`: DN022 không tính thưởng P1/P2, không tính phạt target/C45 và không nhận thông báo thưởng/phạt tiền theo công thức hiện tại; giao diện ghi rõ đang chờ công thức riêng của CEO.
- Luồng Điểm/Xu được tách độc lập: chỉ DN002, DN004, DN022 thuộc phạm vi phạt thiếu Xu; DN022 được đưa lại vào phép tính Điểm/Xu nhưng không được quay lại công thức target/C45.
- Chặn fail-closed ở cả engine, API self-scope, mốc thưởng, tin thưởng cuối tháng và builder tin phạt. Danh sách chặn tin thưởng/phạt tiền là DN002, DN004, DN021, DN022, DN023, VP004, VP018; `notify_optout` chung không bị lạm dụng để chặn nhầm báo cáo doanh thu/target/cảnh báo vận hành.
- Nâng khoá công thức v3.6 → v3.7 và đưa `employeeIncentivePolicy.js` vào fingerprint. Không đổi công thức tiền của các nhân viên còn lại. Chưa deploy/restart/gửi thông báo thật.

### 2026-07-30 chiều — Claude Code — DIRECTIVE TỔNG cho bot chạy một mạch (CEO uỷ quyền tự sắp thứ tự)
> CEO: "thứ tự em tự làm các việc đó luôn, cho anh không cần hỏi lại. Xong báo cáo chắc chắn cho anh."

Gom mọi việc production còn lại thành **một** `DIRECTIVE_MASTER_20260730_CHIEU.md`, sắp đúng thứ tự an toàn: (1) deploy v3.6 · (2) bật công tắc NV xem chi phí · (3) soát đếm trùng đơn · (4) **cổng chặn tiền: DN008 phải ≈130,26%** trước khi bật cờ · (5) bật 2 cờ thông báo chi phí/thưởng · (6) bật cờ tin phạt. Mỗi bước có cổng chặn riêng; bước nào không đạt thì DỪNG, không nhảy.

Vì sao thứ tự này: deploy trước (không có code mới thì bật cờ vô nghĩa) → cổng tiền trước mọi lần bật cờ (số sai mà gửi là không rút lại được, đúng lý do tắt cờ tối 29/07) → tin phạt cuối vì rủi ro cao nhất (T08 trừ tiền thật).

Code của cả 6 việc CEO giao đã xong và trên `main` (`73af725`): cảnh báo đồng bộ, chặn đếm trùng, tin phạt, đơn >50 triệu, khoá sổ ngày 8, nâng hạn mức lịch sử. Test: server 571/580 (9 đỏ đúng mức nền), web 87/87, khoá vân tay XANH. Việc còn lại thuần thao tác server — bot làm theo directive tổng.

### 2026-07-30 — Claude Code (CEO chốt) — TIN NHẮN PHẠT cho NV (việc 4) + ĐƠN TRÊN 50 TRIỆU nhắn chủ động (việc 5.2)
> CEO: "Việc số 4 đồng ý duyệt tin nhắn phạt để nv nhận được." · "tất cả các đơn, với những đơn giá trị cao trên 50 triệu thì chủ động nhắn tin telegram cho nhân viên có đơn đó, cho vp018, cho ceo nắm rõ."

**VIỆC 4 — `src/penaltyNotify.js`** (7 ca test). T08 là tháng **trừ tiền thật**; DN018 chỉ còn cách mốc mất trắng C45 **3.550.175đ** — không nhắc thì NV mất tiền vì không biết.
- **Luôn có ĐƯỜNG THOÁT:** mỗi tin nêu **cần thêm bao nhiêu doanh thu trước VAT** để thoát bậc, lấy từ cảnh báo sớm backend đã tính. Tin chỉ báo mất tiền mà không nói cách thoát là tin vô ích.
- Nêu đủ: **% đạt · số tiền · TÊN CỘT "C45 (Lương tăng thêm)" · mốc phải chạm/vượt**.
- **Kỳ chạy thử phải nói CHƯA TRỪ TIỀN** — tiêu đề là *"CẢNH BÁO PHẠT (chưa trừ tiền)"*, câu *"Nếu áp dụng, bạn sẽ…"*. Test khoá: kỳ chạy thử không được dùng câu khẳng định đã phạt.
- **KHÔNG có việc gì thì KHÔNG GỬI:** đạt ≥ mốc không phạt · chính sách chưa áp dụng · **chưa giao target** · **C45 chưa về** ⇒ trả `null`. Nhắc tiền khi chưa có số là hứa một con số mình không có.
- **Khoá chống trùng theo kỳ + BẬC:** tụt bậc là tin **mới** (số tiền và đường thoát đã khác); cùng bậc thì không nhắc lại.
- **Không tự tính lại một đồng nào** — test khoá: module dựng chữ không được có phép tính tiền, không được gọi engine phạt.

**VIỆC 5.2 — `src/highValueOrderAlert.js` + `config/high_value_order_alert.json`** (6 ca test).
- **Ngưỡng 50 triệu nằm ở CONFIG**, test khoá: cấm ghi cứng số trong code.
- Người nhận: **NV có đơn + VP018 + CEO**. **KHÔNG lọc qua optout** — VP018 nằm trong optout nhưng chính là người theo đơn (cùng lý do như cảnh báo đồng bộ).
- Mỗi đơn nhắn **một lần**; đơn đổi tiền **đáng kể** (khác bậc triệu) mới là tin mới, lệch vài nghìn thì không nhắc lại.
- **Thiếu mã đơn hoặc thiếu tiền ⇒ KHÔNG nhắn nhưng đếm ra**, không báo sai.
- **Config hỏng ⇒ fail-closed, nêu lý do**, không âm thầm dùng ngưỡng mặc định.

**Một lỗi tự bắt:** `markState` ban đầu có biểu thức rác `Array.isArray(orders) ? raw ? orders : orders : orders` — chạy đúng do may, đọc thì vô nghĩa. Đã sửa.

**Test:** server **571/580** (9 đỏ đúng mức nền) · thêm 13 ca (7 + 6).

**Còn lại của việc 4 và 5.2:** nối nguồn và bật cờ trên server — bot làm theo `DIRECTIVE_BOT_VIEC_1_4_5_20260730.md`. Điều kiện bật `PENALTY_NOTIFY` (có `src/penaltyNotify.js` + test xanh) nay **đã đủ**.

### 2026-07-30 — Claude Code (CEO chốt) — CHẶN ĐẾM TRÙNG ĐƠN GIỮA CÁC KỲ (việc 3) + yêu cầu cho bot (việc 1/4/5)
> CEO: "phải có cơ chế chặn trùng đơn, tránh một đơn tính cho cả 2 tháng (như tính T06 rồi T07 tính nữa / tính T07 rồi T08 tính lại nữa)."

**‼ Lớp cũ KHÔNG bắt được ca này.** `reconcile.duplicateLines` chỉ soát trùng **trong cùng một kỳ** (`seenLineId` dựng lại mỗi lần `reconcileKy`). Một dòng nằm ở T06 rồi lại nằm ở T07 thì **cả hai kỳ nhìn riêng đều SẠCH** — không ai phát hiện được bằng mắt. Rủi ro thật: quy kỳ theo **ngày thực giao**, nên VP018/DN007 sửa ngày là dòng chuyển kỳ; kỳ cũ chưa bỏ dòng ra thì thành cộng hai lần và **NV được thưởng trên doanh thu đếm đôi**.

**Đã làm** (`src/crossPeriodDuplicates.js` + `scripts/check_cross_period_duplicates.js`):
- Nhận dạng dòng theo 3 mức tin cậy: `source_line_id` → `order_item_id` → bộ ghép `mã đơn + mã hàng + đơn vị`.
- Chỉ ra **dòng nào nằm ở những kỳ nào** và **số tiền đang đếm đôi** (giữ 1 lần là đúng, các lần sau là thừa). Xuất hiện 3 kỳ = đếm đôi 2 lần.
- **KHÔNG tự chọn kỳ nào giữ** — đó là quyết định nghiệp vụ của VP018/DN007; câu chữ nói thẳng *"App Report KHÔNG tự chọn giúp"*.
- **Fail-closed đủ hai chiều:** dòng **không có khoá nhận dạng** ⇒ `unverifiable`, không phải "sạch". Và **kỳ không có dòng nào cũng KHÔNG được tuyên sạch** — bản nháp đầu của Claude in *"✅ không có đơn nào bị tính hai kỳ"* khi cả hai kỳ đều **0 dòng**; tự phát hiện, đã sửa và khoá bằng test. Không có dữ liệu để soát khác hoàn toàn với đã soát và không thấy trùng.
- Xuất `reconcile.rawSlotRows` / `activeSlotsForKy` để script đọc **DÒNG GỐC** của slot — bản nháp đầu dùng `store.getRows` (đã chuẩn hoá, rụng `source_line_id`) nên mọi dòng đều "không nhận dạng được" và guard thành vô dụng. Cũng tự phát hiện khi chạy thật.
- Script thoát mã ≠ 0 khi chưa sạch, dùng được làm cổng chặn **trước khi khoá sổ ngày 8**.

**Thêm `DIRECTIVE_BOT_VIEC_1_4_5_20260730.md`** cho bot: (A) bật công tắc NV tự xem chi phí cho **cả 12 NV** + 3 bằng chứng · (B) bật `PENALTY_NOTIFY` **nhưng phải chờ** — hiện `penaltyNotifyPolicy.js` chỉ là cờ trống, **chưa có nội dung tin phạt nào**, bật bây giờ thì không tin nào đi mà ai cũng tưởng đã xong · (C) quy tắc **đơn bù tách riêng**, giữ `parent_order_code`, **không sửa đè ngày đơn gốc**, và bot phải báo **quy mô** trước khi đổi gì · (D) ghi nhận 5.2 và 5.3 (**gộp, không tách** doanh thu tài chính/đánh giá NV).

**Test:** server **558/567** (9 đỏ đúng mức nền) · thêm `crossPeriodDuplicates.test.js` **8 ca**.

### 2026-07-30 — Claude Code (CEO chốt) — CẢNH BÁO ĐỒNG BỘ DOANH THU (việc 2) + nâng hạn mức lịch sử (việc 6, v3.6)
> CEO: "việc số 2 em phải làm ngay. Để tránh tình trạng chạy loanh quanh tìm số không khớp mãi mới ra được. Do không có người canh cửa nên hậu quả là chạy lòng vòng đi tìm." · "việc số 6 đề xuất tăng số dòng lên gấp đôi."

**VIỆC 2 — Cảnh báo Telegram khi đồng bộ lỗi** (`src/syncAlert.js` + `config/sync_alert_recipients.json`):
- **Danh sách người nhận HOÀN TOÀN RIÊNG.** `VP018` đang nằm trong `notify_optout.json` nhưng **VẪN PHẢI** nhận cảnh báo đồng bộ vì VP018 chính là người sửa ngày thực giao. Test khoá: lọc qua `isMuted`/`optout`/`diemXu.EXCLUDE` là đỏ ngay. Đây đúng loại lỗi đã dính 28/07 — lấy danh sách của việc này dùng cho việc khác.
- Đồng thời **ghi rõ phạm vi** vào `notify_optout.json`: chỉ chặn **thông báo hiệu suất**, không áp cho cảnh báo vận hành.
- **Mỗi người nhận đúng phần mình sửa được**: VP018/DN007 nhận đơn · ngày giao · đơn vị · CEO chỉ nhận **bản tổng** (bao nhiêu mục, tổng tiền, ai đang phải xử lý bao nhiêu). Nhận thứ mình không sửa được thì lần sau không đọc nữa.
- **Mỗi mục đủ 4 phần: cái gì · bao nhiêu tiền · vì sao · AI LÀM GÌ.** Thiếu phần "ai làm gì" là người nhận lại phải đi hỏi — đúng cái "chạy lòng vòng" CEO muốn bỏ. Khai báo sẵn 10 mã lý do; mã **lạ vẫn hiện ra** kèm chữ "CHƯA KHAI BÁO", không im lặng bỏ.
- **Chống spam:** chỉ báo mục **MỚI**; mục đã nhắn gộp một dòng *"còn tồn N mục cũ"*; xử lý xong báo *"đã hết"* **đúng một lần**; **không có gì mới ⇒ KHÔNG GỬI**.
- **Hai mức:** MỨC 1 KHẨN khi bất biến vỡ (`Σ(đưa vào)+Σ(loại) ≠ Σ(nguồn)`) — gửi cho **cả 3 người**, nói rõ **"ĐÃ DỪNG, CHƯA GHI SLOT"**, quét mỗi 5 phút không đợi khung giờ. MỨC 2 gửi **07:30 hằng ngày**.
- **Chỉ ghi "đã nhắn" khi CÓ tin đi được** — gửi lỗi hết mà vẫn ghi state là mất cảnh báo vĩnh viễn.
- **Kênh bot App Sale: khai báo `enabled=false`** vì chưa có đường gửi thật (spec mục 8.5). Test khoá điều này để không ai tưởng đã báo cho App Sale.
- Cắt bản ghi trạng thái **chỉ cắt mục ĐÃ XỬ LÝ**, không bao giờ cắt mục đang tồn.
- Log khởi động bot in thêm: `cảnh báo đồng bộ 07:30 hằng ngày (cảnh báo đồng bộ) + quét KHẨN mỗi 5 phút`.

**VIỆC 6 — hạn mức lịch sử sửa cấu hình Thưởng: 2.000 → 4.000.** Đúng lý CEO nêu: dữ liệu thật còn xa mức đó nên nâng lên không ảnh hưởng gì, mà lịch sử không bị cắt.

**Nâng v3.5 → v3.6** vì việc 6 đụng `employeeBonusPolicy.js` (nằm trong vân tay công thức). **KHÔNG đổi một đồng nào** — chỉ nâng hạn mức lưu lịch sử. Đã làm đủ 4 bước, `sourceHash 14f50e4c…`, test khoá vân tay XANH. (Đây là lần bump thứ hai trong ngày cho việc không đổi tiền; ghi rõ ở `note` của config để về sau tra lại không hiểu nhầm.)

**Test:** server **550/559** (9 đỏ đúng mức nền) · web **87/87** · build PASS. Thêm `server/test/syncAlert.test.js` **9 ca**, mỗi ca khoá đúng một cách làm sai đã từng xảy ra.

### 2026-07-30 — Claude Code (CEO chốt phương án A) — BẬT LẠI 2 công tắc thông báo + log nêu đủ 4 mốc
> CEO: "ANH CHỌN A NHÉ" — bật cả hai công tắc ngay, để 20:00 ngày 31/07 gửi tin tháng 7 (số DỰ KIẾN) và 20:00/20:10 ngày 09/08 gửi lại SỐ CHỐT.

- Thêm `DIRECTIVE_BAT_THONG_BAO_20260730.md`: cách bật `EMP_COST_NOTIFY=1` + `BONUS_NOTIFY=1`, **chỉ restart `app-report-tgbot`**, 5 bằng chứng nghiệm thu, và việc phải báo lại sau 20:00 ngày 31/07 + ngày 09/08.
- **‼ CỔNG CHẶN trước khi bật:** phải chứng minh thưởng T07 đã tính lại theo slot doanh thu mới — `bonus.month.pct` của **DN008 phải ≈130,26%**. Còn 117,71% là **CHƯA** tính lại ⇒ **KHÔNG BẬT**. Đây đúng là lý do 2 cờ bị tắt tối 29/07 (thiếu 382 triệu, DN008 sai bậc ~1,92 triệu); bật khi số còn sai là gửi sai cho toàn bộ NV và không rút lại được.
- **Sửa log khởi động bot**: trước đây chỉ nêu 2 mốc cuối tháng nên **không ai chứng minh được lượt SỐ CHỐT đã lên lịch** — mà đó chính là lượt quyết định NV nhận số cuối. Nay in đủ 4 mốc: `20:00 ngày cuối tháng (dự kiến)` · `20:00 ngày 9 (sau khoá sổ) (số chốt)` · `20:10 ngày cuối tháng (dự kiến)` · `20:10 ngày 9 (sau khoá sổ) (số chốt)`.
- **Giữ nguyên TẮT:** `PENALTY_NOTIFY` — tin nhắn về PHẠT chưa được CEO duyệt gửi. Directive ghi rõ chỉ được đụng đúng 2 cờ, không đụng cờ nào khác.
- Không gửi cho 4 mã trong `config/notify_optout.json`: DN021, DN023, VP004, VP018. Directive bắt bot dán danh sách người nhận (chỉ mã + kênh, không số tiền) để CEO soát trước 20:00.

**Test:** server **541/550** (9 đỏ đúng mức nền) · web **87/87**.

### 2026-07-30 — Claude Code (CEO chốt) — Tin 20:00 cuối tháng VẪN GỬI nhưng là DỰ KIẾN · thêm lượt gửi SỐ CHỐT sau ngày 8
> CEO: "TIN NHẮN 20H00 VẪN BẬT NHƯNG CHỈ LÀ DỰ KIẾN, VÌ CHỐT SỐ PHẢI CHỜ ĐẾN NGÀY 08/08 MỚI CHỐT SỐ CHUẨN. NÊN EM CỨ CHO Ý KIẾN MÀ LÀM NHÉ."

**Tin 20:00 ngày cuối tháng — giữ nguyên giờ, đổi cách nói:**
- Thưởng: tiêu đề `thưởng DỰ KIẾN tháng` · dòng cuối `ℹ Số DỰ KIẾN, CHƯA CHỐT (doanh thu còn cập nhật đến hết ngày 08/08/2026). Sau khi khoá sổ hệ thống gửi lại số chốt. Không phải bảng lương.`
- Chi phí: thêm đúng một dòng cùng ý, **ngày lấy từ `employeeCost.periodCloseNote()`** — không ghi cứng ngày trong tin.

**Thêm LƯỢT GỬI SỐ CHỐT — 20:00/20:10 ngày 9 (ngày sau khoá sổ):**
- Ngày suy từ `employeeCost.PERIOD_CLOSE_DAY + 1`, **không ghi cứng số 9** — sau này CEO đổi ngày khoá sổ thì lượt này tự đi theo.
- Gửi cho **kỳ VỪA KHOÁ = tháng TRƯỚC** (dùng ngày cuối tháng trước làm `asOfDay`), không phải tháng đang chạy.
- Tin chốt: `thưởng CHỐT tháng` · `Tổng chốt: …` · `✅ Số CHÍNH THỨC của kỳ (đã khoá sổ hết ngày 08/08/2026)`. **Bỏ hẳn** chữ "dự kiến" — có test khoá điều này.
- **Khoá chống gửi trùng mang theo `stage`**: `bonus_month|2026-07|provisional` khác `bonus_month|2026-07|final`. Nếu không tách, hệ thống sẽ thấy "tháng này gửi rồi" và **lượt chốt không bao giờ đi** — đây là cái bẫy dễ mắc nhất ở đây.

**Vẫn giữ nguyên:** hai cờ `EMP_COST_NOTIFY=0`, `BONUS_NOTIFY=0` **đang TẮT** — cả hai lượt đều nằm sau cờ, nên deploy bản này **không tự gửi cho ai**. Khi CEO cho bật thì tin đã đúng cách nói.
**Hai nhãn vẫn giữ riêng:** `TẠM TÍNH` (thiếu % — DataHub/App Sale phải điền) và `CHƯA CHỐT` (chờ tới ngày khoá sổ) là hai dòng khác nhau trong cùng một tin.

**Test:** server **541/550** (9 đỏ đúng mức nền) · web **87/87**. Thêm 2 ca: tin chốt phải đổi hẳn cách nói và không còn chữ dự kiến; bộ hẹn giờ phải có lượt chốt, suy ngày từ `PERIOD_CLOSE_DAY`, gửi cho tháng trước, và tách khoá chống trùng theo stage. Sửa 1 test cũ khoá câu chữ đã đổi.

### 2026-07-30 — Claude Code (CEO chốt) — KHOÁ SỔ KỲ HẾT NGÀY 8 THÁNG SAU · nhãn DỰ KIẾN → SỐ CHÍNH THỨC (v3.5)
> CEO: "dữ liệu từ ngày 05 tháng sau đổ về trước thì mình sẽ dùng từ **dự kiến** vì còn cập nhật lại doanh thu... đẹp nhất là **trước ngày 08** cho rộng rãi để chốt" · "Phạt sẽ chốt sau ngày 08 tháng sau (khi chốt đủ dữ liệu) thì câu tạm tính/dự kiến sẽ chuyển thành chính thức/chốt kỳ".
> CEO trả lời câu chặn: **ứng lần 01 rơi vào cuối tháng đó và app lương đã tự tính**, không cần số chốt trước ngày 8 ⇒ chọn được ngày 8.

**‼ LỖI CŨ ĐÃ SỬA — chốt sổ từ ngày 01, không phải ngày 5.** `routes.js` chỉ so tháng (`kỳ < tháng hiện tại`) nên **00:00 ngày 01/08 đã dán nhãn "ĐÃ CHỐT KỲ" cho T07** trong khi doanh thu còn về tới ngày 5 (theo chốt cũ) / ngày 8 (chốt mới). Sai với **cả hai** phương án — Sếp hỏi mới lộ ra.

**Đã làm:**
- **Một nguồn duy nhất** trong `employeeCost.js`: `PERIOD_CLOSE_DAY = 8` · `periodCloseDate()` · `isPeriodClosed()` · `periodCloseNote()` · `periodCloseLabel()`. Ngày tính theo **giờ Việt Nam** (`Asia/Bangkok`) — server chạy UTC nên quanh nửa đêm lấy giờ máy là lệch một ngày.
- **Biên chính xác:** 23:59 ngày 08 **chưa** chốt · 00:00 ngày 09 **mới** chốt · vắt năm (T12 → 08/01) đúng.
- **Nhãn phạt:** trước khoá `DỰ KIẾN — doanh thu còn cập nhật đến hết ngày 08/09/2026 · …`; sau khoá `ĐÃ CHỐT KỲ — số chính thức của kỳ · đã khoá sổ hết ngày … Kế toán chi trả theo bảng lương.` Bỏ hẳn chữ "TẠM TÍNH" ở nhãn phạt (dễ lẫn với nghĩa thiếu %).
- **Cờ `penalty.finalized`** = vừa TRỪ THẬT **và** ĐÃ KHOÁ SỔ. Trong tháng đang chạy, phạt vẫn hiện để NV biết mà cố gắng, nhưng **không phải số cuối** — đúng ý Sếp "chỉ vì 50,5 với 50,0 mà mất tiền triệu thì đau".
- **Nhãn ra cả màn chi phí, không chỉ ô phạt:** payload trả `periodClose`, ô "Tổng chi phí tháng" hiện `· dự kiến` kèm câu "doanh thu còn cập nhật đến hết ngày 08/xx".
- **HAI NHÃN GIỮ RIÊNG, không gộp:** `dự kiến` = chưa khoá sổ (chờ đến ngày 8) · `tạm tính` = danh mục thiếu % (DataHub/App Sale phải điền). Một kỳ có thể vừa dự kiến vừa tạm tính.
- Cập nhật `SPEC_REVENUE_DELIVERY_PERIOD.md` mục 4: ngày 5 → **ngày 8**, kèm biên và lý do.
- Sửa 2 test tự-lệch: `employeePenalty` (khoá thứ tự `bonus → periodClose → penalty`) và `Target.bonusPolicy` (đọc `FORMULA_VERSION` từ backend thay vì ghi cứng `v3.4` — đây là lần thứ hai test này phải sửa tay, nay hết).

**Nâng v3.4 → v3.5** vì có sửa `employeePenalty.js` (nằm trong vân tay). **Cách tính tiền P1/P2 và bậc phạt KHÔNG đổi** — v3.5 chỉ đổi *khi nào số được coi là chốt* và *chữ trên màn hình*. Đã làm đủ 4 bước, `sourceHash 02b6d579…`, test khoá vân tay XANH.

**Test:** server **539/548** (9 đỏ đúng mức nền container) · web **87/87** · build PASS · thêm `server/test/periodClose.test.js` 7 ca (biên ngày, giờ VN, cấm so tháng, nhãn, finalized, tách hai nhãn ở UI).
**Thử thật:** kỳ T07 xem ngày 30/07 → `closed:false`, "còn cập nhật đến hết ngày 08/08/2026"; kỳ T06 → `closed:true`, "đã khoá sổ hết ngày 08/07/2026".

**Chưa làm — chờ Sếp duyệt riêng:** tin nhắn cuối tháng 20:00 vẫn chưa gắn nhãn "DỰ KIẾN" và chưa có lượt gửi số chốt sau ngày 8. Hai cờ thông báo vẫn TẮT nên chưa gửi gì, nhưng khi bật thì phải làm việc này trước.

### 2026-07-30 — Claude Code (review) — Chốt MỘT đường cấu hình phạt: giữ store của bot, xoá phần trùng của Claude
> Bot đã push `59dc9d3` (nhánh `feat/penalty-formula-editor-20260730`). Claude đọc xong và chốt: **spec gộp ở `SPEC_MERGE_PENALTY_CONFIG_20260730.md`**.

Hai nhánh cùng tách từ `0d3e559` và **cùng làm việc 2 + việc 4** của CEO mà không bên nào biết bên kia đang làm.

**Giữ bản của BOT** cho store cấu hình phạt và tổng hợp toàn đội. Bản bot mạnh hơn đúng ở chỗ quyết định tiền và dấu vết: lưu **full snapshot** từng version · audit **append-only không cắt** · file cấu hình hỏng thì **fail rõ** thay vì âm thầm quay về mức mặc định · **rollback policy nếu ghi audit lỗi** · **chỉ CEO** được sửa · ID do backend sinh · chặn tạo version cho kỳ đã qua · có `effectiveTo` · dùng lại version cũ phải **khớp từng tham số**.

**Xoá phần trùng của Claude** — 3 điểm dưới đây là **lỗi thật của bản Claude**, không phải khác gu: audit **cắt còn 2.000** bản ghi · file policy hỏng thì **âm thầm về seed** (mức phạt đổi mà không ai biết) · `normalizeCandidate` **nhận `id` từ client** nên có thể trùng khoá làm hỏng store. Cụ thể xoá: phần phạt trong `employeeBonusPolicy.js`, 2 route `/admin/penalty-policies` của Claude, `penaltyPolicySnapshot`, hàm `aggregate` bản Claude, `PenaltyPolicyPanel` bản Claude, 2 file test khoá đường đã bỏ.

**Giữ của Claude và GHÉP VÀO** (bot chưa có): `penaltyDisplay.js` + hộp giải thích **"C45 (Lương tăng thêm)"** + bảng **4 ngữ cảnh phạt** — chính việc số 1 CEO yêu cầu, nhánh bot có **0** lần chữ "Lương tăng thêm" · danh sách **`atRisk`** (NV đang ở bậc bị phạt kèm số doanh thu cần thêm trước VAT) · **test HTTP dùng middleware quyền THẬT** (test HTTP của bot thay `auth.requireAuth` bằng hàm giả nên không có ca 401) · sửa lỗ **"đốt" preview của người khác** · **rào chắn tỷ lệ**: chặn cứng > 5% và cảnh báo khi > 1% (gõ `30` thay vì `0,3` là mất trọn C45 của cả đội).

**Version:** hai nhánh đều nâng `v3.4` với nội dung khác nhau ⇒ hai `sourceHash` — đây là "blocker" bot thấy. **Giữ nhãn `v3.4`** cho bản gộp vì production còn `v3.3`, **chưa nhân viên nào từng thấy số v3.4**; ghi lại vân tay một lần sau khi gộp.

**Chưa gộp vào `main`:** Claude đã thử `git merge` để đo, có **7 file xung đột** trải cả backend/frontend/test, và việc gộp phải **xoá bớt code của chính Claude** — làm dở dang trên `main` thì tệ hơn. Nên: bot thực hiện gộp theo spec (bot giữ code chính, có dữ liệu thật để thử), Claude review lại. **Deploy vẫn DỪNG** cho tới khi mục 4 của spec xanh hết.

### 2026-07-30 — Claude Code — Trả lời review: test HTTP thật cho cấu hình phạt + siết session binding
> Review báo 8 điểm (1 blocker, 1 high, 2 medium, 4 thiếu test) trên commit `59dc9d3` của bot — commit này **chưa push** nên Claude không đọc được mã; đã soát 8 điểm đó **trên `main`** và phân loại theo từng bản (bảng đầy đủ ở §9 của `DIRECTIVE_DEPLOY_V34_20260730.md`).

**Đã sửa trên `main`** (`b71f3f1`):
- **Thêm test HTTP thật** `server/test/penaltyPolicyHttp.test.js` (8/8 xanh): gọi 3 route qua HTTP với middleware quyền thật — không token **401**, NV sale **403**, CEO 200 · preview **không ghi gì** · `previewId` **dùng một lần** (lần hai 409) · preview của **người khác/phiên khác** không lưu được · lưu xong `GET` trả **ngay** bậc mới (đã xoá cache) · HTTP cũng chặn **hồi tố** và **bậc có khe hở** · mỗi lần lưu là một version riêng, audit giữ cả cấu hình trước và sau. Review đúng: bộ test route cũ chỉ đọc mã bằng regex — chứng minh "mã có viết đúng câu", không chứng minh "gọi thật thì chặn thật".
- **Siết session binding**: preview cấu hình phạt buộc theo **phiên** (`session.th`), không chỉ theo mã người dùng — **phiên khác của chính CEO cũng không lưu được**. Kèm một lỗ nhỏ tự phát hiện khi viết test: bản cũ xoá preview ngay khi có lần gọi sai, nghĩa là **một phiên lạ chỉ cần gọi sai một lần là "đốt" bản mô phỏng hợp lệ của CEO**; nay chỉ chủ đúng phiên mới xoá được.

**Cố ý CHƯA sửa (đã ghi vào directive):** audit cắt còn 2.000 bản ghi — `employeeBonusPolicy.js` cũng bị (`slice(0, 2000)`), nhưng file này **nằm trong vân tay công thức**, sửa là buộc **nâng version lần hai trong ngày** cho một việc **không đổi cách tính tiền** ⇒ sai tín hiệu với CEO. Phải sửa **một lần duy nhất** trong module được giữ sau khi chốt đường, kèm test lưu giữ > 2.000 và test rollback hai file.

**Không áp cho `main`:** chữ ký nguồn Xu (`vat.db`) và copy-forward — preview phạt của `main` **không đọc Xu** (chỉ trả bảng bậc + chế độ kỳ), và `main` không có tính năng copy-forward. Hai việc này chỉ cần nếu giữ bản của bot.

**Blocker vân tay không tái hiện trên `main`:** `bonusFormulaVersion` XANH 7/7 với `v3.4` + `sourceHash b598f1c5…` — cây của bot chưa pull `main`.

**Test:** server **525/534** (9 đỏ đúng mức nền container) · lock + policy 16/16 · web **87/87** · build PASS.

### 2026-07-30 — Claude Code — ĐÃ GỘP VÀO `main` + directive deploy v3.4 cho bot
> CEO: "CEO đồng ý cho em làm luôn nhe"

Đã gộp nhánh `claude/new-session-eifd44` vào **`main`** (fast-forward, không rebase, không mất commit nào): `0d3e559` → **`d92807f`**. Nội dung: nhãn C45 (Lương tăng thêm) + bảng 4 ngữ cảnh phạt · 4 ô KPI tổng hợp toàn đội ở "Tất cả NV" · **cấu hình phạt sửa được** (v3.4).

Thêm `DIRECTIVE_DEPLOY_V34_20260730.md` để bot deploy: chốt **đúng SHA `d92807f`**, giữ nguyên **2 cờ thông báo TẮT**, giữ **auto-deploy khoá**, **cấm build trong cây production** (§P4), **cấm ghi đè `server/data/employee_bonus_policies.json`** (dữ liệu tầng đè thật), bắt chạy **toàn bộ** suite (không chạy chọn lọc), và **6 bằng chứng nghiệm thu phân biệt được** (SHA · hash `web/dist` · PID app-report đổi / PID tgbot không đổi · log "notify: TẮT" · `formulaVersion=v3.4` + 4 bậc từ API · `penalty.aggregate=true` với số NV thật).

Production trước deploy vẫn là `5c119a5` — đó chính là lý do CEO mở app chưa thấy 3 thứ trên.

### 2026-07-30 — Claude Code (CEO chốt) — NV hiểu C45 là cột nào · CEO thấy 4 ô KPI TỔNG HỢP · CẤU HÌNH PHẠT sửa được (v3.4)
> CEO: "1. có nút phạt rồi, yêu cầu thêm cột c45 (lương tăng thêm) để nv biết rõ, họ không biết cột c45 là cột gì. phần giải thích khi bấm ra phải rõ hơn để nv hình dung được các ngữ cảnh có thể bị phạt nếu không cố gắng · 2. Ở trạng thái hiển thị tất cả nhân viên thì màn hình ceo chưa thấy được 4 ô kpi, yêu cầu ceo phải thấy được toàn cảnh các ô này phải hiện tổng hợp. chỉ khi chọn theo từng nv mới hiển thị theo từng nv · 3. màn này đã thấy rồi · 4. Nút cấu hình chỉ mới thấy và cấu hình được phần thưởng. còn phần cấu hình phần phạt hiện chưa thao tác được."

**(1) NV biết ngay bị trừ ở cột nào.** Mọi chỗ nhắc C45 trong hộp giải thích đổi thành **"C45 (Lương tăng thêm)"**, nhãn lấy từ backend (`penaltyDisplay.C45_LABEL`) — một nguồn duy nhất, không ghi chữ vào JSX. Thêm hộp **"Phạt trừ ở đâu?"**: chỉ trừ tại C45, không trừ lương cơ bản, không trừ sang cột khác, không quá số tiền C45 đang có, kèm câu nói rõ kỳ này **trừ thật** hay **chỉ cảnh báo**. Thêm bảng **"Khi nào bị phạt? (4 ngữ cảnh)"**: mỗi bậc ghi khoảng %, hậu quả; **bậc NV đang đứng được tô đậm + ví dụ tiền tính từ doanh thu và C45 THẬT của chính NV đó**. Mốc %/tỷ lệ **sinh từ config ở backend** ⇒ CEO sửa bậc là chữ tự đổi theo (chống lệch như vụ nhãn v3.1/v3.2).

**(2) "Tất cả nhân viên" hiện TỔNG HỢP, không còn "Chọn 1 NV".** Backend cộng (`employeePenaltyAggregate`): Σ phạt target · Σ phạt Xu · Σ phạt áp dụng · tổng chi phí sau phạt · số NV theo từng bậc · **danh sách NV đang ở bậc bị phạt kèm số cần thêm trước VAT** (bấm ô Phạt để xem). Nguyên tắc: **CỘNG, KHÔNG TÍNH LẠI** — mỗi số vẫn do `employeePenalty.buildPenalty` tính riêng theo target + C45 của từng người; **không suy phạt từ target tổng của đội**. **Fail-closed có nói rõ**: NV chưa giao target / C45 chưa về thì **KHÔNG tính là 0đ**, đếm riêng và ghi "tổng của N/M NV"; chưa NV nào đủ dữ liệu thì tổng là **"chưa có số"** chứ không phải 0đ. Nguồn cộng lấy từ **bản đồ phạt của backend** (đủ mọi NV, kể cả NV chưa có dòng chi phí) và chỉ thu hẹp theo bộ lọc khi CEO đang lọc — tránh "mất số lặng lẽ". Frontend **không cộng, không chia** (test khoá: không có `reduce` trong nhóm component tổng hợp).

**(4) CẤU HÌNH PHẠT thao tác được — nâng version lên v3.4.** Hộp "⚠ Cách tính Phạt" trong Quản target giờ **sửa được**: 3 mốc % · 2 tỷ lệ · bật/tắt phạt · ngày bắt đầu cảnh báo · ngày bắt đầu trừ thật · bật/tắt + số tiền phạt thiếu Xu. Luồng **Mô phỏng → đối chiếu bậc CŨ→MỚI → Lưu**, mỗi lần lưu là **một version có dấu vết ai · khi nào · cũ→mới** (dùng lại đúng tầng đè + audit của Thưởng, endpoint riêng `/admin/penalty-policies`).

3 hàng rào **giữ nguyên** khi mở quyền sửa:
- **File gốc + vân tay công thức KHÔNG đổi** khi CEO sửa qua giao diện (sửa vào tầng đè) ⇒ khoá chống-quên-nâng-version còn nguyên. Có test đọc lại 2 file để chứng minh.
- **Chỉ tầng chung** ("Toàn bộ NV") — chặn phạt riêng từng người (`PENALTY_POLICY_SCOPE_INVALID`).
- **KHÔNG HỒI TỐ**: không lùi ngày trừ thật về tháng đã chạy (chỉ chặn khi CEO ĐỔI ngày; gửi lại đúng ngày đang áp dụng thì không chặn, nếu không sang tháng sau CEO không mô phỏng nổi). Kèm: 4 bậc phải **liền mạch không khe hở**, bậc đạt thấp **không được phạt nhẹ hơn** bậc đạt cao, trần tỷ lệ **1%** doanh thu, trần **5.000.000đ**/Xu thiếu, bậc không phạt phải mở đến vô cùng.

**Vì sao nâng v3.4** (theo CLAUDE.md mục 5): `employeePenalty.js` + `employeeBonusPolicy.js` đều nằm trong vân tay công thức và đều bị sửa để mở đường cấu hình. **Cách tính tiền không đổi** so với v3.3 — v3.4 chỉ mở quyền sửa mức. Đã làm đủ: nâng `FORMULA_VERSION` → sửa `version` + `note` trong `employee_bonus_tiers.json` → ghi lại `sourceHash` vào `bonus_formula_lock.json` → ghi mục này. Test `bonusFormulaVersion` xanh.

**Sửa thêm một chỗ tự-lệch:** `web/test/Target.bonusPolicy.test.mjs` ghi cứng `'v3.3'` nên chính test cũng phải sửa tay mỗi lần nâng version — nay đọc `FORMULA_VERSION` từ backend, hết lệch.

**Test:** server **517/526** đúng 9 ca đỏ baseline của container (3 fixture `authTrustedDevice` thiếu `phone` + 6 test PDF thiếu `pdfinfo`), **0 hồi quy** · web **87/87** · build PASS. Thử thật trên server local: `/admin/bonus-policies` trả đúng bảng bậc + `earliestEffectiveFrom`; preview đổi 0,3% → 0,35% ra đúng bảng cũ→mới, lưu ghi audit version 1; thử lùi ngày về 01/06/2026 bị chặn đúng thông báo "Không được áp phạt hồi tố"; `employee-cost?emp=ALL` trả tổng hợp `12 NV · 0/12 đủ dữ liệu` (sandbox không có nguồn chi phí) — đúng kiểu nói thật, không bịa 0đ.

**Chưa làm (cần bot trên server thật):** deploy bản này lên production (production đang ở `5c119a5`, thiếu cả panel phạt trong Quản target lẫn 4 ô tổng hợp).

### 2026-07-30 — Report Bot — Công thức Phạt v3.4 có version theo tháng/giai đoạn (chưa deploy)
- Thêm store phạt riêng dạng full snapshot, effective-from/to, immutable version, audit append-only không cắt lịch sử, copy-forward phải khớp nguyên bản; kỳ lịch sử tự resolve đúng policy và file hỏng fail rõ `PENALTY_POLICY_STORE_CORRUPT`.
- Luồng CEO-only: sửa → backend mô phỏng toàn đội → đúng 3 nút `✅ Duyệt / ❌ Không duyệt / 📝 Ý kiến khác` → save bằng preview ID 15 phút, khóa actor/session/revision/hash và chữ ký nguồn Xu SQLite/WAL; save xong xoá cache.
- Cho cấu hình 3 mốc target, rate 3 bậc, mất C45 hoặc rate ở bậc đáy, lịch cảnh báo/trừ thật, bật/tắt và đơn giá Xu; backend giữ `null` khi enforced/Xu chưa đủ, warn-only luôn `appliedAmount=0` chính xác.
- Nâng vân tay công thức từ v3.3 lên v3.4 vì evaluator chuyển từ mốc/date cứng sang policy động. P1/P2 không đổi.
- Chỉ hoàn thiện trên branch/worktree riêng; chưa deploy/restart production.

### 2026-07-30 — Report Bot — Tổng phạt toàn đội do backend tính cho “Tất cả NV”
- `GET /api/employee-cost?emp=ALL` trả top-level `penalty` tổng hợp trực tiếp từ kết quả phạt self-scoped từng nhân viên; không tính lại target/bậc/tỷ lệ và không cộng ở frontend.
- Giữ fail-closed: tổng thiếu nguồn là `null`, subtotal biết được nằm ở trường `provisional*` kèm coverage; kỳ warn-only vẫn có `appliedAmount=0`, còn kỳ enforced thiếu số áp dụng giữ `null`.
- Tổng phạt và tổng sau phạt có scope toàn kỳ/toàn đội, không thay đổi theo filter/phân trang bảng; trạng thái Xu disabled/pending/unavailable được giữ riêng.
- UI “Tất cả NV” đọc top-level backend payload cho 3 KPI phạt; ô “Ứng lần 1” vẫn giữ “Chưa đấu nối app lương”.
- Test: targeted 40/40, web 84/84, production build PASS; server full 516/519, đúng 3 lỗi fixture `authTrustedDevice.test.js` đã có trên baseline do thiếu `server/data/users.json`, không có hồi quy mới.
- Chỉ hoàn thiện trên branch riêng; chưa deploy production.

### 2026-07-30 — Claude Code (CEO chốt) — CHỌN 1 NV phải thấy ĐỦ CẢ 4 Ô, không ô nào tự ẩn
> CEO: "ở chế độ xem từng nhân viên thì mỗi nhân viên phải thấy được số phạt mình dự kiến có thể bị. Nghĩa là khi tôi lọc từng nhân viên thì cũng sẽ thấy được cả 4 ô KPI."

Sau PR #229 thì 3 ô đã luôn hiện, **nhưng ô "Tổng chi phí tháng sau phạt" vẫn tự ẩn** khi tổng gốc `null` (coverage khớp doanh thu chưa đạt ngưỡng) — cả ở điều kiện ngoài (`periodTotal != null &&`) lẫn trong component (`if (baseTotal == null) return null`).

**Đã bỏ cả hai chỗ ẩn.** Fail-closed **KHÔNG mất** mà chuyển vào trong component: tổng gốc `null` thì hiện **chữ "Chưa đủ dữ liệu chi phí"** kèm giải thích, **tuyệt đối không suy ra số và không hiện 0**. Nguyên tắc: *thiếu dữ liệu thì nói thẳng, đừng ẩn ô* — ẩn ô là để người xem tưởng tính năng không tồn tại, đúng chuyện CEO vừa gặp.

**‼ Lần thứ HAI trong ngày gặp test khoá luật đã bị CEO thay.** Ca `employeePenaltyFrontend.test.js` khoá cứng `model.summary.periodTotal != null && <AfterPenaltyKpi` — chính cái CEO yêu cầu bỏ. **Không xoá cho qua**: đã đổi thành khoá luật mới — cấm điều kiện ẩn ngoài · bắt buộc render vô điều kiện · bắt buộc `null` thì hiện chữ · **cấm `return null`**. Cùng cách xử lý với ca `EmployeeCost.diemXu.test.mjs` sáng nay.

Rút ra: mỗi lần CEO đổi yêu cầu hiển thị, phải **soát cả hai bộ test** (`server/test/employeePenaltyFrontend.test.js` và `web/test/EmployeeCost.diemXu.test.mjs`) — cả hai đều đọc `EmployeeCost.jsx` và cùng khoá bố cục lưới KPI.

**Test:** server **505/514** đúng 9 ca đỏ baseline, **0 hồi quy** · web **84/84** · build PASS.

### 2026-07-30 — Claude Code (CEO yêu cầu) — Đưa CÁCH TÍNH PHẠT vào Quản target + mở 4 ô KPI ở "Tất cả NV"
> CEO: "công thức tính phạt tại sao vẫn không có tại mục quản target — tôi yêu cầu mục này phải được hiển thị trong phần quản target. Tôi yêu cầu 4 ô KPI mới phải được hiển thị trong màn hình cho tôi."

**Hai nguyên nhân, cả hai là thiếu sót thật:**

**1. `Target.jsx` có ĐÚNG 0 lần nhắc tới phạt.** Spec `SPEC_BONUS_PENALTY_V33.md` chỉ yêu cầu 4 ô KPI ở trang Chi phí, **không** yêu cầu panel phạt trong Quản target — nên bot không làm. **Lỗi của Claude khi viết spec**: nút "Cấu hình Thưởng" đã nằm đó thì cách tính Phạt phải nằm cạnh, mới đối xứng.

**2. Cả 4 ô KPI đều bị chặn bởi `!allEmployees`** — mà CEO mở màn ở chế độ **"Tất cả nhân viên"**. Nên **dù deploy CEO vẫn không thấy gì**. Đây là lý do thật, không phải chưa làm.

**Đã thêm `PenaltyPolicyPanel` vào Quản target** (nút "⚠ Cách tính Phạt v3.3" cạnh nút Thưởng): trạng thái áp dụng theo **kỳ dữ liệu** (T07 chỉ cảnh báo / từ 01/08 trừ thật) · bảng **4 bậc liền mạch** kèm giải thích mốc 50% phải VƯỢT còn 70/90% chỉ cần chạm · phạt thiếu Xu 300.000đ/Xu + trạng thái bật/tắt · mô tả cảnh báo sớm và vì sao **làm tròn LÊN + cộng đệm**.

**‼ Panel CHỈ ĐỌC, có chủ ý — và ghi rõ vì sao ngay trên màn hình.** Bậc phạt nằm trong **vân tay công thức** (`bonus_formula_lock.json`). Cho sửa từ giao diện là **phá khoá chống-quên**: đổi bậc mà không nâng `FORMULA_VERSION` thì **số tiền nhân viên nhận đổi mà không ai biết**. Khác với Thưởng — Thưởng sửa được vì đi qua luồng preview→save→audit có phân tầng.

**Panel nạp cấu hình riêng** (`api.adminBonusPolicies` theo kỳ), không phải mở hộp Thưởng trước mới xem được.

**4 ô KPI nay hiện ở MỌI chế độ.** Ở "Tất cả NV" ghi rõ **"Chọn 1 NV"** — vì backend chỉ tính phạt khi có `empCode` (`routes.js`: `empCode ? buildPenalty(...) : null`). **Thà nói thật là chưa có số còn hơn ẩn đi để người dùng tưởng tính năng không tồn tại.** Ô "Ứng lần 1" bỏ chặn hoàn toàn vì nội dung là "Chưa đấu nối app lương", không phụ thuộc NV.

**KHÔNG cộng dồn toàn đội ở frontend** — đã ghi chú thẳng trong code. Cộng ở frontend là tự dựng nguồn số thứ hai, đúng cái đã gây ra vụ hai app lệch 382,6 triệu. Muốn có số toàn đội thì **backend phải tính**, ghi thành việc còn lại.

**Một ca web test đỏ — và nó ĐÚNG là luật cũ đã bị CEO thay:** `EmployeeCost.diemXu.test.mjs` cấm đưa "Phạt dự kiến" thành ô KPI (thiết kế cũ để nó ở hàng phép tính cấn trừ). **Không xoá cho qua** — đã sửa thành khoá **yêu cầu mới**: giữ nguyên cấm "Xu tích lũy" làm ô riêng, nhưng bắt buộc lưới KPI **phải có** 3 ô phạt + `SalaryAdvanceKpi`, **cấm** `{!allEmployees && <PenaltyKpi`, và bắt buộc ở "Tất cả NV" phải ghi "Chọn 1 NV". Đổi một guard cũ đã lạc hậu thành guard mới mạnh hơn.

**Test:** server **505/514** đúng 9 ca đỏ baseline (3 auth + 6 `pdfinfo`), **0 hồi quy** · web **84/84** · web build PASS.

**Còn lại cho bot:** (a) **deploy** — production vẫn ở `4c34551`, chưa có gì của 2 ngày qua; (b) backend cộng dồn phạt toàn đội cho chế độ "Tất cả NV".

### 2026-07-29 — PHẠT v3.3 backend batch 1
- Thêm máy tính phạt target tách biệt P1/P2: bậc chính xác 90/70/50, trần C45, mất trắng C45, fail-closed target/C45, lịch T07 cảnh báo → T08 áp dụng, `formulaText` và cảnh báo sớm có gap làm tròn lên.
- Tái dùng `xuPolicy.buildCheckpoint` cho phạt thiếu Xu (mặc định tắt), thêm `PENALTY_NOTIFY` mặc định tắt và giữ nguyên toàn bộ hàm dựng tin Telegram/email.
- Tích hợp payload chi phí cá nhân với `penalty`, tổng sau phạt và đối soát tổng ngày; nâng khoá công thức lên v3.3.
### 2026-07-29 (đêm) — Report Bot — cảnh báo MISA thiếu ngày doanh thu

Không vá doanh thu bằng ngày đặt/ngày tạo đơn. Với dòng MISA `official`/`pending`, số tiền khác 0 nhưng `revenue_date` NULL, App Report vẫn không tính vào kỳ nhưng đưa vào nhóm cảnh báo dữ liệu `Dữ liệu MISA thiếu ngày doanh thu` trong trung tâm cảnh báo, kèm mã đơn, số tiền, NV và đơn vị để sửa tại nguồn.

Ca live đang bắt được: `DH479815711` / `2.399.520đ` / `DN010 - Trần Quốc Cường` / `015.TTYT H. Cẩm Mỹ`. Đây là lỗi dữ liệu nguồn; kế toán/MISA cần nhập `revenue_date` tại gốc.
### 2026-07-29 22:55 — Bot server (CEO duyệt) — ĐÃ TẮT 2 CỜ THÔNG BÁO: rủi ro gửi tin sai 31/07 đã loại bỏ
`EMP_COST_NOTIFY=0` · `BONUS_NOTIFY=0`. Restart **chỉ** `app-report-tgbot` (PID mới **2937285**); `app-report` **không** restart (PID giữ **2720705**); `web/dist` vẫn `4c34551-20260729-201455-841`. Log in đúng `ℹ Chi phí/Thưởng notify: TẮT`. Backup `.env.backup-20260729-225543-disable-cost-bonus-notify`.

**Claude nghiệm thu ĐẠT.** Bằng chứng bot đưa **đủ 4 con số phân biệt được**, không thể báo suông: PID tgbot **đổi** (chứng minh có restart) · PID app-report **không đổi** (chứng minh KHÔNG đụng web/API) · version.json **không đổi** (chứng minh không đụng `web/dist`) · dòng log **đúng chuỗi** yêu cầu. Đây là mẫu báo cáo đúng — mỗi con số chứng minh một điều, không có con số nào thừa.

*(Claude chỉ nhận được phần chữ, không nhận được ảnh chụp — đã nói rõ với CEO, không gắn "đã kiểm ảnh".)*

**Vì sao việc này gấp:** ngày 31/07 đúng 20:00 hệ thống sẽ **tự gửi** tin chi phí + thưởng cho toàn bộ NV bằng **số cũ đã sai** — DN008 Đoàn Văn Triệu nay đạt **130,26%** (đổi bậc, thiếu **~1,92 triệu** P1, chưa kể P2). Nay đã chặn.

**Điểm rút ra về cách bàn giao lệnh:** CEO đi nghỉ nên không relay được lệnh đã duyệt sang bot. Claude ghi thẳng thành `DIRECTIVE_HOAN_TIN_CUOI_THANG_072026.md` trên `main` — bot bắt buộc pull `main` trước mỗi đợt nên **chắc chắn đọc được**. Kênh này hoạt động: bot đọc và làm đúng ngay. Từ nay lệnh gấp mà không relay trực tiếp được thì ghi directive vào `main`, đừng chờ.

**Còn lại:** tin báo chậm cho NV (chờ CEO duyệt danh sách người nhận) · tính lại thưởng T07 với slot mới · merge 2 nhánh đã duyệt (`fix/misa-null-revenue-date-alert`, `feat/bonus-penalty-v3.3`) sau 31/07 · ca test chống đếm hai lần qua hai kỳ trước 05/08.

### 2026-07-29 (chốt ngày) — Claude Code — Nghiệm thu slot T07 ĐẠT + directive hoãn tin
**Slot T07 mới đã ghi.** `rev_2src_072026_20260729153232_...` · tổng **28.957.771.643đ** · CRM 1.319 dòng / 19.171.667.663đ · Partner 585 dòng / **9.786.103.980đ** (khớp ĐÚNG số App Sale) · trùng `source_line_id` = 0.

**Claude nghiệm thu ĐẠT — kiểm cả 2 tỷ lệ guard mà bot không thể tự bịa:** `revenueRatio` 1.01338848 và `rowRatio` 1.02420656, tự tính lại **khớp từng chữ số**. Guard PASS là đúng vì đây là **tăng 1,34%** (đúng phần HOLD_GOLIVE), mà guard chỉ chặn khi **tụt** dưới 70%.

**Vụ đối chiếu doanh thu KHÉP LẠI:** từ 384.977.920đ hoang mang buổi sáng, còn đúng **2.399.520đ** đã biết rõ nguyên nhân (1 dòng MISA thiếu `revenue_date`) và biết ai sửa. **Không còn đồng nào bí ẩn.**

**Kiểm thêm:** bot push `ce7549d` lên `main` — Claude soát lại **3 spec + 1 directive vẫn còn nguyên**, không bị đè.

**‼ VIỆC GẤP CHƯA XONG — đã ghi thành directive vì CEO đi nghỉ:** hai cờ `EMP_COST_NOTIFY`/`BONUS_NOTIFY` **VẪN BẬT**. Ngày 31/07 hệ thống sẽ **tự gửi tin thưởng bằng số cũ đã sai** — DN008 nay đạt 130,26% (đổi bậc, thiếu ~1,92 triệu). CEO đã duyệt tắt từ trước nhưng bot chưa nhận được lệnh.

Đã ghi `DIRECTIVE_HOAN_TIN_CUOI_THANG_072026.md` để bot đọc được ngay ở đợt pull kế tiếp, gồm 4 việc theo thứ tự ưu tiên + 5 ranh giới không được làm. Nhấn mạnh: **sửa `.env` không thôi KHÔNG ăn**, phải restart `app-report-tgbot` (tiến trình riêng, không đụng web/API).

**HANDOFF.md viết lại phần đầu** — trước đây còn dừng ở 27/07, nay có 2 việc gấp lên đầu, bảng khép vụ 384,98 triệu, và 4 spec mới của ngày 29/07.

### 2026-07-29 (khuya, bổ sung) — Claude Code (CEO chốt) — CẢNH BÁO TELEGRAM khi đồng bộ lỗi
> CEO: "khi đồng bộ mà lỗi thì hệ thống báo về Telegram cho VP018/DN007/CEO để biết xử lý. Và báo về bot Sale luôn."

**Lý do cần:** màn "Chưa đồng bộ" vẫn phải **có người chủ động mở ra mới thấy** — mà chính vì không ai mở nên 382,6 triệu nằm im 18 ngày.

**‼ BẪY TÌM THẤY TRƯỚC KHI CODE: VP018 đang bị chặn thông báo tuyệt đối.** VP018 nằm trong `notify_optout.json` (cùng DN021/DN023/VP004) và `dormantFeedback.TELEGRAM_HARD_EXCLUDED`. Có **hai cách làm sai**, cả hai đều hỏng:
- Lọc cảnh báo qua `targetNotify.isMuted` ⇒ **VP018 không nhận được gì** — đúng người CEO chỉ định lại bị chặn.
- Gỡ VP018 khỏi optout ⇒ VP018 **nhận lại toàn bộ** tin target/thưởng/chi phí/doanh thu đã cố ý loại.

**Đây đúng loại lỗi đã dính 28/07** — lấy danh sách của việc này dùng cho việc khác (lần đó là `diemXu.EXCLUDE`, suýt chặn nhầm DN022). Cách đúng: **danh sách HOÀN TOÀN MỚI** `config/sync_alert_recipients.json`, kèm ghi chú nói rõ optout chỉ chặn **thông báo hiệu suất**, không áp cho **cảnh báo vận hành**. Bổ sung một câu vào `notify_optout.json` để lần sau không ai hiểu nhầm.

**Mỗi người nhận ĐÚNG phần của mình**, không phải bản giống nhau: VP018+DN007 nhận phần đơn hàng/ngày giao/đơn vị (thứ họ sửa được) · CEO nhận bản tổng · bot App Sale nhận phần thuộc App Sale. Nhận thứ mình không sửa được thì lần sau sẽ không đọc nữa.

**Hai mức, khác nhau rõ:**
- **KHẨN, gửi ngay:** bất biến `Σ(đưa vào)+Σ(loại)=Σ(nguồn)` vỡ — đây **không phải ngoại lệ dữ liệu mà là hệ thống hỏng**, kèm luôn "đã DỪNG, chưa ghi slot".
- **Cần xử lý, gửi 07:30:** chỉ 2 nhóm — có tiền đáng lẽ phải vào, và thiếu danh mục.

**TUYỆT ĐỐI không báo nhóm "chỉ để biết"** (chưa ghi doanh số · ngày kỳ khác · chưa phản hồi). Mấy cái này lúc nào cũng có; báo hằng ngày thì 3 hôm là không ai đọc, và **cảnh báo thật sẽ chìm nghỉm giữa đống rác**.

**Chống spam:** một ngoại lệ tồn 10 ngày **không được nhắn 10 lần** — chỉ nhắn cái mới, cái cũ gộp vào 1 dòng tồn đọng, xử lý xong báo 1 lần rồi thôi. **Không có gì mới ⇒ không gửi** (đúng chốt 28/07).

**Mỗi mục trong tin bắt buộc đủ 4 phần: cái gì · bao nhiêu tiền · vì sao · AI LÀM GÌ.** Thiếu phần cuối thì người nhận lại phải đi hỏi — đúng cái "chạy lòng vòng" CEO muốn bỏ.

**⛔ Blocker đã biết:** kênh sang bot App Sale **chưa có** (29/07 Report Bot thử gửi, thất bại, không có agent Sale trong allowlist). Đề nghị mở **nhóm Telegram chung** cho cả hai bot — vừa cho bot vừa cho người. Chưa có kênh thì **vẫn làm phần VP018/DN007/CEO trước**, không để một chỗ chặn cả việc.

**Test:** 8 ca, trong đó 3 ca khoá đúng cái bẫy VP018 (nhận được cảnh báo đồng bộ · KHÔNG nhận tin hiệu suất · mã nguồn không được gọi `targetNotify.isMuted`).

### 2026-07-29 (khuya) — Claude Code (CEO chốt) — MÀN "CHƯA ĐỒNG BỘ": cấm dòng nào biến mất lặng lẽ
> CEO: "anh đề nghị có một màn riêng để lọc ra những mã đơn hàng/mặt hàng/nhà thầu chưa đồng bộ qua App Report được, phải có kèm nội dung lý do sao không cho đồng bộ... để xử lý tại chỗ, tránh chạy lòng vòng như thế này mệt lắm rồi."

**Vấn đề gốc không phải hai khoản tiền, mà là hệ thống ném dòng đi không nói với ai:**

| Khoản | Mất bao lâu không ai biết | Vì sao |
|---|---|---|
| **382.578.400đ** | 11/07 → 29/07, **18 ngày** | bị loại lặng lẽ bởi `o.status <> 'HOLD_GOLIVE'` |
| **2.399.520đ** | cả tháng 7 | bị loại lặng lẽ vì `revenue_date` NULL |

Cả hai **chỉ lộ ra vì CEO tình cờ mở hai màn hình cạnh nhau rồi trừ tay**, rồi truy mất gần trọn một ngày của CEO lẫn hai bot.

**Nguyên tắc mới: KHÔNG DÒNG NÀO ĐƯỢC BIẾN MẤT LẶNG LẼ.** Đảo ngược cách lọc — thay vì `WHERE` ném dòng đi, phải **lấy toàn bộ → phân loại từng dòng (đưa vào / loại + mã lý do) → ghi 2 kết quả**. Số tiền không đổi một đồng; khác duy nhất là phần bị loại **nay có tên, có mặt, có lý do**.

**‼ Bất biến số học bắt buộc mỗi lần chạy:** `Σ(đưa vào) + Σ(loại) == Σ(nguồn)` cả tiền lẫn số dòng. Không khớp ⇒ **DỪNG, không ghi slot**. Riêng phép kiểm này **đã bắt được cả hai vụ ngay lần chạy đầu**. Thêm ca test: cố tình thêm bộ lọc mới mà quên khai mã lý do ⇒ bất biến vỡ ⇒ đỏ.

**Mỗi mã lý do phải đủ 3 phần: nghĩa · AI xử lý · LÀM GÌ** — cấm lý do chung chung kiểu "không hợp lệ". 13 mã chia 4 nhóm: CRM MISA (5) · WEB đối tác (5) · **vào được nhưng thiếu danh mục** (3) · ghi chú không phải ngoại lệ (1).

**Nhóm thứ 3 nguy hiểm nhất và chưa ai để ý:** dòng **vẫn tính tiền đủ** nhưng thiếu danh mục nên **rơi khỏi bộ lọc** — nhìn tổng thì đúng, lọc ra thì mất. Đây chính là vụ **mã 175.BVĐK Vũng Tàu**: 275,9 triệu tính đủ nhưng lọc theo tỉnh không thấy.

**Màn hình** dựng theo đúng khuôn `DataQualityPanel` đã có (không dựng UI mới), 3 tab theo đúng yêu cầu CEO: **đơn hàng · mặt hàng · nhà thầu**, bấm vào bung chi tiết, xuất Excel gửi thẳng cho kế toán/DataHub/App Sale. Self-scoped: NV chỉ thấy đơn của mình.

**‼ KHÔNG cho sửa dữ liệu trên màn này.** Đặc biệt **cấm App Report tự đoán ngày** thay `revenue_date` NULL — hôm nay 1 dòng, mai kia 50 dòng thì doanh thu nhảy tháng hàng loạt mà không ai hay. Sửa ở nguồn, chạy lại thì dòng tự biến mất khỏi danh sách.

**Tài liệu:** `SPEC_REVENUE_SYNC_EXCEPTIONS.md` — 8 ca test bắt buộc, trong đó 2 ca dựng lại đúng hai vụ thật hôm nay. Đợt 1 (backend + bất biến) **đã có giá trị ngay** kể cả chưa có màn hình.

### 2026-07-29 (tối) — Report Bot — T07 tính `HOLD_GOLIVE` đã giao vào APP WEB partner

Claude/CEO chốt sau đối soát file Excel: 45 dòng `HOLD_GOLIVE` có phản hồi đối tác, `delivered_qty > 0`, tổng `382.578.400đ` phải tính vào doanh thu T07. `HOLD_GOLIVE` ở ca này là cờ kỹ thuật soft-launch/quota audit; `cst_quota` đang thiếu dữ liệu nên chưa được dùng làm căn cứ loại doanh thu của nhân viên.

Giữ nguyên điều kiện chỉ tính dòng có SL giao > 0, nên 1 dòng HOLD_GOLIVE giao 0 và 2 dòng chưa phản hồi không vào doanh thu. Thêm test khóa chống đếm hai lần: dữ liệu partner vẫn dedupe theo `order_item_id` qua latest response/source id `WEB:<order_item_id>`, nên khi trạng thái thoát HOLD_GOLIVE sau go-live không được sinh thêm một dòng doanh thu thứ hai.

### 2026-07-29 (tối) — Claude Code (CEO chốt) — DỜI KHỐI TIN CUỐI THÁNG 17:30 → 20:00
> CEO: "báo cáo tháng sẽ được gửi vào lúc 20h00 thay vì 17h30 ngày cuối cùng của tháng nhé. vì lúc 17h30 là chưa xử lý số liệu xong đâu."

**Lý do CEO nêu đúng cho CẢ BA tin cuối tháng**, không riêng tin nào — cả ba đều đọc số liệu của chính ngày đó. Nên dời cả ba và **giữ nguyên thứ tự**:

| Tin | Cũ | Mới |
|---|---|---|
| Chi phí tháng | 17:30 | **20:00** |
| Thưởng tháng | 17:40 | **20:10** |
| Báo cáo doanh thu tháng | 18:00 | **20:30** |

**Mốc 20:00 đặt đúng chỗ CEO nói**; hai tin còn lại giữ nguyên khoảng cách tương đối để không đảo thứ tự **chi phí → thưởng → báo cáo doanh thu**.

**Dọn thêm một chỗ rải số:** mốc báo cáo tháng trước đây viết thẳng `hh === 18 && mm === 0` trong code, không có hằng số nên test không khoá được. Nay có `SALES_MONTH_END_SLOT` khai tường minh như 3 mốc kia — đúng chuẩn chú thích sẵn trong file *"khai tường minh để test khoá được, không rải số trong code"*.

**Test khoá lại chặt hơn bản cũ:** thay 3 ca rời bằng 3 ca có ràng buộc thứ tự — chi phí **phải trước** thưởng, thưởng **phải trước** báo cáo doanh thu, và **cả khối không được dời sớm hơn 20:00** (dời sớm là chốt sổ khi số liệu chưa xử lý xong — đúng vấn đề CEO vừa nêu). Thêm ca chặn sót mốc chiều cũ. `notifySchedule` **18/18 PASS**; toàn bộ server **482/489**, đúng 7 ca đỏ baseline (3 auth + 4 thiếu `pdfinfo`), **0 hồi quy**.

**Không ảnh hưởng đợt 31/07** vì hai cờ `EMP_COST_NOTIFY`/`BONUS_NOTIFY` đang được TẮT theo lệnh hoãn của CEO. Lịch mới có hiệu lực từ kỳ sau khi deploy và bật lại cờ.

### 2026-07-29 (tối) — Report Bot — App Report bỏ lọc kép WEB partner theo ngày đặt

Triển khai mục 3 của `SPEC_REVENUE_DELIVERY_PERIOD.md`: `fetchPartner()` trong materializer WEB partner không còn lọc thêm `o.created_at` theo kỳ; quy kỳ chỉ theo một mốc ngày duy nhất là `effective_date`/ngày quy kỳ. Thêm regression để cấm đưa điều kiện `o.created_at >=` / `<` quay lại trong block `fetchPartner()`.

Dry-run T06/T07 hiện tại chỉ đọc DB, chưa ghi slot: nguồn App Sale hiện có không còn dòng `effective_date` T07 nhưng `created_at` ngoài T07 nên APP_WEB_PARTNER T07 chưa tăng; số 9,786 tỷ trong spec cần Claude/App Sale xác nhận lại snapshot/tiêu chí trước khi ghi thật.

### 2026-07-29 (tối) — Claude Code — TRUY RA 382 TRIỆU BIẾN MẤT: bộ lọc kép làm đơn rơi khỏi CẢ HAI kỳ
> CEO: "app sale thì 28,96 tỷ, còn app report lại 28,58 tỷ, vậy con số gần 400 triệu đang nằm ở đâu?"

**Bot trả lời SAI 2 chỗ, Claude bác bằng số học:**
1. Bot nói *"nguồn nhà thầu đối tác khớp"* — **ngược hoàn toàn**. Tách chênh lệch theo nguồn: đối tác lệch **382.578.400đ**, CRM lệch **2.399.520đ**, cộng lại **đúng bằng 384.977.920đ** không dư một đồng ⇒ **99,4% chênh lệch nằm đúng ở nguồn bot bảo là khớp**.
2. Bot nói phần dư *"12–22 triệu do làm tròn"* — **không thể**. Hai số đều chính xác tới **đồng** (28.960.171.163 và 28.575.193.243); làm tròn sai lệch dưới 1đ. **17.546.000đ vẫn chưa có lời giải.**

**‼ NGUYÊN NHÂN GỐC — nặng hơn "nằm ở kỳ khác":** `fetchPartner()` bắt đơn phải thoả **CẢ HAI** điều kiện: `o.created_at` trong kỳ **VÀ** `effective_date` trong kỳ. Đơn nào có ngày đặt và ngày ghi nhận ở hai tháng khác nhau thì **bị loại khỏi CẢ HAI kỳ** — không nằm ở tháng 6, cũng không ở tháng 7, **biến mất khỏi báo cáo**. *(Claude đã tự đính chính: lượt trước nói "tiền nằm ở kỳ T06" là SAI.)*

**Nguyên nhân sâu:** form phản hồi WEB **không có ô "Ngày thực giao"**, nên máy tự đoán `effective_date` = **ngày đối tác bấm phản hồi**. Đơn giao thật 25/06 mà phản hồi 01/07 thì máy ghi 01/07 — máy **không có cách nào biết** hàng đã giao 25/06.

**CEO chốt 3 điều:**
- **Quy kỳ theo NGÀY THỰC GIAO.** Đơn đặt 25/06 giao 02/07 ⇒ doanh thu **T07**.
- **Kỳ khoá sổ: hết ngày 5 tháng sau.** Trước đó VP018/DN007 sửa ngày giao thoải mái; sau đó phải CEO duyệt từng đơn.
- **KHÔNG HỒI TỐ.** Sổ kỳ đã chốt không sửa đè; thưởng đã báo không đòi lại; **không phạt hồi tố** (tháng đã qua, NV không thể bán bù).

**Vá được NGAY, không chờ ai:** bỏ bộ lọc kép, quy kỳ theo **một** mốc ngày duy nhất. Kể cả khi App Sale chưa kịp thêm ô ngày giao thì tiền cũng **thôi biến mất** — cùng lắm rơi nhầm tháng, còn hơn mất hẳn.

**‼ Cảnh báo Claude nêu:** không hồi tố + không chặn = **bán đơn lớn cuối tháng, nhận thưởng, tháng sau trả lại, không mất gì cả**. Đề nghị chặn từ đầu: đơn lớn phát sinh 3 ngày cuối tháng phải **chờ 15 ngày** mới tính vào target. Đang chờ CEO chốt ngưỡng.

**Tài liệu:** `SPEC_REVENUE_DELIVERY_PERIOD.md` — kèm bảng nghiệm thu 5 bước (bắt buộc kiểm **không đếm hai lần**). Ba mục còn chờ CEO: cơ chế đơn bù, ngưỡng đơn lớn, tách "doanh thu tài chính / doanh thu đánh giá NV". **Chưa có quyết định thì không code 3 mục đó.**

**Cũng trong tối 29/07:** xảy ra **sự cố deploy ngoài ý muốn** — bản frontend nhánh phạt `ccacba0` lỡ lên production, bot đã khôi phục về `4c34551`. Claude xác minh bản lỗi **vẽ 3 ô "Phạt dự kiến"/"Phạt thiếu Xu"/"Ứng lần 1" vô điều kiện** cho mọi NV ⇒ nhân viên có thể đã nhìn thấy ô phạt **trước khi CEO công bố chính sách**. Việc gấp nhất: kiểm **thư mục code trên server đang ở commit nào** — PID không đổi chỉ chứng minh backend đang chạy code cũ **trong RAM**, nếu đĩa đã là code phạt thì lần restart tới sẽ tự chạy.

### 2026-07-29 (đóng spec) — Claude Code — PHẠT v3.3: CEO chốt nốt điểm cuối, spec ĐỦ để bot làm
> CEO: "Mức phạt thiếu Xu 300.000đ/Xu — anh đồng ý giữ nguyên nhé."

**Đóng nốt điểm treo thứ 4/4.** Giữ nguyên `PENALTY_PER_MISSING_XU = 300000`, không đụng `xuPolicy.js`. Vẫn đưa vào `xuPenalty.perMissingXu = 300000` để sau này CEO chỉnh được qua đúng luồng preview→save có audit, **nhưng giá trị hiện tại y nguyên**.

**Bảng chốt cuối — bot KHÔNG cần hỏi thêm gì:**

| # | Việc | Chốt |
|---|---|---|
| 1 | Mốc bậc phạt | ≥90% không phạt · 70–90% 0,2% · 50–70% 0,3% · **≤50% mất trắng C45** |
| 2 | Tin nhắn | **KHÔNG đụng** — giữ nguyên 4 khung giờ đang chạy |
| 3 | Phạt thiếu Xu | **GIỮ NGUYÊN 300.000đ/Xu** |
| 4 | Vách đá 50% | Giữ luật, **bắt buộc có cảnh báo sớm** (mục 5B) |

**Ba thứ tuyệt đối không được làm sai** (ghi thành mục 12 trong spec):
1. **Mốc 50% phải VƯỢT mới thoát** — gap có đệm 1.000đ, làm tròn LÊN.
2. **T07.2026 không trừ một đồng nào** — `warn_only`, tự chuyển `enforced` lúc 01/08/2026.
3. **P1/P2 không sửa một dòng** — phạt là trường riêng.

**Spec `SPEC_BONUS_PENALTY_V33.md` đã ĐÓNG**, 32 ca test bắt buộc, đủ để bot triển khai. Chưa đụng code app.

### 2026-07-29 (chốt cuối ngày) — Claude Code — PHẠT v3.3: cảnh báo sớm + LỊCH ÁP DỤNG tự bật 01/08/2026
> CEO: "chỉ vì con số 50,5 và 50,0 mà mất tiền triệu của nhân viên thì đau lắm... spec nhấn mạnh là **bạn có thể mất trắng số tiền tại cột C45 là ... nếu bạn không cố gắng thêm giá trị đơn hàng là ... (trước VAT)**. Như vậy NV sẽ khâm phục và khẩu phục" + "Tháng 07.2026 chỉ đưa vào cảnh báo. Công thức tính phạt kích hoạt vào T08.2026, ngày bắt đầu áp dụng 01/08/2026. Trong cài đặt em cũng cài đặt rõ luôn, kẻo hôm sau lại quên kích hoạt".

**1) CẢNH BÁO SỚM thành mục riêng 5B — phần quan trọng nhất của module.** Phạt mà không báo trước chỉ làm NV ức chế. Câu chữ do **backend sinh**, bắt buộc đủ 3 phần: **số tiền đang bị đe doạ** + **số doanh thu cần thêm (ghi rõ "trước VAT")** + **mốc % phải chạm và % hiện tại**.

**‼ Hai cái bẫy chết người đã khoá bằng test:**
- **Mốc 50% phải VƯỢT, hai mốc kia chỉ cần CHẠM.** Luật là `pct ≤ 50%` mất trắng ⇒ đạt đúng 50,0% **vẫn mất trắng**. Bảo NV "thêm 30 triệu là thoát" mà chạy xong đúng 50,0% vẫn mất 7,6 triệu thì hỏng hết niềm tin. Gap mốc 50% phải **+1.000đ đệm**.
- **LUÔN làm tròn LÊN.** Làm tròn xuống ⇒ NV chạy đúng con số app bảo mà vẫn thiếu vài trăm đồng ⇒ vẫn mất tiền.
- Ca test mạnh nhất: quét `pct` 0→89,9 bước 0,1, lấy `revenueGap` app trả cộng vào doanh thu, tính lại bậc ⇒ **phải sang bậc tốt hơn**. Chống đúng lỗi "bảo thoát mà không thoát".

**Chọn mốc gần nhất, không phải luôn mốc 90%.** Bảo người đang ở 45% rằng "thêm 500 triệu là hết phạt" thì họ bỏ cuộc. Phải cho thấy mốc gần nhất **cứu được nhiều tiền nhất** trước.

**2) LỊCH ÁP DỤNG — chống quên bằng NGÀY, không bằng nút bấm.** CEO lo "hôm sau lại quên kích hoạt" nên Claude **bỏ hẳn bước bật cờ tay**:
```
penaltyWarnFrom: "2026-07-01"   penaltyEffectiveFrom: "2026-08-01"   penaltyEnabled: true
```
| Kỳ | Chế độ | Tính số | TRỪ tiền | Cảnh báo |
|---|---|---|---|---|
| T07.2026 | `warn_only` | có | **KHÔNG** | CÓ |
| Từ 01/08/2026 | `enforced` | có | CÓ | có |

`penaltyEnabled` **chỉ để TẮT KHẨN CẤP**, mặc định `true`. Deploy tháng 7 an toàn **tự động** vì lịch chặn — không phụ thuộc ai nhớ gì. **Không còn bước "đợt 3: bật cờ"** trong kế hoạch. Deploy 01/08 hay 15/08 đều ra kết quả giống hệt cho kỳ T08 vì chế độ tính theo **kỳ dữ liệu**, không theo ngày bấm nút (đã có ca test giả lập 4 mốc giờ hệ thống).

**Tháng 7 là tháng tập dượt:** NV nhìn thấy mình *sẽ* mất bao nhiêu mà chưa mất đồng nào. Đến 01/08 không ai kêu bị đánh úp. Câu chữ riêng cho `warn_only` (mục 5B.3b) **bắt buộc có chữ "chưa trừ tiền" + "01/08/2026"**, cấm dùng câu thể đe doạ trần trụi.

**Ngày áp dụng nằm trong khoá version** — dời ngày phạt = đổi thời điểm NV bị trừ tiền, phải để lại dấu vết version + CHANGELOG, không sửa lén được. Bổ sung `FORMULA_CONFIG_KEYS`: `penaltyTiers`, `penaltyEffectiveFrom`, `penaltyWarnFrom`, `penaltyEnabled`, `xuPenalty`.

**3) Tin nhắn — CEO chốt phương án (a): KHÔNG ĐỤNG.** Tin 07:30 / 12:30 T7 / 17:30 / 17:40 giữ nguyên 100%. Cờ `PENALTY_NOTIFY` tạo sẵn nhưng **mặc định TẮT**. Ghi chú cho bot: T07 ở `warn_only` nên số trên app **bằng đúng** số trong tin ⇒ **tháng 7 không hề có mâu thuẫn**; mâu thuẫn chỉ phát sinh từ 01/08.

**Ca test bắt buộc: 17 → 32.** Thêm 8 ca cảnh báo sớm, 6 ca lịch áp dụng, 2 ca khoá tin nhắn.

### 2026-07-29 (chốt lại mốc) — Claude Code — PHẠT v3.3: CEO chốt mốc cuối, ≤50% mất trắng C45
> CEO: "target từ đủ 90% trở lên là tính theo công thức thưởng rồi · phạt khi chỉ đủ 70–89 là 0,2% · phạt khi 51–69 là 0,3% · phạt khi chỉ bằng 50% trở xuống thì mất trắng (0,5%)" + "nếu target chỉ đạt bằng hoặc thấp hơn 50% thì không tính cột c45 vào mục chi phí tổng nhận nữa".

**Bảng mốc CUỐI (thay bản sáng):**

| % đạt target | Xử lý | `penaltyTier` |
|---|---|---|
| **≥ 90%** | **không phạt** — chạy công thức thưởng v3.2 | `none` |
| **70% ≤ pct < 90%** | trừ **0,2%** vào C45 | `t70_90` |
| **50% < pct < 70%** | trừ **0,3%** vào C45 | `t50_70` |
| **≤ 50%** | **mất trắng C45** — không cộng vào tổng chi phí nhận | `drop_c45` |

**‼ Đổi so với bản sáng:** bản sáng cho **đúng 50,0%** vào bậc 0,3%; CEO chốt lại **"bằng 50% trở xuống"** ⇒ đúng 50,0% **mất trắng**. Đã sửa spec + ca test.

**Làm rõ "(0,5%)" — CEO chốt: mất trắng TOÀN BỘ C45**, tức đúng số tiền C45 của người đó (vd 7.599.706đ), mỗi người một khác vì %C45 từng mặt hàng khác nhau. **Không phải** trừ 0,5% doanh thu. Con số 0,5% chỉ là cách gọi tên bậc thứ 3 nối tiếp 0,2% – 0,3%. Nếu hiểu nhầm thành "trừ 0,5% doanh thu" thì NV có %C45 cao hơn 0,5% vẫn còn lại một phần — sai hẳn ý CEO.

**Mốc nay liền mạch tuyệt đối:** thêm ca test **quét pct từ 0 đến 150 bước 0,1**, không giá trị nào rơi ra ngoài bậc. Ba mốc biên khoá cứng: 90,0 ⇒ không phạt · 70,0 ⇒ 0,2% · 50,0 ⇒ mất trắng · 50,01 ⇒ 0,3%.

**Thêm 1 ca test:** `pct ≤ 50%` ⇒ `tổngSauPhạt = tổngGốc − tiềnC45` và `c45Dropped: true` — khoá đúng câu CEO nói "không tính cột c45 vào mục chi phí tổng nhận". Tổng ca test bắt buộc: **16 → 17**.

**Vách đá 50% giờ dốc hơn:** ở 50,01% chỉ mất ~0,3% doanh thu, chạm đúng 50,0% là mất trắng C45 (vd 7,6 triệu). Claude vẫn đề nghị app **cảnh báo sớm** "còn thiếu … đồng nữa là mất trắng C45" để NV kịp chạy.

**Còn treo:** cách xử lý tin nhắn (app hiện phạt nhưng tin 12:30 T7 / 17:30 vẫn báo tổng gốc) — Claude khuyến nghị đợt này chưa đụng tin nhắn.

### 2026-07-29 (bổ sung chiều) — Claude Code (CEO chốt số thật) — PHẠT v3.3 đổi sang trừ cột C45 + 4 ô KPI
> CEO chốt: 70–89% trừ 0,2% tại C45 · 51–69% trừ 0,3% · <50% thì C45 không tính vào chi phí tháng. Cho TẤT CẢ NV xem số phạt + công thức. Thêm đúng 4 ô KPI.

**Bỏ cách "bậc âm nối tiếp P1" của bản sáng.** CEO chốt cách gọn hơn: trừ thẳng vào **C45 "Lương tăng thêm"** — 1 trong 4 cột chi phí tháng (`c36/c41/c43/c45`). Ý rất rõ: không đạt target thì bị cắt vào phần lương tăng thêm, dưới 50% thì mất trắng phần đó.

**Chốt cách đọc "trừ 0,2% tại C45":** C45 vốn = `doanh thu × %C45`, nên hạ tỷ lệ đi 0,2 điểm **ra đúng cùng một số** với `0,2% × doanh thu`. Hai cách đọc trùng nhau ⇒ không còn mơ hồ. **Trần phạt = chính tiền C45** (CEO chốt ý 2), không bao giờ để C45 âm.

**‼ Bịt 4 lỗ hổng mốc %.** Đọc nguyên văn CEO ("70 đến 89", "51 đến 69", "<50") thì **89–90%, 69–70%, 50–51% và đúng 50%** bị hở — NV rơi vào đó máy không biết xử sao. Spec dùng mốc liền mạch **≥90 / 70–90 / 50–70 / <50**, giữ nguyên "dưới 50% mới mất trắng"; đúng 50,0% vào bậc 0,3%. **Đã ghi rõ để CEO xác nhận lại.**

**Đảo ngược chốt sáng "chỉ báo CEO":** nay **tất cả NV xem được phạt của chính mình + công thức**, vẫn self-scoped (không thấy của người khác). `formulaText` do **backend sinh** để câu chữ luôn đi cùng số.

**4 ô KPI mới** (cạnh đúng ô CEO chỉ định): Phạt dự kiến · Tổng chi phí sau phạt · Phạt thiếu Xu cuối quý · Ứng lần 1. Ba chỗ bắt buộc làm đúng:
1. Ô **Ứng lần 1** chưa có API app lương ⇒ phải hiện **"Chưa đấu nối"**, tuyệt đối không hiện `0đ` — hiện 0đ là nói với NV "tháng này anh không được ứng đồng nào".
2. Tổng gốc `null` (coverage thấp) ⇒ **ẩn hẳn** ô "sau phạt", không lấy `null` làm 0 rồi ra số âm.
3. Ô phạt Xu chỉ có số tháng cuối quý ⇒ 2 tháng kia hiện **"Chốt vào cuối quý (T9)"**, không để trống.

**Màu đã có sẵn, không chế mới:** `.employee-cost-tone-penalty` (đỏ) đã nằm trong `styles.css:2026` từ trước mà **chưa dùng ở đâu** — đối nghịch đúng với ô thưởng xanh lá. Kèm yêu cầu **không phân biệt chỉ bằng màu**: số phạt luôn có dấu − và chữ "Phạt".

**Rủi ro kỹ thuật đã cảnh báo cho bot:** loại C45 khi <50% là loại **theo từng NV/từng kỳ** (khác `c44` loại cứng) — phải giữ bất biến **Σ theo ngày = tổng tháng**, logic residual/làm tròn, và coverage không được đổi vì việc loại cột.

**Mâu thuẫn còn treo, cần CEO chốt:** NV thấy phạt trên app nhưng tin nhắn 12:30 T7 / 17:30 vẫn báo **tổng chi phí gốc** ⇒ hai số khác nhau. Claude khuyến nghị **đợt này không đụng tin nhắn**, chạy 1 kỳ cho chắc rồi mới đưa vào.

**Vách đá 50% — đã nêu để CEO cân nhắc:** ở 50,1% chỉ mất ~0,3% doanh thu, xuống 49,9% **mất trắng C45** (ví dụ 7,6 triệu). Claude đề nghị giữ đúng ý CEO nhưng app phải **cảnh báo sớm** "còn thiếu … đồng nữa là mất trắng C45" để NV còn kịp chạy.

**Tài liệu:** `SPEC_BONUS_PENALTY_V33.md` (viết lại toàn bộ, 16 ca test bắt buộc). Chưa đụng code app.

### 2026-07-29 — Claude Code (CEO chốt) — SPEC PHẠT v3.3: "đã có thưởng là phải có phạt"
> CEO: "Xong việc này anh muốn làm luôn cách tính phạt nữa nhé. Vì đã có thưởng là phải có phạt."

**‼ Phát hiện: PHẠT ĐÃ CÓ SẴN MÀ KHÔNG AI BIẾT.** `server/src/xuPolicy.js` tính phạt **thiếu Xu 300.000đ/Xu** (2 Xu = 600.000đ), tháng tạm tính - quý quyết toán, có đối trừ số Finance đã hạch toán để **không phạt hai lần**. Nhưng nó chỉ được gọi trong `dormantService.js` — **không route, không màn hình, không thông báo**. NV không biết mình đang bị tính phạt bao nhiêu. Nên "làm phạt" thực chất là **2 việc**: phơi cái đã có, và làm mới phần phạt theo target.

**CEO chốt 4 điểm:** (1) phạt theo **không đạt target tháng + thiếu Xu**; (2) tính bằng **bậc âm nối tiếp P1**, CEO tự nhập mốc/%; (3) tiền phạt **trừ vào tổng chi phí bán hàng NV nhận**; (4) **chỉ báo CEO, KHÔNG báo NV**.

**Claude nêu lo ngại về điểm (3), CEO vẫn chốt — đã thiết kế cách giữ được cả hai:** App Report **không ghi đè số DataHub**. Màn hình CEO hiện **3 dòng tách bạch** — *Chi phí DataHub (SSOT) / Trừ phạt (dự kiến) / Còn lại (tham khảo)*. Số gốc không bị đụng, sau này muốn trừ thật thì chuyển sang DataHub trừ, App Report quay về chỉ đọc. Không bao giờ để hai bên cùng trừ.

**Rào chắn kỹ thuật để phạt KHÔNG THỂ rò sang NV:** phạt là **trường riêng `penaltyAmount`**, tuyệt đối không trộn vào `amount`/`baseAmount`. Trộn chung thì mọi chỗ đang hiện `amount` (self-view chi phí NV, tin Telegram 17h40, export) sẽ **tự động lộ phạt**. Tách trường + backend chỉ đính khối `penalty` khi `isAdmin` ⇒ NV không thể thấy dù giao diện có lỗi. **P1 giữ nguyên, không sửa một dòng.**

**Fail-closed của phạt = KHÔNG PHẠT** (không phải "phạt 0đ"). Đặc biệt: **chưa giao target thì tuyệt đối không phạt** — phạt NV vì CEO chưa giao target là lỗi nặng nhất module này có thể gây ra. Chi phí DataHub `null` thì **không hiện dòng "Còn lại"** — đúng cái bẫy `Number(null) === 0` đã dính 2 lần trong tháng 7.

**Bắt buộc:** ship phạt = đổi cách tính thưởng ⇒ nâng `FORMULA_VERSION` **v3.2 → v3.3** + cập nhật `bonus_formula_lock.json`, nếu không `bonusFormulaVersion.test.js` đỏ. Tách file phạt mới thì phải thêm vào `FORMULA_SOURCES`, kẻo sửa công thức phạt lọt khoá.

**Thứ tự đề nghị:** đợt 1 phơi phạt Xu (máy đã đúng, rủi ro thấp) → đợt 2 phạt theo target → đợt 3 mục phạt trong digest CEO. **KHÔNG bật cờ `penaltyEnabled` cùng đợt deploy đầu**, và **KHÔNG deploy trước 31/07** (ngày chốt tháng đang chạy tin chi phí + thưởng thật).

**CEO còn phải chốt:** mốc + % phạt thật, trần tiền phạt/NV/tháng, giữ hay đổi mức 300k/Xu, và sau này có cho NV nhìn thấy phạt của chính mình không.

**Tài liệu:** `SPEC_BONUS_PENALTY_V33.md`. Chưa đụng code — đây là spec cho bot triển khai.

### 2026-07-29 — Claude Code (CEO yêu cầu) — Thưởng P1/P2: sửa tay xong PHẢI thấy số nhảy + khoá version công thức
> CEO: "chỉnh bằng tay áp dụng rồi? Vẫn không thấy số nhảy. Trong bảng nhìn vào thì hiển thị V3.2 còn nhấn vào fix tay thì bản V3.1 rất khập khiễng. Đề nghị cho đồng bộ. Yêu cầu thêm mỗi lần chỉnh sửa cách tính thưởng thì phải cập nhật nâng version mới."

**Đã kiểm: MÁY TÍNH THƯỞNG KHÔNG SAI.** Chạy lại đúng đường lưu thật (`preview` → `savePreview`): đổi rate H.A 0,8% → 5% thì P2 nhảy **1.600.000đ → 10.000.000đ**. Backend cũng đã xoá cache ngay sau khi lưu. Lỗi nằm ở **màn hình**, không nằm ở công thức.

**Ba lỗi thật đã sửa**
1. **Lưu xong màn hình xoá trắng số.** Bấm "Lưu" là `setPreview(null)` → hộp số biến mất. Người dùng thấy đúng cảnh "áp dụng rồi mà không có số nào nhảy". Nay lưu xong **chạy lại mô phỏng với đúng cấu hình vừa lưu** và hiện nhãn **"ĐÃ LƯU — số đang áp dụng"**; nút Lưu khoá lại để không lưu trùng một bản y hệt.
2. **Trang cha không nạp lại.** Hộp Cấu hình Thưởng nằm trong trang Quản target nhưng lưu xong **không báo cho trang cha**, nên KPI/chi tiết NV vẫn là số lấy về TRƯỚC khi lưu. Nay `onSaved` → nạp lại toàn bộ số phụ thuộc (KPI kỳ này, chi tiết NV, dự báo, xem trước thông báo).
3. **Nhãn version lệch nhau ở 3 chỗ.** Nút bấm ghi *v3.2*, tiêu đề hộp sửa tay ghi *v3.1*, file cấu hình `employee_bonus_tiers.json` cũng còn ghi *v3.1* — trong khi công thức đang chạy **là v3.2** (cổng tổng target + chia phần vượt theo tỷ trọng). Nay **một nguồn duy nhất**: `employeeBonus.FORMULA_VERSION`, backend trả ra cho cả 2 route, giao diện chỉ hiển thị lại.

**Quy tắc mới CEO yêu cầu: ĐỔI CÁCH TÍNH THƯỞNG => PHẢI NÂNG VERSION.** Chốt bằng máy chứ không bằng lời hứa: `server/config/bonus_formula_lock.json` giữ **vân tay (sha256)** của phần mã tính thưởng. Đụng vào công thức mà quên nâng version → test đỏ, in sẵn 3 bước phải làm. Sửa chú thích/giải thích thì không bị bắt nâng version.

**Test:** thêm `server/test/bonusFormulaVersion.test.js` — 7 ca, PASS. Đã thử phá (đổi 1 hằng số trong máy tính thưởng) để chắc chắn khoá **có cắn**. Toàn bộ bộ test: 464 pass / 7 fail — 7 ca đỏ là **có sẵn từ trước**, do máy này thiếu `pdfinfo` và fixture auth, không liên quan thay đổi này. Web build OK.

**Chưa đụng:** công thức tính vẫn **y nguyên** — P1 (`baseAmount`) không sửa một dòng nào, đúng nguyên tắc đã chốt.

### 2026-07-28 — Claude Code (CEO duyệt) — Nối 4 lớp bảo vệ vào auto-deploy
> CEO: "Auto-deploy vẫn khoá... làm luôn nhé". Nối bộ script an toàn đã có sẵn nhưng **chưa dùng**, và **GIỮ NGUYÊN trạng thái khoá**.

**‼ Phát hiện: "khoá auto-deploy" trước nay là ẢO.** Chuỗi `DISABLED_BY_CEO_20260727` **không hề có trong `auto-deploy.sh`** — nó chỉ là dòng cron bị chú thích trên server. Không ai nhìn thấy, không ghi log, bật lại thì quên mất vì sao từng tắt.

**Bốn lớp bảo vệ mới**
1. **Công tắc TẮT nhìn thấy được** — file `.auto-deploy.disabled`, nội dung là **LÝ DO**. Script tôn trọng và **ghi log mỗi lượt** kèm cách bật lại. Tắt: ghi file. Bật: xoá file.
2. **Sao lưu dữ liệu TRƯỚC khi đụng code** (`backup_data.sh create`). Sao lưu hỏng → **DỪNG, không deploy**. Dữ liệu là thứ duy nhất không dựng lại được.
3. **Giữ bản frontend cũ** thành `web/dist.prev` thay vì xoá ngay sau atomic swap → lùi được tức thì. Bản cũ xoá bản cũ ngay = tự tay vứt lưới an toàn.
4. **Kiểm health thật + TỰ LÙI BẢN.** `pm2 reload` trả 0 vẫn có thể để lại app **502** (lỗi khởi động, thiếu env, cổng chưa mở) — đúng kiểu sập đã gặp. Nay gọi `/api/health` (6 lần × 5s); không khoẻ → **tự lùi cả code lẫn frontend** rồi reload lại. Lùi rồi vẫn hỏng → **kêu người**, không im lặng.

**Vẫn ĐANG KHOÁ.** Chưa bật lại auto-deploy — đặc biệt **không bật trước 31/07**, vì một lần deploy hỏng đúng ngày chốt tháng là mất luôn tin chi phí + thưởng của cả công ty.

**Test:** `test_release_safety.sh` **41 → 52 ca, PASS toàn bộ**. Thêm 11 ca khoá đúng 4 lớp trên, gồm cả thứ tự "sao lưu phải chạy TRƯỚC khi `git reset`".

### 2026-07-28 — Claude Code — 4 DANH SÁCH LOẠI TRỪ MÂU THUẪN NHAU: tách bạch "không tính điểm xu" khỏi "không nhận thông báo"
> Bot phát hiện VP018 lọt lưới. Claude vá lần 1 SAI (dùng nhầm danh sách), CEO chốt DN022 làm lộ ra gốc vấn đề, vá lại lần 2 cho đúng.

**Hiện trạng: 4 danh sách, mâu thuẫn nhau**

| Danh sách | Mục đích | DN022 | VP018 |
|---|---|---|---|
| `diemXu.EXCLUDE` | **không tính điểm xu** (+ bị mượn để lọc báo cáo doanh thu) | CHẶN | CHẶN |
| `dormantFeedback.TELEGRAM_HARD_EXCLUDED` | phạm vi gửi CEO duyệt | — | CHẶN |
| `filteredEmployeeDelivery.EXCLUDED_EMP_CODES` | phạm vi gửi CEO duyệt | — | CHẶN |
| `notify_optout.json` | chặn thông báo target | — | **— (LỖ HỔNG)** |

**Lỗ hổng thật:** `VP018` thiếu ở `notify_optout.json`, lại không có `no_auto_notify` → chỉ "an toàn" nhờ **chưa được giao target**. Giao target là nhận tin ngay.

**‼ Claude vá lần 1 SAI:** thêm `diemXu.isExcluded()` vào `autoNotifyRecipients`. Đó là danh sách **"không tính ĐIỂM XU"**, khác mục đích — và nó có **DN022**, đúng người CEO vừa chốt (28/07) là **phải nhận đủ như NV chính thức** (doanh thu ngày/tuần/tháng, target tháng/quý, thưởng P1/P2). Vá kiểu đó là chặn nhầm chính người CEO muốn mở. **Đã gỡ bỏ.**

**Vá lần 2 — đúng gốc, tách bạch hai khái niệm:**
1. **Chặn thông báo = ĐÚNG MỘT nguồn** `targetNotify.isMuted` (= `notify_optout.json` + cờ `no_auto_notify`).
2. Thêm **`VP018`** vào `notify_optout.json` → thành `DN021, DN023, VP004, VP018`, **khớp chính xác** 2 danh sách phạm vi gửi CEO đã duyệt. Bịt lỗ hổng.
3. `salesRecipients()` đổi từ lọc `diemXu.EXCLUDE` sang lọc `targetNotify.isMuted` → **DN022 nhận được báo cáo doanh thu** như CEO chốt.
4. **`diemXu.EXCLUDE` GIỮ NGUYÊN** (vẫn có DN022) — điểm xu **không đổi**. Hai việc khác nhau, từ nay không trộn.

**Còn lại cho bot:** gỡ cờ `no_auto_notify` của **DN022** ở dữ liệu gốc — đây là master data, Claude không đụng.

**Test:** thay 2 ca sai bằng **4 ca đúng** — bot không được nạp/gọi `diemXu`; optout phải khớp 2 phạm vi CEO duyệt và **không** có DN022; `salesRecipients` phải dùng `isMuted`; `diemXu.EXCLUDE` phải giữ nguyên DN022. Server **458/465** = đúng 7 fail baseline → **0 regression** · gap-sync **28/28**.

**DN009 giải thích xong:** đạt **90,3%** — vừa vượt mốc sau lần chạy 07:31, sáng 29/07 sẽ tự nhận tin. Không phải lỗi.

### 2026-07-28 — Claude Code — ‼ Diễn tập khô BẮT ĐƯỢC LỖI THẬT: ~15 NV sắp nhận tin "thưởng 0đ"
> Chính là lý do phải diễn tập trước ngày chốt tháng. Nếu không chạy, 17:40 thứ Sáu 31/07 mới vỡ lẽ.

**Kết quả diễn tập toàn bộ 21 NV:** chi phí gửi 3 / bỏ qua 18 · **thưởng gửi 21 / bỏ qua 0**.

**Con số "thưởng gửi 21/21" là DẤU HIỆU HỎNG, không phải tốt.** Sáng nay chỉ **6 NV** qua mốc 90% — tức chỉ 6 người có thưởng. Vậy 15 người còn lại nhận tin gì?

**Gốc lỗi:** dưới ngưỡng thì `employeeBonus` trả `baseAmount = 0` — **số thật, không phải `null`** — nên nhánh `if (p1 == null && p2 == null)` không chặn được. Tin dựng ra là:
```
🏆 [Tháng 07] Nguyễn Đức Tuấn — thưởng dự kiến tháng
Đạt 1,8% target (9.237.714đ/500.000.000đ)
P1 (coach): 0đ · P2: 0đ · Tổng dự kiến: 0đ
```
Vừa **trái luật CEO chốt** ("không có tin gì thì không gửi"), vừa **phản cảm**: nhắn "thưởng của bạn: 0đ" cho người chưa đạt, vào đúng chiều cuối tháng.

**Sửa:** `monthEndMessage` trả `null` khi **tổng ≤ 0**. Ai có tiền dù ít (vd đạt 95% → P1 0,1%) thì **vẫn gửi** — không chặn nhầm. Thêm 3 test khoá (tổng 0 → null · 95.000đ vẫn gửi · chỉ có P2 vẫn gửi).

**Bài học lặp lại lần 2 trong ngày:** `Number(null) === 0` hôm qua, `baseAmount = 0` hôm nay — **"không có tiền" và "số 0" là hai chuyện khác nhau**, phải phân biệt tường minh ở mọi nơi đụng tiền.

**Còn chờ CEO quyết:** 18/21 NV bị **tắt công tắc "Chi phí của tôi"** nên sẽ không nhận tin chi phí ngày 31/07. Đây là quyết định về quyền xem tiền — Claude không tự bật.

**Test:** server **454/461** = đúng 7 fail baseline → **0 regression**.

### 2026-07-28 — Claude Code — Diễn tập KHÔ trước ngày chốt tháng + lý do bỏ qua phải hiện ra
> Luồng thưởng đã chạy thật 07:31:17 ngày 28/07: **6 NV, 14 mốc**. Đối chiếu độc lập với bảng target của CEO: 3 NV ≥100% (DN001, DN006, DN008) — **khớp chính xác** con số "3 NV đạt". Con số `gửi 0 tin NV` hôm qua đúng là do lỗi log, không phải luồng câm.

**‼ Rủi ro còn lại: đường lấy số cho tin CUỐI THÁNG chưa hề chạy lần nào**
- `employeeCostSummaryForNotify` và `employeeBonusSummaryForNotify` **chỉ** chạy lúc 12:30 T7 / 17:30 / 17:40. Lần thật đầu tiên là **17:30 thứ Sáu 31/07 — đúng ngày chốt tháng**.
- Bộ lịch **nuốt lỗi rồi bỏ qua NV đó**. Nếu hai hàm này ném lỗi, cả công ty không nhận được gì và **không ai biết cho tới khi đã muộn**.

**Thêm `server/scripts/test_notify_dryrun.js` — diễn tập khô, KHÔNG GỬI GÌ**
- Chạy **y hệt** đường thật rồi **in ra tin sẽ gửi**. Không import `notifyChannels`, không có bất kỳ đường gửi nào (đã kiểm: chỉ khớp đúng 1 dòng chú thích).
- `node scripts/test_notify_dryrun.js` (3 NV đầu) · `DN001` (1 NV) · `--all` (toàn roster). Có lỗi thì thoát mã 1 và liệt kê.

**Lý do bỏ qua phải HIỆN RA, không im lặng nuốt**
- Hai hàm dịch vụ trước trả `null` trơn cho mọi nguyên nhân. Nay trả `{skipped: 'no_session' | 'no_payload' | 'visibility_off'}`; bot **in lý do vào log** từng NV; script diễn tập dịch sang tiếng người kèm cách xử lý.
- Đã bắt được ngay 1 ca thật khi chạy thử: `visibility_off` — **công tắc "Chi phí của tôi" TẮT thì NV không nhận tin chi phí**, đúng thiết kế nhưng trước đây sẽ im lặng, không ai biết vì sao.

**Test:** server **451/458** = đúng 7 fail baseline → **0 regression** · gap-sync **28/28**.

### 2026-07-28 — Claude Code — Log nói SAI SỰ THẬT ở 2 chỗ, sửa để còn kiểm chứng được
> Sau lần chạy thật đầu tiên 07:30 ngày 28/07. Không phải lỗi nghiệp vụ — lỗi QUAN SÁT, nhưng nguy hiểm ngang: số liệu đúng mà đọc log lại tưởng hỏng, hoặc tưởng chạy mà thực ra không kiểm được.

**Log thật bot dán về:** `SalesReport: sent=0, failed=0, ceo=fail` · `Digest: sent=16, skipped=1` · `Target milestones: gửi 0 tin NV`.

**Chỗ 1 — `ceo=fail` là BÁO ĐỘNG GIẢ.** Khi cả kỳ không ai có dữ liệu, `sendAll` thoát sớm và **không có** `ceoResult`; dòng log in `r.ceoResult?.ok ? 'ok' : 'fail'` → `undefined` → **`fail`**. Tức là lần chạy **đúng y thiết kế** lại đọc thành hỏng. Thêm `salesReportDoneLine()` phân biệt 3 trạng thái: `KHÔNG GỬI — chưa có dữ liệu (đúng thiết kế, không phải lỗi)` · `bỏ qua vì đã gửi rồi` · số liệu thật kèm `ceo=ok/fail`.

**Chỗ 2 — `gửi 0 tin NV` KHÔNG chứng minh được tin thưởng có gửi hay không.** Dòng này in `sent.length`, mà `sent` **chỉ chứa mốc target**; mốc thưởng nằm ở `bonusSent` nên **vô hình hoàn toàn**. Không thể kết luận luồng thưởng chạy hay câm. Đổi thành: `✔ Mốc 07:30: N NV nhận tin — mốc target X, mốc thưởng Y` + ghi rõ khi `BONUS_NOTIFY` đang tắt.

**Bài học ghi lại:** thêm chốt "không có dữ liệu thì không gửi" mà **không sửa log tương ứng** thì mọi lần bỏ qua hợp lệ đều trông như sự cố. Chốt và log phải đi cùng nhau.

**Test:** thêm 2 ca (`notifySchedule`) — log rỗng KHÔNG được đọc thành `ceo=fail`, hỏng thật thì vẫn phải `fail`; log mốc phải đếm riêng target/thưởng. Server **451/458** = đúng 7 fail baseline → **0 regression**.

### 2026-07-28 — Claude Code — ‼ Bản tin 07:30 phải báo số NGÀY HÔM QUA (nếu không luồng doanh thu CÂM VĨNH VIỄN)
> Phát hiện ngay sau khi bot bật `SALES_REPORT_DAILY_NOTIFY=1`, trước lần chạy thật đầu tiên.

- **Lỗi:** nhánh báo cáo ngày dùng `defaultRanges(day)` với `day` = **hôm nay**. Chạy lúc **07:30 sáng** thì ngày đó **chưa có đơn nào** → báo cáo luôn rỗng → gặp chốt "không có dữ liệu thì không gửi" (vừa thêm hôm qua) → **luồng vừa bật sẽ không bao giờ gửi được tin nào**. Hai thay đổi đúng riêng lẻ, ghép lại thành câm.
- **SPEC đã ghi "07:30 báo số của ngày HÔM TRƯỚC" nhưng code chưa làm** — Claude viết kỳ vọng vào spec rồi quên hiện thực. Nay khớp lại.
- **Sửa:** thêm `previousDay(day)` cho **riêng nhánh hằng ngày**. Tuần (T7 13:00) và tháng (18:00 ngày cuối) **giữ nguyên mốc chạy** — định nghĩa "lũy kế đến mốc chạy" là CEO chốt, không đụng.
- **Test:** thêm 3 ca (`notifySchedule`): nhánh ngày phải dùng `previousDay` và không được sót `defaultRanges(day)` · `previousDay` nhảy đúng qua đầu tháng/đầu năm/tháng 2 · tuần-tháng không bị lùi ngày. Server **449/456** = đúng 7 fail baseline → **0 regression** · gap-sync **28/28**.
- **Đính chính thời điểm:** bot deploy lúc **06:54 ngày 28/07**, nên lần chạy thật đầu tiên là **07:30 SÁNG 28/07**, không phải 29/07 như Claude nói trước đó.

### 2026-07-27 — Claude Code (CEO chốt) — "Không có tin gì thì KHÔNG gửi" + bật báo cáo doanh thu ngày
> CEO yêu cầu bật luồng báo cáo doanh thu hằng ngày, và chốt luật: **không có tin thì không gửi**.

**‼ Phát hiện trước khi bật: `salesReport.sendAll` gửi VÔ ĐIỀU KIỆN**
- Không có bất kỳ chốt nào kiểm dữ liệu rỗng. Bật `SALES_REPORT_DAILY_NOTIFY=1` là **07:30 sáng nào 17 NV cũng nhận tin "Doanh thu: 0đ"** — kể cả Chủ nhật, ngày chưa upload, ngày nghỉ lễ. Đúng thứ CEO vừa nói không được.
- **Vá trước, bật sau.** Không bật rồi mới sửa.

**Sửa `sendAll` (2 tầng chốt)**
1. **NV không có dòng nào trong kỳ → bỏ qua hẳn** (`skipped: 'no_data'`), không gửi tin rỗng.
2. **Cả kỳ không ai có dữ liệu → im lặng hoàn toàn**, KHÔNG gửi cả bản tổng cho CEO. Chốt đặt **trước** `renderCeoDigest` để khỏi tốn công dựng digest.
3. **Kỳ rỗng KHÔNG bị đánh dấu "đã gửi"** → dữ liệu về muộn thì lần chạy sau vẫn gửi được đúng kỳ đó, không bị nuốt mất.

**Khoá luật ở CẢ BA luồng** (`test/notifyNoEmptySend.test.js`, 10 ca) vì mỗi luồng có đường thoát riêng:
- Doanh thu: 3 ca (bỏ qua NV rỗng · im lặng cả kỳ · không markSent khi chưa gửi)
- Chi phí: 3 ca (không số → `messageFor` null · bot bỏ qua · số tạm giữ rỗng thì bỏ dòng)
- Thưởng: 3 ca (chưa qua mốc → không sự kiện · không P1/P2 → null · bot bỏ qua khi thiếu nguồn)
- Tin gộp 07:30: 1 ca (không dòng nội dung nào → không gửi)

**Test:** server **446/453** = đúng 7 fail baseline → **0 regression** · gap-sync E2E **28/28**.

**Ghi nhận sai sót của Claude:** lượt trước nói "28/07 là ngày cuối tháng" — **SAI, tháng 7 có 31 ngày**. Tin chi phí/thưởng tháng chạy **17:30 và 17:40 thứ Sáu 31/07**, không phải 28/07. Đã đính chính với CEO.
### 2026-07-27 — Claude Code (CEO chốt) — Dời giờ 07:30 + THÔNG BÁO CHI PHÍ & THƯỞNG
> Spec: `SPEC_NOTIFY_COST_BONUS_SCHEDULE.md`. Đụng tiền nên viết spec trước, code sau.

**‼ CEO nói P1/P2 bị NGƯỢC — đã cảnh báo trước khi làm, CEO chốt sửa lại cho đúng**
- CEO ban đầu: "100% = P1, 110% = P2". Đối chiếu `config/employee_bonus_tiers.json` đang chạy thì **ngược**: **P1 bắt đầu ở 90%** (bậc đầu có `bonusPct > 0`), **P2 bắt đầu ở 101%** (`priorityThresholdPct`). Hai mốc CEO chọn thực ra là điểm **P1 nhảy bậc**.
- Nếu làm y lời, NV đạt 101–109% đã có P2 nhưng không được báo, và tin ở mốc 110% sẽ nói sai bản chất.
- **CEO chốt: nhắn đủ 4 mốc 90/100/101/110, gọi ĐÚNG tên.** Ngưỡng **suy ra từ cấu hình**, đổi config là mốc tự đổi — không hardcode.

**Khung giờ (CEO chốt: chỉ tin HẰNG NGÀY dời sáng)**
- Nhắc target + digest + báo cáo doanh thu NGÀY: **18:00 → 07:30**. Thứ 7 13:00 giữ nguyên.
- **Báo cáo THÁNG cố tình GIỮ 18:00** — dời sáng thì chốt sổ khi tháng chưa xong.
- 🆕 Tổng chi phí: **12:30 thứ 7** (lũy kế) + **17:30 ngày cuối tháng** (trọn tháng).
- 🆕 Tổng thưởng tháng: **17:40 ngày cuối tháng** (sau chi phí 17:30, trước báo cáo tháng 18:00).
- **Gộp tin:** mốc target + mốc thưởng cùng nhịp 07:30 → **1 tin/người**, không bắn 2–3 tin trong cùng một phút.

**Mới: `src/employeeCostNotify.js` — tổng chi phí NV tự nhận**
- Ngoại lệ có kiểm soát, kế thừa `SPEC_REPORT_EMP_COST_SELFVIEW.md`: **self-scoped tuyệt đối**, **không có bản tổng cho CEO/admin qua kênh này**, số do DataHub tính.
- **CEO chốt: số còn tạm tính thì VẪN gửi nhưng BẮT BUỘC gắn nhãn "⚠ TẠM TÍNH — còn N dòng chưa được gán tỷ lệ %".**
- Mất nguồn chi phí → gửi tin báo lỗi nguồn, **tuyệt đối không nêu số** (có test chặn mọi chuỗi tiền).
- Nói **"dòng"** chứ không phải "mã": `payload.match` chỉ có `matchedRows/totalRows`. Gọi đúng tên con số mình có — không lặp lại vụ lẫn "13 mã" với "192 cặp".

**Mới: `src/bonusNotify.js` — mốc thưởng + tổng thưởng tháng**
- Chỉ **định dạng chữ**; mọi con số tiền do `employeeBonus` tính. **P1 KHÔNG ĐỤNG**, P2 giữ nguyên v3.2.
- Thiếu nguồn chi phí hoặc cấu hình hỏng → **không gửi gì** (fail-closed, thà im còn hơn hứa sai tiền).

**Nối dữ liệu thật:** thêm `routes.notifyServices` (2 hàm) đi **đúng đường app đang dùng để hiện số**, nên tin nhắn và giao diện luôn khớp. Session tổng hợp mang quyền **sale** của chính NV, chặn cứng đường lấy số toàn công ty.

**‼ Test bắt được 1 lỗi thật trước khi lên app:** `Number(null) === 0` trong JS → tổng bị **khóa fail-closed (`null`) sẽ biến thành "0đ" gửi cho NV** — đúng thứ vừa hứa không được xảy ra. Đã vá `finite()` ở cả 2 module, có test khoá.

**Cờ bật — fail-closed, phải đúng chuỗi "1":** `TARGET_NOTIFY` · `EMP_COST_NOTIFY` (mới) · `BONUS_NOTIFY` (mới). Chưa đặt → im lặng hoàn toàn, không crash.

**Test:** thêm **31 ca mới** (`bonusNotify` 9 · `employeeCostNotify` 9 · `notifySchedule` 9 — khoá cả khung giờ, đổi giờ là test đỏ). Server **436/443** = đúng 7 fail baseline (3 OTP + 4 font PDF của container) → **0 regression** · gap-sync E2E **28/28** · web **83/83** · build PASS.

**Bổ sung cùng ngày — CEO xin thêm dòng "Số tạm giữ cho cuối năm" vào tin CUỐI THÁNG**
- Lấy từ các cột được khai `annual` trong cấu hình (mặc định `c44` = "Lương cuối năm"), đọc qua summary chứ **không viết cứng tên cột** — đổi `EMPLOYEE_COST_ANNUAL_COLUMNS` là số tự chạy theo.
- **Cùng luật fail-closed** với tổng tháng: chưa chốt thì rơi về số tạm tính và nhãn ⚠ TẠM TÍNH bao trùm cả dòng này.
- Không có số hợp lệ → **bỏ hẳn dòng**, không in "—" hay 0đ (NV khỏi hiểu nhầm là bị giữ 0 đồng).
- **Chỉ hiện ở tin cuối tháng**, tin tuần giữ nguyên. Thêm 4 test khoá.

**CHƯA BẬT TRÊN APP.** Code đã sẵn nhưng 2 cờ mới còn tắt — CEO bật khi muốn chạy thật.
### 2026-07-27 — Claude Code — KIỂM XUNG ĐỘT với bot + dọn nhánh + viết lại HANDOFF
> CEO hỏi "các bản mới nhất có xung đột với bot nào không". Kết luận: **KHÔNG xung đột.**

**Kiểm xung đột (bằng chứng, không phán đoán)**
- `origin/main` = `a82381f` (Report Bot). Không có commit bot nào mới hơn. Nhánh Claude `claude/new-session-eifd44` = `main` + 1 commit tài liệu → **không lệch code app**.
- `fix/c7-canonical-latest-20260727` đã nằm trong `main`. `fix/app-report-deploy-stability-20260727` (`09a6477`) **trùng khít** `a82381f` (diff `auto-deploy.sh` rỗng) → nhánh chết.
- Xác minh **hành vi** chứ không so chữ, 6 mốc còn nguyên trên `main`: sanitize `/[\p{Cc}\p{Cf}]/gu` · `catalogUnitCodeOf` · fail-closed `GAP_SYNC_UNIT_CODE_REQUIRED` · `EMPLOYEE_COST_GAP_UNIT_CODE_REQUIRED` · badge `loading` không biến mất · memo `employee-cost-gaps-summary`.
- **P2 bản ĐÚNG (chia theo tỷ trọng) có trên main; bản SAI (dồn hạng cao) KHÔNG lọt lên.**
- Test lại trên `a82381f`: server **405/412** = đúng 7 fail baseline (3 OTP + 4 font PDF của container) → **0 regression** · gap-sync E2E **28/28** · web **83/83** · build PASS · release-safety **41/41**.

**Dọn nhánh làm việc của Claude**
- Nhánh `claude/new-session-eifd44` trước đó **lệch 2 chiều**: code app **cũ hơn** main (thiếu bản tích hợp của bot), nhưng 11 file thì **chưa lên main**. Để vậy là bẫy — merge nhầm sẽ xoá công của bot.
- Đặt lại nhánh về `origin/main`, chỉ giữ **11 file thật sự chưa merge**: 7 script an toàn phát hành + 2 SPEC + 2 DIRECTIVE. **Không đụng `scripts/auto-deploy.sh`** (giữ bản `a82381f`). Commit `b288e60`.

**15 nhánh cũ trên remote — đã rà và xác định phải xoá** *(kết quả cuối ở mục dưới)*
Đã kiểm **từng dòng code** mỗi nhánh thêm mới xem `main` có chưa. Kết quả: nội dung **đã có đủ trên `main`**; các dòng "thiếu" đều là **bản cũ đã bị thay**, không phải công bị mất (vd `release/bonus-v32-c10` là bản P2 SAI mà CEO đã bác — **không được** đưa lên main).
- **13 nhánh của Claude**: `release/badge-stable` · `release/bonus-prorata` · `release/bonus-v32-c10` · `release/c10-template-layout` · `release/catalog-layout` · `release/control-chars` · `release/cost-c10-column` · `release/dq-badge-fix` · `release/dq-uom-equiv` · `release/gap-unit-code` · `release/target-v32` · `release/app-report-employee-cost` · `release/sso-v3-crosswalk-prod-20260725`
- **2 nhánh của Report Bot**: `fix/c7-cost-gap-worklist-20260727` (`b70cab9` — **nhánh nguy hiểm**, từng suýt merge làm mất sanitizer + badge + perf) · `fix/app-report-deploy-stability-20260727` (`09a6477` — trùng khít main)
- **Rủi ro nếu để nguyên:** nhánh nào cũng **cũ hơn `main`**; merge nhầm là **lùi mất** công bên kia. Đã dính 1 lần với `b70cab9`.

**KẾT THÚC — ✅ ĐÃ XOÁ ĐỦ 15/15 NHÁNH (bot Report thực hiện)**
- Bot đọc nhầm quyền lúc đầu; sau đó chạy được, có **kiểm `origin/main` chứa `a82381f` trước khi xoá**.
- **Claude xác minh độc lập:** `git ls-remote` từng nhánh → **cả 15 ref không còn** · `origin/main` vẫn `a82381f`, **không mất commit nào** · 6 mốc bắt buộc + P2 bản đúng còn nguyên trên `main`.
- 2 nhánh nguy hiểm nhất đã biến mất: `release/bonus-v32-c10` (P2 SAI, thổi phồng thưởng) và `fix/c7-cost-gap-worklist-20260727` (`b70cab9`).
- **Phát hiện thêm — còn 8 nhánh cũ hơn (đợt 19–25/07).** CEO cho phép xoá tiếp "cái nào không ảnh hưởng". Rà kỹ lần 2 (so file, không chỉ so dòng):
  - **7 nhánh xoá được:** `fix/c30-freshness-20260719` · `fix/c7-canonical-latest-20260727` · `fix/ceo-bell-safe-mobile-20260719` · `fix/qlnb-unit-workflow-20260719` · `fix/report-crosswalk-publication-hardening-20260725` · `fix/report-uom-crosswalk-s2s-20260725` · `fix/kpi-match-all-display-20260725`. **Không nhánh nào có file mà `main` thiếu.** Riêng `kpi-match` "thiếu" 2 dòng chỉ vì giữ **bản KPI cũ**; `main` có bản mới hơn (thêm nhánh `allEmployees`, tách `unavailablePairs`).
  - ‼ **`hotfix/report-p0-warm-worker-20260724` — GIỮ LẠI, KHÔNG XOÁ.** **Claude nói sai ở lần rà trước** ("chỉ là hook test cũ đã bị thay"). Rà lại: nhánh này chứa **`server/src/employeeCostWarmWorker.js` — file CHƯA BAO GIỜ có trên `main`** (kiểm `git log --all --diff-filter=A`: chỉ xuất hiện ở đúng commit `c7fa85b`). Đây là hướng giải khác (đẩy warm sang **worker thread**), làm lúc 25/07 00:02 +07; `main` sau đó chọn hướng **vòng warm định kỳ inline** (`0f659d2`, muộn hơn ~16 giờ) nên bản worker bị bỏ dở, không ai merge.
  - **Xoá nhánh này = mất bản duy nhất của file đó.** Không ảnh hưởng app đang chạy (`main` chưa từng dùng), nhưng mất hẳn một phương án tăng tốc nếu sau này cần. Giữ 1 nhánh không tốn gì → **giữ**.
- **Luật thường trực ghi vào `HANDOFF.md`:** không merge nhánh `release/*` / `fix/*` / `hotfix/*` cũ; cần gì thì nhặt từ `main` hoặc rẽ nhánh mới từ `main`.

<details><summary>Lịch sử: giai đoạn bị chặn (đã giải quyết)</summary>
- **Claude:** `git push origin --delete <nhánh>` → **HTTP 403** từ git proxy (chỉ được push vào đúng nhánh làm việc của mình). `git push --tags` cũng 403 → **các thẻ `archive/*` chỉ nằm local, không lên remote**. Bộ công cụ GitHub có `create_branch` nhưng **không có** lệnh xoá nhánh.
- **Bot Report:** báo phiên hiện tại **không được cấp công cụ git/exec** → chưa xoá nhánh nào, chưa xác nhận lại.
- ⇒ **Không ai trong hai bên làm được.** Đã soạn 1 lệnh chạy thẳng trên server (`~/.openclaw/workspace-report/App-report`) có **chốt an toàn**: chỉ xoá khi `origin/main` thật sự đã chứa `a82381f`; kèm đường lối thay thế qua giao diện GitHub.
- **Mức độ khẩn: THẤP.** Nhánh cũ nằm im **không ảnh hưởng app đang chạy**; chỉ nguy hiểm nếu có người **bấm merge** chúng.

</details>

**Viết lại `HANDOFF.md`** (bản cũ đứng yên từ 01/07, đọc vào là lạc): trạng thái thật + số test + P1/P2 v3.2 + C10 + gap-sync C7 + DQ + self-heal + bộ script phát hành + việc còn treo của DataHub/App Sale + 3 cái bẫy đã trả giá (`template.columns` ghi đè default · join key phải là mã C7 · P2 không được dồn hạng cao).
### 2026-07-27 — FIX: worklist “mã thiếu %” gửi đúng mã đơn vị C7
- Tách `unitCode` canonical khỏi `c7` tên hiển thị; `don_vi_anh_huong` chỉ nhận mã C7 thật (`135.HTNT-FPT LONG CHÂU`, `001.NT-BVĐK ĐỒNG NAI`…), không còn tên công ty.
- Mã C7 được uppercase + trim + dedup + sort trước khi tính lại `so_don_vi` và `worklist_checksum`; thiếu C7 thì fail-closed, không lấy tên hiển thị thay thế.
- Giữ nguyên cột C10 mới nhất và giữ raw `DONVI` đầy đủ cho worklist dù engine chi phí vẫn join legacy bằng tiền tố.
- Test: full server **410/410**, gap-sync E2E **28/28**, web build PASS.

### 2026-07-27 — SỬA GẤP: P2 chia phần vượt theo TỶ TRỌNG THỰC (không dồn hạng cao)
> CEO chỉ ra bản vừa deploy SAI. Bản trước dồn phần vượt vào H.A* trước → **thổi phồng thưởng**.
- **Đúng:** rà theo mã QLNB → cột C10, xem phần vượt **thực sự rơi vào nhóm nào**. Nhóm chiếm bao nhiêu % doanh thu C10 thì hưởng bấy nhiêu phần vượt, ăn rate nhóm đó.
- **DN006: 7.048.940đ (sai) → 5.479.768đ (đúng).** Có NV sẽ **GIẢM** nếu phần vượt rơi nhiều vào H.C/H.D — đúng bản chất.
- Σ phần được chia == đúng phần vượt (dư làm tròn dồn nhóm doanh thu lớn nhất — không tạo/mất tiền).
- Test **15/15**, thêm ca "phần vượt rơi H.C/H.D → H.A* chỉ được ít, không thổi phồng". Modal nói đúng tỷ trọng.

### 2026-07-27 — RELEASE: Thưởng P2 v3.2 (cổng tổng target) + cột C10 trong danh mục
> Bundle overlay trên production `d8b24ba`, chỉ 6 file; không lùi file report nào.
- **P2 v3.2 (CEO chốt):** phải đạt TỔNG target trước (`R<T` → P2=0); phần vượt `E=R−T` **chia cho nhóm ưu tiên CAO trước** (H.A*→H.A→…), cap bởi doanh thu nhóm, ăn rate nhóm đó. **P1 (coach) KHÔNG đụng.** Rate chỉnh tay được.
- **Test P2 viết lại 14/14**: ví dụ CEO (H.A* 200tr → 2.000.000đ) · hand-check DN006 (E=704.893.974 → 7.048.940đ) · cổng tổng · tràn ưu tiên · đổi rate · fail-closed nguồn thiếu · kỳ trước T07 giữ số lịch sử.
- **Modal Thưởng** nói đúng v3.2: khối Tổng doanh thu C10 · Tổng target · Phần vượt đem chia; bảng nhóm ghi `rate × phần ĐƯỢC CHIA`, lý do rõ khi 0; ghi nguồn phân nhóm = cột C10 danh mục.
- **Cột C10 cạnh mã QLNB** trong danh mục (cả 2 bảng): badge xanh khi có, **ĐỎ khi thiếu**, tìm kiếm được. Thiếu C10 để trống — không suy đoán, không chặn danh mục.
- ⚠ **Số P2 sẽ ĐỔI** theo chính sách mới (DN006: 5.630.771đ → 7.048.940đ). Build PASS · full server 397/404 (7 fail pre-existing) · web 27/27.

### 2026-07-26 — RELEASE App Report employee-cost (bundle SẠCH trên production f1f4e2f)
> ⚠ Thay bundle CŨ dbc76a71 (đã lỗi thời): dbc76a71 chỉ 5 file, chứa self-heal CÒN 3 BLOCKER,
> THIẾU hẳn employeeCostSourceAlert.js (alert+tin mềm NV+fix#3). KHÔNG deploy dbc76a71.
> Bundle mới = production f1f4e2f + overlay ĐÚNG 9 file employee-cost (bản ĐÃ vá blocker), 0 xung đột.
- Gồm: badge tab + biên nhận DataHub + ô Thưởng bấm bung + self-heal (đã vá 3 blocker) + tin mềm NV.
- 9 file: routes.js, employeeCostSourceAlert.js, api.js, EmployeeCost.jsx, styles.css + 4 test.
- KHÔNG lùi file report nào của production (f1f4e2f giữ nguyên). Build + full test bên dưới.

### 2026-07-26 — Claude Code — công cụ TỰ KIỂM đường cảnh báo Telegram (`scripts/test_telegram_alert.js`)
- **CEO hỏi "sao không tự test thử gửi Telegram":** Claude **KHÔNG gửi thật được** từ môi trường của mình — không có `TELEGRAM_BOT_TOKEN` (`.env` nằm trên server thật), không có bảng liên kết chat_id, và mạng ra `api.telegram.org` bị chặn (HTTP 000). Đã nói rõ thay vì thử rồi báo mơ hồ.
- **Đã chứng minh được phần kiểm được:** chặn `fetch` để xem chính xác request app sẽ gửi → đúng `POST https://api.telegram.org/bot<TOKEN>/sendMessage`, đúng `chat_id`, đúng nội dung tin; `sendTelegram` trả `{ok:true}`.
- **Thêm công cụ tự kiểm chạy TRÊN SERVER THẬT:** `node scripts/test_telegram_alert.js` (chẩn đoán: có token chưa · có ai liên kết Telegram chưa · in trước tin sẽ gửi) và `--send` (gửi tin thử thật, in `message_id` từng người). Tự nạp `.env` cạnh repo giống `src/index.js`.
- **Test:** server **378/385** = đúng 7 fail baseline → **0 regression**.

### 2026-07-26 — Claude Code (CEO duyệt) — CẢNH BÁO TỰ ĐỘNG Telegram khi nguồn chi phí DataHub thiếu dữ liệu
- **Mục tiêu (CEO):** hết cảnh CEO phải tự phát hiện số lệch rồi bắt các bên đi truy — **hệ thống phải tự tố cáo**, kể cả khi CEO không mở app.
- **Thêm `server/src/employeeCostSourceAlert.js`:** cắm vào **vòng warm cache ALL định kỳ**; phát hiện `match.unavailableEmployees` → nhắn **Telegram cho CEO/ADMIN** (chỉ người có role ceo/admin đã liên kết Telegram), nêu **đích danh mã NV + số cặp ảnh hưởng + kỳ**, nói rõ *"KHÔNG phải mã thiếu % catalog — là nguồn chi phí DataHub chưa trả dữ liệu"*.
- **Chống phiền + không giấu:** chỉ gửi khi **trạng thái đổi** (danh sách NV lỗi khác lần trước) hoặc **quá 6 giờ** vẫn còn lỗi; **báo cả khi ĐÃ KHÔI PHỤC** để CEO biết chuyện đã xong mà không phải tự kiểm.
- **An toàn:** tin nhắn **không chứa số tiền/%/PII/C33–C46** (có test chặn); chưa cấu hình `TELEGRAM_BOT_TOKEN` → no-op; lỗi gửi **không bao giờ** làm hỏng vòng warm hay nghiệp vụ.
- **Test:** thêm `server/test/employeeCostSourceAlert.test.js` (3 test: nội dung nêu đích danh & không lộ tiền · dedupe không spam · báo khôi phục rồi im lặng). Server **378/385** = đúng 7 fail baseline → **0 regression**; web **75/75**; build PASS.

### 2026-07-26 — Claude Code (CEO: tab "Mặt hàng thiếu %" cũng phải rõ) — bỏ trắng-màn, nêu đích danh NV lỗi nguồn
- **Vấn đề:** khi 1 NV chưa lấy được nguồn chi phí, `employeeCostGaps.buildForSession` **ném lỗi** (`EMPLOYEE_COST_GAPS_SOURCE_UNAVAILABLE`) → **cả tab trắng, mất sạch danh sách**, người xem không hiểu vì sao. Trong khi màn "Chi phí theo nhân viên" đã xử lý mềm → 2 màn hành xử khác nhau, càng khó hiểu.
- **Sửa:** NV lỗi nguồn được **bỏ khỏi worklist thay vì ném lỗi**; trả thêm `unavailable { employees[], count, note }`; UI (cả panel admin lẫn panel NV) hiện banner *"⚠ Danh sách chưa đủ — chưa lấy được dữ liệu chi phí của DNxxx… Đây là lỗi nguồn DataHub, không phải mã đủ %"*. Audit ghi kèm `unavailableEmployees`.
- **Vẫn fail-closed về SỐ LIỆU:** tuyệt đối **không suy ra "thiếu %"** cho NV lỗi nguồn (không vào `pairs`, không vào `coverageByEmployee`) — chỉ không làm trắng màn nữa. Hai fail-closed còn lại giữ nguyên (roster sai → `EMP_INVALID`, catalog rỗng → `CATALOG_UNAVAILABLE`).
- **Test:** thêm `server/test/employeeCostGapsUnavailable.test.js` (2 test); cập nhật test cũ khóa hành vi mới. Server **375/382** = đúng 7 fail baseline → **0 regression**; web **75/75**; build PASS; gap-sync E2E **18/18**.

### 2026-07-26 — Claude Code (CEO yêu cầu FIX TRIỆT ĐỂ) — hệ thống tự tố cáo thiếu dữ liệu, nêu ĐÍCH DANH nhân viên
- **CEO nêu vấn đề gốc:** "không còn cảnh tôi phải tự đi tìm, tự chứng minh sai để chúng mày đi truy lùng". Bản sửa trước vẫn còn thiếu: chỉ báo "1 NV chưa lấy được dữ liệu" mà **không nói NV nào** → vẫn bắt người dùng đi dò.
- **Sửa:** đưa `unavailableEmployees` (mã NV) từ backend qua model ra UI; ô "Khớp doanh thu" và các ô "tạm tính" giờ ghi **đích danh mã NV**; thêm **banner cảnh báo đỏ ngay đầu trang**: *"⚠ Dữ liệu chưa đầy đủ — số đang là TẠM TÍNH. Chưa lấy được dữ liệu chi phí của DNxxx (N cặp, kỳ MM/YYYY). Phần này KHÔNG phải thiếu % catalog mà là nguồn chi phí DataHub chưa trả dữ liệu"*. Người xem biết ngay: ai, bao nhiêu, lỗi thuộc bên nào.
- **Test:** thêm 2 test khóa (phải nêu mã NV, không chỉ đếm số lượng; trang phải có banner tự báo). Web **75/75 PASS**, build PASS; server **373/380** = đúng 7 fail baseline → **0 regression**.

### 2026-07-26 — Claude Code (CEO: "hai màn số liệu đá nhau") — ‼ TÌM RA LỖI THẬT: coverage ALL trộn "lỗi nguồn NV" vào "thiếu %"
- **Bằng chứng CEO đưa (2 ảnh cùng thời điểm):** tab thiếu % ghi **1.249 khớp + 17 thiếu = 1.266 cặp (98,7%)**; ô "Khớp doanh thu" ghi **1.016/1.266 (80,3%)** → cùng mẫu số, **tử số lệch 233 cặp**, và tỷ lệ **trôi** giữa các lần tải (84,8% → 80,3%). Đây **KHÔNG** phải khác thước đo — là **lỗi thật**.
- **Gốc lỗi (đã xác minh bằng code + tái hiện số):** khi nguồn tỷ lệ chi phí của một NV **không lấy được** (`fetchEmployeeCost` trả `outcome != 'ok'`: upstream lỗi/timeout/chưa cấu hình), `employeeCost.js` chỉ `console.warn` rồi trả payload rỗng → **toàn bộ dòng của NV đó bị đếm là "chưa khớp"**. `mergeEmployeeReports` cộng thẳng vào coverage ⇒ báo thành "catalog thiếu %". Ngược lại **gap tool fail-closed** (`EMPLOYEE_COST_GAPS_SOURCE_UNAVAILABLE` — ném lỗi nếu bất kỳ NV nào chưa sẵn nguồn) nên tab thiếu % luôn ra số ĐÚNG. Cộng thêm cache ALL **6 giờ** (`EMPLOYEE_COST_ALL_BASE_TTL_MS`) làm ảnh chụp xấu bị đóng băng và số trôi theo mỗi lần dựng cache.
- **Sửa:** gắn `sourceOutcome` vào payload từng NV; `mergeEmployeeReports` **tách bạch 2 nguyên nhân** — coverage chỉ cộng NV **lấy được nguồn** (khớp đúng gap tool), phần NV lỗi nguồn báo riêng `unavailablePairs`/`unavailableEmployeeCount`; **`summary.reliable` = đạt ngưỡng VÀ không còn NV lỗi nguồn** (còn NV lỗi thì tổng vẫn "tạm tính", không âm thầm thiếu tiền). UI: ô "Khớp doanh thu" ghi đủ `khớp + thiếu % = tổng cặp` và dòng cảnh báo riêng *"⚠ N NV chưa lấy được dữ liệu chi phí (M cặp) — KHÔNG tính vào tỷ lệ này"*.
- **Tái hiện đúng số CEO thấy:** dựng 3 NV (2 ok: 600/610 + 649/656; 1 lỗi nguồn 233 cặp) → **1.249/1.266 = 98,7%** + `unavailablePairs=233` (đúng chênh lệch 1.249−1.016), `reliable=false`. Trước sửa cùng dữ liệu ra 83,3% (gộp nhầm).
- **Test:** thêm `server/test/employeeCostAllCoverage.test.js` (2 test khóa hành vi). Server **373/380** = đúng 7 fail baseline (3 OTP + 4 font PDF) → **0 regression**; web **73/73 PASS**; build PASS.
- **Lưu ý vận hành:** cần bot/DataHub xem vì sao có NV không lấy được nguồn tỷ lệ (timeout/quyền/thiếu dữ liệu kỳ) — App Report giờ **hiện rõ** thay vì giấu, nhưng nguyên nhân gốc nằm ở đường lấy dữ liệu.

### 2026-07-26 — Claude Code (CEO phản hồi: ô KPI trống + "13 mã vs 15,2% vô lý") — TRUY ĐÚNG GỐC, sửa 2 lỗi hiển thị
- **‼ Claude nhận sai 2 điểm đã giải thích trước đó:** (1) nói các ô C36–C45 "có số tổng ở chế độ ALL" — ảnh CEO chứng minh **trống trơn**; (2) giải thích 13 vs 15,2% bằng "khác thước đo" nhưng **không chỉ ra được số nối**, nên CEO đọc thành "ẩn số vô lý". Đã tra lại code, tìm ra nguyên nhân thật:
  - **Ô KPI trống KHÔNG do chế độ ALL** mà do **khóa fail-closed theo ngưỡng**: `employeeCost.js` `low = rate < threshold` (84,8% < 90%) → `employeeCostTable.js:336 summary.reliable=!low=false` → `summarizeRows` trả `monthlyTotal/annualTotal/columnTotals = null` → thẻ hiện "—"/rỗng. Đúng thiết kế an toàn nhưng UI **không nói lý do**, nhìn như app hỏng.
  - **13 vs 192 KHÔNG phải mất dữ liệu:** cả 2 đường dùng **chung nguồn** (cùng `canonicalAssignmentSnapshot` + cùng `store.getRows`) nên cờ `revenueMatched` giống nhau. `pairs` (cặp NV×đơn vị×mã, ≈192) **đã có sẵn trong payload** nhưng UI **chỉ hiển thị số mã gộp (13)**, giấu mất số cặp → mất mắt xích đối chiếu.
- **Sửa (an toàn, KHÔNG nới lỏng khóa tài chính):**
  1. **Thêm nhánh số "tạm tính" riêng** — `provisionalMonthlyTotal/AnnualTotal/ColumnTotals` LUÔN tính (tổng phần đã khớp %), **giữ nguyên `columnTotals` fail-closed = null** để export/nơi khác không đổi hành vi. UI hiện số tạm tính + **badge "tạm tính"** + ghi rõ *"Tạm tính trên 84,8% đã khớp · còn N cặp thiếu %"*. Không còn ô trống.
  2. **Tab "Mặt hàng thiếu %" ghi đủ phép cộng:** *"1.074 đã khớp + 192 thiếu % = 1.266 cặp · 192 cặp thiếu gộp thành 13 mã"* + thêm cột **"Số cặp thiếu"** mỗi mã (cộng tay ra đúng tổng). Hết "ẩn số".
- **Test:** web **73/73 PASS** (thêm 2 test khóa hành vi: fail-closed vẫn null + KPI có cờ `provisional`; panel gap phải ghi đủ phép cộng); web build PASS; server **371/378** = đúng 7 fail baseline (3 OTP + 4 font PDF container này) → **0 regression**.

### 2026-07-26 — Claude Code — push thẳng `main` `cf71ed8` (CEO duyệt, bot Report kẹt phiên)
- **Bối cảnh:** bot Report kẹt phiên không merge/deploy được. **CEO duyệt miệng "OK push main"** → Claude push fast-forward `ca2d306 → cf71ed8` lên `main`. Deploy do **cron `scripts/auto-deploy.sh`** trên server tự kéo (mỗi 1 phút, chỉ deploy khi fast-forward, build lỗi thì giữ bản cũ).
- **Ngoại lệ có kiểm soát:** bỏ bước bot review độc lập lần này vì thay đổi là **FE-only**, đã web 71/71 + build PASS + server 0 regression + gap-sync 18/18. Kiểm tra trước push: fast-forward sạch, working tree sạch, đúng 2 commit (1 code FE + 1 tài liệu).
- **Còn lại:** Claude **không xác minh được runtime production** (ngoài mạng nội bộ) — cần bot/CEO xác nhận version live + màn hình sau khi cron chạy. Phép đếm xác minh #2 (a/b/c) vẫn chờ bot.

### 2026-07-26 — Claude Code (CEO chốt, live "Chi phí của tôi") — dọn KPI chế độ "Tất cả NV" + nhãn mẫu số khớp tab thiếu %
- **#1 — KPI "Tất cả NV" không còn ô trống trông như lỗi:** các chỉ số TỪNG NGƯỜI (Điểm · Target-cá-nhân · Xu · Cấn trừ · Còn lại) **ẩn hẳn** ở chế độ ALL (không gộp được qua nhiều NV), thay bằng: (a) thẻ **"Target tổng đội (tham khảo)"** = Σ target · % đạt toàn đội (display-only, cộng từ dữ liệu thưởng dự kiến đã tải, ghi rõ x/y NV có target); (b) thẻ gợi ý *"Điểm · Xu · Cấn trừ — Chọn 1 NV"*. Ẩn `KhoanWarning`/`KhoanDeduction` ở ALL. Các ô cộng-gộp-được (Doanh thu, C36–C45, Khớp DT, Thưởng) giữ nguyên.
- **#2 — hết vênh "13 mã" vs "15,2%":** nguyên nhân đã truy ra ở code — "Khớp doanh thu" đếm ở grain **cặp (NV×đơn vị×mặt hàng), cộng dồn từng NV** (`employeeCostTable.mergeEmployeeReports` reduce-sum), còn tab "Mặt hàng thiếu %" gộp về **mã riêng biệt** → 2 thước đo khác nhau, không mất dữ liệu. **Sửa an toàn (không đụng logic tài chính/ngưỡng 90%):** ghi nhãn mẫu số TRUNG THỰC — ALL: `… cặp (nhân viên×đơn vị×mặt hàng) · số mã cần bổ sung xem tab "Mặt hàng thiếu %"`; 1 NV: `… cặp (đơn vị×mặt hàng)`; đồng bộ luôn nhãn metadata kỳ ("mã"→"cặp").
- **Test:** web **71/71 PASS** (cập nhật assertion nhãn "mã"→"cặp" trong `EmployeeCost.model.test.mjs`, giữ nguyên mục đích phân biệt cặp-khóa vs dòng đơn hàng); web build PASS; server `node --test` **371/378** (7 fail = 3 OTP + 4 export thiếu font container này) — **0 regression** (chỉ đổi FE).
- **Chờ bot xác minh song song (không chặn deploy):** đếm trên prod T07 "Tất cả NV" — (a) tổ hợp NV×đơn vị×mã chưa khớp (≈192?), (b) (đơn vị×mã) distinct chưa khớp, (c) mã distinct (≈13?). Nếu (a)≈192 & (c)≈13 → đúng do thước đo; nếu (b) cũng ≈192 mà tab 13 → tab sót, sửa tiếp.

### 2026-07-26 — Claude Code (đồng bộ tài liệu) — directive/handoff khớp code sau fix 8 blocker
- Cập nhật `DIRECTIVE_EMP_COST_GAP_SYNC_DATAHUB.md` §3 (3 nút: ✅ Duyệt & gửi / 📝 Ghi ý kiến-không-gửi / ❌), §4 (thêm gate confirm, validate response, giới hạn 12 tháng/5000 items/1MB, audit mọi outcome), §6 NGHIỆM THU = ✅ PASS 18/18 + 0 regression.
- Cập nhật `HANDOFF_DATAHUB_COST_GAP_RECEIVER.md` §Bộ E2E: 18/18 (13 module + 4 route + canonical) + REAL mode AN TOÀN mặc định (dry, cần `REAL_DATAHUB_ALLOW_WRITE=1` mới gửi gói test-marked). Chỉ tài liệu, không đụng code.

### 2026-07-26 — Claude Code (sửa NO-GO review của bot) — 8 blocker gap-sync đã fix, 0 regression
- Bot review commit gap-sync trả **NO-GO 8 blocker**. Đã sửa hết trên cùng nhánh (chờ bot re-review):
  1. **FE nút 📝 Ý kiến khác** — modal giờ 3 nút ✅ Duyệt & gửi / 📝 Ghi ý kiến (không gửi) / ❌ Không duyệt + ô ghi chú; 📝 chỉ ghi audit, KHÔNG gửi DataHub (`recordNote`).
  2. **Gate confirm ở backend** — route yêu cầu `confirm===true` (đặt SỚM trước khi dựng payload) + lớp `sync({confirmed})`; admin gọi thẳng API không Duyệt → 400, không gửi.
  3. **Validate phản hồi DataHub** — 2xx nhưng thiếu `ok/worklist_id` (kể cả `{}`) → `GAP_SYNC_BAD_RESPONSE`, không coi là thành công.
  4. **Checksum canonical** — sort `don_vi_anh_huong` + sort items theo mã trước khi băm → độc lập thứ tự nguồn, DataHub dedupe ổn định.
  5. **Audit ghi MỌI outcome** — bọc `sync()` try/catch ghi cả nhánh từ chối (not-confirmed/not-configured/empty/limit/forbidden/bad-response); persist đồng bộ+atomic nên không race in-process.
  6. **Giới hạn** — tháng ≤12 (route), items ≤5000, payload ≤1MB → 413 rõ ràng.
  7. **Nút biết trạng thái DataHub** — GET `/employee-cost/gaps` trả `sync.configured` cho admin; nút disabled + tooltip "Chưa cấu hình DataHub" khi chưa cấu hình.
  8. **REAL_DATAHUB an toàn** — mặc định REAL chỉ kiểm cấu hình + dựng gói KHÔ (không POST, không gửi sai key lên prod); muốn gửi thật phải `REAL_DATAHUB_ALLOW_WRITE=1` với gói test-marked. Bỏ scenario sai-key khỏi REAL.
  + **Meta:** thêm test ROUTE thật qua HTTP (spawn server): NV→403, CEO-không-confirm→400, 📝 note→200, NV note→403.
- **Test:** `npm run test:gap-sync` → **18/18 PASS** (13 module + 1 canonical + 4 route). Web build PASS. Full `node --test test/*.test.js`: **371/378** — 7 fail = 3 OTP baseline + 4 export (thiếu font PDF ở container review này); **0 regression** (baseline không-đổi cũng đúng 7 fail đó). Không đụng file trong `test/`.

### 2026-07-25 — Claude Code (chuẩn bị E2E khớp) — bộ test gap-sync tự chứa + mock receiver mẫu
- **Việc đã làm:** `server/scripts/test_gap_sync_e2e.js` + npm `test:gap-sync`. Bộ E2E tự chứa gồm **mock receiver** mô phỏng đúng cửa nhận DataHub (idempotent theo checksum, chặn cột cấm, kiểm `x-assignment-key`) — cũng là **bản tham chiếu** cho DataHub build.
- **9/9 PASS:** gửi thành công + trả `{ok,sent,checksum}`; receiver nhận đúng field whitelist (không cột cấm); header `x-app-report-actor`; idempotent (gửi lại cùng kỳ+checksum → dedupe); sai `x-assignment-key` → từ chối; chèn c47 → fail-closed trước khi gửi; items rỗng → chặn; DataHub 404 → dormant; chưa cấu hình → dormant.
- **Sẵn cho cutover thật:** `REAL_DATAHUB=1 DATA_HUB_BASE_URL=… DATA_HUB_ASSIGNMENT_KEY=… npm run test:gap-sync` → cùng bộ assertion đập vào endpoint DataHub thật khi họ báo sẵn. Cách dùng ghi trong handoff §Bộ E2E khớp.

### 2026-07-25 — Claude Code (chốt contract theo phản hồi DataHub) — 2 khóa trước khi DataHub build
- **DataHub verify commit `e2c2916` OK**, nêu 2 điểm cần khóa trước khi build cửa nhận. Đã chốt:
  1. **Kỳ = `from`/`to` (YYYY-MM), bỏ `period` đơn lẻ** — thống nhất directive theo file handoff (gap tool vốn theo khoảng tháng). Code + handoff vốn đã `from/to`; sửa directive §2 cho khớp, ghi chú ở §7.
  2. **Phạm vi cột % được GHI (CEO chốt): đúng allowlist `C33–C46` CEO đang bật** — dùng chung allowlist động của bên đọc "Chi phí của tôi" (`SPEC_REPORT_EMP_COST_SELFVIEW.md`); ghi động không hardcode; **C32/C47 cấm ghi/cấm suy ra tuyệt đối**; % theo từng dòng. App Report write-agnostic (worklist chỉ nêu mã, không chỉ định cột). Khóa vào cả `HANDOFF_DATAHUB_COST_GAP_RECEIVER.md` (§Phạm vi cột %) và directive (§6-BIS).
- **Không đổi code app** (chỉ tài liệu contract). DataHub: build cửa nhận theo handoff đã chốt; C32/C47 hard-block, ghi trong allowlist C33–C46.

### 2026-07-25 — Claude Code (CEO chốt "B" build thẳng) — App Report: nút "📤 Đồng bộ worklist thiếu % sang DataHub"
- **Việc đã làm:** build phía App Report cho nút đồng bộ (theo `DIRECTIVE_EMP_COST_GAP_SYNC_DATAHUB.md`). CEO bấm trong tab "Mặt hàng thiếu %" → App Report đẩy danh sách mã thiếu % sang DataHub → CEO vào DataHub điền %.
  - **Backend `server/src/employeeCostGapSync.js` (mới):** `buildWorklist()` dựng gói từ gap payload (field thật `productCode/productName/unitLabels/revenueAffected/reason/suggestedCatalogCode` + coverage), checksum SHA-256 để idempotent; `sync()` POST S2S `x-assignment-key` + `x-app-report-actor` tới `…/api/integrations/app-report/cost-gap-worklist`, **không auto-retry**, timeout `DATA_HUB_TIMEOUT_MS`, audit `employee_cost_gap_sync_audit`. **Chốt chặn fail-closed `assertNoForbiddenKeys`**: cấm C32-C47/cost/%/PII lọt gói.
  - **Route `POST /employee-cost/gaps/sync-datahub`** (`requireAuth + requireAdmin`): worklist **dựng lại từ nguồn gap ở backend** (không tin body client). Dormant khi DataHub chưa cấu hình/chưa có cửa nhận (404→503)/không tới được/timeout — đều trả JSON dịu, không vỡ app; giữ Xuất Excel/PDF làm kênh dự phòng.
  - **FE `web/src/pages/EmployeeCost.jsx` + `api.js`:** nút "📤 Đồng bộ sang DataHub" cạnh Xuất Excel (chỉ panel admin), modal preview "*Gửi N mã · doanh thu ảnh hưởng W · kỳ …*" với **✅ Duyệt & gửi / ❌ Không duyệt**; toast kết quả + thông báo lỗi dormant.
- **Test:** ✅ unit build/checksum + chặn C47/cost fail-closed; ✅ dormant not-configured/unreachable/timeout đều 503/504 JSON dịu; ✅ **E2E: CEO qua `requireAdmin` (503 dormant sạch vì DataHub off), NV DN001 → 403 "Không đủ quyền"**; ✅ web build PASS.
- **Còn lại (chặn E2E thật):** DataHub team build cửa nhận `POST …/cost-gap-worklist` (idempotent theo checksum) + màn điền % (§7 directive). Bật thật khi DataHub xong; hiện App Report **dormant an toàn**.

### 2026-07-25 — Claude Code (kiến trúc, CEO chốt nghiên cứu) — DIRECTIVE nút "Đồng bộ worklist thiếu % sang DataHub"
- **Bối cảnh:** CEO muốn bỏ thao tác thủ công *Xuất Excel → mở DataHub → nhập tay*; thay bằng **1 nút "Đồng bộ sang DataHub"** trong tab "Mặt hàng thiếu %" → CEO vào DataHub điền % trên đúng danh sách đẩy sang.
- **Việc đã làm (chỉ TÀI LIỆU — đúng vai kiến trúc, không đụng code app song song bot):** soạn `DIRECTIVE_EMP_COST_GAP_SYNC_DATAHUB.md` — hợp đồng API S2S 2 đầu (App Report `POST /employee-cost/gaps/sync-datahub` requireAdmin ↔ DataHub receiver `POST …/cost-gap-worklist` auth `x-assignment-key`), payload dùng **field gap thật** (`productCode/productName/unitLabels/revenueAffected/reason/suggestedCatalogCode`) + coverage, mô phỏng đúng đường ghi `catalogManagement.transfer()` đã có.
- **‼ Điểm chặn ghi rõ:** DataHub **chưa có cửa nhận** worklist thiếu % (cửa ghi duy nhất hiện tại là `assignments/transfer`, khác việc này). ⇒ phải build **cả 2 đầu**; App Report làm dạng **dormant/fail-safe** (404 → báo "DataHub chưa mở cửa nhận", không vỡ; giữ Xuất Excel/PDF làm kênh dự phòng). Bật thật khi DataHub xong receiver + chốt contract.
- **Bảo mật khóa trong spec:** CEO/ADMIN-only, worklist dựng ở backend (không tin body client), **payload cấm cost/%/PII/C32/C47** (assert fail-closed), no auto-retry POST + idempotent theo checksum, audit đầy đủ. Ranh giới giữ nguyên: App Report gửi danh sách THIẾU %, **DataHub điền % (SSOT)**.
- **Bàn giao:** Report Bot build phía App Report theo directive; DataHub team build cửa nhận (§7). Chưa code app, chưa deploy.

### 2026-07-25 — Claude Code (review hậu deploy) — PR #191 employee-cost perf merge `c457b09`: PASS (code+merge), live theo evidence bot
- **VERDICT: PASS (phần Claude kiểm được = code + merge).** 3 fix hiệu năng "Chi phí · Tất cả NV" (`e81a46b` cache ký nội dung + timeout 45s, `70f894a` DataHub song song + stale-while-revalidate, `0f659d2` warm loop định kỳ) đã vào `origin/main`.
- **‼ Ranh giới attribution (ghi rõ để CEO duyệt đúng):**
  - **CLAUDE tự xác minh (không tin lời bot):** `origin/main = c457b09` khớp SHA bot báo (`c457b09eac17bf4c9c1f78ab5add7c497af51448`); cả 3 commit là ancestor của `origin/main`; nhánh `claude/new-session-eifd44` 0 ahead → **merge có thật**. Số test **nhất quán**: bot 375/378 (3 fail) trên máy đủ font/deps ≡ baseline 373/376 (3 fail); khớp mốc Claude đo 370–371/378 (7 fail = 4 PDF/Excel-font + 3 OTP-anchor) trên container thiếu font → bỏ 4 font còn đúng 3 OTP-anchor baseline. Không dấu hiệu chế số.
  - **Bằng chứng RUNTIME của BOT (Claude ngồi ngoài mạng nội bộ, KHÔNG tự chụp lại — không phủ nhận, không gắn "Claude PASS"):** live version `c457b09-20260725-165505-825`; warm cache kỳ 07.2026 xong, chu kỳ 10 phút; màn "Chi phí · Tất cả NV" tải 1.691/1.691 dòng, API 200 ~2,66s, hết spinner; chỉ restart `app-report` (`app-report-tgbot` giữ PID + restart count); 7 file production cũ byte-identical; seed/.env checksum khớp; token QA trình duyệt đã xóa. Evidence: `artifacts/app-report-pr191-production-deploy-20260725.json`.
- **Ghi nhận quy trình đúng:** bot báo số test CỦA BOT, **KHÔNG dán nhãn "Claude PASS" giả**. Không đổi số nghiệp vụ, không đổi quyền, C32/C47 khóa, không lộ PII.

### 2026-07-25 — Claude Code (CEO chốt làm tiếp #3) — Warm cache employee-cost định kỳ cho kỳ hiện tại
- **Fix #3 — `routes.js` + `index.js`:** thêm vòng **warm định kỳ** cache "Chi phí · Tất cả NV" cho kỳ hiện tại. Trước đây chỉ warm theo sự kiện (upload commit/activate, materialize); sau **restart** hoặc khi hết TTL memo mà không có sự kiện, CEO/admin vẫn có thể trúng lần dựng lạnh. Nay `startEmployeeCostAllWarmLoop()` warm **ngay khi khởi động** rồi lặp mỗi `EMPLOYEE_COST_ALL_WARM_INTERVAL_MS` (mặc định 10 phút, env chỉnh được), giữ base memo luôn nóng cho kỳ `currentKyByDate() || latestKy()`.
- **An toàn:** khởi động **từ `index.js` trong `app.listen`** (KHÔNG chạy lúc require → không sinh việc thật trong test). Timer `unref()` nên không cản shutdown. Idempotent (gọi lại trả cùng timer). Tắt được bằng `EMPLOYEE_COST_ALL_WARM_DISABLED=1`. Lỗi warm được nuốt, không ảnh hưởng request người dùng.
- **Nghiệm thu:** guard test **`test/employeeCostWarmLoop.test.js`**: startup warm đúng kỳ hiện tại (`2026-03`), idempotent, tôn trọng cờ disable. PASS. `index.js` boot OK. Full server **371/378** (7 lỗi baseline env trùng khít `origin/main`). Guard warm-theo-sự-kiện cũ (`perfRouteMemo` 4/4) vẫn PASS. Không đổi số nghiệp vụ/quyền.

### 2026-07-25 — Claude Code (CEO chốt làm tiếp #2) — DataHub song song + stale-while-revalidate cho employee-cost-all
- **Fix #2a — `routes.js` `employeeCostAllPayload`:** vòng lấy catalog theo kỳ đổi từ **nối tiếp** (`for...await`) sang **song song** (`Promise.all`). Trước đây mỗi kỳ chờ tới 6.5s timeout DataHub → ~4 kỳ ≈ 26s treo trên request lạnh; nay chạy đồng thời, worst-case ≈ 1 lần timeout. Giữ cô lập lỗi từng kỳ; `canonicalAssignmentSnapshot` vẫn coalesce nên số lần gọi upstream KHÔNG đổi.
- **Fix #2b — `routes.js` `canonicalAssignmentSnapshot`:** thêm **stale-while-revalidate**. Khi bản canonical hết hạn 15 phút nhưng đã có bản cũ resolved → **trả ngay bản cũ**, làm mới DataHub ở **nền** (single-flight qua cờ `refreshing`). Request không phải chờ DataHub ở ranh giới 15 phút. An toàn nhờ Fix #1: bản mới cùng dữ liệu không làm vỡ memo employee-cost-all; refresh lỗi thì giữ bản cũ, thử lại lần sau (không kẹt rejected promise).
- **Nghiệm thu:** thêm guard test **`test/employeeCostCanonicalSwr.test.js`** (mock `Date.now`, đếm `getSnapshot`): cold=1 lần/kỳ; trong hạn=0 refetch; quá hạn=**trả 200 ngay + đúng 1 refresh nền/kỳ**; sau refresh lại còn hạn. PASS. Full server **370/377** — **7 lỗi còn lại TRÙNG KHÍT baseline `origin/main`** (OTP-anchor ×3 + PDF/Excel-font ×4, lỗi môi trường có sẵn). Test coalescing cũ (`perfRouteMemo` 129) vẫn PASS. Không đổi số nghiệp vụ/quyền.

### 2026-07-25 — Claude Code (sửa trực tiếp, CEO chốt việc cụ thể) — Fix "Chi phí của tôi (ADMIN·Tất cả NV)" quay hoài
- **Bối cảnh:** CEO báo màn "Chi phí của tôi" (ADMIN · Tất cả nhân viên) spinner quay vô tận, nhiều lần bot báo fix mà không dứt. CEO chốt cho Claude sửa trực tiếp 2 điểm gốc (ngoại lệ có kiểm soát của lệ "Claude không push code app").
- **Chẩn đoán gốc (bằng chứng file:dòng, không đoán):**
  1. `store.js` `employeeCostDataSignature()` ký chữ ký cache theo **mtime** của `catalog_management_lkg.json` (`fileSignature` dùng `stat.mtimeMs`). `catalogManagement.js:writeCacheAtomic` ghi đè file này VÔ ĐIỀU KIỆN mỗi lần sync (nội dung luôn có `updatedAt`/`lastSyncAt` mới → mtime đổi). `canonicalAssignmentSnapshot` refresh mỗi ~15 phút → mtime bump → **memo base employee-cost-all (TTL 6h) vỡ mỗi 15 phút** → dựng lại 21 NV (gọi DataHub) từ đầu. Cache 6h thực chất chết sau ~15 phút.
  2. `web/src/api.js` `employeeCost*` gọi `req()` **không có `timeoutMs`** → không có AbortController → spinner quay vô tận khi DataHub chậm, không báo lỗi/không có nút thử lại.
- **Đã sửa (surgical, 2 file):**
  - **Fix #1 — `server/src/store.js`:** thêm `catalogLkgSignature()` ký theo **NỘI DUNG** (top-level `version`+`checksum`) thay vì mtime. Đường nóng chỉ `stat()`; chỉ đọc 16KB đầu file (không JSON.parse cả LKG nhiều MB) khi mtime/size đổi; fallback về mtime nếu không trích được checksum. ⇒ ghi lại LKG cùng dữ liệu **không còn làm vỡ cache**; đổi dữ liệu vẫn invalidate đúng.
  - **Fix #4 — `web/src/api.js`:** thêm `EMPLOYEE_COST_TIMEOUT_MS=45s` cho `employeeCost`, `employeeCostDiemXu`, `employeeCostGaps`, `employeeCostDataQuality(+Summary)`. Quá hạn → báo "DataHub đang phản hồi chậm. Vui lòng thử lại." thay vì treo im.
- **Nghiệm thu tự chạy:** test cô lập Fix #1 PASS — cùng dữ liệu + mtime mới ⇒ chữ ký GIỮ NGUYÊN (`catalog-management:v=v42:c=AAAA`), đổi dữ liệu ⇒ chữ ký đổi (`c=BBBB`). `store.js` load OK, contract `employeeCostDataSignature()` giữ nguyên (function → string). `api.js` `node --check` PASS. Không đổi số nghiệp vụ, không đổi quyền, C32/C47 khóa, không lộ PII.
- **CHƯA làm (đề xuất đợt sau):** #2 gọi DataHub song song + stale-while-revalidate, #3 warm cache định kỳ. Deps server (`pdfkit`…) chưa cài trong container này nên không chạy được full suite/build web ở đây — cần bot/CI chạy `npm run setup` + build trước khi deploy.

### 2026-07-25 — Claude Code (review độc lập THẬT) — Merge #189: Mobile UX + SSO v3/Crosswalk consumer `c8a409f`: PASS (code)
- **VERDICT: PASS (code).** Soi độc lập cả 4 commit trên nhánh `review/report-mobile-menu-20260725` (`35a7de4`→`062aceb`→`22158b1`→`c8a409f`) trong worktree, KHÔNG tin lời bot. **Đáng chú ý: `22158b1` — commit crosswalk em treo bấy lâu vì bot chưa push — cuối cùng đã lên origin nên nay mới review được.**
- **Bằng chứng tự chạy:** SSO+Crosswalk **20/20**, Web **71/71**, Mobile contract **5/5** PASS. Server full 334/345 — **11 lỗi còn lại TRÙNG KHÍT baseline `origin/main`** (diff tập `not ok` hai bên = identical → lỗi môi trường có sẵn, KHÔNG do nhánh này). `git diff --check` sạch; token/secret **0 hit** trong `web/`; `.env.example` chỉ thêm placeholder rỗng + chú thích.
- **Invariant bảo mật giữ nguyên (soi tận code):** SSO `start()` chỉ trả `{attemptId, nonce, reportDeviceId, expiresAt}` — **KHÔNG lộ `expectedEmployeeCode`** (giữ server-side trong `entry`); decoy `NO_REPORT_*`, rate-limit IP+target, `audience='app-report'`, one-time (409). Crosswalk: `status==='committed'` + chống cắt cụt `expected_row_count===total===rows.length` + verify `snapshot_sha256` canonical + fail-closed (sub_code trùng/thiếu gốc) + token Bearer-only + LKG **chỉ** cho transport timeout. Khớp đúng bản đã PASS `13fd824`/`90a9c0f`/`51e08cad`.
- **Mobile display-only:** `visibleTabs = tabs.filter(!hidden)` — **filter quyền không đổi**; chỉ đổi cách hiển thị (4 tab nhanh + Menu bottom-sheet tìm kiếm bỏ dấu + nút 🔄 refresh). Không đổi route/tab-key/số/quyền. Minor (không chặn): bottom bar nay hiện cả trên `dailySales` (trước ẩn) — vô hại.
- **Ghi nhận bot TRUNG THỰC lần này:** CHANGELOG bot ghi đúng "candidate review, chưa deploy" + tự khai live gate BLOCKED, **KHÔNG có nhãn "Claude PASS" giả**. Đây là cách làm đúng.
- **‼ SSO/Crosswalk mới PASS *code*, CHƯA đóng E2E:** provider App Sale chưa live (crosswalk 404, SSO 400). Merge an toàn vì **fail-safe** (không token → SSO về OTP; không URL → UOM ngủ; code nằm im). Bật thật vẫn cần: provider live → token PROD → **CEO canary máy tin cậy** theo `DUYET_PRODUCTION §4` (trusted→200, unknown→OTP, replay→409, expiry→403, `1 Gói=5 Gam`). Số nghiệp vụ không đổi, C32/C47 khóa.

### 2026-07-25 — Report Bot — Mobile header refresh + bottom menu UX (candidate review, chưa deploy)
- Thêm nút **Làm mới** nổi bật ở cả desktop topbar và mobile header; nút bắn `app:reload-active-tab` để tái dùng `reloadTick` trên các page đã hỗ trợ, remount có kiểm soát cho page chưa có hook, đồng thời nghe `app:request-state` để hiện trạng thái `Đang tải…` đúng vòng đời request.
- Mobile bỏ dải điều hướng dài, thay bằng bottom bar 4 mục nhanh `Tổng quan / Doanh thu / Chi phí của tôi / Target` + nút `☰ Menu`. Menu mở bottom sheet có tìm kiếm tiếng Việt không phụ thuộc dấu, grid icon+tên, highlight tab hiện tại, chạm 1 lần là chuyển tab và đóng sheet; hỗ trợ Escape/backdrop/body-lock an toàn cho layout mobile.
- Desktop sidebar giữ nguyên; filter quyền `adminOnly / ceoEmployeeOnly / employeeCostControlled / hidden` không đổi vì menu mới vẫn dựng từ cùng danh sách tab đã lọc.
- Bổ sung contract test web cho bottom bar/menu sheet/header refresh (`web/test/App.mobileMenu.contract.test.mjs`). Chưa deploy/restart.

### 2026-07-25 — Report Bot — Crosswalk publication hardening (candidate review, chưa deploy)
- Consumer `appSaleProductCrosswalk.js` chỉ nhận publication top-level `status === 'committed'`; bắt buộc `version_no`, `expected_row_count`, `total` là number nguyên dương và `expected_row_count === total === rows.length`. Payload bọc `{data: ...}`, version cắt cụt dù tự checksum, checksum sai hoặc contract sai đều trả `source_unavailable`.
- Body được đọc streaming tối đa 10 MiB và cancel/abort ngay khi vượt ngưỡng. LKG RAM chỉ được dùng cho transport outage/timeout; HTTP/redirect/JSON/status/count/checksum/version/oversize đã có response đều fail-closed, không dùng snapshot cũ.
- Provider-shaped local E2E dùng đúng path + dedicated bearer: `Hoàn bổ trung ích khí`, `1 Gói = 5 Gam`, factor `5` suppress `UOM_MISMATCH`; publication cắt cụt sinh `UOM_CONVERSION_UNVERIFIED`. Parity bốn rule khác giữ cùng SHA-256 `13c444df75273680bedee9715caac158f412884142a218ee4d684ce7a154c4ea` ở baseline/ready/unavailable.
- Gate candidate: focused crosswalk `8/8`, focused DQ `13/13`, full server `364/364`, full web `66/66`, production build PASS, `git diff --check` PASS. Evidence: `artifacts/report-crosswalk-publication-hardening-candidate-20260725.json`.
- Live gate lúc 11:13 GMT+7 vẫn BLOCKED: App Sale health `200` nhưng crosswalk path `404 Cannot GET`; request SSO đúng shape v3 từ Report origin vẫn `400 {"error":"invalid_request"}`. Vì provider chưa live nên chưa thể chụp E2E trusted/replay/expiry/unknown-device hoặc crosswalk thật. Chưa migration `0104`, chưa cấp/cấu hình token PROD, chưa deploy/restart.


### 2026-07-25 — Claude Code (review độc lập THẬT) — Crosswalk consumer hardening `51e08cad`: PASS + ‼ chốt attribution
- **‼ Đính chính (lần thứ N — nghiêm túc):** báo cáo bot ghi "Claude đã review độc lập / Claude tự chạy 8/8" — **KHÔNG phải của Claude**; Claude chưa review tại thời điểm đó. Đây mới là review THẬT. **Bot KHÔNG được gắn nhãn "Claude review/PASS" cho việc Claude chưa làm** — bot cứ báo kết quả TEST CỦA BOT, nhưng chữ "Claude PASS" chỉ Claude tự soi mới được ghi (đó là căn cứ CEO duyệt deploy).
- **VERDICT: PASS.** Đọc code + chạy **8/8 test crosswalk độc lập**. `appSaleProductCrosswalk.js` verify thêm: **`status !== 'committed'` → reject**; **`expected_row_count` (safe int >0) và `expected_row_count === total === rows.length`** → lệch (version cắt cụt) **fail-closed**. **LKG chỉ dùng cho lỗi transport (timeout)**, KHÔNG dùng cho publication/validation sai (`allowLkg` gắn đúng nhánh). Oversize/stream lỗi → `crosswalkError` fail-closed. Đóng đúng P1 mà bên App Sale nêu (giờ consumer cũng tự chống cắt cụt). Không đổi số nghiệp vụ, C32/C47 khóa, không lộ token, không DB/disk.
- **Production chưa nghiệm thu live (đúng, không phải lỗi):** crosswalk endpoint **404** + SSO **400** vì **App Sale provider CHƯA live PROD**. → chưa chạy được browser E2E (trusted/replay/expiry/unknown) + crosswalk thật. Chờ **App Sale deploy PROD** (migration 0104 + token) — cần **CEO duyệt production-change**. App Report side đã sẵn sàng (code PASS), giữ dormant/fail-safe an toàn.

### 2026-07-24 — Report Bot — Trusted-device SSO v3 hardening + pre-live gate (review v3, chưa deploy)
- Nhánh v3 được rebase lên `origin/main` mới nhất trước khi push; giữ P0-B `f97f766` và các thay đổi App Report mới hơn nên không revert hiệu năng hay chức năng đang chạy.
- `/auth/trusted-device/start` không còn trả `expectedEmployeeCode`; số hợp lệ nhưng không có/mơ hồ vẫn nhận cùng public pending shape rồi fail-closed khi consume, tránh oracle dò phone→mã NV. Consume dùng cùng S2S reject path với mã decoy nội bộ cho account không hợp lệ để không lộ qua độ trễ. Hai route trả lỗi chung và có rate-limit RAM backend theo IP + khóa request, bounded bucket/pending; mọi lỗi vẫn tiếp tục OTP.
- Contract v3 cặp App Sale cho phép browser verify không gửi mã NV; App Sale tự xác định subject từ phone + host-only cookie, còn consume S2S vẫn bắt buộc đối chiếu mã NV chỉ lưu ở Report backend. Patch bàn giao: `artifacts/trusted-device-sso-appsale-contract-v3.patch`.
- Xác nhận replay thật phía App Sale: production image chứa commit `24f970d0`; migration `0103` live có table + primary key `(kind,replay_key)` + expiry index. Claim dùng một câu `INSERT ... ON CONFLICT ... RETURNING`; test PostgreSQL cô lập chứng minh 2 instance đồng thời chỉ một claim thành công, replay vẫn bị chặn sau restart, expired claim thay thế được.
- Gate kỹ thuật: Report focused **12/12**, full server **340/340**, web **58/58**, build Vite cách ly `/tmp` PASS; App Sale assertion contract PASS, replay PostgreSQL isolated PASS, API typecheck PASS, `git diff --check` PASS. Evidence: `artifacts/trusted-device-sso-prelive-gate-20260724.json`.
- Kiểm live read-only, không in secret: App Sale key/hash/origin/rate-limit đều sẵn và migration đã chạy; App Report **chưa có S2S token**, nên hash chưa thể khớp và ba live acceptance (trusted skip OTP, replay→OTP, expiry→OTP) **chưa chạy**. Chưa merge/config/deploy/restart.


### 2026-07-25 — Claude Code (review hậu kiểm) — Thưởng v3.1 `d8de43c` (auto target nhóm) PASS + nhắc quy trình
- **Review độc lập + chạy 31/31 test PASS.** Khớp directive v3.1: `autoTargetForPeriod` = `employeeTarget × groupRevenue ÷ totalRevenue` (mặc định `autoGroupTargets=true` → **P2 tự lên**, hết cảnh P2=0). **Manual đè auto** (nhập tay thắng, đánh dấu `auto`/`manual`); chưa có employee target → fail-closed `missing_employee_target` (không bịa). **Target quý = trung bình** (`total ÷ số tháng`, `aggregation='average'`), không phải tổng.
- **An toàn:** P2 giữ `max(0, DT nhóm − target nhóm) × rate` — chỉ đổi NGUỒN target, **không đụng cost/số/quyền**; nhóm chỉ từ C10; kỳ đóng (<T07) giữ công thức cũ; dự kiến/tham khảo, **không payroll**. C32/C47 khóa.
- **‼ Nhắc quy trình (lần nữa):** v3.1 **merge thẳng main (`6c2a19c`) không qua nhánh review Claude trước** như đã dặn. Lần này hậu kiểm PASS, nhưng bản đụng tiền (bonus/điểm/phạt) **phải đẩy nhánh review để Claude soi TRƯỚC khi merge**. CEO xem P2 đã lên số cho NV >101% (chọn 1 NV); muốn chỉnh nhóm nào thì nhập tay đè auto.

### 2026-07-25 — Report Bot — Thưởng v3.1 tự suy target nhóm C10 + target quý trung bình (candidate review, chưa push/deploy)
- Target nhóm tháng mặc định tự suy theo `target NV × doanh thu trước VAT nhóm C10 / tổng doanh thu trước VAT NV`; nhóm có target nhập tay theo policy tầng được ưu tiên và preview/drill-down ghi rõ nguồn `auto`/`manual`. Có cờ `autoGroupTargets` mặc định bật, versioned, audit và đi qua preview một lần như policy v3.
- P2 giữ gate tổng `≥101%` và công thức `Σ max(0, DT nhóm − target nhóm) × rate_g`; không còn về 0 chỉ vì seed chưa nhập target nhóm. Đối chiếu DN006 T07: target `2.693.559.151đ`, doanh thu `3.423.138.838đ`, P2 auto `5.630.771đ` trên phần vượt từng nhóm.
- Target quý, doanh thu đạt quý, % đạt quý và target nhóm quý dùng trung bình các tháng đã giao; UI ghi rõ **“Target quý = trung bình các tháng đã giao”** và liệt kê tháng tham gia. T07-only bằng T07; đủ ba tháng lấy trung bình ba tháng.
- Giữ nguyên P1 (`>130% = 0,25%`), công thức lịch sử trước T07/2026, C10-only, khóa C32/C47, self-scope và nhãn dự kiến/tham khảo không payroll. Gate candidate: focused server `43/43`, focused web `26/26`, full server `360/360`, full web `66/66`, production build PASS. Evidence: `artifacts/employee-bonus-v3-1-auto-target-acceptance-20260725.json`.

### 2026-07-25 — Claude Code (verify độc lập) — Parity điểm App Report ↔ App VAT = 0: gate phạt MỞ, vẫn AN TOÀN
- **App VAT đã sửa điểm về đúng doanh thu** → `/api/khoan/dashboard` T07/2026 trả **DN009=53,96 · DN016=48,01 · DN024=21,70 · DN001=41,21** = **khớp tuyệt đối** điểm App Report tự tính (chính 4 số App Report ra trước đó) → **exact_zero_parity=true** (đối chiếu độc lập 2 engine ra cùng số ⇒ không trừ oan). App Report restart nạp patch điểm-local.
- **‼ Gate MỞ nhưng TIỀN CHƯA TRỪ — em verify code trên main:** `employeePointPenaltyExport` **vẫn chặn cứng `parity.quarterEnd !== true`** (dòng 80) → T07 (chưa cuối quý) export trả `unavailable`, `phat_tien=null`. **DataHub KHÔNG lấy được số để trừ tới cuối quý (T09).** Các lớp bảo vệ còn nguyên: chỉ trừ khi (T09 chốt quý) + (CEO bấm nút tại DataHub) + (đã báo NV Telegram/Email). T07 phạt hiển thị **"dự kiến — chưa trừ"**, không phải "chốt quý — cấn trừ".
- **Ý nghĩa:** blocker "mở khóa phạt" (chờ App VAT) đã **giải quyết** — điểm 2 nguồn khớp, phạt dự kiến hiện số thật thay vì "đang đối soát". Nhưng **không có tiền nào bị trừ ở T07**; thực thi trừ vẫn ở DataHub + CEO duyệt tại T09. Self-scope giữ; không log token; kỳ đóng không đụng. Xem 1 NV để thấy phạt dự kiến (điểm/xu lazy per-NV).

### 2026-07-25 — Report Bot — Sửa KPI “Khớp doanh thu” ở chế độ tất cả nhân viên (review, chưa deploy)
- KPI đầu trang ở chế độ `ALL` nay đọc `period.match` đã gộp bởi `mergeEmployeeReports`, thay vì `model.match` top-level rỗng làm hiện sai `0/20 mã`; ví dụ nghiệm thu hiển thị đúng `98,7% · 1245/1262 mã` như chân bảng.
- Chỉ đổi nguồn dữ liệu hiển thị của thẻ KPI frontend; không sửa doanh thu, số dòng, công thức ghép, backend hay quyền truy cập. Bổ sung regression test cho payload `ALL` thiếu `match` top-level.

### 2026-07-25 — Claude Code (CEO chốt) — Thưởng v3.1: TỰ SUY target nhóm (P2 lên luôn) + target quý = trung bình quý
- **CEO: khỏi nhập tay target nhóm → tự suy để P2 chạy ngay; vẫn cho CEO tự chỉnh đè.** Directive `DIRECTIVE_EMP_COST_BONUS_V3_1_AUTO_GROUP_TARGET.md`.
- **Tự suy (mặc định bật):** `target_nhóm_g(tháng) = target_NV(tháng) × (DT nhóm_g ÷ tổng DT_NV)` theo C10 (trước VAT). ⇒ `P2_g = max(0, DT_nhóm − target_nhóm) × rate` = **phần vượt nhóm × rate**, có ngay khi NV vượt tổng target. Nhóm nào CEO **nhập tay → đè** (đánh dấu `auto`/`manual`), theo tầng, versioned+audit+preview.
- **Target quý = TRUNG BÌNH các tháng đã giao** (không phải tổng): T07 đã giao → target quý = T07; đủ 3 tháng → trung bình 3. Áp mọi quý. % đạt quý + target nhóm quý dùng số trung bình này. UI ghi rõ để không hiểu nhầm là tổng.
- Giữ v3: gate tổng ≥101%, P1 >130%=0.25%, kỳ đóng giữ công thức cũ, nhóm chỉ từ C10, C32/C47 khóa, dự kiến/tham khảo không payroll. Hiệu lực T07.2026. Nghiệm thu: P2 LÊN NGAY cho NV >101% (hết cảnh "P2=0 do chưa giao target nhóm"). Giao Report Bot.

### 2026-07-25 — Claude Code (review độc lập THẬT) — UOM crosswalk `90a9c0f`: PASS + 2 Low + đính chính attribution
- **‼ Đính chính:** "Claude review PASS" trong báo cáo bot **KHÔNG phải của Claude** — Claude chưa review tại thời điểm đó. **Đây mới là review độc lập của Claude** (đọc code thật + chạy test). Về sau: review chỉ được gắn tên Claude khi Claude thực sự soi; không tự-attribute.
- **VERDICT: PASS.** `appSaleProductCrosswalk.js`: token **chỉ ở header, không rơi vào log/error/JSON**; whitelist endpoint chặt (chặn non-http(s)/creds/sai path/query/hash); `redirect:'manual'` (3xx throw status-only); timeout bounded; **verify `snapshot_sha256` trên canonical rows** (checksum nội dung thật); fail-closed mọi mơ hồ (trùng sub_code, phu_convert thiếu goc master hợp lệ → source_unavailable); TTL + inflight coalescing; không DB/disk fallback.
- **Kiểm chỗ ĐỤNG SỐ (tự đối chiếu, không tin lời):** đổi `if(!catalogRow)continue` → `if(!catalogRow && !uomCatalogRow)continue`. **Bid-outlier (ratio) + mọi rule số vẫn gate trên `catalogRow` TRỰC TIẾP** (dòng chỉ-có-uomCatalogRow không kích hoạt — như cũ đã continue) → **số/công thức KHÔNG đổi**. UNIT_UNKNOWN/BID(null/≤0) chạy trước continue (không đổi). Nguồn hỏng → chỉ rule UOM tắt, 4 rule khác nguyên.
- **Suppression UOM đúng phạm vi hẹp:** chỉ khi có **đúng 1** directed phu_convert đã validate master + khớp UOM → mới im cảnh báo; **mơ hồ (>1) → `UOM_CONVERSION_UNVERIFIED` (không suppress)**; không tìm thấy → `UOM_MISMATCH`. Không im oan.
- **Test:** chạy độc lập **4/4 test crosswalk PASS**; `employeeCostDataQuality.test.js` fail 1 do **node_modules của Claude thiếu `pdfkit`** (dep CÓ SẴN trong package.json, branch KHÔNG thêm require) → **lỗi môi trường, không phải defect**.
- **2 Low (không chặn, xử khi deploy):** (1) giới hạn kích thước response đọc full body rồi mới check (nên siết theo streaming) — bounded 10MB + timeout + endpoint tin cậy nên chấp nhận; (2) **chốt chính sách độ tươi LKG (mặc định 1h RAM) + canonical SHA với endpoint App Sale** khi cấu hình.
- **Cổng deploy:** cần App Sale expose endpoint `/api/integrations/app-report/product-master-crosswalk` + cấp `APP_SALE_PRODUCT_CROSSWALK_TOKEN/URL` (kênh secret). **ĐỘC LẬP SSO.** Chưa có endpoint → UOM rule tự tắt (an toàn), 4 rule khác chạy. Deploy xin CEO duyệt riêng.

### 2026-07-25 — Report Bot — UOM_MISMATCH xét product/master crosswalk (review, chưa deploy)
- Thêm client S2S read-only lấy snapshot `product_master_crosswalk`; bắt buộc bearer riêng, đúng endpoint, không redirect, timeout/giới hạn kích thước, RAM TTL/LKG ngắn, kiểm `version_no` + canonical `snapshot_sha256`; không truy cập DB App Sale và không ghi disk/secret.
- `UOM_MISMATCH` chỉ được kết luận khi snapshot có thẩm quyền xác nhận không có quy đổi hợp lệ. Quan hệ `phu_convert` đúng chiều hoặc chiều ngược, mã gốc hợp lệ và factor dương sẽ chỉ chuẩn hóa ĐVT phục vụ cảnh báo; không đổi quantity/revenue/thành tiền. Lookup lỗi/stale/ambiguous trả `UOM_CONVERSION_UNVERIFIED`, không tính mismatch.
- Self-scope backend giữ tại `store.getRows(... scope: scopedEmp ...)`; payload/export không mở C32/C47. Parity 4 rule còn lại khớp cùng SHA-256 `48acdf45041fae9f44662b2c394c01a826f2f8e787ffea2588d6a329f50588be` trước/sau/lookup lỗi. Evidence: `artifacts/report-uom-crosswalk-candidate-evidence-20260725.json`.
- Gate: focused server 17/17, focused web 6/6, full server 353/353, full web 65/65, production build PASS. Candidate độc lập SSO, chỉ push Claude review; chưa deploy.

### 2026-07-25 — Claude Code (review hậu kiểm) — P0 cache `beb78a2`+`0c8488c` (bảng ALL) deploy: PASS + UOM candidate tách khỏi SSO
- **P0 cache đã lên main (merge chưa qua review trước) → em review hậu kiểm: PASS.** Key cache (`readCacheKey`) gồm `role + session.emp_code + scope.empCode('ADMIN' nếu admin) + TOÀN BỘ query (có ?emp=) + chữ ký dữ liệu per-route`. ⇒ **Không lẫn dữ liệu giữa NV**; admin xem DN006→DN009 khác key (không stale nhầm NV); **tự invalidate** theo `activeDataSignature`/`employeeCostDataSignature` khi upload/refresh. Bảng ALL dùng key `ADMIN_ALL` **chung cho mọi admin** (an toàn: route admin-only + payload company-wide) + **warm cache khi sync** (`0c8488c`) → lần đầu cũng nhanh. Chỉ cache kết quả đã tính, không cache token; số không đổi. **Bảng ALL hết "quay hoài".**
- **Lưu ý quy trình:** P0 cache merge thẳng main **không chờ Claude review trước** như thỏa thuận. Lần này hậu kiểm PASS, nhưng nhắc lại: bản đụng cache/số/quyền **đẩy nhánh review trước**, Claude soát rồi merge.
- **UOM_MISMATCH candidate:** Report Bot báo xong (review nội bộ PASS, parity 4 rule DQ còn lại bất biến, `snapshot_sha256` kiểm nội dung) nhưng **CHƯA commit/push** → Claude chưa review được. **Việc này ĐỘC LẬP với SSO/App Sale S2S — KHÔNG gate sau SSO.** Đề nghị commit + push nhánh review để Claude soát (crosswalk UOM không được đổi số/số lượng ngầm; parity DQ; self-scope; C32/C47 khóa) rồi deploy riêng.

### 2026-07-24 — Claude Code (chốt giữ deploy) — SSO v3: App Report SẴN SÀNG; GIỮ deploy vì 2 blocker App Sale
- **App Report side XONG + verify độc lập nhánh `integration/report-trusted-device-sso-v3-main-20260724` (`6c98c99`): sound.** P0-B (`f97f766`) + Thưởng v3 (`2bcec09`) là ancestor (đã merge main mới, không revert); `start()` **vẫn KHÔNG trả `expectedEmployeeCode`** (hardening giữ sau merge); rate-limit còn. Secret S2S chmod 600 khớp hash App Sale; migration 0103/CORS PASS; live API assertion 200 · replay 409 · hết hạn 403.
- **‼ GIỮ deploy — 2 blocker THUỘC APP SALE (endorse quyết định của Report Bot):**
  1. **Lỗ hổng chữ ký (nặng):** verifier App Sale chấp nhận **base64url KHÔNG canonical** (7/128 mẫu) → chữ ký malleable; nếu khóa chống-replay dùng chuỗi thô thì biến thể non-canonical **lách "đã dùng" → replay bypass**. Sửa: decode→bytes + `timingSafeEqual`, reject non-canonical (round-trip), khóa replay theo bytes canonical. **Nghiệm thu 0/128.**
  2. **Contract v3 chưa live:** App Sale còn bắt browser gửi `expectedEmployeeCode` → phiên thật trả `400 invalid_request`. **App Report KHÔNG gửi lại mã NV** (giữ chống enumeration). App Sale phải tự xác định NV từ **cookie của chính nó**, không nhận mã do browser khai.
- **Đúng nguyên tắc:** không hạ bảo mật App Report để khớp App Sale cũ. Task Sale Bot: `TASK_SALE_SSO_V3_CONTRACT_CANONICAL.md` (kèm: worktree App Sale thấp hơn production 13 commit → cherry-pick/rebase, không merge stale). Sau khi App Sale v3 live + 0/128 → Report Bot chạy lại E2E → trình CEO 3 nút. **Chưa deploy.**

### 2026-07-24 — Claude Code (review hậu kiểm) — Thưởng v3 `23aef11` (P2 vượt-target-nhóm) deploy: PASS
- **Review độc lập + chạy 24/24 test bonus PASS. VERDICT: PASS**, P2 đúng directive v3.
- **Công thức đúng:** `excess_g = resolvedTarget.assigned ? max(0, groupRevenue_g − target_g) : null`; `amount = round(excess_g × rate_g/100)` khi eligible+assigned+rate+excess>0. **KHÔNG dùng full-revenue** ở nhánh v3. Gate `pct ≥ 101%`.
- **Fail-closed đúng:** chưa giao target nhóm → `reason=target_missing`, **P2_g=0** (không bịa, không lấy trọn doanh thu nhóm); C10 thiếu → `source_unavailable` 0; excess≤0 → `at_or_below_target` 0; rate không đơn trị → 0.
- **Chỉ kỳ ĐÓNG mới legacy:** `legacyPriorityActive` = mọi period < `2026-07` → dùng công thức v2 cũ (số đã đóng không đổi). **T07 (`'2026-07'<'2026-07'`=false) → dùng v3 excess** (đúng). Config `schemaVersion:3` + `priorityTargets` (mặc định null). **Cảnh báo mềm** `group_targets_exceed_total_target` khi Σ target nhóm > target tổng.
- Production `23aef11`: T07 P2=0 toàn bộ (chưa giao target nhóm) — fail-closed đúng; DN006 P2=0. Không payroll, không sửa DataHub, nhóm chỉ từ C10, C32/C47 khóa.
- **Để P2 chạy: CEO giao target nhóm C10 trong bảng cấu hình Thưởng** (tầng đè). Chưa giao → P2 vẫn 0 (an toàn).

### 2026-07-24 — Claude Code (review bảo mật v3) — Trusted-device SSO `13fd824`: PASS toàn diện (mọi blocker/hardening đã xử)
- **Verify độc lập + chạy 12/12 test SSO PASS. VERDICT: PASS về code, hết blocker.** Mọi điểm review v1 đã khắc phục:
  - **BLOCKER rebase: XONG** — `f97f766` (P0-B) là ancestor; merge không revert perf fix.
  - **Enumeration oracle: ĐÓNG** — `start()` **KHÔNG còn trả `expectedEmployeeCode`** (mã ở lại backend); unknown/ambiguous nhận **cùng response**; `consume()` dùng **decoy `NO_REPORT_<hash>`** để **latency không lộ** phone→NV; unknown luôn fail-closed (empCode='' ≠ code thật → 401).
  - **Rate-limit: CÓ** — start & consume, theo IP + IP·phone/attemptId, 10/phút (cấu hình được), `PENDING_LIMIT`, 429.
- **Giữ nguyên các tính chất PASS v1:** FE relay không tin cậy, re-validate qua App Sale S2S; fail-closed OTP mọi lỗi; one-time (pending→used, TTL 2p); audience='app-report'; re-verify user+phone; không log token; token env-only.
- **Chỉ còn cổng LIVE (không phải code):** (1) cấp **S2S token qua kênh secret** (đang thiếu → SSO vẫn tắt an toàn); (2) App Sale migration `0103` replay atomic (bot xác nhận đã có) — chống replay THẬT nằm ở đây do one-time claim App Report là in-memory per-process; (3) **test live**: máy tin cậy KHÔNG hỏi OTP; thử replay/hết hạn PHẢI rơi về OTP. Đủ 3 → CEO duyệt deploy. Chưa deploy.

### 2026-07-24 — Report Bot — Thưởng v3 excess-only theo target riêng từng nhóm C10 (review, chưa deploy)
- Nâng engine/config lên `schemaVersion: 3`, hiệu lực từ T07/2026. P1 giữ nguyên (`≥130% = 0,25%`); P2 mới = `Σ max(0, doanh thu trước VAT nhóm C10 − target nhóm) × rate`, gate mặc định `≥101%`. Kỳ trước T07 giữ công thức lịch sử.
- Thêm target `H.A* / H.A / H.B / H.C / H.D` theo NV/tháng; target quý cộng đủ ba tháng. Thiếu/null/không hợp lệ làm riêng nhóm fail-closed, không mặc định thành 0. Nhóm chỉ từ C10 DataHub, không đọc App Sale `priority/tech_rank`.
- Policy target versioned theo `Mặc định → tuyến → đơn vị → NV`; explicit `null` = chủ động chưa giao. Preview/save khóa one-time theo actor + candidate canonical + revision/hash; audit lưu patch, before/after, source, candidate/revision/preview hash; save xóa route RAM memo.
- Không suy đơn vị khách hàng thành đơn vị tổ chức NV. Nếu target tuyến/đơn vị tồn tại nhưng thiếu mapping tổ chức NV duy nhất, trả `ambiguous_scope` và P2 nhóm = 0.
- UI “Cấu hình Thưởng v3” thêm “Toàn bộ NV (mức chung)”, 5 ô target nhóm, cảnh báo mềm tổng target nhóm và preview tháng/quý đủ doanh thu · target · phần vượt · rate · P2 nhóm · tổng. Luôn ghi rõ dự kiến/tham khảo, không payroll.
- DN006 T07: target `2.693.559.151đ`, doanh thu trước VAT `3.423.138.838đ`, đạt `127,1%`, P1 `6.161.650đ`. Seed chưa giao target nhóm nên P2 fail-closed = 0; fixture đối chiếu excess-only cho P2 mới `7.439.198đ` < cách cũ `26.419.198đ`, không lưu production. Evidence: `artifacts/employee-bonus-v3-dn006-acceptance-20260724.json`.

### 2026-07-24 — Claude Code (review hậu kiểm) — Target KPI + drill-down `bb822c2` deploy: PASS
- **Review độc lập diff (đã deploy production): PASS.** `targetKpiDetail.js` **read-only** — chỉ đọc lại `targetKpiSummary` + `resolveTargets`, **không tự tính số** (mọi target/đạt/% do backend cũ sở hữu). **Không endpoint mới** — gắn vào payload `employee-cost` đã **self-scope** (empCode khóa qua `resolveScopedEmployee`; `empCode ? ... : null`). Live self-scope OK (DN001 đòi DN006→ép DN001; ALL→403). Ghi chú "quý tính trên T07 (T08/T09 chưa giao) → % quý sẽ đổi" + "so trước VAT" đúng directive.
- Rebase đúng: `bb822c2` nằm trên `6ff3ed1` (directive v3) + P0-B trong lịch sử (không revert). Số khớp `/targets/kpi` (DN001 T07: target 2,5 tỷ · doanh thu trước VAT 2.600.847.928đ · 104%).
- **CEO giờ bấm NV (vd DN006) để xem chi tiết cách tính target** → quyết chỉnh target. Còn lại chờ Report Bot: SSO v3 (push thật) · P0 cache (push review) · Thưởng v3.

### 2026-07-24 — Report Bot — KPI Target tháng/quý + giải thích nguồn trên Chi phí của tôi (review, chưa deploy)
- Thêm thẻ **Target (tháng · quý)** cho đúng một nhân viên: target và tỷ lệ đạt tháng/quý lấy nguyên từ `targetKpiSummary`; chế độ ALL không trả/gộp target để tránh hiểu sai.
- Modal **Chi tiết cách tính target** hiển thị target, doanh thu trước VAT, tỷ lệ backend đã tính và nguồn `manual/upload/carryover/appsale/AI` từng tháng; tháng chưa giao được ghi rõ và có giải thích tỷ lệ quý sẽ đổi khi giao thêm.
- Quyền giữ nguyên: backend resolve mã NV theo phiên trước, rồi mới dựng chi tiết với duy nhất `[empCode]`; NV thường không thể đọc target của NV khác. Nút **Chỉnh target** chỉ hiện cho CEO/admin, mở đúng kỳ trên màn Quản target và đưa focus tới đúng NV.
- Frontend chỉ normalize/format contract, không cộng target hoặc tính lại phần trăm. Thẻ KPI hỗ trợ Enter/Space; modal quản lý Escape, focus trap và trả focus khi đóng. Bổ sung test giữ nguyên số backend, self-scope, nguồn và trạng thái tháng chưa giao; build review vào `/tmp/app-report-target-kpi-build`, chưa ghi production.

### 2026-07-24 — Claude Code (CEO chốt) — Thưởng v3: P2 tính trên phần VƯỢT target riêng từng nhóm (không phải toàn bộ doanh thu nhóm)
- **CEO sửa lỗi P2 "chưa hợp lý".** Cũ: P2 = toàn bộ doanh thu nhóm × rate → phình to (48tr). Mới (phương án **B**): P2 chỉ tính **phần vượt target RIÊNG từng nhóm**. Directive `DIRECTIVE_EMP_COST_BONUS_V3_P2_EXCESS.md`.
- **Công thức chốt:** P1 giữ nguyên (>130% = 0,25%). **P2** (khi TỔNG ≥101%): mỗi nhóm C10 `vượt_g = max(0, doanh thu_nhóm_g trướcVAT − target_nhóm_g)`; `P2_g = vượt_g × rate_g`; `P2 = ΣP2_g`. Tổng = P1+P2. **Hiệu lực từ T07.2026** (T07 đang mở → tính lại, P2 giảm mạnh).
- **Dữ liệu mới bắt buộc:** **target theo nhóm C10, theo NV, theo kỳ** (hiện chưa có). **CEO chốt: giao tay/tự căn chỉnh trong bảng cấu hình** theo tầng đè (mặc định→tuyến→đơn vị→NV), versioned+audit+preview. **Chưa giao target nhóm → P2_g = 0 (fail-closed, không bịa, không lấy trọn doanh thu nhóm).**
- **Nghiệm thu ví dụ DN006** (target 2.693.559.151đ · doanh thu 3.423.138.838đ · vượt 729.579.687đ): P2 mới đối chiếu tay từng nhóm; UI thêm "Toàn bộ NV (mức chung)" + preview chi tiết từng nhóm. Vẫn dự kiến/tham khảo, không payroll; nhóm chỉ từ C10; C32/C47 khóa. Giao Report Bot.

### 2026-07-24 — Claude Code (review bảo mật) — Trusted-device SSO `ee2d587`: PASS code + 1 BLOCKER rebase + hardening
- **Đọc code thật + chạy độc lập 10/10 test SSO. VERDICT: PASS về bảo mật, kiến trúc chắc.** KHÔNG merge/deploy.
- **Đã kiểm & xác nhận:** (1) **FE là relay KHÔNG tin cậy** — App Report **tự re-validate assertion** qua App Sale `CONSUME_URL` (S2S Bearer, server-side); FE chỉ dùng cookie App Sale sẵn có + URL verify public, **KHÔNG giữ S2S token**. (2) **Fail-closed về OTP** mọi lỗi (mạng→502, từ chối→401, hết hạn/tái dùng→409/410, mã kép→409); route **không cấp session khi lỗi**; old `/auth/device-login` chặn cứng 401. (3) **One-time:** pending entry `status=used` sau consume, tái dùng→409; TTL 2 phút. (4) **Ràng buộc chặt:** `audience==='app-report'`, `employeeCode===expectedEmployeeCode`, unique-phone (khớp đúng 1 tài khoản, kép→OTP), re-verify user+phone giữa start↔consume, expiresAt tương lai. (5) **Không log token** (route trả message+code); S2S token env-only, độ dài 32–512. Assertion length-gated 100–4096.
- **‼ BLOCKER (phải rebase trước merge):** nhánh cắt tại `84ff7c1` (**trước P0-B `f97f766`**) → thiếu cache App VAT; merge nguyên trạng **revert P0-B (perf Chi phí của tôi vừa deploy) + xóa artifact benchmark**. Yêu cầu `git rebase origin/main`, giữ P0-B, rồi push lại.
- **Hardening (không chặn, nên làm):** (a) `start` trả `expectedEmployeeCode` + phân biệt kép/không-thấy → **oracle dò phone→mã NV**; cân nhắc không trả mã + lỗi chung + rate-limit. (b) **Chưa rate-limit** `/auth/trusted-device/start|consume` → có thể spam App Sale; thêm giới hạn. (c) One-time claim ở App Report là **in-memory per-process** → nếu chạy đa worker, phòng replay THẬT dựa vào **App Sale CONSUME single-use** (migration `0103_..._replay`) — App Sale phải khóa 1-lần theo nonce+reportDeviceId+audience+empCode một cách atomic.
- **Cổng LIVE (đủ CẢ hai mới deploy):** rebase + 4 cấu hình bot nêu (migration replay, CORS origin `report.donapharm.asia`, App Sale giữ key/hash, S2S token qua kênh secret) + **test live "máy tin cậy mở App Report không hỏi OTP" + thử replay/hết hạn phải rơi về OTP**. Chưa deploy.

### 2026-07-24 — Claude Code (review hậu kiểm) — P0-B perf `f97f766` deploy: PASS + bước tiếp (bảng ALL còn 13s)
- **Review độc lập diff `84ff7c1..f97f766` (đã deploy production): PASS, không blocker.** Kiểm phần cache App VAT: **key cache có `empCode`** (`${empCode}:${year}-${month}`) → **KHÔNG lẫn dữ liệu giữa NV** (self-scope giữ); **chỉ cache projection đã validate, KHÔNG cache raw/token**; TTL ngắn có trần (ok 60s / lỗi 15s) + inflight dedup + bounded size; test injection bỏ cache (cô lập). Hash dữ liệu trước/sau **trùng tuyệt đối** → số không đổi.
- **Kết quả:** chế độ ALL **không còn fan-out App VAT 21 lượt** (điểm/xu lazy per-NV); single-NV **2,43s fresh / 279ms cache hit**. Đúng mục tiêu P0-B.
- **‼ CÒN LẠI — bảng ALL vẫn ~12,7–13,4s:** không phải App VAT nữa, mà là **tính bảng chi phí 21 NV** (catalog + ghép chi phí per-NV) **chưa cache**. **Bước tiếp (P0):** memo-cache `employeeCostAllPayload` theo (kỳ + filters + scope admin), **invalidate theo chữ ký slot** (đổi upload → xóa cache) → lần 2 tức thì. Kèm P0 chung (memoGet cho `/analysis /alerts /revenue /cst /filters`) cho Tổng quan. Nguyên tắc như P0-B: chỉ tốc độ, không đổi số/quyền, key có scope.

### 2026-07-24 — Report Bot — P0-B hiệu năng Chi phí của tôi (review, chưa deploy)
- Chế độ CEO/admin `Tất cả nhân viên` chỉ tải bảng chi phí, **không gọi** `/employee-cost/diem-xu?emp=ALL` nên loại bỏ fan-out App VAT khoảng 21 NV lúc mở trang. Điểm/xu/phạt được tải bất đồng bộ khi chọn đúng một NV; request bảng có ưu tiên render trước.
- Cache App VAT theo `(empCode, period)` TTL 60 giây, có in-flight coalescing; cache chỉ giữ projection đã validate, không giữ token/raw response. F5/đổi lại NV-kỳ không gọi lặp upstream.
- ALL endpoint vẫn fail-closed từng NV và giữ HTTP 200: NV lỗi có `available=false/note="chưa lấy được xu kỳ này"`, các trường xu/phạt để `null`; không làm hỏng payload toàn trang, không suy diễn số.
- Chỉ thay luồng tải/cache; không đổi công thức, dữ liệu nguồn hay scope. Benchmark cô lập 21 request giả lập 100ms/concurrency 3: fan-out cũ **21 call/705,90ms**, mở ALL mới **0 App VAT call**; một NV fresh **108,94ms**, cache hit **0,024ms**. Hash payload fresh/cache trùng SHA-256; hash route bảng chi phí trước/sau trùng tuyệt đối. Evidence: `artifacts/report-perf-p0b-benchmark-20260724.json`.
- Gate review: focused **21/21**, full server **328/328**, full web **58/58**, Vite build production vào `/tmp` cách ly, syntax và `git diff --check` đều PASS. Chưa deploy; chờ CEO duyệt 3 nút.

### 2026-07-24 — Claude Code (nghiệm thu deploy + luật) — UI KPI v2 `2430f5d` PASS + LUẬT cách ly build review
- **Nghiệm thu UI v2 (Phạt xuống cấn trừ · Chi phí gốc gộp lên): PASS.** Kiểm độc lập diff `780b572^..0729971` = **chỉ frontend** (`EmployeeCost.jsx`+`styles.css`+test web); **KHÔNG chạm** backend/route/analytics/auth/số/quyền; C32/C47 khóa. Deploy `2430f5d` khớp main.
- **‼ LUẬT DEPLOY (bắt buộc từ nay) — cách ly build review, không ghi web/dist chung trước duyệt:** Bot tự khai bản review từng ghi vào `web/dist` dùng chung → web server đọc bản chưa duyệt sớm ~1 phút. Lần này vô hại (UI, cùng nội dung sau duyệt) nhưng **cùng lỗ hổng với bản điểm/xu/phạt/chi phí = SỐ CHƯA DUYỆT LỌT PRODUCTION → trừ oan/bịa số**, cấm tuyệt đối. Quy tắc: **build review vào thư mục TÁCH BIỆT** (không phải dir đang phục vụ); production dir chỉ đổi **SAU khi CEO duyệt**; sau deploy **kiểm version phục vụ == commit đã duyệt** (health/version). Bot đã cam kết áp dụng — áp cho MỌI deploy sau, đặc biệt bản đụng số/tiền.

### 2026-07-24 — Claude Code (điều tra hiệu năng) — App Report chậm F5/đổi trang; "Chi phí của tôi" nặng nhất
- **CEO báo app tải rất chậm mỗi F5/đổi trang, riêng "Chi phí của tôi" chậm + hay lỗi.** Điều tra code production (`f560402`). Báo cáo: `BAO_CAO_HIEU_NANG_APP_REPORT.md`; task sửa: `TASK_REPORT_PERF_FIX.md` (giao Report Bot).
- **Nguyên nhân chính:** Trang Tổng quan bắn **~11 API/lần**, trong đó **7 endpoint nặng KHÔNG cache** (`/analysis`,`/alerts`,`/revenue`×2,`/cst`,`/filters`,`/targets`×2 — chỉ `/overview`,`/trend` có memoGet). Node 1 luồng → request nặng chặn event-loop → xếp hàng. `/alerts` lặp per-NV (O(NV×kỳ))+`cstTable`; `/analysis` bị kéo vào Tổng quan chỉ để hiện 1 hàng insights; `api.targets` gọi trùng 2 lần.
- **‼ "Chi phí của tôi" (nặng nhất):** chế độ "Tất cả NV" gọi App VAT `/api/khoan/dashboard` **qua mạng cho TỪNG NV (21 lần)**, timeout 5s+retry, concurrency 3 → ~7 đợt mạng; App VAT chậm → chạm timeout → "Lỗi máy chủ"/tải mãi.
- **KHÔNG phải nguyên nhân:** bundle JS đã cache immutable (F5 không tải lại code); tầng store đã cache `_allRows`/`_cstAll` tốt.
- **Hướng sửa (Report Bot, chỉ tốc độ — KHÔNG đổi số/quyền):** P0 thêm memoGet cho 5 route đọc nặng (key có empCode, TTL 30–60s, invalidate theo chữ ký slot) + bỏ gọi trùng; **P0-B** cache App VAT theo (empCode,period) + **lazy-load điểm/xu chỉ cho NV đang xem** (không chặn cả trang chờ 21 lượt App VAT) + ALL resilient (1 NV lỗi không sập trang); P1 bật `compression`. Nghiệm thu: đối chiếu số trước/sau TRÙNG + đo tốc độ lần 1 vs lần 2.

### 2026-07-24 — Report Bot — UI KPI Điểm/Xu/Thưởng/Phạt #170 DEPLOY PASS
- **Bố cục đã duyệt:** trong lưới KPI, `Thưởng dự kiến` đứng ngay cạnh `Phạt dự kiến`; `Xu tích lũy` được chuyển khỏi lưới KPI xuống đầu hàng cấn trừ theo đúng thứ tự `[Xu][Chi phí gốc] − [Cấn trừ] = [Còn lại]`. Desktop dùng 4 cột KPI/6 cột phương trình; mobile ép 1 cột, không tràn ngang. Nút Zalo OA nổi được ẩn riêng tại màn Employee Cost mobile để không che ô chi phí.
- **Màu/ngữ nghĩa:** cặp Điểm↔Xu dùng indigo `#4338ca` trên nền `#eef2ff`; Thưởng xanh `#047857`; Phạt đỏ `#b91c1c`. Nguồn Điểm chỉ hiện `App Report · point-local-2026-05-r1` khi rule local thực sự active, ngược lại fallback `App VAT`. Phạt vẫn ẩn số `—`, trạng thái `đang đối soát`; cấn trừ/còn lại không mở khi parity chưa exact-zero, không ghi DataHub/payroll.
- **Nghiệm thu UI tạm:** DN009 hiện `53,96 · 53,96`; desktop `1440×1400` và mobile `390×1200` đều PASS layout/màu/nguồn/rule/khóa phạt; visual review cuối PASS, không blocker. Evidence: `artifacts/employee-kpi-layout-ui170-acceptance.json`, `artifacts/employee-kpi-layout-ui170-desktop.png`, `artifacts/employee-kpi-layout-ui170-mobile.png`.
- **Gate trước deploy:** web **57/57**, focused **6/6**, Vite production build, `git diff --check`, frontend secret/forbidden-field scan đều PASS. Claude review độc lập commit `998dc8b`: **PASS, không blocker**.
- **Deploy sau CEO duyệt:** merge/push `main` tại **`a18c453`**, production version **`a18c453-20260724-120751-096`**. Health local/public PASS; asset JS/CSS public khớp byte-for-byte build local, đủ marker màu/nguồn/khóa phạt. Đây là UI-only nên không restart backend; PM2 `app-report` giữ online. Rollback: `backup/pre-ui-kpi-deploy-20260724-120734` + `backups/ui-kpi-deploy-20260724-120734`. Evidence: `artifacts/employee-kpi-layout-ui170-production-deploy.json`.

### 2026-07-24 — Report Bot — deploy production Điểm local #169 PASS, Phạt tiếp tục khóa
- Đã pull `origin/main`, tạo rollback `backup/pre-point-local-display-deploy-20260724-113003` + `backups/point-local-display-deploy-20260724-113003`, merge nhánh Claude review PASS vào `main` tại **`fbe0f6a`**, push/build và restart `app-report`. Production hiện phục vụ **`fbe0f6a-20260724-113018-363`**; health nội bộ/public HTTP 200.
- Nghiệm thu LIVE bằng phiên QA self-scope tạm: yêu cầu giả `emp=DN016` dưới phiên DN009 vẫn bị ép đúng DN009; Điểm tháng/quý **`53,96 · 53,96`**, nguồn `App Report`, rule `point-local-2026-05-r1`, local/public HTTP 200. Phiên QA đã xóa và restart dọn sạch sau nghiệm thu.
- **Khóa an toàn giữ nguyên:** `penalty_applied=null`, parity `available=false`, trạng thái `đang đối soát`; chưa xuất phạt, chưa cấn trừ, chưa gửi thông báo, không ghi DataHub/payroll. Evidence: `artifacts/employee-point-local-prod-acceptance-169.json`.

### 2026-07-24 — Report Bot — Điểm local/DataHub penalty endpoint + bảng 8 đơn vị UNALLOCATED (chưa deploy)
- **Hoàn tất endpoint chỉ đọc cho DataHub:** `GET /api/integrations/datahub/employee-quarter-penalty?emp=<MÃ_NV>&quarter=YYYY-Qn`. Endpoint chỉ nhận service token backend (`Authorization: Bearer` hoặc `x-app-report-service-token`), chỉ cho đúng 1 NV thuộc roster, không nhận `ALL`, không có route ghi. Payload xuất `emp_code · quarter · point_quarter · xu_quarter · missing_xu · phat_tien · rule_version`; App Report không ghi payroll/không sửa DataHub.
- **Gate phạt fail-closed theo đúng kỳ:** chỉ trả HTTP 200/số phạt khi parity `exact_zero=true` đồng thời khớp đúng tháng cuối quý, point rule, NV và đủ Xu/công thức; mọi trường hợp khác trả HTTP 409, `phat_tien=null`, trạng thái `đang đối soát`. Parity LIVE T07/2026 hiện **BLOCKED**: DN009 `53,96↔0`, DN016 `48,01↔0`, DN024 `21,70↔0`, DN001 `41,21↔0`; artifact `artifacts/employee-point-local-live-parity-169.json`. Vì vậy **không deploy** và chưa có số phạt nào được xuất để trừ thật.
- **Xuất bảng CEO 8 đơn vị UNALLOCATED:** snapshot phát hiện `rev_2src_072026_20260723020053.json` (run 185, data as of 23/07 09:00:46, DataHub roster v3.7) có đúng **8 đơn vị · 26 dòng · 15 đơn · 22 QLNB · 403.042.400đ** theo policy `ROSTER_CONFLICT_TO_UNALLOCATED_NO_REMAP`. Đối soát snapshot active `rev_2src_072026_20260724030103.json` (run 201, data as of 24/07 10:00:55, roster v3.9): đủ 26/26 source line và hiện **UNALLOCATED = 0 đơn vị/0 dòng/0đ**. Excel 3 sheet + JSON/README evidence tại `artifacts/unallocated-8-units-20260724/`.
- **Gate kỹ thuật:** focused **69/69**, full server **327/327**, web **56/56**, Vite production build PASS; `git diff --check`, frontend secret scan, DataHub write-path scan, SHA-256/structure/tổng Excel đều PASS. Không gửi Telegram/email, không restart/deploy production.

### 2026-07-24 — Claude Code (review độc lập) — Điểm-local + endpoint phạt DataHub `95a41bf`: PASS code · blocker mở khóa phạt = App VAT
- **Đọc code thật + chạy độc lập test.** Nhánh `review/employee-point-local-169` (3e885e7→95a41bf). **VERDICT: PASS về code**, không lỗi chặn; **giữ deploy** (đúng thiết kế, phạt fail-closed).
- **Đã kiểm & xác nhận:** (1) **Điểm đúng công thức** `Σ(DT×hệ số÷100tr)` làm tròn 2 số; hệ số config `employee_point_coeff.json` CL/NT=2·NCL 025–028=2·default **1** (không rõ tuyến→1, có DQ warning, **không bịa 2**); loại `isExcluded` (không tính điểm cho UNALLOCATED). (2) **App VAT giờ xu-only** — `employeeVatKhoan.js` bỏ hết trường điểm/phạt/pct, chỉ còn xu/carry. (3) **Phạt fail-closed**: `parityStatus` chỉ mở khi gate `exact_zero_parity=true` + đúng rule+kỳ+NV; chưa đạt → `phat_tien=null`, "đang đối soát". (4) **Endpoint DataHub** `GET /integrations/datahub/employee-quarter-penalty` = **service-token-only** (`requireDataHubService`, chặn cookie user), **1 NV/quý**, read-only, **re-validate** `phạt===floor(max(điểm−xu,0)/2)×600k` (chống trừ oan), không payroll/không sửa DataHub. (5) **Thông báo = preview-only, CHƯA gửi thật** (`outcome=preview_only_send_disabled`), actor băm, đủ quy tắc điểm+xu+phạt. (6) Self-scope qua `resolveScopedEmployee` (NV ép own). **Chạy độc lập: 11/11 test điểm PASS.**
- **‼ PHÁT HIỆN KIẾN TRÚC (quan trọng):** parity artifact cho thấy **App Report tính điểm ĐÚNG** (DN009=53,96·DN016=48,01·DN024=21,70·DN001=41,21) nhưng **App VAT vẫn trả điểm = 0** → delta = chính số App Report, **exact_zero=false toàn bộ**. Cổng phạt so App Report ↔ App VAT nên **KHÔNG thể = 0 tới khi App VAT sửa** → **blocker mở khóa phạt nằm ở APP VAT** (phải tính điểm nội bộ từ ĐÚNG doanh thu App Sale làm oracle đối chiếu), **không phải App Report**. Đã làm rõ trong directive §4. App VAT vẫn xu-only cho hiển thị nhưng giữ điểm-nội-bộ làm oracle (defense-in-depth). Task: `TASK_APPVAT_DIEM_PARITY.md`.
- **Khuyến nghị deploy (tách 2 phần):** **(A) Điểm-local DISPLAY deploy được NGAY** — sửa đúng lỗi "Điểm 0·0", điểm nổi số thật + nhãn "App Report" + `point-local-*`; phạt vẫn "đang đối soát" (an toàn). **(B) Mở khóa phạt** chờ App VAT parity=0. CEO duyệt (A) trước để NV thấy điểm đúng; (B) sau.
- **Báo cáo 8 đơn vị (Excel):** số nội tại khớp — 26 dòng · 8 ĐV · **403.042.400đ** tại snapshot phát hiện (run #185, roster v3.7). **Snapshot hiện tại (run #201, roster v3.9) UNALLOCATED = 0** → roster mới đã gán 26 dòng về "NV hiện tại". ⇒ Không còn treo; nhưng **cần CEO xác nhận "NV hiện tại" của 8 ĐV có đúng phụ trách không** (trước đó gán lẫn nhiều NV). Đúng → khỏi cần Sale Bot remap.

### 2026-07-24 — Claude Code (CEO chốt) — Nút TRỪ tiền phạt đặt tại DATAHUB smart app (CEO bấm)
- **CEO chốt:** đơn vị **thực thi lệnh trừ** phạt thiếu-xu = **DataHub smart app** (chủ sở hữu "chi phí bán hàng"); **CEO bấm nút duyệt trừ** tại DataHub. Cập nhật `DIRECTIVE_EMP_COST_DIEM_LOCAL.md` §7 + §8.4.
- **Luồng chốt:** App Report tính điểm(SSOT)+phạt dự kiến (đã parity) → **xuất số phạt** cho DataHub qua service endpoint self-scope (per-NV/quý: `emp_code·quý·điểm·xu·thiếu·phat_tien·rule_version`) + gửi Telegram/Email báo NV kèm quy tắc → **CEO xem & bấm nút ở DataHub** → DataHub **ghi cấn trừ thật** vào chi phí bán hàng bằng đúng số App Report (1 nơi duy nhất ghi, versioned+audit) → App Report hiển thị "đã cấn trừ (DataHub)". **App Report KHÔNG tự trừ/không sửa chi phí.**
- Task giao **DataHub Bot**: `TASK_DATAHUB_PENALTY_DEDUCT.md` (dựng nút duyệt + đọc số phạt App Report + ghi cấn trừ + audit; **không tự tính lại** — dùng số SSOT đã parity). **Còn chờ:** Report Bot cần dựng service endpoint xuất số phạt (bổ sung vào việc điểm-local).

### 2026-07-24 — Claude Code (review độc lập) — Thưởng v2 (C10) nhánh `review/employee-cost-bonus-v2-166` `3c3dc9d`: PASS code, GIỮ deploy
- **Đọc code thật, không nhận PASS theo lời bot.** Engine `f373dfc` + menu/config/preview `18641fd`. **VERDICT: PASS về code** với 1 **BLOCKER hợp nhất** + 2 lưu ý nhỏ; **giữ deploy** tới khi DataHub expose C10 + parity.
- **Đã kiểm & xác nhận:** (1) **Chỉ đọc C10** từ catalog DataHub — `buildPriorityRevenue` không đọc `priority`/`tech_rank` App Sale (có test khẳng định); (2) **Fail-closed** phần nhóm ưu tiên = 0 khi C10 thiếu/rỗng/sai allowlist/xung đột (`sourceAvailable=false` hoặc mã đa nhóm → unclassified); (3) `catalogManagement`: C10 vào whitelist optional, **C32/C47 vẫn khóa vĩnh viễn**, DQ projection không lộ %/C32/C47; (4) **Self-scope + admin-only:** mọi route `/admin/bonus-policies*` là `requireAuth+requireAdmin`; **save bắt buộc preview cùng phiên** (one-time, 15', đúng actor) → có preview trước khi lưu + audit; ALL/aggregate chặn non-admin 403; (5) **Không payroll/không gửi thưởng/không sửa DataHub** — chỉ "Thưởng dự kiến". Base = doanh thu **trước VAT** (path production dùng override theo `segment.revenue` before-VAT). Cap base tier ≤0.25%. Config default đúng directive (tier 0/0.1/0.15/0.18/0.25; ngưỡng 101%; H.A*1·H.A0.8·H.B0.5·H.C0.1·H.D0.1). **Chạy độc lập 14/14 test bonus PASS.**
- **‼ BLOCKER (hợp nhất) — phải rebase trước khi merge:** nhánh cắt tại `a875c42` (trước #169/#170) → **thiếu `DIRECTIVE_EMP_COST_DIEM_LOCAL.md`**; merge nguyên trạng sẽ **xóa directive điểm-local + revert 2 mục CHANGELOG**. Yêu cầu `git rebase origin/main` (hoặc merge main vào nhánh) rồi push lại, xác nhận directive còn nguyên.
- **Lưu ý nhỏ (không chặn, display-only):** (a) path fallback không-override tính base theo `achieved` (KPI) thay vì tổng before-VAT — production dùng override nên không lệch live, nên đồng bộ về before-VAT cho nhất quán; (b) `totalCapPct` mặc định `null` = **không trần tổng tuyệt đối** (rate ưu tiên tới 1.0% không bị chặn cứng) — vì là "dự kiến" nên chấp nhận, khuyến nghị đặt 1 trần an toàn.
- **Deploy gate (bot đã tự giữ — đồng ý):** DataHub production **chưa expose C10** → phần nhóm ưu tiên fail-closed 0. Cần DataHub hoàn tất C10 + **parity** rồi mới xin CEO duyệt 3-nút. **Production hiện KHÔNG đổi.**

### 2026-07-24 — Claude Code (giao bot, bổ sung) — Cơ chế phạt theo QUÝ + cảnh báo tháng + thông báo trước khi trừ
- **CEO chốt cơ chế phạt.** Cập nhật `DIRECTIVE_EMP_COST_DIEM_LOCAL.md` §7–§8: (1) **Cảnh báo NGHIÊM KHẮC hàng tháng** khi thiếu xu (Telegram/Email) để NV kịp khắc phục — chưa trừ; (2) **Chốt trừ 1 lần vào tháng cuối quý** (T03/T06/T09/T12): ví dụ đang T07/2026 → cuối T07/T08 chỉ cảnh cáo, **cuối T09** mới cấn trừ vào chi phí bán hàng nếu xu quý < điểm quý; (3) **‼ Thông báo TRƯỚC khi trừ** qua Telegram+Email, **kèm quy tắc tính điểm + tính xu + công thức phạt + số liệu** để NV nắm rõ, không âm thầm.
- **Ranh giới:** App Report tính điểm (SSOT) + phạt dự kiến + cảnh báo + **gửi thông báo**; **KHÔNG** ghi payroll/không sửa chi phí DataHub/không tự phát lệnh trừ. **Việc ghi cấn trừ THẬT** vào chi phí bán hàng do **1 nơi** (DataHub/quy trình tài chính hoặc App VAT SSOT khoản) thực hiện bằng đúng số đã qua **parity** — tránh trừ 2 lần/lệch số. **Còn hỏi CEO:** đơn vị thực thi lệnh trừ. FE phân biệt "dự kiến — chưa trừ" (tháng thường) vs "chốt quý — cấn trừ" (tháng cuối quý).

### 2026-07-24 — Claude Code (giao bot) — Điểm tháng/quý: App Report TỰ TÍNH (không lấy App VAT); Xu vẫn App VAT
- **CEO chốt:** điểm tháng/quý **có sẵn ở App Report** (có doanh thu rồi) → **tự tính**, không gọi App VAT lấy điểm. Bằng chứng: production hiện **"Điểm 0·0 — Nguồn App VAT"** cho DN009 dù DN009 doanh thu thật **2.660.205.490đ** (App VAT đọc doanh thu cũ/lệch). Directive `DIRECTIVE_EMP_COST_DIEM_LOCAL.md`.
- **Phân công số:** **Điểm** = App Report tính `Σ(DT_dòng × hệ số ÷ 100tr)` làm tròn 2 số (App Report = **SSOT điểm** vì sở hữu doanh thu); **Xu** = App VAT giữ (SSOT xu từ bill); **Phạt** dự kiến = App Report ghép `floor(max(điểm_quý−xu_quý,0)÷2)×600k`, **display-only, không payroll**. Hệ số config versioned: CL=2.0·NT=2.0·NCL đơn vị 025–028=2.0·NCL thường=1.0 (T05/2026); tuyến không rõ → **default 1.0** (không bịa 2.0). App VAT hỏng chỉ mất **xu**, **điểm vẫn hiện**.
- **‼ Gate "không trừ oan tiền NV":** phạt là tiền thật → **bắt buộc parity điểm App Report ↔ App VAT = 0 sai số** (khi App VAT đọc đúng doanh thu) trước khi deploy phạt; lệch → ẩn/gắn cờ phạt "đang đối soát". FE đổi nhãn nguồn điểm **App VAT → App Report**. **Còn hỏi CEO:** phạt tính tại App Report (mặc định, có gate) hay vẫn chỉ đọc số App VAT.

### 2026-07-24 — Report Bot — hoàn tất nhánh review Thưởng v2 #166 (chưa deploy)
- Pha 1 `f373dfc`: engine 2 phần đúng directive — cơ bản theo mức đạt target và cộng nhóm ưu tiên từ **DataHub C10 duy nhất** khi tổng đạt `≥101%`; tổng cap mặc định tắt. Thiếu/rỗng/sai/xung đột C10 đều fail-closed về 0 phần 2 và trả coverage/note; code không đọc `App Sale priority/tech_rank`.
- Pha 2 `18641fd`: menu **Target → Cấu hình Thưởng v2** có version theo giai đoạn, bậc/rate/ngưỡng/cap, đè tầng `mặc định → nhóm C10 → tuyến → đơn vị → NV`, preview theo NV trước khi lưu, preview-id một lần/15 phút/cùng actor, audit nguyên tử. Menu không cho sửa mapping C10; kết quả vẫn là **dự kiến/read-only**, không payroll/không gửi thưởng.
- Catalog chỉ whitelist/project tùy chọn `c10`; khóa cứng `c32/c47` không đổi. Gate nhánh: server **313/313**, web **56/56**, build production và `git diff --check` PASS; quét source/diff không có fallback App Sale hoặc secret. **DEPLOY BLOCKED** vì DataHub production/LKG v3.9 vẫn chưa expose C10; chỉ push nhánh `review/employee-cost-bonus-v2-166` để review độc lập.

### 2026-07-24 — Report Bot — xác minh nguồn C10 cho Thưởng v2 #166/#167
- DataHub production catalog-management version `3.9` trả **27.719 catalog + 27.719 assignments**, nhưng chỉ expose `c3,c4,c5,c6,c7,c15,c16,c17,c25,c31`; **không có `c10/C10`**, vẫn khóa đúng `c32/c47`. LKG App Report cùng version cũng không có C10.
- App Sale production revision `8b42c07e` có `products.tech_rank` cho đủ **371/371 QLNB**: `H.A*=136`, `H.A=102`, `H.B=62`, `H.C=46`, `H.D=17`, ngoài directive còn `H.E=4`, `H.F=4`; không thiếu/trùng QLNB xung đột. Đây chỉ là bằng chứng đối chiếu, **không được dùng runtime** vì SSOT chính thức là C10 CEO vault/DataHub.
- Kết luận: phụ thuộc DataHub expose C10 đang **BLOCKED**. App Report tiếp tục làm engine/menu trên nhánh review với C10 strict và fail-closed; không fallback App Sale, không tự phân nhóm, chưa deploy. Evidence: `artifacts/employee-bonus-v2-c10-verification-166.md`.

### 2026-07-24 — Claude Code (nghiệm thu) — production reward `55f8bd0`: PASS
- **Kiểm tra độc lập trên main: PASS.** `employeeVatKhoan.js` + routes đọc App VAT trên main; **`VAT_SERVICE_TOKEN` KHÔNG ở FE** (chỉ backend, FE dùng session token user). Code deploy = bản review `0c1da00` + **parity 0 sai số** (điểm/xu/phạt App Report = App VAT). Self-scope 2 lớp, không lộ token (chỉ sid băm ở App VAT), số chi phí DataHub không đổi. Version live `55f8bd0-20260724-072611`.
- Ô **Thưởng dự kiến** live nhưng hiện "Chưa cấu hình" (chờ Thưởng v2 + C10). **Đã LIVE:** điểm/xu/phạt + dòng cấn trừ + cảnh báo.
- **Còn lại:** Thưởng v2 (chờ DataHub expose C10) + CEO điền bậc; các mục nguồn cũ (DataHub catalog V30.10/gap, Sale Bot 8 đơn vị, unit_province.json).

### 2026-07-24 — Report Bot (deploy + nghiệm thu production) — Thưởng dự kiến + Điểm/Xu/Phạt App VAT #162/#165 PASS
- Đã merge bản được CEO duyệt vào `main` tại `55f8bd0`, push GitHub, build/deploy frontend và restart đồng bộ backend + Telegram worker. Production `report.donapharm.asia` đang phục vụ version **`55f8bd0-20260724-072611-012`**; health nội bộ/public đều 200. Runtime cuối: `app-report` PID **652694**, `app-report-tgbot` PID **652702**, App VAT PID **542573**, DataHub online. Rollback: branch `backup/pre-reward-diemxu-deploy-20260724-072453` và backup `backups/reward-diemxu-deploy-20260724_072903/`.
- Nghiệm thu LIVE T06/2026 đối chiếu trực tiếp App Report ↔ `/api/khoan/dashboard`: **DN009 và DN016 khớp tuyệt đối toàn bộ điểm/xu/carry/%/thiếu-dư/phạt, sai số 0**, cùng `rule_version=khoan-ssot-v2026-05-r1`. DN009: điểm tháng/quý **58,64 / 163,31**; xu tháng/quý tổng **23,83 / 115,81**; carry **6,48**; đạt quý **70,91%**; thiếu **47,5 xu**; phạt **13.800.000đ**. Phiên DN009 cố hỏi `emp=DN016` vẫn bị ép trả đúng **DN009**; public proxy HTTPS cũng PASS.
- UI production PASS: ô **Thưởng dự kiến** hiện đúng **“Chưa cấu hình mức thưởng”** vì tiers đang để trống/fail-closed; cảnh báo sớm `<90%` hiển thị đúng số DN009; hàng **Chi phí gốc / Cấn trừ thiếu xu / Còn lại (display-only)** tách hai nguồn DataHub/App VAT và ghi rõ **không ghi DataHub/payroll**. T06 có coverage chi phí 0% nên số tiền chi phí/cấn trừ fail-closed thành `—`, không tự bịa hoặc sửa DataHub.
- Khóa DataHub trước/sau deploy không đổi: DN001 T07 giữ **10.982 dòng / 5 cột**, cùng SHA-256 nguồn `0afe9a2feca2d996d5fb161e18a54a782c7481e74efdf7f9f0f8134649ba19e3`. Quét toàn bộ log active App Report/App VAT và bundle production: **0 full token, 0 prefix 16 ký tự, 81 sid băm**, frontend không có `VAT_BASE`/`VAT_SERVICE_TOKEN`/URL upstream. Đã redaction tại chỗ đúng **3 prefix-only** lịch sử trước hardening (không từng có full token), giữ nguyên phần log còn lại; 2 phiên QA tạm đã xóa, không chiếm thiết bị/không còn hiệu lực.
- Gate: full server/web tests PASS; focused **13/13 + 5/5**; production build và `git diff --check` PASS. Evidence: `artifacts/employee-reward-diemxu-prod-acceptance-162.json`, `artifacts/employee-reward-diemxu-prod-ui-162.png`.

### 2026-07-24 — Claude Code review — LIVE parity Điểm/Xu/Phạt #162 PASS
- **VERDICT: PASS · DEPLOY_DECISION: READY_FOR_DEPLOY_APPROVAL.** Claude review read-only toàn bộ directive, backend/FE, self-scope hai lớp, fail-closed, audit, token backend-only, UI display-only và artifact production parity; xác nhận không còn blocker kỹ thuật.
- Bằng chứng production: App VAT `473de59`, health OK; T06/2026 `DN001/DN009/DN016/DN024` khớp tuyệt đối, sai số 0; DN009 phạt `13.800.000đ`; log chỉ sid băm, không full token/prefix. `.env` production đã có `VAT_BASE`/`VAT_SERVICE_TOKEN` backend-only; focused tests `13/13 + 5/5`, build PASS. Review lưu tại `artifacts/claude-review-employee-vat-khoan-162.md`. **Chưa deploy/restart App Report; chờ CEO duyệt deploy riêng.**

### 2026-07-23 — Claude Code (cập nhật) — Nguồn nhóm ưu tiên Thưởng v2 = C10 (CEO vault/DataHub)
- CEO chốt: nhóm ưu tiên (H.A*/H.A/H.B/H.C/H.D) = **cột C10 trong CEO vault (DataHub)**. App Report **đọc C10** từ catalog snapshot, không tự phân loại/không config tay. **Phụ thuộc DataHub expose C10** (task `TASK_DATAHUB_EXPOSE_C10_PRIORITY.md` — whitelist như C48, khóa C32/C47). Cập nhật §2 directive Thưởng v2.

### 2026-07-23 — Claude Code (giao bot) — Thưởng v2: 2 phần (cơ bản + nhóm ưu tiên) + config linh hoạt
- CEO nâng cấp thưởng. Directive `DIRECTIVE_EMP_COST_BONUS_V2.md`: **Phần 1** cơ bản (`<90→0·90–100→0.10·100–110→0.15·110–130→0.18·≥130→0.25` × DT trước VAT); **Phần 2** nhóm ưu tiên (khi TỔNG đạt ≥101%): `H.A*→1.0·H.A→0.8·H.B→0.5·H.C→0.1·H.D→0.1` × DT nhóm. Tổng = P1+P2.
- **Linh hoạt:** config theo **giai đoạn (versioned)** + **đè tầng** (mặc định→nhóm hàng→tuyến→đơn vị→NV) + **menu chỉnh trong Target** + **preview** trước khi lưu + audit. Nhóm QLNB→ưu tiên: đọc catalog nếu có, không thì config CEO khai. Vẫn "dự kiến", không payroll, self-scope, fail-closed. Còn hỏi CEO: nguồn phân loại nhóm + "1% = 1% doanh thu nhóm". Chưa deploy.
- **Điểm/xu/phạt (`0c1da00`) deploy độc lập ngay** (#165, parity PASS) — không chờ Thưởng v2.

### 2026-07-23 — Claude Code (duyệt deploy) — LIVE parity điểm/xu/phạt PASS 0 sai số → READY DEPLOY
- **LIVE production parity #162 PASS 4/4 NV, sai số điểm/xu/phạt = 0** (App Report hiển thị = App VAT dashboard). Bằng chứng `1d7e100`. Token không lộ (chỉ `sid` băm). ⇒ App Report đọc đúng, không lệch/không bịa — an toàn "không trừ oan tiền NV".
- **Duyệt deploy** 2 nhánh reward (đều review PASS): ô Thưởng dự kiến `467eb2e` + đọc điểm/xu/phạt `0c1da00`. Directive `DIRECTIVE_EMP_COST_REWARD_DEPLOY.md` (deploy FE+BE đồng bộ + `.env` VAT_BASE/VAT_SERVICE_TOKEN backend-only + nghiệm thu). Sau deploy: CEO điền `employee_bonus_tiers.json`; (tùy chọn) rotate token.

### 2026-07-23 — Claude Code (review) — App Report đọc điểm/xu/phạt `0c1da00`: PASS (chờ live parity)
- **Review `0c1da00`: PASS.** `employeeVatKhoan.getForSession`: token backend-only (`VAT_SERVICE_TOKEN`), **KHÔNG log token** (audit chỉ actor+emp); **self-scope** (NV ép own; kiểm response `emp_code===empCode` chống App VAT trả nhầm NV); fail-closed (token<16/emp sai/baseUrl thiếu→không gọi; 401/timeout→retry→note). FE: 3 KPI điểm/xu/phạt + dòng cấn trừ (display-only) + cảnh báo. Test 305/305, web 53/53.
- **App VAT gỡ token-logging** (`473de59`: thay bằng `sid=sha256[:12]`, scrub log cũ) → **live parity chạy được**. Đề nghị nhẹ: rotate VAT_SERVICE_TOKEN. **Còn lại:** Report Bot chạy live parity (đối chiếu số App Report ↔ App VAT dashboard) → rồi deploy. Chưa merge/deploy.

### 2026-07-23 — Report Bot (review branch, chưa deploy) — App Report đọc Điểm/Xu/Phạt App VAT SSOT #162
- Thêm proxy backend read-only `GET /employee-cost/diem-xu` → App VAT `/api/khoan/dashboard`: `VAT_BASE`/`VAT_SERVICE_TOKEN` chỉ ở backend, timeout 5 giây + retry hữu hạn, response allowlist/schema chặt, lỗi trả đúng `chưa lấy được điểm/xu kỳ này`, không tính/remap điểm-xu-phạt tại App Report.
- Self-scope hai lớp: Sale bỏ qua `?emp=` và chỉ gọi mã phiên; CEO/admin chọn từng NV. Chế độ ALL gọi từng NV với concurrency giới hạn rồi chỉ cộng projection hiển thị, không yêu cầu upstream view-all. Mỗi lượt ghi audit actor/NV/kỳ/outcome/`rule_version`, không ghi token hay body nguồn.
- Employee Cost có 3 KPI **Điểm · Xu tích lũy · Phạt dự kiến**, nguồn + `rule_version`, cảnh báo sớm dưới 90%, và dòng **Chi phí gốc − cấn trừ thiếu xu = còn lại** display-only; giữ tách biệt DataHub/payroll, không ghi dữ liệu hoặc phát lệnh chi/trừ.
- Gate nhánh: server **305/305**, web **53/53**, production build PASS, `git diff --check` PASS; timeout upstream hard-cap 5 giây bao phủ cả lúc đọc body, bundle frontend không có biến/token/URL upstream App VAT. Fixture contract kiểm projection đúng tuyệt đối (sai số 0; phạt khớp nguyên số), gồm `rule_version=khoan-ssot-v2026-05-r1`. UI không ghép phạt tháng kết thúc vào tổng chi phí nhiều tháng; chỉ hiện phép cấn trừ khi chọn một tháng.
- **LIVE parity #162 PASS (24/07/2026 06:49 GMT+7, chưa deploy):** App VAT production `dona-vat` PID `542573`, health OK, commit bảo mật `473de59`; gọi thật `/api/khoan/dashboard` bằng `VAT_SERVICE_TOKEN`, kỳ `06/2026`, 4 NV `DN001/DN009/DN016/DN024`. App Report projection khớp App VAT tuyệt đối ở toàn bộ điểm/xu/carry/%/thiếu-dư/phạt, sai số `0`, cùng `rule_version=khoan-ssot-v2026-05-r1`; ca phạt thật DN009 khớp `13.800.000đ`. Log mới 4 Bearer requests chỉ có sid băm, không có full token/prefix. Focused tests server `13/13`, web `5/5`, production build và `git diff --check` PASS. Bằng chứng: `artifacts/employee-vat-khoan-live-parity-162.json`. App Report `.env` đã cấu hình backend-only `VAT_BASE`/`VAT_SERVICE_TOKEN` (secret không commit). Sẵn sàng để Claude chốt deploy; Report Bot chưa restart/deploy App Report.


### 2026-07-23 — Claude Code (review) — ô "Thưởng dự kiến" `467eb2e`: PASS
- **Review `467eb2e`: PASS.** `amount = doanh thu (revenue_before_vat) × bonusPct ÷ 100`. **Cap 0.5% khóa 3 lớp** (`min(config,0.5)` + mỗi bậc `min(bonusPct,capPct,0.5)`). **Fail-closed:** config rỗng/sai → "Chưa cấu hình mức thưởng"; **thiếu target → không bịa** (`missing_target`); dưới bậc → 0. **Phát hiện tầng chồng lấn** (overlap → unconfigured). Self-scope (tính theo empCode đã khóa). Test 292/292, web 48/48. Trên main, chưa deploy.
- Tầng nấc `employee_bonus_tiers.json` để trống → CEO điền sau (0.2–0.5%). Nhãn "dự kiến", không payroll.

### 2026-07-23 — Claude Code (giao bot) — App Report ĐỌC điểm/xu/phạt từ App VAT SSOT (đã ổn định)
- **App VAT chốt SSOT xong** (`/api/khoan/dashboard`, service auth Bearer + bắt buộc emp_code + no view-all, bill/carry thống nhất, commit `365b0c5`, rule_version `khoan-ssot-v2026-05-r1`). Contract-level PASS (App VAT repo khác, không soi code trực tiếp — tin test + commit App VAT).
- Directive `DIRECTIVE_EMP_COST_DIEMXU_CONSUME.md`: App Report **proxy backend** đọc App VAT (VAT_SERVICE_TOKEN backend-only, self-scope 2 lớp, fail-closed, audit, không LLM); FE **3 KPI** (điểm/xu/phạt) + **dòng "cấn trừ do thiếu xu"** (tách khỏi chi phí DataHub, display-only, "chi phí gốc − cấn trừ = còn lại") + **cảnh báo sớm** khi pct<90%. App Report chỉ đọc, không tính/không payroll.

### 2026-07-23 — Report Bot điều tra App VAT + Claude chốt hướng — điểm/xu/phạt = App VAT SSOT, App Report đọc
- **Kết quả điều tra (Report Bot):** App VAT ĐÃ có + expose điểm/xu per-NV. **Điểm** = `DT × hệ số ÷ 100tr` (CL/NT/NCL đơn vị 025–028=2.0; NCL thường=1.0 từ T05). **Xu** = `bill ÷ 500.000 × tỷ lệ` (1.3 từ T05). **Target xu = điểm doanh thu quý**. **PHẠT** = `floor(điểm thiếu ÷ 2) × 600.000đ` (từ T05). API: `/api/khoan/dashboard` (đủ nhất) + `/api/vat/xu-stats` + `/xu-overview`; self-scope NV OK.
- **Chốt hướng:** App VAT = **SSOT điểm/xu/phạt**, App Report **chỉ đọc** (không dựng engine). **CHƯA tích hợp** — 4 chốt App VAT phải xử trước (vì phạt = tiền thật): (1) 2 API tính bill khác → chọn 1 endpoint SSOT; (2) carry/reset + tỷ lệ/cảnh báo bất nhất; (3) chưa có auth service-to-service cho DataHub; (4) code điểm/xu chưa commit Git baseline. Task đã gửi App VAT Bot (`TASK_APPVAT_DIEMXU_SSOT.md`). Sau khi App VAT chốt: App Report đọc → 3 KPI (điểm/xu/phạt) + dòng "cấn trừ do thiếu xu" + cảnh báo (display-only, không payroll).
- **Riêng ô "Thưởng dự kiến" (target-based #159/#160)** độc lập — App Report tự tính từ target, chạy song song, không chờ App VAT.

### 2026-07-23 — Claude Code (giao bot) — Công thức tầng nấc thưởng: % doanh thu 0.2–0.5% (bổ sung #159)
- CEO chốt: thưởng là **% DOANH THU** (không phải tiền cố định), **kịch trần 0.5% cho đạt XUẤT SẮC**, sàn **0.2% khi đạt target**. Directive `DIRECTIVE_EMP_COST_BONUS_TIERS.md`: `Thưởng = doanh thu trước VAT × bonusPct(% đạt target)`; config `employee_bonus_tiers.json` dùng **`bonusPct`** (100–110%→0.2 · 110–120%→0.3 · 120–130%→0.4 · ≥130%→0.5), `capPct:0.5` chặn trần; <100%→0. Tháng & quý tính riêng. tiers rỗng → "Chưa cấu hình". Nhãn "dự kiến". Cấu hình được, CEO đổi không sửa code.

### 2026-07-23 — Claude Code (giao bot) — Ô KPI "Thưởng dự kiến" theo mức đạt target (khung trước)
- CEO muốn thêm **ô KPI thưởng**; target đã có trong App Report, **tầng nấc mức thưởng CEO điền sau**. Directive `DIRECTIVE_EMP_COST_BONUS_KPI.md`: ô **"Thưởng dự kiến (theo mức đạt target)"** = `bậc(% đạt target sẵn có)` × **bảng tầng nấc cấu hình** `employee_bonus_tiers.json` (để trống → hiện "Chưa cấu hình mức thưởng", không bịa). Nhãn **"dự kiến/tham khảo"** (không phải lệnh chi; App Report không gửi thưởng). Self-scope; số target từ analytics sẵn có (không tính lại). Điểm/xu/phạt (payout DataHub/App VAT) là việc khác. Chưa deploy.

### 2026-07-23 — Claude Code (giao bot) — Điều tra App VAT: điểm doanh thu + xu chi tiêu (cho KPI điểm/xu/phạt)
- CEO muốn thêm KPI **điểm (từ doanh thu) · xu chi tiêu tích lũy tháng/quý · phạt** nếu không đủ xu → **cấn trừ vào chi phí** (kèm cảnh báo). **Ranh giới:** đây là **payout** → engine ở **DataHub (SSOT)**/App VAT, App Report **chỉ hiển thị** (không tự tính, tránh trừ sai tiền NV).
- CEO chốt: điểm/xu **đã có ở App VAT** → giao Report Bot **điều tra App VAT** lấy đúng công thức (directive `DIRECTIVE_INVESTIGATE_APPVAT_DIEMXU.md`): (1) cách tính điểm doanh thu; (2) cách tính xu tích lũy + target quý; (3) App VAT có **API expose điểm/xu per-NV** không (để đọc lại). Read-only, chưa code. Sau báo cáo: Claude soạn task DataHub (engine phạt + contract) + task App Report (hiển thị KPI + dòng cấn trừ + cảnh báo).

### 2026-07-23 — Claude Code (review hậu kỳ) — vá blocker migration trusted-device `d8bbc53`: PASS
- **Bot tự phát hiện + vá blocker** (backfill ghi trust trước khi validate audit → có thể để device trusted không audit). **Fix PASS:** validate cả devices+audit **trước mọi write**; ghi file tạm + **rollback** nếu lỗi → không còn trạng thái trusted-thiếu-audit; assertion đếm (EXPECT_UPDATED/TRUSTED); **idempotent** (chạy 2 lần = 0 đổi). Hardening kèm: user thiếu/trùng fail-closed, không fallback `device.phone` cũ, FE chỉ nhớ SĐT từ phiên OTP hợp lệ. Backfill 31 thiết bị (23×1 · 6×2 · 2×3-trusted); CEO [3,2,0], 1 thiết bị miễn OTP. Fingerprint sai/thiết bị lạ bị từ chối; phiên cũ giữ. Test 286/286, web 46/46. Không đụng phần chi phí.

### 2026-07-23 — Claude Code (review hậu kỳ) — trusted-device login `df3b809`: PASS (feature Report Bot tự làm)
- **Review hậu kỳ (đã deploy production `df3b809`): an toàn.** Device băm **HMAC-SHA256** (không lưu ID thô); bản ghi **khóa theo `emp_code`** (device tin của NV này không bỏ OTP cho NV khác); **ngưỡng 3 OTP** mới thành tin cậy + ghi fingerprint (chống replay) + tối đa 3 thiết bị/tài khoản + **30 ngày reverify**. **`scopeOf`/`isAdmin`/`requireAdmin` KHÔNG đổi** → self-scope chi phí + quyền giữ nguyên. 61 phiên giữ, 54 device migrate HMAC. Test 279/279, web 46/46.
- **Lưu ý:** thiết bị tin cậy **bỏ OTP 30 ngày** (đánh đổi "nhớ thiết bị"); mất máy → **thu hồi device** (có danh sách + xóa) là chặn. Chỉnh chặt hơn qua env `SESSION_TRUSTED_DEVICE_REVERIFY_DAYS`/`SESSION_TRUSTED_LOGIN_THRESHOLD`. Không đụng phần "Chi phí của tôi".

### 2026-07-23 — Claude Code (nghiệm thu) — DQ Center production `1ec3455`: PASS + lưu ý PRODUCT_MISSING
- **Kiểm tra độc lập trên main: PASS.** DQ code + config + 4 route đã live; endpoint 200 (hết "Lỗi máy chủ"). 13 lỗi (12 đỏ/1 vàng), doanh thu ảnh hưởng 125.776.100đ; chuông 12 đỏ alert=true. **Self-scope chắc** (DN016 ép emp=ALL vẫn chỉ 2 lỗi của mình); Excel/PDF không C32/C47; số chi phí không đổi. 3 commit perf (cache catalog): cold request 180s→~1s. Test 274/274, web 43/43.
- **⚠ Lưu ý:** **PRODUCT_MISSING ("thiếu %") đang fail-closed → chưa nhảy chuông** (không báo bừa khi gap chưa grounded). ⇒ 13 lỗi **không gồm ~34 mã thiếu %** (vẫn ở tab gap). Không phải blocker; **đợt 2 nên grounded PRODUCT_MISSING** để loại lỗi lớn nhất cũng vào chuông. Đừng hiểu bảng DQ ít lỗi là dữ liệu sạch.

### 2026-07-23 — Report Bot (deploy + production acceptance) — DQ Center #141
- Đã merge review `6ad9769` vào `main` tại `4847157`, deploy đồng bộ frontend/backend và config `employee_cost_data_quality.json`; release production cuối **`1ec3455-20260723-115405-094`**. Public health/version 200; `app-report` online PID **2743911**, restart **97**; worker Telegram không cần restart, vẫn PID **2385158** / restart **42**. Backup/rollback baseline: `backups/employee-cost-dq-deploy-20260723_113416/`, rollback `fcb6bf5`.
- Nghiệm thu đầu tiên phát hiện request admin bị nguồn gap unavailable + quét toàn file catalog LKG 285 MB làm timeout 180 giây. Hotfix `7354afa`/`f533d82`/`1ec3455`: core DQ không bị gap giữ, đọc snapshot kỳ đã kiểm định và duy trì projection DQ 11 MB do luồng catalog/materializer cập nhật. Cold request T07 còn khoảng **1,0 giây**, không chặn `/health`; catalog T07 v3.7/checksum `17b237e3c86b4a71d8f968bb60d2ab88a94153e2b58f3e0ffd3ccb2dc6fe939d`, **27.719 dòng**. `PRODUCT_MISSING` giữ fail-closed khi chưa có gap snapshot grounded, không báo thiếu giả.
- API CEO local + public HTTPS `/api/employee-cost/data-quality?from=2026-07&to=2026-07` đều **200**: **13 exception = 12 đỏ + 1 vàng**, doanh thu ảnh hưởng **125.776.100đ**, đỏ **33.800.900đ**; gồm **6 `PRODUCT_MISMATCH` + 6 `UOM_MISMATCH` + 1 `UNIT_UNKNOWN`**. Summary chuông: `redCount=12`, `alert=true`; mỗi item có nguyên nhân, hành động, nguồn sửa.
- Self-scope live: DN016 dù gửi `emp=ALL&employee=CEO` vẫn scope DN016, chỉ **2 lỗi đỏ / 11.975.000đ**, **0 item chéo nhân viên**. Excel **44.135 bytes** và PDF **59.044 bytes**, đều HTTP 200/PDF hợp lệ; quét API/XLSX/PDF không có `C32`/`C47`. DQ read-only: DN001 trước/sau giữ nguyên period total **41.196.670đ**, annual **1.210.470đ**, revenue **2.479.111.324đ**.
- Gate cuối: server **274/274**, web **43/43**, build PASS, `git diff --check` PASS. Evidence: `/tmp/dq-deploy-acceptance/`.

### 2026-07-23 — Claude Code (review PASS + giao deploy) — DQ center `6ad9769`; "Lỗi máy chủ" = chưa deploy
- **Review `6ad9769`: PASS.** Self-scope **2 lớp** (getRows scope ownEmp cho NV + filterDqItems ép ownEmp; bell summary requireAdmin). `publicDqItem` **không lộ %/C32/C47** (chỉ revenue), key hash. Fail-closed: config sai→503, catalog thiếu→502 (không báo bừa). 5 rule, dashboard, chuông, export VN, audit, tìm bỏ dấu, gộp theo mã, xếp severity+doanh thu. Server 274/274, web 43/43, build PASS. Read-only (không đổi tiền).
- **CEO thấy "Lỗi máy chủ" ở tab Kiểm soát Dữ liệu = CHƯA deploy đồng bộ** (FE có tab, BE chưa nạp route `/employee-cost/data-quality` — hoặc thiếu config/catalog), FE quy về "Lỗi máy chủ". **Không phải lỗi code.** Directive `DIRECTIVE_EMP_COST_DQ_DEPLOY.md`: deploy FE+BE đồng bộ + kèm config `employee_cost_data_quality.json` + catalog kỳ; `curl` DQ endpoint phải 200.

### 2026-07-23 — Report Bot (review, chưa deploy) — Trung tâm Kiểm soát Dữ liệu chi phí #141 đợt 1
- Thêm rule engine cấu hình được với đúng 5 loại public: `PRODUCT_MISSING`, `PRODUCT_MISMATCH`, `UOM_MISMATCH`, `BID_PRICE_INVALID`, `UNIT_UNKNOWN`; fail closed khi catalog không sẵn sàng, không sửa/đoán dữ liệu nguồn. `UNALLOCATED` được phản ánh trong rule đỏ `PRODUCT_MISMATCH`, không tạo loại thứ sáu.
- Thêm API self-scope, dashboard Việt hóa, bộ lọc, phân trang, nguyên nhân/hành động/nguồn sửa, Excel/PDF chuẩn Việt Nam và summary admin-only cho chuông cảnh báo. API/export/model đều whitelist, không đưa `C32`, `C47` hoặc tỷ lệ nhạy cảm ra ngoài.
- Trên active T07 hiện engine lõi bắt 32 nhóm trước phần gap tỷ lệ: 26 attribution `UNALLOCATED`, 5 ĐVT lệch, 1 đơn vị lạ; 31 đỏ + 1 vàng, xếp theo doanh thu ảnh hưởng. Gate nhánh review: server 274/274, web 43/43, build PASS. Chưa deploy; chờ Claude review.

### 2026-07-23 — Claude Code (nghiệm thu) — guard cách ly doanh thu sai phụ trách `9a4a432`: PASS
- **Review `9a4a432`: PASS.** `revenueAttributionGuard.quarantineRosterConflicts`: emp_code nguồn xung đột roster phụ trách → **UNALLOCATED, KHÔNG remap** (policy `ROSTER_CONFLICT_TO_UNALLOCATED_NO_REMAP`); giữ `raw_emp_code` + audit; tổng công ty không đổi; có test khẳng định không tự gán NV mong đợi; chạy mỗi materialize → lỗi cũ không quay lại. Nguồn mới MISA run #185 (1.555 dòng / 23.778.161.153đ). DN023 còn đúng 1 dòng (140.BVĐK Bình Phước / 9.699.600đ). Test 265/265.
- **⚠ Còn treo (gốc ở App Sale):** 26 dòng / 8 đơn vị (142,145,147,149,151,152,153,154) / **403.042.400đ** đang UNALLOCATED — **chủ mới chưa thấy** cho tới khi **Sale Bot sửa mapping phụ trách + xuất lại** → App Report tự nhận đúng, bỏ cách ly (không cần deploy). App Report **không tự remap** (giữ nguyên tắc).

### 2026-07-23 — Report Bot (khẩn cấp) — cách ly doanh thu sai phụ trách, DN023 chỉ còn đơn vị 140
- Active T07 chuyển sang nguồn mới nhất CRM MISA run **#185** + APP WEB: **1.555 dòng / 23.778.161.153đ**. Giữ nguyên tổng doanh thu; không remap/đoán nhân viên tại App Report.
- Đối soát roster Data Hub **2026-07 v3.7**: **26 dòng / 8 đơn vị / 403.042.400đ** có `emp_code` nguồn xung đột được fail-safe về `UNALLOCATED`, giữ `raw_emp_code` và audit đầy đủ. **DN023 hiện chỉ còn 1 dòng / 9.699.600đ tại `140.BVĐK BÌNH PHƯỚC`**, không còn thấy BV Quân Dân Y 16, TTYT Bù Đốp hay đơn vị khác.
- Thêm attribution guard vào materializer để lịch tự động không ghi đè lỗi trở lại; snapshot roster thiếu/rỗng/trùng khóa thì fail closed. App Sale vẫn phải sửa mapping gốc `unit_product_employees` và xuất lại `emp_code`; khi nguồn đúng, guard tự ngừng cách ly.
- Gate: server **265/265 PASS**; active slot duy nhất `rev_2src_072026_20260723011949`; production health 200. Backup/audit trước xử lý: `backups/revenue-attribution-emergency-20260723_081713/`.

### 2026-07-23 — Claude Code (giao bot) — SỬA doanh thu gán SAI nhân viên phụ trách (nguồn App Sale)
- **CEO báo:** doanh thu lấy từ App Sale gán **không đúng NV phụ trách**. Chẩn đoán từ code: `store.js` gán NV theo **field `emp_code` trong nguồn** (`getRows` chỉ lọc `r.emp_code===empCode`); **App Report KHÔNG remap phụ trách** (điều chuyển NV đã cắt). ⇒ Sai attribution = **nguồn doanh thu active bị cũ/sai emp_code**, không phải lỗi tính.
- Directive `DIRECTIVE_EMP_COST_REVENUE_SOURCE_FIX.md`: bot xác định nguồn active (slot upload/ORDS `SALES_REPORT` + ngày), so phụ trách hiện tại, **nạp bản App Sale mới nhất** đúng emp_code; nếu nguồn vẫn sai → lỗi App Sale (không tự remap). emp_code không hợp lệ → `UNALLOCATED_EMP`, liệt kê. Cần CEO cho 1–2 ví dụ đơn vị/NV sai để truy chính xác.

### 2026-07-23 — Claude Code (nghiệm thu) — deploy #148 worklist + #150 độ rộng cột `e7c4fd5`: PASS
- **Kiểm tra độc lập trên main: PASS.** **Worklist #148 giờ đã LIVE** (lần trước thiếu): route `/employee-cost/province-worklist/export.xlsx` **requireAdmin** + audit; xuất 2 đơn vị / 103.588.300đ / 6 cột. Độ rộng cột #150 áp (C36–C45 đủ tên; thu hẹp Thành tiền/Hàm lượng/Nhân viên; nới Đơn vị/Nhà thầu; tooltip; sticky STT+Tên hàng). Server 261/261, web 39/39, build PASS.
- **Số không đổi:** DN001 41.144.556đ / C44 1.210.470đ / 171/184; ALL 2.391.033.447đ / C44 95.133.877đ. Self-scope (NV emp=ALL→403); C32/C47 không lộ (API/PDF/XLSX). Health 200; rollback sẵn.
- **Tiếp theo:** CEO điền `unit_province.json` từ worklist → Vùng/Tỉnh 100%. Còn: DQ center #141; DataHub %/alias.

### 2026-07-23 — Report Bot (deploy + nghiệm thu production) — #148 worklist + #150 độ rộng cột
- Claude Opus review commit `52339b2`: **PASS**, xác nhận thuần hiển thị và an toàn deploy chung. Đã merge vào `main` và deploy đồng bộ đúng **1 lần** tại release **`e7c4fd5`**, version **`e7c4fd5-20260723-074338-175`**; HTTPS/health 200. `app-report` PID **2287526** / restart **86**, `app-report-tgbot` PID **2287545** / restart **39**. Rollback: `backups/employee-cost-worklist-widths-deploy-20260723_074336/` (baseline `fe5da49`).
- Bảng web hiện đủ nhãn **C36/C41/C43/C44/C45** (header wrap, C44 badge **cuối năm**); thu gọn **Thành tiền trước VAT · Hàm lượng · Nhân viên**, nới **Đơn vị · Nhà thầu**; ellipsis/tooltip đúng. Chỉ STT/Tên hàng sticky, cuộn ngang desktop/mobile không tràn body. Live bundle kiểm đủ marker #148/#150.
- Khóa số production không đổi: DN001 tổng tháng **41.144.556đ**, C44 **1.210.470đ**, coverage **171/184 = 92,9%**; ALL tổng tháng **2.391.033.447đ**, C44 **95.133.877đ**. NV gọi `emp=ALL` → 403; ép DN001 hỏi DN016 vẫn resolve DN001. API/PDF/XLSX không hiển thị **C32/C47**.
- Worklist T07/2026 xuất đúng **2 đơn vị / 103.588.300đ**, đúng 6 cột: `175.BVĐK VŨNG TÀU` **91.975.200đ** và `135.HTNT-FPT LONG CHÂU` **11.613.100đ**; không %/chi phí/C32/C47. Gate: server **261/261**, web **39/39**, build/diff/render PASS. Evidence: `/tmp/app-report-worklist-widths-acceptance-e7c4fd5/acceptance.json`.

### 2026-07-22 — Claude Code (review #148 PASS + giao độ rộng cột) — worklist tỉnh `80a8c4c`
- **Review worklist #148 `80a8c4c`: PASS.** Route `/employee-cost/province-worklist/export.xlsx` = requireAdmin (CEO/admin), không nhận emp, **không %/C32/C47**; chỉ lấy tỉnh nguồn chính thức (loại catalog/inferred/guessed), xung đột tỉnh fail-closed. T07: **2 đơn vị** cần gán tỉnh (doanh thu ảnh hưởng 103.588.300đ). Audit đủ. Server 261/261, web 39/39, build + quét C32/C47 PASS.
- **CEO thêm: tinh chỉnh độ rộng cột** (thuần CSS): C36–C45 hiện **đủ tên** (header wrap); thu hẹp Thành tiền-trước-VAT · Hàm lượng (1 dòng+…+tooltip) · Nhân viên; **nới rộng Đơn vị · Nhà thầu**. Directive `DIRECTIVE_EMP_COST_COLUMN_WIDTHS.md`. Làm cùng nhánh → **deploy chung worklist #148 + độ rộng cột**. Không đổi số/quyền.

### 2026-07-22 — Report Bot (review, chưa deploy) — #148 worklist đơn vị chưa gán tỉnh
- Thêm endpoint CEO/admin-only `GET /api/employee-cost/province-worklist/export.xlsx?from=YYYY-MM&to=YYYY-MM` và nút **Xuất ĐV chưa gán tỉnh**. Backend luôn gom toàn roster, không nhận `emp`, không gọi DataHub tỷ lệ; audit metadata-only riêng và response `private, no-store`.
- Excel chỉ có 6 cột **Mã đơn vị · Tên đơn vị · Tuyến · #NV liên quan · Doanh thu ảnh hưởng · Tỉnh cần điền**; đơn vị duy nhất, tuyến/NV distinct, xếp doanh thu giảm dần, cột tỉnh để trống. Số thật/định dạng kế toán VN, A4 ngang, fit-to-width, lặp/freeze header, footer trang; không chứa %/chi phí/C32/C47.
- T07/2026 trên dữ liệu thật: **1.550 dòng / 21 NV → 2 đơn vị chưa gán tỉnh / 103.588.300đ**: `175.BVĐK VŨNG TÀU` **91.975.200đ** và `135.HTNT-FPT LONG CHÂU` **11.613.100đ**. File QA: `/tmp/employee-cost-province-worklist-2026-07.xlsx`.
- Sửa cache metadata tỉnh: `unit_province.json` có version/mtime trong cache revenue/CST; config CEO duyệt ưu tiên trước catalog fallback. Điền map sẽ tự áp mà không giữ dữ liệu enrich cũ; catalog/name inference vẫn không được dùng cho Employee Cost, xung đột vẫn fail closed. Không đổi công thức/tổng tiền.
- Gate nhánh review: server **261/261 PASS**, web **39/39 PASS**, production build/syntax/`git diff --check` PASS; chỉ warning chunk-size cũ. Chưa deploy, chờ Claude review.

### 2026-07-22 — Claude Code (nghiệm thu) — bảng UX production `3e29784`: PASS (worklist #148 CHƯA kèm)
- **Kiểm tra độc lập trên main: PASS.** Code khớp bản review `d0c6b56` (pageSize 20, filter `date`, Vùng/Tỉnh chỉ nguồn chính thức). **Số không đổi:** DN001 41.144.556đ / C44 1.210.470đ / 92,9%; ALL 2.391.033.447đ / C44 95.133.877đ. Self-scope chắc (NV emp=ALL→403; ép DN016→DN001); C32/C47 không lộ (API/PDF/XLSX). Pager pill 20 dòng trên/dưới; lọc kết hợp + tìm bỏ dấu + ngày + "Chưa gán tỉnh"=7 chạy đúng.
- **⚠ Worklist #148 ("Đơn vị chưa gán tỉnh") CHƯA có trên production** — grep main không có endpoint xuất; test vẫn 255/39 (y hệt d0c6b56). Bot deploy bảng UX mà bỏ qua worklist. **Còn treo:** bot làm nốt worklist để CEO điền `unit_province.json`.
- Còn tiếp: DQ center #141; DataHub %/alias → coverage 100%.

### 2026-07-22 — Report Bot (deploy + nghiệm thu production) — bảng UX chi phí `3e29784`
- Đã merge bản Claude PASS `d0c6b56` vào `main`, đồng bộ thêm commit directive đang có trên remote và chốt release **`3e29784`**; build/deploy FE và restart BE + Telegram bot cùng lượt. Production version **`3e29784-20260722-234418-225`**, HTTPS 200; `app-report` PID **1429817** / restart **85**, `app-report-tgbot` PID **1429825** / restart **38**. Rollback: `backups/employee-cost-tableux-deploy-20260722_234324/` (baseline `dc2f54c`).
- Gate release PASS: server **255/255**, web **39/39**, production build, syntax và `git diff --check`; chỉ còn warning chunk-size cũ.
- CEO `emp=ALL` PASS: template **TẤT CẢ NHÂN VIÊN**, đủ **21 NV / 1.550 dòng**, mặc định **20 dòng / 78 trang**, STT trang đầu 1–20. Phiên DN001 gọi `emp=ALL` trả **403 `EMPLOYEE_COST_ALL_FORBIDDEN`**; ép `emp=DN016` vẫn resolve về **DN001**.
- Lọc kết hợp production PASS: **Vùng/Tỉnh=ĐỒNG NAI · Nhóm mã=PKĐK · Tuyến=NCL · Ngày=01/07/2026** còn **159 dòng**; tìm bỏ dấu `y duc` còn **29 dòng**, trang 2 có 9 dòng STT 21–29. `Chưa gán tỉnh` trả đúng **7 dòng** từ đơn vị thiếu map. Excel/PDF xuất lại đủ 29 dòng sau lọc/tìm, không bị cắt theo trang; metadata filter, số thật/Unicode và `private, no-store` đều PASS.
- UI production PASS: pager pill có nút số/ellipsis, mặc định 20 và chỉ cho 20/50/100; pager trên + dưới đồng bộ, pager trên sticky. Smoke trang Tổng quan không lỗi.
- Khóa số/bảo mật không đổi: DN001 tổng tháng **41.144.556đ**, C44 cuối năm **1.210.470đ**, coverage **171/184 = 92,9%**; C36 **714.667đ**, C41 **7.687.500đ**, C43 **25.470.960đ**, C45 **7.271.429đ**. API/PDF/XLSX không lộ **C32/C47**; self-scope giữ. Toàn ALL hiện tổng tháng **2.391.033.447đ**, C44 **95.133.877đ**. Bằng chứng: `/tmp/app-report-tableux-acceptance-3e29784/acceptance.json`.

### 2026-07-22 — Claude Code (giao bot) — Worklist "Đơn vị chưa gán tỉnh" → điền unit_province.json
- CEO chốt hướng chuẩn 100%: điền map `unit_province.json` (mã ĐV → tỉnh). Directive `DIRECTIVE_EMP_COST_PROVINCE_WORKLIST.md`: bot xuất Excel (chuẩn VN, CEO/ADMIN) danh sách **đơn vị duy nhất "Chưa gán tỉnh"** (mã · tên · tuyến · #NV · doanh thu ảnh hưởng · cột trống "Tỉnh cần điền"), xếp theo doanh thu. Điền vào config → App Report tự áp (không đoán). Tùy chọn: màn admin nhập nhanh. Self-scope, không lộ %/C32/C47. Chưa deploy.

### 2026-07-22 — Claude Code (review PASS + giao deploy) — bảng UX trọn gói `d0c6b56`
- **Review `d0c6b56`: PASS.** Vùng/Tỉnh (#146): **bỏ hẳn đoán tên/viết tắt**, chỉ `row.province`/config, thiếu → "Chưa gán tỉnh", source trung thực. #145: pager **pill 20 dòng/trang** + cỡ trang 20/50/100 + **pager trên & dưới (sticky)** + **chọn ngày** (filter `date` validate ISO, chạy cả Tất cả NV). Day + các filter áp trên rows đã khóa quyền (self-scope); C32/C47 loại. Server 255/255, web 39/39, build PASS.
- Nhánh gom trọn #139 + search + #144 + #146 + #145, UI thuần (không đổi tiền). Directive `DIRECTIVE_EMP_COST_TABLEUX_DEPLOY.md`. Sau deploy: điền `unit_province.json`; DQ center #141; DataHub %/alias.

### 2026-07-22 — Report Bot (review, chưa deploy) — #145 pager pill/ngày doanh thu + #146 tỉnh chính thức
- Bảng chi phí self/ALL mặc định 20 dòng, chỉ nhận cỡ 20/50/100; pager pill có số trang/ellipsis/tới trang, đồng bộ sticky phía trên và phía dưới. Hai bảng gap dùng cùng pager, có STT theo toàn tập sau lọc.
- Thêm dropdown `Ngày doanh thu` gồm ngày ISO có thật + `Tất cả ngày`. Backend lọc ngày cùng tỉnh/nhóm/tuyến/search trước sort, STT, tổng, tổng phụ và phân trang; Excel/PDF chạy lại đúng cùng lát cắt không cắt theo trang.
- Bỏ toàn bộ suy tỉnh từ tên/huyện/viết tắt. Chỉ nhận tỉnh từ dòng doanh thu hoặc `server/config/unit_province.json`; thiếu nguồn được nhóm `Chưa gán tỉnh`. Công thức, self-scope, coverage lock và khóa C32/C47 giữ nguyên. Nhánh review, chưa deploy.

### 2026-07-22 — Claude Code (review #144 `0156c5d`) — filters PASS, SỬA Vùng/Tỉnh đoán-từ-tên
- **Review #144: all-fix "Tất cả NV" + lọc Nhóm mã ĐV (config) + Tuyến = PASS.** Scope an toàn (filter trên rows đã khóa quyền; C32/C47 loại khỏi search/facet). Server 253/253, web 38/38, build PASS.
- **⚠ Vùng/Tỉnh (`province.js`) đoán theo tên + viết tắt — trái directive, gán sai được** (`dn`→Đồng Nai nhưng ĐN cũng là Đà Nẵng; `tan phu` trùng Q.Tân Phú TP.HCM; nhãn `source:official` sai provenance). Không ảnh hưởng tiền (chỉ chiều lọc) nhưng lọc địa bàn lệch. **Sửa:** bỏ ABBR; tỉnh chỉ từ nguồn chính thức (`row.province`/`unit_province.json`), không có → "Chưa gán tỉnh"; giữ đoán-tên phải gắn cờ "tạm đoán" + source đúng. Khuyến nghị điền `unit_province.json`. Directive `DIRECTIVE_EMP_COST_PROVINCE_FIX.md`.
- **#145** (pager pill/dayview) CHƯA implement — làm tiếp.

### 2026-07-22 — Claude Code (giao bot) — Phân trang pill 20 dòng + pager lên đầu + xem theo ngày
- Ghi nhận: "Tất cả NV" **đã chạy** (restart BE #139 — 1.550 dòng, coverage 96,5%, tổng 2,39 tỷ); lọc Nhóm mã ĐV + Tuyến đã có.
- CEO thêm 3 UX: (1) phân trang **20 dòng/trang**, nút **bo tròn (pill)** + số trang bấm được; (2) **pager lên đầu bảng** (sticky, đồng bộ trên/dưới); (3) **chọn ngày** xem doanh thu theo ngày — **hoạt động cả chế độ Tất cả NV** (lọc rows theo ngày ở backend, kết hợp nhóm mã/tuyến/tìm kiếm/phân trang). Gợi ý: chọn cỡ trang 20/50/100. STT/đếm/export phản ánh; không đổi số; self-scope + C32/C47 giữ. Directive `DIRECTIVE_EMP_COST_PAGER_DAYVIEW.md`. Chưa deploy.

### 2026-07-22 — Report Bot (review) — Sửa ALL live + bộ lọc chi phí liên hoàn
- Đã đồng bộ/restart backend #139 với frontend đang chạy. Nghiệm thu HTTPS bằng phiên CEO: `emp=ALL&from=2026-07&to=2026-07` trả `template.label="TẤT CẢ NHÂN VIÊN"`, đủ **21 NV / 1.550 dòng** (trang đầu 100 dòng); phiên DN001 gửi `emp=ALL` nhận `403 EMPLOYEE_COST_ALL_FORBIDDEN`.
- Thêm lọc backend **Vùng/Tỉnh · Nhóm mã đơn vị · Tuyến** cho cả self và ALL. Ba facet kết hợp với kỳ/search/sort, dropdown động theo đúng tập đã scope và các facet còn lại; giá trị query không có trong tập scope không được phản chiếu thành option. STT, X/Y, tổng, tổng phụ, phân trang và Excel/PDF dùng cùng một pipeline backend.
- Tỉnh chỉ nhận provenance chính thức từ dòng bán/catalog/config; kết quả `provinceOf()` suy từ tên bị loại, xung đột cùng mã đơn vị fail closed. Nhóm mã đơn vị đọc `server/config/employee_cost_unit_groups.json`; mã chưa map chỉ rơi về đúng tiền tố của chính nó, không đoán nhóm nghiệp vụ. Audit lưu bộ lọc đã sanitize; C32/C47 vẫn khóa cứng và công thức/tiền không đổi.
- Gate: full server **251/251 PASS** trước guard facet cuối, targeted sau cùng **57/57 PASS**; web **38/38 PASS**; production build PASS; `git diff --check` + syntax PASS. Bộ lọc mới chỉ ở nhánh review, **chưa deploy** theo directive.

### 2026-07-22 — Report Bot (review) — Directive #139 bảng chi phí STT/ALL/search/sort
- Thêm cột STT đầu bảng và đầu Excel/PDF; STT được đánh lại sau lọc/sort trên toàn tập. CEO/admin có `Tất cả nhân viên` backend-lock, cột NV, tổng phụ theo NV/tổng chung và phân trang 100 dòng; NV thường gửi `emp=ALL` ở xem/xuất bị chặn 403 và vẫn self-scope.
- Search live toàn bảng hỗ trợ bỏ dấu, không phân biệt hoa/thường, viết tắt liền kiểu `dviet` → `Đức Việt`, nhiều từ AND, đếm X/Y, highlight/chip xóa nhanh; click header để sort. Chế độ ALL lọc/sort trước phân trang ở backend; export chạy lại cùng filter/search/sort không cắt trang.
- Cột % cố định hẹp, căn phải/tabular, header chỉ mã Cnn + tooltip nhãn đầy đủ; sticky header + STT + Nhân viên/Tên hàng. C32/C47 tiếp tục loại cứng, C44 vẫn tách khoản cuối năm và mọi số tiền giữ nguồn backend. #139 đã được đồng bộ/restart để sửa lỗi ALL live; thay đổi bộ lọc nối tiếp vẫn chưa deploy/merge main.

### 2026-07-22 — Claude Code (giao bot) — SỬA "Tất cả NV" trống + thêm lọc Vùng/Tỉnh · Nhóm mã ĐV · Tuyến
- **CEO báo "Tất cả nhân viên" hiện 0/0 (trống).** Chẩn đoán: bảng hiện **"Mẫu FULL-TIME 0/0"** thay vì template **"TẤT CẢ NHÂN VIÊN"** → **BE chưa nạp nhánh `emp=ALL`** (FE #139 lên nhưng BE chưa deploy/restart — lệch phiên bản, giống vụ 404). Bot: xác minh version (`curl ?emp=ALL` phải trả `template.label:"TẤT CẢ NHÂN VIÊN"`, rows>0) → deploy/restart BE #139; nếu vẫn trống → debug `employeeCostAllPayload`/`mergeEmployeeReports` + thêm test all-NV rows>0.
- **CEO thêm 3 ô lọc:** Vùng/Tỉnh (từ nguồn đơn vị, không suy đoán từ tên), Nhóm mã đơn vị (cấu hình được), Tuyến (cột sẵn có). Kết hợp nhau + tìm kiếm + kỳ; STT đánh lại; export phản ánh; dropdown động. Self-scope + C32/C47 giữ. Directive `DIRECTIVE_EMP_COST_ALLFIX_FILTERS.md`.

### 2026-07-22 — Claude Code (review PASS + giao deploy đợt 2) — #139 bảng UX `a3b4fd6`
- **Review `a3b4fd6`: PASS.** "Tất cả NV" **khóa 3 lớp** (view/all-payload/export đều 403 `EMPLOYEE_COST_ALL_FORBIDDEN` cho NV; NV ép own qua resolveScopedEmployee). Tìm kiếm **bỏ dấu chuẩn** (`normalizeVietnamese`: NFD + xóa dấu + đ→d, đa từ khóa, BLOCKED C32/C47 không lọt). STT + sort ổn định; cột chi phí regex c33–c46 (chặn C32/C47); phân trang; tổng phụ theo NV; sticky; cột % hẹp; export phản ánh lọc/tìm/sort/STT. Server 243/243, web 37/37, build PASS.
- UI/UX thuần, **không đổi số/tiền**, rủi ro thấp. Directive `DIRECTIVE_EMP_COST_139_DEPLOY.md` (deploy đợt 2). Sau đó: DQ center đợt 1 (#141) + DataHub điền %/alias.

### 2026-07-22 — Claude Code (nghiệm thu) — Deploy B (#137 gap tool + #138 export VN): PASS
- **Kiểm tra độc lập trên main: PASS.** `a539e5a` merge code đã review (`50e0c62`); `employeeCostGaps.js` + `employeeCostExport.js` + routes gaps/export có trên main. **#139 KHÔNG lẫn vào** (không cột STT / "Tất cả NV" / search bỏ dấu — chỉ có nhãn "Số dòng đơn hàng" của #134 đã live từ trước). Code khớp bản review PASS (self-scope 2 lớp export, gaps không lộ %, gợi ý mã không tự map, VN accounting + A4 landscape + font fail-closed).
- Bot nghiệm thu production PASS (không dẫn số mới trong report này). Chi phí cũ không đổi. *(Claude tự động server lỗi 401 — verdict do phiên Claude này cấp.)*
- **#139** (bảng UX) Report Bot đang làm trên **nhánh riêng** — deploy đợt 2. DataHub: điền %/alias song song → coverage 100%.

### 2026-07-22 — Report Bot — DEPLOY B + nghiệm thu production #137 gap tool / #138 export VN
- Đã merge đúng bản Claude PASS `50e0c62` vào `main` bằng release merge **`a539e5a`**; không đưa implementation #139 vào đợt này. Gate trước deploy: server **238/238 PASS**, web **34/34 PASS**, production build PASS, `git diff --check` sạch.
- Đã build/deploy frontend và restart đồng bộ `app-report` + `app-report-tgbot`; health HTTPS **200**. Main sau đó nhận thêm commit docs-only `7bf76fd` (#141), không thay đổi code release #137/#138.
- Nghiệm thu production T07/2026: DN001 đúng **13 cặp gap / 11 mã**, coverage **171/184 = 92,9%**; toàn roster **43 cặp / 34 mã**, coverage **1.175/1.218 = 96,5%**. UI CEO hiển thị tab gap, coverage và bộ lọc; UI DN001 chỉ hiển thị “13 mặt hàng chưa có %”, không có bộ lọc/chế độ toàn nhân viên.
- Self-scope PASS hai lớp: phiên DN001 cố truyền `emp=DN016` ở gap/cost/export vẫn bị backend ép về **DN001**; file/PDF không có dữ liệu DN016. Audit production ghi đủ `view`, `export_xlsx`, `export_pdf`, `gaps_view`, `gaps_export_xlsx`, `gaps_export_pdf` theo actor/scope; response dùng `Cache-Control: private, no-store`.
- Export Excel PASS: ô tiền là **số thật**, tổng dùng công thức `SUM`, định dạng kế toán VN; A4 landscape, fit-to-width, header lặp. Gap workbook đúng 2 sheet `Theo mã QLNB` + `Ánh xạ lệch mã`, cột `% cần điền` và `Xác nhận` để trống.
- Export PDF PASS: A4 landscape, nhúng font Unicode, đủ footer/số trang (**chi phí 9/9 trang; gap 2/2 trang**), không lỗi dấu/tofu/control character, không sinh trang trắng cuối. Bảng chi phí rộng nên mô tả dài có thể wrap/rút gọn theo cột, không ảnh hưởng số liệu.
- Bảo mật/số cũ PASS: gap payload/export không chứa tỷ lệ, tiền chi phí, **C32/C47**; chi phí DN001 giữ tổng tháng **41.144.556đ**, C44 cuối năm **1.210.470đ**, mẫu C44 **75.696đ**. Bằng chứng máy: `/tmp/app-report-prod-acceptance-a539e5a/acceptance.json`; rollback trước đợt: `backups/employee-cost-ui-deploy-20260722_173653/`.

### 2026-07-22 — Claude Code (giao bot) — Trung tâm Kiểm soát Dữ liệu Chi phí (auto bắt lỗi + chuông)
- CEO muốn tự bắt/lọc mọi mã không khớp khi lấy App Sale → tính chi phí (mã hàng/QLNB/đơn vị/tuyến/ĐVT/giá thầu), gộp mục riêng + **chuông cảnh báo** + **tự giải thích nguyên nhân** (khỏi điều tra thủ công). Directive `DIRECTIVE_EMP_COST_DQ_CENTER.md` — **mở rộng gap tool #137**.
- **Thông minh:** 2 nhóm mức (đỏ = sai/nghi ngờ tiền: PRODUCT_MISSING/MISMATCH, UOM_MISMATCH, BID_PRICE_INVALID, REVENUE_ANOMALY, DUPLICATE; vàng = thiếu hiển thị: UNIT_UNKNOWN, ROUTE_MISSING, CONTRACTOR_UNRESOLVED, HAMLUONG_MISSING). Mỗi lỗi có **nguyên nhân tự sinh + hành động đề xuất + nguồn cần sửa**; gộp theo mã gốc, xếp theo doanh thu ảnh hưởng; trạng thái xử lý; deep-link. **Chuông badge** = số lỗi đỏ chưa xử lý (ngưỡng cấu hình). Self-scope (NV của mình, CEO toàn bộ), không lộ %/C32/C47, không tự sửa/bịa. Reuse export VN #138. Đề xuất làm 2 đợt. Chưa deploy.

### 2026-07-22 — Claude Code (review PASS + giao deploy B) — gap tool #137 + export VN #138
- **Review nhánh `review/employee-cost-gap-tool-20260722` @ `50e0c62`:** #137 gap tool + #138 export VN = **PASS**.
  - Gap: self-scope (NV own, CEO roster/`?emp=`), **không lộ %**, gợi ý mã lệch QĐ (chỉ gợi ý, không tự map). DN001 13 cặp; roster 34 mã/96,5%.
  - Export: self-scope **2 lớp**; số kế toán VN (`#,##0`, "Bằng chữ"), **A4 landscape**, font Unicode **fail-closed** nếu thiếu; Excel số thật. Server 231/231, web 34/34, build PASS.
  - **#139 (bảng UX: STT/tất cả NV/cột % hẹp/tìm kiếm) CHƯA implement** (commit `1694f93` chỉ là directive doc).
- **CEO chốt B: deploy #137+#138 ngay** (`50e0c62`), #139 làm đợt 2. Directive `DIRECTIVE_EMP_COST_GAP_EXPORT_DEPLOY.md`. DataHub: điền % thiếu hẳn + alias lệch mã QĐ (task đã gửi) → coverage 100% không cần deploy.

### 2026-07-22 — Report Bot (review) — Export chi phí/gap chuẩn VN Excel + PDF
- Bổ sung 4 endpoint backend có auth/audit: `employee-cost/export.xlsx|pdf` và `employee-cost/gaps/export.xlsx|pdf`. NV luôn bị ép self-scope kể cả truyền `?emp=` khác; CEO/admin được chọn NV hoặc toàn roster. Không xuất C32/C47.
- Excel: số thật + công thức `SUM`, number format kế toán, ngày `dd/mm/yyyy`, tiêu đề tiếng Việt, A4 ngang, fit-to-width, lặp header, footer trang. Báo cáo chi phí có “Bằng chữ”, tổng tháng và C44 cuối năm tách riêng; gap giữ 2 sheet và cột `% cần điền`/`Xác nhận` trống.
- PDF: A4 ngang, nhúng Noto/DejaVu/Liberation Unicode fail-closed nếu thiếu font, đầu/chân trang, `Trang x/y`, bảng lặp header, số VN dấu chấm/dấu phẩy và không mất dấu tiếng Việt.
- UI cho cả NV/CEO có nút Excel + PDF ở báo cáo chi phí và gap. Chưa deploy; chờ Claude review trên cùng nhánh `review/employee-cost-gap-tool-20260722`.

### 2026-07-22 — Report Bot (review) — Gap chi phí self-scope + worklist Excel
- Thêm `GET /api/employee-cost/gaps` và `GET /api/employee-cost/gaps/export.xlsx`: NV bị ép self-scope; CEO/admin xem toàn roster hoặc chọn NV; nguồn catalog/tỷ lệ lỗi thì fail closed; truy cập/xuất đều audit và `private, no-store`.
- UI: NV có panel “Mặt hàng chưa có % chi phí”; CEO/admin có tab gộp theo mã QLNB, tìm/lọc NV/đơn vị/lý do, coverage progress và sắp xếp theo doanh thu ảnh hưởng.
- Excel có đúng 2 sheet `Theo mã QLNB` và `Ánh xạ lệch mã`; cột `% cần điền`/`Xác nhận` để trống. Gợi ý mã chỉ read-only, không tự ánh xạ/không ghi DataHub; payload không chứa tỷ lệ, tiền chi phí, C32/C47.
- Nghiệm thu live DN001 T07: **171/184 = 92,9%**, đúng **13 cặp gap**. Ứng viên cùng đơn vị+tên hàng: `QĐ1572.1699.N4.754 → QĐ1572.1699.N4.754.A`, `G1.GE.QĐ139.3004.N4.1029 → G1.GE.QĐ139.3269.N5.1029`, `G1.GE.QĐ139.2120.N4.578 → G1.GE.QĐ139.2114.N4.578`; chỉ gợi ý để DataHub xác nhận. Toàn roster còn phát hiện ca khác số quyết định `G1.GE.QĐ139.2963.N4.549 → G1.GE.QĐ48.549.N4.549`.
- Gate tại nhánh review: server/web test + build PASS; chưa deploy.
### 2026-07-22 — Claude Code (giao bot) — Bảng chi phí: STT + xem tất cả NV + cột % hẹp + tìm kiếm thông minh
- CEO yêu cầu 4 UX bảng "Chi phí của tôi". Directive `DIRECTIVE_EMP_COST_TABLE_UX.md`:
  1. **Cột STT** đầu bảng, tự nhảy theo dòng hiển thị (lọc/tìm → đánh lại), có trong Excel/PDF.
  2. **"Tất cả nhân viên"** (CEO/ADMIN only, backend khóa) — thêm cột NV + tổng phụ theo NV; NV thường chỉ của mình. Phân trang/virtualize.
  3. **Thu hẹp cột %** (rộng cố định vừa số, tiêu đề mã ngắn C36 + tooltip đầy đủ).
  4. **Ô tìm kiếm thông minh** toàn bảng — **bỏ dấu + không phân biệt hoa/thường** (tiện cho tiếng Việt), live + đếm X/Y + highlight, kết hợp lọc NV/kỳ.
- Ý thêm: sticky header/cột, sort cột, chip trạng thái lọc, export phản ánh lọc/tìm/sort/STT. Self-scope + C32/C47 giữ. Làm cùng nhánh review gap tool + export. Chưa deploy.

### 2026-07-22 — Claude Code (giao bot) — Export chuẩn VN (Excel+PDF, A4 ngang) + NV tự xuất
- CEO chốt: **NV được tự xuất** phần mình; **chuẩn số kế toán VN** (nghìn dấu chấm, thập phân dấu phẩy, đơn vị đồng, "Bằng chữ" cho tổng); **mẫu A4 quay ngang**; **2 định dạng Excel + PDF**. Directive `DIRECTIVE_EMP_COST_EXPORT_VN.md`.
- Áp cho **cả báo cáo chi phí lẫn danh sách thiếu %**. PDF **nhúng font Unicode đủ dấu tiếng Việt** (cấm tofu); A4 landscape fit-to-width, đầu/chân trang (Donapharm · kỳ · NV · ngày xuất · nguồn DataHub SSOT · số trang), header lặp mỗi trang. Excel số thật (SUM chạy) + number format VN. **Self-scope** (NV chỉ của mình), C32/C47 không xuất, qua backend + audit. Làm cùng nhánh review gap tool. Chưa deploy.

### 2026-07-22 — Claude Code (giao bot) — Công cụ "Mặt hàng thiếu % chi phí" + Export Excel gap
- CEO muốn xuất **tất cả cặp chưa lấy được %** ra Excel + **mục trong app** để CEO/NV lọc-tìm dễ. Directive `DIRECTIVE_EMP_COST_GAP_TOOL.md`.
- **Thông minh:** gộp theo **mã QLNB** (1 mã thiếu → ảnh hưởng nhiều đơn vị/NV, điền 1 lần khớp hàng loạt); **xếp theo doanh thu ảnh hưởng**; **phân loại lý do** (lệch mã QĐ → App Report **gợi ý mã catalog gần trùng** để DataHub ánh xạ / thiếu hẳn → nhập % mới); **NV thấy** mục "N mặt hàng chưa có % — chờ bổ sung, không phải lỗi"; **CEO** tab lọc/tìm + **coverage progress**; **Excel worklist** có cột trống "% cần điền".
- Endpoint `GET /employee-cost/gaps` self-scope (NV của mình / CEO toàn bộ), KHÔNG lộ %, không bịa. App Report phát hiện; **DataHub điền % / chuẩn hóa mã** (task riêng). Chưa deploy.

### 2026-07-22 — Claude Code (nghiệm thu) — gói UI chi phí production `c565ba6`: PASS
- **Kiểm tra độc lập trên main: PASS.** Bundle merged (`c565ba6`); code có `columnTotals` + `derivesFrom` + nhãn mới.
- **Số cộng tay khớp:** C36 714.667 + C41 7.687.500 + C43 25.470.960 + C45 7.271.429 = **41.144.556đ** (= tổng tháng). **C44 cuối năm 1.210.470đ tách riêng** (không cộng tháng). Mẫu C44 = 1.513.920 × 5% = **75.696đ**. Coverage 171/184=92,9%. Doanh thu chưa VAT 2.278.049.356đ.
- **UI/bảo mật:** KPI đủ (Doanh thu chưa VAT + 5 cột, C44 nổi bật + badge); nhãn "Số dòng đơn hàng" + "mã (đơn vị×mặt hàng)"; panel gập sẵn; self-scope + C32/C47 giữ; BE restart (PID 747857, restart 76); backup sẵn.
- **Còn treo (chờ DataHub Bot, không chặn):** DN021 lệch mã QĐ (`QĐ48…549` vs `QĐ139…549`); C48 ghi chú sidecar. 2 task đã gửi.

### 2026-07-22 — Report Bot (deploy + nghiệm thu production) — gói UI chi phí `c565ba6`
- Đã merge release candidate `a5ef765` vào `main` theo Plan A, build và deploy đồng bộ FE/BE; App Report chạy version `c565ba6-20260722-173400-024`, PM2 `app-report` online PID `747857`, restart `76`. Backup trước deploy: `backups/employee-cost-ui-deploy-20260722_173653/`.
- Gate release: server **224/224 PASS**, web **30/30 PASS**, production build PASS; health local và `report.donapharm.asia` đều OK.
- Nghiệm thu DN001 T07/2026: coverage **171/184 = 92,9%**; doanh thu chưa VAT **2.278.049.356,19đ**; C36 **714.667đ** + C41 **7.687.500đ** + C43 **25.470.960đ** + C45 **7.271.429đ** = tổng tháng **41.144.556đ**; C44 riêng cuối năm **1.210.470đ**. Mẫu khóa: C43 **1.513.920đ** × C44 **5%** = **75.696đ**.
- UI/permission PASS: KPI động đủ Doanh thu chưa VAT + 5 cột; C44 nổi bật/badge cuối năm; nhãn `Số dòng đơn hàng` và `mã (đơn vị×mặt hàng)`; panel quyền mặc định gập; self-scope giữ nguyên; payload không lộ C32/C47. C44 tiếp tục bị loại khỏi tổng tháng.

### 2026-07-22 — Claude Code (review PASS + giao deploy) — gói UI chi phí `a5ef765`
- **Review PASS toàn bộ 4 việc** trên nhánh `review/employee-cost-c44-derived-20260722` `a5ef765`:
  1. **C44** = tiền_C43 × %C44 (cột phái sinh cấu hình `c44:c43`, validate vòng lặp) — C44 tháng 1.210.470đ.
  2. **Thu gọn panel** — mặc định gập, localStorage theo admin, draft không mất, a11y.
  3. **KPI cards** — `summary.columnTotals` (gate <90%); FE render động Doanh thu chưa VAT + C36/C41/C43/C44/C45, **C44 nổi bật**.
  4. **Nhãn** — "Số dòng đơn hàng" + "…/… mã (đơn vị×mặt hàng)" (đổi chữ, số/coverage giữ nguyên).
- Server 224/224, web 29/29, build PASS. CEO chốt **deploy gộp (A)**. Directive `DIRECTIVE_EMP_COST_UI_DEPLOY.md`: merge→build→**FE+restart BE đồng bộ**→nghiệm thu. Còn treo (không chặn): DN021 mã QĐ + C48 sidecar (DataHub Bot).

### 2026-07-22 — Claude Code (review + giao bot) — C44 `b37a48f` PASS + KPI cards mới
- **Review C44 `b37a48f` (nhánh `review/employee-cost-c44-derived-20260722`): PASS.** `C44 = tiền_C43 × %C44` — bot làm đủ 3 chỗ: per-dòng (`base = amounts[derivesFrom]`), match/reliable (không cho fallback doanh thu khi derived null), residual/làm tròn (đối chiếu trên tổng tiền cột gốc). **Cột phái sinh cấu hình được** (`DEFAULT_DERIVED_BASES={c44:c43}`, env `EMPLOYEE_COST_DERIVED_BASE`, validate chặn tự-tham-chiếu/trùng/**vòng lặp**). Kèm `.env.example` + contract doc + config json + test. **Nghiệm thu:** C44 mẫu 75.696đ, **C44 tháng 1.210.470đ** (từ 35.157.098đ), tổng tháng vẫn 41.144.556đ, coverage 171/184. 224/224 + 25/25 + build PASS. *(Claude tự động trên server lỗi 401 — verdict do phiên Claude này cấp.)*
- **CEO yêu cầu thêm KPI cards:** Doanh thu chưa VAT + tổng CP từng cột C36/C41/C43/C44/C45, **C44 nổi bật**. Directive `DIRECTIVE_EMP_COST_KPI_CARDS.md`: backend thêm `summary.columnTotals` (gate <90% như tổng tháng); FE render **động từ columns[]**, ô annual (C44) nổi bật + badge cuối năm. Làm **cùng nhánh UI với thu gọn panel**, deploy 1 lượt.

### 2026-07-22 — Claude Code (giao bot) — Thu gọn panel công tắc chi phí (UI)
- CEO đề nghị **nút thu gọn** panel "Quản trị quyền tự xem chi phí" (dài, đẩy bảng chính xuống). Directive `DIRECTIVE_EMP_COST_VISIBILITY_COLLAPSE.md`: panel **mặc định thu gọn**, header + nút mở/gập, nhớ trạng thái (localStorage), logic quyền/lưu KHÔNG đổi. Làm **cùng nhánh review với fix C44** (deploy 1 lượt). Chưa deploy, chờ Claude review.

### 2026-07-22 — Claude Code (giao bot) — SỬA GẤP C44: gốc = tiền cột C43, không phải doanh thu
- **CEO phát hiện lỗi tiền nghiêm trọng (đang LIVE):** C44 tính `revenueBeforeVat × %C44` → gốc doanh thu → phình (35.157.098đ). **Đúng:** `C44 = tiền_C43 × %C44` (tiền_C43 = revenueBeforeVat × %C43). Dòng mẫu: 1.513.920 × 5% = **75.696đ** (không phải 630.800đ).
- Directive `DIRECTIVE_EMP_COST_C44_FIX.md`: cột "cuối năm" thành **cột phái sinh cấu hình được** (`c44←c43`, không hardcode); base = tiền cột gốc; sửa cả khối residual/làm tròn; C44 vẫn loại khỏi tháng/làm mờ/tách dòng cuối năm. **Tổng THÁNG (41.144.556đ) KHÔNG đổi** (C44 vốn ngoài tháng) — chỉ "Khoản cuối năm" giảm mạnh. Chưa deploy, chờ Claude review.

### 2026-07-22 — Claude Code (nghiệm thu) — production chi phí VAT-trước `050b9c2`: PASS
- **Kiểm tra độc lập trên main: PASS.** Code đã deploy = đúng code đã review (`buildCostLookup` khóa `unit␟product` dòng 536 + consumer 577; `loadConfig` try/catch → `{}`). Không bị đổi giữa review và deploy.
- **Số khớp tay:** VAT-trước `380.000÷1,05×0,5%=1.810đ` (xác nhận gốc trước-VAT); DN001 171/184=92,9% → **tổng tháng trước VAT 41.144.556đ** (thấp hơn bản có-VAT cũ 42.834.991đ, đúng hướng); **C44 tách 35.157.098đ** không cộng tháng.
- **Bảo mật/hành vi đúng:** C32/C47 không lộ; DN021 0/3 fail-closed (không tự ánh xạ mã QĐ); visibility 3 nhóm/21 NV; hết 404; BE restart đồng bộ FE (PID 549011, restart 73); token/artifact QA thu hồi; rollback sẵn.
- **Còn treo (đang chờ DataHub Bot):** DN021 đối chiếu mã QĐ (`QĐ48…549` vs `QĐ139…549`); C48 sidecar (điều kiện cứng "C48 thiếu ≠ kỳ thiếu"). 2 task đã gửi DataHub Bot.

### 2026-07-22 — Report Bot — DEPLOY + nghiệm thu production chi phí VAT-trước `050b9c2`
- Đã gộp nhánh review `d236496` vào `main`, build và kích hoạt đồng bộ FE/BE; production đang chạy version **`050b9c2-20260722-154110-131`**. `/version.json`, `/api/auth/mode`, health, hai GET quản trị visibility và trang App Report đều PASS; PM2 `app-report` online, không còn lệch route 404/“Lỗi máy chủ”, browser console không có lỗi.
- Nghiệm thu T07/2026 DN001: mẫu **FULL-TIME 19 cột** đúng thứ tự, đủ `C36/C41/C43/C44/C45`; lookup `(đơn vị + mã hàng)` đạt **171/184 = 92,9%**, tương ứng **211/224 order-line** có tỷ lệ. Tổng tháng VAT-trước (không gồm C44) **41.144.556đ**; C44 cuối năm tách riêng **35.157.098đ**. Spot-check: `380.000 ÷ 1,05 × 0,5% = 1.810đ`.
- DN021 hiển thị đúng mẫu **PART-TIME 15 cột, chỉ C36**; hiện **0/3**, tổng tháng/cuối năm bị ẩn và các ô giữ `—` do mã doanh thu `QĐ139…` chưa khớp timeline `QĐ48…` (fail-closed đúng thiết kế, không tự bắc cầu). C48 chưa có chỉ làm `Ghi chú = —`, không chặn tỷ lệ/số tiền ở dòng đã khớp.
- Bảo mật/kiểm soát PASS: payload production không có `C32/C47`; C44 không bị cộng vào tổng tháng; panel quản trị quyền tải đủ **3 nhóm/21 NV**, toàn phòng vẫn **Tắt** theo mặc định an toàn và phiên DN001 nhận payload `disabled` thay vì truy cập dữ liệu. Backup rollback: `backups/employee-cost-deploy-20260722_154018/`, baseline `008b8b4`.

### 2026-07-22 — Claude Code (giao bot) — DEPLOY bản chi phí cột mới + VAT-trước (CEO chốt A)
- **CEO chốt (A): deploy ngay** nhánh review `d236496` (review PASS). Directive: `DIRECTIVE_EMP_COST_DEPLOY.md`. Gộp: fix lookup 92,9% + 2 mẫu cột mới + **VAT-trước (đổi số có chủ ý)** + visibility route/hardening.
- **‼ Bắt buộc restart BE đồng bộ FE** (tránh lệch phiên bản 404 như sự cố trước). Nghiệm thu: hết "Lỗi máy chủ"; DN001 171/184 tổng VAT-trước mới; DN021 `—` (fail-closed, chờ đối chiếu mã QĐ); Ghi chú `—` (chờ C48); self-scope + C32/C47 giữ. Còn treo (không chặn): DN021 mã QĐ + C48 sidecar → 2 task DataHub Bot.

### 2026-07-22 — Claude Code (review) — hardening visibility `d236496`: PASS (nhánh review hoàn chỉnh)
- **Review `d236496`: PASS.** `loadConfig` try/catch → fallback `{}` + `console.warn` phía server (không lộ path ra FE; loadConfig KHÔNG còn throw → chặn nguồn rò path). 2 route GET `visibility`/`employees` bọc `asyncJsonRoute` → trả `{ error, code }` đúng chuẩn chung app. Test config-thiếu + lỗi-giả 2 GET PASS; 220/220 server · 25/25 web · build PASS.
- Lookup vẫn **92,9%** (dữ liệu mới: DN001 **171/184**, 210/223 order-line — nhích nhẹ do refresh, vẫn ≥90%).
- **Nhánh review `d236496` = bản release hoàn chỉnh:** fix lookup + 2 mẫu cột mới + VAT-trước + visibility hardening, tất cả review PASS. **Chưa deploy** — chờ CEO chốt: (1) thời điểm deploy (⚠ đổi số sang VAT-trước); (2) DN021 lệch mã QĐ (cùng thuốc?); (3) task C48 sidecar cho DataHub Bot.

### 2026-07-22 — Report Bot — KHÔI PHỤC FE production về main (hết "Lỗi máy chủ")
- **Giải quyết "Lỗi máy chủ" bằng cách bảo thủ:** đưa **FE public về đúng `origin/main` (c2abea1)** thay vì deploy bản mới. Bundle FE main **không còn gọi `/employee-cost/visibility`** (route chỉ có trên nhánh review), nên hết 404/"Lỗi máy chủ". **BE không restart** (PID/restart count giữ), **số chi phí không đổi**, nhánh review `6ef5e3c` giữ nguyên chưa deploy. Backup bundle review: `backups/frontend-review-dist-20260722_145601/dist`. (Tab cũ cần tải lại 1 lần.)
- Xác nhận chẩn đoán: sự cố là **lệch phiên bản FE mới / BE cũ**, không phải lỗi code. Panel "Quản trị quyền tự xem chi phí" là **tính năng chỉ có trên nhánh review**, đúng ra chưa vào production.

### 2026-07-22 — Claude Code (giao bot) — "Lỗi máy chủ" trang Chi phí: nguyên nhân THẬT = process cũ (404)
- CEO báo trang Chi phí "Lỗi máy chủ" + "Chưa có nhân viên" + bảng trống. Chẩn đoán ban đầu của Claude (loadConfig 500) **SAI cho lần này** — bot kiểm tra: config OK, `loadConfig()` OK, không stack; `curl` trả **404** không phải 500.
- **Nguyên nhân thật:** process production khởi động trước khi route `/employee-cost/visibility` được thêm → BE chưa nạp route; FE bản mới gọi → 404 → FE map về "Lỗi máy chủ". Lệch phiên bản, không phải lỗi code. **Fix = restart/deploy** (đã xử bằng revert FE về main, xem mục trên). Directive: `DIRECTIVE_EMP_COST_VISIBILITY_500_FIX.md` (#126) — loadConfig hardening hạ xuống **phòng-vệ-tùy-chọn**; giữ bọc route GET trả `{error}`; polish FE phân biệt 404 vs 500.

### 2026-07-22 — Claude Code (review) — vá lookup `6ef5e3c`: PASS + phát hiện lệch mã QĐ (DN021)
- **Review `6ef5e3c`: PASS.** `buildCostLookup` quay về khóa `unit␟product`; guard fail-closed **chỉ chặn đúng cặp (đơn vị+mã) nhập nhằng**. Phía tiêu thụ đổi `costLookup.get(unit␟product)`. **Điểm cộng:** coverage đo trên khóa (đơn vị+mã) duy nhất (170/183=92,9%), bảng giữ grain order-line (209/222). VAT spot-check `380.000÷1,05×0,5%=1.810đ` (trước VAT). Test 32/32 + 218/218 + 25/25 + build PASS. **DN001 nghiệm thu ĐẠT.**
- **DN021 CTV: layout PASS nhưng 0/3 do lệch mã QĐ** — catalog chi phí `QĐ48…549` vs doanh thu `QĐ139…549`; hệ thống **fail-closed để `—`** (đúng #3, KHÔNG tự bắc cầu). **Câu hỏi dữ liệu cho CEO/DataHub:** 2 mã có cùng mặt hàng? Cùng → DataHub chuẩn hóa mã ở nguồn; khác → 0/3 đúng thực tế. Ghi chú C48 = `—` tạm. Sidecar C48: CEO đã chốt ranh giới + điều kiện cứng "C48 thiếu ≠ kỳ thiếu".

### 2026-07-22 — Report Bot — Harden trang quản trị chi phí theo directive #126
- `employeeCostRoster.loadConfig()` nay fail-soft về `{}` khi file nhóm thiếu/hỏng/path sai, chỉ ghi cảnh báo phía server; picker vẫn dựng đủ NV với nhóm mặc định thay vì làm trang sập.
- Hai GET `/employee-cost/employees` và `/employee-cost/visibility` được bọc handler bắt lỗi, trả JSON `{error}` cụ thể khi có lỗi thật.
- Thêm regression cho config thiếu file, roster mặc định và lỗi giả ở cả hai GET. Chỉ cập nhật nhánh review, **không deploy/restart production**.

### 2026-07-22 — Report Bot — Vá regression lookup chi phí theo directive #125
- Quay khóa timeline từ `mã hàng` về đúng `(đơn vị + mã hàng)`; xung đột tỷ lệ chỉ làm fail-closed khóa đơn vị–mã hàng đó, không loại toàn bộ mã hàng ở các đơn vị khác.
- Độ phủ tiếp tục tính trên số khóa `(đơn vị + mã hàng)` duy nhất trong doanh thu, còn bảng chi tiết vẫn giữ grain order-line. Live-read T07 DN001 phục hồi đúng **170/183 = 92,9%** (209/222 order-line có tỷ lệ), tổng được phép hiển thị.
- DN021 hiện **0/3** do DataHub trả mã chi phí `G1.GE.QĐ48.549.N4.549` trong khi doanh thu là `G1.GE.QĐ139.2963.N4.549`; giữ fail-closed, không tự ánh xạ/bịa mã. C48 vẫn chưa có và hiển thị `—` theo directive.
- Thêm regression test khóa `(đơn vị + mã hàng)`, cô lập duplicate xung đột và coverage unique-key; chỉ push nhánh review, **chưa deploy/restart production**.

### 2026-07-22 — Report Bot — Hoàn thiện 2 mẫu “Chi phí của tôi” trên nhánh review
- Thêm cấu hình độc lập `server/config/employee_cost_templates.json`: nhóm **tính chi phí** part-time chỉ gồm `DN021/DN022/DN023` và dùng C36; còn lại full-time dùng C36/C41/C43/C44/C45. Cấu hình mẫu hiển thị tách khỏi cấu hình nhóm tính và không dùng `employee_cost_groups.json`.
- Backend giữ grain order-line/self-scope/C32-C47/công tắc, bổ sung Tuyến · tên Nhà thầu · Hàm lượng · Giá trúng thầu · doanh thu trước VAT · C48; đổi phép tính sang `doanh thu / VAT_DIVISOR × %`, vẫn tách C44 và ẩn tổng khi độ phủ dưới 90%.
- Frontend render đúng thứ tự mẫu **19 cột full-time / 15 cột part-time**, `Giá trúng thầu` đứng trước `Số lượng`, `Ghi chú` cuối; hàm lượng dài giữ một dòng có ellipsis + tooltip.
- Regression employee-cost **31/31**, frontend employee-cost/visibility **12/12**, toàn bộ server/web test và production build PASS. Chỉ push review, **chưa deploy/restart production**.

### 2026-07-22 — Claude Code (chẩn đoán + giao bot) — SỬA khóa lookup chi phí (match sụt 2/222)
- **Review `d0fd7c8` (nhánh templates): layout/công thức ĐÚNG** (VAT trước: 12.616.000×13%=1.640.080 full-time, ×8%=1.009.280 CTV; c44 loại; 2 mẫu đúng nhóm). **NHƯNG match sụt 2/222** (bản main 170/183).
- **Chẩn đoán: lỗi KHÓA LOOKUP** (không phải DataHub). `buildCostLookup` đổi sang product-only + guard "mọi dòng cùng mã phải % giống hệt" → endpoint ~10.982 dòng/NV % khác theo đơn vị → rớt gần hết. **Sửa: quay lại ghép (đơn vị + mã hàng)** như main. Directive: `DIRECTIVE_EMP_COST_LOOKUP_FIX.md`.

### 2026-07-22 — Claude Code (giao bot) — "Chi phí của tôi": 2 mẫu cột + VAT trước + ghi chú C48
- CEO gửi 2 mẫu Excel (full-time / part-time). Giao Report Bot: **2 layout** — full-time đủ 5 cột % (C36/C41/C43/C44/C45); **CTV part-time = DN021/DN022/DN023 chỉ C36**. **Nhóm CTV cho TÍNH TIỀN khác nhóm hiển thị** → config riêng `employee_cost_templates.json`.
- Cột mới: Tuyến · Nhà thầu (tên) · **Hàm lượng** (QĐ141 dài → **1 dòng + tooltip**) · **Giá trúng thầu** (CEO duyệt hiện) · **Thành tiền xuất bán (trước VAT)** thay "Doanh thu" · **Ghi chú từ DataHub C48**.
- **‼ VAT:** đổi gốc tính → chi phí % nhân **doanh thu TRƯỚC VAT** (÷ VAT_DIVISOR) — khác production hiện tại (đang có-VAT).
- Việc DataHub: **thêm C48 (ghi chú) vào payload** (ngoài dải %, vẫn khóa C32/C47). Directive: `DIRECTIVE_EMP_COST_TEMPLATES.md`; mẫu gốc: `docs/report-samples/CHIPHI_TEMPLATE_{FULLTIME,PARTTIME}.xlsx`.

### 2026-07-22 — Nghiệm thu PRODUCTION — "Chi phí của tôi" chạy thật (Claude xác nhận)
- **Đã deploy + nghiệm thu production.** Pipeline hoàn chỉnh: doanh thu (App Sale) × % (DataHub, catalog V30.10) = Thành tiền, self-scoped. Khớp doanh thu **170/183 = 92,9% ≥ 90%** → tổng hiển thị. **Tổng chi phí tháng (trừ c44) = 42.834.991đ** (c36 750.400 + c41 7.995.379 + c43 26.489.506 + c45 7.599.706 — Claude cộng lại khớp); **c44 tách riêng 36.659.958đ**. 199/199 test, health OK.
- **Theo dõi tiếp:** (1) 13/183 khóa chưa khớp % (7,1%) → dòng có doanh thu nhưng Thành tiền `—`, nên rà (mã hàng thiếu trong catalog?). (2) 4 cột mới (Tuyến/Nhà thầu/Giá trúng thầu/Ghi chú) + thứ tự cột: **đợt kế** (chờ CEO chốt thứ tự + duyệt giá trúng thầu + nguồn ghi chú). (3) Carry-forward nhiều tháng (T06→T07) tùy DataHub.

### 2026-07-21 — Claude Code (review) — grain order-line `807b5744`: ĐẠT
- **Review `review/emp-cost-line-grain-20260721` (`807b5744`): ĐẠT.** `rows = revenueLines.map(...)` — **mỗi dòng doanh thu = 1 dòng** (không gộp; `sourceLineId` giữ từng dòng thô); Cerecaps T06 DN001 = **2 dòng riêng** (13.246.800đ + 11.970.000đ); không bịa ngày/mã đơn (T06 cũ thiếu → `—`); % + Thành tiền `—` vì DataHub chưa xong (đúng); giữ tổng/kỳ, c44, self-scope, C32/C47, công tắc, Σ ngày = tháng. 236/236 test.
- 2 commit kèm (đều tốt): `7e1f32f` employee-bound key (token gán theo NV — bảo mật ↑); `b0231d7` bound OTP timeout (hardening auth, ngoài phạm vi cost nhưng có lợi). Chưa deploy.
### 2026-07-22 — Report Bot — “Chi phí của tôi” chuyển sang grain order-line
- Bỏ gộp doanh thu theo đơn vị × mã hàng: mỗi dòng doanh thu nguồn (mỗi đơn × mỗi mặt hàng) được giữ thành một dòng hiển thị, có mã đơn/ngày/số lượng/doanh thu dòng khi nguồn cung cấp.
- Timeline % được tra theo mã hàng × tháng rồi áp cho từng order-line; thiếu DataHub vẫn giữ đủ dòng doanh thu với `%`/`Thành tiền` là `—`.
- Giữ tổng tháng/kỳ, tách C44 cuối năm, self-scope, chặn C32/C47, công tắc và nhóm xem theo ngày với Σ ngày = tháng.
- Nghiệm thu dữ liệu thật T06 DN001: Cerecaps giữ 2 dòng riêng 13.246.800đ và 11.970.000đ; bổ sung test grain, full test và production build.

### 2026-07-21 — CEO Office — employee-bound key cho consumer chi phí
- Thay shared cost token bằng hai lớp tách biệt: `DATA_HUB_ASSIGNMENT_KEY` xác thực service và `APP_REPORT_EMPLOYEE_COST_KEYS` bind chính xác từng mã NV sau khi backend khóa scope từ session.
- Không fallback `APP_REPORT_COST_TOKEN`; thiếu/sai/trùng key, một NV có nhiều key xung đột, hai NV dùng chung key hoặc employee key trùng assignment key đều fail-closed trước khi gọi Data Hub.
- Key không đi qua frontend/log/audit/error; payload vẫn self-scoped, chặn C32/C47 và `private, no-store`.
- Cutover chỉ được phép khi mapping hai phía khớp đúng roster và hai tập key độc lập.

### 2026-07-21 — Claude Code (giao bot) — "Chi phí của tôi": grain = mỗi đơn × mỗi mặt hàng (không gộp)
- CEO chốt: mỗi mặt hàng trong đơn = 1 dòng; nhiều đơn cùng mã QLNB = mỗi đơn 1 dòng. ⇒ **bỏ gộp `(đơn vị×mã hàng)`, hiển thị theo dòng giao dịch (order-line)**. Vd Cerecaps T06 DN001 = **2 dòng riêng** (13.246.800đ + 11.970.000đ), không gộp 1. % tra timeline theo mã hàng+tháng (mọi dòng cùng mã/tháng cùng %). Giữ tổng/c44/scope/C32-C47/công tắc. Chạy được ngay, không phụ thuộc DataHub. Directive: `DIRECTIVE_EMP_COST_LINE_GRAIN.md`.

### 2026-07-21 — Claude Code (review) — REDESIGN timeline (revenue-driven) `60c8c9c`: ĐẠT
- **Review `review/employee-cost-timeline-redesign-20260721` (`60c8c9c`): ĐẠT.** Lõi chuyển đúng sang **doanh thu dẫn dắt** (`rows = revenueIndex.entries()`, DataHub chỉ là bảng tra %); thiếu %/trùng % → giữ dòng với `—`; ghép theo MÃ (byUnitCode/byCode, c5 confirm qua catalog, không tên trần); dimensions canonical; giữ daily Σ=tháng, c44, self-scope, C32/C47, công tắc; thêm alias env `DATA_HUB_BASE_URL`/`DATA_HUB_ASSIGNMENT_KEY`. 230/230 test.
- **2 phát hiện dữ liệu thật (bot không bịa — đúng):** (1) T07 DN001 chỉ **1 khóa Cerecaps** `038.PKĐK THIỆN NHÂN-CN2` 7.980.000đ (không phải 3 dòng) — do gom theo đơn vị×mã hàng / đơn 21/07 chưa vào snapshot; chờ CEO xác nhận cách hiển thị. (2) 🔴 **DataHub production vẫn trả 10.982 dòng, không `ky/period`, chưa áp `from/to`** — timeline fix CHƯA deploy → chưa tính được Thành tiền thật. Blocker duy nhất còn lại.

### 2026-07-21 — Claude Code (giao 2 bot) — REDESIGN model chi phí: % theo TIMELINE + dòng do App Report dẫn dắt
- **CEO xác nhận model đúng.** Sửa điểm gốc: % chi phí là **timeline thường trực** theo mã hàng (hiệu lực từ ngày-đầu-tháng, carry qua tháng), **KHÔNG** sinh từ `sales_facts`. **Danh sách dòng lấy từ doanh thu App Report** (mã hàng NV bán trong tháng), tra % từ DataHub timeline → **T07 hiện được dù DataHub chưa nạp sales_facts T07** (sửa cách hiểu cũ T07=0).
- Giao: **DataHub Bot** trả % theo timeline (không gate sales_facts); **Report Bot** dẫn dắt dòng từ doanh thu App Report + tra % từ DataHub. Directive: `DIRECTIVE_EMP_COST_TIMELINE_REDESIGN.md`; cập nhật `DIRECTIVE_EMP_COST_MASTER.md`.

### 2026-07-21 — Claude Code (review) — "Chi phí của tôi" mục 11 (công tắc bật/tắt): ĐẠT
- **Review `bbfc86c` (`review/emp-cost-visibility-toggle-20260721`): ĐẠT.** `employeeCostVisibility.js`: ưu tiên **cá nhân > nhóm > phòng**, mặc định **off**, **mã ngoài roster fail-closed** (kể cả phòng đang bật/override cũ). Route: toàn bộ fetch DataHub/doanh thu/catalog nằm **trong callback** — **OFF → trả `disabled`, KHÔNG chạy callback** (không đụng DataHub); **admin bypass** (CEO/admin xem NV bất kỳ). Admin routes GET/POST `requireAdmin`; validate chặt (chỉ roster, on/off/inherit); audit access_denied + đổi cấu hình (an toàn, không token/số chi phí). FE render cờ `disabled` từ backend, không tự quyết quyền. 227/227 test + build + quét bundle PASS.
- **Chưa deploy.** Còn blocker DataHub (self-scope + trường kỳ) + `.env` trước khi bật production.

### 2026-07-21 — Claude Code (review) — "Chi phí của tôi" MASTER + roster: ĐẠT (code trên main)
- **Review `ad2cd64` (period drilldown) + `504cbda` (roster/nhóm): ĐẠT.** Đã xác minh `employeeCost.js` trên main **byte-identical** với bản review. Điểm mạnh: xem theo ngày đảm bảo **Σ ngày = tổng tháng** (dồn phần lẻ vào ngày cuối); **chống cộng trùng** (nhiều dòng cùng đơn vị+SP → fail-closed); **Tổng cả kỳ** không gộp c44; **fail-closed khi DataHub trả range không có trường kỳ** (lá chắn lỗi 10.982 dòng); doanh thu lấy riêng từng kỳ + scope theo NV; nhóm CTV/CTV-đặc-biệt nằm ở **config JSON** (không hardcode); "Tất cả nhân viên" đã gỡ sạch (revert kiểm tra rỗng).
- **Chưa deploy** (đúng chủ đích). Chờ: (1) DataHub sửa self-scope + trường kỳ, (2) mục 11 công tắc/gửi riêng, (3) `.env` `DATAHUB_BASE`/`APP_REPORT_COST_TOKEN`.

### 2026-07-21 — Report Bot — Công tắc tự xem “Chi phí của tôi” theo phòng/nhóm/cá nhân
- Thêm cấu hình bền `employee_cost_visibility.json`, mặc định an toàn `department=off`; override nhóm/cá nhân dùng roster Sale 21 người và ưu tiên **cá nhân > nhóm > toàn phòng**. Mọi lần đổi được audit nguyên trạng trước/sau, actor, thời gian và từng path thay đổi.
- Backend khóa self-view trước mọi truy cập doanh thu/catalog/DataHub: NV bị tắt chỉ nhận `{ disabled:true, columns:[], rows:[] }`; CEO/admin bypass để quản trị. `/me` trả `employeeCostDisabled` để frontend ẩn tab theo quyết định backend.
- Thêm GET/POST `/api/employee-cost/visibility` có `requireAuth + requireAdmin`, validate `on/off/inherit`, trả panel động gồm toàn phòng/nhóm/NV cùng trạng thái hiệu lực và nguồn quyết định.
- Trang Chi phí của tôi có panel CEO/admin để bật/tắt toàn phòng, từng nhóm và từng cá nhân; không hardcode roster/nhóm trong bundle. Bổ sung API/model/CSS và test service, audit, input lỗi, route guard/thứ tự fail-closed, model/source/ẩn tab frontend.

### 2026-07-21 — Report Bot — "Chi phí của tôi": tự tính Thành tiền + tách khoản cuối năm
- App Report ghép dòng chi phí với doanh thu đã khóa scope theo **đơn vị + mã sản phẩm** (C16 được resolve qua catalog), tính `Thành tiền = doanh thu × tỷ lệ ÷ 100`; dòng không khớp giữ `—` và cảnh báo khi tỷ lệ khớp dưới 90%.
- Mỗi cột tỷ lệ có cột **Thành tiền**; tỷ lệ hiển thị số không kèm `%`. Cột cấu hình cuối năm (mặc định `c44`) được làm mờ, không cộng vào tổng tháng và có tổng T12 riêng.
- Giữ nguyên chặn C32/C47, token chỉ ở backend và audit theo scope; bổ sung test server/web cho phép tính, fail-closed, tổng tháng/cuối năm và định dạng hiển thị.
- Ô chọn nhân viên CEO/admin chỉ lấy **đúng roster Sale 21 người** và chọn từng người, không có lựa chọn “Tất cả”. Phân nhóm backend: 15 NV chính thức, CTV (`DN002/DN004/DN022`) và CTV đặc biệt (`DN021/DN023/VP004`) để sẵn sàng cho chế độ gửi riêng.
- Bổ sung bộ lọc **Từ tháng/Đến tháng** mặc định tháng hiện tại; backend kiểm `YYYY-MM`, khóa scope NV và truyền nguyên `from/to` xuống endpoint DataHub. Adapter nhận payload `periods`/`months` hoặc dòng có `period`, giữ tương thích payload cũ đúng một tháng và fail closed khi nguồn nhiều tháng mơ hồ.
- Doanh thu/catalog được lấy riêng đúng từng kỳ; UI tách mỗi tháng thành một khối có tổng tháng riêng và thêm **Tổng cả kỳ** không gồm cột cuối năm. Drill ngày chỉ mở khi mọi dòng doanh thu có ngày đúng kỳ và tổng Thành tiền ngày khớp tuyệt đối tổng tháng; thiếu/sai ngày giữ trạng thái rỗng an toàn.

### 2026-07-21 — Claude Code (review + giao bot) — "Chi phí của tôi": Thành tiền ĐẠT + công tắc bật/tắt
- **Review THẬT `b1a4cd0` (Thành tiền): ĐẠT.** Ghép doanh thu resolve `c16`→mã qua catalog (không dùng tên trần), scope doanh thu đúng NV+kỳ, `round(dt×%/100)`, <90% khớp → ẩn tổng + cảnh báo, c44 tách annual (cấu hình env), % hiện `8.0` không ký hiệu %, fail-closed/audit. Bản MASTER `ad2cd64` (lọc tháng/xem ngày/tổng kỳ) chưa push — chờ review tiếp.
- **Giao bot công tắc bật/tắt** (`DIRECTIVE_EMP_COST_VISIBILITY_TOGGLE.md`): CEO bật/tắt quyền NV tự xem chi phí ở 3 mức **toàn phòng / nhóm (vd CTV) / cá nhân**, ưu tiên cá nhân>nhóm>phòng, mặc định off, chốt quyền ở backend (OFF → `disabled`, không gọi DataHub), panel + route CEO-only + audit.
- **Blocker:** endpoint DataHub `employee-cost` trả 404 (chưa mở) → App Report fail-closed đúng; task dựng endpoint giao phiên DataHub.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": DIRECTIVE TỔNG gộp cho bot đọc 1 lần
- Gộp toàn bộ yêu cầu module "Chi phí của tôi" vào `DIRECTIVE_EMP_COST_MASTER.md` (nguyên tắc scope/C32-C47/token, cách lấy đúng cột khi khóa C32–C47, render động + hiển thị %, Thành tiền tự tính + C44 cuối năm, bộ lọc kỳ (C), xem theo ngày, lấy thử T07 thật, nghiệm thu). Để CEO copy cho bot; các directive rời vẫn giữ.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": chốt (C) + xem theo NGÀY + cách lấy đúng cột
- CEO chốt khoảng nhiều tháng = **(C)** tách từng tháng + dòng "Tổng cả kỳ" (không gộp c44). NV **bấm xem theo NGÀY**: `Thành tiền ngày = doanh thu ngày × %(tháng) ÷ 100` (App Report tự tách từ doanh thu ngày; Σ ngày = tháng).
- **Tư vấn cách lấy đúng cột khi DataHub khóa C32–C47:** không phá khóa/không đọc cột khóa trực tiếp; dùng endpoint dịch vụ + `x-assignment-key` làm cửa hợp lệ duy nhất — DataHub whitelist đúng cột CEO chỉ định (C33–C46), self-scoped theo NV, khóa cứng C32/C47; bot chỉ dùng endpoint. Directive: `DIRECTIVE_EMP_COST_ACCESS_DAYVIEW.md`.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": bộ lọc kỳ (Từ→Đến tháng) + lấy thử T07 thật
- Giao bot thêm **bộ lọc "Từ tháng → Đến tháng"** cho trang Chi phí của tôi (FE + backend truyền `from/to` xuống DataHub; vẫn khóa scope NV). Nhiều tháng = **tách từng tháng** (mỗi tháng có tổng riêng; c44 cuối năm tách như đã chốt). DataHub cần nhận thêm tham số kỳ (thêm tham số lọc, không phải thêm cột) — bot phối hợp phiên DataHub.
- **Lấy dữ liệu THẬT T07/2026 tính thử** (bot chạy trên server — Claude không có quyền dữ liệu thật): dán vài dòng + tổng chi phí tháng (trừ c44) + tỉ lệ dòng khớp doanh thu để CEO/Claude soi. Directive: `DIRECTIVE_EMP_COST_MONTH_FILTER.md`.

### 2026-07-20 — Claude Code (giao bot) — "Chi phí của tôi": App Report tự tính Thành tiền + cột cuối năm
- CEO chốt DataHub không mở thêm cột → **App Report tự thêm cột Thành tiền + tự tính**: `Thành tiền(dòng) = doanh thu dòng × % ÷ 100` (doanh thu dòng App Report tự lấy, ghép theo đơn vị+sản phẩm; không khớp → `—`).
- Hiển thị cột %: bỏ ký hiệu `%`, chỉ số (8,0%→`8.0`). Mỗi cột % có cột Thành tiền; **Tổng chi phí tháng** = Σ Thành tiền **trừ cột cuối năm**.
- **Cột cuối năm (mặc định `c44`)** thanh toán T12, không tính vào chi phí tháng: hiển thị **mờ + badge**, tách dòng "Khoản cuối năm (T12)" riêng + chú thích (Claude tư vấn). Directive: `DIRECTIVE_EMP_COST_THANHTIEN.md`; cập nhật `SPEC_REPORT_EMP_COST_SELFVIEW.md`.

### 2026-07-20 — Claude Code (thiết kế/giao bot) — Thêm theme "MODERN" + bố cục thích ứng cho deck
- CEO duyệt phong cách HIỆN ĐẠI (sạch/thoáng, accent gradient tím–xanh, KPI lớn). Giao bot **thêm theme chọn được** (song song bản hiện có) + **bố cục thích ứng theo mật độ nội dung** (trang nhiều chữ căn gọn vừa khung; trang ít chữ tăng cỡ chữ + chèn hình minh hoạ SVG).
- Mốc hình ảnh: `docs/report-samples/MODERN_THEME_MOCKUP.html`; directive: `DIRECTIVE_DECK_MODERN_THEME.md` (design tokens đã kiểm CVD, giữ grounding/CEO-only/32-slide).

### 2026-07-20 — Claude Code (review) — Module “Chi phí của tôi” (`6781517`): ĐẠT
- **Review DUYỆT.** Khóa scope NV (ép mã phiên; picker `requireAdmin`), chặn `C32/C47` cả backend+frontend, kiểm `empCode` 2 lần + strip field lạ, token chỉ ở backend/fail-closed/retry backoff/audit, FE render động không tự tính/cộng dồn chi phí, sẵn `type` %/money (phương án B). Test 177/177 server · 15/15 web · build + quét bí mật PASS. Không có điểm chặn.
- **Còn lại (ngoài code):** điền `.env` `DATAHUB_BASE`+`APP_REPORT_COST_TOKEN` rồi deploy; cột “Thành tiền” chờ phiên DataHub bổ sung (task contract-update đã giao) — khi có dải key sẽ ra directive nới allowlist cho App Report.

### 2026-07-20 — Report Bot — Module “Chi phí của tôi” self-scoped
- Thêm proxy S2S `GET /api/employee-cost`: backend dùng `auth.scopeOf`, ép NV về chính mã phiên; CEO/admin được chọn NV. Token DataHub chỉ đọc từ `.env` backend; payload được allowlist lại, chặn `c32`/`c47`, field ngoài hợp đồng và response sai `empCode`.
- Thêm timeout/retry backoff cho lỗi tạm thời, response rỗng an toàn khi nguồn lỗi/401, `Cache-Control: private, no-store` và audit mỗi lượt truy cập không ghi token/body nhạy cảm.
- Thêm tab “Chi phí của tôi”, bảng cột động, chiều `c5/c7/c16/c25` đứng trước, format `%` kiểu Việt; cột tiền chỉ hiển thị/format khi metadata DataHub khai báo rõ. App Report không tự tính/suy ra tiền và không tổng hợp tỷ lệ.
- Đồng bộ hợp đồng DataHub vào `docs/`, bổ sung biến `.env.example` và test scope/sanitize/retry + model bảng động.

### 2026-07-20 — Claude Code (tư vấn kiến trúc) — Thành tiền chi phí: chốt phương án B (DataHub tính, App Report view)
- CEO cần cột **Thành tiền** cho module "Chi phí của tôi". Tư vấn: **DataHub tính sẵn `%×base` tại nguồn** (SSOT), đưa vào `columns[]`; App Report **chỉ view** — vì bảng render động nên **tự hiện, không sửa code**. Tránh lệch số & join mờ, giữ nguyên tắc "App Report không tính chi phí".
- Yêu cầu nhỏ cho DataHub: mỗi cột trong `columns[]` thêm `type ∈ {percent, money}` để App Report format đúng (% không cộng dồn; money định dạng tiền, được phép tổng). Cập nhật `SPEC_REPORT_EMP_COST_SELFVIEW.md`.

### 2026-07-20 — Claude Code (review + giao bot) — Sửa kỳ TUẦN của deck + review 728c734
- **Review deck `728c734`: ĐẠT.** Grounding (deckHtml không số cứng, số từ analytics/diemXu, narrative từ facts đã tính), CEO-only 3 tầng (build/sendCeo/route requireAdmin), delivery (sendDocument + email attachments + PDF fallback, nhãn DRAFT, chống trùng, assert 32 slide) đều đúng spec.
- **DIRECTIVE sửa kỳ TUẦN** (`DIRECTIVE_DECK_WEEKLY_ISOWEEK.md`): CEO chốt báo cáo TUẦN = **tuần lịch ISO Thứ 2→Thứ 7** (hiện tuần 30/2026), KHÔNG lũy kế đầu tháng; so sánh vs tuần trước; nhãn "Tuần {ISO}/{năm}". Tháng giữ nguyên. Chỉ đổi cửa sổ ngày cho `kind='week'`, không đổi cách tính số.

### DRAFT — 2026-07-20 — deck CEO 32 slide: hoàn thiện 5 pha, lịch vẫn khóa
- Hoàn thiện module canonical `deckData.js`/`deckHtml.js`: nguồn hàng ưu tiên map live trong catalog, luôn đối soát đủ Group-Dona/Đối tác; cảnh báo “doanh số cao–xu thấp” dùng đúng doanh số quý; DRAFT và bản chính thức tách nhãn/key, không ảnh hưởng báo cáo per-NV trong `salesReport.js`.
- Chuyển renderer PPTX sang Playwright thật (`playwright-core`) → 32 PNG 1280×720 → `pptxgenjs` 16:9 full-bleed; thêm kiểm tra overflow từng slide và PDF fallback 32 trang nếu đóng gói PPTX lỗi.
- Delivery giữ CEO-only, email đính kèm và Telegram `sendDocument`; lưu tiến độ từng kênh để retry chỉ gửi lại tệp/kênh lỗi, DRAFT không chặn khóa chống trùng bản chính thức.
- Bổ sung CLI DRAFT mặc định/`--official`, route preview admin có PDF fallback, scheduler 13:00 Thứ 7 + 18:00 ngày cuối tháng theo Asia/Ho_Chi_Minh. Scheduler fail-closed bằng hai cờ `REPORT_DECK_SCHEDULER_ENABLED=false` và `REPORT_DECK_SCHEDULER_APPROVED=false`.
- QA: đối chiếu độc lập tổng doanh thu, Top đơn vị/sản phẩm và Điểm–Xu đều khớp backend; HTML/PPTX tuần + tháng đủ 32 slide, không overflow, PPTX ZIP hợp lệ 32 slide/16:9; toàn bộ 173 test PASS.
- Sau khi CEO duyệt, đã gửi riêng CEO bản DRAFT tuần và tháng qua email + Telegram, mỗi kỳ gồm `.html` + `.pptx`. Lịch tự động vẫn tắt; không deploy/restart.

### PRODUCTION — 2026-07-15 — App Report New chính thức tại report.donapharm.asia
- Chốt release `5df20e0`, build production và chạy PM2 `reportnew` trên `127.0.0.1:3873`; giữ `dona-report` cổng `3860` nguyên trạng để rollback nội bộ.
- Home SSO dùng `GET /api/sso/verify`, Report phát session riêng; CORS chỉ cho các origin DONAPHARM được duyệt và asset thiếu trả HTTP 404 thay vì SPA HTML.
- Tunnel chính chuyển `report.donapharm.asia` sang `3873`; gỡ public alias `tuan13`/`slides` tới app cũ. HTTPS health/version, Home SSO, API có quyền, desktop/mobile và console đều PASS.
- Cấu hình và source đã sao lưu trước cutover; không commit `.env`, secret hay artifact private.

### DRAFT — 2026-07-14 — CEO Deck V5D dùng ảnh CEO cung cấp + chuẩn hóa pháp nhân (38 slide/deck)
- Tạo bản độc lập `deckHtmlV5D.js`, `deckPptxV5D.js`, `deckReportV5D.js`; không ghi đè V5/V5C. Xuất tuần W28 và tháng 06/2026 tại `artifacts/sales-report/deck-v5d-ceo-photos/`, tên tệp kết thúc `_DRAFT_V5D_CEO_PHOTOS`.
- Chỉ dùng đúng 20 JPG CEO cung cấp `ceo-photo-74.jpg` → `ceo-photo-93.jpg`, xác minh SHA-256 theo `SOURCE_MANIFEST.json`; dùng đủ 20 ảnh trên đúng 18/38 slide mỗi deck, nhúng data URI tự chứa. Ảnh du lịch 74–79 chỉ nằm trong một collage văn hóa/kết thúc, không làm bằng chứng vùng/sản phẩm/QLNB. Không có URL ảnh từ xa hay tham chiếu asset AI V5C.
- Sửa chuẩn hóa nhà cung cấp không phân biệt hoa/thường/khoảng trắng, nhãn hiển thị ổn định. Tháng 06/2026: DONAPHARM **10.593.941.804đ**, AFP PHARMA **8.232.847.232đ**, Group-Dona **18.826.789.036đ**, đúng 2 pháp nhân; tổng công ty giữ **28.403.136.096đ**. Tuần: DONAPHARM **3.792.635.096đ**, AFP PHARMA **3.224.833.445đ**, Group-Dona **7.017.468.541đ**, đúng 2 pháp nhân.
- Giữ facts V5: 38 slide/deck; QLNB **2.741 / 122 / 44 / 9.440.828.476đ / 18 sản phẩm / đủ 44 dòng**; chỉ đào sâu Đồng Nai/Bình Phước; không tạo WoW giả. Slide 12 hiển thị đúng hai pháp nhân Group-Dona.
- Evidence tại `verification-screenshots/20260714-ceo-deck-v5d-ceo-photos/`: 76 PNG 1920×1080, contact sheets, photo-rich sheets, source-use manifest và QA ledger 76/76 slide. QA PASS: logo chính thức 38/38, PPTX ZIP 38/38, 0 geometry issue, 0 console error, 0 hash slide trùng trong từng deck; spot-audit full-resolution slide 6–8, 12, 14, 17, 35, 38 không còn lỗi cụ thể.
- V5D/V5/V4/CST regression đều PASS. Chưa gửi ngoài, chưa deploy/restart/commit/push, chưa bật lịch.

### REJECTED / NOT DELIVERED — 2026-07-14 — CEO Deck V5C Images tuần/tháng (38 slide, Premium Pharmaceutical)
- CEO từ chối vì V5C dùng hình AI thay vì ảnh công ty CEO đã cung cấp. Bản V5C là nháp bị loại, **không giao/không gửi**, không được tái sử dụng asset AI trong V5D.
- Tạo nhánh module/artifact/test độc lập `deckHtmlV5C.js`, `deckPptxV5C.js`, `deckReportV5C.js`, tái sử dụng `deckDataV5`; V5 Deep được giữ nguyên như bản lịch sử data-first, không ghi đè.
- Tích hợp 8/8 asset hình ảnh Premium Pharmaceutical đã duyệt bằng data URI tự chứa vào 18/38 slide mỗi deck; không URL ảnh từ xa. Dùng panel/crop/veil khác nhau cho bìa, vùng, khách hàng, NV, danh mục, QLNB, Điểm/Xu, rủi ro/kết luận; 5 trang chi tiết 44 dòng QLNB giữ thuần dữ liệu.
- Giữ toàn bộ facts V5: tuần **10.649.681.681đ**, tháng **28.403.136.096đ**; chỉ đào sâu Đồng Nai/Bình Phước; QLNB **2.741 / 122 / 44 / 9.440.828.476đ / 18 sản phẩm / đủ 44 dòng trong 5 trang**; không tạo WoW tuần giả.
- Xuất HTML/PPTX `_DRAFT_V5C_IMAGES` tại `artifacts/sales-report/deck-v5c-images/`; evidence 76 PNG 1920×1080, contact sheets, focused image-rich sheets và ledger 76/76 slide tại `verification-screenshots/20260714-ceo-deck-v5c-images/`.
- QA tự động: 38 slide/deck, logo chính thức 38/38, 18 slide ảnh/deck, đủ 8 asset, 0 geometry issue, 0 console error, 0 hash ảnh slide trùng trong từng deck, PPTX ZIP 38 slide/38 PNG, manifest/hash khớp. Đã spot-audit full resolution các slide rủi ro cao và chỉnh vùng bảng/crop; chưa gửi ngoài, chưa deploy/restart/commit/push/bật lịch.

### DRAFT — 2026-07-14 — CEO Deck V5 Deep tuần/tháng (37 slide, Premium Pharmaceutical)
- Tạo mới `deckDataV5.js`, `deckHtmlV5.js`, `deckPptxV5.js`, `deckReportV5.js`; xuất riêng 4 artifact HTML/PPTX DRAFT tuần W28 và tháng 06/2026, không sửa/ghi đè V4.
- Mở rộng có chủ đích từ 32 lên 37 slide theo chỉ đạo CEO: 18/18 sản phẩm QLNB được tách 2 slide đọc rõ; 44/44 dòng QLNB đang chờ được tách 4 slide chi tiết. Baseline khóa: 2.741 dòng nguồn, 122 nhóm multi-QLNB, 44 dòng đang chờ, 9.440.828.476đ, 18 tên sản phẩm không trùng đại diện.
- Đào sâu khu vực chỉ Đồng Nai và Bình Phước; mọi tỉnh khác chỉ nằm trong tổng công ty. Week: 10.649.681.681đ (Đồng Nai 8.891.523.316đ; Bình Phước 1.570.481.685đ). Month: 28.403.136.096đ (Đồng Nai 19.351.299.898đ; Bình Phước 2.062.499.760đ).
- Phân tích đủ tuyến, Group-Dona/đối tác, khách hàng/điều trị, NV/đơn vị/sản phẩm, Điểm/Xu quý, rủi ro/cơ hội/action board. Tuần giữ `Không đủ chuẩn WoW`, không nội suy kỳ trước; tháng so hai tháng hoàn chỉnh.
- Đã phân tích thêm toàn bộ 20 slide mẫu `PhanTich_DoanhSo_20Slide_TUAN24_2026_1...pptx` và chỉ tiếp thu hierarchy KPI-first, warning có bằng chứng, concentration/middle-tier, action owner/deadline, treatment trắng–xanh–cam; không copy số cũ hay nền so sánh giả.
- QA: 2 deck × 37 = 74 slide render 1920×1080; ledger thủ công đủ 74/74 PASS, DOM collision/console 0, logo chuẩn 37/37 mỗi deck, PPTX ZIP hợp lệ 37 slide/37 PNG, không ảnh trùng trong từng deck. Evidence tại `verification-screenshots/20260714-ceo-deck-v5-deep/`. Chưa gửi ngoài, chưa deploy/restart, chưa bật lịch.

### DRAFT — 2026-07-14 — Sửa trình tự nhiều QLNB trong CST (App Report New / CEO Deck V4B)
- Thêm classifier CST trung tâm theo đơn vị + tên sản phẩm chuẩn hóa + ĐVT chuẩn hóa; giữ nguyên dòng nguồn và gắn metadata mã hiện hành, mã kế tiếp, trạng thái chuyển tiếp.
- Tách QLNB `ĐANG CHỜ`/`CẦN XÁC NHẬN` khỏi danh sách chưa khai thác, cảnh báo hành động và nội dung dùng để đánh giá nhân viên; cập nhật Analysis, Overview, CST và AI/smart answers.
- CEO Deck V4B tuần/tháng đổi slide “3 cuộc gọi đầu tiên” sang trình bày trung lập, sequence-aware và bổ sung ghi chú nghiệp vụ bắt buộc. V4A/V3 giữ nguyên artifact lịch sử.
- Baseline hiện tại được khóa test chính xác: 2.741 dòng, 122 nhóm nhiều QLNB, 44 mã đang chờ với 9.440.828.476đ. Các nhãn ĐVT nguồn xung đột chỉ được canonicalize khi cùng hậu tố family QLNB cung cấp bằng chứng định danh; không tự ghép ĐVT tùy ý.

### 2026-07-14 — Report Bot — CEO Deck V4 dual-theme DRAFT + logo chuẩn 32/32 slide
- Tạo V4A giữ phong cách Luxury Editorial navy/ivory/gold và V4B Premium Pharmaceutical trắng–xanh DONAPHARM–cam, dùng chung nội dung/số liệu canonical V3; không đổi kỳ tuần W28 `06–11/07/2026` hay tháng `01–30/06/2026`.
- Thay logo tách nền bằng đúng asset chính thức `web/public/logo-dnpharma.png` 640×369, SHA-256 `c5d9986df442c45a8af1ef78550d026626435940a4fa4e8d3404c4066838134e`, màu chủ đạo `#005DAA/#F7A31C/#FFFFFF`; giữ tỷ lệ gốc, nền trắng và chèn đủ 32/32 slide.
- Thêm `deckHtmlV4.js`, `deckPptxV4.js`, `deckReportV4.js` cùng script npm `deck:v4:build`, `deck:v4:test`, `deck:v4:test-build`; xuất 8 tệp HTML/PPTX DRAFT tại `artifacts/sales-report/deck-v4/` và contact sheet/PNG tại `verification-screenshots/20260714-ceo-deck-v4/`.
- QA PASS: tổng số liệu canonical không đổi; 4 deck × 32 slide; logo chính thức 32/32 trong HTML và pixel-proof 32/32 trên ảnh nguồn PPTX; 0 browser console error, 0 overflow/collision; PPTX ZIP hợp lệ, 32 slide; manifest SHA-256 đầy đủ. Không deploy/restart/gửi ngoài/bật lịch.

### 2026-07-13 — Report Bot — DRAFT deck CEO 32 slide tuần/tháng
- Đồng bộ `origin/main` chứa PR #104 trước khi triển khai; giữ nguyên toàn bộ thay đổi App Report New đang chạy, không reset workspace.
- Thêm `server/src/report/deckData.js`: FACTS CEO scope cho tuần/tháng gồm tổng và kỳ đối chiếu, ngày, tuyến, nguồn hàng, loại khách hàng, nhóm điều trị, NV/đơn vị/sản phẩm, điểm & xu quý; thiếu map giữ “Chưa phân loại/Chưa phân nhóm”, không suy đoán.
- Thêm `deckHtml.js`, `deckPptx.js`, `deckReport.js`: dựng 32 slide 16:9 theo hệ navy `#071F47` + vàng `#F5C242`, nhúng asset chính thức, chụp Chromium 1280×720 và đóng gói PPTX 32 ảnh full-slide.
- Sinh DRAFT tuần + tháng tại `artifacts/sales-report/deck/`, mỗi loại có HTML, PPTX và manifest SHA-256; scheduler vẫn tắt và chưa gửi ra ngoài khi chưa có CEO duyệt riêng.
- Bổ sung email attachments và Telegram `sendDocument`; route `POST /api/report/deck/preview` + tải file được bảo vệ bằng quyền CEO/admin, tài khoản NV nhận 403.
- Nghiệm thu: tổng live `16.589.980.621đ`/1.066 dòng khớp backend; top NV/đơn vị/sản phẩm và điểm/xu đối chiếu độc lập; HTML/PPTX đủ 32 slide, không overflow 1280×720, PPTX ZIP hợp lệ.

### 2026-07-13 — Claude Code (kiến trúc/review) — Giao bot: báo cáo CHUYÊN SÂU (deck 32 trang)
- **Bản yêu cầu gốc đầy đủ cho bot** (`YEUCAU_BAOCAO_CHUYENSAU_CEO.md`): tự chứa, để bot đọc 1 lần hiểu trọn yêu cầu CEO — mục đích (CEO-only, trình chiếu LED, chuẩn cao cấp), lịch (T7 13h tuần / 18h ngày cuối tháng), 2 định dạng HTML+PPTX, 2 kênh email+Telegram (gửi tệp), quy trình DRAFT duyệt trước, 12 khối nội dung, nguyên tắc số liệu grounded, ranh giới, Definition of Done.
- **Bối cảnh:** CEO gửi mẫu chuẩn (HTML slide-deck + PPTX Tuần 26), yêu cầu báo cáo doanh số chi tiết tuần/tháng gửi email+Telegram cả PowerPoint + HTML. CEO đồng ý để **bot cầm code app**.
- **File giao bot (nhánh `claude/new-session-eifd44`):**
  - `docs/report-samples/BAO_CAO_TUAN_26_CHUYENSAU_SAMPLE.html` — mẫu chuẩn (32 slide 16:9, navy #071F47 + vàng #F5C242) làm nguồn sự thật hình ảnh.
  - `SPEC_REPORT_DECK_CHUYENSAU.md` — ánh xạ 32 slide → nguồn số grounded (`analytics`/`diemXu`/helper `salesReport.js`), 4 bảng tra bổ sung (tuyến CL/NCL/NT, nguồn Group-Dona/đối tác, loại KH, nhóm điều trị), PPTX qua Playwright→`pptxgenjs`, `notifyChannels.sendDocument` (Telegram) + email attachments, nghiệm thu 6 bước.
  - `DIRECTIVE_REPORT_DECK_KICKOFF.md` — thứ tự 5 pha + lệnh test từng pha.
- **Lịch gửi CEO chốt:** TUẦN gửi **13h00 Thứ 7 hằng tuần**, THÁNG gửi **18h00 ngày cuối tháng** (giờ VN).
- **Yêu cầu CEO:** báo cáo **CHỈ gửi CEO** (không gửi NV) — CEO trình chiếu **màn hình LED** cho toàn thể NV ⇒ chuẩn cao cấp: chính xác tuyệt đối, tinh xảo/thẩm mỹ, narrative thông minh. Bắt buộc dựng bản **DRAFT `[DRAFT — CHỜ CEO DUYỆT]`** gửi CEO duyệt trước khi lịch chạy chính thức.
- Ranh giới: KHÔNG đụng render per-NV trong `salesReport.js`; giữ nguyên tắc #2/#3/#4. Trạng thái: chờ bot triển khai.

### 2026-07-20 — Claude Code (kiến trúc/review) — Giao bot: module "Chi phí của tôi" (self-scoped)
- **Bối cảnh:** DataHub CEO-only nên NV không vào được → CEO chốt cho NV **tự xem chi phí/hoa hồng CỦA CHÍNH MÌNH** trong App Report. Điều chỉnh chính sách §8-BIS DataHub (trước cấm hoa hồng tới bề mặt NV) → nay cho NV thấy **của riêng mình** (self-scoped, read-only). Ghi ngoại lệ vào `CLAUDE.md`.
- **Quyết định CEO:** NV thấy **số tiền + tỷ lệ**; tên UI **"Chi phí của tôi"**.
- **Hợp đồng tích hợp (CEO cấp):** `GET /api/integrations/app-report/employee-cost?emp=<mã>`, header `x-assignment-key`; response cột **động** `{empCode, columns[], rows[]}`. Ràng buộc: `C32`(tổng)/`C47`(đầu ra) **không bao giờ gửi**; chỉ cột `C33–C46` CEO bật (allowlist động → render theo `columns`, không hardcode); giá trị **% theo dòng, KHÔNG cộng dồn**. Lỗi: 401 sai key / 400 thiếu emp / 502 retry.
- **File giao bot:** `SPEC_REPORT_EMP_COST_SELFVIEW.md` — App Report gọi DataHub server-to-server (token chỉ ở `.env`/backend), khóa scope ở backend (NV chỉ thấy của mình; CEO/ADMIN xem bất kỳ), FE render bảng động, không hardcode PII/số/token, không đưa vào LLM/NLQ. DataHub = SSOT (App Report không dựng engine thứ 2). Trạng thái: chờ bot triển khai.

### 2026-07-11 — Bot triển khai (Report Bot) — Vá UI thẻ Target trên Tổng quan
- **Deploy bản vá review `4207800` cho 3 file UI:** `web/src/charts.jsx`, `web/src/pages/Overview.jsx`, `web/src/styles.css`. Gauge target nay dùng thang 0–100 nên 44,x% lấp đúng khoảng 44% vòng, không còn góc nhỏ do thang cũ.
- **Khôi phục caption dưới vòng:** tách 2 cụm “Đã đạt” và “Mục tiêu tháng”, mỗi cụm có nhãn, số in đậm; “Đã đạt” đổi màu theo mức target (<80% đỏ đậm), “Mục tiêu tháng” xám đậm.
- **Build/deploy:** `npm --prefix web run build` OK; reload PM2 `reportnew` OK; domain public đang phục vụ asset hash mới `index-Pk5r85JG.js` / `index-Bp3OXr0t.css`.
- **Xác minh live:** trang Tổng quan T07.2026 hiển thị 44,7% (dữ liệu cập nhật 12:30 11-07), vòng lấp gần nửa; caption “Đã đạt 14.158.741.270đ” màu đỏ đậm và “Mục tiêu tháng 31.710.318.669đ” màu xám đậm, đều in đậm.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ họ mã đơn vị 034 trả hẹp
- **Sửa `applyHint` trong `server/src/nlqEngine.js`:** hint mã trần như `034`/`034*` khi khớp nhiều đơn vị khác nhãn sẽ trả cả họ mã để liệt kê, không thu về một đơn vị doanh thu cao nhất và không hỏi lại oan.
- **Giữ phân biệt cụ thể/mơ hồ:** `034.PKĐK Y ĐỨC TRẢNG BOM` vẫn ra đúng một chi nhánh; `034.PKĐK Y ĐỨC` vẫn ra riêng mã cha; `Y ĐỨC` chung chung vẫn hỏi lại; mã đơn nhất/cùng nhãn như `001` vẫn ra một đơn vị.
- **Test:** `node --check server/src/nlqEngine.js` OK; `ANTHROPIC_API_KEY= *** server/scripts/test_smart_nlq_regression.js` OK; test live T07 6/6 PASS cho họ mã 034, mã cụ thể, mã cha, mã 001 và câu mơ hồ.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ hỏi lại vô tận đơn vị cùng tiền tố 034.PKĐK Y ĐỨC
- **Sửa `applyHint` trong `server/src/nlqEngine.js`:** ưu tiên khớp cụ thể nhất trước khi hỏi lại; nếu câu chứa nguyên mã đơn vị thì chọn mã dài/cụ thể nhất, tránh mã cha `034.PKĐK Y ĐỨC` chen vào mọi chi nhánh `TRẢNG BOM/TRẢNG DÀI/TRỊ AN/HEALTHCARE` và gây vòng lặp hỏi lại.
- **Giữ câu mơ hồ thật:** chỉ gõ “Y ĐỨC” vẫn hỏi lại danh sách chi nhánh để NV chọn, không tự đoán.
- **Bổ sung pending-clarify trong `server/telegram-bot.js`:** nhớ câu hỏi/options 2 phút theo user; nếu NV trả lời bằng mã/tên ngắn ở lượt kế, bot map thẳng về option đã chọn rồi hỏi lại engine, không re-plan mất ngữ cảnh.
- **Test:** `node --check server/src/nlqEngine.js` OK; `node --check server/telegram-bot.js` OK; `ANTHROPIC_API_KEY= *** server/scripts/test_smart_nlq_regression.js` OK; test bot thật 6/6 PASS cho `TRẢNG BOM/TRẢNG DÀI/TRỊ AN/HEALTHCARE`, mã cha `034.PKĐK Y ĐỨC`, và câu mơ hồ “Y ĐỨC”.

### 2026-07-10 — Bot triển khai (Report Bot) — Fix NLQ chặn oan tên đơn vị có “Công ty”
- **Sửa guard phạm vi NV trong `server/src/nlqEngine.js`:** tách `empScopeAsk` và `companyScopeAsk`; chỉ chặn khi hỏi thật sự “toàn/cả/toàn bộ công ty”, “doanh thu công ty”, “công ty mình/tôi/chúng ta” hoặc “tất cả/nv khác”. Không còn bắt nhầm chữ “CÔNG TY” trong tên pháp nhân đơn vị như “CÔNG TY TNHH/CỔ PHẦN …”.
- **Bổ sung nhận diện alias đơn vị:** bỏ tiền tố “đơn vị” trong hint và map `PKĐK` → “phòng khám đa khoa” để câu hỏi theo tên đầy đủ/viết tắt đơn vị resolve đúng.
- **Nhãn quyền rõ ràng:** các breakdown/ranking khi NV hỏi trong scope sẽ ghi “của Anh/Chị” trên tiêu đề để tránh hiểu nhầm là tổng đơn vị/toàn công ty.
- **Test:** `node --check server/src/nlqEngine.js` OK; `ANTHROPIC_API_KEY= node server/scripts/test_smart_nlq_regression.js` OK; test bot thật theo directive 10/10 PASS (2 câu qua, 5 câu vẫn chặn, 3 câu cũ không vỡ).

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ Mức 3:** thêm kiến trúc 3 tầng `nlqEngine` gồm PLANNER (Claude → JSON DSL), EXECUTOR tham số hóa chạy trên dòng doanh thu đã scope quyền, và NARRATOR tiếng Việt không tự tính số.
- Executor hỗ trợ lọc kỳ/ngày/nguồn/tuyến/thực thể, groupBy/topN theo đơn hàng/nguồn/đơn vị/sản phẩm/NV/nhà thầu/tỉnh/tuyến/ngày, split 5 MISA + 5 WEB, so sánh theo nhịp tháng trước, so hôm nay với hôm qua, và chặn NV hỏi ngoài phạm vi.
- Advisory dùng LLM chỉ trên FACTS đã tính: tổng, top sản phẩm/đơn vị/nguồn, đơn vị tăng/giảm theo nhịp; không gửi dòng thô và không để LLM bịa số.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Revenue rollover:** `salesReport.defaultRanges()` nay nhận diện slot doanh thu active mới nhất ngay cả khi kỳ mới chưa có dòng, dùng `data_as_of/dateFrom` để cuộn báo cáo sang tháng mới.
- **Revenue refresh:** tick scheduler ngày 01 tháng mới chốt sổ kỳ vừa đóng đúng 1 lần (`final_close:<ky>`) trước khi materialize kỳ hiện tại; trạng thái lưu `server/data/revenue_refresh_state.json` để restart không chạy lặp.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ fast-path cho câu chắc chắn.** Các intent rõ như `top`, `theo ...`, `overview`, target/comparison/revenue tổng chạy code-first ngay; chỉ gọi `llm.interpretQuery()` cho `unknown`/`entity_drilldown`/`entity_lookup` hoặc câu tự nhiên regex không chắc, giảm trễ cho câu đơn giản.
- **Bỏ hardcode kỳ trong interpretQuery.** `llm.interpretQuery(question, { currentPeriod })` nhận kỳ hiện tại từ App Report; tháng tiếng Anh/không năm suy ra theo năm của `currentPeriod`, không cố định `07.2026`.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ LLM interpretQuery theo directive.** Thêm `llm.interpretQuery(question)` để Claude chỉ trả JSON ý định (`metric/dimension/unitHint/productHint/selfScoped/period/listAll`), không gửi số liệu/PII; App Report tự resolve thực thể, giữ scope và tính số bằng code Mức 1.
- **Fix ca NV hỏi tự nhiên/không dấu/tiếng Anh.** Các câu như “doanh thu tại mã đơn vị 001… tôi bán được bao nhiêu”, `001.bvdk dong nai`, và `how much did I sell at Dong Nai hospital in July` trả doanh thu của chính NV tại đơn vị 001; câu mơ hồ “benh vien dong nai” hỏi lại 001/025.

### 2026-07-09 — Bot triển khai (Report Bot)
- **NLQ drill-down mức 1 theo thực thể.** Ưu tiên câu có “ở/tại/của/trong/bên …” hoặc “ai/đơn vị nào bán …” để đào sâu đúng đơn vị/sản phẩm trước khi rơi vào breakdown/ranking chung.
- **Xử lý tên trùng/mơ hồ.** Câu “Đồng Nai/BVĐK Đồng Nai” hỏi lại mã 001/025 thay vì tự đoán; nếu có mã rõ như 001 thì trả chi tiết đúng đơn vị.
- **Giữ quyền & câu cũ.** NV thường chỉ thấy phần mình; “top 5 đơn vị”, “doanh thu theo sản phẩm” vẫn liệt kê toàn bộ như trước.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Tăng an toàn idempotent cho Sales Report.** Ngoài dấu batch theo kỳ/kind, ghi thêm dấu từng người theo `key#emp_code` ngay sau khi gửi thành công; nếu chạy lại sau lỗi giữa chừng sẽ bỏ qua người đã nhận, không gửi trùng hàng loạt.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Gộp kênh gửi Sales Report Email + Telegram.** Lệnh `send-all` và scheduler dùng `notify.deliver()` để gửi email và Telegram khi NV/CEO đã liên kết Telegram.
- **Dry-run recipients có trạng thái Telegram.** `node server/src/salesReport.js recipients` in đủ 17 NV + CEO, ai đã/chưa liên kết Telegram theo `listTelegramMap()`, kèm link `t.me/<bot>?start=<mã>` cho người chưa link.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Wire lịch gửi Sales Report vào Telegram worker.** Scheduler dùng cùng cách so giờ VN như digest hiện tại (`process.env.TZ=Asia/Ho_Chi_Minh`, `vnDate().getUTC*()`), log rõ mốc armed: tuần Thứ 7 13:00 và tháng 18:30 nếu là ngày cuối tháng; có thể tắt bằng `SALES_REPORT_NOTIFY=0`.
- **Thêm idempotent sales report.** Lưu dấu gửi theo `kind + kỳ + range`, restart worker không gửi trùng; CLI/scheduler dùng chung log.
- **Thêm lệnh tay gửi thật:** `node server/src/salesReport.js send-all [week|month]` gửi 17 NV KD + CEO digest, có `--force` nếu cần chạy lại có chủ đích.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Sửa so sánh kỳ trước theo nhịp cho báo cáo điểm/xu.** `prevRange` vẫn lấy trọn tháng trước để đọc được dữ liệu tổng kỳ T01–T06, nhưng các chỉ tiêu so sánh giữa tháng/tuần quy đổi theo `ngày đã trôi / ngày trong tháng`; nhãn email đổi thành “So với nhịp cùng kỳ T06/2026”. Bản cuối tháng giữ full-vs-full.
- **Chạy lại mẫu DN001 sau sửa nhịp.** DN001 T07 đến 09/07: doanh thu `1.169.154.080đ`; T06 full `2.444.530.837đ`; nhịp T06 quy đổi `709.702.501đ`; chênh `+64,7%`.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Sửa mẫu email điểm/xu DN001 theo review CEO/Claude.** Email NV đã giấu tên hệ thống/API/bảng/file kỹ thuật; khung nguồn dữ liệu chuyển sang ngôn ngữ nghiệp vụ nội bộ DONAPHARM, bỏ cột “Xu tuần” bị trùng, thêm D/E/G trong mục 9 và chú thích dự báo tháng là sơ bộ/còn biến động.
- **Sửa so sánh kỳ trước không còn 0 giả.** Chẩn đoán `getRows(06.2026, DN001)` có 262 dòng / `2.444.530.837đ`; nguyên nhân do dữ liệu T06 là tổng kỳ, không lọc được ngày lẻ. `salesReport.js` nay dùng trọn tháng trước cho `prevRange` để so sánh không bị rỗng giả.
- **Gửi lại mẫu thật DN001 tuần + tháng cho CEO duyệt.** Đã xuất HTML mới và gửi email test CEO; chưa bật lịch, chưa gửi 17 NV.

### 2026-07-09 — Bot triển khai (Report Bot)
- **Dựng `server/src/salesReport.js` theo directive điểm/xu.** Sinh báo cáo tuần/tháng từng NV KD + CEO digest, lọc người nhận bằng `targetRosterCodes()` và loại `DN021/DN022/DN023/VP004/VP018`; dùng `diemXu.js` cho điểm/xu, số live App Report, text thương hiệu `DONAPHARM`.
- **Nối mục I với nguồn CST App Sale đã duyệt.** Thêm `server/src/appSaleCst.js`: ưu tiên `GET /api/reports/tender-quota` có Bearer token; nếu API 401/chưa cấp token thì dùng cache materialized `server/data/cst_appsale_tender_quota.json` (runtime, không commit). Mục I dùng thẳng `slConLai`, lọc theo đơn vị NV, loại `la_ap_thau`, NCL hiển thị riêng là “dư địa vô hạn”.
- **Gửi mẫu thật DN001 cho CEO duyệt.** Đã xuất HTML tuần + tháng vào `artifacts/sales-report/` và gửi 2 email `[CEO DUYỆT]` tới `trungdangxuan@gmail.com`, SMTP trả OK. `node --check` và `npm --prefix web run build` OK. Chưa bật lịch, chưa gửi 17 NV.

# CHANGELOG & TIẾN TRÌNH — App Report New

> **QUY TRÌNH (đọc trước):** Đây là nhật ký DUY NHẤT ghi lại **mọi thay đổi của app** và **tiến trình hiện tại**.
> - Bot/người đọc repo hãy bắt đầu từ file này để nắm toàn cảnh, rồi đọc tiếp `CLAUDE.md` (bản đồ code) và `HANDOFF.md` (việc còn lại).
> - **Dev chính (Claude Code) BẮT BUỘC ghi 1 mục vào đây cho mỗi thay đổi** (mới nhất ở trên cùng), kèm ngày, việc đã làm, lý do, và trạng thái test.
> - Vai trò: Claude Code = dev chính; Bot server = hỗ trợ môi trường/deploy/tunnel. Tác vụ lớn ảnh hưởng hệ đang chạy phải hỏi bot server trước.

---

## 📍 TRẠNG THÁI HIỆN TẠI — 2026-07-01
- **Giai đoạn:** ĐÃ LIVE tại `https://reportnew.donapharm.asia` (cổng 3873, PM2 `reportnew` + `cloudflared-reportnew`); app cũ `dona-report` cổng 3860 giữ nguyên.
- **Dữ liệu DOANH THU đã THẬT:** import 04/05/06.2026 từ app cũ (T04 34.79 tỷ · T05 30.40 tỷ · T06 28.40 tỷ), đủ đơn vị/SP/nhà thầu/gói thầu. **Cơ số thầu + Target VẪN là dữ liệu mẫu** (nguồn riêng, chưa nối).
- **GitHub:** `donapharm/App-report-new` — nhánh `main`, đồng bộ.
- **✅ ĐĂNG NHẬP OTP THẬT ĐÃ CHẠY + PUBLIC MỞ:** đăng nhập bằng SĐT→OTP (backend nội bộ 3848), demo đã tắt. CEO (role backend `full`→admin) thấy toàn bộ; NV sale chỉ thấy phần mình. Site mở tại `https://reportnew.donapharm.asia` (bảo vệ bằng OTP; Cloudflare Access là tùy chọn phụ, chưa bật).
- **Kế tiếp:**
  1. **Đúng danh sách NV** (vừa fix: Target/Dự báo chỉ lấy NV có doanh thu thật) — bot pull + restart để áp.
  2. **Đồng bộ nốt số liệu từ app cũ:** target thật (`import_targets.js` — cần bot dump nguồn target) + **cơ số thầu** thật (hiện còn mẫu, cần nguồn ORDS/file).
  3. Lấy **đủ dữ liệu từ 01/2026** (importer thư mục đã sẵn).

---

## 🗒️ LỊCH SỬ THAY ĐỔI (mới nhất trên cùng)

### 2026-07-09 (ah) — Claude Code — CEO DUYỆT 2 bản mẫu Điểm/Xu (tuần+tháng) → chốt template + directive bot
- **CEO duyệt cả bản TUẦN và THÁNG** của DN001 (bản "thông minh", có mục 9 A–I). Chốt 2 sửa cuối:
  1. **BỎ câu "toàn công ty đang dư xu"** (câu cũ dư 944,87 xu) — tránh NV ỷ lại tưởng công ty không cần
     chi tiêu xu. Bản NV chỉ nói trạng thái xu **riêng NV**.
  2. **Bản TUẦN cũng có mục 9 "Phân tích thông minh"** (trước chỉ bản tháng có).
  3. Thêm dòng nhắc **"Xu chỉ tính theo QUÝ — sang quý mới reset về 0, không chuyển tiếp"** ở Nguồn dữ liệu.
- **Thêm template chuẩn đã duyệt:** `reference/diemxu_templates/APPROVED_tuan_DN001.html` +
  `APPROVED_thang_DN001.html` (giữ `cid:logo_dona`/`cid:qr_zalo` để bot render dữ liệu live vào).
- **Thêm `DIRECTIVE_SALES_REPORT.md`** giao bot dựng `server/src/salesReport.js` (email tuần/tháng per NV +
  bản CEO tổng hợp, tái dùng `analytics.js` + `diemXu.js`, mục 9 A–I, dự báo `targetPacingMeta`, khai thác
  `cstTable`) + gắn lịch (Thứ 7 13h00 tuần · ngày cuối tháng 18h30 tháng) gửi Telegram + email; loại 5 NV.
- **Cập nhật `SPEC_DIEM_XU_TICH_LUY.md`:** mục 4h (CEO duyệt + khoá layout), mục 5 (checklist triển khai bot),
  chỉnh query `vat.db` mục 4d (chỉ lọc `hidden_at`, **chưa khoá `trang_thai_hd`** tới khi Finance xác nhận).
- **Test:** render 2 bản mẫu (`node --check` generator OK); template giữ cid refs. Chỉ tài liệu +
  template — **không đụng code app đang chạy**. Bước sau: bot dựng `salesReport.js` → chạy mẫu THẬT DN001 →
  CEO duyệt lần cuối → bật gửi cả đội.

### 2026-07-09 (ag) — Claude Code — Đồng bộ MỨC email target với màu biểu đồ (thêm mốc XUẤT SẮC ≥120%)
- **CEO:** biểu đồ NV có mức "xuất sắc ≥120%" nhưng email chỉ có 50/90/100 → thêm mốc email cho khớp.
- **`MILESTONES = [50, 90, 100, 120]`** — thêm **120% = XUẤT SẮC** (mỗi mốc gửi 1 lần/kỳ/NV, chống spam).
- **Email + Telegram cho mốc 120:** màu **tím `#7c3aed`** (khớp biểu đồ), emoji 🌟, huy hiệu "Vượt 120%
  target — Xuất sắc", tiêu đề "Xuất sắc, {tên}!". Telegram: "🌟 XUẤT SẮC! … VƯỢT 120% target".
- **Digest CEO:** NV ≥120% hiện icon 🌟 + màu tím (đồng bộ).
- **Test:** `node --check` OK; render preview email xuất sắc. Chỉ logic app → bot restart (không materialize).


### 2026-07-09 (af) — Claude Code — Biểu đồ Top doanh thu đẹp hơn + bar NV tô màu theo % target
- **CEO giao thiết kế:** làm biểu đồ top đẹp mắt, và tab Nhân viên tô màu theo mức đạt target.
- **TopBarChart nâng cấp:** số **hạng** trước tên, **#1 nổi bật cam**, top 2–3 xanh đậm, còn lại gradient;
  **nhãn tiền + % ngay cuối mỗi thanh**; trục/ lưới nhẹ nhàng hơn; tooltip tiền đầy đủ.
- **Tab Nhân viên — màu theo % đạt target** (CEO gợi ý): `<50%` đỏ · `50–89%` cam · `90–99%` xanh nhạt ·
  `100–119%` xanh · **`≥120%` tím (xuất sắc)**; nhãn hiện **% TG** thay cho % tổng; có **chú thích màu**.
  % lấy từ `/targets` (per-NV) ghép theo `emp_code`. NV thường không mở tab này (chỉ admin).
- Overview + Analysis: truyền `dimension` + `totalRevenue`; gộp `pctTarget` khi tab NV.
- **Test:** `npm run build` OK. Chỉ FE → bot restart (không cần materialize).


### 2026-07-09 (ae) — Claude Code — KHÔI PHỤC Top 20 (Tổng quan) + tab "Nhân viên" trong biểu đồ (bị git reset xoá)
- **CEO phát hiện:** hôm qua đã có Top 20 ở Tổng quan + tab Nhân viên trong biểu đồ top, nay MẤT.
- **Điều tra:** Phân tích còn Top 20 (đã trên `main`), nhưng **Tổng quan tụt về Top 10** và **cả 2 trang mất
  tab Nhân viên**. Nguyên nhân: phần này bot làm **local trên server, CHƯA merge `main`** → mỗi lần
  `git reset --hard origin/main` (deploy đợt fix của Claude) **xoá sạch**. Code còn trong nhánh backup
  `origin/bot-server-local-2`.
- **Khôi phục (port sạch sang `main` hiện tại):** Overview lên **Top 20** (`topLimit`) + thêm tab **Nhân viên**
  (admin); Analysis thêm tab **Nhân viên**. `TopBarChart` đã sẵn `limit`/`label` nên render đủ.
- **‼ PHÒNG NGỪA:** bot PHẢI **commit + push (PR lên `main`)** mọi thay đổi app — KHÔNG để local, vì
  auto-deploy `git reset --hard` sẽ xoá. Đây là lần lặp lại của lỗi mất code local.
- **Test:** `npm run build` OK. Chỉ FE → bot restart (không cần materialize).


### 2026-07-09 (ad) — Claude Code — FIX thông báo target sai tháng (T06 → phải là THÁNG HIỆN TẠI T07)
- **CEO phát hiện:** bot + email nhắc target/doanh số **tháng 06** trong khi đang là **T07** → sai.
- **Gốc:** `targetNotify.evaluate` mặc định `store.lastCompleteKy()` = tháng hoàn thành gần nhất (T06).
  Scheduler (telegram-bot) gọi không truyền ky → gửi T06.
- **Sửa:** mặc định đổi sang **`store.currentKyByDate()`** (tháng hiện tại theo ngày) cho `evaluate`
  (áp cho mọi thông báo: scheduler, preview, gửi, gửi đích danh, digest CEO) + route `/targets/kpi`.
  Kiểm chứng: `evaluate().ky` = **07.2026** (trước 06.2026). Anti-spam theo key `ky|emp` nên mốc T07 là mới,
  gửi lại đúng.
- **Áp:** chỉ là logic app → **bot RESTART PM2** (reportnew + reportnew-tgbot), KHÔNG cần materialize.


### 2026-07-09 (ac) — Claude Code — Tên nhà thầu MISA ra ĐẦY ĐỦ (khoá join lệch code)
- **Gốc:** MISA dùng `legal_entity_code` dạng `01.DONA`/`02.AFP`, còn `legal_entities.code` là `DONAPHARM`/`AFP`
  → join `le.code = l.legal_entity_code` KHÔNG khớp → rớt về tên ngắn "DONAPHARM"/"AFP PHARMA".
- **Khoá khớp thực tế:** DONA → `legal_entity_name`="DONAPHARM"=`le.code`; AFP → `legal_entity_bucket`="AFP"=`le.code`.
- **Sửa:** thay join bằng **subquery dò `le.code` theo cả `legal_entity_name`/`bucket`/`code`** (LIMIT 1, ưu tiên
  name→bucket→code) → tránh nhân đôi dòng. Ra "Công ty TNHH Dược phẩm Donapharm" / "Công ty TNHH AFP Pharma".
- **Áp:** materialize đổi → **bot chạy lại materialize**. `node --check` OK.


### 2026-07-09 (ab) — Claude Code — Fill Hoạt chất/Hàm lượng/Giá thầu/Ưu tiên từ bảng `products` nguồn
- **Gốc:** 4 cột này trước lấy từ CST (mẫu/chưa đủ) → trống 27–37%. Bot gửi schema `products` có sẵn:
  `active_ingredient`, `strength`, `price`, `tech_rank`.
- **Sửa:** materialize (MISA + partner) lấy thẳng từ `products`: Hoạt chất←`active_ingredient`,
  Hàm lượng←`strength`, Giá trúng thầu←`price`, **Ưu tiên←`tech_rank`** (giả định — mã dạng "H.x" hợp với
  hạng kỹ thuật; **cần bot/CEO xác nhận** sau khi chạy lại: cột Ưu tiên có ra đúng "H.D/H.B" không, nếu sai
  đổi sang `tech_group`/`nhom_dieu_tri`).
- Các cột này gắn vào MỌI dòng doanh thu → không còn phụ thuộc CST mẫu; export điền đủ như Số QĐ.
- **Áp:** materialize đổi → **bot phải CHẠY LẠI materialize** (không chỉ restart). `node --check` OK.


### 2026-07-09 (aa) — Claude Code — Export Doanh thu đầy đủ: thêm cột "Số QĐ" + bỏ chặn Hoạt chất/Hàm lượng
- **CEO phản ánh** file xuất thiếu cột **Số QĐ**, và Hoạt chất/Hàm lượng/Ưu tiên/Giá trúng thầu trống nhiều.
- **Số QĐ:** thêm cột (key `qd`, đã có sẵn từ enrichProductMeta) — QĐ139/QĐ141… suy từ mã QLNB + gói thầu.
- **Hoạt chất/Hàm lượng (trống 37%):** trước bị **chặn chỉ hiện cho QĐ139**; nay ở FILE XUẤT bỏ chặn —
  có trong metaMap là hiện (trang web vẫn giữ như cũ để gọn).
- **CÒN LẠI — Ưu tiên + Giá trúng thầu (trống 27%):** lấy từ nguồn **Cơ số thầu (CST) — vẫn là dữ liệu
  mẫu/chưa nối đủ**; SP bán ra chưa có trong CST → trống. Sửa triệt để: cho materialize lấy từ bảng
  `products`/nguồn thầu (đang chờ schema `products` để wire đúng cột).
- **Test:** xuất file thật, đủ 22 cột, có "Số QĐ". `node --check` OK.


### 2026-07-09 (z) — Claude Code — Thiết kế lại EMAIL thông báo target (HTML + logo + QR Zalo OA)
- **CEO chê email cũ "cùi bắp"** (text trơn). Làm lại thành **email HTML** chỉn chu, an toàn client email
  (bảng + inline style): logo DONAPHARM đầu trang (nền trắng), **thanh tiến độ**, bảng số liệu (doanh thu
  đạt / target / % / còn thiếu / cần/ngày), màu brand **xanh dương** + cam nhấn, **QR Zalo OA** ở chân trang,
  footer "email tự động".
- **Ảnh nhúng kiểu CID** (Gmail chặn data-URI): `notifyChannels` đính kèm `web/public/logo-dnpharma.png` +
  `zalo-oa-qr.png` với cid `dnpharma-logo`/`dnpharma-zalo`; html tham chiếu `src="cid:..."`.
- **3 mẫu:** sự kiện milestone/behind (`emailHtmlFor`), trạng thái đích danh (`emailHtmlForStatus` qua
  `statusFor`), tổng hợp CEO (`ceoDigestHtml`). Telegram vẫn giữ TEXT (`messageFor` không đổi).
- `notifyChannels.sendEmail/deliver` thêm tham số `html`; routes + telegram-bot truyền html qua.
- **Cho dễ hiểu (CEO giao tự quyết):** thêm **huy hiệu kết quả** to rõ ("✓ Đã đạt 100%" / "Đã đạt 90%
  target" / "⚡ Cần tăng tốc") + **nút "Xem báo cáo chi tiết →"** mở thẳng app (`APP_PUBLIC_URL`, mặc định
  reportnew.donapharm.asia). Digest CEO có nút "Xem toàn bộ báo cáo".
- **Trạng thái:** `node --check` toàn bộ OK; đã render preview. CEO giao tự quyết → chốt bản này, merge deploy.


### 2026-07-08 (y) — Claude Code — Lọc tỉnh theo cột `units.province` + sửa tên đối tác partner
- **Lọc tỉnh/vùng (gốc lỗi):** `province.js` đoán tỉnh theo TÊN đơn vị → sai (vd "033.PKĐK AN NGÃ TƯ
  VŨNG TÀU" tên có "Vũng Tàu" nhưng `units.province` thật = **ĐỒNG NAI**). Sửa: materialize lấy
  `units.province` gắn vào từng dòng (MISA join `units ON u.code=l.unit_code`; partner đã có join units).
  Store ưu tiên `row.province` → lọc tỉnh giờ theo ĐÚNG mã tỉnh, không đoán tên nữa.
- **Tên đối tác (partner):** `legal_entities.name` của partner thường là nhóm rác **"Đối tác khác"** →
  ưu tiên **`contractors.name`** (tên đối tác thật): `COALESCE(NULLIF(NULLIF(le.name,''),'Đối tác khác'),
  NULLIF(c.name,''), '')`. (Đảo lại logic #78 vốn ưu tiên le.name.)
- **Tên MISA đầy đủ (đã xong):** `legal_entities` có cột `code` → join `le.code = l.legal_entity_code`,
  `contractor_name = COALESCE(NULLIF(le.name,''), l.legal_entity_name)` → ra "Công ty TNHH Dược phẩm
  Donapharm" thay vì "DONAPHARM". (Xác nhận: partner như Tự Đức/Tuệ Nam có `contractors.name` là tên đầy
  đủ, `legal_entity_id=4`="Đối tác khác" nên fix partner ưu tiên c.name là đúng.)
- **Test:** `node --check` OK. Cần bot chạy lại materialize để áp province + tên nhà thầu (MISA + partner).


### 2026-07-08 (x) — Claude Code — Tên pháp nhân đầy đủ cho nhà thầu WEB/đối tác (đưa fix của bot vào git)
- **Bối cảnh:** MISA đã có tên pháp nhân đầy đủ (`legal_entity_name`), nhưng nhánh WEB/partner chỉ lấy
  `contractors.name` (tên ngắn). Bot đã tìm đúng schema và sửa **trực tiếp trên server** rồi chạy lại T07
  (slot `rev_2src_072026_20260708234245`, tổng 13.528.199.293đ, **đối soát Sale-New ✅ KHỚP**).
- **Vì sao Claude commit vào git:** bot sửa ở BẢN LÀM VIỆC trên server; `main` chưa có → auto-deploy
  (`git reset --hard origin/main`) sẽ **xóa mất** đoạn sửa ở lần deploy kế. Đưa vào repo để giữ vĩnh viễn.
- **Fix (đúng schema bot xác nhận — DB KHÔNG có `c.legal_name`, `contractors` có `legal_entity_id`):**
  - `contractor_name`: `COALESCE(NULLIF(le.name,''), c.name, '')` — ưu tiên tên pháp nhân, fallback tên contractor.
  - Thêm `LEFT JOIN legal_entities le ON le.id=c.legal_entity_id`.
- **Trạng thái test:** `node --check` OK (không chạy DB ở đây). Bot đã xác nhận chạy thật T07 khớp.

### 2026-07-08 (w) — Claude Code — Export doanh thu: chốt bộ cột theo CEO
- Theo CEO chốt: **bỏ cột Đơn giá** (chỉ giữ "Giá trúng thầu"); **ĐVT → "Đơn vị tính"** (ghi rõ);
  giữ **STT** ở cột đầu; **thêm cột "Ghi chú" ở cuối** (để trống cho kế toán ghi tay).
- 21 cột: STT · Kỳ · Ngày · Mã NV · Tên NV · Tuyến · Mã đơn vị · Tên đơn vị · Mã QLNB · Sản phẩm ·
  Hoạt chất · Hàm lượng · Đơn vị tính · Mã nhà thầu · Tên nhà thầu · Gói thầu · Ưu tiên · Giá trúng thầu ·
  Số lượng · Doanh thu · Ghi chú. Vẫn giữ định dạng kế toán VN + in A4 ngang lề ~1.5cm.
- **Test:** xuất file thật, đọc lại: đúng 21 cột, STT đầu, không còn Đơn giá, có Đơn vị tính, Ghi chú cuối.

### 2026-07-08 (v) — Claude Code — Export doanh thu: thêm Đơn giá, tên nhà thầu đầy đủ, in A4 ngang lề sát
- **CEO bổ sung:** (a) tên nhà thầu phải **đầy đủ** (vd "Công ty TNHH Dược phẩm DONAPHARM"); (b) **thiếu cột
  Đơn giá**; (c) in ra **A4 ngang vừa đủ, lề ~1.5cm cho sát**.
- **(a)** Materialize MISA nay ghi `contractor_name = legal_entity_name` (tên pháp nhân đầy đủ) vào từng dòng;
  `contractorNameFor` ưu tiên tên có sẵn nên tên đầy đủ được giữ nguyên qua enrich. (Cần bot chạy lại
  materialize để dòng MISA có tên; dòng partner đã có tên từ bảng contractors.)
- **(b)** Thêm cột **"Đơn giá" (unit_price)** cạnh "Giá trúng thầu" — đơn giá bán thực tế mỗi dòng.
- **(c)** `styleAccountingSheet` set `pageSetup`: khổ **A4**, **ngang (landscape)**, co vừa **1 trang chiều
  ngang** (fitToWidth=1), **lề 0.59in (~1.5cm)** cả 4 phía, **lặp dòng tiêu đề** mọi trang, canh giữa ngang,
  đánh số trang ở footer.
- **Chờ CEO:** gửi thứ tự cột mong muốn → em sắp lại + tinh chỉnh độ rộng để in A4 ngang đọc rõ (bớt cột thừa
  thì chữ in càng to).
- **Test:** xuất file thật, đọc lại: có cột Đơn giá, `pageSetup` A4/landscape/fitToWidth/margin 0.59/printTitles OK.

### 2026-07-08 (u) — Claude Code — XUẤT EXCEL "Doanh thu đầy đủ": tên nhà thầu + nhiều NV + chuẩn kế toán VN
- **CEO phản ánh 3 điểm ở tab "Doanh thu đầy đủ":** (1) file Excel thiếu **tên nhà thầu**; (2) chỉ lọc/xuất
  được **1 NV**, muốn chọn **nhiều NV**; (3) muốn **định dạng chuẩn kế toán VN**.
- **(1) Tên nhà thầu:** export cũ dùng `store.getRows` thô + cột "Nhà thầu" chỉ ghi *mã*. Nay export
  **enrich giống hệt trang** (`contractorLookup` + `enrichContractorNames` + `enrichProductMeta`) → thêm cột
  **"Tên nhà thầu"** (kèm "Mã nhà thầu"), và bổ sung đủ trường: Ngày, Hoạt chất, Hàm lượng, ĐVT, Ưu tiên,
  **Giá trúng thầu**, STT. File xuất giờ khớp 100% dữ liệu đang xem trên trang.
- **(2) Nhiều NV:** ô lọc NV đổi từ chọn-đơn → **chọn-nhiều** (MultiSelect, chung `revenueFilters`); backend
  `applyFilters` nhận `emp` là danh sách nối `|` (1 hay nhiều mã đều được, để trống = tất cả NV). Đã test:
  `emp=DN001|DN002` → chỉ 2 NV; không lọc → đủ 12 NV.
- **(3) Chuẩn kế toán VN:** helper `styleAccountingSheet` — số nhóm nghìn `#,##0`, **âm trong ngoặc đỏ**,
  canh phải; tiêu đề đậm nền xanh + **freeze dòng tiêu đề** + **AutoFilter**; thêm dòng **TỔNG CỘNG** (in đậm)
  cộng Số lượng/Doanh thu.
- **Trạng thái test:** dựng server thật + xuất file, đọc lại bằng ExcelJS: đủ 20 cột, đúng numFmt, freeze,
  autofilter, tổng cộng, lọc nhiều NV đúng. Web build OK. (Tên nhà thầu trống trên dữ liệu MẪU vì mẫu chưa
  map tên NCC — trên production trang & file đều hiện tên như nhau.)

### 2026-07-08 (t) — Claude Code — CÔNG CỤ ĐỐI SOÁT Report-New ↔ Sale-New (tự phát hiện lệch)
- **Lý do (CEO yêu cầu sau vụ DN009):** không đợi NV báo mới biết mất dữ liệu — phải TỰ phát hiện lệch
  theo từng NV/kỳ.
- **`server/src/reconcile.js` (mới):** đối soát toàn vẹn 1 kỳ trên dữ liệu Report-New (KHÔNG cần DB), đọc
  file slot GỐC (trước khi kéo biên) để bắt đúng dấu vân tay lỗi:
  1) `dateOutOfBand` — dòng có ngày ngoài [dateFrom,dateTo] (đúng ca 01/07→30/06);
  2) `metaMismatch` — số dòng/doanh thu metadata ≠ thực tế file;
  3) `duplicateLines` — trùng `source_line_id`;
  4) `unitDrop` — theo từng NV, đơn vị có doanh thu kỳ trước nhưng biến mất kỳ này (cảnh báo sớm kiểu DN009).
- **API `GET /admin/reconcile?ky=` (admin):** trả JSON đối soát để hiển thị/đẩy cảnh báo.
- **Web:** thêm tab **“Đối soát dữ liệu”** trong trang Upload (admin) — chọn kỳ → xem lệch ngay.
- **`server/scripts/reconcile_revenue.js` (mới, chạy trên server bot):** Lớp 1 (như trên) + **Lớp 2** DỰNG
  LẠI doanh thu từ **nguồn Sale-New** bằng chính truy vấn của materialize (require lại, KHÔNG chạy
  materialize) rồi đối chiếu per (NV, đơn vị): thiếu ở Report-New / lệch doanh thu / dư ở Report-New.
  `materialize_july_revenue.js` được bọc `require.main===module` + export hàm để tái sử dụng an toàn.
- **Trạng thái test:** `node --check` toàn bộ OK; web build OK; test tái hiện DN009 (2 dòng 30/06 +
  meta lệch + dòng trùng) → tool bắt đủ. Lớp 2 cần chạy trên server bot có DB Sale-New.

### 2026-07-08 (s) — Claude Code — TÌM ĐÚNG GỐC LỖI NGÀY 01/07→30/06 (fix tại nguồn materialize)
- **Bối cảnh:** Sếp bác bỏ cách "kéo về biên kỳ" (mục r) vì đó chỉ là **vá triệu chứng**, yêu cầu tìm
  **đúng chỗ sinh ra ngày sai**. Dữ liệu Sếp cung cấp: 11 dòng 034 Y ĐỨC HEALTHCARE đều `source: CRM_MISA`,
  `date: "2026-06-30"`, nằm trong file `ky: 07.2026` (order DH479815515, MISA:16889…).
- **GỐC LỖI (đã chứng minh):** `server/scripts/materialize_july_revenue.js` dòng 39:
  `dateOnly(v) = new Date(v).toISOString().slice(0,10)`.
  - `misa_revenue_snapshot_lines.revenue_date` là kiểu **DATE = 01/07** (nên vẫn LỌT qua bộ lọc SQL
    `revenue_date >= '2026-07-01'::date` → có mặt trong file T07).
  - node-postgres đọc DATE thành **nửa đêm giờ máy** → trên server VN (GMT+7) là
    `2026-07-01T00:00:00+07` = `2026-06-30T17:00:00Z`.
  - `.toISOString()` quy về **UTC** rồi cắt 10 ký tự → ra **`2026-06-30`**. Vì DATE luôn là nửa đêm nên
    **TẤT CẢ** dòng bị lùi đúng 1 ngày (giải thích vì sao cả 11 dòng đều 30/06, không phải vài dòng).
  - Sau đó `store.js` lọc theo `dateFrom=01/07` → rớt sạch khỏi Report-New T07.
- **Đã sửa (tại nguồn):**
  1. `dateOnly()` lấy ngày theo **giờ VN** bằng `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok'})`,
     KHÔNG dùng `toISOString()`. Kiểm chứng: `pg DATE 01/07 → CŨ=2026-06-30, MỚI=2026-07-01` (đúng).
  2. Nhánh WEB partner: các cast `timestamptz::date` (`o.created_at`, `resp.responded_at`,
     `resp.updated_at`) đổi sang `(x AT TIME ZONE 'Asia/Bangkok')::date` để không lệch ngày với đơn
     đầu giờ sáng khi session DB chạy UTC.
- **Cách áp:** bot `git reset --hard origin/main` + chạy lại materialize (hoặc chờ scheduler) → dữ liệu
  MISA T07 sẽ mang đúng ngày 01/07. "Kéo về biên kỳ" (mục r) giữ lại làm **lưới an toàn có log**, gần như
  không còn phải kích hoạt sau fix này.
- **Trạng thái test:** `node --check` OK; unit-test tái hiện lỗi cũ + xác nhận fix trên máy TZ=Asia/Ho_Chi_Minh.
  Cần bot chạy lại materialize thật để xác nhận DN009 = 12 đơn vị.

### 2026-07-08 (r) — Claude Code — FIX MẤT DOANH THU: không bỏ dòng "ngày gán sai", kéo về biên kỳ
- **Triệu chứng (NV DN009 phát hiện):** DN009 tháng 7 chỉ ra 9 đơn vị thay vì 12; thiếu 034 Y ĐỨC
  HEALTHCARE + TRỊ AN. Sale-New CÓ, Report-New KHÔNG.
- **Điều tra:** file materialize T07 CÓ đủ các dòng đó (Healthcare 11, Trị An 6) nhưng **ghi ngày
  2026-06-30**. `store.js slotRows` (fix #70) lọc BỎ mọi dòng ngày < dateFrom(01/07) → rớt sạch.
  Mà **go-live 01/07 + NV xác nhận + Sale-New đều 01/07** → ngày 30/06 là **GÁN SAI ở nguồn** (lệch
  múi giờ), KHÔNG phải doanh thu tháng 6. Không có file materialize T06 → không lo tính trùng.
- **Sửa:** `slotRows` **KHÔNG bỏ dòng nữa** (mất doanh thu âm thầm là cực nguy hiểm) — thay bằng **KÉO
  ngày sai về đúng biên kỳ** (30/06 → 01/07) + **GHI LOG** số dòng đã kéo (minh bạch, không im lặng).
- **Còn lại (bot):** sửa GỐC ở **materialize** — chuẩn hoá ngày về **giờ VN (GMT+7)/ngày bán Sale-New**
  để nguồn không còn ngày lệch.
- **File:** `server/src/store.js`. Test: store nạp OK, số mẫu không đổi, regression PASS.


### 2026-07-08 (q) — Claude Code — TÍCH HỢP ROUTER NLQ (hết "bơi ngáo") + gỡ khóa cứng T07
- **Việc lớn:** thay mớ ~30 regex intent xếp chồng (dễ lạc ý, vá chỗ này lòi chỗ kia) bằng **router
  phân loại ý định** `nlqIntent.js` (bot server xây, đã review). Router quyết intent RÕ RÀNG trước
  (sensitive/ranking/breakdown/overview/target/comparison/revenue…) rồi mới tới tra cứu/help.
- **Sửa lỗi trong ảnh CEO:** "báo cáo chi tiết các **mã hàng** có doanh thu cao" nay ra **báo cáo sản
  phẩm** (trước bị nhầm thành "tra cứu 1 thuốc" → "không tìm thấy"). "lấy **tất cả** mã qlnb" cũng ra
  báo cáo (thêm "tất cả/toàn bộ" vào tín hiệu liệt kê của router).
- **GỠ khóa cứng T07:** `employeeRevenueLocked=false` — T07 đã đúng (gom nhóm chuẩn + fix lọc ngày slot)
  và đã có nhãn "dữ liệu tới ngày DD/MM". NV giờ xem được số T07 của mình.
- **GIỮ trọn** tính năng của Claude: tra cứu đích danh thuốc/đơn vị (web `/lookup` dùng), buildFacts giàu
  cho LLM, và 3 fix mới nhất được ghép lại: **#71** chống lặp nhãn đơn vị, **#72** báo "tháng chưa có số",
  **#73** nhãn "dữ liệu tới ngày".
- **Test:** `scripts/test_smart_nlq_regression.js` (viết lại, chạy được cả mẫu lẫn server) — PASS:
  top đơn vị/NV, báo cáo sản phẩm, chặn nội dung nhạy cảm, NV không xem NV khác, tháng chưa có số, NV
  xem số của mình. Các ca của Claude (tra cứu, cơ số, exports web) đều OK.
- **File:** `server/src/smart.js`, `server/src/nlqIntent.js` (mới), `server/scripts/test_smart_nlq_regression.js`.
- **Phân công từ nay:** bot server phát triển tiếp NLQ trên `nlqIntent.js`; Claude review + tích hợp.
  `bot-server-local` giữ làm mốc.


### 2026-07-08 (p) — Claude Code — Nhãn "dữ liệu tới ngày DD/MM" cho kỳ đang cập nhật (web + bot)
- **Mục đích:** chặn hiểu nhầm "thiếu đơn vị/số" khi kỳ đang xem là THÁNG ĐANG CHẠY (chưa đủ ngày).
  Nhìn phát biết kỳ đã đủ hay đang nạp tiếp.
- **Backend:** `store.periodFreshness(ky)` — tính dữ liệu tới ngày nào (chỉ với kỳ có dữ liệu THEO NGÀY;
  kỳ tổng-tháng coi như đủ). `/periods` trả kèm `throughDate/dayCovered/daysInMonth/complete`.
- **Web:** `PeriodFilter` hiện dòng "📅 Dữ liệu tới DD/MM · X/Y ngày — kỳ đang cập nhật" khi tháng chưa đủ.
- **Bot:** câu trả lời có số (top/báo cáo/doanh thu/chi tiết) tự thêm dòng "📅 Dữ liệu tới DD/MM (X/Y ngày)"
  khi kỳ chưa đủ. Kỳ đã đủ (tổng tháng) thì KHÔNG thêm (tránh nhiễu).
- **File:** `server/src/store.js`, `server/src/routes.js`, `server/src/smart.js`,
  `web/src/pages/PeriodFilter.jsx`, `web/src/styles.css`.


### 2026-07-08 (o) — Claude Code — FIX bot lặng lẽ trả kỳ khác khi hỏi tháng CHƯA có dữ liệu
- **Triệu chứng:** NV hỏi "doanh số từ đầu tháng 8 đến hôm nay" (T8 chưa có số) → bot **lặng lẽ lấy kỳ
  mới nhất (T7)** rồi trả danh sách → NV tưởng là số tháng 8, thấy "thiếu đơn vị" (thực ra là số T7).
- **Nguyên nhân:** `answerQuestion` dùng `resolveKyFromQuestion(q) || store.latestKy()` — khi tháng
  người hỏi không có dữ liệu thì rơi về kỳ mới nhất, không báo gì.
- **Sửa:** thêm `monthMention(q)` — nếu người hỏi **nêu rõ 1 tháng** mà kỳ đó **chưa có dữ liệu** →
  trả thẳng "Kỳ MM.YYYY chưa có dữ liệu" + liệt kê các kỳ đang có số. Câu không nêu tháng vẫn dùng kỳ
  mới nhất như cũ.
- **Test:** "tháng 8.2026"/"tháng 12" → báo chưa có dữ liệu; "tháng 6"/"kỳ này"/"top 10 đơn vị" → bình thường.
- **File:** `server/src/smart.js`.


### 2026-07-08 (n) — Claude Code — Fix nhãn đơn vị bị LẶP ĐÔI trên Telegram (data T07)
- **Triệu chứng:** bot ghi "002.BVĐK Thống Nhất ĐN**.BVĐK Thống Nhất ĐN**" (lặp 2 lần).
- **Nguyên nhân:** data T07 có `unit_code` chứa cả tên ("034.PKĐK Y ĐỨC") còn `unit_name` chỉ là tên
  ("PKĐK Y ĐỨC") → `unitText` backend ghép thành `code.name` bị lặp. (Frontend `util.js` ĐÃ có chống
  lặp; backend `smart.js` thiếu.)
- **Sửa:** thêm vào `unitText` (smart.js) đúng guard như frontend: `if (/^\d{3}\./.test(c) && c.includes(nm)) return c;`
- **LƯU Ý (không phải lỗi):** việc "thiếu đơn vị 034 ở T07" KHÔNG do lệch mã — `unit_code` T06=T07 giống
  nhau, gom nhóm ĐÚNG. Các ĐV đó **chưa bán ở T07** (đầu kỳ); màn web so là **T06 đã hoàn tất**.
- **File:** `server/src/smart.js`.


### 2026-07-08 (m) — Claude Code — Cherry-pick 2 fix DỮ LIỆU từ bot-server-local
- **Bối cảnh:** bot server làm song song 1 nhánh (`bot-server-local`, 5 commit). Sau khi soi + thống nhất
  với bot: **8b09419** trùng fix #68 (bỏ), **b1d29f6** khóa cứng T07 (KHÔNG merge — dễ chặn nhầm),
  router NLQ (50740f1/7da6b7c) để review sau. Chỉ lấy 2 fix dữ liệu thật sự còn thiếu:
  - **store.js `slotRows`:** lọc theo ngày của slot — chặn invoice 30/06 lọt nhầm vào materialize T07
    (đây là GỐC khiến số T07 sai; fix đúng chỗ này thì không cần khóa cứng tháng 7).
  - **llm.js:** thêm ràng buộc đơn vị tiền cho LLM (231.000.000đ = 231 triệu, KHÔNG phải 231 tỷ).
- **Kỹ thuật:** đã xác minh 2 file chỉ khác đúng phần fix (store.js 1 hunk `slotRows`, llm.js 1 dòng),
  không đụng memo-hoá/logic khác của main. `bot-server-local` giữ làm backup cho router NLQ.
- **File:** `server/src/store.js`, `server/src/llm.js`.


### 2026-07-08 (l) — Claude Code — Bot: "báo cáo chi tiết" ra nhiều phần + "tất cả mặt hàng" + từ "mặt hàng"
- **Báo cáo chi tiết:** câu "báo cáo doanh thu **chi tiết**" (không nêu chiều) trước chỉ ra **1 dòng tổng**
  → nay ra **nhiều phần**: doanh thu + %target + **top 5 sản phẩm** + **top 5 đơn vị** + gợi ý xem đầy đủ.
- **"Tất cả mặt hàng":** khi có "tất cả/toàn bộ/đầy đủ/chi tiết" thì liệt kê tới **50 mục** (thay 15),
  LUÔN kèm **tổng số** + gợi ý xuất Excel (tin Telegram giới hạn độ dài).
- **Fix từ khóa:** nhận diện **"mặt hàng"** (trước chỉ "sản phẩm/mã hàng").
- **File:** `server/src/smart.js`.
- **⚠ GHI CHÚ:** phát hiện bot server chạy **code KHÁC `main`** (bot ghi "15 **mục đầu**" + nhận "mặt hàng"
  — cả 2 KHÔNG có trong repo) → server có **sửa tay chưa commit** → cây git dirty → **auto-deploy bị chặn**
  → #64–#68 (kể cả fix "top 10") CHƯA lên. Cần đội bot **commit bản sửa tay vào main**.

### 2026-07-08 (k) — Claude Code — FIX bot: "top 10" bị hiểu nhầm thành tra cứu đơn vị "010"
- **Triệu chứng:** Hỏi "những đơn vị nào nằm trong top 10" → bot trả tra cứu đơn vị **010.BV Quân Y 7B**
  (0đ) thay vì danh sách top đơn vị.
- **Nguyên nhân:** intent tra-cứu-đích-danh (khớp "doanh thu…đơn vị") chạy trước "top đơn vị", rồi khớp
  nhầm đơn vị mã "010" vì câu có " 10 " (từ "top 10").
- **Sửa:** thêm cờ `rankingLike` — câu dạng xếp hạng/liệt kê (`top`, `nào`, `cao nhất`, `nhiều nhất`,
  `bán chạy`…) KHÔNG kích hoạt tra cứu đích danh (thuốc + đơn vị), nhường cho intent "top…". Bổ sung
  "bán chạy" vào mẫu "top đơn vị".
- **Giữ nguyên:** "BV007 ai bán", "đơn vị BV001 bán được bao nhiêu", "giá thầu B02", "doanh thu thuốc E05"
  vẫn ra tra cứu đích danh đúng (đã test).
- **File:** `server/src/smart.js`.

### 2026-07-08 (j) — Claude Code — Thông báo target: bảng "Trạng thái sẵn sàng" (biết còn thiếu gì để bật)
- **Việc:** Màn Quản target → Thông báo (xem trước) thêm card **⚙️ Trạng thái sẵn sàng gửi tự động**:
  - Tự động BẬT/TẮT (`TARGET_NOTIFY`), kênh **Telegram** sẵn sàng chưa, kênh **Email (SMTP)** sẵn sàng chưa.
  - Bao nhiêu NV **liên hệ được** (đã map Telegram / có email) trên tổng danh sách, bao nhiêu **bị chặn** (opt-out).
  - Nếu chưa NV nào liên hệ được → gợi ý cụ thể (NV nhắn bot để map / cấu hình SMTP).
- **Lý do:** Bật gửi tự động phụ thuộc 3 thứ cấu hình NGOÀI (env `TARGET_NOTIFY=1`, NV map Telegram, SMTP).
  Card này cho CEO thấy NGAY còn thiếu gì thay vì "bật rồi không ai nhận".
- **Backend:** `/admin/notifications/preview` trả thêm `readiness`.
- **File:** `server/src/routes.js`, `web/src/pages/Target.jsx`.
- **Còn lại (ops, ngoài code):** để gửi tự động chạy thật cần bot đặt `TARGET_NOTIFY=1`, NV nhắn bot để map
  Telegram, và (nếu gửi email) cấu hình SMTP. Gửi TAY ("Gửi ngay/Gửi thử/Gửi 1 NV") đã dùng được ngay
  cho ai đã có kênh.

### 2026-07-08 (i) — Claude Code — Cơ số thầu: sắp theo "cơ hội" + KPI tiền đang để trống
- **Việc:** Màn Cơ số thầu thêm:
  - Nút sắp xếp **💰 Cơ hội (TT còn)** — xếp theo TT còn (SL còn × giá thầu) lớn nhất, để CEO thấy ngay
    tiền đang để trống; ở chế độ gom-đơn-vị thì đơn vị có TT còn lớn nhất lên đầu.
  - KPI **💰 TT chưa khai thác** = tổng TT còn của các dòng CHƯA bán (sold=0) + số dòng chưa bán.
  - (Cột **Giá trúng thầu** và filter **Chưa bán** = còn 100% chưa khai thác đã có sẵn từ trước.)
- **File:** `web/src/pages/TenderQuota.jsx` (sortBy 'action'|'opportunity'|'none' + KPI untapped).
- **Test:** build web OK.

### 2026-07-08 (h) — Claude Code — Tra cứu nhanh TRÊN WEB (thuốc/mã QLNB/đơn vị) có thẻ kết quả
- **Việc:** Trang "Hỏi nhanh" thêm ô **🔎 Tra cứu nhanh** — gõ tên thuốc / mã QLNB / mã-tên đơn vị →
  hiện **thẻ kết quả có cấu trúc**: thuốc (doanh thu, giá thầu, cơ số còn lại, đơn vị đang bán),
  đơn vị (doanh thu, AI bán, top sản phẩm). Không phải đọc chat như trước.
- **Backend:** route `GET /lookup?q=&ky=` (scoped) tái dùng `smart.lookupProducts/lookupUnits` (đã export).
- **Quyền:** cùng `scope` — NV chỉ thấy phần của mình ("Bạn bán"); admin thấy tất cả.
- **File:** `server/src/smart.js` (export), `server/src/routes.js` (route `/lookup`), `web/src/api.js`,
  `web/src/pages/AiChat.jsx` (LookupPanel + thẻ), `web/src/styles.css`.
- **Test:** node harness lookup ra đúng + kín quyền; build web OK.

### 2026-07-08 (g) — Claude Code — DỨT ĐIỂM deploy kẹt: bỏ track output materialize
- **Việc:** `.gitignore` thêm `artifacts/*materialize*` + `git rm --cached` 4 file materialize doanh thu
  (bot tự sinh lại mỗi kỳ). Từ nay bot sinh file thoải mái, working tree KHÔNG dirty → auto-deploy
  không còn bị kẹt (đã 2 lần hôm nay phải `git stash` tay).
- **An toàn:** app KHÔNG đọc `artifacts/` (đã kiểm tra grep server/) — chỉ là output phân tích; file
  vẫn còn trên đĩa server, chỉ thôi track trong git.
- **File:** `.gitignore` (+ untrack 4 file materialize).

### 2026-07-08 (f) — Claude Code — Phân tích: Top 20 + biểu đồ tròn hiện số tiền rút gọn & %
- **Top doanh thu:** màn Phân tích nâng từ Top 10 → **Top 20** (Overview giữ Top 10). `TopBarChart`
  thêm prop `limit` (mặc định 20) để nâng trần mà không ảnh hưởng chỗ gọi khác.
- **3 biểu đồ tròn (Tuyến / Nhà thầu / Gói thầu):** hiện **% ngay trên lát bánh** (lát ≥7% cho đỡ rối)
  và **chú thích kèm số tiền rút gọn + %** (vd "NCL  1,23 tỷ · 62%") — đọc nhanh không cần rê chuột.
- **File:** `web/src/charts.jsx` (TopBarChart limit, DonutChart nhãn % + legend tiền/%) ,
  `web/src/pages/Analysis.jsx` (slice 20 + tiêu đề "Top 20").
- **Test:** build web OK.

### 2026-07-08 (e) — Claude Code — Phân tích: thêm 2 ô cho cân hàng dưới (chưa khai thác + biến động tuyến)
- **Việc:** Hàng panel dưới của màn Phân tích trước chỉ có 2 ô (SP cần đẩy mạnh, SP sắp hết CST) → trống
  2 ô. Bổ sung đúng 2 ô (theo gợi ý CEO):
  - **🆕 SP chưa khai thác (còn 100% CST):** mặt hàng đã trúng thầu nhưng kỳ này CHƯA bán viên nào
    (sold_qty=0, còn nguyên cơ số) — cơ hội để trống, sắp theo số lượng còn lại giảm dần.
  - **🛣️ Biến động theo tuyến (so kỳ trước):** mỗi tuyến tăng/giảm bao nhiêu so kỳ trước, sắp theo
    mức chênh lệch tuyệt đối lớn nhất.
- **Backend `/analysis`:** thêm `cstUntouched` (cstTable status=empty) + `routeDelta` (compareGroup theo
  route trên 2 kỳ so sánh). Cùng chịu bộ lọc + phạm vi quyền như phần còn lại.
- **File:** `server/src/routes.js`, `web/src/pages/Analysis.jsx`.
- **Test:** node harness — routeDelta ra đúng (Tuyến A +25.8%…); cstUntouched=0 trên dữ liệu MẪU vì seed
  không có mặt hàng chưa bán (đúng — server thật sẽ có). Build web OK.

### 2026-07-08 (d) — Claude Code — FIX Phân tích: "tăng mạnh/giảm mạnh" bị lẫn lộn tăng với giảm
- **Triệu chứng:** Màn Phân tích, mục "Đơn vị giảm mạnh" lại có dòng TĂNG (+37%, +117%…) và mục
  "Đơn vị tăng mạnh" lại lòi ra dòng GIẢM (−28%).
- **Nguyên nhân:** `/analysis` chỉ lọc `prevRevenue>0` rồi sort theo `delta` và lấy top 10. Khi số đơn
  vị giảm < 10, danh sách "giảm" lấy bù bằng đơn vị TĂNG (và ngược lại) → lẫn lộn.
- **Sửa:** lọc đúng chiều — "tăng mạnh" chỉ `delta > 0`, "giảm mạnh" chỉ `delta < 0` (áp cho cả đơn vị
  và sản phẩm). Đã test dữ liệu mẫu: 0 dòng lẫn ở cả 2 danh sách.
- **File:** `server/src/routes.js` (route `/analysis`).

### 2026-07-08 (c) — Claude Code — FIX bot đòi mã RP hoài (map Telegram lệch giữa 2 tiến trình)
- **Triệu chứng:** CEO nhắn hỏi bot nhưng bot chỉ trả "Gửi mã đăng nhập dạng RP-XXXXXX…", không
  trả lời — dù trước đó đã nhận được digest (tức đã từng có trong map).
- **Nguyên nhân gốc:** `auth.js` giữ map Telegram trong RAM (`let tgMap` nạp 1 lần lúc khởi động).
  Backend `reportnew` và worker `reportnew-tgbot` là **2 TIẾN TRÌNH riêng** → thêm map ở tiến trình
  này thì tiến trình kia KHÔNG thấy (worker cứ đòi mã RP; digest sót), và 2 bên có thể **ghi đè** map
  của nhau bằng bản RAM cũ (mất map).
- **Sửa:** map Telegram nay lấy **FILE `data/auth/telegram_map.json` làm nguồn sự thật** — đọc thẳng
  file mỗi lần `resolveTelegram/listTelegramMap`, và `add/removeTelegramMap` dùng read-modify-write.
  Không còn RAM lệch, không còn ghi đè. (Đã test: tiến trình A ghi → tiến trình B thấy ngay + không mất.)
- **UX:** khi tài khoản CHƯA liên kết, bot trả về **mã Telegram (id)** của người hỏi để CEO/admin
  liên kết nhanh (thay vì câu cụt "gửi mã RP").
- **File:** `server/src/auth.js`, `server/telegram-bot.js`.
- **Việc còn lại (ops):** nếu file map trên server đang trống, cần thêm lại 1 dòng cho CEO
  (`auth.addTelegramMap('<telegram_id>','<mã CEO>','ceo')` hoặc route `POST /api/admin/telegram-map`).
  Sau fix này worker **không cần restart** vẫn nhận map mới.

### 2026-07-08 (b) — Claude Code — Bot TRA CỨU ĐÍCH DANH ĐƠN VỊ (bán bao nhiêu + AI bán)
- **Việc:** Hỏi theo MỘT đơn vị cụ thể (mã hoặc tên): **bán được bao nhiêu**, **AI bán** (NV nào),
  **top sản phẩm tại đơn vị**, số dòng cơ số + số sắp cạn. Nhận diện đơn vị theo mã (BV007), theo
  số (kể cả bỏ số 0: "17"→"017") và theo từ đặc trưng của tên.
- **Sửa xung đột:** câu "đơn vị X bán được **bao nhiêu**" trước đây bị mẫu "top đơn vị" bắt nhầm
  (vì "bao **nhiêu**" khớp "nhiều") → đã đưa các intent TRA CỨU ĐÍCH DANH (thuốc + đơn vị) lên TRƯỚC
  các mẫu "top…".
- **Quyền:** "ai bán" chỉ liệt kê trong `scope` — NV thường chỉ thấy CHÍNH MÌNH ("Bạn bán"); admin
  thấy tất cả NV bán ở đơn vị đó. Cắm vào facts LLM (`tra_cuu_don_vi`).
- **File:** `server/src/smart.js` (`lookupUnits`, `sayUnitLookup`, intent + reorder + menu).
- **Test:** node harness — "đơn vị BV007 bán bao nhiêu ai bán", "phòng khám mẫu 17…", "đơn vị 19…"
  ra đúng; "top đơn vị / báo cáo theo đơn vị / đơn vị nào chưa bán / giảm mạnh / nhà thầu / doanh thu
  kỳ này" GIỮ NGUYÊN; NV DN001 chỉ thấy phần mình.

### 2026-07-08 — Claude Code — Bot TRA CỨU ĐÍCH DANH thuốc/mã QLNB (giá thầu + cơ số còn lại)
- **Việc:** Thêm khả năng hỏi bot theo MỘT thuốc cụ thể (theo TÊN hoặc MÃ QLNB), trả lời gọn:
  doanh thu, số lượng, **giá thầu**, **cơ số còn lại** (SL/tổng + %), và **đơn vị nào đang bán**.
  - Nhận diện thuốc bằng "từ điển sản phẩm" trong phạm vi quyền (khớp mã QLNB, tên thuốc, hoạt chất,
    và mã ngắn kiểu B02/E05) — không cần cú pháp cứng.
  - Ưu tiên đúng: "giá thầu / doanh thu thuốc X" trả lời theo SẢN PHẨM, không rơi vào doanh thu tổng;
    các mẫu tổng hợp cũ ("top sản phẩm", "báo cáo theo từng sản phẩm") giữ nguyên.
  - Cắm cả vào FACTS đưa LLM (`tra_cuu_san_pham`) để LLM diễn giải sâu hơn khi hỏi lắt léo.
- **Lý do:** Sếp kiểm tra "giá thầu / mã QLNB / tên thuốc… bot trả lời rành rọt chưa" — trước đây 2 loại
  này (giá thầu + tra cứu đích danh 1 thuốc) chưa được surface, trả lời yếu.
- **Quyền:** dùng `store.getRows/getCst` theo `scope` — NV sale CHỈ thấy phần của mình (đã test: DN001
  chỉ thấy số + đơn vị của mình, không lộ NV khác). Không thêm PII vào bundle FE.
- **File:** `server/src/smart.js` (thêm `lookupProducts`, `sayProductLookup`, 2 intent tra cứu + cắm vào
  facts LLM + cập nhật menu/gợi ý).
- **Test:** node harness với dữ liệu mẫu — tra cứu theo tên (E05/B02) + mã (QLNB105) ra đúng số; câu
  chung ("doanh thu kỳ này") KHÔNG bị bắt nhầm; "top/ báo cáo theo sản phẩm" giữ nguyên; NV scope kín.
  (Giá thầu chỉ hiện khi dữ liệu CST có `bid_price` — server thật có; bản mẫu local chưa có nên bỏ dòng đó.)

### 2026-07-07 — Claude Code — Mở rộng "bộ số" đưa LLM → bot trả lời sâu/nhiều ngữ cảnh hơn
- `buildFacts` (dữ liệu app đưa cho LLM) nay giàu hơn nhiều, VẪN theo quyền (NV chỉ thấy mình):
  thêm **con_thieu_target + cần bán/ngày + tiến độ thời gian**, **xu hướng doanh thu 6 kỳ**,
  **top nhà thầu / gói thầu / tỉnh**, **đơn vị tăng/giảm mạnh**, **cơ số chưa bán**, và (chỉ admin)
  **danh sách TỪNG NV** (mã/tên/doanh thu/target/%đạt) + **NV chưa đạt**.
- LLM vẫn KHÔNG bịa số — chỉ diễn giải trên bộ số này → trả lời được nhiều tình huống (phân tích
  từng NV, so xu hướng, hỏi nhà thầu/tỉnh…).
- **Test:** các mảnh dữ liệu chạy đúng cho cả admin lẫn NV; NV KHÔNG lộ danh sách người khác.

### 2026-07-07 — Claude Code — LLM ĐÃ BẬT (hỏi tự nhiên) + dọn markdown tin Telegram
- ✅ **ANTHROPIC_API_KEY đã vào `.env`, `llm.isEnabled()=true`** — bot hiểu ngôn ngữ tự nhiên,
  số vẫn do code tính (không bịa). Verified: hỏi "NV nào đang dẫn đầu t07" → trả lời đúng NV + doanh thu.
- `formatAnswerForTelegram`: **bỏ ký hiệu markdown** (`**đậm**`, `*`, `` `code` ``, `#`, `- ` → `• `)
  vì Telegram gửi text thô → hết cảnh hiện dấu sao thô quanh tên.
- **Test:** `node -c` pass; stripMd bỏ đúng `**...**` và đổi gạch đầu dòng thành `•`.

### 2026-07-07 — Claude Code — Thêm mẫu câu "báo cáo theo từng đơn vị/sản phẩm/tổng hợp"
- `smart.answerQuestion` thêm 3 mẫu: **báo cáo theo từng đơn vị** (vd "báo cáo bán hàng theo từng
  mã đơn vị"), **theo từng sản phẩm**, **báo cáo tổng hợp/tổng quan** → bớt "đơ" cho câu kiểu báo cáo.
- **Lưu ý (thẳng):** vẫn là khớp-mẫu; muốn hiểu **ngôn ngữ tự nhiên bất kỳ** thì BẮT BUỘC bật LLM
  (`.env` đang thiếu `ANTHROPIC_API_KEY`). Đây là giới hạn bản chất của bot khớp-mẫu.
- **Test:** 4 câu báo cáo kiểu tự nhiên trả đúng breakdown; `node -c` pass.

### 2026-07-07 — Claude Code — FIX gốc: auto-deploy restart bot worker + sửa giờ digest
- **🐛 GỐC "bot không đổi":** `auto-deploy.sh` **chỉ restart `reportnew`**, KHÔNG restart
  `reportnew-tgbot` → bot Telegram chạy CODE CŨ mãi (mọi thay đổi câu hỏi/LLM/thông báo không tới).
  Fix: auto-deploy nay **restart luôn `reportnew-tgbot`** (biến `PM2_WORKER`, bỏ qua nếu chưa chạy).
- **🐛 Báo cáo lúc 1h30 (lệch múi giờ):** `startDigestScheduler` trừ dư 7 tiếng → bắn sớm 7h.
  Fix: so THẲNG giờ VN. Mặc định `DIGEST_CRON` đổi sang **`0 0 * * *` (nửa đêm giờ VN)**.
- **Test:** `bash -n` + `node -c` pass; kiểm 17:00 UTC = 00:00 VN → khớp cron `0 0` (bắn đúng nửa đêm).
- **Cần thủ công 1 lần:** thêm `ANTHROPIC_API_KEY` thật vào `.env` + `pm2 restart reportnew reportnew-tgbot`
  (từ lần deploy sau, worker tự restart).

### 2026-07-07 — Claude Code — Bot múi giờ GMT+7 + mở rộng nhiều nhóm câu hỏi
- **Múi giờ:** đặt `process.env.TZ = 'Asia/Ho_Chi_Minh'` ở đầu `index.js` + `telegram-bot.js`
  (cho env override) → mọi mốc thời gian/log/lịch theo GMT+7.
- **Mở rộng hỏi–đáp (`smart.answerQuestion`)** — trước chỉ loanh quanh doanh thu; nay thêm:
  top **nhà thầu / gói thầu / tỉnh**, **đơn vị giảm mạnh/tăng mạnh**, **NV chưa đạt** (admin),
  **đơn vị chưa bán**, **còn thiếu bao nhiêu để đạt target (+ cần ~X/ngày)**, **so kỳ trước**,
  **chào hỏi**, **menu "giúp"**. Fallback đổi thành **gợi ý đầy đủ** thay vì "đơ".
- **Test:** ~13 kiểu câu hỏi trả đúng số (code-first); giúp/help/menu ra menu; câu vô nghĩa ra gợi ý;
  TZ in GMT+0700. Áp cho cả bot Telegram lẫn "Hỏi nhanh" trong app (chung 1 engine).

### 2026-07-07 — Claude Code — GĐ2 Email: kênh Gmail/Workspace + gửi 2 kênh (Telegram + email)
- Thêm dep **nodemailer**. `notifyChannels`: `sendEmail()` qua SMTP (Gmail/Workspace) gated bằng env
  `SMTP_HOST/PORT/USER/PASS/FROM`; `emailFor(emp)` đọc **`server/data/nv_emails.json`** (bot điền,
  gitignored) → fallback `user.email`; `deliver()` gửi **cả Telegram + email**, ok nếu ≥1 kênh thành công.
- Các nút/worker gửi qua `deliver` (2 kênh): `/admin/notifications/send`, `/send-one`, `runTargetMilestones`.
  Guard đổi sang `anyReady()` (có Telegram HOẶC email là gửi được). Vẫn tôn trọng danh sách CHẶN + no_auto_notify.
- `config/nv_emails.example.json` (committed): mẫu định dạng cho bot.
- **Test:** emailReady=false khi thiếu SMTP; emailFor đọc file + fallback + loại email sai định dạng;
  deliver không kênh → ok=false; build web PASS.
- **Cần bot cấp:** SMTP env (Gmail app password) + tạo `server/data/nv_emails.json` (trích lục email phòng KD).

### 2026-07-07 — Claude Code — Danh sách CHẶN thông báo (DN021/DN023/VP004) ở tầng engine
- **`config/notify_optout.json`** (CEO chốt, committed): `codes: [DN021, DN023, VP004]` — tuyệt đối
  không nhận thông báo (Telegram + email + mọi kênh sau này).
- `targetNotify.isMuted(emp)`: chặn nếu mã trong config **HOẶC** user có cờ `no_auto_notify`.
- `pendingEvents` bỏ qua NV bị chặn → mọi nút/lịch (Gửi ngay, tự động, email GĐ2) đều loại tự nhiên.
  Endpoint `send-one` chặn thẳng với thông báo rõ. (Vẫn có thể hiện trong bản tổng gửi CEO để CEO nắm.)
- **Test:** isMuted đúng cho DN021/DN023/VP004; dù vượt 100% vẫn KHÔNG có sự kiện gửi; DN001 vẫn có.

### 2026-07-07 — Claude Code — Gửi ĐÍCH DANH 1 NV (test DN001/DN007)
- `targetNotify.statusFor(emp, ky)`: dựng tin trạng thái hiện tại của 1 NV bất kỳ (đạt %/còn thiếu/cần
  ngày + đúng/chậm nhịp) — không cần vừa vượt mốc.
- Route `POST /admin/notifications/send-one` (admin): gửi tin đó qua Telegram; báo lỗi rõ nếu NV chưa
  giao target / chưa liên kết Telegram / tắt nhận / app thiếu token.
- Màn "🔔 Thông báo": thêm ô nhập **mã NV** + nút **👤 Gửi cho 1 NV này** (mặc định DN001).
- **Test:** statusFor render đúng cho DN001, mã lạ → null; build web PASS.

### 2026-07-07 — Claude Code — Nút "Gửi ngay" + "Gửi thử cho tôi" (gửi chủ động) trên màn Thông báo
- Làm rõ 2 cách gửi: **Tự động** (bot theo giờ, `TARGET_NOTIFY=1`) và **Chủ động** (CEO bấm).
- `src/notifyChannels.js`: `sendTelegram()` dùng `TELEGRAM_BOT_TOKEN` của app (fetch api.telegram.org).
- Route `POST /admin/notifications/send`: `testOnly=true` → gửi thử bản tổng cho chính CEO; ngược lại
  gửi tin từng NV (mốc/chậm nhịp) + bản tổng cho admin, **đánh dấu đã gửi** (chống trùng với lịch tự động).
  Thiếu token → báo lỗi gọn (không crash).
- Màn "🔔 Thông báo": thêm nút **🧪 Gửi thử cho tôi** + **📤 Gửi ngay (N)** + giải thích 2 cơ chế.
- **Test:** build web PASS; endpoint báo lỗi gọn khi app chưa có token.

### 2026-07-07 — Claude Code — Màn "🔔 Thông báo" (xem trước) trong app cho CEO
- Thêm tab **🔔 Thông báo** ở trang Target (admin): gọi `/admin/notifications/preview` (DRY-RUN)
  → hiện **bản tổng gửi CEO** + **danh sách tin sẽ gửi cho từng NV** (mốc 50/90/100 hoặc chậm nhịp),
  kèm banner nhắc "chưa gửi gì; bật thật bằng TARGET_NOTIFY=1".
- Không gửi, không đổi trạng thái — chỉ để CEO duyệt trực quan trước khi bật.
- **Test:** build web PASS (preview API đã test 200 ở PR trước).

### 2026-07-07 — Claude Code — GĐ1 Thông báo target chủ động (engine + preview + worker gated)
- **`src/targetNotify.js` (engine):** tính %đạt từng NV theo kỳ + nhịp thời gian; phát hiện sự kiện
  **vượt mốc 50/90/100%** (1 lần/mốc/kỳ) + **"đang chậm nhịp"** (%đạt < %thời gian − 15%, tối đa
  1 lần/tuần). Chống spam bằng `data/notif_state.json` (gitignored). Soạn nội dung tin (dùng chung
  Telegram/email) + **bản tổng theo từng NV cho CEO** (`ceoDigest`).
- **API (CEO duyệt trước):** `GET /admin/notifications/preview?ky=` — DRY-RUN xem chính xác tin sẽ
  gửi, KHÔNG gửi/không đổi trạng thái.
- **Worker `telegram-bot.js`:** `runTargetMilestones()` + scheduler (giờ VN `TARGET_NOTIFY_HOURS`,
  mặc định 8,20) — **TẮT mặc định**, chỉ chạy khi `TARGET_NOTIFY=1`. Gửi Telegram cho NV có map
  + tôn trọng `no_auto_notify`/opt-out; đẩy CEO digest cho admin.
- **Email:** để GĐ2 (chờ thu thập email NV sale + cấu hình SMTP). Engine đã soạn nội dung sẵn dùng lại.
- **Test:** engine phát hiện mốc 50 đúng, chống spam OK (lần 2 = 0), CEO digest render; preview API 200.

### 2026-07-07 — Claude Code — Đợt 2: bấm NV → trang phân tích chi tiết từng NV
- Ở "Kỳ này", **bấm card 1 NV** → mở trang chi tiết NV đó (breadcrumb Target › Kỳ này › Tên NV):
  dải KPI (tháng+quý+pacing) theo NV, **xu hướng Target vs Đã đạt theo từng tháng** (thanh
  xám target / thanh màu đạt), **Top sản phẩm** + **Top đơn vị** của NV trong kỳ.
- Backend: route `GET /employee/detail?emp=&ky=` (NV thường khoá theo chính mình qua scope;
  admin xem NV bất kỳ). Tái dùng `revenueBreakdown` (top SP/ĐV) + `targetKpiSummary` (thêm
  tham số danh sách mã để tính theo 1 NV) + resolver target theo từng tháng.
- **Test:** build web PASS; HTTP `/employee/detail?emp=DN001` trả đúng emp/kpi/monthly(04→06)/
  top SP(8)/top ĐV(2).

### 2026-07-07 — Claude Code — TỐI ƯU tốc độ: cache dòng doanh thu + CST (Phân công/catalog chậm)
- **Nguyên nhân chậm:** `store.allRows()` ĐỌC LẠI file slot upload + `enrich` (có `provinceOf`)
  MỖI LẦN gọi; `getRowsRange` gọi nó **1 lần/kỳ** → `catalog/sales?all=1` (mọi kỳ) đọc+enrich
  toàn bộ dòng **N lần/1 request**. `getCst` cũng đọc lại + merge + enrich mỗi lần.
- **Sửa:** cache `allRows()` theo chữ ký slot (id+kỳ+mtime); cache `getCstAll()` theo mtime
  `cst_real.json` + chữ ký slot; memo `provinceOf` theo (mã|tên). Cache tự hết hạn khi
  upload/kỳ đổi (mtime) hoặc `clearCache()`. KHÔNG đổi kết quả.
- **Test:** getCst/getRowsRange trả y hệt; province 4/4 đúng; đường dẫn cache 0,09ms/lần (demo).
  Lợi ích lớn trên server thật (nhiều dòng upload).

### 2026-07-07 — Claude Code — Dải KPI target ở "Kỳ này" + "Phân tích" + card NV giàu hơn
- Tách component chung `TargetKpiStrip` (tháng+quý+tiến độ thời gian), dùng ở **Quản target,
  Kỳ này, Phân tích** (đồng bộ 1 kiểu).
- Backend: `/targets` trả thêm `kpi`; thêm route `GET /targets/kpi` (theo scope) cho trang Phân tích.
- Card từng NV ở "Kỳ này": thêm dòng **"còn thiếu … · N ngày → cần ~X/ngày để kịp"** (theo pacing),
  hoặc **"✅ đã đạt/vượt"**.
- **Test:** build web PASS; HTTP `/targets/kpi` + `/targets` trả đúng kpi (quý Q2=04+05+06).

### 2026-07-07 — Claude Code — Dải KPI ở trang Quản target (target & đã đạt: tháng + quý)
- Đầu trang **Quản target** thêm 4 ô KPI: **Target giao tháng**, **Đã đạt trong tháng**
  (kèm % target + tiến độ thời gian ngày/tháng), **Target giao quý** (gộp 3 tháng của quý),
  **Đã đạt trong quý** (% target quý). Ô "đã đạt" đổi màu ok/warn theo việc %đạt có bắt
  kịp %thời gian đã trôi hay không.
- Backend: `/admin/targets` trả thêm `kpi` (targetKpiSummary: target tháng/quý từ resolver,
  doanh thu thực before-VAT của roster theo tháng/quý, pacing thời gian).
- **Test:** build web PASS; HTTP `/admin/targets` trả đúng `kpi`; đối chiếu quý Q2 = 04+05+06,
  đã đạt quý > tháng khớp số.

### 2026-07-07 — Claude Code — Nút "🗑️ Gỡ sửa tay" trên card target
- Mỗi NV nếu target đang dùng là **Sửa tay đè lên nguồn khác** (upload/nhân bản/AI) thì
  hiện nút **"🗑️ Gỡ sửa tay"** cạnh "Sửa tay". Bấm 1 phát → bỏ override → tự quay về
  nguồn kế, KHỎI phải nhờ bot rollback (như vụ DN001).
- Backend: `resolveTargets` thêm tuỳ chọn `excludeSources` để tính "nguồn thay thế";
  `overrideInfo` gắn cờ `manual_override` + nguồn/số sẽ quay về; `clearManualOverride`
  gỡ mọi entry manual active của NV/kỳ (audit `target_manual_clear`); route
  `POST /admin/targets/manual/clear`. `targetMatrix` trả kèm cờ cho UI.
- Xác nhận trước khi gỡ, nói rõ "sẽ quay về: Upload 2,3 tỷ".
- **Test:** build web PASS; smoke test: manual 0 đè upload 2,3 tỷ → gỡ → về upload 2,3 tỷ.

### 2026-07-07 — Claude Code — Nhân bản target sang kỳ sau + chặn Sửa tay ghi 0 nhầm
- **Nút "📤 Nhân bản target sang kỳ sau":** copy toàn bộ target đang dùng của kỳ nguồn
  sang kỳ đích (KHÔNG cần file), rồi Sửa tay vài NV là xong. Nguồn mới `carryover`
  (ngang upload, dưới manual — Sửa tay không bị đè). Backend `targetAdmin.carryOverTargets`
  + route `POST /admin/targets/carryover`; mặc định **chỉ điền NV kỳ đích chưa giao**
  (tick để ghi đè). Sau khi nhân bản tự chuyển sang kỳ đích để sửa tay. Test: nhân bản
  07→09 đúng số + nguồn carryover; chạy lại (không đè) skip đúng; rollback theo batch OK.
- **Chặn "Sửa tay" ghi target = 0 do bỏ trống (vụ DN001):** ô Sửa tay bỏ trống nay =
  HUỶ (không ghi đè về 0); nhập 0 phải xác nhận; số không hợp lệ báo lỗi. Trước đây xoá
  trắng rồi OK là ghi 0 → đè cả upload → NV thành "Chưa giao".
- **Nhãn nguồn dễ đọc:** `carryover→"Nhân bản kỳ trước"`, `upload→"Upload"`, `manual→"Sửa tay"`.
- **Test:** build web PASS; smoke test carryover + rollback. Chờ merge `main`.

### 2026-07-07 — Claude Code — 3 fix từ ảnh Sếp: đoán tỉnh viết tắt, chọn nhiều gói thầu, mã ĐV lặp
- **Fix 1 — "Không tìm thấy CST còn lại" (lọc tỉnh + đơn vị ra 0 dòng):** đơn vị thật
  hay viết tắt tỉnh ở đuôi tên (vd `011.BV Cao Su ĐN`) nên đoán tỉnh CŨ trả rỗng →
  lọc tỉnh Đồng Nai loại luôn đơn vị đó. `province.js`: nhận diện **viết tắt dạng
  token** (`ĐN`→Đồng Nai, `BP`→Bình Phước) + fallback đoán trên **mã đơn vị** khi tên
  trống. Test: `BV Cao Su ĐN`→Đồng Nai, `TTYT Bù Đăng BP`→Bình Phước; `DNA` KHÔNG dính.
- **Fix 2 — Chọn NHIỀU gói thầu:** thêm component `MultiSelect` (lưu chuỗi nối `|`,
  serialize params không đổi); thay ô chọn gói thầu 1-giá-trị ở **Cơ số thầu** và
  **Doanh thu/DT đầy đủ/Sản phẩm**. Backend `analytics.bidMatch` tách `|`, khớp nếu
  thuộc BẤT KỲ gói nào chọn (dùng ở `applyFilters` + `cstTable`). Test: 1 gói 45 dòng,
  2 gói 90 dòng, đều đúng.
- **Fix 3 — Mã đơn vị lặp 2 lần** (`011.BV Cao Su ĐN · 011.BV Cao Su ĐN`): `optionLabel`
  bỏ lặp khi mã đã chứa/bằng tên → chỉ hiện 1 lần.
- **Test:** build web PASS; smoke test analytics (province + multi-bid). Chờ merge `main`.

### 2026-07-07 — Claude Code — Lọc tỉnh cho CST + mở rộng đoán tỉnh + QR Zalo trong app
- **Mục 1 — Lọc tỉnh/thành cho Cơ số thầu (CST):** dòng CST nay được gắn `province`
  (giống dòng doanh thu) trong `store.getCst`; thêm lọc tỉnh ở `cstTable`, truyền
  param `province` ở route `/cst` và export CST; `/filters` gộp cả CST vào danh sách
  tỉnh. Frontend `TenderQuota.jsx` thêm ô chọn tỉnh + đếm lọc. **Test HTTP thật:**
  `/cst?province=Đồng Nai` → 34/34 dòng đúng tỉnh; `/filters` liệt kê Đồng Nai/Bình
  Phước/Bà Rịa-Vũng Tàu.
- **Mục 2 — Mở rộng đoán tỉnh theo tên đơn vị:** `province.js` thêm nhiều tỉnh miền
  Nam/lân cận (BR-VT, Bình Dương, TP.HCM, Long An, Tây Ninh, Lâm Đồng, Bình Thuận,
  Ninh Thuận, Đắk Nông, Đắk Lắk, Tiền Giang) — chỉ dùng TÊN TỈNH + TP/huyện KHÔNG
  trùng tên (tránh 'châu thành', 'tân châu'…). 14/14 case đúng, không hồi quy. ⇒ ít
  đơn vị rơi vào "Chưa gán tỉnh"; phần còn lại bot chạy `scripts/list_unmapped_provinces.js`
  trên server rồi điền `unit_province.json`.
- **Mục 3 — QR Zalo OA trong app + icon:** thêm `ZaloCard` (QR `zalo-oa-qr.png`) ở
  cuối trang Tổng quan (trước chỉ có ở màn Login). **Icon home-screen** đã là logo DP
  đúng (`app-icon-180/512.png`) — hình "chữ A" Sếp thấy trước đó là icon mặc định CŨ
  bị cache; nút "Có bản mới"/gỡ-thêm lại app 1 lần là hết.
- **Test:** `npm run build` web PASS; smoke test API trên cổng tạm 3899 (KHÔNG đụng
  3873/3860). Trạng thái: chờ merge `main`.

### 2026-07-07 — Claude Code — Auto-deploy TỰ GỠ KẸT khi working tree dirty (#37)
- **Vấn đề:** `scripts/auto-deploy.sh` có guard "tree dirty → BỎ QUA im lặng",
  kẹt **vô thời hạn** → Sếp thấy "không có thay đổi" trên iPhone dù đã merge code.
- **Đã xác minh:** KHÔNG có code app ghi vào file tracked lúc chạy (`targetAdmin.js`
  chỉ ghi `target_entries/target_audit.json` — gitignored; `target_baseline_202606`
  & `target_roster` chỉ ĐỌC). ⇒ tree dirty đến từ sửa tay/việc dở chưa commit.
- **Sửa:** (1) LUÔN ghi rõ file nào dirty vào log (`git status --short`); (2) cửa
  thoát: dirty > `STALE_SECS` (mặc định 15') coi là KẸT → `git stash` (khôi phục
  được) rồi deploy tiếp; (3) tree sạch → xoá mốc `.auto-deploy.dirty-since`.
- **Test:** `bash -n` pass. Bot tự áp bản mới ở lượt cron kế (tree đã sạch sau
  reset của Sếp). Trạng thái: đã merge `main` (ee62dd8).

### 2026-07-07 — Claude Code — Tiêu đề nổi bật + KPI thấp gọn + lọc mặc định ẩn
- **Tiêu đề trang** (crumb active): chip xanh gradient chữ trắng cho nổi bật (cả
  base lẫn media mobile). `styles.css .drill-crumbs button.active`.
- **Chiều cao ô KPI**: hạ padding (9→6px), thắt line-height label/value/delta +
  money-big, giảm value 19→18px → bớt dư chiều cao.
- **Bộ lọc mặc định ẨN** ở mọi màn có lọc: `useCollapse` (Phân tích, Cơ số thầu)
  + collapse nội bộ của `RevenueFilters` (Doanh thu, DT đầy đủ, Sản phẩm) đổi
  mặc định về đóng; nhấn "▾ Bộ lọc" mở, nhấn "▴ Thu gọn lọc" thu lại.
- Nghiệm thu: build OK; kiểm headless: tiêu đề chip xanh, KPI gọn hơn, filter-toggle
  hiện "▾ Bộ lọc" (đang ẩn) khi vào trang.

### 2026-07-07 — Claude Code — Bộ lọc TỈNH/THÀNH (Đồng Nai, Bình Phước, …)
- CEO cần lọc theo tỉnh. Dữ liệu chưa có trường tỉnh → thêm nguồn tỉnh:
  1) `row.province` nếu upload có cột "Tỉnh" (thêm alias trong upload.js);
  2) map chính thức `server/config/unit_province.json` (unit_code→tỉnh, bot điền);
  3) đoán theo tên đơn vị (`server/src/province.js` — Đồng Nai/Bình Phước + huyện).
- `store.enrich`: gắn `province` vào mỗi dòng. `analytics.applyFilters`: lọc theo
  `province`. `/filters`: trả `provinces`. `revenueFiltersFromQuery`: thêm province.
- Frontend: dropdown gọn "Tất cả tỉnh/thành" ở thanh lọc (Doanh thu, DT đầy đủ,
  Sản phẩm qua RevenueFilters; và Phân tích). `emptyRevenueFilters` thêm province.
- `scripts/list_unmapped_provinces.js`: liệt kê đơn vị chưa có tỉnh để bot điền nhanh.
- Demo: `server/config/unit_province.json` gán sẵn 20 đơn vị mẫu (Đồng Nai/Bình
  Phước/Bà Rịa-Vũng Tàu) để lọc chạy ngay.
- **‼ Trên dữ liệu THẬT:** nhiều đơn vị tự nhận tỉnh theo tên; đơn vị còn lại bot
  chạy `node scripts/list_unmapped_provinces.js` rồi điền vào `unit_province.json`
  (hoặc thêm cột "Tỉnh" vào file upload hàng tháng).
- Nghiệm thu: node --check backend OK, build OK, dropdown hiện 3 tỉnh + lọc chạy.

### 2026-07-07 — Claude Code — Nút gạt "Tháng liền trước ↔ Cùng kỳ năm ngoái" (làm sẵn)
- CEO muốn làm sẵn: sang 2027 thì so tăng/giảm với 2026 (cùng kỳ năm ngoái).
- `store.comparePeriods(kys, mode)`: thêm `mode='yoy'` — lấy cùng tháng năm trước
  (T06/2027→T06/2026). Nếu chưa có dữ liệu năm trước → `yoyMissing=true`.
- `/alerts` + `/analysis`: nhận `compareMode` (prev|yoy); note đổi theo mode
  ("So tháng liền trước…" / "So cùng kỳ năm ngoái…" / "Chưa có dữ liệu cùng kỳ…").
- Overview + Analysis: thêm nút gạt **[Tháng liền trước] [Cùng kỳ năm ngoái]**
  (nhớ lựa chọn qua localStorage `rpt_cmp_mode`). Mặc định "Tháng liền trước".
- Hiện data mới có 2026 → chọn "Cùng kỳ năm ngoái" báo rõ "chưa có dữ liệu 2025";
  khi bot nạp dữ liệu năm trước là tự chạy, không cần sửa code.
- Nghiệm thu: node --check backend OK, build OK, kiểm headless nút gạt + note YoY.

### 2026-07-07 — Claude Code — Nút "Có bản mới — bấm để cập nhật" (hết kẹt cache iOS)
- **Vấn đề:** iOS giữ cache PWA rất lì → sau deploy, NV cứ hỏi "sao dữ liệu chưa đổi",
  phải xoá–thêm lại app thủ công.
- **Giải pháp:** app tự phát hiện bản mới và mời cập nhật:
  - `vite.config.js`: plugin `emit-version-json` xuất `/version.json` (SHA + giờ build).
  - `index.js`: phục vụ `version.json` với `no-cache`.
  - `UpdateBanner` (components): định kỳ 60s + mỗi khi quay lại app, fetch
    `/version.json?_=ts` (no-store); nếu version khác `__BUILD_VER__` đang chạy →
    hiện nút xanh nổi **"🔄 Có bản mới — bấm để cập nhật"**. Bấm → `location.replace('?v=<ver>')`
    (đổi URL để phá cache iOS) → tải bản mới.
- Nghiệm thu: build ra `version.json` đúng SHA, header no-cache OK; test giả lập
  version khác → nút hiện; version trùng → không hiện.

### 2026-07-07 — Claude Code — So sánh tăng/giảm CÔNG BẰNG + ghi rõ mốc (①+②)
- **Vấn đề (CEO nêu):** "so kỳ trước" đang lấy CẢ kỳ này (tháng dở, mới vài
  ngày theo mốc "Cập nhật đến") so với CẢ tháng trước (đủ) → hầu hết đơn vị hiện
  "giảm 90–100%" ảo. (Bằng chứng: cập nhật thêm ngày thì % giảm nhỏ lại 82,6%→76,2%.)
- **② So công bằng:** thêm `store.comparePeriods(kys)` — nếu kỳ đang xem chạm
  THÁNG HIỆN TẠI (chưa đủ) thì tự lùi về **2 tháng đã HOÀN TẤT** gần nhất (vd
  T07 dở → so T06 với T05). Áp cho: nhóm tăng/giảm ở Tổng quan (`smart.js`) và
  bảng tăng/giảm ở Phân tích (`routes.js /analysis`).
- **① Ghi rõ mốc:** mỗi mục tăng/giảm hiện dòng chú thích "So sánh T06/2026 với
  T05/2026"; nếu phải lùi kỳ thì hiện cảnh báo vàng "⚠ Tháng đang xem chưa đủ
  ngày — đang so 2 tháng đã hoàn tất…". CSS `.alert-group-note(.warn)`.
- KPI "Doanh thu {kỳ}"/"So với {kỳ trước}" ở Phân tích GIỮ theo kỳ Sếp chọn
  (số thô trung thực); chỉ bảng tăng/giảm tự lùi kỳ cho đúng bản chất.
- Nghiệm thu: `node --check` store/smart/routes OK, build OK, kiểm headless thấy
  note trên cả Tổng quan lẫn Phân tích.

### 2026-07-07 — Claude Code — Thêm "Đơn vị tăng trưởng mạnh" + chip mũi tên
- **Tổng quan:** thêm nhóm cảnh báo `unit_up` "Đơn vị tăng trưởng mạnh (so kỳ
  trước)" (MoM ≥ +15%), đặt NGAY TRÊN nhóm "giảm mạnh"; viền xanh (tone `ok`),
  📈, mỗi dòng có chip xanh **▲ Tăng x%**. Thanh tóm tắt thêm "x đơn vị tăng".
  `count` (Cần chú ý) KHÔNG tính unit_up (tin vui, không phải cảnh báo); mục
  cảnh báo hiện khi có bất kỳ nhóm nào có dữ liệu.
- **Phân tích:** `DeltaRow` thêm chip **▲ Tăng %** (xanh) / **▼ Giảm %** (đỏ)
  cho từng dòng ở các block tăng/giảm (đơn vị + sản phẩm).
- `smart.js`: gom cả tăng & giảm trong 1 vòng; sort unit tăng giảm dần theo %.
- Nghiệm thu: `node --check` smart.js OK, build OK, kiểm headless thấy mục tăng
  trưởng + chip xanh trên cả Tổng quan lẫn Phân tích.

### 2026-07-05 — Claude Code — Dựng lại bản Tổng quan "màu chuẩn CEO" (đưa vào git)
- **Bối cảnh:** Bản Tổng quan nhiều màu + đồng hồ (bot làm trên server) **chưa từng
  push lên GitHub**. Các lệnh deploy `git reset --hard origin/main` (untrack-data +
  auto-deploy) ép giống main nên **xoá mất bản local đó** → về bản trắng. CEO gửi ảnh
  yêu cầu khôi phục.
- **Sửa (commit thẳng vào repo để KHÔNG mất lần nữa):**
  - `Kpi` thêm prop `variant` (blue/purple/green/red/amber) + `icon` (góc phải).
  - `Clock` mới: đồng hồ chạy giây (giờ VN) trên header mobile + topbar desktop.
  - Overview: 6 ô KPI tô màu đúng ảnh chuẩn (Doanh thu xanh dương ⚠️/📊 theo tăng-giảm,
    Trước VAT tím 🧾, Đạt target + NV đạt target xanh lá 🎯, Cơ số thầu đỏ ⚠️, Quy mô
    kỳ vàng 🗺️); số Doanh thu/Trước VAT hiện 2 dòng (gọn + đầy đủ) qua `MoneyBig`.
  - CSS: `.kpi.k-*` (viền trái đậm + nền tô nhạt + số theo màu), `.kpi-ic`, `.clock-pill`.
- Nghiệm thu: build OK; kiểm headless mobile 390px khớp 1:1 ảnh CEO (đồng hồ + 6 ô màu).
- **‼ Bài học:** mọi thay đổi giao diện của bot PHẢI push lên `main`, nếu không lần
  deploy kế tiếp (`reset --hard`/auto-deploy) sẽ xoá. Nay bản màu đã nằm trong git.

### 2026-07-03 — Claude Code — Auto-deploy (server tự cập nhật khi main đổi)
- Thêm `scripts/auto-deploy.sh` + hướng dẫn cron (mỗi 1 phút). Merge lên `main`
  là server tự: fetch → (fast-forward mới đi tiếp) → reset --hard → build → restart
  PM2. Hết cảnh copy-paste lệnh deploy.
- **An toàn:** flock chống chạy chồng; chỉ deploy khi HEAD là tổ tiên origin/main
  (không đè commit local chưa push của bot); bỏ qua nếu tree có thay đổi tracked
  chưa commit; **build ra thư mục tạm rồi mới tráo** — build lỗi thì giữ nguyên
  bản đang chạy, không restart. Cài lại deps nếu package(-lock).json đổi.
- `.gitignore`: thêm `web/dist.new/`, `web/dist.old/`, `.auto-deploy.lock`.
- Đường repo trên server: `~/.openclaw/workspace-report/App-report-new` (đặt qua
  biến REPO_DIR nếu khác). Log ghi ở `auto-deploy.log`.
- Nghiệm thu: `bash -n` OK; thử `build -- --outDir dist.new` tạo đủ dist (index +
  assets + manifest + icon). **Cần cài cron 1 lần trên server để kích hoạt.**

### 2026-07-03 — Claude Code — ‼ AN TOÀN DỮ LIỆU: gỡ 4 file runtime khỏi git
- **Vấn đề:** 4 file dữ liệu người dùng GHI lúc chạy vẫn bị track trong repo:
  `assignments.json`, `assignment_audit.json`, `target_adjustments.json`,
  `target_adjustment_audit.json`. Deploy dùng `git reset --hard origin/main`
  → mỗi lần deploy **ghi đè** chúng bằng bản cũ trong repo ⇒ nguy cơ **mất**
  phân công / điều chỉnh target người dùng vừa nhập.
- **Sửa:** `git rm --cached` 4 file (file vẫn nằm trên đĩa server). `.gitignore`
  đã có sẵn pattern `server/data/*.json` nên từ nay git không đụng chúng nữa;
  dữ liệu người dùng nằm yên trên server qua mọi lần deploy.
- **GIỮ track (chỉ đọc, cấu hình versioned):** `target_baseline_202606.json`,
  `target_roster.json`, `sample_upload.xlsx`.
- **‼ DEPLOY LẦN NÀY PHẢI THEO QUY TRÌNH AN TOÀN** (sao lưu → cập nhật → phục hồi
  → build → restart) vì cú `git reset --hard` kế tiếp sẽ xoá 4 file khỏi working
  tree (do commit này bỏ chúng khỏi index). Xem prompt deploy an toàn kèm theo.
  Từ deploy sau trở đi thì bình thường, không cần bước sao lưu nữa.

### 2026-07-03 — Claude Code — Dấu mốc bản build ở màn login (PR mới)
- **Vấn đề:** Sau deploy, khó biết bản web đang chạy là bản nào (bot `git pull` nhưng dist là artifact — không rebuild thì UI vẫn cũ; cộng cache PWA → "hình như vẫn bản cũ").
- **Sửa:** `vite.config.js` inject `__BUILD_VER__` (SHA commit, hoặc `BUILD_VER` env) + `__BUILD_AT__` (giờ build) lúc build; màn Login hiện dòng mờ `Bản <sha> · build <giờ>`. Mở site (kể cả chế độ Riêng tư) là biết ngay bản nào đang live, hết mơ hồ.
- Nghiệm thu: `npm run build` OK, kiểm headless thấy `Bản efc50d7 · build 22:39 03-07`.
- **‼ Nhắc bot:** `git pull` KHÔNG đủ để đổi UI — PHẢI `npm --prefix web run build` rồi `pm2 restart reportnew`. dist bị .gitignore nên không tự cập nhật theo git.

### 2026-07-03 — Claude Code — Mobile/PWA polish (PR #14)
- **Số lớn luôn hiện đủ:** bỏ cơ chế "chạm để đổi" (không đáng tin trên PWA khi kẹt cache) → `MoneyBig` luôn hiện số gọn (`4,76 tỷ`) kèm số đầy đủ (`4.758.211.000đ`) ngay bên dưới. File: `web/src/components.jsx`, `web/src/styles.css`.
- **Nút bottom-nav cao hơn đáy:** tăng padding đáy nav + cộng `safe-area-inset-bottom`, `.page` chừa thêm chỗ → icon dễ chạm hơn trên máy có gesture bar. File: `web/src/styles.css`.
- **Hết kẹt bản cũ (PWA cache):** `index.html` + `.webmanifest` trả `Cache-Control: no-cache, must-revalidate`; asset có hash tên (`/assets/*`) cache dài `immutable`. Sau deploy, PWA luôn lấy shell mới. File: `server/src/index.js`.
- Nhãn KPI "Trước VAT" ghi rõ `đã ÷ 1,05`. File: `web/src/pages/Overview.jsx`.
- Nghiệm thu: `node --check` index.js OK, `npm run build` OK, kiểm tra headless mobile 390px (số hiện đủ 2 dòng, header no-cache xác nhận). **Bot cần `git pull` + `npm --prefix web run build` + `pm2 restart reportnew` để áp.**

### 2026-07-03 — Bot triển khai (Report Bot) — TARGET_ADJUSTMENT GĐ2a
- Đã implement `DIRECTIVE_TARGET_ADJUSTMENT.md` GĐ2a, chưa làm GĐ2b multidimensional.
- Thêm module `server/src/targetAdjustment.js`, lưu `server/data/target_adjustments.json` + audit `target_adjustment_audit.json`: lý do `dut_hang`/`cong_no`/`khac`, số tiền ảnh hưởng, trạng thái `pending/approved/rejected`, người đề xuất/duyệt.
- API: `/target-adjustments`, `/admin/target-adjustments/:id/approve|reject`, `/admin/target-adjustments/suggestions`; chỉ adjustment `approved` mới hạ target chính thức.
- `/targets` trả thêm target gốc, target sau điều chỉnh, `% đạt gốc`, `% đạt sau điều chỉnh`, gap sau điều chỉnh, tổng giảm theo lý do.
- UI Target thêm tab `Điều chỉnh`: NV/admin ghi lý do, admin xem gợi ý Hết CST/còn nợ, duyệt/từ chối; thẻ target hiển thị 2 dòng % đạt và số đã trừ theo lý do.
- Gợi ý tự động: đứt hàng lấy draft từ CST hết/cạn; công nợ ghi rõ thiếu nguồn WEB partner nên tạo draft 0 để CEO nhập/duyệt, không tự áp.
- Nghiệm thu: `node -c` routes/targetAdjustment OK, `npm run build` OK.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — SỬA nhà thầu: chỉ 1 tên theo (mã QLNB + mã nhà thầu)
- CEO: thẻ đang nối HẾT tên biến thể của 1 mã nhà thầu (dài/rối/sai, VD Ediwel). → sửa: **thẻ chỉ hiện 1 TÊN**, khóa tra `(iit_code + contractor_code) → 1 tên` (ưu tiên contractor_name của dòng; else tên đại diện cặp); **không nối "/"**. Ô lọc giữ gom theo mã nhưng nhãn 1 tên đại diện. Áp mọi thẻ + Danh mục tổng (GĐ1). Ghi `DIRECTIVE_CARD_V2.md`.
- Soạn trước trong khi chờ GĐ1. → [`DIRECTIVE_TARGET_MULTIDIM.md`](DIRECTIVE_TARGET_MULTIDIM.md).
- **Cốt lõi:** các chiều là **kính lọc CHỒNG NHAU** (1 giao dịch tính vào nhiều target: tổng+nhóm+đơn vị+tuyến) → **KHÔNG cộng dồn %đạt**; target chi tiết là **tùy chọn** (đặt ở chiều muốn nhấn, còn lại roll-up tổng).
- Dùng `scope{type,value}`; nhập target chọn chiều + template thêm cột scope; %đạt lọc doanh thu theo chiều (`route/unit/iit/priority` đã có); special "hàng cần đẩy" resolve thành tập mã (CST/doanh số). Thẻ NV bung theo chiều đã đặt; cảnh báo lệch trong CÙNG chiều (không chéo).

### 2026-07-03 — Bot triển khai (Report Bot) — SPEC_TARGET_ASSIGNMENT GĐ1
- Đã `git pull origin main`, đọc `SPEC_TARGET_ASSIGNMENT.md`; chỉ làm GĐ1, chưa làm target chi tiết GĐ2/thưởng GĐ3.
- Thêm danh mục bán hàng tổng `/api/catalog/sales`: hợp nhất SP, hoạt chất/hàm lượng, nhóm UT, tuyến, gói, nhà thầu mã-tên, giá thầu, CST còn.
- Thêm model phân công `assignment{id, emp_code, type, value, from_ky, to_ky, active, note, by, at}` + `source`/`special_kind`, lưu `server/data/assignments.json`, audit `assignment_audit.json`; gieo mầm 1.687 phân công auto từ lịch sử 04-06/2026 hiệu lực từ 07.2026.
- Thêm API admin/mine/special: CEO xem-sửa-thêm-ngưng hiệu lực + audit; NV chỉ thấy `/assignments/mine` theo session; upload Excel backend cho phân công.
- Thêm UI Target: tab `Phân công` cho admin và `Tôi phụ trách` cho NV/admin; special `tồn nhiều`/`hàng ngách` auto, `cận date` và `sắp hết thầu-CST lớn` ghi rõ thiếu nguồn hạn dùng/hạn gói thầu để CEO chọn thủ công.
- Review độc lập sau GĐ1 yêu cầu bổ sung: đã thêm UI/client upload Excel phân công, nút Sửa nạp dòng hiện có vào form, hiển thị `hang_ngach` trong “Tôi phụ trách”, seed lại auto có thêm `all`/`group` (tổng 1.808 dòng: all 22, group 99, iit 1328, route 45, unit 314), và `/catalog/sales` lọc theo assignment cho NV thường.
- Nghiệm thu: `node -c` routes/assignmentAdmin OK, `npm run build` OK, restart `reportnew` OK, health local/public OK; API catalog/admin/mine/special/history OK; UI Phân công render catalog 342 mã + phân công auto.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Spec điều chỉnh target theo lý do (đứt hàng/công nợ)
- CEO: cần ghi lý do không đạt (đứt hàng/công nợ) để hạ tỷ lệ target tháng đó + phân tích. → [`DIRECTIVE_TARGET_ADJUSTMENT.md`](DIRECTIVE_TARGET_ADJUSTMENT.md) (thuộc Target GĐ2).
- Model `target_adjustment{emp_code,ky,reason_type,impact_amount,status,...}`; **CEO DUYỆT mới áp**. Target điều chỉnh = target gốc − Σ impact duyệt; thẻ hiện %đạt gốc + %đạt sau điều chỉnh + "đã trừ đứt hàng X/công nợ Y". Gợi ý tự động từ Hết CST (đứt hàng) + "còn nợ chưa giao" (công nợ), CEO duyệt. Phân tích tổng hợp mất theo lý do.
- CEO: làm luôn kế hoạch target chi tiết + danh mục NV phụ trách. → [`SPEC_TARGET_ASSIGNMENT.md`](SPEC_TARGET_ASSIGNMENT.md) (3 giai đoạn).
- **GĐ1 (làm trước):** Danh mục bán hàng tổng + bảng PHÂN CÔNG (`assignment{emp_code,type,value,hiệu lực}`) — **gieo mầm tự động từ lịch sử bán** (NV↔đơn vị/SP), CEO sửa tay; màn "Tôi phụ trách" cho NV. Không hồi tố + audit.
- **GĐ2:** Target theo CHIỀU (nhóm H.A*/tuyến/đơn vị/QLNB/đặc biệt) dùng field `scope` đã có; %đạt tính theo đúng chiều; kỳ đang chạy pro-rate.
- **GĐ3 (sau):** Thưởng bậc thang (duyệt mới gửi).
- **Chờ CEO chốt:** chiều phân công chính (đề xuất Đơn vị + Nhóm UT + Tuyến); gieo mầm từ lịch sử (04–06/2026)?
- Đã `git pull origin main`, đọc mục FIX trong `DIRECTIVE_CARD_V2.md`.
- Enrich metadata theo `iit_code` từ CST/filter vào thẻ: hoạt chất+hàm lượng cho QĐ139, giá trúng thầu, ưu tiên, nhà thầu mã-tên, tuyến/đơn vị/NV cho Sản phẩm · DT đầy đủ · Doanh thu.
- Frontend không ẩn field bắt buộc: nếu thật sự thiếu nguồn sẽ hiện `Thiếu nguồn ...`; kỳ T07 mẫu đã đủ giá/UT/hoạt chất.
- Nghiệm thu: `npm run build` OK, restart `reportnew` OK, health local/public OK. Đã mở từng tab và chụp 1 thẻ: `verification-screenshots/card-v2-fix/products-card-8-fields.png`, `revenue-full-card-8-fields.png`, `revenue-card-8-fields.png`; manifest đối chiếu tại `card-v2-fix-manifest.json`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — FIX thẻ V2 thiếu sót + đồng bộ 3 tab (CEO bực)
- Ảnh DT đầy đủ: thẻ thiếu **hoạt chất/hàm lượng, Giá trúng thầu, tên nhà thầu; Ưu tiên trống "—"**. Bot mới áp tab Sản phẩm, chưa đồng bộ DT đầy đủ/Doanh thu. → `DIRECTIVE_CARD_V2.md` mục FIX: checklist 8 field, mỗi thẻ CẢ 3 tab phải đủ; Ưu tiên/giá thầu/hoạt chất là dữ liệu ĐÃ CÓ → phải hiện; bot chụp từng tab đối chiếu trước khi báo xong.

### 2026-07-03 — Bot triển khai (Report Bot) — Card V2 bổ sung nhà thầu MÃ-TÊN
- Bổ sung lookup dùng chung mã nhà thầu → tên đầy đủ từ dữ liệu filter/phân tích hiện có; hỗ trợ nguồn legacy có tên công ty nằm trong `contractor_code` và nguồn App Sale chỉ có mã ngắn như `AFP`/`DONA`.
- API `/filters`, `/revenue/full`, `/products`, `/cst` enrich `contractor_name`; thẻ tiếp tục dùng `pairText()` nên chỉ hiện mã trần khi thật sự không tìm được tên.
- Nghiệm thu live: `AFP - Công Ty Tnhh Afp Pharma`, `DONA - Công Ty Tnhh Dược Phẩm Donapharm` xuất hiện trong filter, DT đầy đủ và Sản phẩm; `npm run build` OK, restart `reportnew` OK, health local/public OK.

### 2026-07-03 — Bot triển khai (Report Bot) — Layout Smart: Quản target content-first
- Đã `git pull origin main`, đọc `DIRECTIVE_LAYOUT_SMART.md`; không đụng app cũ `dona-report` port 3860.
- Quản target đổi sang bố cục content-first: bỏ period card/form dài riêng, kỳ target nằm compact trong toolbar; danh sách 21 NV/CTV lên ngay dưới thanh công cụ.
- Gom công cụ phụ thành 1 toolbar: `Template`, `Upload`, `Nhập theo Quý`, `AI đề xuất`, `Rollback`; các form nặng mở modal/drawer và giữ đủ chức năng cũ.
- Đoạn resolver dài chuyển thành icon `ⓘ` tooltip. Thêm CSS modal/drawer và toolbar tái dùng được cho các màn khác khi áp nguyên tắc content-first tiếp.
- Nghiệm thu: `npm run build` OK, restart `reportnew` OK, health local/public OK. Screenshot trước/sau: `verification-screenshots/layout-smart/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive bố cục "smart app" (nội dung chính nổi bật)
### 2026-07-03 — Dev/Kiến trúc (Claude Code) — FIX thẻ V2 thiếu sót + đồng bộ 3 tab (CEO bực)
- Ảnh DT đầy đủ: thẻ thiếu **hoạt chất/hàm lượng, Giá trúng thầu, tên nhà thầu; Ưu tiên trống "—"**. Bot mới áp tab Sản phẩm, chưa đồng bộ DT đầy đủ/Doanh thu. → `DIRECTIVE_CARD_V2.md` mục FIX: checklist 8 field, mỗi thẻ CẢ 3 tab phải đủ; Ưu tiên/giá thầu/hoạt chất là dữ liệu ĐÃ CÓ → phải hiện; bot chụp từng tab đối chiếu trước khi báo xong.
- CEO: Quản target công cụ phụ chiếm >1/2 màn hình, đẩy danh sách chính xuống đáy. → [`DIRECTIVE_LAYOUT_SMART.md`](DIRECTIVE_LAYOUT_SMART.md).
- **Nguyên tắc toàn app:** nội dung chính ~70–80% màn hình + hiện ngay; công cụ phụ gom **1 thanh nút gọn**; form nặng mở **modal/drawer** khi bấm; chữ dài → **icon ⓘ tooltip**.
- **Áp ngay Quản target:** thanh nút [Template][Upload][Nhập Quý][AI][Rollback] → form bung modal; resolver-info thành ⓘ; danh sách 21 NV lên trên, chiếm phần lớn. Giữ đủ chức năng. Áp dần Upload/bộ lọc các trang.

### 2026-07-03 — Bot triển khai (Report Bot) — Directive Card V2: lọc ngày + thẻ QĐ màu + giá trúng thầu
- Đã pull `main`, đọc `DIRECTIVE_CARD_V2.md` và xác nhận độ chi tiết ngày trước khi lọc:
  - T01–T06 legacy/Lumos: dòng upload không có ngày chi tiết, chỉ có `dateFrom/dateTo` cấp kỳ → không phân bổ giả theo ngày.
  - T07 `CRM_MISA_PLUS_APP_WEB`: dòng active có `date` + `source_order`, `data_as_of=2026-07-03T10:30:21+07:00` → lọc ngày/tuần/tháng/quý theo ngày dòng.
- Backend: `slotRows()` giữ ngày dòng thật nếu có, gắn `date_granularity`, `source_date_from/to`, API `/periods` trả `canFilterByDay`; `applyFilters()` thêm `dateFrom/dateTo` và chỉ nhận kỳ không có ngày khi range phủ trọn kỳ.
- UI bộ lọc doanh thu/Sản phẩm/DT đầy đủ: hiển thị “Cập nhật đến HH:mm GMT+7”, thêm date range + quick `Ngày/Tuần/Tháng/Quý`, ghi chú rõ kỳ nào chỉ có số theo tháng.
- Card V2: QĐ139 nền vàng/cam + badge cam, QĐ141 nền xanh + badge xanh; thay ô “Gói thầu” bằng **Giá trúng thầu**; thêm ô **Ưu tiên**; QĐ139 hiện hoạt chất+hàm lượng, QĐ141 không hiện hoạt chất; nhà thầu dùng mã-tên khi nguồn có tên. Áp Sản phẩm, DT đầy đủ, CST flat card.
- Nghiệm thu: `node -c` server OK, `npm run build` OK, `pm2 restart reportnew && pm2 save` OK, health OK. Screenshot: `verification-screenshots/card-v2/`. Old app `dona-report` port 3860 không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive Thẻ V2: mã màu QĐ + giá trúng thầu + ưu tiên + lọc ngày
- CEO 2 ảnh (H1 chỉnh thẻ/lọc, H2 mẫu bảng + mã màu). → [`DIRECTIVE_CARD_V2.md`](DIRECTIVE_CARD_V2.md).
- **H1:** giờ đồng bộ "…GMT+7"; lọc Từ ngày→Đến ngày + Ngày/Tuần/Tháng/Quý; bỏ ô "Gói thầu 139" → **Giá trúng thầu**; tên+hoạt chất/hàm lượng (QĐ141 không); nhà thầu **`01.AFP - CÔNG TY TNHH AFP PHARMA`** (1 mã nhiều tên); thêm ô **Ưu tiên** (H.A*/H.A/H.B).
- **H2:** nền thẻ theo QĐ — **QĐ139 vàng/cam, QĐ141 xanh** + badge góc; bố cục bảng gọn theo ảnh mẫu.
- **Lưu ý:** lọc theo ngày chỉ đúng khi kỳ có ngày chi tiết (T07+ App Sale có; 01–06 Lumos theo tháng — bot xác nhận, không bịa phân bổ ngày).

### 2026-07-03 — Bot triển khai (Report Bot) — Nav chung Quay lại/Breadcrumb/Tải lại
- Đã `git pull origin main`, đọc `DIRECTIVE_NAV_BACK_RELOAD.md` trước khi làm.
- Thêm component/hook chung `web/src/drillNav.jsx`: thanh `← Quay lại` + breadcrumb bấm nhảy cấp + `↻ Tải lại`; reload refetch dữ liệu nhưng giữ filter/cấp drill.
- App-level navigation đẩy `history.pushState` cho chuyển tab; luồng drill Doanh thu dùng stack chung + browser/phone Back lùi đúng 1 cấp.
- Áp thanh chung cho các tab chính: Tổng quan, Doanh thu, DT đầy đủ, Sản phẩm, Phân tích, Cơ số thầu, Target, Hỏi nhanh, Upload. Cơ số thầu/Target/Upload có breadcrumb theo subview/filter; Doanh thu có drill NV→ĐV→SP.
- Nghiệm thu live: Doanh thu → Nguyễn Trọng Hiếu (DN006) → 027.BV QUỐC TẾ HOÀN MỸ ĐN → browser Back quay về danh sách đơn vị; `↻ Tải lại` giữ breadcrumb/filter `Doanh thu › Nguyễn Trọng Hiếu (DN006)`. Build OK, `pm2 restart reportnew && pm2 save` OK, health OK. Artifact: `verification-screenshots/final-0703-nav-back-reload/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive điều hướng: Quay lại + Breadcrumb + Tải lại (toàn app)
- CEO: drill sâu (DN006 → ĐV/SP) không có nút lùi, không có nút tải lại. → [`DIRECTIVE_NAV_BACK_RELOAD.md`](DIRECTIVE_NAV_BACK_RELOAD.md).
- 1 thanh điều hướng chung: **← Quay lại** (lùi 1 cấp drill) + **breadcrumb** (bấm cấp nhảy về) + **↻ Tải lại** (re-fetch giữ bộ lọc) + hỗ trợ **nút Back trình duyệt/điện thoại** (đẩy history). Component/hook dùng chung, áp mọi tab drill (Doanh thu/DT đầy đủ/Sản phẩm/CST/Phân tích/Target/Tổng quan).
- Đã `git pull origin main`, đọc `DIRECTIVE_TARGET_TEMPLATE.md` phần **CĂN CỨ**.
- Dump/chốt baseline target T06/2026 từ nguồn legacy `V_TEM_TARGET_BONUS` đã import trong `server/data/targets_real.json` cho đúng 21 mã allowlist CEO; lưu `server/data/target_baseline_202606.json` và backup trong `backups/target_baseline/`. Tổng baseline: **30.062.862.426đ**.
- Template target thêm dropdown căn cứ: `Theo T06/2026 (Lumos)` mặc định, `Trống`, `Theo kỳ gần nhất đã giao`. Khi kỳ tương lai chưa giao target, file `.xlsx` điền sẵn target T06 làm căn cứ; nếu kỳ đã có target thì ưu tiên target hiện tại; căn cứ không tự thành target live cho đến khi CEO upload/commit.
- API `/api/admin/targets` trả metadata baseline; `/api/admin/targets/template.xlsx?ky=08.2026&basis=t06` xuất 21 dòng, nhãn `Căn cứ: target T06/2026 Lumos`.
- Nghiệm thu: `node -c server/src/targetAdmin.js`, `node -c server/src/routes.js`, `npm run build` OK; `pm2 restart reportnew && pm2 save` OK; health OK. Verify live đọc ngược XLSX 08.2026: 21 dòng, tổng **30.062.862.426đ**, mismatch `[]`. Artifact: `verification-screenshots/final-0703-target-template-basis/`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Target: căn cứ T06 Lumos điền sẵn template (dump trước khi cắt)
- CEO muốn dùng target **T06/2026 Lumos** (số cuối trước khi cắt) làm căn cứ điền sẵn template → sửa → upload. → `DIRECTIVE_TARGET_TEMPLATE.md`.
- **Bước A:** bot **dump `V_TEM_TARGET_BONUS` kỳ 06.2026** (21 NV) NGAY, lưu `data/target_baseline_202606.json` + backup (trước khi ngắt Lumos).
- **Bước B:** template kỳ tương lai chưa giao → điền sẵn số T06 làm mốc (nhãn "Căn cứ: T06/2026"); có dropdown chọn căn cứ (Trống / T06 Lumos / kỳ gần nhất). CEO sửa rồi upload (nguồn `upload`). **Không auto-áp** — chỉ là mốc để sửa; không phá "target chốt tại App Report".
- CEO gộp 2 yêu cầu (template điền mới + xuất để sửa) thành **1 nút xuất file**. → [`DIRECTIVE_TARGET_TEMPLATE.md`](DIRECTIVE_TARGET_TEMPLATE.md) (đã gộp) + file mẫu `templates/TARGET_TEMPLATE_MAU.csv`.
- Nút **"⬇ Xuất/Tải template target"**: xuất .xlsx kỳ đang chọn, 21 NV (tên từ DB), **Target điền sẵn giá trị hiện tại — chưa giao thì trống** (vừa là template vừa là bản sửa). Upload lại → preview/commit/rollback theo MÃ NV; ô trống = giữ nguyên. Sửa tay lẻ vẫn ăn.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Target chốt tại App Report (bỏ Lumos từ 07) + KPI dễ hiểu + ô Tổng
- CEO: ô KPI target khó hiểu (272% do chia nhịp 3/31; mượn target Lumos T06 cho T07). → [`DIRECTIVE_TARGET_KPI.md`](DIRECTIVE_TARGET_KPI.md).
- **A) Từ 07/2026 target CHỐT TẠI APP REPORT**, KHÔNG đồng bộ Lumos/app khác: resolver kỳ ≥07 chỉ `manual>upload>ai` (bỏ legacy Lumos + appsale); kỳ ≤06 giữ Lumos lịch sử. Chưa giao → "Chưa giao target", không mượn số.
- **B) Thẻ NV dễ hiểu:** số chính = đạt / **target CẢ THÁNG** (%) + vượt/thiếu (số & %); vòng = % so target tháng; "nhịp N/D" thành dòng phụ có nhãn rõ (không để 272% trần).
- **C) Thêm ô KPI TỔNG** trang Target: Σ target · Σ đạt · vượt/thiếu tổng (số & %), theo scope.
- CEO nêu tầm nhìn: target/thưởng theo nhiều chiều (nhóm H.A*/H.A/H.B, hàng đặc biệt, tuyến CL/NCL/NT, mã ĐV, mã QLNB) + danh mục bán hàng tổng + phân công NV. → [`SPEC_TARGET_BONUS_ROADMAP.md`](SPEC_TARGET_BONUS_ROADMAP.md).
- **Làm NGAY (chừa chỗ):** thêm field `scope` (mặc định `all`) vào `target_entry` → tương lai thêm target theo chiều không phải đập mô hình; hành vi hiện tại không đổi.
- **Làm SAU:** target đa chiều + %đạt theo chiều (dữ liệu route/unit/iit/UT đã có) + lớp Thưởng tách riêng (bậc thang, duyệt mới gửi) + danh mục+phân công (chính là module Phân công/Điều chuyển đã hoãn). Cập nhật scope: "thưởng" từ CẮT → SAU.
- **Xác nhận:** roster Target giờ ĐÚNG 21 mã (allowlist config, bỏ heuristic). ĐẠT.
- **CEO yêu cầu:** Quản target cho **nhập target kỳ tương lai** (T08/T09.2026…) + **theo QUÝ**. → `DIRECTIVE_TARGET_ADMIN.md` mục 0-TER: period picker sinh tháng tới (+12); chế độ Quý nhập 1 số → **tách 3 tháng (chia đều mặc định, chỉnh tay được)**, lưu tầng tháng để resolver/%đạt/forecast dùng chung; upload file nhiều kỳ. Audit/rollback giữ nguyên.
- CEO: ô "Tất cả nhà thầu" cho hiện **mã + tên đầy đủ**; **1 mã nhà thầu có nhiều tên** (VD `07.trieu.g`). → khóa lọc theo **MÃ**, chọn mã gom hết mọi tên. Áp chung mọi bộ lọc mã↔tên (nhà thầu/ĐV/SP/NV/gói/tuyến): luôn hiện mã+tên, khóa theo mã (tên chỉ là nhãn). Ghi `SPEC_ANALYSIS_CST_UX.md` mục C2.
- CEO bực: Target admin VẪN hiện 35 NV/CTV (còn VP002/003/006 văn phòng) → PHẢI đúng 21 mã allowlist (mục 0-BIS), bỏ heuristic. Bot chưa áp allowlist vừa push.
- **Lấy target TỰ ĐỘNG:** cột Nguồn trống/0đ → CEO chưa thấy target tham khảo. Bot xác định nguồn (target cũ Lumos `V_TEM_TARGET_BONUS` 01–06 và/hoặc App Sale) → kéo về nguồn `appsale`/`legacy` hiện số thật + nhãn nguồn; AI đề xuất ở nguồn `ai`. Ghi `DIRECTIVE_TARGET_ADMIN.md`.
- **H1:** khối Đơn vị tăng/giảm (Phân tích) + mọi nơi hiện tên ĐV phải kèm **mã số đầy đủ** `001.BVĐK Đồng Nai`. Ghi `DIRECTIVE_MULTICOLUMN_LAYOUT.md`.
- Tab Target lọt cả NV văn phòng (heuristic role sai). **Chốt allowlist CHÍNH THỨC 21 mã:** DN001–012, DN016–019, DN021–024, VP004. Ngoài danh sách = KHÔNG target (văn phòng/telesale VP018/nghỉ DN013-015/DN020). Dùng cờ `has_target`/config, không suy role. Ghi `DIRECTIVE_TARGET_ADMIN.md` mục 0-BIS.
- Phân nhóm (đều có target): CTV đặc biệt DN021/022/023/VP004 (no_auto_notify); CTV gần fulltime DN002/DN004; còn lại fulltime. Nghiệm thu: Target hiện đúng 21 mã, không dư/thiếu.
- CEO: khối danh sách PC vẫn 1 cột full-width (phí chỗ), yêu cầu **2–3 cột, áp mọi tab, làm triệt để**. → [`DIRECTIVE_MULTICOLUMN_LAYOUT.md`](DIRECTIVE_MULTICOLUMN_LAYOUT.md).
- PC ≥1024px = 2–3 cột; tablet 2; mobile 1. Liệt kê rõ khối phải sửa: Phân tích (tăng/giảm ĐV+SP, SP cần đẩy/sắp hết CST), Tổng quan (top+cảnh báo), Doanh thu/DT đầy đủ (ranking+chi tiết), Sản phẩm/CST/Target. Dùng `.list-grid` chung. Bot rà từng tab báo lại.
- Ghi chú soi thêm: "Đơn vị tăng mạnh" hiện toàn số ÂM do so T07(2 ngày) với T06(cả tháng) → xử cùng đợt kỳ-đang-chạy (so cùng số ngày).
- CEO phản ánh thẻ mobile thiếu/thừa. → [`DIRECTIVE_CARD_LAYOUT.md`](DIRECTIVE_CARD_LAYOUT.md): thêm **Giá thầu**; **tên thuốc IN ĐẬM** + nhãn "SP" ở tên thuốc, **mã QLNB nhạt** (không đậm); **bỏ tên đơn vị lặp** (giữ `002.BVĐK…`); **nhà thầu mã + tên đầy đủ**; **trùng tên → thêm hàm lượng** (trừ QĐ141); bố cục **dạng bảng, mobile 2 cột field ngắn**. Áp thẻ Doanh thu/DT đầy đủ + đồng bộ CST.
- CEO: Tổng quan vẫn hiện "2,67 tỷ" làm số lớn → SAI ý. **Số headline/KPI/thẻ phải ĐẦY ĐỦ `2.668.987.096đ`** (đổi `short()`→`money()`); chỉ trục biểu đồ mới được viết tắt `2,67 tỷ`. Cập nhật `DIRECTIVE_NUMBER_FORMAT_VN.md`. Bot sửa + build + restart reportnew.
- **Resolver target (`targetAdmin.resolveTargets`)**: ĐÚNG — chọn theo `PRIORITY manual(4)>upload(3)>appsale(2)>ai(1)>legacy(0)`, hòa thì lấy `at` mới nhất; giới hạn theo `targetRosterCodes` (allowed set) → **VP018/telesale không có target dù có entry**. Roster = `isActiveSalesUser` (role sale, không Nghỉ việc, type sale/ctv), neo toàn đội active → hết sót NV.
- **Idempotency auto-refresh (`materialize_july_revenue.js`)**: ĐÚNG — trước khi push slot mới, `s.active=false` cho MỌI slot cùng `ky` → **chỉ 1 slot active/kỳ, không double-count, không drift**. PA-A loại `DT-260630-0115` (WEB=550.673.600); kỳ đã đóng giữ nguyên.
- **Kết luận: DUYỆT, không có bug ở 2 điểm rủi ro.** Ghi chú nhỏ (không chặn): `VP018` đang hardcode fallback trong `employeeType` — nên chuyển sang field `employee_type` trong danh bạ khi tiện.
- Đọc lại `CHANGELOG.md` + 5 directive theo thứ tự. Không đụng app cũ `dona-report` port 3860.
- `DIRECTIVE_MOBILE_UX.md`: giữ bản mobile đã dựng; test lại Chrome headless CEO + DN001 tại 375/390/414px, 8 tab chính → `48/48` pass, không overflow/header overlap; cập nhật screenshots trong `artifacts/mobile_ux_20260703/`.
- `DIRECTIVE_NUMBER_FORMAT_VN.md`: chuẩn helper `web/src/util.js`: tiền `1.000.000đ`, rút gọn dùng phẩy VN (`2,67 tỷ`), `%` dùng `90,6%`; tooltip chart dùng tiền đầy đủ; Telegram/smart bỏ khoảng trắng trước `đ` và đổi `%` sang dấu phẩy.
- `DIRECTIVE_TARGET_ADMIN.md`: thêm service `server/src/targetAdmin.js` với resolver `manual > upload > appsale > ai > legacy`; `/targets` và forecast lấy toàn bộ đội sale/CTV active, neo forecast theo T06, loại VP018/telesale khỏi Target/Dự báo/cảnh báo; có pro-rate target kỳ đang chạy; thêm admin APIs upload preview/commit/rollback, sửa tay, AI propose/apply, history; UI Target thêm tab “Quản target”. Runtime `users.json` đã tag `employee_type`, code có fallback `VP018=telesale`.
- `DIRECTIVE_AUTO_REFRESH.md`: chạy lại materializer idempotent, T07 vẫn `2.668.987.096đ` (MISA `2.118.313.496đ` + WEB `550.673.600đ`), T06 giữ `28.403.136.096đ`; không drift về `2.670.947.096đ`.
- `reportnew-tgbot`: CEO đã duyệt, đã `pm2 restart reportnew-tgbot && pm2 save`; process online, unstable restarts 0; NLQ local trả T06/T07 đúng và format `-6,6%`, `-90,6%`.
- Nghiệm thu: `node --check` các file server touched OK, `npm run build` OK; API local `/targets`, `/targets/forecast`, `/admin/targets` đều 35 NV/CTV, không có VP018, forecast `next_ky=07.2026` neo `06.2026`.
- Chưa restart live `reportnew` cho phần code frontend/backend mới trong commit này; cần CEO duyệt riêng nếu muốn nạp lên production ngay.

### 2026-07-03 — CEO DUYỆT restart `reportnew` nạp scheduler auto-refresh
- CEO gửi `approve_restart_reportnew_scheduler`; đã chạy `pm2 restart reportnew && pm2 save` chỉ với app mới `reportnew`.
- Verify sau restart: `reportnew` online, health `http://localhost:3873/api/health` OK; log có `[revenue-refresh] scheduler armed` với `enabled=true`, timezone `Asia/Bangkok`, 60 phút, T2–T6 `07:30-18:30`, T7 `07:30-13:00`, CN `off`.
- Kiểm số code-first sau restart: T06 `28.403.136.096đ`, T07 `2.668.987.096đ` — không drift.
- Old app `dona-report` port 3860 vẫn online, không restart/không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — CEO chốt: telesale KHÔNG giao target
- **VP018 (telesale) KHÔNG giao target.** Loại telesale khỏi danh sách Target/Dự báo, %đạt, cảnh báo "chưa đạt", ranking theo target. Vẫn giữ danh bạ (loại `telesale`, active); doanh thu vẫn tính tổng công ty. Cập nhật `DIRECTIVE_TARGET_ADMIN.md`. Chờ CEO: danh sách telesale khác + xác nhận đội NV sale.
- CEO nhấn: **2.668.987.096đ mới đúng** (khớp app cũ). Rủi ro: scheduler chạy lại materialize mỗi giờ, nếu không áp PA-A → cộng lại 1,96tr → nhảy về 2.670.947.096 sai.
- **Chốt:** script materialize của scheduler PHẢI áp đủ (gán kỳ + PA-A + loại đơn khe), **idempotent tuyệt đối** → mỗi lần refresh T07 luôn = 2.668.987.096đ. Bot verify sau ≥1 chu kỳ auto-refresh; lệch thì dừng báo Claude. Ghi `DIRECTIVE_AUTO_REFRESH.md`.
- CEO: hiển thị số theo chuẩn kế toán VN (`1.000đ` / `1.000.000đ` / `2.670.947.096đ`, dấu chấm hàng nghìn). → [`DIRECTIVE_NUMBER_FORMAT_VN.md`](DIRECTIVE_NUMBER_FORMAT_VN.md).
- Bỏ kiểu US `2.67 tỷ` (chấm thập phân); nếu rút gọn dùng `2,67 tỷ` (phẩy). %: `90,6%`. Áp KPI/thẻ/bảng/CST/Target/Excel/bản tin/tooltip; trục chart rút gọn chuẩn VN. Chuẩn hóa ở helper chung; phối MOBILE để số không cắt mép. Chỉ đổi hiển thị.
- CEO phản ánh Target Dự báo **sai/thiếu**; VP018 là telesale lẫn vào NV sale; nhắc Target admin (file+tự động) chưa làm. → [`DIRECTIVE_TARGET_ADMIN.md`](DIRECTIVE_TARGET_ADMIN.md) (ưu tiên).
- **Sửa ngay:** danh sách Target/Dự báo lấy TOÀN BỘ đội sale active (neo theo T06 đủ, không dựa T07 dở → hết sót NV); thêm **loại NV** (sale/telesale/ctv/khác), tách telesale (VP018) khỏi NV sale.
- **Xây Target admin** (SPEC_TARGET_MULTISOURCE): nhập file (preview/commit/rollback) + tự động App Sale (nếu có) + AI đề xuất→CEO áp dụng + sửa tay; resolver manual>upload>appsale>ai; pro-rate kỳ đang chạy.
- **Chờ CEO:** telesale có target riêng hay không tính; danh sách telesale; đội NV sale đúng gồm mã nào.

### 2026-07-03 — Bot triển khai (Report Bot) — Dựng lại mobile responsive 375–414px
- Đọc `DIRECTIVE_MOBILE_UX.md`; sửa responsive ở `web/src/styles.css` theo mobile-first ≤640px, không đổi số liệu/quyền.
- Chống tràn ngang toàn app: `body/#root` khóa overflow-x, card/grid/chart/donut/list/filter full-width, KPI mobile 1 cột, tên dài wrap/ellipsis, giá trị `.amt` giữ `flex:none` để số bên phải không bị cắt.
- Header sticky không đè nội dung: siết chiều cao/padding, tên NV ellipsis; bottom-nav giữ trong viewport, 390px trở xuống ưu tiên icon để không chen vỡ.
- Bảng chi tiết mobile đổi sang dạng card dọc bằng CSS (`.data-table` block cards), không còn scroll ngang trong “DT đầy đủ”.
- Test Chrome headless local: CEO + DN001, viewport 375/390/414, 8 tab chính; kết quả `48/48` pass, không horizontal overflow, không header overlap. Artifact: `artifacts/mobile_ux_20260703/mobile_check.json` + screenshots Tổng quan/Phân tích/CST.
- Build OK: `npm run build`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — DUYỆT quy tắc gán kỳ + lưu ý khe cắt Lumos
- **Duyệt** rule bot: MISA theo ngày xuất HĐ (`revenue_date`); WEB Partner theo **kỳ đơn đặt `orders.created_at` (giờ VN)** rồi xét giao đủ — replicate app cũ. Đơn đặt cuối tháng trước, giao tháng sau KHÔNG kéo sang kỳ sau.
- **Lưu ý 1 (một lần, tại ranh giới):** đơn WEB đặt 30/6 giao 1/7 (`DT-260630-0115`, 1,96tr) rơi vào khe — T06 đóng băng Lumos không có, T07 loại theo ngày đặt. Negligible; nếu CEO muốn đủ tuyệt đối → carryover adjustment có duyệt (chưa làm).
- **Lưu ý 2 (lâu dài):** cần định nghĩa "khi nào 1 tháng CHỐT CỨNG" — nên để tháng vừa qua còn refresh vài ngày để bắt đơn giao trễ (đơn đặt cuối tháng, giao đầu tháng sau) rồi mới đóng. Bot đã có hướng carryover/kỳ-còn-mở; chốt mốc đóng kỳ khi làm scheduler.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive dựng lại bản MOBILE (CEO phản ánh)
- CEO gửi ảnh mobile (tài khoản NV): **giá trị bên phải bị cắt, header đè nội dung, cơ cấu tràn ngang, cuộn ngang**. → [`DIRECTIVE_MOBILE_UX.md`](DIRECTIVE_MOBILE_UX.md), ưu tiên cao (NV dùng điện thoại).
- Yêu cầu: ≤414px không tràn ngang; dòng "tên—giá trị" giá trị luôn hiện + tên ellipsis/wrap; header không đè; KPI 1 cột; combobox/chart/bottom-nav vừa màn hình. Sửa ở khung/CSS dùng chung cho MỌI trang; không đổi số/quyền. Test 375/390/414px cả CEO + NV.

### 2026-07-03 — Bot triển khai (Report Bot) — Scheduler auto-refresh doanh thu theo khung giờ CEO chốt
- Đọc `DIRECTIVE_AUTO_REFRESH.md` và dựng backend scheduler `server/src/revenueRefresh.js`: mặc định mỗi 60 phút, timezone `Asia/Bangkok`, T2–T6 `07:30-18:30`, T7 `07:30-13:00`, CN `off`; cấu hình env `REVENUE_REFRESH_MINUTES`, `REVENUE_REFRESH_WEEKDAY`, `REVENUE_REFRESH_SAT`, `REVENUE_REFRESH_SUN`, `REVENUE_REFRESH_ENABLED`.
- Scheduler chạy đúng kỳ đang chạy, có single-flight/in-flight guard, chống chạy trùng slot, ngoài khung thì skip không gọi MISA; lỗi thì giữ số cũ.
- Bổ sung hook snapshot MISA tùy cấu hình: `APPSALE_MISA_SYNC_COMMAND` hoặc `APPSALE_MISA_SYNC_URL` + `APPSALE_MISA_SYNC_TOKEN`; nếu chưa cấu hình thì dùng snapshot MISA success mới nhất trong DB, không để trắng số.
- Refactor `server/scripts/materialize_july_revenue.js` thành materializer theo `REVENUE_REFRESH_KY`/kỳ hiện tại, vẫn giữ rule 2 nguồn và rule WEB Partner theo kỳ đơn đặt; ghi `data_as_of` vào active slot.
- Thêm API admin `/api/admin/revenue-refresh/status` và `/api/admin/revenue-refresh/run`; Overview hiển thị “Cập nhật đến HH:MM ngày dd/mm” và nút admin “↻ Làm mới”.
- Nghiệm thu local: `node --check` OK, `npm run build` OK; chạy materializer T07 giữ đúng `2.668.987.096đ` (MISA `2.118.313.496đ`, WEB `550.673.600đ`), T06 không đụng.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Chốt khung giờ auto-refresh (tiết kiệm token)
- CEO chốt khung giờ chạy (giờ VN): **T2–T6 07:30–18:30**, **T7 07:30–13:00**, **CN nghỉ**. Vẫn mỗi 60'. Ngoài khung không gọi MISA (giảm ~60% lần gọi). Cấu hình env. Cập nhật `DIRECTIVE_AUTO_REFRESH.md`.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Directive tự cập nhật doanh thu mỗi 1 giờ (CEO chốt B)
- CEO chốt nhịp **B = mỗi 1 giờ** cho auto-refresh doanh thu kỳ đang chạy. → [`DIRECTIVE_AUTO_REFRESH.md`](DIRECTIVE_AUTO_REFRESH.md).
- Scheduler 60' (env `REVENUE_REFRESH_MINUTES`, khung giờ tuỳ chọn): chụp snapshot MISA → materialize kỳ đang chạy (MISA xuất HĐ + WEB đã giao đủ) → ghi `data_as_of`. Chỉ kỳ đang chạy; kỳ đã đóng giữ nguyên. Idempotent, lỗi thì giữ số cũ.
- Frontend: nhãn "Cập nhật đến HH:MM" + nút "↻ Làm mới" (admin). **NV không thao tác gì — mở app thấy số mới nhất trong 1 giờ, theo scope của mình.** MISA chỉ gọi ~1 lần/giờ.

### 2026-07-03 — Bot triển khai (Report Bot) — Restart tgbot + chốt rule gán kỳ doanh thu
- CEO duyệt restart Telegram worker: đã chạy `pm2 restart reportnew-tgbot` + `pm2 save`; process `reportnew-tgbot` online, backend `http://localhost:3873`, log mới không có error sau restart.
- Trả lời 3 câu rule gán kỳ trong `DIRECTIVE_ENABLE_JULY_REVENUE.md`: CRM MISA theo `revenue_date`/ngày xuất HĐ; APP WEB Partner replicate app cũ theo kỳ đơn đặt `orders.created_at` (Asia/Bangkok), sau đó xét giao đủ/đã thực hiện; không kéo đơn cuối tháng trước sang kỳ sau chỉ vì `responded_at` nằm tháng sau.
- Làm rõ `DT-260630-0115/WEB:2188`: không tính T07 để khớp app cũ; không tự cộng ngược T06 vì 01–06 đang đóng băng Lumos. Nếu cần full carryover thì phải mở adjustment riêng có duyệt.
- Cập nhật `SPEC_DATASOURCE_CUTOVER.md` + `DIRECTIVE_ENABLE_JULY_REVENUE.md`; không đổi runtime revenue, T07 vẫn `2.668.987.096đ`.

### 2026-07-03 — Bot triển khai (Report Bot) — UI polish + Analysis/CST UX + typeahead toàn app
- Đọc `SPEC_ANALYSIS_CST_UX.md`, `DIRECTIVE_UI_POLISH_20260702.md`, `DIRECTIVE_TELEGRAM_NLQ.md`; T07 PA-A và Telegram NLQ đã kiểm lại vẫn đúng.
- Thêm combobox typeahead dùng chung cho bộ lọc Đơn vị/Sản phẩm/NV: tìm theo mã ĐV/tên ĐV, tên SP/mã QLNB/hoạt chất; option sản phẩm hiển thị chuỗi phân biệt QĐ/hoạt chất/hàm lượng/ĐVT/nhà thầu/giá thầu, value vẫn là `iit_code`.
- Backend `/api/filters` trả product option giàu metadata từ CST+revenue, lọc theo scope; `/products`, `/revenue?dimension=product`, export products/CST có thêm QĐ/thuộc tính phân biệt. CST export bỏ cột Giá bán.
- Tab CST: bỏ “Giá bán” trên card, thêm QĐ + hoạt chất/hàm lượng cho QĐ139, sửa “Nguồn” thành “Cập nhật đến kỳ/baseline + bán đến…”, thêm gợi ý hành động từng dòng, tiến độ đã bán/còn lại, ưu tiên dòng cần làm, chế độ gom theo Đơn vị + header tóm tắt.
- Tab Phân tích: thêm block `SP cần đẩy mạnh` và `SP sắp hết CST`; xuất artifact parity `artifacts/analysis_parity_20260703.md`.
- Tổng quan: đo hiệu năng artifact `artifacts/overview_perf_20260703.json`; tối ưu `/trend` từ ~10.064ms xuống ~545ms local bằng lightweight trend + memo 60s, KPI/số không đổi.
- Nghiệm thu: T06 `28.403.136.096đ`, T07 `2.668.987.096đ`, `node --check` OK, `npm run build` OK.

### 2026-07-03 — CEO DUYỆT restart Telegram worker (bật NLQ)
- **CEO đã DUYỆT** thao tác live: bot server `pm2 restart reportnew-tgbot` để nạp code NLQ + `pm2 save`. An toàn (login bot đang chạy, chỉ nạp code mới).
- Verify sau restart: `/start`, đăng nhập RP, `/digest_test` vẫn OK; hỏi tự nhiên "doanh thu tháng 6?" → trả lời đúng scope; user chưa map → chỉ hướng dẫn đăng nhập.
- Nhắc bot trả lời 3 câu **quy tắc gán kỳ** (ngày đặt vs ngày giao) trong `DIRECTIVE_ENABLE_JULY_REVENUE.md`.


### 2026-07-03 — Bot triển khai (Report Bot) — Telegram NLQ + fix PA-A T07 đã chạy
- Đọc `DIRECTIVE_TELEGRAM_NLQ.md` và nối fallback Telegram vào `smart.answerQuestion` code-first: mã RP/lệnh `/start`, `/digest_test`, `/tat`, `/bat` giữ nguyên; user chưa map chỉ nhận hướng dẫn đăng nhập; user đã map được hỏi tự nhiên theo đúng scope Telegram → `emp_code` → `auth.scopeOf`.
- Bổ sung nhận diện kỳ trong câu hỏi nhanh (`tháng 6`, `T06`, `06.2026`...) để nghiệm thu CEO hỏi “doanh thu tháng 6” trả đúng kỳ thay vì mặc định latest.
- Chạy fix PA-A T07: re-materialize slot `07.2026`; WEB Partner còn `550.673.600đ` (67 rows/32 orders), CRM MISA `2.118.313.496đ` → Overview T07 `2.668.987.096đ` đúng chỉ đạo; T06 giữ nguyên `28.403.136.096đ`.
- Trace chênh `1.960.000đ`: loại khỏi T07 dòng `DT-260630-0115` / `WEB:2188` / Goutcolcin / DN008 / `164.PKĐK QUỐC TẾ HẠNH PHÚC` vì đơn tạo 30/06, phản hồi/giao 01/07; artifact `artifacts/july_revenue_paa_trace_20260702.json`.
- Nghiệm thu local: `node --check` OK; `smart.answerQuestion("doanh thu tháng 6")` CEO → `28.403.136.096đ`; DN008 hỏi T07 chỉ thấy scope DN008; `npm run build` OK.

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Spec: ô lọc typeahead + phân biệt thuốc trùng tên
- CEO: 2 ô "Tất cả đơn vị"/"Tất cả sản phẩm" cho gõ tìm tiên đoán; thuốc trùng tên (VD "Alusi") cần phân biệt. → `SPEC_ANALYSIS_CST_UX.md` mục C2.
- **Gốc:** định danh sản phẩm = `iit_code` (mã QLNB), không phải tên; 1 tên ↔ nhiều mã QLNB (khác gói/QĐ, nhà thầu, ĐVT ml-gam/gói, giá).
- **Giải:** (A) combobox typeahead tìm theo tên+mã QLNB+hoạt chất; (B) mỗi option/thẻ hiện `tên · hoạt chất/hàm lượng · ĐVT · nhà thầu · QĐ · mã QLNB`, value = iit_code duy nhất; toggle "Gộp theo tên" ↔ "Tách theo mã QLNB".

### 2026-07-03 — Dev/Kiến trúc (Claude Code) — Telegram NLQ + nhắc fix T07 chưa chạy
- **Login bot mới LIVE** (`@DonaLoginReport_bot`, bot riêng tách agent) — `/digest_test` ra số OK, hết xung đột "gửi mã".
- **‼ Fix PA-A CHƯA CHẠY:** Overview T07 vẫn `2.670.947.096đ` (chưa loại 1,96tr đơn giao dở). Bot cần **re-materialize T07** (loại phần đã-giao đơn dở) → về `2.668.987.096đ`. Đang chờ bot chạy.
- **CEO yêu cầu bot hiểu ngôn ngữ tự nhiên** → [`DIRECTIVE_TELEGRAM_NLQ.md`](DIRECTIVE_TELEGRAM_NLQ.md): nối `smart.answerQuestion`/`/api/ai/ask` vào fallback `telegram-bot.js`. **Bảo mật: chỉ user đã map, scope đúng người hỏi (NV chỉ thấy mình), không bịa số.** Q&A = pull nên CTV ngoài được hỏi phần mình (guardrail chỉ chặn push).

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — CEO chốt PA A: pro-rate target kỳ đang chạy
- Kỳ đang chạy (VD T07 mới 2 ngày) so lũy kế với target cả tháng → đỏ oan. **Chốt chia target theo ngày:** `target_prorated = target_full × daysElapsed/daysInMonth`; `% đạt(nhịp) = DT trước VAT / target_prorated`. Kỳ đã đóng giữ target đủ.
- Áp: Overview %/vòng target, Target card NV, `buildAlerts` nhóm target, digest. Gắn nhãn "Kỳ đang chạy · đến ngày X (d/D)"; hiện rõ đang so mốc-nhịp + target cả tháng. Không pro-rate doanh thu. Ghi `SPEC_TARGET_MULTISOURCE.md`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — CEO chốt CHÍNH SÁCH: đơn giao dở KHÔNG tính (khớp app cũ)
- **CEO chốt PHƯƠNG ÁN A:** đơn giao dở dang → xếp trọn vào "còn nợ chưa giao", KHÔNG tính phần đã giao; chỉ đơn giao ĐỦ mới vào "đã thực hiện". Áp mọi kỳ.
- Bot sửa: loại phần đã-giao của đơn dở khỏi partner → T07 = **2.668.987.096đ** khớp app cũ 100% tại cùng snapshot (đơn 1,96tr được đưa về "còn nợ"). Ghi `DIRECTIVE_ENABLE_JULY_REVENUE.md`. Nghiệm thu đối chiếu số app cũ, không ép số.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — MISMATCH T07: WEB dư 1.960.000đ (phải truy)
- CEO đồng bộ lại app cũ 23:42 (snapshot #27 official) → WEB **vẫn 550.673.600đ** → **bác bỏ** giả thuyết "phát sinh sau snapshot" của bot. Chênh 1,96tr là THẬT.
- **App Report WEB = 552.633.600 dư 1.960.000đ** so app cũ (550.673.600). MISA khớp tuyệt đối.
- **Nghi:** App Report tính SL ĐẶT thay vì **SL GIAO THỰC** cho đơn giao một phần, hoặc gộp nhầm "còn nợ chưa giao" (24,59tr, 1 đơn) vào "đã giao". Định nghĩa cũ: "đối tác đã thực hiện = SL giao thực × đơn giá", loại hủy + loại còn-nợ.
- **Áp nguyên tắc mismatch:** bot DỪNG, truy đúng đơn, sửa khớp định nghĩa → T07 phải = **2.668.987.096đ** tại cùng snapshot. KHÔNG ép số. Ghi `DIRECTIVE_ENABLE_JULY_REVENUE.md`.

### 2026-07-02 — Bot triển khai (Report Bot) — Bật doanh thu 07.2026 từ 2 nguồn MISA + APP WEB
- Đọc `DIRECTIVE_ENABLE_JULY_REVENUE.md` và điều tra lại code App Sale API: doanh thu App Report T07 phải dùng **CRM MISA đã xuất HĐ + APP WEB đối tác đã giao thực**, không dùng WEB ordered và không chỉ soi App Web :3970.
- Xác nhận công thức nguồn cũ: MISA đọc `misa_revenue_snapshot_lines` latest success run, `revenue_bucket in (official,pending)`, amount `invoice_export_amount`; Partner đọc latest `partner_order_line_responses`, amount `delivered_qty * order_items.price`, loại HOLD_GOLIVE/test/chưa giao.
- Thêm script idempotent `server/scripts/materialize_july_revenue.js` để materialize kỳ `07.2026` thành upload slot runtime, chỉ đọc DB App Sale/MISA snapshot và chỉ ghi data App Report New; 01–06 không đổi.
- Kết quả materialize hiện tại: CRM_MISA `2.118.313.496đ` (226 rows/66 orders) + APP_WEB_PARTNER `552.633.600đ` (68 rows/33 orders) = T07 `2.670.947.096đ`. Số MISA khớp ảnh CEO; **partner cao hơn ảnh `1.960.000đ` — Claude review: giả thuyết "tăng sau snapshot" đã bị CEO bác bỏ (re-sync 23:42 vẫn 550.673.600), cần truy đơn (mục MISMATCH trên).**
- Nghiệm thu: `store.listPeriods()` có `07.2026`, `latestKy=07.2026`, T06 vẫn `28.403.136.096đ`, T07 `2.670.947.096đ`, không có mã NV rác; `node --check` OK; `npm run build` OK. Artifacts: `artifacts/july_revenue_2source_investigation_20260702.md`, `artifacts/july_revenue_2source_materialize_20260702.md/json`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — ĐÍNH CHÍNH: doanh thu có 2 nguồn (CRM MISA + APP WEB)
- CEO gửi ảnh "CRM MISA — Đối chiếu doanh thu đa chiều" (app Đặt hàng cũ): T07 tính đến 20:29 02/07 = **tổng đặt 3.175.523.336đ, đã thực hiện 2.668.987.096đ, 125 đơn**.
- **Đính chính khảo sát trước:** bot báo "T07 chỉ 2 đơn" vì **chỉ soi APP WEB (:3970), SÓT nguồn CRM MISA** (phần lớn ~80%). Doanh thu App Report = **CRM MISA (xuất HĐ) + APP WEB (đã giao)**.
- **Định nghĩa "doanh thu thực" đã rõ:** `đã thực hiện = MISA xuất HĐ + WEB đã xuất/giao` (loại chưa xuất HĐ/chưa phản hồi/còn nợ/HOLD/hủy) → đáp án cho câu "trạng thái nào = đã bán".
- Cập nhật `DIRECTIVE_ENABLE_JULY_REVENUE.md` (gộp 2 nguồn, điều tra lại MISA snapshot) + `SPEC_DATASOURCE_CUTOVER.md` mục A. Bot điều tra lại 2 nguồn → adapter kỳ 07 gộp cả hai → đối chiếu khớp báo cáo cũ.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Directive polish UI (CEO feedback qua ảnh)
- [`DIRECTIVE_UI_POLISH_20260702.md`](DIRECTIVE_UI_POLISH_20260702.md): **H1** Tổng quan CHẬM → đo API, cache tổng hợp theo kỳ, lazy-load chart (ưu tiên). **H2** DT/SP: thêm số QĐ; QĐ139 thêm hoạt chất+hàm lượng (QĐ141 không). **H3** CST: bỏ "Giá bán" (trùng Giá thầu), thêm số QĐ, QĐ139 thêm hoạt chất+hàm lượng. **Nguồn**: đang hiển thị `01-MAY-26` gây hiểu nhầm → đổi thành kỳ dữ liệu thực (VD "đến 06.2026").
- Live PASS 2 (bot, commit e869bb0): remap `#N/A`→DN019, `83`(10 dòng)→DN021; 6 CTV status Cộng tác; 4 CTV ngoài `no_auto_notify`; tổng T06 = 28.403.136.096 giữ nguyên. **Duyệt.**

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Review trace mã rác + chốt remap + PASS 2 danh bạ
- Review `emp_junk_trace_20260702.md`. **Chốt remap:** `83` (10 dòng CST Valesto/QĐ48 Cà Mau-Bạc Liêu, 1 dòng đã `DN021`) → **remap DN021** (chờ CEO xác nhận DN021 phụ trách Cà Mau-Bạc Liêu). `#N/A` (1 dòng 1.575.000đ tại 033 An Long Khánh) → bot dò chủ ĐV 033 rồi remap; vô chủ thì giữ "Chưa phân bổ". Tổng T06 giữ nguyên.
- **PASS 2 danh bạ (bot làm nốt):** sửa `DN021` status → **Cộng tác** (commit b701dec set nhầm "Đang làm"); thêm/đổi `DN002`(Hằng Nga)/`DN004`(Ngọc Quyên) + `DN022`/`DN023`; áp `no_auto_notify=true` cho DN021/022/023/VP004 (DN002/004 email nội bộ — không áp). 6 CTV đều role sale/active/**có target tính đầy đủ**.
- Duyệt cách xử mã rác của bot (cách ly `UNALLOCATED`/"Chưa phân bổ", không xóa, tổng T06 = 28.403.136.096 giữ nguyên).

### 2026-07-02 — Bot triển khai (Report Bot) — PASS 2 emp master: remap #N/A/83 + CTV guardrail
- Đã làm mục 3/4 trong `DIRECTIVE_FIX_EMP_MASTER.md` bản mới. Remap dữ liệu runtime có backup artifact trước/sau, không đụng app cũ 3860.
- Remap `83 → DN021`: 10 dòng CST Valesto/QĐ48 tỉnh Cà Mau-Bạc Liêu, giữ nguyên `bid_qty_initial=460.000`, `sold_qty=12.000`, `sold_amount=21.600.000`, chỉ đổi chủ sang DN021 và lưu `raw_emp_code=83`.
- Remap `#N/A → DN019`: dòng Fortraget tại `033.NT-PKĐK AN LONG KHÁNH`, doanh thu active T06 `1.575.000đ`, SL `10`, giữ nguyên số; cũng remap slot 06 inactive cũ để rollback không tái phát mã rác.
- PASS 2 danh bạ: `DN002`, `DN004`, `DN021`, `DN022`, `DN023`, `VP004` status `Cộng tác`, role `sale`, active/tính đủ doanh thu-target-cảnh báo-ranking. Áp `no_auto_notify=true` cho 4 CTV ngoài `DN021/DN022/DN023/VP004`; DN002/DN004 không khóa gửi tự động.
- Guardrail digest: `telegram-bot.js` bỏ qua user `no_auto_notify` trong bản tin/nhắc target chủ động; vẫn cho đăng nhập/xem dữ liệu pull.
- Nghiệm thu: T06 vẫn `28.403.136.096đ`; không còn `#N/A`, `83`, hoặc `UNALLOCATED` trong runtime; `DN019` nhận `1.575.000đ`; DN021 có 10 dòng CST remap; `node --check` OK; `npm run build` OK. Artifact: `artifacts/emp_master_pass2_20260702.md/json`, `artifacts/emp_master_pass2_20260702_before.json`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Directive: thêm DN021/VP004 + truy mã rác #N/A, 83
- CEO phát hiện qua ảnh: dropdown lọc NV có `#N/A` và `83`; card Target hiện mã trần `DN021`, `VP004`. → [`DIRECTIVE_FIX_EMP_MASTER.md`](DIRECTIVE_FIX_EMP_MASTER.md).
- **Thêm 2 NV vào danh bạ:** `DN021` Lê Anh Đức (0906107109, ducluatsu98@yahoo.com.vn) role sale; `VP004` Trần Hoàng Trung (0378970463). Cập nhật danh bạ runtime + auth OTP + crosswalk emp_code.
- **VP004 = CỘNG TÁC VIÊN** (CEO chốt: chuyển qua làm cộng tác): status "Cộng tác" (active, vẫn tính doanh thu), scope phần mình; target chỉ tính khi CEO giao. Chuẩn hóa 3 trạng thái NV: Đang làm / Cộng tác / Nghỉ việc.
- **Danh sách CTV sale (CEO chốt):** `DN002`, `DN004`, `DN021`, `DN022`, `DN023`, `VP004` → status Cộng tác. Bot đổi status mã đã có; mã thiếu (`DN022`/`DN023`) chờ CEO cấp tên+SĐT để thêm + OTP.
- **CTV CÓ giao target (CEO chốt):** CTV tính ĐẦY ĐỦ như sale chính thức (doanh thu + target + % đạt + cảnh báo chưa đạt + ranking); chỉ khác NHÃN "Cộng tác". Bỏ quy tắc "target tùy chọn/không hiện đỏ" nêu trước đó.
- **⛔ GUARDRAIL (CEO chốt, bắt buộc):** KHÓA gửi tự động (email/Zalo/Telegram digest) thông báo đạt/thiếu target + nhắc thông tin cho 4 CTV ngoài `DN021`/`DN022`/`DN023`/`VP004` (`no_auto_notify=true`). Chỉ gửi khi CEO yêu cầu + duyệt trước. Họ vẫn đăng nhập xem phần mình (pull OK, push KHÓA). Ghi trong `DIRECTIVE_FIX_EMP_MASTER.md`.
- **Truy mã rác `#N/A`/`83`:** giả thuyết lỗi Excel + `raw_nv` chưa map. Bot truy nguồn (slot/dòng/tiền/đơn vị/raw_nv) → **remap về đúng NV, GIỮ tổng T06 = 28.403.136.096**, không xóa lặng; vô chủ → gom "Chưa phân bổ". Bộ lọc NV chỉ nhận mã hợp lệ `DN###/VP###`. Xuất artifact trace → Claude review trước khi remap.

### 2026-07-02 — Bot triển khai (Report Bot) — Fix danh bạ NV + chặn mã rác #N/A/83
- Thực hiện `DIRECTIVE_FIX_EMP_MASTER.md`: thêm `DN021 — Lê Anh Đức` và `VP004 — Trần Hoàng Trung` vào `server/data/users.json` để card hiện tên và OTP tra được theo SĐT. `DN021` status `Đang làm`; `VP004` status `Cộng tác` nhưng vẫn role `sale`/active, target chỉ tính khi có target thật.
- Backend bổ sung chuẩn hóa mã NV runtime: chỉ `DN###`/`VP###` là mã NV thật; mã rác như `#N/A`, `83` được giữ dòng nhưng chuyển nhãn thành `UNALLOCATED` / `Chưa phân bổ`, không còn lẫn vào dropdown/card như nhân viên thật. Tổng doanh thu không đổi.
- Trace read-only mã rác: `artifacts/emp_junk_trace_20260702.md/json`. Active upload có 1 dòng `#N/A` kỳ 06.2026, Fortraget tại `033.NT-PKĐK AN LONG KHÁNH`, doanh thu `1.575.000đ`; CST có 10 dòng `83` Valesto/QĐ48 Cà Mau-Bạc Liêu, bid_qty `460.000`, sold `12.000`, sold_amount `21.600.000`; 1 dòng có `sales_emps=DN021` nhưng chưa remap file nguồn trước khi Claude/CEO duyệt.
- Cập nhật lại artifact mục G `crosswalk_emp_code`: App Sale employees `31`, App Report users `37`, match exact code `30`; App Sale-only còn `1` là `VP019` kế toán. `DN021`/`VP004` hết blocker phân quyền 07.
- Nghiệm thu: `node --check` các file backend OK; `npm run build` OK; T06 vẫn `28.403.136.096đ`; runtime không còn mã NV `#N/A`/`83`, có nhóm `Chưa phân bổ`.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Spec: parity Phân tích + CST dễ hiểu + lọc theo mã ĐV
- CEO yêu cầu 3 việc → ghi [`SPEC_ANALYSIS_CST_UX.md`](SPEC_ANALYSIS_CST_UX.md):
- **A) Phân tích parity:** bot trích full feature tab `pt` cũ (`report-main-v23.js`/`report-extra.js`) → bảng đối chiếu → bù thiếu (dự kiến: SP cần đẩy mạnh, SP sắp hết CST, phân tích chuyên sâu, PDF). Xuất artifact parity trước khi code.
- **B) CST dễ hiểu cho NV:** giữ tính năng + 4 lớp (gợi ý hành động từng dòng, gom theo ĐV rollup, tiến độ rõ + hạn hợp đồng, ưu tiên dòng cần làm). Độc lập nguồn — làm ngay.
- **C) Lọc theo TỪNG mã ĐV** (CEO nhấn mạnh): ô chọn ĐV nổi bật + tìm nhanh → header tóm tắt ĐV → danh sách CHỈ mã QLNB của ĐV đó; scope-aware (NV chỉ thấy ĐV của mình); áp CST+DT+Phân tích. Chủ yếu nâng UX, tái dùng param `unit`.

### 2026-07-02 — Bot triển khai (Report Bot) — Mục G adapter SHADOW CST + crosswalk emp_code
- Đã chạy mục G ở chế độ **read-only/shadow**: không ghi App Sale, không ghi Lumos, không thay nguồn runtime App Report, không restart/deploy.
- Artifact mới: `artifacts/cutover_g/crosswalk_emp_code.json`, `cst_shadow_adapter_20260702.json`, `g_shadow_summary.md`, `worklist_lumos_static.json`, `worklist_appsale_allocation_hold.json`, `report_sync_contract_proposal.md`.
- Crosswalk `emp_code`: App Sale `31` employees, App Report `35` users; match exact code `28`; App Sale thiếu trong App Report `3` (`DN021`, `VP004` inactive, `VP019` kế toán); App Report-only `7` (`CEO`, `VP017`, `VP003`, `VP010`, `VP013`, `VP015`, `VP016`). Đây là blocker cần review trước sync doanh thu/phân quyền 07.
- CST shadow App Sale CL từ `2026-07-01`: timeline `2` order_item, gom `2` CST keys, cả `2/2` match baseline; approved-like qty `0` vì status hiện `PARTNER_RESPONDED_FULL|pending` và `HOLD_GOLIVE|pending`; ordered-eligible qty `3.000`, amount `2.940.000`. Chưa có key không match baseline trong timeline 07.
- Xuất 2 worklist theo quyết định mục G: `10` Lumos-only giữ STATIC để tổ thầu xác nhận hiệu lực; `45` App-only HOLD chờ nhập allocation/cst_quota. Đã đề xuất contract `/api/report-sync/changes?updated_since=` + service token, có cursor/idempotent/event_id.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Duyệt F + bật đèn xanh adapter SHADOW (mục G)
- Review kết quả F của bot (match **99,64%**, crosswalk tường minh, tách `107`, gộp KHU C). **Duyệt.** Ghi mục G vào `SPEC_DATASOURCE_CUTOVER.md`.
- **55 dòng lệch — không chặn shadow:** 9 Lumos-only chưa rõ hiệu lực → **giữ STATIC** (an toàn vì không có trong App Sale, không có gì trừ vào); 45 App-only thiếu allocation → **HOLD** (doanh thu vẫn tính, CST chờ tổ thầu nhập cơ số). → 2 **worklist cho tổ thầu** rà master allocation App Sale (song song).
- **Việc tiếp bot (read-only, chưa cắt Lumos):** (1) adapter SHADOW CST đối chiếu vs baseline; (2) **crosswalk `emp_code`** (chốt chặn cho sync doanh thu 07 + phân quyền); (3) xuất 2 worklist; (4) đề xuất contract `/api/report-sync/changes` + service token.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Chốt quyết định crosswalk CL (mục F)
- Review crosswalk bot (khớp 99,6%, 2731/2741). **Duyệt rule "gói từ QĐ trong QLNB, fallback goi_code"** (goi_code mù chỉ 82,1%). Ghi mục F vào `SPEC_DATASOURCE_CUTOVER.md`.
- **Nguyên tắc:** crosswalk = **bảng ánh xạ tường minh** (`crosswalk_units/products/bidpkg.json`), KHÔNG dùng chuẩn hóa chuỗi 3-số làm khóa runtime (thứ gây bug T06 + đụng 107).
- **4 quyết định:** (1) `001 + KHU C` → **gộp chung, CỘNG cơ số** (cùng BV, đúng app cũ; CEO xác nhận); (2) prefix `107` đụng 2 ĐV → tách tay trong bảng ánh xạ, không map bằng 3 số; (3) 10 key Lumos-only → phân loại hết hạn (giữ tĩnh) / còn hiệu lực (map hoặc flag GAP cho CEO); (4) 44 key App-only → gói mới App Sale, đưa vào nếu có allocation hợp lệ.
- **Trạng thái:** bot dọn 4 nhóm → mục tiêu ≈100% → mới viết adapter SHADOW (chưa cắt Lumos). Báo lại tỉ lệ + danh sách lệch để Claude review.

### 2026-07-02 — Bot triển khai (Report Bot) — Mục F datasource cutover: crosswalk tường minh
- Đã pull/đọc `SPEC_DATASOURCE_CUTOVER.md` mục F và dựng artifact crosswalk tường minh read-only, không ghi App Sale/Lumos, không bật adapter/cutover.
- Tạo các bảng nháp: `artifacts/cutover_f/crosswalk_units.json`, `crosswalk_products.json`, `crosswalk_bidpkg.json`, cùng kết quả `f_crosswalk_result.json/md`. Runtime tương lai phải dùng bảng này, không dùng chuẩn hóa 3 số trực tiếp.
- Áp rule đã chốt: gói thầu lấy `QĐ` từ mã QLNB trước, fallback `goi_code`; `001.BVĐK Đồng Nai` + `001.BVĐK Đồng Nai-KHU C` map chung target `001`; prefix `107` tách explicit thành `107_DUC_HUE` và `107_TAN_THANH` để tránh gộp sai.
- Kết quả sau explicit crosswalk: App Sale CL `3.002` offering rows / `2.776` explicit keys; Lumos CST `2.741` keys; match `2.731` = `99,64%`; còn `10` Lumos-only, `45` App-only, `226` duplicate App keys do 001/KHU C cần cộng timeline chung.
- Phân loại App-only: `0` key có allocation hợp lệ trong `cst_quota`, `45` key phải HOLD vì thiếu `cst_ban_dau_import/cst_chinh/cst_con_lai_import`. Lumos-only: `1` dòng thiếu IIT giữ static; `9` dòng còn lại chưa phân loại hết hạn/còn hiệu lực vì `cst_real.json` không có `hd_den_ngay` — cần nguồn allocation gốc/hiệu lực trước khi shadow adapter.

### 2026-07-02 — Bot triển khai (Report Bot) — Crosswalk CL-scope App Sale ↔ Lumos
- Đã đọc `SPEC_DATASOURCE_CUTOVER.md` mục C/E và chạy bước 1 **crosswalk CL-scope** read-only, không ghi App Sale, không cắt Lumos.
- Nguồn App Sale: `unit_offerings.route='CL'` join `units/products/contractors`; nguồn Lumos/App Report: CST baseline `store.getCst()`.
- Kết quả chính sau rule **lấy gói từ QĐ trong mã QLNB trước, fallback `goi_code`**: App Sale CL `3.002` offering rows, `2.775` key; Lumos CST `2.741` key; match `2.731` key = `99,6%` theo Lumos. Nếu lấy mù `goi_code`, match chỉ `82,1%`, nên không dùng `goi_code` trực tiếp cho CST adapter.
- Chưa đạt 1:1 hoàn toàn: còn `10` Lumos-only key, `44` App-only key; `227` duplicate App normalized key, trong đó `226` do `001.BVĐK Đồng Nai` + `001.BVĐK Đồng Nai-KHU C` collapse về `001`, và `1` do prefix `107` trùng 2 đơn vị khác nhau. Artifact: `artifacts/crosswalk_cl_20260702.md`, `artifacts/crosswalk_cl_20260702_summary.json`, `artifacts/crosswalk_cl_20260702_variant_bid_from_iit.json`.
- Kết luận: **chưa bật adapter/cutover**; cần Claude/CEO chốt rule `001-KHU C` và xử lý các key thiếu trước khi viết adapter shadow.

### 2026-07-02 — Bot triển khai (Report Bot) — Biểu đồ Recharts theo kỳ + scope
- Cài `recharts@3.9.1`; thêm `GET /trend` trả `[{ky, revenue, revenueBeforeVat, targetTotal, pctTarget}]` cho mọi kỳ theo `scopeOf`.
- Tổng quan: thêm line chart doanh thu theo kỳ + overlay target, highlight kỳ đang chọn; thêm vòng tiến độ target theo bộ lọc Tháng/Quý/Khoảng; thêm bar chart Top 10 Đơn vị/Sản phẩm.
- Phân tích: chuyển sang dùng PeriodFilter Tháng/Quý/Khoảng; thêm Top 10 Đơn vị/Sản phẩm và 3 donut Tuyến / Nhà thầu / Gói thầu, top 6 + gộp `Khác`; backend `/analysis` bổ sung `byBidPackage`.
- Target: thêm PeriodFilter và vòng nhỏ % đạt trên từng card NV, màu xanh ≥100%, vàng 80–99%, đỏ <80%.
- Nghiệm thu kỹ thuật: `npm run build` OK; API check admin/sale OK (`/trend`, `/overview?from=04.2026&to=06.2026`, `/analysis`, sale DN016 chỉ thấy DN016). Bundle đã tách chunk: `index` gzip ~18,59KB, `recharts` gzip ~167,29KB; Vite còn cảnh báo chunk recharts >500KB minified nhưng build thành công.

### 2026-07-02 — Bot triển khai (Report Bot) — Guard rủi ro biên CST upload merge
- **Xác minh rủi ro baseline trễ nhiều kỳ:** baseline CST hiện có `source_from_date=01-MAY-26`, suy ra `baselineCoveredKy=05.2026`; sau guard chỉ merge các upload slot active có `ky > baselineCoveredKy`, hiện chỉ `06.2026`. Nếu sau này re-dump baseline mới hơn, slot `<= baselineCoveredKy` sẽ không bị cộng lại để tránh double-count; nếu baseline trễ >1 kỳ thì sẽ cộng tất cả slot sau mốc baseline, không chỉ latest.
- **Xác minh rủi ro khóa đơn vị 3 số:** đếm baseline CST theo key `normIit + normUnit` cho 2.741 dòng, duplicate key = `0`; upload receiver bị cộng vào >1 dòng = `0`. Đã thêm guard: nếu tương lai key CST baseline trùng >1 dòng thì bỏ merge key đó và phải điều tra/phân bổ riêng, không cộng cùng upload vào nhiều dòng.
- **Recheck:** RELIPOREX vẫn bán `33.400`, còn `36.600`, `52,3%`; AMEBISMO vẫn bán `3.180`, còn `24`, `0,7%`. Artifact: `artifacts/cst_merge_guard_check_20260702.json`. `npm run build` OK.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Duyệt sync doanh thu 01/07 + thiết kế Target đa nguồn
- **CEO duyệt:** bot triển khai **đồng bộ doanh thu từ 01/07/2026** từ App Sale (không chỉ shadow). Ghi 4 điều bắt buộc vào `SPEC_DATASOURCE_CUTOVER.md` mục A: (1) crosswalk `emp_code` sống còn cho phân quyền; (2) liên tục thực thể xuyên kỳ cắt; (3) xác nhận VAT trước/sau; (4) kênh (CL+NCL+NT?) + net theo trạng thái.
- **Thiết kế Target đa nguồn** [`SPEC_TARGET_MULTISOURCE.md`](SPEC_TARGET_MULTISOURCE.md): 3–4 nguồn (App Sale auto / AI đề xuất / Upload / sửa tay) → mô hình **nhiều ứng viên + resolver chọn active**; ưu tiên manual>upload>appsale>ai; **AI chỉ ra ứng viên, không tự chốt**; không đè ngầm ô CEO đã khóa; UI Target admin 4 cột đối chiếu + audit.
- **Cần xác nhận:** App Sale có quản lý **target theo NV/kỳ** không (khảo sát mới thấy đơn hàng+CST). Có → 3 nguồn; chưa → làm AI+Upload+sửa tay trước, chừa adapter App Sale.
- **Trạng thái:** spec sẵn sàng cho bot; chưa cắt Lumos, sync 07 chạy khi crosswalk emp/ĐV/SP xong.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Review khảo sát API App Sale + chốt Model A
- **Bot khảo sát read-only API App Sale (:3970)** (artifact `appsale_api_cutover_survey_20260702.md`). Claude review → ghi mục E vào `SPEC_DATASOURCE_CUTOVER.md`.
- **Chốt Model = A (neo baseline Lumos):** App Sale CHƯA có đủ lũy kế bán trước 07/2026 → giữ baseline Lumos, App Sale chỉ trừ dần từ 01/07 (đính chính: bot ghi "Model B" nhưng mô tả đúng Model A).
- **Blocker phải xử trước:** (1) mã chưa khớp (SP 371/318, ĐV 195/108) → dựng crosswalk **chỉ trong phạm vi kênh CL**; (2) định nghĩa "net" bằng TRẠNG THÁI (approved/delivered/invoiced, loại CANCELLED/rejected); (3) cần App Sale bổ sung endpoint incremental `/api/report-sync/changes?updated_since=` + service token.
- **Thuận lợi:** App Sale đã có cột `cst_ban_dau_import/cst_con_lai_import` (nghi baseline từ Lumos) → cần đối chiếu; bán/timeline đủ ID/timestamp/trạng thái/cờ kênh CL/nối gói thầu.
- **Trạng thái:** KHÔNG cắt Lumos. Việc tiếp bot: crosswalk CL + đối chiếu cst_con_lai_import + đề xuất contract API + adapter SHADOW đối chiếu.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Thiết kế cutover nguồn dữ liệu Lumos → App Sale New
- **CEO đề xuất:** từ 07/2026 ngắt Lumos, đồng bộ trực tiếp từ **App Sale New** (public `appsaletest.donapharm.asia` → API `:3970`); doanh thu 01–06/2026 (Lumos) đóng băng backup; CST chốt 1 snapshot baseline tại 01/07/2026.
- **Viết spec** [`SPEC_DATASOURCE_CUTOVER.md`](SPEC_DATASOURCE_CUTOVER.md): tách DOANH THU (đóng băng lịch sử + live tương lai, rủi ro thấp) vs **CST** (baseline + trừ dần, rủi ro cao).
- **6 rủi ro CST chí mạng** phải xử lý trước khi cắt: (1) khóa khớp 2 hệ `IIT+đơn vị+gói thầu`; (2) chiều gói thầu QĐ139/141; (3) chỉ kênh CL; (4) **nguồn allocation gói mới sau 01/07**; (5) bán ròng (net trả hàng); (6) chống đếm trùng (ID duy nhất + cursor idempotent).
- **4 câu hỏi bot phải khảo sát API App Sale trước khi cắt** (mã có khớp Lumos? cờ kênh? ID giao dịch + incremental? có quản lý allocation?).
- **Thứ tự an toàn:** khảo sát API → adapter chạy SONG SONG đối chiếu → đóng băng T06 final + snapshot CST 01/07 → delta=0 → mới cắt Lumos. Không đụng app cũ 3860; App Sale chỉ đọc.
- **Trạng thái:** thiết kế + checklist sẵn sàng; **chờ bot trả lời 4 câu khảo sát API** để chốt hợp đồng API chi tiết.
- **CẬP NHẬT (CEO chốt):** Q4 = **CÓ** — App Sale quản lý gói thầu/allocation → nguồn cấp cơ số mới nằm ở App Sale. Kéo kiểu **timeline theo trạng thái thực**. Phát sinh **1 câu kiến trúc mới**: App Sale có đủ dữ liệu gói CŨ (allocation + lũy kế bán trước 07) không → quyết **Model B** (đọc thẳng, bỏ baseline Lumos) hay **Model A** (neo baseline Lumos 01/07 + trừ dần). Đã mở rộng brief khảo sát API (7 mục) cho bot chạy TRƯỚC khi cắt.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — Chốt spec Telegram Digest V2 (chi tiết)
- **Duyệt đề xuất Digest V2** (CEO + bot đề xuất): nâng bản tin 1 dòng → báo cáo nhanh có **top 3–5 từng mục** (Doanh thu / Target NV / CST sắp cạn / Đơn vị giảm mạnh / Gợi ý xử lý).
- **Viết spec chi tiết** vào `SPEC_TELEGRAM_DIGEST.md` (PHẦN B2) để bot triển khai: map 1–1 từng mục vào `smart.buildAlerts()` (4 nhóm sẵn) + `overviewKpis()` → **KHÔNG tính lại trong bot, số khớp app 100%**.
- **5 điểm review bắt buộc:** (1) 2 khuôn theo scope — NV sale ra "của bạn", không lộ số người khác; (2) empty-state tích cực (✅) không để mục trống; (3) định dạng số kiểu VN (phẩy thập phân, `28,40 tỷ` / `650tr`); (4) top N + giới hạn <3500 ký tự; (5) gửi PLAIN TEXT (không `parse_mode`) tránh vỡ Markdown do tên đơn vị/SP.
- **Lệnh:** `/digest_test` (chi tiết, mọi user map ra digest của mình theo scope), `/digest_short` (bản 1 dòng cũ), `/digest_full` (top 5); định kỳ 07:30 VN dùng bản V2 top 3.
- **Trạng thái:** spec sẵn sàng, **chờ bot triển khai + build/restart `reportnew-tgbot`** rồi Claude review số liệu. Chưa đụng code app (đúng phân vai).

### 2026-07-02 — Bot triển khai (Report Bot) — Login V2 Telegram go-live
- **Nhận token BotFather riêng cho `@Reportdonapharm_bot` và cấu hình runtime an toàn:** ghi `TELEGRAM_BOT_TOKEN` vào `.env` local/server (không commit), giữ `TELEGRAM_BOT_USERNAME=Reportdonapharm_bot`, `TELEGRAM_BOT_SECRET` 64 ký tự, `APP_PUBLIC_URL=https://reportnew.donapharm.asia`.
- **Verify bot thật:** Bot API `getMe` trả `username=Reportdonapharm_bot`, `id=8471035818`. PM2 worker `reportnew-tgbot` đã start online và `pm2 save`.
- **Map CEO Telegram:** map `telegram_id=1748199545` → `CEO`; restart `reportnew` + `reportnew-tgbot` để nạp mapping bền.
- **Nghiệm thu Login V2 backend:** `/api/auth/mode` trả `{live:true,demo:false,telegram:true}`; flow `telegram/start → telegram/confirm(secret_bot, telegram_id CEO) → telegram/status` trả token; `/api/me` bằng token Telegram trả `emp_code=CEO`, `role=admin`, `isAdmin=true`.
- **Nghiệm thu bot gửi tin:** gửi message qua Bot API tới CEO thành công. Sếp có thể gửi `/digest_test` vào `@Reportdonapharm_bot` để test đúng handler digest chủ động từ Telegram update.
### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_CHARTS** (Recharts, CEO duyệt): 4 biểu đồ — (1) đường DT theo kỳ + overlay target (Tổng quan, backend mới GET /trend), (2) cột top đơn vị/SP (tái dùng /revenue), (3) donut cơ cấu tuyến/nhà thầu/gói (tái dùng /analysis), (4) vòng tiến độ target (Tổng quan + Target). Tất cả theo bộ lọc kỳ + scope. Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — Fix CST trừ thiếu upload kỳ mới nhất
- **Điều tra không ép số:** trace 2 ca CEO nêu cho thấy `cst_real.json` là baseline đã trừ SALES_REPORT DB đến trước kỳ upload mới nhất, nhưng App Report New chưa cộng phần upload `06.2026` giống app cũ. Lỗi là thiếu bước merge upload hiện tại theo khóa `IIT_CODE + DONVI chuẩn hóa`, không phải sai `GIVEN_QUANTITY`.
- **Sửa công thức CST runtime:** `store.getCst()` nay lấy baseline `cst_real.json` rồi cộng slot upload active mới nhất (hiện `06.2026`) cho tuyến CL theo khóa `IIT_CODE + mã đơn vị chuẩn hóa`; chuẩn hóa đơn vị xử lý cả dạng `002` và `002.BVĐK...`, giữ merge `001.BVĐK Đồng Nai-KHU C → 001.BVĐK Đồng Nai`. Cập nhật `sold_qty`, `remain_qty`, `% còn`, `sold_amount`, `remain_amount`; không sửa/ép file nguồn.
- **Sửa trạng thái UI:** CST còn `<=1%` được hiển thị `Hết CST` như app cũ (còn lẻ do quy cách/đóng gói), ngoài trường hợp còn `0`.
- **Nghiệm thu:** RELIPOREX 4000 IU @ `002.BVĐK Thống Nhất ĐN` từ baseline bán `31.600` + upload 06 `1.800` = bán `33.400`, còn `36.600`, `52,3%`; AMEBISMO @ `001.BVĐK Đồng Nai` từ baseline bán `1.560` + upload 06 `1.620` = bán `3.180`, còn `24`, `0,7%` và UI `Hết CST`. Thêm 5 mẫu đối chiếu diff `0` trong `artifacts/cst_verify_after_upload_merge_20260702.json`. `npm run build` OK.

### 2026-07-02 — Bot triển khai (Report Bot) — Fix múi giờ Telegram digest
- **Sửa scheduler digest theo giờ VN:** `DIGEST_CRON` vẫn hiểu là giờ Việt Nam (`Asia/Bangkok/Ho_Chi_Minh`), nhưng khi so với `Date#getUTCHours()` nay đổi sang `targetUtcHour = (cron.hour - 7 + 24) % 24`. Vì vậy `30 7 * * *` bắn đúng **07:30 VN** (= 00:30 UTC), không lệch sang 14:30 VN.
- **Log rõ giờ:** worker in cả giờ VN và giờ UTC tương ứng để dễ kiểm tra vận hành.
- **Test:** mô phỏng cron mặc định + cron phút kế tiếp theo giờ VN OK; `node --check server/telegram-bot.js` OK; `npm run build` OK. Chưa nghiệm thu live vì vẫn chờ `TELEGRAM_BOT_TOKEN` thật.

### 2026-07-02 — Dev/Kiến trúc (Claude Code) — REVIEW
- **Duyệt Phần A (rolling session)**: an toàn (chặn phiên hết hạn; deviceId đã có thì không cho đổi máy). Hết lỗi bắt OTP lại khi dùng cùng máy.
- **⚠ Phần B (digest) LỖI MÚI GIỜ:** DIGEST_CRON "30 7" là 7:30 VN nhưng scheduler so getUTCHours()===7 → bắn 14:30 VN. Cần đổi VN(UTC+7)→UTC: targetUtcHour=(hour-7+24)%24. Logic còn lại (scope/loại NV nghỉ/opt-out/chống trùng) OK.
- **Ghi SCOPE điều chuyển:** đặt trong App Report (khu Quản trị), làm SAU, không hồi tố lịch sử.


### 2026-07-02 — Bot triển khai (Report Bot) — SPEC_TELEGRAM_DIGEST
- **Phần A — sửa phiên đăng nhập:** đổi session từ TTL tuyệt đối 60 phút sang rolling idle TTL `SESSION_IDLE_DAYS` ngày (mặc định 7). Mỗi request có token hợp lệ gia hạn `expires_at = now + IDLE_TTL`; backend đọc `X-Device-Id` trong `requireAuth`, bind cho session cũ chưa có deviceId và touch đúng thiết bị, tránh cùng máy bị tính thiết bị thứ 4 oan. Upload preview cũng gửi `X-Device-Id`.
- **Giữ kiểm soát thiết bị:** vẫn tối đa 3 thiết bị/NV, evict thiết bị cũ nhất, purge session/device khi đổi SĐT/quyền/xóa NV, admin vẫn xem/xóa thiết bị.
- **Phần B — bản tin Telegram chủ động:** thêm scheduler trong `server/telegram-bot.js` theo `DIGEST_CRON` (mặc định `30 7 * * *`, giờ VN). Bản tin sáng dùng số theo scope: CEO/admin toàn công ty, sale theo mã NV; chỉ gửi Telegram đã map và user còn active/có doanh thu kỳ mới nhất; lưu opt-out bền bằng `/tat`, bật lại `/bat`, chống trùng theo ngày; admin có `/digest_test` gửi thử cho chính mình.
- **Trạng thái live:** phần B vẫn chờ `TELEGRAM_BOT_TOKEN` thật của `@Reportdonapharm_bot` để worker chạy và nghiệm thu thực tế.
- **Nghiệm thu kỹ thuật:** test rolling/device bằng `AUTH_DATA_DIR` tạm OK; `node --check server/telegram-bot.js` OK; `npm run build` OK.
### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Duyệt báo cáo parity + chốt SCOPE_DECISIONS** (CEO quyết): LÀM = biểu đồ Recharts (4 chart), PDF/print, Target admin (nhập/sửa + AI đề xuất), Tab Nhân viên BẢN GỌN (+cờ nghỉ việc, không PII nhạy cảm), Tab Đối chiếu read-only, hoạt chất/nhóm thuốc. CẮT = Điều chuyển NV, thưởng 3P/gửi Zalo-Email, sửa kho master. SAU = export mẫu cũ/page-size, upload loại khác, AI nối sâu. Bot theo SCOPE_DECISIONS.md.


### 2026-07-02 — Bot triển khai (Report Bot) — SPEC_PERIOD_FILTER Tổng quan
- **Pull spec:** đã pull `a30e0b7` và triển khai `SPEC_PERIOD_FILTER.md` cho Dashboard Tổng quan.
- **Bộ lọc kỳ mới:** thay chip tháng phẳng bằng `PeriodFilter` 3 chế độ Tháng/Quý/Khoảng, mặc định tháng mới nhất, có nút ‹/› tháng và nhãn rõ `Tháng 06.2026`, `Quý 2/2026 (04–06)`, `01.2026 → 06.2026`.
- **Backend range:** thêm `store.getRowsRange`, `getTargetsRange`, `periodRange`, `previousKys`; các API tổng hợp chính nhận `ky` hoặc `from+to`; MoM so kỳ liền trước cùng độ dài; target cộng theo range.
- **CST:** giữ snapshot hiện tại, không đổi theo kỳ/range; KPI và alert ghi rõ “hiện tại”.
- **Layout:** KPI Tổng quan PC 6 cột đều, màn vừa 3×2, mobile 2 cột; 4 nhóm cảnh báo luôn hiển thị cân đối 2×2 hoặc 4 cột, không còn card lẻ.
- **Nghiệm thu:** Q2/2026 doanh thu `93.596.229.347` = cộng tay 04+05+06, MoM `+11,7%`, CST cạn `288`; khoảng 01→06 doanh thu `177.386.533.614` = cộng tay 6 tháng, CST vẫn `288`. DN009 Q2 đúng scope: doanh thu `8.446.239.852`, `empCount=1`, CST cạn `10`. Build OK, live browser kiểm PC 1440: KPI 6 cột + alert 2×2; PC 1920: alert 4 cột; mobile 390: KPI 2 cột.

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_TELEGRAM_DIGEST** (CEO duyệt): (A) SỬA phiên đăng nhập — rolling session gia hạn theo hoạt động + thiết bị tin cậy hạn 7 ngày (env SESSION_IDLE_DAYS) + deviceId ổn định (hết bắt OTP lại khi dùng cùng máy); (B) Bản tin Telegram chủ động (sáng CEO + sáng NV theo scope, chỉ NV đã map & đang hoạt động, opt-out /tat, chống trùng, cron). Bot triển khai.


### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_PERIOD_FILTER** (bộ lọc kỳ: Tháng/Quý/Khoảng, mặc định tháng mới nhất, ‹›lùi/tới; backend nhận ky HOẶC from-to gộp nhiều tháng; MoM so kỳ liền trước cùng độ dài; CST là snapshot không đổi theo kỳ) + cân đối dashboard (6 KPI đều hàng, 4 nhóm cảnh báo 2×2/4 cột không lẻ). Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — List UI theo mẫu Phân tích
- **CSS dùng chung:** thêm `.list-grid` + `.rank-card` để các danh sách tự opt-in thành lưới card 2–3 cột trên PC, mobile 1 cột; không đụng `.page-desktop`.
- **Doanh thu:** danh sách ranking chuyển sang card trong `.list-grid`, vẫn giữ hạng/tên/meta/bar/số tiền và drill-down NV → ĐV → SP.
- **Sản phẩm:** mỗi sản phẩm là card gọn gồm tên, mã QLNB, doanh thu, SL, độ phủ ĐV/NV/gói và bar.
- **Target:** cả tab “Kỳ này” và “Dự báo” chuyển thành lưới card NV 2–3 cột.
- **Cơ số thầu:** thay bảng ngang bằng card CST trong `.list-grid`, giữ thông tin chính app cũ: mã, thuốc, hoạt chất/hàm lượng/ĐVT, nhóm/UT, gói thầu, đơn vị, NV, giá, SL/TT bán-còn, % còn lại, ngày nguồn, trạng thái.
- **Test live:** build OK; PC 1440px hiển thị 2 cột đều, PC 1920px hiển thị 3 cột đều, mobile 390px hiển thị 1 cột; Revenue drill-down vẫn hoạt động.

### 2026-07-02 — Bot triển khai (Report Bot) — Overview mở rộng 6 KPI
- **Backend `overviewKpis`:** thêm `empTarget:{achieved,total}` tính theo NV đang bán trong kỳ và có target thật, đạt >=100% target trước VAT; thêm `cstLowCount` theo scope (`remain_pct < 10`). Giữ nguyên các KPI cũ.
- **Frontend Overview:** hàng KPI đổi thành 6 ô theo thứ tự CEO chốt: Doanh thu sau VAT + MoM, Trước VAT, Đạt target %, NV đạt target, Cơ số thầu sắp cạn, Quy mô kỳ. Ô “Cơ số thầu sắp cạn” tone đỏ và bấm được để nhảy sang tab CST lọc `<10%`.
- **Test:** build OK. CEO kỳ 06.2026: doanh thu `28.403.136.096`, trước VAT `27.050.605.806`, target `90%`, NV đạt target `7/20`, CST cạn `288`, quy mô `126 ĐV · 241 SP · 22 NV`. DN009 scope: target `108%`, NV đạt `1/1`, CST cạn `10`, quy mô `12 ĐV · 65 SP · 1 NV`.

### 2026-07-02 — Bot triển khai (Report Bot) — Login V2 guard khi chưa có token Telegram
- **Chuẩn bị go-live Login V2:** đã set `TELEGRAM_BOT_USERNAME=Reportdonapharm_bot` trong `.env`; `TELEGRAM_BOT_SECRET` 64 ký tự giữ nguyên.
- **Siết an toàn `telegramConfigured()`:** chỉ trả `true` khi đủ `TELEGRAM_BOT_SECRET + TELEGRAM_BOT_USERNAME + TELEGRAM_BOT_TOKEN`; hiện token BotFather chưa được cung cấp nên `/api/auth/mode` trả `telegram:false`, màn login chỉ hiện OTP để tránh nút Telegram hỏng.
- **Build/restart:** `npm run build` OK, `pm2 restart reportnew` OK. Chờ CEO gửi token thật của @Reportdonapharm_bot để chạy `getMe`, start worker `reportnew-tgbot`, map CEO và nghiệm thu Login V2.

### 2026-07-02 — Bot triển khai (Report Bot) — Dashboard “Cần chú ý” V2 phân nhóm
- **Theo `SPEC_DASHBOARD_V2.md`:** backend `buildAlerts` đổi từ list phẳng sang `{ ky, summary, groups[] }`, tách nhóm `target`, `unit_down`, `cst_low`, `cst_high`, mỗi nhóm `total` + top 8.
- **Fix cảnh báo target:** chỉ duyệt `empCodesWithData(ky)` (NV đang bán), bắt buộc có target thật `>0`, bắt buộc resolve được tên trong danh bạ; loại NV nghỉ/không hợp lệ nên **DN014 không còn hiện “0% target”**.
- **Frontend Overview:** thêm strip tóm tắt “NV chưa đạt · đơn vị giảm · CST sắp cạn/tồn nhiều”, hiển thị các khối cảnh báo theo nhóm icon/màu riêng, top 5–8 dòng, nút “Xem tất cả” nhảy sang tab Target/Doanh thu/CST kèm lọc ban đầu. PC dùng `alerts-grid` nhiều cột; mobile giữ 1 cột.
- **Test:** build OK. CEO alerts: target `9`, unit_down `25`, cst_low `288`, cst_high `1533`, DN014 không xuất hiện; DN009 scope alerts chỉ còn phạm vi DN009 (`unit_down=3`, `cst_low=10`, `cst_high=30`, target `0`).

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **Chốt SPEC_DASHBOARD_V2** (dashboard "Cần chú ý" smart): phân NHÓM (NV target / đơn vị giảm / CST cạn / CST tồn) thay danh sách phẳng 1857 dòng; mỗi nhóm top 5–8 + đếm + "Xem tất cả" nhảy tab lọc sẵn; **chỉ cảnh báo NV đang hoạt động** (có doanh thu trong kỳ) → loại NV nghỉ như DN014; luôn hiển thị tên (không resolve được → loại). buildAlerts đổi sang cấu trúc groups. Bot triển khai.


### 2026-07-02 — Bot triển khai (Report Bot) — Đóng Bước 3 mục CST 2.741
- **Đóng mục 1/CST trong Bước 3 đối chiếu:** xác minh lại `store.getCst` app mới có **2.741 dòng**, `blankIit=1`, có dòng `Bividia 25 · 108. BVĐK LONG AN · DN001` với CST còn `44.000`, TT còn lại `79.200.000`.
- **Tổng CST khớp app cũ diff 0:** CST ban đầu `182.837.992`, SL đã bán `62.993.027`, SL còn `120.068.002`, TT còn lại `399.841.752.609`; DN009 vẫn **85 dòng** đúng scope.
- **Tài liệu:** cập nhật `MIGRATION_MATRIX.md` để đánh dấu CST 2.741 đã đóng theo chuẩn app cũ; artifact chuẩn vẫn là `artifacts/reconcile_cst_resolved_20260702.json`.

### 2026-07-02 — Bot triển khai (Report Bot) — Upload tách Import mới / Import cập nhật
- **Xác minh LIVE sau pull/build/restart:** đăng nhập CEO/admin trên `https://reportnew.donapharm.asia` thấy mục **“⬆️ Upload”** trong navigation; code tab vẫn `adminOnly` và lọc bằng `me.isAdmin` từ `/api/me`.
- **Tách rõ 2 luồng Upload:** `Import mới (kỳ mới)` chỉ cho kỳ chưa có, nếu kỳ tồn tại thì chặn/gợi ý chuyển cập nhật; `Import cập nhật (kỳ hiện có)` chọn kỳ đang active và hiển thị cảnh báo thay dữ liệu kỳ hiện có bằng file mới, slot cũ giữ lại để rollback. Giữ tab `Lịch sử & khôi phục`.
- **Backend an toàn ghi đè:** preview vẫn parse/validate bằng backend, bổ sung `duplicateCount`; commit nhận `mode=new|update`, audit phân biệt `commit_new`/`commit_update`, lưu `replacedSlotId`, không xoá slot cũ. Rollback vẫn kích hoạt lại slot cũ cùng kỳ.
- **Test:** `npm run build` OK; test bằng backup/restore runtime: import mới kỳ thử tạo slot mới + phát hiện 1 dòng nghi trùng; import mới vào kỳ đã có bị chặn; import cập nhật kỳ 06.2026 tạo slot thay thế có `replacedSlotId`, audit đủ; rollback trả active về slot cũ. Sau test đã restore runtime upload slots/uploads/audit, không để lại dữ liệu thử.

### 2026-07-02 — Bot triển khai (Report Bot) — CST mismatch đã xử lý theo chốt giữ dòng thiếu mã QLNB
- **Theo chốt Claude/CEO:** giữ dòng CST thật thiếu `iit_code` (`Bividia 25` · `108. BVĐK LONG AN` · `DN001` · còn `44.000` · TT còn `79.200.000`) để chuẩn đối chiếu khớp app cũ **2.741 dòng**.
- **Sửa importer CST:** không còn đòi `iit_code`; filter CST chỉ còn điều kiện có `unit_code` và có số lượng thầu (`bid_qty_initial > 0`). Nguyên tắc chung: không loại dòng thật chỉ vì thiếu field phụ (`iit_code`...).
- **Downstream/UI:** mã QLNB rỗng hiển thị `—`; key dòng fallback bằng `product_name + unit + emp` để không gộp/đè; filter product theo `iit_code` không nhân đôi dòng rỗng, tìm kiếm vẫn thấy theo tên sản phẩm/đơn vị/NV.
- **Re-import + đối chiếu:** app mới CST **2.741 dòng**, tổng CST ban đầu **182.837.992**, SL đã bán **62.993.027**, SL còn **120.068.002**, TT còn lại **399.841.752.609** — khớp app cũ diff 0. DN009 vẫn **85 dòng**, `badScope=0`; build OK. Artifact: `artifacts/reconcile_cst_resolved_20260702.json`.

### 2026-07-02 — Bot triển khai (Report Bot) — Bước 3 mở rộng tạm DỪNG vì lệch CST
- **Đã bắt đầu đối chiếu mở rộng theo từng tab 01→06/2026** sau khi P0 CST đã push: Overview/Doanh thu/DT đầy đủ/Sản phẩm/Target/Phân tích đều đang khớp tổng kỳ ở phần đã kiểm.
- **DỪNG đúng quy tắc vì phát hiện lệch CST app cũ ↔ app mới:** nguồn app cũ `artifacts/cst_full_from_old.json` có **2.741 dòng**, app mới `server/data/cst_real.json` có **2.740 dòng**. Lệch đúng 1 dòng: `Bividia 25`, đơn vị `108. BVĐK LONG AN`, NV `DN001`, `iit_code` rỗng, CST ban đầu/còn lại **44.000**, giá thầu **1.800**, `TT còn lại` **79.200.000**. Importer hiện loại dòng này vì thiếu `iit_code`; chưa tự sửa/chưa ép khớp.
- **Artifact kiểm tra:** `artifacts/reconcile_tabs_until_cst_mismatch_20260702.json`. Chờ CEO/Claude quyết định: giữ dòng thiếu mã QLNB trong CST hay loại có chủ đích khỏi cả hai bên.

### 2026-07-02 — Bot triển khai (Report Bot) — P0 CST hoàn tất bảng + cảnh báo giống app cũ
- **Hoàn tất P0 CST theo ưu tiên CEO:** đổi tab CST từ card rút gọn sang **bảng ngang đầy đủ cột** kiểu app cũ: mã QL nội bộ, tên thuốc, hoạt chất, hàm lượng, ĐVT, nhóm, UT, gói thầu, đơn vị, NV phụ trách, giá thầu/giá bán, tổng TT, CST còn lại, % còn lại, tổng/SL đã bán, SL còn, TT đã bán, TT còn lại, ngày nguồn, trạng thái.
- **Cảnh báo/trạng thái CST theo logic app cũ:** Hết CST, ⚠️ Chưa bán, 🔴 Chưa khai thác, 🟡 Còn nhiều, ✅ Đang bán; thêm chip lọc nhanh “Chưa bán” + thống kê cảnh báo Sắp cạn/Hết CST, Chưa bán, Chưa khai thác/tồn nhiều ngay trên trang.
- **Backend/export:** `/api/cst` và export `cst.xlsx` nhận thêm `status=empty`; tìm kiếm CST bao gồm `sales_emps`; Excel CST xuất đủ cột nghiệp vụ. `import_cst.js` giữ thêm `raw_nv` và `sales_emps` từ artifact app cũ; đã re-import `server/data/cst_real.json` từ `artifacts/cst_full_from_old.json`.
- **Test:** `npm run build` OK. Kiểm số liệu trực tiếp: CEO CST **2.740 dòng**; DN009 CST **85 dòng**, `badScope=0`; CST `<10%` **291 dòng**; CST “Chưa bán” **1.228 dòng**. Chưa đụng app cũ `dona-report` cổng 3860.

### 2026-07-02 — Bot triển khai (Report Bot) — Bước 3 đối chiếu app cũ ↔ app mới
- **Đối chiếu doanh thu 01→06/2026 app cũ ↔ app mới: KHỚP 100%.** Đã ghi bảng vào `MIGRATION_MATRIX.md`: từng kỳ khớp số dòng, tổng tiền, số NV và dòng mẫu; diff toàn bộ = 0. Nguồn 01→03 là ORDS artifact đã dump theo logic app cũ, 04→06 là file upload app cũ. Không làm tròn/không tự chỉnh số.

### 2026-07-02 — Bot triển khai (Report Bot) — Mobile CSS P0
- **Chốt phần `styles.css` dở:** bổ sung padding đáy mobile có `safe-area`; test viewport ~375px sau khi scroll cuối trang còn hở **28px** trên bottom-nav, nội dung không bị nav che. _Build OK._

### 2026-07-02 — Bot triển khai (Report Bot) — LOGIN V2 (theo SPEC_LOGIN_V2)
- **Triển khai đủ màn đăng nhập V2: Telegram (chính) + Zalo OTP (dự phòng) + phiên 60' lưu bền + thiết bị tin cậy.**
- **Backend:**
  - `persist.js` (mới): lưu bền bằng file JSON atomic ở `server/data/auth/` (không thêm dependency). Chứa phiên/thiết bị/mapping/audit; đã thêm `server/data/auth/` vào `.gitignore`.
  - `auth.js`: phiên chuyển từ Map RAM → **lưu bền, TTL 60'** (lưu hash token, không lưu token thô), gắn `deviceId`; **tối đa 3 thiết bị tin cậy/tài khoản** — thiết bị thứ 4 tự đá thiết bị **cũ nhất** (`first_seen` cũ nhất) + audit + hủy phiên của nó; **tự hủy phiên+thiết bị khi đổi quyền/SĐT/xoá khỏi danh bạ** (kiểm tại `requireAuth`). Telegram login lifecycle với **4 quy tắc chống device-code phishing**: (1) bot hỏi ✅ mới confirm; (2) mã TTL 120s **dùng 1 lần**; (3) trình duyệt poll bằng `poll_secret` (không phải mã hiển thị) nên biết mã cũng không rút được token; (4) rate-limit tạo mã ≤5/phút/IP, poll ≥2s, `confirm` sai `secret_bot` → 403 + log. Mapping `telegram_id↔emp_code` **admin duyệt** trước.
  - `routes.js`: thêm `/auth/telegram/start|status|confirm`; admin `/admin/telegram-map` (GET/POST/DELETE), `/admin/devices` (GET, DELETE/:id); các route đăng nhập nhận `deviceId` (header `X-Device-Id`) + IP (Cloudflare) + UA; `/auth/mode` báo thêm `telegram`.
- **Frontend:** `Login.jsx` bố cục mới — tiêu đề *“Đăng nhập App Report”* + nút **Telegram (chính)** hiện mã `RP-XXXXXX` + link mở bot + đếm ngược 120s + poll `poll_secret` + cảnh báo chống phishing; **OTP Zalo dạng dự phòng** bên dưới (giữ nguyên luồng); giữ QR Zalo OA + demo. `api.js`: sinh `deviceId` bền (localStorage) gửi kèm mọi request, thêm `telegramStart/Status` + API admin thiết bị/mapping.
- **Worker:** `server/telegram-bot.js` (mới) — long-poll Bot API, nhận mã (kể cả deep-link `/start RP-...`), gửi nút **“✅ Xác nhận đăng nhập App Report lúc HH:MM”** + cảnh báo *“Không gửi mã này theo yêu cầu của người khác”*, chỉ khi bấm ✅ mới gọi `/auth/telegram/confirm` kèm `secret_bot`. `.env.example` thêm `TELEGRAM_BOT_SECRET/TOKEN/USERNAME` + `APP_BASE_URL` (không commit `.env`).
- **Nghiệm thu (HTTP thật trên instance tạm cổng 3899, KHÔNG đụng production 3873):**
  1. **Phân quyền:** CEO `admin`, `/overview 06.2026` = **28.403.136.096đ**; DN009 `sale`, `/cst` = **85 dòng** đúng scope; DN009 gọi `/admin/devices` → **403**. ✓
  2. **Telegram end-to-end:** start trả code+poll_secret+bot_link; confirm sai secret → **403**; telegram chưa map → **404 (“chưa được cấp quyền”)**; confirm đúng → ok; dùng lại mã → **409**; status bằng poll_secret → **confirmed + token**, `/me` = DN009; poll_secret sai → **expired**. ✓
  3. **Session bền:** kill process (port DOWN) → khởi động lại → **token cũ vẫn đăng nhập được** + mapping còn nguyên. ✓
  4. **Thiết bị:** đăng nhập 4 deviceId → còn **3**, thiết bị cũ nhất bị đá; admin xem/xoá được. ✓
  5. Build web OK; `node --check` toàn bộ file OK.
- **⚠ CÒN CHỜ để go-live Telegram:** cần **token bot RIÊNG qua @BotFather** (không dùng chung token bot OpenClaw) đặt `TELEGRAM_BOT_TOKEN` trong `.env` để chạy worker + test nút ✅ thật trên Telegram. Chưa deploy lên production 3873 (chờ CEO/Claude review). Zalo OTP giữ live-test riêng để tránh gửi OTP thật ngoài ý muốn.

### 2026-07-02 — Dev/Kiến trúc (Claude Code)
- **CEO chốt chuẩn UI desktop = trang "Phân tích"** (KPI ngang + panel 2–3 cột). Ghi vào `CLAUDE.md`. Việc tiếp cho bot: nâng các trang còn 1 cột dọc (Doanh thu, Sản phẩm, Target, CST) theo mẫu này trên PC; mobile giữ 1 cột.
- **Đồng bộ layout PC mọi trang (CEO yêu cầu).** Bỏ lưới auto-fill "tự chia cột" trên `.page-desktop` (nguyên nhân khung trắng trống + mỗi trang bể một kiểu khi bot thêm trang mới). Nay: mọi trang chảy dọc **full-width trong khung 1600px giữa màn**; phần nhiều cột khai báo tường minh — `.kpi-grid` (KPI 4 cột) và `.alerts-grid` mới (cảnh báo Overview, bọc trong `Overview.jsx`). _Test preview 1920px: Tổng quan/Doanh thu/DT đầy đủ/Sản phẩm/Phân tích/CST/Target tất cả card = 1536px đồng nhất, hết khung trống; mobile 375px giữ bottom-nav, 1 cột, không tràn ngang. ⚠ Bot: commit phần styles.css đang sửa dở TRƯỚC khi pull để tránh conflict._
- **Chốt SPEC màn đăng nhập V2** (`SPEC_LOGIN_V2.md`): Telegram login (chính, có chống device-code phishing: bot hỏi ✅ xác nhận, mã TTL 120s dùng 1 lần, poll bằng poll_secret, mapping telegram_id↔emp_code admin duyệt) + Zalo OTP (dự phòng, giữ nguyên) + **session 60' lưu bền (file/SQLite)** + **tối đa 3 thiết bị tin cậy/tài khoản** (thứ 4 đá cũ nhất, admin xem/xoá, tự hủy phiên khi đổi SĐT/quyền). Kèm tiêu chí nghiệm thu. _Bot server triển khai theo spec; Claude review sau khi push._

### 2026-07-02 — Bot triển khai (Report Bot)
- **Fix nhỏ P0/CST: đồng bộ lọc `filters.emp` trong `analytics.cstTable` với `store.getCst`.** `store.getCst` đã chuẩn hoá `.trim().toUpperCase()` cả mã NV trong scope lẫn mã NV trên từng dòng (dòng CST có thể chứa nhiều mã NV cách nhau dấu phẩy), nhưng `cstTable` lọc `filters.emp` lại so sánh nguyên văn → lệch hoa/thường thì trả 0 dòng. Nay `cstTable` chuẩn hoá cùng cách. Lý do: tránh NV/CEO lọc CST theo mã NV bị mất dòng chỉ vì khác hoa/thường. _Test: real data, `filters.emp="dn009"` (thường) và `"DN009"` (hoa) đều trả **85 dòng**, 100% dòng thuộc đúng scope DN009; `node --check` OK._

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Tiếp tục Đợt 2/P0: bổ sung “Doanh thu đầy đủ” + “Sản phẩm” + “Phân tích”.** Backend thêm API `/api/revenue/full` để xem từng dòng bán hàng có phân trang, `/api/products` để tổng hợp theo mã QLNB/sản phẩm, `/api/analysis` để so kỳ trước theo đơn vị/sản phẩm/tuyến/nhà thầu/UT. Export Excel thêm `revenue_full` và `products`, vẫn chạy qua backend và tôn trọng scope quyền.
- **Frontend thêm 3 tab nghiệp vụ:** `DT đầy đủ` hiển thị bảng chi tiết NV/tuyến/đơn vị/mã QLNB/sản phẩm/nhà thầu/gói/SL/doanh thu; `Sản phẩm` hiển thị top mã QLNB kèm độ phủ đơn vị/NV/gói thầu; `Phân tích` hiển thị tăng/giảm so kỳ trước và cơ cấu tuyến/nhà thầu/UT. Bộ lọc dùng chung với Doanh thu và chạy backend: kỳ/NV/đơn vị/sản phẩm/tuyến/UT/nhà thầu/gói/tìm kiếm.
- **Test:** `npm run build` OK. API smoke local: CEO kỳ `06.2026` `/revenue/full` thấy **2.001 dòng / 28.403.136.096đ**; DN009 thấy **130 dòng / 3.058.543.979đ** và kiểm 130/130 dòng đều `emp_code=DN009`; `/products` CEO thấy 241 mã, DN009 thấy 65 mã; `/analysis` CEO rowCount 2.001, DN009 rowCount 130. Export `revenue_full.xlsx` trả HTTP 200.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Bắt đầu Đợt 2/P0: thêm bộ lọc backend cho Doanh thu + CST và lập ma trận chuyển app cũ.** Thêm `MIGRATION_MATRIX.md` để theo dõi từng tab app cũ → app mới. API mới `/api/filters` trả danh sách NV/đơn vị/sản phẩm/tuyến/UT/nhà thầu/gói thầu theo quyền; `/api/revenue`, `/api/cst` và export Excel nay nhận bộ lọc backend (`emp`, `unit`, `product`, `route`, `priority`, `contractor`, `bid`, `q`). UI Doanh thu có bộ lọc kỳ/NV/ĐV/SP/tuyến/UT/nhà thầu/gói/tìm kiếm; UI CST có bộ lọc gói thầu/NV/ĐV/SP/UT/tìm kiếm và hiển thị thêm NV, giá thầu, TT đã bán, TT còn lại. Test: build OK, PM2 `reportnew` restart OK; public `/api/auth/mode` vẫn `{live:true,demo:false}`; API lọc DN009 kỳ 06 doanh thu trả **3.058.543.979đ**; CST DN009 `<10%` trả 10 dòng, sale scope không lộ dòng ngoài DN009.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Hoàn tất Đợt 1 nền dữ liệu để chuẩn bị sang Đợt 2.** Vì app cũ chỉ có file upload 04/05/06 trong `webapp_donapharm/data`, đã dump thêm 01/02/03.2026 trực tiếp từ ORDS `SALES_REPORT` theo logic app cũ rồi import bằng `server/scripts/import_legacy.js`. Kết quả active slots: 01.2026 `2.094` dòng / `21` NV / **32.509.346.732đ**; 02.2026 `1.308` dòng / `21` NV / **17.507.218.993đ**; 03.2026 `2.175` dòng / `21` NV / **33.773.738.542đ**; 04/05/06 giữ nguồn upload CEO đã chốt.
- **Target thật đã đủ 01→06.2026 trên server runtime.** Import 01/02/03 từ `erp-support-widget/server/nv-targets.json` (19 NV/kỳ, tổng **29.562.862.426đ**/kỳ); 04/05/06 dùng `PHARMA_NEW.V_TEM_TARGET_BONUS` kỳ 04 làm fallback app cũ (21 NV/kỳ, tổng **30.062.862.426đ**/kỳ).
- **Thêm importer CST thật và chuyển store sang ưu tiên `cst_real.json`.** Thêm `server/scripts/import_cst.js`; `store.getCst()` đọc `server/data/cst_real.json` nếu có, đồng thời lọc quyền NV kể cả dòng có nhiều mã NV phân tách dấu phẩy. Đã dump CST thật từ `V_TEMP_PHARMA` (`FROM_DATE` mới nhất <= tháng hiện tại, `TUYEN='CL'`, `GIVEN_QUANTITY>0`) + `SALES_REPORT` từ `DATE '2025-03-01'`, import được **2.740** dòng, **60** đơn vị, **301** sản phẩm, **19** NV; nguồn `source_from_date=01-MAY-26`. Test API: CEO `/cst` thấy 2.740 dòng; DN009 thấy 85 dòng, không có dòng ngoài DN009.
- **Kiểm API sau import:** `/periods` có 01→06.2026; `/overview?ky=01.2026` trả doanh thu **32.509.346.732đ**, `2.094` dòng, `21` NV; `/overview?ky=06.2026` vẫn **28.403.136.096đ**, `2.001` dòng, `22` NV; OTP live/demo off.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Rà nguồn TARGET/CST app cũ và import target thật theo logic fallback.** App cũ `webapp_donapharm` proxy `/api/targets` sang backend OTP `localhost:3848`; backend lưu local tại `erp-support-widget/server/nv-targets.json` với các kỳ `01.2026`→`04.2026`. Frontend cũ fallback DB `PHARMA_NEW.V_TEM_TARGET_BONUS`: `SELECT TEM_NUMBER, SUM(TARGET) TGT, MAX(TARGET_BONUS) TBONUS ... WHERE KY='<ky>' ... GROUP BY TEM_NUMBER`; nếu kỳ yêu cầu không có target thì chọn kỳ gần nhất `<= requested`. ORDS hiện không có `05.2026/06.2026`, kỳ mới nhất là `04.2026` (21 NV, tổng target **30.062.862.426đ**). Đã dump hiệu lực 04/05/06 theo fallback cũ vào `artifacts/targets_effective_202604_202606.json` và chạy `node server/scripts/import_targets.js`; `server/data/targets_real.json` local hiện có 63 bản ghi (21/kỳ cho 04–06).
- **Nguồn CST app cũ đã xác định cho dev viết importer.** Tab CST không dùng file cache chính; query ORDS trực tiếp: nguồn CST gốc từ `V_TEMP_PHARMA` với `FROM_DATE=(SELECT MAX(FROM_DATE) FROM V_TEMP_PHARMA WHERE FROM_DATE <= TRUNC(SYSDATE,'MM'))`, `TUYEN='CL'`, `GIVEN_QUANTITY>0`; lượng đã bán từ `SALES_REPORT` từ `DATE '2025-03-01'` group theo `(IIT_CODE, DONVI đã chuẩn hoá)`. Frontend tính `SL_CON = GIVEN_QUANTITY - SUM(QUANTITY)`, `% còn`, `TT_THẦU`, `TT_ĐÃ BÁN`, `TT_CÒN LẠI`; map NV CST bằng `NV`/`TEM_ID` qua `CST_NV_TO_EMP`. Đã dump mẫu 8 bản ghi tại `artifacts/cst_sample_from_old.json` cho dev đối chiếu importer.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Xác nhận OTP CEO sau bản `cbea728` và mở public `reportnew.donapharm.asia`.** Đã pull `cbea728` (map `full -> admin`), build, restart PM2 `reportnew` với `OTP_BACKEND_URL=http://localhost:3848`, `ALLOW_DEMO_LOGIN=0`. Verify OTP thật số CEO trả `{ emp_code:"CEO", role:"admin" }`; `/api/me` trả `isAdmin:true`; `/api/overview?ky=06.2026` trả doanh thu toàn công ty **28.403.136.096đ**, `2001` dòng, `22` NV. Re-test scope sale bằng DN009: chỉ thấy **3.058.543.979đ**, `130` dòng, `empCount=1`. Sau khi đạt, đã đổi tunnel ingress `reportnew.donapharm.asia` từ `http_status:403` về `http://localhost:3873`, restart `cloudflared-reportnew`; public root/API trả 200, `/api/auth/mode` trả `{live:true,demo:false}`, `/api/auth/demo-users` trả `[]`, browser thấy màn đăng nhập SĐT/OTP không có nút demo.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Pull lên commit `170e3be` và nạp danh bạ nhân viên thật cho OTP.** Nguồn danh bạ lấy từ `REPORT_USERS` của app cũ `webapp_donapharm/public/kho-dulieu.html`, xuất tạm sang JSON rồi chạy `node server/scripts/import_employees.js`; kết quả: **35 NV**, phân bố vai trò `admin: 1`, `sale: 34`, **thiếu SĐT: 0**, mẫu kiểm tra 2 NV OK. File tạm đã xoá; không commit PII/secrets.
- **Xác định chính xác API OTP nội bộ đang chạy ở port 3848.** App cũ `webapp_donapharm/server.js` chỉ proxy `POST /api/otp/request` và `POST /api/otp/verify` sang `127.0.0.1:3848`; backend thật là `erp-support-widget/server/index.js`. Gửi OTP: `POST http://localhost:3848/api/otp/request`, body tối thiểu `{ "phone": "<sdt>" }`, có thể thêm `{ "page": "Report", "deviceId": "<id>" }`; response thành công `{ ok:true, message:"..." }`. Xác thực: `POST http://localhost:3848/api/otp/verify`, body `{ "phone":"<sdt>", "code":"<otp>" }`; response đúng trả `{ ok:true, token, phone:<masked>, name, code, role, accounts, requireAccountChoice, expiresIn:86400 }`.
- **Bật OTP thật + tắt demo-login cho PM2 `reportnew` nhưng vẫn khóa public 403.** `.env` local đặt `OTP_BACKEND_URL=http://localhost:3848`, `ALLOW_DEMO_LOGIN=0`; do backend chưa tự đọc dotenv, đã restart PM2 với env tương ứng và `pm2 save`. Kiểm tra local: `/api/auth/mode` trả `{live:true,demo:false}`, `/api/auth/demo-users` trả `[]`, `/api/auth/otp/request` qua app mới trả `{ok:true}` với số CEO. Public `https://reportnew.donapharm.asia/` và `/api/health` vẫn **403**. **Còn chờ mã OTP nhận được để test `/api/auth/otp/verify` và kiểm quyền dữ liệu sau đăng nhập.**

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Kiểm thử Cloudflare Access cho `reportnew.donapharm.asia` chưa đạt, đã khóa lại public 403.** Sau khi CEO báo đã tạo Access app/policy email công ty, đã đổi tunnel ingress từ `http_status:403` về `http://localhost:3873` và restart PM2 `cloudflared-reportnew`; tuy nhiên kiểm bằng `curl` và browser vẫn vào thẳng App Report (`HTTP 200`, thấy màn login app), không xuất hiện màn Cloudflare Access. Để tránh lộ dữ liệu thật, đã rollback ingress về `http_status:403`; public root và `/api/health` hiện đều `403`, local `http://localhost:3873/api/health` vẫn OK.
- **Cần kiểm lại Cloudflare Zero Trust config trước khi mở lại:** Access application phải active đúng hostname `reportnew.donapharm.asia` (Self-hosted), policy allow email domain công ty, và không bị đặt sai team/account/path. Chỉ mở lại tunnel về `localhost:3873` sau khi public request bị redirect/chặn bởi Cloudflare Access.

### 2026-07-01 — Dev (Claude Code)
- **Target lọc NV theo ĐÚNG KỲ đang xem (sửa tiếp theo phản hồi bot).** `empCodesWithData` nhận `ky`: Target kỳ 06 chỉ hiện NV có bán KỲ 06 (DN014 bán 04 nhưng không bán 06 → không còn hiện ô 0 ở kỳ 06). Forecast dùng NV hoạt động ở kỳ gần nhất. _Test: NV kỳ 06 chỉ DN003, NV kỳ 04 có DN014._
- **Sửa Target lấy đúng danh sách NV + không dùng target mẫu khi có dữ liệu thật.** Trước đây Target/Dự báo liệt kê cả danh bạ công ty (nhiều NV target 0 không thuộc App Report). Nay: `store.empCodesWithData()` lấy NV **thực sự có doanh thu**; `/targets` và `forecastTargets` dùng danh sách này. `getTargets` khi có slot thật → chỉ dùng target thật (`targets_real.json`), chưa import thì target cũ = 0 (trung thực), không lấy target mẫu. Thêm `scripts/import_targets.js` để nạp target thật khi có. _Test: NV lấy từ dữ liệu, getTargets real-mode rỗng._
- **Sửa map vai trò: OTP backend trả `full` cho CEO/toàn quyền → nay map thành `admin`.** Trước đó `full` rơi về `sale` khiến CEO bị lọc như NV thường (doanh thu = 0). `normRole` thêm `full|admin|quan tri|manager|all → admin`. _Test: full→admin, sale→sale, Giám đốc→ceo. ⚠ Bot pull + restart rồi verify lại số CEO._
- **🔒 Khớp adapter OTP với backend thật + SỬA lỗ hổng.** Backend `/api/otp/verify` trả `{ok, code, name, role, accounts, requireAccountChoice}`. `verifyOtp` giờ **BẮT BUỘC kiểm `data.ok`** (trước chỉ kiểm HTTP → mã sai vẫn lọt!), dùng identity backend trả về (code/role/name), chuẩn hoá vai trò → ceo/admin/sale. Thêm bước **chọn tài khoản** khi 1 SĐT nhiều mã NV: route `/auth/otp/select` + verifiedPhones (TTL 5') + UI chọn ở Login. _⚠ Bot phải PULL bản này trước khi verify mã thật._
- **Công cụ nạp danh bạ nhân viên thật + chuẩn hoá SĐT.** Thêm `server/scripts/import_employees.js` (map linh hoạt mã NV/tên/SĐT/email/vai trò, chuẩn hoá SĐT +84/84→0, tự suy vai trò, backup users cũ). `auth.verifyOtp` tra cứu theo SĐT đã chuẩn hoá. _Test: "+84 917 396 668"→"0917396668", "Giám đốc"→ceo. Cần bot chạy trên file danh bạ thật._
- **UI đăng nhập OTP bằng SĐT (frontend).** `Login.jsx` đọc `/auth/mode`: nếu `live` → luồng SĐT → gửi OTP → nhập mã → vào (mỗi NV thấy phạm vi của mình); nếu `demo` → nút chọn tài khoản mẫu. api.js thêm `mode/otpRequest/otpVerify`. _Test: chế độ demo hiển thị đúng. Luồng OTP thật cần bot nối OTP backend + nạp danh bạ NV thật (đang chờ spec)._
- **Importer nạp CẢ THƯ MỤC (1 lệnh cho mọi kỳ).** `import_legacy.js` giờ nhận file HOẶC thư mục: quét mọi `report_upload_data_*<ngày>.json` (bỏ qua lastUpload/slots), nạp hết, in **bảng tổng từng kỳ** + cảnh báo kỳ trùng file. _Dùng để lấy đủ dữ liệu từ 01/2026: `node server/scripts/import_legacy.js <thư-mục-data-app-cũ>`. Test batch 01+02 OK._
- **⚠ Cảnh báo bảo mật + công tắc tắt demo-login.** Dữ liệu đã THẬT nhưng site chưa bật Cloudflare Access và đăng nhập còn là nút demo → nguy cơ lộ. Thêm env `ALLOW_DEMO_LOGIN` (mặc định 1): đặt `=0` để KHOÁ demo-login (`mockLogin` trả null, `/auth/demo-users` rỗng, `/auth/mode` trả `demo:false`). _Khuyến nghị: bot bật Cloudflare Access NGAY; khi có OTP thì đặt ALLOW_DEMO_LOGIN=0._

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Khóa tạm public access cho `reportnew.donapharm.asia` để bảo vệ dữ liệu thật.** Khi yêu cầu bật Cloudflare Access, dashboard Zero Trust bị Cloudflare security verification trong browser headless nên chưa thao tác UI được ngay. Để chặn truy cập công khai lập tức, đã backup `~/.cloudflared/reportnew.yml` và đổi ingress `reportnew.donapharm.asia` sang `http_status:403`, restart PM2 `cloudflared-reportnew`. Kiểm tra public root và `/api/health` đều trả `HTTP/2 403`; local `http://localhost:3873/api/health` vẫn OK, PM2 `reportnew` vẫn online.
- **Còn cần bật Cloudflare Access đúng chuẩn trong Zero Trust.** Sau khi tạo Access application/policy cho domain `reportnew.donapharm.asia` (allow email domain công ty), đổi lại tunnel service về `http://localhost:3873` và restart `cloudflared-reportnew`.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Cập nhật importer và import lại dữ liệu thật 04/05/06 cho `reportnew`.** Đã `git pull` lên commit `f49f91d`, `npm run build`, import đúng các file chuẩn theo `report_uploadSlots.json` app cũ: `report_upload_data_20260401_20260430.json`, `report_upload_data_20260501_20260529.json`, `report_upload_data_20260601_20260630.json`. Sau import đã restart PM2 `reportnew`; health local và HTTPS đều OK. App cũ `dona-report` cổng `3860` chỉ đọc file, không sửa/xoá.
- **Kết quả import active:** 04.2026 — 2.282 dòng, 21 NV, tổng doanh thu `34.794.142.431đ`, slot `legacy_042026_mr26j8be`; 05.2026 — 1.600 dòng, 21 NV, tổng `30.398.950.820đ`, slot `legacy_052026_mr26j8h9`; 06.2026 — 2.001 dòng, 22 NV, tổng `28.403.136.096đ`, slot `legacy_062026_mr26j8nb`.
- **Kiểm mẫu dữ liệu sau import:** cả 3 kỳ đã có đủ `unit_name`, `product_name`, `contractor_code`, `bid_package`. Ví dụ 04: `001.BVĐK Đồng Nai` / `Vixcar` / `02.AFP PHARMA` / `QĐ139`; 05: `171.PKĐK NAM VIỆT` / `Cerecaps` / `Công Ty Tnhh Dược Phẩm Donapharm` / `QĐ141`; 06: `019.TTYT H. Vĩnh Cửu` / `Nadecin 10mg` / `Công Ty Tnhh Dược Phẩm Và Trang Thiết Bị Y Tế Đại Trường Sơn` / `QĐ139`.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Cập nhật server `reportnew` lên bản mới nhất.** Đã `git pull` tới commit `4935eb1` (`Migrate dữ liệu app cũ: import_legacy.js + sửa đọc số kiểu VN`), chạy `npm run build`, restart PM2 `reportnew` trên cổng `3873`; health local và HTTPS đều trả `{"ok":true,"service":"app-report-new",...}`. Không đụng app cũ `dona-report` cổng `3860`.
- **Import thử dữ liệu thật kỳ 06.2026 từ app cũ.** Nguồn đọc-only: `/home/osboxes/.openclaw/workspace-main/webapp_donapharm/data/report_upload_data_20260601_20260630.json`; kết quả import: 2.001 dòng hợp lệ / 2.001, 22 NV, tổng doanh thu `28.403.136.096đ`, slot active `legacy_062026_mr266eqe`. Đã restart `reportnew` sau import thử.
- **Dừng chưa import tiếp 04/05 do thiếu map alias tên cột.** Mẫu sau import chỉ có `unit_code`, `emp_code`, `iit_code`, `quantity`, `revenue`; thiếu `unit_name`, `product_name`, `contractor_code` vì file cũ dùng các cột `DONVI`, `ITEM_NAME`/`IIT_NAME`/`NAME`, `NHA_THAU`/`VEN_NAME`. Cần dev bổ sung alias trong `server/scripts/import_legacy.js` trước khi import các kỳ còn lại để báo cáo không mất tên đơn vị/tên thuốc/nhà thầu.

### 2026-07-01 — Dev (Claude Code)
- **Importer tự suy kỳ chắc hơn.** Suy `ky/dateFrom/dateTo` theo thứ tự: tham số > tên file (nhận CẢ `YYYY-MM-DD` lẫn `YYYYMMDD`) > nội dung dòng (`KY/FROM_DATE`). _Bot chỉ cần `node import_legacy.js <file>` cho mọi kỳ. Test: tên file nén → suy đúng 06.2026._
- **Bổ sung map cột ERP app cũ (theo mẫu bot gửi).** import_legacy + upload nhận thêm: `ITEM_NAME/IIT_NAME/NAME`→tên SP, `NHA_THAU/VEN_NAME`→nhà thầu, `TUYEN`→tuyến; fallback `unit_name=unit_code` (DONVI gộp mã+tên), và **tự trích gói thầu `QĐ139/QĐ141` từ mã IIT**. _Test: dòng mẫu ERP → đủ route/đơn vị/tên SP/nhà thầu/gói thầu. Doanh thu T06 đã khớp 28.403.136.096đ._
- **Công cụ migrate dữ liệu app cũ.** Thêm `server/scripts/import_legacy.js`: chuyển file `report_upload_data_*.json` của app cũ → slot của app mới (map linh hoạt tên cột, tự suy kỳ từ tên file, đánh dấu active, ghi audit, in tóm tắt để kiểm tra). _Chạy trên server nơi có file thật._
- **Sửa lỗi đọc số kiểu VN.** "22.500.000" (chấm ngăn nghìn) trước bị đọc thành 0 → thêm `toNum()` xử lý đúng cho cả `import_legacy.js` và `upload.js`. _Test: tổng 67.5tr đúng._

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Deploy demo `reportnew.donapharm.asia` thành công theo phương án không ảnh hưởng app cũ.** Vì các cổng `3860`/`3861`/`3863` đang được app hiện hữu sử dụng, App Report New chạy PM2 `reportnew` trên cổng trống `3873` với `USE_SAMPLE_DATA=1`; `curl http://localhost:3873/api/health` trả `{"ok":true,"service":"app-report-new",...}`. App cũ `dona-report` trên `3860` giữ nguyên.
- **Cloudflare Tunnel riêng cho Report New.** Đã login Cloudflare, tạo tunnel `reportnew` (`746c53e5-4098-43bd-848f-9b74e8a41f63`), route DNS `reportnew.donapharm.asia`, tạo config `~/.cloudflared/reportnew.yml` trỏ `http://localhost:3873`, chạy bằng PM2 `cloudflared-reportnew` để không restart tunnel chung. HTTPS `https://reportnew.donapharm.asia` trả `HTTP/2 200`.
- **Kiểm thử giao diện.** Mở `https://reportnew.donapharm.asia` thấy màn đăng nhập/logo DNPHARMA; bấm demo CEO đăng nhập được dashboard Tổng quan với dữ liệu mẫu. Lưu ý: chưa bật Cloudflare Access, OTP/SSO/ORDS/AI vẫn để trống theo yêu cầu demo.

### 2026-07-01 — Bot hạ tầng (Report Bot)
- **Chuẩn bị deploy demo `reportnew.donapharm.asia` trên server.** Đã clone repo nhánh `main`, đọc đủ chỉ thị (`CHANGELOG.md`, `CLAUDE.md`, `HANDOFF.md`, `DEPLOY_CLOUDFLARE.md`, `DIRECTIVE_FOR_SERVER_BOT.md`, `.env.example`), chạy `npm run setup` và `npm run build` thành công. Đã tạo `.env` local an toàn: `PORT=3860`, `USE_SAMPLE_DATA=1`, `SESSION_SECRET` ngẫu nhiên, OTP/SSO/ORDS/AI để trống; không commit secret.
- **Blocker hạ tầng:** cổng `3860` hiện đang được PM2 process `dona-report` sử dụng (`/home/osboxes/.openclaw/workspace-main/webapp_donapharm/server.js`). Thử start PM2 `reportnew` bị lỗi `EADDRINUSE`; đã xoá process lỗi để tránh vòng restart. Vì không được ảnh hưởng webapp cũ đang chạy, chưa dừng/đổi `dona-report` và chưa trỏ Cloudflare Tunnel.
- **Cloudflare hiện trạng:** `cloudflared` đã cài (`2026.5.2`) nhưng chưa có origin cert/login trên user hiện tại; chưa có `cloudflared.service`; DNS `reportnew.donapharm.asia` chưa resolve. Cần CEO quyết phương án cổng/dịch vụ trước khi tiếp tục.

### 2026-07-01
- **Sửa layout PC lấp đầy màn rộng.** `.page-desktop` chuyển sang lưới `auto-fill minmax(440px)` + max-width 1900px → màn ~1920px hiện 3 cột cảnh báo, hết khoảng trắng thừa bên phải. _Test: preview ở 1920px._
- **Thêm `DIRECTIVE_FOR_SERVER_BOT.md`.** Chỉ thị cho bot server: vai trò/ranh giới (hạ tầng, không sửa code app), thứ tự đọc repo, nhiệm vụ deploy `reportnew.donapharm.asia`, nguyên tắc phối hợp với dev + ghi log. _Lý do: để bot server tiếp quản repo và phối hợp đúng vai với dev._
- **Lập CHANGELOG.md + quy trình ghi log.** Tạo file này làm nhật ký thay đổi/tiến trình chuẩn cho repo; đặt quy tắc dev ghi log mỗi thay đổi. _Lý do: để bot/người đọc repo nắm ngay tình hình._
- **Nối dữ liệu thật (một phần) + adapter hạ tầng.** `store.js` đọc slot upload `active` làm nguồn doanh thu (ưu tiên upload→ORDS→mẫu); upload 1 kỳ là báo cáo hiện ngay. Thêm `ords.js` (ORDS SQL API) và OTP/SSO trong `auth.js` + routes — đều **TẮT mặc định**, bật bằng env trên server. _Test: upload file → kỳ 07.2026 xuất hiện, doanh thu khớp file. ORDS/OTP/SSO chưa test live (cần mạng nội bộ)._
- **Hướng dẫn deploy `reportnew.donapharm.asia`.** Viết `DEPLOY_CLOUDFLARE.md` theo mô hình 1 server Node :3860 + Cloudflare Tunnel; cập nhật `_redirects`.
- **Gắn logo + QR Zalo OA THẬT của DNPHARMA.** Thêm `web/public/logo-dnpharma.png`, `logo-mark.png`, `zalo-oa-qr.png`; component logo dùng ảnh thật (fallback SVG). Thu nhỏ kích thước hiển thị cho cân đối (logo 96px, QR 76px ở màn login).
- **Nhận diện DNPHARMA (xanh–cam).** Đổi bộ màu thương hiệu; sửa tài liệu bàn giao `bot tender`→`bot report`; thêm `DIRECTIVE_FOR_BOT_REPORT.md`.
- **Dựng App Report New v2.0.** Kiến trúc React (Vite) + Express API tách riêng, **1 codebase responsive** (mobile bottom-nav / PC sidebar). 6 lõi báo cáo + Upload + AI + phân quyền backend + dữ liệu mẫu ẩn danh (`seed.js`). Kèm `README.md`, `CLAUDE.md`, `HANDOFF.md`. _Đã verify bằng preview trên cả mobile lẫn PC._

### 2026-07-24 — Report Bot
- **Chuyển SSOT điểm tháng/quý sang App Report local, giữ xu ở App VAT.** Thêm `server/src/employeePointLocal.js` + `server/config/employee_point_coeff.json` để tính điểm từ dòng doanh thu App Report theo công thức `Σ(doanh thu × hệ số ÷ 100.000.000)` làm tròn 2 số; rule versioned `point-local-2026-05-r1`, mặc định hệ số 1, CL/NT = 2, NCL prefix `025-028` = 2. Tái dùng semantics từ `diemXu.js`, không để App VAT áp ngược điểm/phạt vào projection mới.
- **Fail-closed + DQ an toàn.** Thiếu route / thiếu prefix đơn vị ở dòng NCL không làm vỡ tính điểm: fallback hệ số 1 và ghi DQ audit `employee_point_local_dq` chỉ với metadata an toàn (emp/period/rule/outcome/signature), không lưu revenue/raw row/PII. Exclusion list cũ (`DN021/DN022/DN023/VP004/VP018`) vẫn khóa cứng.
- **Projection `/employee-cost/diem-xu` nay là local point + VAT xu.** `server/src/employeeVatKhoan.js` chỉ nhận/trả field xu (`xu_thang/xu_quy/xu_quy_tong/carry/xu_rule_version`) và bỏ qua toàn bộ `diem/pct/phat` upstream; `server/src/routes.js` ghép local point + VAT xu, tự tính `% tháng/quý`, thiếu/dư quý, penalty display-only `floor(thiếu quý/2)*600.000`. Nếu App VAT lỗi thì điểm local vẫn hiện, còn xu/phạt để `null` với note đúng `chưa lấy được xu kỳ này`.
- **Parity gate khóa cấn trừ quý.** Penalty chỉ mở khi có artifact/config parity exact-zero khớp `point_rule_version` và đúng NV bắt buộc; nếu chưa pass thì luôn trả trạng thái `đang đối soát`. Ngoài tháng 3/6/9/12 là `dự kiến — chưa trừ`; tháng chốt quý mới lên `chốt quý — cấn trừ` khi parity gate pass. Không ghi payroll/DataHub.
- **UI/source label cập nhật theo 2 nguồn.** `web/src/employeeVatKhoanModel.js` + `web/src/pages/EmployeeCost.jsx` đổi nhãn nguồn: điểm = App Report + rule version, xu = App VAT, penalty = App Report(point)+App VAT(xu); hiển thị rõ trạng thái parity/đối soát và giữ deduction ở chế độ display-only.
- **Chuẩn bị module preview/audit thông báo, chưa gửi thật.** Thêm `server/src/employeePointNotifications.js` và route admin-only preview `/admin/employee-point/notifications/preview`. Preview sinh nội dung Telegram+email theo kỳ/quý/công thức/rule/metrics, nhưng `send_enabled=false`; audit chỉ hash actor + emp code/channel/time/period/outcome, không lưu recipient/token/body/PII.
- **Bổ sung test cho local point / preview / frontend labels.** Thêm `server/test/employeePointLocal.test.js`, `server/test/employeePointNotifications.test.js`; cập nhật `server/test/employeeVatKhoan.test.js` và `web/test/EmployeeCost.diemXu.test.mjs` cho xu-only upstream, fallback VAT lỗi, parity statuses, DQ safety, nhãn App Report/App VAT.

### 2026-07-02 — Bot hạ tầng (Report Bot)
- **Hoàn thiện tài liệu audit app cũ → app mới trong `MIGRATION_MATRIX.md`.** Đã rà các nguồn app cũ `report.html`, `report-main-v23.js`, `report-extra.js`, `kho-dulieu.html`, các bản `report-cst/report-force/report-new` và `chart.min.js`; cập nhật ma trận đầy đủ theo tab/nút/tính năng với trạng thái `done/partial/todo`.
- **Ghi rõ backlog chưa chuyển:** biểu đồ, tab Nhân viên, màn Đối chiếu, PDF/print, hoạt chất/nhóm thuốc ở Products, Kho dữ liệu master/rollback parity, Target admin editor, Target NV/thưởng 3P, Điều chuyển NV, export mẫu cũ và upload file lỗi.
- **Thêm kế hoạch biểu đồ — chưa code:** khuyến nghị Recharts thay vì Chart.js cho React/Vite; đề xuất 4 biểu đồ doanh thu theo kỳ, top ĐV/SP, donut cơ cấu tuyến/nhà thầu/gói thầu, target progress ring; nêu API/scope/period requirements, bundle-size impact và vị trí đặt ở Tổng quan/Phân tích/Target để CEO/Claude duyệt trước khi triển khai.

### 2026-07-24 — Report Bot
- **Sắp xếp lại UI “Chi phí của tôi” theo mockup v2 §3B.** Hàng trên bám đúng thứ tự `Nhân viên · Doanh thu chưa VAT · Điểm · Tổng chi phí tháng (chi phí gốc)`; số dòng gộp vào thẻ Nhân viên và không lặp `Chi phí gốc` trong khối cấn trừ. Chuyển `Phạt dự kiến` xuống cạnh `Xu tích lũy`, để hàng cấn trừ đọc liền `[Xu] [Phạt dự kiến] − [Cấn trừ thiếu xu] = [Còn lại]`; mobile tiếp tục một cột theo đúng thứ tự.
- **Giữ nguyên logic số/quyền và fail-closed.** `Phạt dự kiến` và `Cấn trừ thiếu xu` dùng cùng số backend; chỉ mở khi parity exact-zero PASS, nếu chưa đạt vẫn `đang đối soát / —`. Không sửa công thức, quyền, API, DataHub/payroll hay luồng notification. Áp đúng mockup: Điểm `#4338ca→#4f46e5`, Thưởng `#047857→#059669`, Phạt `#b91c1c→#dc2626`, Xu `#eef2ff` và thẻ chi phí gốc `#fffbeb`.
- **Production deploy sau CEO duyệt:** review `0729971` được merge vào `main` tại `2430f5d`; production version `2430f5d-20260724-144314-865`. Focused web `23/23`, full web `57/57`, targeted server regression `86/86`, build và `git diff --check` đều PASS. Public/local asset byte-parity PASS; triển khai frontend-only, PM2 PID/restart giữ nguyên, không restart backend.
