import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { SessionSnapshot } from './types.js';

export const BRAND_COLOR = 0x8b9dff;
export const allowedMentions = { parse: [] as [] };

/** Untrusted provider metadata is displayed as text, never as mentions or markup. */
export function safeText(value: string, maxLength = 200): string {
  return escapeMarkdown(value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/@/g, '@\u200b').replace(/[<>]/g, ''))
    .slice(0, maxLength);
}

export function safeUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function button(guildId: string, action: string, label: string, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(`music:${guildId}:${action}`).setLabel(label).setStyle(style);
}

export function nowPlaying(snapshot: SessionSnapshot | null) {
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setFooter({ text: 'Mây Music • /help để xem các lệnh' });
  if (!snapshot?.current) {
    embed.setTitle('☁️ Mây Music').setDescription('Chưa có bài đang phát. Vào kênh thoại rồi dùng **/play** để bắt đầu.');
    return { embeds: [embed], components: [] as ActionRowBuilder<ButtonBuilder>[], allowedMentions };
  }
  const track = snapshot.current;
  embed.setTitle(`${snapshot.paused ? '⏸ Đã tạm dừng' : '♫ Đang phát'} • ${safeText(track.title, 220)}`)
    .setDescription(`**${safeText(track.author || 'Không rõ nghệ sĩ')}**${track.autoplay ? '\n✦ Đề xuất bởi Autoplay' : ''}`);
  const uri = safeUrl(track.uri);
  const artwork = safeUrl(track.artwork);
  if (uri) embed.setURL(uri);
  if (artwork) embed.setThumbnail(artwork);
  const position = Math.max(0, snapshot.position);
  const filled = track.length > 0 ? Math.round(Math.min(position / track.length, 1) * 12) : 0;
  const progress = track.isStream ? '🔴 Trực tiếp' : `${'━'.repeat(filled)}●${'─'.repeat(12 - filled)}\n${formatDuration(position)} / ${formatDuration(track.length)}`;
  const repeat = { off: 'Tắt', track: 'Một bài', queue: 'Hàng đợi' }[snapshot.repeat];
  embed.addFields(
    { name: 'Thời gian', value: progress },
    { name: 'Âm lượng', value: `${snapshot.volume}%`, inline: true },
    { name: 'Lặp lại', value: repeat, inline: true },
    { name: 'Autoplay', value: snapshot.autoplay ? 'Bật' : 'Tắt', inline: true },
    { name: 'Hàng đợi', value: `${snapshot.queue.length} bài`, inline: true },
    { name: 'Hiệu ứng', value: snapshot.filter, inline: true },
    { name: 'Ở lại kênh', value: snapshot.stay ? 'Bật' : 'Tắt', inline: true },
  );
  const first = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(snapshot.guildId, 'previous', '⏮ Trước'),
    button(snapshot.guildId, 'toggle', snapshot.paused ? '▶ Tiếp tục' : '⏸ Tạm dừng', ButtonStyle.Primary),
    button(snapshot.guildId, 'skip', '⏭ Bỏ qua'),
    button(snapshot.guildId, 'shuffle', '⤨ Trộn'),
    button(snapshot.guildId, 'stop', '⏹ Dừng', ButtonStyle.Danger),
  );
  const second = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(snapshot.guildId, 'loop', `↻ Lặp: ${repeat}`, snapshot.repeat === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
    button(snapshot.guildId, 'autoplay', `✦ Autoplay: ${snapshot.autoplay ? 'Bật' : 'Tắt'}`, snapshot.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
    button(snapshot.guildId, 'queue', '≡ Hàng đợi'),
    button(snapshot.guildId, 'refresh', '↺ Làm mới'),
  );
  return { embeds: [embed], components: [first, second], allowedMentions };
}
