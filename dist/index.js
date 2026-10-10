import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { Connectors, Shoukaku } from 'shoukaku';
import { readConfig } from './config.js';
import { log } from './errors.js';
import { handleInteraction } from './commands.js';
import { MusicManager } from './music.js';
import { SettingsStore } from './settings.js';
import { nowPlaying, allowedMentions } from './ui.js';
import { registerCommands } from './registration.js';
import { createHealthServer } from './health.js';
async function main() {
    const config = readConfig();
    const settings = new SettingsStore(config.dataDir, { volume: config.defaultVolume, autoplay: config.defaultAutoplay, stay: false });
    await settings.load();
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates], allowedMentions });
    const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [config.node], {
        resume: true, resumeTimeout: 60, resumeByLibrary: true, reconnectTries: Number.MAX_SAFE_INTEGER,
        reconnectInterval: 5, restTimeout: 15, voiceConnectionTimeout: 20,
    });
    const music = new MusicManager(shoukaku, client, config, settings);
    const announcements = new Map();
    // Edit a single announcement per server instead of sending a new message each loop.
    music.onTrackStart = async (snapshot) => {
        const channel = await client.channels.fetch(snapshot.textChannelId);
        if (!channel?.isSendable())
            return;
        const previous = announcements.get(snapshot.guildId);
        const payload = nowPlaying(snapshot);
        if (previous?.channelId === channel.id) {
            try {
                await previous.edit(payload);
                return;
            }
            catch {
                announcements.delete(snapshot.guildId);
            }
        }
        announcements.set(snapshot.guildId, await channel.send(payload));
    };
    music.onNotice = async (channelId, content) => {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isSendable())
            await channel.send({ content, allowedMentions });
    };
    const server = config.enableHealth ? createHealthServer(() => client.isReady() && music.connectedNodes() > 0) : undefined;
    server?.on('error', () => { log('health_server_failed'); void shutdown(1); });
    shoukaku.on('ready', () => log('lavalink_ready'));
    shoukaku.on('error', () => log('lavalink_error'));
    shoukaku.on('close', (_name, code) => log('lavalink_closed', { code }));
    shoukaku.on('reconnecting', () => log('lavalink_reconnecting'));
    client.on(Events.Error, () => log('discord_error'));
    client.on(Events.Warn, () => log('discord_warning'));
    client.once(Events.ClientReady, async (ready) => {
        log('discord_ready', { botId: ready.user.id, guilds: ready.guilds.cache.size });
        ready.user.setActivity('/play • YouTube / SoundCloud / Spotify', { type: ActivityType.Listening });
        if (config.clientId && config.clientId !== ready.user.id) {
            log('client_id_mismatch');
            await shutdown(1);
            return;
        }
        if (config.autoRegister) {
            try {
                await registerCommands(config.token, ready.user.id, config.guildId);
                log('commands_registered', { scope: config.guildId ? 'guild' : 'global' });
            }
            catch {
                log('command_registration_failed');
            }
        }
    });
    client.on(Events.InteractionCreate, interaction => {
        void handleInteraction(interaction, music, { djRoleId: config.djRoleId, cooldownMs: config.cooldownMs }).catch(() => log('interaction_failed'));
    });
    client.on(Events.VoiceStateUpdate, (before, after) => music.voiceStateUpdate(before, after));
    client.on(Events.GuildDelete, guild => { announcements.delete(guild.id); const snapshot = music.snapshot(guild.id); if (snapshot)
        void music.control(guild.id, snapshot.voiceChannelId, 'stop').catch(() => undefined); });
    let closing = false;
    async function shutdown(code = 0) {
        if (closing)
            return;
        closing = true;
        log('shutdown');
        const timeout = setTimeout(() => process.exit(code), 10000).unref();
        server?.close();
        await music.shutdown();
        for (const name of shoukaku.nodes.keys())
            shoukaku.removeNode(name, 'shutdown');
        client.destroy();
        clearTimeout(timeout);
        process.exit(code);
    }
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    process.on('unhandledRejection', () => { log('unhandled_rejection'); void shutdown(1); });
    process.on('uncaughtException', () => { log('uncaught_exception'); void shutdown(1); });
    server?.listen(config.port, '0.0.0.0', () => log('health_listening', { port: config.port }));
    try {
        await client.login(config.token);
    }
    catch {
        log('discord_login_failed');
        await shutdown(1);
    }
}
main().catch(error => {
    // Only startup validation/store errors reach here, never log credentials or raw HTTP objects.
    console.error(error instanceof Error ? error.message : 'Khởi động thất bại.');
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map