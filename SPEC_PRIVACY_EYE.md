# SPEC — CON MẮT CHE SỐ (Privacy Eye)

> Trạng thái: **hiệu lực từ 10/08/2026**. Bản này **thay thế** mọi mô tả cũ về con mắt
> trong runbook vận hành (luật 60 giây · ẩn khi mất tiêu điểm · không nhớ qua F5).
> Code: `web/src/privacyMask.js` (lõi, test được bằng `node:test`) + `web/src/privacy.jsx`
> (nối vào React). Test khoá hành vi: `web/test/PrivacyEye.test.mjs`.

## 1. Đây là cái gì — và KHÔNG phải cái gì

Con mắt là **tấm rèm che mắt người đứng sau lưng**. Nó đổi chữ số trên màn thành `•••••••`.

**Nó KHÔNG phải khoá bảo mật.** Số vẫn nằm trong bộ nhớ trình duyệt và trong phản hồi
mạng; mở F12 là đọc được. Khoá thật nằm ở backend: `employeeCostVisibility` (có audit)
và `auth.scopeOf`. Cấm mô tả tính năng này là "bảo mật"/"an toàn" — có test chặn.

File xuất (Excel/PDF) **luôn có số thật** vì đi qua backend; cạnh nút xuất có dòng nhắc.

## 2. Luật hiện hành

| Tình huống | Số ra sao |
|---|---|
| Mặc định khi mở app | **ẩn** |
| Bấm con mắt | hiện |
| Không thao tác **5 phút** | tự ẩn |
| **Bấm công cụ chụp màn hình** | **vẫn hiện** |
| Chuyển hẳn sang tab khác / thu nhỏ cửa sổ | ẩn ngay |
| **F5 mà vẫn đúng màn đó, còn trong hạn** | **vẫn hiện** |
| Đổi trang | ẩn ngay |
| Đổi nhân viên | ẩn ngay |
| Đổi đơn vị / tỉnh / tuyến / ngày / kỳ | ẩn ngay |
| Đóng tab / đóng trình duyệt | quên sạch |
| Đang ẩn | **khoá 5 nút ghi tiền** (Duyệt · Từ chối · Mở khoá · Ghi đã trả · Gỡ ghi nhận) |

### Chế độ 📽 Trình chiếu (công tắc cạnh con mắt, đỏ khi bật)

| | |
|---|---|
| Bấm bật | **ẩn ngay** + xoá mốc |
| Đang bật | **không ghi mốc nào** ⇒ F5 chắc chắn ra ẩn |
| Tự ẩn | rút còn **1 phút** |
| Bấm tắt | **không tự mở lại** — vẫn phải bấm con mắt |
| Bản thân công tắc | **nhớ qua F5** (không bắt bật lại giữa buổi họp) |

## 3. Vì sao đổi luật cũ

### 3.1 Bỏ "mất tiêu điểm là ẩn ngay"

> CEO 10/08/2026: *"tao phải dùng điện thoại để chụp hình kèm chụp hình máy tính, vì khi
> bấm chụp hình máy tính thì con mắt nó che mất số."*

Luật cũ nghe `window.blur`. Công cụ cắt màn hình của Windows **cướp tiêu điểm** khỏi trình
duyệt ⇒ `blur` bắn ⇒ số bị che **đúng khoảnh khắc bấm chụp**. Ảnh chụp màn hình luôn ra
`•••••••`, CEO phải chụp lại bằng điện thoại. Nay chỉ nghe `visibilitychange` — tức là
**chuyển hẳn** sang tab khác. **Cấm nối lại `blur`**, có test chặn.

### 3.2 60 giây → 5 phút

Quá ngắn để đọc và đối chiếu một màn KPI.

### 3.3 Nhớ qua F5, nhưng **gắn với màn đang xem**

> CEO: *"tao vẫn muốn khi F5 lại thì chưa ẩn vội con mắt."*
> CEO (ngay sau đó): *"tôi đang trình chiếu trên màn hình LED mà vô tình lọt các con số %
> và tổng tiền các ô thì rất là lỗ hổng. Đặc biệt là khi F5 lại hoặc sang trang khác, hoặc
> chuyển từ NV này qua NV khác, hoặc chuyển từ đơn vị này qua đơn vị khác."*

Hai yêu cầu này chỉ mâu thuẫn nếu nghĩ theo **thời gian**. Nguy hiểm thật nằm ở **nội dung
màn hình đổi**: số CEO chủ động mở ra thì CEO biết nó đang hiện; nhưng đổi trang/NV/đơn vị/kỳ
thì **số MỚI tự nhảy ra** khi chưa ai quyết định — đó mới là lúc lọt lên màn LED.

Nên việc mở số **gắn với một khoá ngữ cảnh**: `trang · NV · đơn vị · tỉnh · tuyến · ngày · kỳ`.
Khoá lệch ⇒ coi như chưa mở, **ẩn ngay, không chờ hết giờ**, kèm câu *"Đã ẩn số vì màn hình
vừa đổi"* để không ai tưởng app lỗi.

## 4. Cách cài đặt (điểm cần biết khi review)

- Lưu **MỐC HẾT HẠN + khoá ngữ cảnh** (`{until, ctx}`), **không** lưu cờ "đang mở".
  Nhờ vậy **F5 không gia hạn**: đồng hồ chạy tiếp từ thao tác cuối, tải lại 10 lần cũng
  không dài thêm phút nào.
- **`sessionStorage`, tuyệt đối không `localStorage`** — đóng trình duyệt là mất sạch,
  không để vết trên máy dùng chung. Có test cấm gọi `localStorage`.
- **Ẩn vì bất kỳ lý do gì đều xoá mốc** ⇒ F5 sau đó ra ẩn, không "hồi sinh".
- Ngữ cảnh chia **hai tầng**: `scope` (App khai — tab) và `detail` (trang khai — NV/đơn vị/kỳ).
  Phải tách vì **effect của con chạy TRƯỚC cha**; để chung một ô thì cha ghi đè con và mất
  sạch lớp chặn đổi NV.
- Provider **luôn khởi động ở trạng thái ẩn**; khôi phục (nếu có) do lớp ngữ cảnh quyết định
  sau khi trang đã khai báo mình đang xem gì — sai về phía an toàn.
- Chặn sẵn: mốc rác/JSON hỏng ⇒ ẩn · thiếu khoá ngữ cảnh ⇒ ẩn · đồng hồ máy bị chỉnh ⇒ trần
  đúng một chu kỳ · kho bị chặn (tắt cookie/hết quota) ⇒ nuốt lỗi, rèm vẫn chạy.

## 5. Nhắc cho vận hành

Runbook nào còn ghi *"tự ẩn sau 60 giây"*, *"ẩn khi cửa sổ mất tiêu điểm"* hoặc *"F5 là về
ẩn"* thì **đã lỗi thời** — sửa theo bảng ở mục 2. Ba điều đó là **quyết định của CEO ngày
10/08/2026**, không phải sai sót cài đặt.
