# Kiểm tra bản bàn giao

Ngày kiểm tra: **10/10/2026**.

- Node.js 24.19.0; `npm run check` đạt: TypeScript, 119 tests và tạo `dist/`.
- `npm audit`: 0 lỗ hổng được báo cáo ở thời điểm kiểm tra.
- Kiểm thử bao gồm lệnh/quyền Discord, giới hạn hàng đợi, autoplay, sự kiện phát trùng hoặc đến muộn, hủy yêu cầu đang tải khi `/stop`, timers, lưu cấu hình và HTTP health endpoints.
- Khởi động thật Lavalink **4.2.2** trên Java 21 với cấu hình trong repo. `/v4/info` xác nhận YouTube plugin **1.18.2**, LavaSrc **4.8.3** và các nguồn `youtube`, `soundcloud`, `spotify`.
- Truy vấn thật `ytsearch:Never Gonna Give You Up Rick Astley`: 20 kết quả. `scsearch:lofi`: 10 kết quả.

Spotify chưa được xác thực bằng credentials ứng dụng. Truy vấn ẩn danh gặp lỗi lấy token; cần điền `SPOTIFY_CLIENT_ID` và `SPOTIFY_CLIENT_SECRET` trên Lavalink theo hướng dẫn deploy. Plugin được đăng ký không đồng nghĩa mọi link Spotify sẽ tải được.

Chưa kiểm thử phát âm thanh trong kênh Discord vì chưa có token bot của người dùng. Tìm kiếm thành công không xác nhận được kết nối voice, giải mã luồng YouTube hoặc quyền của bot trên server. Sau deploy, dùng `/play` với từng nguồn, rồi kiểm tra autoplay và các nút điều khiển.

Container Docker được cung cấp nhưng chưa chạy thử trên máy này (không có Docker). CI kiểm tra mã TypeScript và đồng bộ bản build đã commit; không dùng credentials Discord.
