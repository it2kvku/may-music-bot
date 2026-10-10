# Deploy Mây Music lên Botkeep từ GitHub

Hướng dẫn được đối chiếu với tài liệu Botkeep ngày **10/10/2026**. Nhãn và phiên bản runtime trong panel có thể thay đổi; dùng cổng và tài nguyên mà panel cấp cho workload của bạn.

Bạn cần một ứng dụng Discord, repository chứa project này và một Lavalink v4.2+ chạy được. Trên Botkeep có thể tạo **hai workload**: `Discord bot → discord.js` cho code TypeScript/JavaScript và `Lavalink` cho audio server. [Botkeep hosting catalog](https://botkeep.cloud/docs/hosting)

## 1. Tạo audio service Lavalink

1. Tạo workload loại **Lavalink** trong danh mục service. Chọn **4.2.2** hoặc phiên bản mới hơn có hỗ trợ DAVE; nếu chạy dạng Java app, cần Java 17+.
2. Đặt nội dung [lavalink/application.yml](../lavalink/application.yml) thành file **`application.yml` ở thư mục chạy Lavalink**. Nếu profile đã có file, thay nội dung bằng cấu hình này và giữ đúng tên file.
3. Trong Environment/Secrets của **Lavalink**, thêm:

   | Biến | Giá trị |
   | --- | --- |
   | `LAVALINK_PASSWORD` | Mật khẩu ngẫu nhiên dài do bạn tự đặt |
   | `SERVER_PORT` | Cổng mà workload được cấp; panel có thể tự cung cấp |
   | `SPOTIFY_CLIENT_ID` | Client ID từ ứng dụng Spotify của bạn |
   | `SPOTIFY_CLIENT_SECRET` | Client secret tương ứng |
   | `JAVA_TOOL_OPTIONS` | Ví dụ `-Xms128m -Xmx512m` nếu có đủ RAM |

4. Dùng startup command của profile Lavalink. Nếu chạy JAR tự quản lý, command là `java -jar Lavalink.jar`, với `application.yml` cùng working directory. Không chạy câu lệnh này trong workload discord.js.
5. Start và kiểm tra Console: tải được plugin YouTube **1.18.2**, LavaSrc **4.8.3**, rồi Lavalink nhận kết nối.
6. Trong **Network**, lấy hostname/cổng có thể truy cập từ bot. Nếu dùng HTTPS routing trong **Domains**, endpoint bot sẽ dùng tên miền đó, port `443` và TLS. Đảm bảo route chuyển tiếp cả WebSocket.

Không dùng `localhost` để kết nối hai workload Botkeep: mỗi workload có môi trường riêng. Không suy đoán hostname nội bộ; dùng endpoint thực sự được panel cung cấp. Nếu profile không hỗ trợ sửa `application.yml`, tải plugins hoặc cấp endpoint cần thiết, dùng một Lavalink do bạn tự quản lý và điền endpoint đó vào bot.

**Tài nguyên gợi ý để bắt đầu:** bot 256–512 MB RAM; Lavalink khoảng 768 MB–1 GB RAM cho tải nhỏ, Java heap 512 MB. Đây là điểm bắt đầu cần đo lại theo số server/người nghe, không phải cam kết đủ cho mọi tải. Tổng RAM/CPU trên Botkeep được chia sẻ giữa các workload; để phần dư cho JVM/native audio ngoài Java heap.

Lavalink cần kết nối outbound tới nguồn nhạc và Discord voice, gồm UDP cho audio. `LAVALINK_SECURE=true` chỉ điều khiển kết nối bot → Lavalink, không tự giải quyết UDP hay firewall phía audio server.

### Spotify hoạt động thế nào?

Tạo ứng dụng tại [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), rồi lưu credentials trong **Lavalink Secrets**. Nguồn Spotify của LavaSrc dùng metadata, sau đó tìm bài trên YouTube; không cần đặt token tài khoản Spotify của người nghe vào bot. [LavaSrc](https://github.com/topi314/LavaSrc)

Với playlist riêng tư, playlist do Spotify tự tạo, lyrics hoặc thay đổi quyền Spotify API, credentials ứng dụng có thể chưa đủ. Upstream có tùy chọn `customTokenEndpoint`; cấu hình mẫu để dòng này ở dạng comment. Chỉ bật khi bạn có dịch vụ token tương thích do mình quản lý và hiểu cách vận hành. Project không phụ thuộc một endpoint token công cộng không rõ chủ sở hữu. [LavaSrc token notes](https://github.com/topi314/LavaSrc/releases/tag/4.7.3)

### Phiên bản audio

| Thành phần | Phiên bản ghim | Nguồn |
| --- | --- | --- |
| Lavalink | 4.2.2 | [Release](https://github.com/lavalink-devs/Lavalink/releases/tag/4.2.2) |
| YouTube plugin | 1.18.2 | [Release](https://github.com/lavalink-devs/youtube-source/releases/tag/1.18.2) |
| LavaSrc | 4.8.3 | [Release](https://github.com/topi314/LavaSrc/releases/tag/4.8.3) |

Giữ built-in `lavalink.server.sources.youtube: false` vì YouTube được cấp bởi plugin mới. SoundCloud dùng source có sẵn. `http` và `local` bị tắt vì bot chỉ nhận các nguồn nhạc được hỗ trợ. [YouTube plugin configuration](https://github.com/lavalink-devs/youtube-source#plugin)

## 2. Chuẩn bị ứng dụng Discord

1. Vào [Discord Developer Portal](https://discord.com/developers/applications), tạo application/bot.
2. Copy **Application ID** và token bot. Không paste token vào README, repository hay chat hỗ trợ.
3. Trong OAuth2 URL Generator, chọn scopes `bot`, `applications.commands`.
4. Chọn quyền `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Connect`, `Speak`; mở invite link và mời bot vào server.
5. Không cần `Administrator` và không cần bật Message Content Intent. Source chỉ dùng intents `Guilds` + `GuildVoiceStates`.
6. Có thể bật Developer Mode trong Discord để copy server ID dùng cho `DISCORD_GUILD_ID`.

## 3. Tạo workload Discord bot từ GitHub

Theo [hướng dẫn GitHub của Botkeep](https://botkeep.cloud/docs/github), repo public có thể chọn bằng URL; repo private cần kết nối GitHub App được quyền truy cập repo đó.

1. Chọn **Discord bot → discord.js** như ảnh chọn runtime, rồi nguồn **GitHub**.
2. Chọn repository project, branch **`main`**, root directory là thư mục chứa `package.json` (repo này là `/`).
3. Chọn Node.js **24** hoặc ít nhất **22.12.0**.
4. Cài dependencies bằng **`npm ci --omit=dev`**; nếu panel chỉ có bước tự cài npm dependencies, vẫn giữ `package-lock.json` trong repo. Không dùng `--omit=optional`.
5. Startup command: **`npm start`**. Nếu panel yêu cầu entry file, đó là **`dist/index.js`**.
6. Thêm các biến dưới đây. Token và mật khẩu đánh dấu là Secrets.

| Biến | Ví dụ / cách điền |
| --- | --- |
| `DISCORD_TOKEN` | Token Discord bot — **secret** |
| `DISCORD_CLIENT_ID` | Application ID từ Developer Portal |
| `DISCORD_GUILD_ID` | ID server thử; để trống nếu muốn lệnh toàn cục |
| `LAVALINK_URL` | `audio.example.com:443` hoặc hostname:cổng do panel cấp |
| `LAVALINK_PASSWORD` | Giống Lavalink — **secret** |
| `LAVALINK_SECURE` | `true` cho TLS port 443; `false` cho endpoint TCP không TLS |
| `AUTO_REGISTER_COMMANDS` | `true` |
| `DATA_DIR` | `./data`, hoặc đường dẫn persistent volume do panel cấp |
| `NODE_ENV` | `production` |

`LAVALINK_URL` **không** chứa `https://`, `wss://` hoặc `/v4`. Không dùng Application ID thay bot token. Đặt các tùy chọn âm lượng, autoplay, timeout và DJ role theo [`.env.example`](../.env.example).

Nếu bật HTTP kiểm tra trạng thái, giữ `ENABLE_HEALTH_SERVER=true` và dùng `SERVER_PORT` của Botkeep. Nếu chỉ chạy Discord bot và không dùng HTTP, có thể đặt `ENABLE_HEALTH_SERVER=false`. Không cần dịch vụ ping để giữ bot hoạt động.

`GET /healthz` là kiểm tra tiến trình. `GET /readyz` trả `200` khi Discord sẵn sàng và có node Lavalink kết nối, còn lại trả `503`. Nếu dùng health probe quyết định restart trong panel, chọn `/healthz`; `/readyz` dùng để xác nhận bot đã sẵn sàng phục vụ.

7. Start và đọc Console. Cần thấy Discord login thành công, slash commands được đăng ký và Lavalink kết nối. Deploy được chấp nhận chưa đồng nghĩa bot đã sẵn sàng; xem runtime/Console thực tế. [Botkeep Node.js guide](https://botkeep.cloud/docs/nodejs)

Chỉ chạy một instance cho cùng một bot token. Nếu đã chạy local, tắt local trước khi chạy bản trên Botkeep để tránh hai tiến trình cùng nhận lệnh.

## 4. Xác nhận sau deploy và cập nhật

Vào một voice channel thường, sau đó trong text channel chạy `/play` với một link công khai cho từng nguồn. Thử tạm dừng/tiếp tục/bỏ qua, cho hàng đợi hết để kiểm tra autoplay, và thử từ một người đang ở voice khác để kiểm tra giới hạn điều khiển. Với nguồn âm thanh trực tiếp, ưu tiên bài công khai không bị giới hạn vùng khi xác nhận kết nối ban đầu.

`npm run doctor` dùng cấu hình runtime để chẩn đoán Lavalink. Nếu panel không có console chạy lệnh riêng, có thể chạy doctor trên máy bạn với cùng endpoint, sau đó quay lại startup `npm start`.

Bot tự đăng ký lệnh khi start theo `AUTO_REGISTER_COMMANDS`. Lệnh toàn cục có thể mất thời gian xuất hiện; thử đăng ký theo `DISCORD_GUILD_ID` để kiểm tra nhanh. Nếu tắt tự đăng ký, chạy `npm run register` mỗi lần thay đổi định nghĩa lệnh.

Khi cập nhật code:

```bash
npm ci
npm run check
git add src dist tests package.json package-lock.json
git commit -m "Update music bot"
git push
```

Sau đó vào GitHub tab của Botkeep, xem thay đổi và áp dụng update/restart. Không mặc định mọi push đều tự deploy; các tùy chọn pull-on-start hoặc push updates phải được bật riêng. Sao lưu persistent data trước khi thay host hoặc xóa workload. Playback/hàng đợi đang chạy sẽ bị gián đoạn khi tiến trình được restart; lệnh giữ bot trong voice không ngăn host restart.

Chỉ volume, autoplay và thiết lập giữ voice được lưu xuống `DATA_DIR`. Hàng đợi, bài hiện tại và lịch sử mất khi restart. `/resume` dành cho pause/resume trong phiên hiện tại.

## 5. Xử lý lỗi thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| `DISCORD_TOKEN` thiếu / token không hợp lệ | Đặt token bot trong Secrets, không phải client secret Discord; restart sau khi sửa |
| Không thấy slash command | Bot được invite với `applications.commands`; `DISCORD_CLIENT_ID` đúng; `DISCORD_GUILD_ID` là server đang thử; xem lỗi register trong Console |
| `ECONNREFUSED`, timeout tới Lavalink | Endpoint/cổng thật trong Network; workload audio đang chạy; bỏ scheme và `/v4`; không dùng localhost giữa workload |
| Lavalink `401` | `LAVALINK_PASSWORD` của hai workload chưa khớp |
| Lỗi SSL / WebSocket | Kiểm tra `LAVALINK_SECURE`, port TLS và proxy hỗ trợ WebSocket |
| Bot vào voice nhưng không có âm thanh | Cấp Speak/Connect; bot không bị server mute; Lavalink >=4.2.0; outbound UDP hoạt động; kiểm tra lỗi track trong Console audio |
| YouTube yêu cầu đăng nhập, 403 hoặc lỗi cipher | Xem log plugin và [upstream YouTube](https://github.com/lavalink-devs/youtube-source); cập nhật plugin/config theo hướng dẫn hiện tại. Khả năng phát phụ thuộc IP và thay đổi từ YouTube |
| Spotify không tìm thấy bài / playlist | Bật source.spotify; kiểm tra credentials trên workload Lavalink; dùng link công khai; xem giới hạn API/token ở phần Spotify bên trên |
| Spotify phát bản cover/remix khác | Nguồn dùng ghép metadata. Thử `/play` bằng link YouTube/SoundCloud đúng bản |
| SoundCloud chỉ phát đoạn ngắn / không load | Cấu hình loại preview tracks; chọn bài công khai cho phép phát đầy đủ |
| Thiết lập mất sau restart | `DATA_DIR` phải trỏ vào nơi persistent và tài khoản chạy có quyền ghi |
| Workload hết RAM | Giảm số luồng/hiệu ứng, giới hạn queue; tăng RAM nếu plan cho phép; Java heap cần nhỏ hơn RAM workload |
| `dist/index.js` không tồn tại | Repo deploy thiếu `dist/`; chạy `npm run build`, commit `dist/`, cập nhật lại |
| Không chạy được Node / lỗi engine | Chọn Node 24 hoặc >=22.12; không chọn Node 18/20 |

Botkeep mô tả runtime liên tục nhưng không cam kết không gián đoạn. Restart, bảo trì, sự cố và giới hạn tài nguyên vẫn ảnh hưởng phát nhạc. [Botkeep FAQ](https://botkeep.cloud/faq)
