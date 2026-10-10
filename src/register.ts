import 'dotenv/config';
import { registerCommands } from './registration.js';
import { log } from './errors.js';
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID || undefined;
if (!token || !clientId || !/^\d{17,20}$/.test(clientId) || (guildId && !/^\d{17,20}$/.test(guildId))) {
  console.error('Cần DISCORD_TOKEN, DISCORD_CLIENT_ID hợp lệ; DISCORD_GUILD_ID là tùy chọn.'); process.exitCode = 1;
} else {
  try { await registerCommands(token, clientId, guildId); log('commands_registered', { scope: guildId ? 'guild' : 'global' }); }
  catch { console.error('Đăng ký lệnh thất bại. Kiểm tra token, Application ID, Guild ID và quyền cài bot.'); process.exitCode = 1; }
}
