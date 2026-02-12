# Discord Bot Authenticator

Bot Discord hỗ trợ xác thực 2 lớp (TOTP) bằng Google Authenticator/Authy.

## Tính năng
- `!auth setup`: Tạo secret mới và gửi QR code qua DM.
- `!auth verify <code>`: Xác nhận code để bật authenticator.
- `!auth status`: Kiểm tra trạng thái bật/tắt.
- `!auth disable <code>`: Tắt authenticator (cần code hợp lệ).

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

## Lưu ý cấu hình Discord Developer Portal
Trong phần Bot:
- Bật **Message Content Intent**.
- Mời bot vào server với quyền đọc/gửi tin nhắn.
- Cho phép bot có thể DM user (user cũng cần mở DM từ server members).

## Bảo mật
- Secret đang được lưu local tại `data/user-secrets.json`.
- Production nên dùng database + encryption (KMS/secret manager) thay vì file JSON.
