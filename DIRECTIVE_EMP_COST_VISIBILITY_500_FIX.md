# DIRECTIVE — SỬA "Lỗi máy chủ" trang Chi phí của tôi (500 ở /employee-cost/visibility)

> Claude Code giao Report Bot. Cùng nhánh review `review/employee-cost-templates-20260722` (kèm đợt fix lookup `6ef5e3c`).
> **Triệu chứng (ảnh CEO):** panel "Quản trị quyền tự xem chi phí" hiện **"Lỗi máy chủ"**, ô chọn NV **"Chưa có nhân viên"**,
> bảng **"chưa có dữ liệu"**. Đây là **1 lỗi backend lan ra 3 chỗ**, KHÔNG phải 3 lỗi.

## 1. NGUYÊN NHÂN GỐC (đã khoanh vùng trong code nhánh review)
Trang ADMIN gọi `GET /employee-cost/visibility` — endpoint này **cũng nạp danh sách NV** cho picker. Nó **crash 500**.
Chỗ văng: `server/src/employeeCostRoster.js` → `loadConfig()`:
```js
function loadConfig(filePath = process.env.EMPLOYEE_COST_GROUP_CONFIG || DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));  // ← throw nếu file thiếu / path sai / JSON hỏng
  return raw && typeof raw === 'object' ? raw : {};
}
```
`loadConfig()` là default-arg của `buildRoster()` → gọi bởi `employeeCostRosterRows()` → gọi **trực tiếp** trong route
GET (sync, không try/catch). File thiếu/`EMPLOYEE_COST_GROUP_CONFIG` trỏ sai/JSON hỏng ⇒ **throw đồng bộ** ⇒ Express
500 trơn ⇒ FE (`api.js`: `throw new Error(data.error || 'Lỗi máy chủ')`) chỉ nhận 500 không kèm `error` ⇒ hiện
**"Lỗi máy chủ"** chung chung.

Phụ: 2 route GET `/employee-cost/visibility` và `/employee-cost/employees` **không bọc bắt lỗi** như route POST
(`asyncJsonRoute`) → lỗi thật không lọt ra `{error}` → không đọc được lý do. `store.targetRoster`/persist đã có fallback,
KHÔNG phải thủ phạm; thủ phạm là `loadConfig` đọc file **không phòng vệ**.

> `/me` khi login ADMIN short-circuit `{enabled:true}`, không đụng `loadConfig` → login OK, chỉ **mở trang chi phí mới lộ**. Khớp triệu chứng.

## 2. CHẨN ĐOÁN NHANH (chạy trên máy đang chạy app — bot có log/instance)
```bash
echo "ENV: $EMPLOYEE_COST_GROUP_CONFIG"                                   # có trỏ sai path không?
node -e "JSON.parse(require('fs').readFileSync('server/config/employee_cost_groups.json','utf8'));console.log('config OK')"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3873/api/employee-cost/visibility   # kỳ vọng đang 500
# → đọc stack log server: phải trỏ tới loadConfig / readFileSync
```
Kiểm thêm: file `server/config/employee_cost_groups.json` **có mặt trên bản deploy/CWD đang chạy** không; env
`EMPLOYEE_COST_GROUP_CONFIG` (nếu set) trỏ **đúng**.

## 3. SỬA (2 phần)
1. **Làm cứng `loadConfig` (fix gốc):** bọc `try/catch`; file thiếu/hỏng/không đọc được → **fallback `{}`** (roster vẫn
   dựng với nhóm mặc định, trang render bình thường, KHÔNG 500). Config nhóm là **tùy chọn** → thiếu phải **suy biến mượt**.
   ```js
   function loadConfig(filePath = process.env.EMPLOYEE_COST_GROUP_CONFIG || DEFAULT_CONFIG_PATH) {
     try {
       const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
       return raw && typeof raw === 'object' ? raw : {};
     } catch (error) {
       console.warn('[employee-cost] group config unavailable, dùng mặc định', { filePath, message: error.message });
       return {};
     }
   }
   ```
2. **Bọc 2 route GET** `/employee-cost/visibility` + `/employee-cost/employees` bằng cùng helper bắt lỗi như route POST
   (`asyncJsonRoute` / try-catch trả `{ error }`) → lần sau lỗi ra **`{error}` cụ thể**, không còn "Lỗi máy chủ" trơn.

## 4. NGHIỆM THU
1. Xóa/đổi tên tạm `employee_cost_groups.json` (mô phỏng thiếu file) → mở trang chi phí ADMIN: **KHÔNG còn "Lỗi máy chủ"**;
   picker có NV (nhóm về mặc định), panel công tắc render, bảng chạy. Trả file lại → nhóm hiện đúng như cũ.
2. Ép 1 lỗi giả trong route GET → FE nhận **`{error}` cụ thể**, không phải 500 trơn.
3. Giữ nguyên fix lookup `6ef5e3c` (170/183) + 2 mẫu + self-scope + C32/C47 + công tắc; test cũ PASS + thêm 1 test
   `loadConfig` thiếu file → trả `{}` không throw.
4. Push cùng nhánh review; báo Claude review. **Chưa deploy.**

## 5. GHI CHÚ
- Đây là lỗi **độ bền cấu hình**, không phải lỗi số/quyền. Không đụng công thức, VAT-trước, grain, timeline.
- Không lộ path/nội dung file ra FE; chỉ `console.warn` phía server.
