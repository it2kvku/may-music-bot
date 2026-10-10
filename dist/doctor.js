import { readConfig } from './config.js';
async function doctor() {
    const config = readConfig();
    console.log(`Node ${process.version}; cấu hình hợp lệ (không in secret).`);
    let failed = false;
    const url = `${config.node.secure ? 'https' : 'http'}://${config.node.url}`;
    try {
        const response = await fetch(`${url}/v4/info`, { headers: { Authorization: config.node.auth }, signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            throw new Error('Lavalink unavailable');
        const data = await response.json();
        const version = data.version?.semver ?? '';
        const [major = 0, minor = 0] = version.split('.').map(Number);
        const modern = major > 4 || (major === 4 && minor >= 2);
        const sources = new Set(data.sourceManagers?.map(source => source.toLowerCase()));
        console.log(`Lavalink API: OK; phiên bản ${version.replace(/[^\w.+-]/g, '').slice(0, 40)}; DAVE ${modern ? 'đạt yêu cầu phiên bản' : 'cần Lavalink >=4.2.0'}.`);
        if (!modern)
            failed = true;
        for (const source of ['youtube', 'soundcloud', 'spotify']) {
            const found = sources.has(source);
            console.log(`Nguồn ${source}: ${found ? 'có đăng ký' : 'THIẾU — kiểm tra application.yml/plugin'}`);
            if (!found)
                failed = true;
        }
    }
    catch {
        failed = true;
        console.error('Lavalink: lỗi kết nối/xác thực. Kiểm tra URL, port, TLS và password.');
    }
    try {
        const response = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${config.token}` }, signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            throw new Error('Discord unavailable');
        const user = await response.json();
        if (!user.bot)
            throw new Error('Not a bot');
        if (config.clientId && config.clientId !== user.id) {
            failed = true;
            console.error('DISCORD_CLIENT_ID không khớp bot của token.');
        }
        else
            console.log('Discord bot token: OK.');
    }
    catch {
        failed = true;
        console.error('Discord: token không hợp lệ hoặc API chưa truy cập được.');
    }
    console.log('Kiểm tra này xác nhận API và nguồn được đăng ký; cần /play trong Discord để kiểm thử âm thanh thực tế.');
    if (failed)
        process.exitCode = 1;
}
doctor().catch(error => { console.error(error instanceof Error ? error.message : 'Cấu hình không hợp lệ.'); process.exitCode = 1; });
//# sourceMappingURL=doctor.js.map