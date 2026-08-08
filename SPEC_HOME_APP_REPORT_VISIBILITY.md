# Home DONAPHARM → App Report visibility contract

Home **không giữ denylist App Report**. Home gọi App Report cho đúng tài khoản đang
đăng nhập và chỉ render ô App Report khi nhận được một response hợp lệ có
`visible: true`.

## Request

```http
GET /api/integrations/home/app-report-visibility?empCode=VP018
Authorization: Bearer <HOME_SERVICE_TOKEN>
```

- Credential riêng của Home; App Report chỉ giữ SHA-256 tại
  `APP_REPORT_HOME_SERVICE_TOKEN_SHA256`.
- Không tái dùng `APP_REPORT_SERVICE_TOKEN_SHA256` của DataHub.
- Không gửi token này từ browser; Home backend gọi server-to-server.
- `empCode` phải lấy từ session Home đã xác thực; không nhận mã do browser tự gửi
  lên để hỏi hộ tài khoản khác.

## Response 200

```json
{
  "empCode": "VP018",
  "visible": true,
  "reason": "REVENUE_ONLY",
  "accessProfile": "revenue_only"
}
```

`reason` ổn định:

| reason | visible | accessProfile |
|---|---:|---|
| `LOGIN_BLOCKED` | false | `standard` |
| `REVENUE_ONLY` | true | `revenue_only` |
| `ALLOWED` | true | `standard` |
| `ACCOUNT_NOT_FOUND` | false | `none` |
| `INVALID_EMP_CODE` | false | `none` |

## Luật fail-closed bắt buộc ở Home

```js
let showAppReport = false;
try {
  const expectedCode = normalizeEmpCode(homeSession.empCode);
  const decision = await callAppReportWithTimeout(expectedCode, 1500);
  const exactKeys = Object.keys(decision || {}).sort().join(',')
    === 'accessProfile,empCode,reason,visible';
  const allowedPair = (decision?.reason === 'ALLOWED' && decision?.accessProfile === 'standard')
    || (decision?.reason === 'REVENUE_ONLY' && decision?.accessProfile === 'revenue_only');
  showAppReport = exactKeys
    && decision?.empCode === expectedCode
    && decision?.visible === true
    && allowedPair;
} catch {
  showAppReport = false;
}
```

Ẩn ô nếu timeout, network/DNS/TLS lỗi, HTTP khác 200, JSON sai hợp đồng, `visible`
khác `true`, hoặc `accessProfile` không thuộc allowlist. Không fallback sang danh
sách local và không render trước rồi mới ẩn.
