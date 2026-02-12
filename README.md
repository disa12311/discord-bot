# Discord Bot Authenticator

Bot Discord hỗ trợ xác thực 2 lớp (TOTP) bằng Google Authenticator/Authy.

## Tính năng
- `/auth-setup`: Tạo secret mới và gửi QR code qua DM.
- `/auth-verify code:<6-digit>`: Xác nhận code để bật authenticator.
- `/auth-status`: Kiểm tra trạng thái bật/tắt.
- `/auth-disable code:<6-digit>`: Tắt authenticator (cần code hợp lệ).

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
- Bật **SERVER MEMBERS INTENT** là không bắt buộc cho bot này.
- Bật **MESSAGE CONTENT INTENT** là không cần thiết (bot dùng slash commands).
- Mời bot vào server với scope `bot` và `applications.commands`.
- Cho phép bot có thể DM user (user cũng cần mở DM từ server members).

## Vì sao fix được lỗi "Used disallowed intents"?
Bot mới chỉ dùng intent `Guilds`, không còn dùng `MessageContent`, nên sẽ không bị Discord từ chối vì privileged intent chưa bật.

## Bảo mật
- Secret đang được lưu local tại `data/user-secrets.json`.
- Production nên dùng database + encryption (KMS/secret manager) thay vì file JSON.
