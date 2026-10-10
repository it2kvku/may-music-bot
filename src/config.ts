import 'dotenv/config';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value || /^replace[_-]/i.test(value)) throw new Error(`Thiếu biến môi trường ${name}. Xem .env.example.`);
    return value;
  };
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} phải là số nguyên ${min}–${max}.`);
    return value;
  };
  const boolean = (name: string, fallback: boolean) => {
    const raw = env[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (!['true', 'false'].includes(raw)) throw new Error(`${name} phải là true hoặc false.`);
    return raw === 'true';
  };
  const snowflake = (name: string) => {
    const raw = env[name]?.trim();
    if (raw && !/^\d{17,20}$/.test(raw)) throw new Error(`${name} phải là Discord ID hợp lệ.`);
    return raw || undefined;
  };
  const url = required('LAVALINK_URL');
  if (!/^(?:[a-z\d.-]+|\[[a-f\d:]+\]):\d{1,5}$/i.test(url)) throw new Error('LAVALINK_URL phải có dạng hostname:port, không kèm http(s):// hoặc đường dẫn.');
  const port = Number(url.slice(url.lastIndexOf(':') + 1));
  if (port < 1 || port > 65535) throw new Error('Cổng Lavalink không hợp lệ.');
  return {
    token: required('DISCORD_TOKEN'), clientId: snowflake('DISCORD_CLIENT_ID'), guildId: snowflake('DISCORD_GUILD_ID'),
    node: { name: env.LAVALINK_NAME?.trim() || 'primary', url, auth: required('LAVALINK_PASSWORD'), secure: boolean('LAVALINK_SECURE', false) },
    autoRegister: boolean('AUTO_REGISTER_COMMANDS', true),
    defaultVolume: integer('DEFAULT_VOLUME', 60, 0, 100), defaultAutoplay: boolean('DEFAULT_AUTOPLAY', true),
    maxQueueSize: integer('MAX_QUEUE_SIZE', 500, 1, 5000), maxPlaylistSize: integer('MAX_PLAYLIST_SIZE', 100, 1, 1000),
    idleTimeoutMs: integer('IDLE_TIMEOUT_SECONDS', 180, 15, 86400) * 1000,
    emptyTimeoutMs: integer('EMPTY_CHANNEL_TIMEOUT_SECONDS', 60, 15, 86400) * 1000,
    djRoleId: snowflake('DJ_ROLE_ID'), dataDir: env.DATA_DIR?.trim() || './data',
    enableHealth: boolean('ENABLE_HEALTH_SERVER', true),
    port: integer(env.SERVER_PORT ? 'SERVER_PORT' : 'PORT', 3000, 1, 65535),
    cooldownMs: integer('COMMAND_COOLDOWN_MS', 1500, 0, 60000),
  };
}
export type Config = ReturnType<typeof readConfig>;
