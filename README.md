# Discord Bot Authenticator

Bot Discord hỗ trợ xác thực 2 lớp (TOTP) bằng Google Authenticator/Authy và quản lý nhiều secret.

## Tính năng
- `/auth-setup`: Tạo secret mới và gửi QR code qua DM.
- `/auth-verify code:<6-digit>`: Xác nhận code để bật authenticator mặc định.
- `/auth-status`: Kiểm tra trạng thái bật/tắt và số lượng label đã lưu.
- `/auth-save label:<name> secret:<base32>`: Lưu secret mới để quản lý nhiều mã.
- `/auth-list`: Xem danh sách label đã lưu.
- `/auth-remove label:<name>`: Xóa một secret theo label.
- `/auth-code [label] [secret]`: Lấy mã TOTP 6 số từ:
  - secret nhập trực tiếp,
  - hoặc label đã lưu,
  - hoặc `default` nếu không truyền gì.
- `/auth-disable code:<6-digit>`: Tắt authenticator mặc định (không xóa các label đã lưu).

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

## Để bot hoạt động ngay (không chờ slash command global)
Khai báo thêm `GUILD_ID` trong `.env`:
```env
GUILD_ID=123456789012345678
```
- Khi có `GUILD_ID`, bot đăng ký slash command trực tiếp vào server đó (hiện gần như ngay lập tức).
- Nếu không có `GUILD_ID`, bot đăng ký global command (có thể mất vài phút đến lâu hơn để hiện).

## Lưu ý cấu hình Discord Developer Portal
Trong phần Bot:
- **Không cần** bật `MESSAGE CONTENT INTENT`.
- Mời bot vào server với scope `bot` và `applications.commands`.
- Cho phép bot có thể DM user (user cũng cần mở DM từ server members).

## Bảo mật
- Tất cả kết quả lệnh đang trả về dạng **ephemeral** để hạn chế lộ mã ra channel chung.
- Secret đang được lưu local tại `data/user-secrets.json`.
- Production nên dùng database + encryption (KMS/secret manager) thay vì file JSON.
