# Discord Bot Authenticator

Bot Discord tạo mã TOTP 6 số (Google Authenticator/Authy compatible), tập trung vào độ ổn định và quản lý nhiều secret.

Hiện bot dùng thư viện **otplib** để sinh mã TOTP 6 số (chuẩn RFC, tương thích Google Authenticator/Authy).

## Có bỏ `/auth-setup`, `/auth-verify`, `/auth-disable` không?
Có. Bot đã được đơn giản hóa để giảm lỗi runtime và dễ dùng hơn:
- **Bỏ**: `/auth-setup`, `/auth-verify`, `/auth-disable`.
- **Giữ + mở rộng**: quản lý secret trực tiếp bằng label.

## Lệnh hiện có
- `/auth-save label:<name> secret:<base32>`: Lưu secret mới.
- `/auth-list`: Xem toàn bộ label đã lưu.
- `/auth-remove label:<name>`: Xóa một secret theo label.
- `/auth-set-default label:<name>`: Đặt label mặc định cho `/auth-code`.
- `/auth-code [label] [secret]`: Lấy mã TOTP 6 số từ:
  - secret nhập trực tiếp,
  - hoặc label đã lưu,
  - hoặc default label nếu không truyền gì.
- `/auth-status`: Kiểm tra số label đã lưu + default label.

## Cài đặt
```bash
npm install
cp .env.example .env
```

Điền `DISCORD_TOKEN` vào file `.env`.

## Chạy bot
```bash
npm start
```

Entry point hiện tại là `index.js` (gọi sang `src/bot.js`) để dễ mở rộng/tái cấu trúc.

## Để bot hoạt động ngay (không chờ slash command global)
Khai báo thêm `GUILD_ID` trong `.env`:
```env
GUILD_ID=123456789012345678
```
- Có `GUILD_ID`: lệnh xuất hiện gần như ngay lập tức trong server đó.
- Không có `GUILD_ID`: đăng ký global command, có thể chờ lâu hơn.

## Cấu trúc code (đã refactor)
- `index.js`: entrypoint
- `src/bot.js`: bootstrap Discord client + routing interaction
- `src/commands.js`: định nghĩa slash command + handlers
- `src/storage.js`: storage layer (MongoDB hoặc JSON fallback)
- `src/totp.js`: cấu hình và sinh mã TOTP (`otplib`)
- `src/config.js`: đọc biến môi trường
- `src/validators.js`: normalize/validate input

## Bảo mật nâng cao (Base64 + Encryption)
Bot đã nâng cấp lưu secret theo hướng bảo mật hơn:
- Khi có `SECRET_ENCRYPTION_KEY_BASE64` (64-byte), secret được mã hóa **AES-256-GCM** trước khi lưu.
- Payload lưu trữ ở dạng chuỗi base64 (iv/tag/ciphertext), không còn plain text.
- Nếu thiếu key, bot vẫn chạy tương thích ngược nhưng không mã hóa (không khuyến nghị).

Thiết lập key (64-byte base64):
```bash
openssl rand -base64 64
```

Rồi set vào `.env`:
```env
SECRET_ENCRYPTION_KEY_BASE64=<your_generated_key>
```

## MongoDB
Bot đã hỗ trợ MongoDB để lưu vault ổn định hơn.

Thêm vào `.env`:
```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=discord_auth_bot
MONGODB_COLLECTION=user_vaults
```

- Nếu có `MONGODB_URI`: bot dùng MongoDB.
- Nếu không có: bot tự fallback về file `data/user-secrets.json`.
- Mặc định TLS được tự suy luận: `mongodb+srv://` => bật TLS, `mongodb://` => tắt TLS.


### Xử lý lỗi TLS MongoDB trong container
Bot cũng tự thử lại 1 lần với `tls=false` khi lần kết nối đầu `tls=true` thất bại (chỉ cho `mongodb://`).

Nếu bạn thấy lỗi kiểu `SSL routines ... tlsv1 alert internal error`:
- Nếu Mongo của bạn **không dùng TLS**, set:
```env
MONGODB_TLS=false
```
- Nếu Mongo có cert self-signed/lab, có thể tạm set:
```env
MONGODB_TLS_ALLOW_INVALID_CERTIFICATES=true
```
- Có thể tăng timeout chọn server:
```env
MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000
```

### Deploy trên Railway
- Railway thường inject biến môi trường trực tiếp, nên chỉ cần set:
  - `DISCORD_TOKEN`
  - `MONGODB_URI` (nếu dùng Mongo)
  - `SECRET_ENCRYPTION_KEY_BASE64`
- `MONGODB_TLS` nên để trống để bot auto-detect theo URI.
- Nếu service Mongo trên Railway yêu cầu mode cố định, set thủ công `MONGODB_TLS=true` hoặc `MONGODB_TLS=false`.

## Lưu ý cấu hình Discord Developer Portal
Trong phần Bot:
- **Không cần** bật `MESSAGE CONTENT INTENT`.
- Mời bot vào server với scope `bot` và `applications.commands`.

## Bảo mật
- Kết quả lệnh được trả bằng **ephemeral** để hạn chế lộ mã.
- Secret lưu local hoặc MongoDB; khi có key thì dữ liệu secret được mã hóa AES-256-GCM dạng base64 payload.
- Luôn cấu hình `SECRET_ENCRYPTION_KEY_BASE64` trên production.
