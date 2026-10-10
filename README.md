# ☁️ Mây Music

Bot nhạc Discord viết bằng **TypeScript**, giao diện tiếng Việt, dùng slash commands và nút điều khiển. Nhận tên bài hát hoặc link **YouTube, SoundCloud, Spotify**. Được đóng gói để chạy bằng `npm start` trên **Botkeep → Discord bot → discord.js**.

**Deploy:** [Hướng dẫn Botkeep từ GitHub](docs/BOTKEEP.md) · **Cấu hình:** [.env.example](.env.example) · **Audio server:** [lavalink/application.yml](lavalink/application.yml)

## Có gì trong bot?

- Phát bài, playlist và tìm kiếm theo nguồn; hàng đợi riêng cho từng server.
- Autoplay tiếp tục tìm nhạc khi hết hàng đợi, tránh lặp các bài vừa phát.
- Tạm dừng, tiếp tục, bỏ qua, quay lại, lặp bài/hàng đợi, trộn, xóa và đổi vị trí bài.
- Âm lượng 0–100, tua, hiệu ứng bassboost/nightcore/vaporwave/karaoke.
- Bảng đang phát kèm nút thao tác; chỉ người trong cùng kênh voice được điều khiển.
- Chế độ giữ bot trong voice, tự rời khi rảnh hoặc kênh không còn người nghe.
- Tùy chọn vai trò DJ, hạn chế spam lệnh, giới hạn playlist/hàng đợi.
- Lưu thiết lập server trong thư mục dữ liệu; log vận hành, công cụ chẩn đoán và tắt tiến trình gọn gàng.
- Kiểm tra kiểu TypeScript, unit tests và GitHub Actions; bản JavaScript `dist/` có sẵn để deploy không cần biên dịch trên host.

Spotify cung cấp **metadata** để bot tìm bản tương ứng trên YouTube qua LavaSrc; đây không phải luồng âm thanh trực tiếp từ Spotify. Bản được ghép có thể khác bản gốc. Link riêng tư, nội dung theo vùng và nguồn bị chặn có thể không phát được. [Cách LavaSrc xử lý Spotify](https://github.com/topi314/LavaSrc#what-is-mirroring)

## Lệnh

| Lệnh | Chức năng |
| --- | --- |
| `/play query:... source:...` | Thêm link/tên bài; `source` tùy chọn `youtube`, `soundcloud`, `spotify` |
| `/pause`, `/resume`, `/skip`, `/stop` | Tạm dừng, tiếp tục, bài kế tiếp, dừng và rời voice |
| `/nowplaying` | Xem bài hiện tại và bảng nút điều khiển |
| `/queue page:1` | Xem hàng đợi theo trang |
| `/previous`, `/shuffle`, `/clear` | Phát bài trước, trộn hoặc xóa hàng đợi |
| `/remove position:2` | Xóa bài thứ 2 trong hàng đợi |
| `/move from:3 to:1` | Di chuyển bài; vị trí bắt đầu từ 1 |
| `/loop mode:off` | Chọn `off`, `track` hoặc `queue` |
| `/autoplay enabled:true` | Bật/tắt tự phát tiếp; bỏ `enabled` để chuyển trạng thái |
| `/volume amount:60` | Âm lượng 0–100 |
| `/seek position:1:30` | Tua theo số giây, `mm:ss` hoặc `hh:mm:ss` |
| `/filter preset:bassboost` | `off`, `bassboost`, `nightcore`, `vaporwave`, `karaoke` |
| `/stay enabled:true` | Giữ bot trong voice; yêu cầu quyền Manage Server |
| `/help`, `/ping` | Trợ giúp và trạng thái bot |

Người điều khiển phải ở cùng kênh voice. Khi đặt `DJ_ROLE_ID`, các lệnh thay đổi playback yêu cầu vai trò DJ hoặc quyền Manage Server; `/play` vẫn cho người cùng voice thêm nhạc. `/stay` luôn cần Manage Server. Bot hỗ trợ voice channel thông thường, chưa hỗ trợ Stage channel.

## Kiến trúc

```text
Discord: /play và nút điều khiển
          │
          ▼
Node.js — discord.js + Shoukaku
          │ REST / WebSocket
          ▼
Lavalink 4.2.2 — YouTube plugin + LavaSrc + SoundCloud
          │
          └── âm thanh → Discord voice
```

Bot Node.js và Lavalink là **hai tiến trình riêng**. Trên Botkeep, tạo một workload `Discord bot / discord.js` và một workload `Lavalink`, hoặc dùng Lavalink riêng sẵn có. Bot không cần FFmpeg/Java trong workload Node.js. Lavalink cần Java 17+ và quyền kết nối ra Discord voice.

Phiên bản được ghim: Lavalink **4.2.2**, YouTube plugin **1.18.2**, LavaSrc **4.8.3**. Lavalink 4.2+ hỗ trợ DAVE; Shoukaku 4.3.0 truyền `channelId` theo giao thức này. [Lavalink changelog](https://lavalink.dev/changelog/v4)

## Chuẩn bị Discord

1. Mở [Discord Developer Portal](https://discord.com/developers/applications), tạo ứng dụng và bot.
2. Lấy bot token để đặt trong `DISCORD_TOKEN`. Lấy **Application ID** đặt trong `DISCORD_CLIENT_ID`.
3. Trong OAuth2 URL Generator, chọn scopes `bot`, `applications.commands`. Chọn quyền **View Channels, Send Messages, Embed Links, Read Message History, Connect, Speak** và mời bot vào server.
4. Bot dùng intents `Guilds`, `GuildVoiceStates`; không cần bật Message Content Intent hay các privileged intents.
5. Khi thử nghiệm, đặt `DISCORD_GUILD_ID` là ID server thử. Bỏ biến này khi đăng ký lệnh toàn cục.

Không đặt Interactions Endpoint URL: bot nhận interactions qua Discord Gateway. Cấp các quyền kể trên trong cả kênh chat và kênh voice cụ thể nếu server có permission overrides. Dùng kênh voice thông thường.

## Chạy nhanh trên Botkeep

1. Tạo Lavalink theo [hướng dẫn chi tiết](docs/BOTKEEP.md#1-tạo-audio-service-lavalink).
2. Tạo Discord bot → discord.js → GitHub; chọn repository này, nhánh `main`, thư mục gốc repository.
3. Chọn **Node.js 24**, hoặc Node.js **22.12+**.
4. Cài dependency: `npm ci --omit=dev`. Lệnh khởi động: **`npm start`**.
5. Đặt `DISCORD_TOKEN`, `LAVALINK_PASSWORD` trong Secrets; đặt `LAVALINK_URL` và `LAVALINK_SECURE` đúng endpoint audio server.
6. Start, xem Console, vào voice và dùng `/play`.

Repo đã chứa `dist/`, không cần bật script build hoặc cài TypeScript để khởi động. Nếu thay đổi `src/`, hãy chạy `npm run check` và commit cả `dist/` trước khi cập nhật Botkeep.

## Chạy local / phát triển

Yêu cầu Node.js **22.12+** (khuyên dùng 24), npm và một Lavalink đã cấu hình.

```bash
npm ci
cp .env.example .env
# Điền token, Application ID và thông tin Lavalink trong .env.
npm run check
npm run doctor
npm start
```

PowerShell thay `cp` bằng `Copy-Item .env.example .env` nếu cần. Khi sửa code, dùng `npm run dev`. Mặc định bot tự đăng ký slash commands lúc khởi động. Có thể đăng ký riêng:

```bash
npm run register
```

Lệnh này cần `DISCORD_CLIENT_ID`. Khi chuyển từ đăng ký theo server sang toàn cục, lệnh theo server cũ vẫn tồn tại trên Discord; xóa các guild commands cũ trước nếu muốn tránh nhìn thấy hai bộ lệnh.

## Docker Compose trên máy riêng / VPS

Docker Compose chạy cả bot và Lavalink; đây không phải định dạng import của Botkeep.

```bash
cp .env.example .env
# Điền DISCORD_TOKEN, DISCORD_CLIENT_ID, LAVALINK_PASSWORD và Spotify credentials.
docker compose up -d --build
docker compose logs -f
```

Compose thay endpoint bot thành `lavalink:2333` tự động. Hai volume `bot-data`, `lavalink-plugins` giữ dữ liệu và plugin. Cổng được bind vào `127.0.0.1`, dùng để chẩn đoán từ chính máy host. `docker compose down` giữ volume; không dùng `down -v` nếu muốn giữ dữ liệu.

Muốn chạy Node bot bên ngoài Docker, chỉ khởi động `docker compose up -d lavalink`, đặt `LAVALINK_URL=localhost:2333`, rồi `npm start`.

## Biến môi trường chính

| Biến | Mặc định / mục đích |
| --- | --- |
| `DISCORD_TOKEN` | Bắt buộc; token bot trong Secrets |
| `DISCORD_CLIENT_ID` | Application ID; bot có thể suy ra khi login, CLI register cần giá trị này |
| `DISCORD_GUILD_ID` | Trống: lệnh toàn cục; có ID: chỉ đăng ký cho server đó |
| `AUTO_REGISTER_COMMANDS` | `true` |
| `LAVALINK_URL` | `host:port`, không có scheme/path |
| `LAVALINK_PASSWORD` | Bắt buộc; khớp password trên Lavalink |
| `LAVALINK_SECURE` | `false`; đặt `true` khi kết nối TLS/HTTPS/WSS |
| `LAVALINK_NAME` | `primary` |
| `DEFAULT_VOLUME` | `60`; tối đa `100` |
| `DEFAULT_AUTOPLAY` | `true` |
| `MAX_QUEUE_SIZE` / `MAX_PLAYLIST_SIZE` | `500` / `100` |
| `IDLE_TIMEOUT_SECONDS` | `180` |
| `EMPTY_CHANNEL_TIMEOUT_SECONDS` | `60` |
| `DJ_ROLE_ID` | Trống: mọi người trong cùng voice có thể điều khiển |
| `COMMAND_COOLDOWN_MS` | `1500` |
| `DATA_DIR` | `./data`; đặt vào persistent volume để giữ thiết lập |
| `ENABLE_HEALTH_SERVER` | `true`; HTTP kiểm tra trạng thái |
| `PORT` / `SERVER_PORT` | Cổng HTTP; dùng cổng được Botkeep cấp |

`SPOTIFY_CLIENT_ID` và `SPOTIFY_CLIENT_SECRET` nằm trên **workload Lavalink**, không phải bí mật Discord. File Compose chuyển chúng tới đúng service. Các thay đổi môi trường có hiệu lực sau restart.

## Kiểm tra và vận hành

```bash
npm run typecheck   # Kiểm tra TypeScript
npm test            # Unit tests; không cần token Discord
npm run build       # Cập nhật dist/
npm run check       # Cả ba bước trên
npm run doctor      # Chẩn đoán cấu hình và Lavalink thực tế
```

Tests tự động không thay thế thử phát nhạc trong Discord. Sau deploy, kiểm tra lần lượt YouTube, SoundCloud, Spotify, autoplay, quyền DJ và tự rời voice. Khả năng phát còn phụ thuộc token, quyền Discord, kết nối mạng và trạng thái các nguồn.

Xem [kết quả kiểm tra bản bàn giao](docs/VALIDATION.md) để biết phần đã chạy thực tế và phần cần credentials khi deploy.

HTTP `GET /healthz` trả trạng thái tiến trình; `GET /readyz` chỉ trả `200` khi Discord đã sẵn sàng và có Lavalink kết nối, nếu chưa sẽ trả `503`. Server lắng nghe `0.0.0.0` trên cổng cấu hình; có thể tắt bằng `ENABLE_HEALTH_SERVER=false`.

Bot lưu **volume, autoplay, chế độ giữ voice** theo server. Bài đang phát, lịch sử và hàng đợi nằm trong bộ nhớ, sẽ mất khi bot restart. `/resume` tiếp tục bài đang pause, không khôi phục phiên sau khi restart.

Tài liệu xử lý lỗi: [docs/BOTKEEP.md](docs/BOTKEEP.md#5-xử-lý-lỗi-thường-gặp).

## Mã nguồn

`src/` chứa TypeScript; `dist/` chứa JavaScript để chạy production; `tests/` chứa kiểm tra tự động; `lavalink/` chứa cấu hình audio server; `docs/` chứa hướng dẫn deploy. `.env`, `data/`, `node_modules/` và log bị loại khỏi Git.

Giấy phép [MIT](LICENSE).
