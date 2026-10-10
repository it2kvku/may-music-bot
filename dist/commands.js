import { ChannelType, EmbedBuilder, GuildMember, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { allowedMentions, BRAND_COLOR, formatDuration, nowPlaying, safeText } from './ui.js';
const command = (name, description) => new SlashCommandBuilder()
    .setName(name).setDescription(description).setContexts(InteractionContextType.Guild);
export const commandData = [
    command('play', 'Phát hoặc thêm nhạc từ YouTube, SoundCloud, Spotify hay tên bài')
        .addStringOption(o => o.setName('query').setDescription('Link bài, playlist hoặc tên bài cần tìm').setRequired(true).setMaxLength(500))
        .addStringOption(o => o.setName('source').setDescription('Nguồn tìm kiếm; link được nhận diện tự động').addChoices({ name: 'YouTube', value: 'youtube' }, { name: 'SoundCloud', value: 'soundcloud' }, { name: 'Spotify', value: 'spotify' })),
    command('pause', 'Tạm dừng nhạc'),
    command('resume', 'Tiếp tục phát nhạc'),
    command('skip', 'Bỏ qua bài hiện tại'),
    command('stop', 'Dừng nhạc, xoá hàng đợi và rời kênh thoại'),
    command('queue', 'Xem hàng đợi sắp phát')
        .addIntegerOption(o => o.setName('page').setDescription('Trang cần xem, mỗi trang 10 bài').setMinValue(1).setMaxValue(10000)),
    command('nowplaying', 'Xem bài đang phát và bảng điều khiển'),
    command('shuffle', 'Trộn ngẫu nhiên hàng đợi'),
    command('loop', 'Chọn chế độ lặp lại')
        .addStringOption(o => o.setName('mode').setDescription('Chế độ lặp').setRequired(true).addChoices({ name: 'Tắt', value: 'off' }, { name: 'Một bài', value: 'track' }, { name: 'Cả hàng đợi', value: 'queue' })),
    command('autoplay', 'Tự tìm bài liên quan khi hết hàng đợi')
        .addBooleanOption(o => o.setName('enabled').setDescription('Bật hoặc tắt; bỏ trống để đảo trạng thái')),
    command('volume', 'Điều chỉnh âm lượng 0–100%')
        .addIntegerOption(o => o.setName('amount').setDescription('Âm lượng phần trăm').setRequired(true).setMinValue(0).setMaxValue(100)),
    command('seek', 'Tua đến một thời điểm trong bài')
        .addStringOption(o => o.setName('position').setDescription('Số giây, mm:ss hoặc hh:mm:ss (ví dụ 1:30)').setRequired(true).setMaxLength(12)),
    command('remove', 'Xoá một bài khỏi hàng đợi')
        .addIntegerOption(o => o.setName('position').setDescription('Số thứ tự trong /queue').setRequired(true).setMinValue(1)),
    command('move', 'Chuyển vị trí một bài trong hàng đợi')
        .addIntegerOption(o => o.setName('from').setDescription('Vị trí hiện tại').setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName('to').setDescription('Vị trí mới').setRequired(true).setMinValue(1)),
    command('clear', 'Xoá hàng đợi và giữ bài hiện tại'),
    command('previous', 'Phát lại bài trước đó'),
    command('filter', 'Chọn hiệu ứng âm thanh')
        .addStringOption(o => o.setName('preset').setDescription('Hiệu ứng').setRequired(true).addChoices({ name: 'Tắt', value: 'off' }, { name: 'Bass boost', value: 'bassboost' }, { name: 'Nightcore', value: 'nightcore' }, { name: 'Vaporwave', value: 'vaporwave' }, { name: 'Karaoke', value: 'karaoke' })),
    command('stay', 'Ở lại kênh khi hết nhạc (cần quyền Quản lý máy chủ)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addBooleanOption(o => o.setName('enabled').setDescription('Bật hoặc tắt ở lại kênh').setRequired(true)),
    command('help', 'Hướng dẫn sử dụng Mây Music'),
    command('ping', 'Kiểm tra độ trễ và máy chủ âm thanh'),
].map(builder => builder.toJSON());
const cooldowns = new Map();
const readableCommands = new Set(['queue', 'nowplaying', 'help', 'ping']);
const buttonActions = new Set(['previous', 'toggle', 'skip', 'shuffle', 'stop', 'loop', 'autoplay', 'queue', 'refresh']);
class InputError extends Error {
    name = 'UserError';
}
/** Strictly parse seek positions; reject silent coercions such as 1:99 or 1e3. */
export function parseSeekPosition(raw) {
    const value = raw.trim();
    if (!/^\d{1,7}(?::\d{1,2}){0,2}$/.test(value))
        throw new InputError('Thời điểm không hợp lệ. Dùng số giây, mm:ss hoặc hh:mm:ss, ví dụ 1:30.');
    const parts = value.split(':').map(Number);
    if (parts.length > 1 && parts.slice(1).some(part => part >= 60))
        throw new InputError('Phần phút/giây sau dấu : phải nằm trong 00–59.');
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    if (!Number.isSafeInteger(seconds * 1000) || seconds > 604800)
        throw new InputError('Thời điểm tua quá lớn; hãy chọn một vị trí trong bài.');
    return seconds * 1000;
}
function checkCooldown(interaction, options) {
    const now = Date.now();
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const until = cooldowns.get(key) ?? 0;
    if (until > now)
        throw new InputError(`Bạn thao tác hơi nhanh. Thử lại sau ${Math.max(1, Math.ceil((until - now) / 1000))} giây.`);
    if (cooldowns.size >= 1000) {
        for (const [entry, expiry] of cooldowns)
            if (expiry <= now)
                cooldowns.delete(entry);
    }
    if (cooldowns.size >= 10000) {
        const oldest = cooldowns.keys().next().value;
        if (oldest !== undefined)
            cooldowns.delete(oldest);
    }
    cooldowns.set(key, now + Math.max(0, options.cooldownMs));
}
async function voiceMember(interaction, music, requiresSession) {
    const guild = interaction.guild;
    if (!guild || !interaction.guildId)
        throw new InputError('Hãy dùng lệnh trong một máy chủ Discord.');
    const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;
    if (!channel)
        throw new InputError('Bạn cần vào một kênh thoại trước khi điều khiển nhạc.');
    if (channel.type !== ChannelType.GuildVoice)
        throw new InputError('Hãy dùng kênh thoại thông thường. Mây chưa hỗ trợ kênh Sân khấu (Stage).');
    const snapshot = music.snapshot(guild.id);
    if (requiresSession && !snapshot)
        throw new InputError('Chưa có phiên nghe nhạc. Dùng /play để bắt đầu.');
    if (snapshot && snapshot.voiceChannelId !== channel.id)
        throw new InputError('Bạn cần ở cùng kênh thoại với Mây để điều khiển hoặc thêm nhạc.');
    // Check the actual voice connection as well, including while a join is in progress.
    const botChannel = guild.members.me?.voice.channelId;
    if (botChannel && botChannel !== channel.id)
        throw new InputError('Mây đang ở kênh thoại khác. Hãy vào cùng kênh với bot.');
    return member;
}
function checkDj(member, options, action) {
    const manager = member.permissions.has(PermissionFlagsBits.ManageGuild);
    if (action === 'stay' && !manager)
        throw new InputError('Lệnh /stay cần quyền Quản lý máy chủ.');
    if (options.djRoleId && !manager && !member.roles.cache.has(options.djRoleId))
        throw new InputError('Chỉ thành viên có vai trò DJ hoặc quyền Quản lý máy chủ mới được điều khiển nhạc.');
}
function queueView(snapshot, page) {
    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('≡ Hàng đợi');
    if (!snapshot || !snapshot.queue.length) {
        embed.setDescription(snapshot?.current ? `Đang phát: **${safeText(snapshot.current.title)}**\n\nHàng đợi đang trống. Dùng /play để thêm bài hoặc bật /autoplay.` : 'Hàng đợi đang trống. Vào kênh thoại rồi dùng /play để bắt đầu.');
        return { embeds: [embed], allowedMentions };
    }
    const pages = Math.ceil(snapshot.queue.length / 10);
    if (page > pages)
        throw new InputError(`Hàng đợi chỉ có ${pages} trang.`);
    const offset = (page - 1) * 10;
    const list = snapshot.queue.slice(offset, offset + 10).map((track, index) => `**${offset + index + 1}.** ${safeText(track.title, 160)} • ${track.isStream ? 'Trực tiếp' : formatDuration(track.length)}`).join('\n');
    embed.setDescription(`${snapshot.current ? `Đang phát: **${safeText(snapshot.current.title, 160)}**\n\n` : ''}${list}`)
        .setFooter({ text: `Trang ${page}/${pages} • ${snapshot.queue.length} bài • /queue page:${Math.min(page + 1, pages)}` });
    return { embeds: [embed], allowedMentions };
}
function helpView() {
    return { embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('☁️ Mây Music • Hướng dẫn')
                .setDescription('**1.** Vào một kênh thoại.\n**2.** Dùng `/play query:tên bài hoặc link`.\n**3.** Dùng `/nowplaying` để mở các nút điều khiển.')
                .addFields({ name: 'Thêm và khám phá nhạc', value: '`/play` hỗ trợ YouTube, SoundCloud, Spotify và playlist.\n`/autoplay` tự tìm bài liên quan khi hết hàng đợi.\nSpotify cung cấp thông tin bài; âm thanh được tìm từ nguồn phát khả dụng.' }, { name: 'Phát nhạc', value: '`/pause` · `/resume` · `/skip` · `/previous` · `/stop`\n`/seek position:1:30` · `/volume amount:70` · `/filter`' }, { name: 'Hàng đợi', value: '`/queue` · `/shuffle` · `/remove position:2`\n`/move from:3 to:1` · `/clear` · `/loop`' }, { name: 'Tiện ích và quyền', value: '`/nowplaying` · `/ping` · `/stay` (Quản lý máy chủ)\nĐiều khiển nhạc cần ở cùng kênh thoại với bot. Nếu máy chủ cấu hình vai trò DJ, các thao tác điều khiển cần vai trò đó hoặc quyền Quản lý máy chủ.' })], allowedMentions };
}
async function sendError(interaction, error) {
    let message = 'Không thể hoàn thành thao tác lúc này. Vui lòng thử lại sau ít giây hoặc dùng /ping kiểm tra kết nối.';
    if (error instanceof Error && error.name === 'UserError')
        message = error.message;
    const payload = { content: `⚠️ ${safeText(message, 1800)}`, embeds: [], components: [], allowedMentions };
    try {
        if (interaction.deferred || interaction.replied)
            await interaction.editReply(payload);
        else
            await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    catch { /* An expired or deleted Discord interaction cannot be answered again. */ }
}
async function controlCommand(interaction, music, options) {
    const action = interaction.commandName;
    const member = await voiceMember(interaction, music, true);
    checkDj(member, options, action);
    checkCooldown(interaction, options);
    let value;
    switch (action) {
        case 'loop':
            value = interaction.options.getString('mode', true);
            break;
        case 'autoplay':
            value = interaction.options.getBoolean('enabled') ?? !music.snapshot(member.guild.id)?.autoplay;
            break;
        case 'volume':
            value = interaction.options.getInteger('amount', true);
            break;
        case 'seek':
            value = parseSeekPosition(interaction.options.getString('position', true));
            break;
        case 'remove':
            value = interaction.options.getInteger('position', true);
            break;
        case 'move':
            value = [interaction.options.getInteger('from', true), interaction.options.getInteger('to', true)];
            break;
        case 'filter':
            value = interaction.options.getString('preset', true);
            break;
        case 'stay':
            value = interaction.options.getBoolean('enabled', true);
            break;
    }
    const message = await music.control(member.guild.id, member.voice.channelId, action, value);
    await interaction.editReply({ content: `✅ ${safeText(message, 1800)}`, allowedMentions });
}
async function handleCommand(interaction, music, options) {
    const name = interaction.commandName;
    if (!commandData.some(item => item.name === name))
        return;
    await interaction.deferReply(name === 'play' || name === 'nowplaying' ? {} : { flags: MessageFlags.Ephemeral });
    if (!interaction.guild || !interaction.guildId)
        throw new InputError('Hãy dùng lệnh trong một máy chủ Discord.');
    if (readableCommands.has(name)) {
        let payload;
        switch (name) {
            case 'queue':
                payload = queueView(music.snapshot(interaction.guildId), interaction.options.getInteger('page') ?? 1);
                break;
            case 'nowplaying':
                payload = nowPlaying(music.snapshot(interaction.guildId));
                break;
            case 'help':
                payload = helpView();
                break;
            default: payload = { content: `🏓 Gateway: **${Math.max(0, Math.round(interaction.client.ws.ping))} ms** • Máy chủ âm thanh sẵn sàng: **${music.connectedNodes()}**`, allowedMentions };
        }
        await interaction.editReply(payload);
        return;
    }
    if (name !== 'play')
        return controlCommand(interaction, music, options);
    const member = await voiceMember(interaction, music, false);
    const channel = member.voice.channel;
    const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
        throw new InputError('Mây cần quyền Xem kênh, Kết nối và Nói trong kênh thoại này. Hãy kiểm tra quyền và ghi đè quyền của kênh.');
    }
    checkCooldown(interaction, options);
    const query = interaction.options.getString('query', true).trim();
    if (!query)
        throw new InputError('Hãy nhập tên bài, link bài hát hoặc playlist.');
    const result = await music.enqueue({ guildId: member.guild.id, voiceChannelId: channel.id, textChannelId: interaction.channelId,
        shardId: member.guild.shardId, requesterId: interaction.user.id }, query, interaction.options.getString('source') ?? undefined);
    const omitted = result.omitted ? ` Bỏ qua ${result.omitted} bài do giới hạn hàng đợi/playlist.` : '';
    await interaction.editReply({ content: `✅ Đã thêm **${result.added}** bài: **${safeText(result.title, 220)}**.${omitted}`, ...nowPlaying(music.snapshot(member.guild.id)) });
}
async function handleButton(interaction, music, options) {
    const [prefix, guildId, action, extra] = interaction.customId.split(':');
    if (prefix !== 'music')
        return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!guildId || guildId !== interaction.guildId || extra !== undefined || !action || !buttonActions.has(action))
        throw new InputError('Bảng điều khiển không hợp lệ. Dùng /nowplaying để mở bảng mới.');
    // Buttons belong to a voice session, including their read-only queue/refresh actions.
    const member = await voiceMember(interaction, music, true);
    if (action === 'queue') {
        await interaction.editReply(queueView(music.snapshot(guildId), 1));
        return;
    }
    if (action === 'refresh') {
        await interaction.message.edit(nowPlaying(music.snapshot(guildId)));
        await interaction.editReply({ content: '↺ Đã làm mới bảng điều khiển.', allowedMentions });
        return;
    }
    checkDj(member, options, action);
    checkCooldown(interaction, options);
    const snapshot = music.snapshot(guildId);
    const value = action === 'loop' ? { off: 'track', track: 'queue', queue: 'off' }[snapshot.repeat]
        : action === 'autoplay' ? !snapshot.autoplay : undefined;
    const message = await music.control(guildId, member.voice.channelId, action, value);
    await interaction.message.edit(nowPlaying(music.snapshot(guildId))).catch(() => undefined);
    await interaction.editReply({ content: `✅ ${safeText(message, 1800)}`, allowedMentions });
}
export async function handleInteraction(interaction, music, options) {
    if (!interaction.isChatInputCommand() && !interaction.isButton())
        return;
    try {
        if (interaction.isChatInputCommand())
            await handleCommand(interaction, music, options);
        else
            await handleButton(interaction, music, options);
    }
    catch (error) {
        await sendError(interaction, error);
    }
}
//# sourceMappingURL=commands.js.map