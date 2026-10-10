import { describe, expect, it, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits, type Interaction } from 'discord.js';
import { commandData, handleInteraction, parseSeekPosition } from '../src/commands.js';
import { formatDuration, nowPlaying, safeText, safeUrl } from '../src/ui.js';
import type { MusicService, SessionSnapshot } from '../src/types.js';

describe('Discord registration payload', () => {
  it('serializes all promised commands with valid names, unique options and guild-only contexts', () => {
    const data = JSON.parse(JSON.stringify(commandData));
    const names = data.map((command: { name: string }) => command.name);
    expect(names).toEqual(['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'nowplaying', 'shuffle', 'loop', 'autoplay', 'volume', 'seek', 'remove', 'move', 'clear', 'previous', 'filter', 'stay', 'help', 'ping']);
    expect(new Set(names).size).toBe(names.length);
    for (const command of data) {
      expect(command.name).toMatch(/^[a-z]{1,32}$/);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(100);
      expect(command.contexts).toEqual([0]);
      expect(command.options?.length ?? 0).toBeLessThanOrEqual(25);
      const names = (command.options ?? []).map((option: { name: string }) => option.name);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(data.find((command: { name: string }) => command.name === 'stay').default_member_permissions).toBe('32');
  });
});

describe('seek and durations', () => {
  it.each([['0', 0], ['90', 90000], ['1:30', 90000], ['01:02:03', 3723000], ['70:00', 4200000]])('parses %s', (value, expected) => {
    expect(parseSeekPosition(value)).toBe(expected);
  });
  it.each(['-2', '1e3', '1:60', '1:99:00', '1:2:3:4', '', '1.5', 'Infinity', '9999999'])('rejects invalid seek %s', value => {
    expect(() => parseSeekPosition(value)).toThrow();
  });
  it.each([[0, '0:00'], [59999, '0:59'], [60000, '1:00'], [3600000, '1:00:00'], [3723000, '1:02:03'], [-1, '0:00'], [NaN, '0:00']])('formats %s ms', (value, expected) => {
    expect(formatDuration(value as number)).toBe(expected);
  });
});

describe('untrusted metadata and music controls', () => {
  it('rejects executable/credentialed URLs and neutralizes mentions and markdown', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('https://user:password@example.com/a')).toBeUndefined();
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeText('@everyone **test** <@123>')).not.toContain('@everyone');
    expect(safeText('@everyone **test** <@123>')).toContain('\\*\\*test\\*\\*');
  });
  it('scopes buttons to the guild and respects Discord component limits', () => {
    const snapshot: SessionSnapshot = {
      guildId: '123456789012345678', voiceChannelId: '234567890123456789', textChannelId: '345678901234567890',
      current: { encoded: 'abc', identifier: 'a', title: '@everyone [test](x)', author: 'Artist', uri: 'javascript:alert(1)', source: 'youtube', length: 60000, isStream: false, requesterId: '1', artwork: 'file:///tmp/a.png' },
      queue: [], history: [], paused: false, position: 30000, volume: 75, repeat: 'off', autoplay: true, stay: false, filter: 'off',
    };
    const payload = nowPlaying(snapshot);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.embeds[0]?.toJSON().url).toBeUndefined();
    expect(payload.embeds[0]?.toJSON().thumbnail).toBeUndefined();
    expect(payload.components.length).toBeLessThanOrEqual(5);
    for (const row of payload.components) {
      expect(row.components.length).toBeLessThanOrEqual(5);
      for (const control of row.components) {
        const json = control.toJSON();
        expect('custom_id' in json && json.custom_id).toMatch(/^music:123456789012345678:/);
      }
    }
    expect(nowPlaying(null).components).toEqual([]);
  });
});

function interactionFixture(commandName: string, settings: { voiceId?: string; manager?: boolean; dj?: boolean; stage?: boolean; botCanSpeak?: boolean } = {}) {
  const channel = {
    id: settings.voiceId ?? 'voice', type: settings.stage ? ChannelType.GuildStageVoice : ChannelType.GuildVoice,
    permissionsFor: () => ({ has: () => settings.botCanSpeak !== false }),
  };
  const guild = { id: 'guild', shardId: 0, members: { me: { voice: { channelId: 'voice' } }, fetch: vi.fn() } };
  const member = {
    guild, voice: { channel, channelId: channel.id },
    permissions: { has: (permission: bigint) => permission === PermissionFlagsBits.ManageGuild && settings.manager === true },
    roles: { cache: new Map(settings.dj ? [['dj', {}]] : []) },
  };
  guild.members.fetch.mockResolvedValue(member);
  const raw = {
    commandName, guild, guildId: guild.id, channelId: 'text', user: { id: `user-${Math.random()}` }, member: {},
    client: { ws: { ping: 20 } }, deferred: false, replied: false,
    isChatInputCommand: () => true, isButton: () => false,
    options: {
      getString: vi.fn((name: string) => name === 'query' ? 'a song' : null),
      getInteger: vi.fn(), getBoolean: vi.fn(() => true),
    },
    deferReply: vi.fn(async () => { raw.deferred = true; }), editReply: vi.fn(), reply: vi.fn(),
  };
  const music = {
    snapshot: vi.fn(() => ({ guildId: guild.id, voiceChannelId: 'voice', current: null, queue: [], autoplay: false })),
    control: vi.fn(async () => 'Đã xong.'), enqueue: vi.fn(), connectedNodes: vi.fn(() => 1),
  };
  return { raw, music, interaction: raw as unknown as Interaction, service: music as unknown as MusicService };
}

describe('voice and permission enforcement', () => {
  it('blocks a control from another voice channel before calling the music backend', async () => {
    const f = interactionFixture('skip', { voiceId: 'different-voice' });
    await handleInteraction(f.interaction, f.service, { cooldownMs: 0 });
    expect(f.music.control).not.toHaveBeenCalled();
    expect(f.raw.editReply.mock.calls[0]?.[0].content).toContain('cùng kênh thoại');
  });
  it('requires the configured DJ role for controls', async () => {
    const f = interactionFixture('skip');
    await handleInteraction(f.interaction, f.service, { cooldownMs: 0, djRoleId: 'dj' });
    expect(f.music.control).not.toHaveBeenCalled();
    expect(f.raw.editReply.mock.calls[0]?.[0].content).toContain('vai trò DJ');
  });
  it('permits a server manager to control without the configured DJ role', async () => {
    const f = interactionFixture('skip', { manager: true });
    await handleInteraction(f.interaction, f.service, { cooldownMs: 0, djRoleId: 'dj' });
    expect(f.music.control).toHaveBeenCalledWith('guild', 'voice', 'skip', undefined);
  });
  it('requires Manage Guild for stay even when the member has the DJ role', async () => {
    const f = interactionFixture('stay', { dj: true });
    await handleInteraction(f.interaction, f.service, { cooldownMs: 0, djRoleId: 'dj' });
    expect(f.music.control).not.toHaveBeenCalled();
    expect(f.raw.editReply.mock.calls[0]?.[0].content).toContain('Quản lý máy chủ');
  });
  it.each([{ stage: true }, { botCanSpeak: false }])('rejects unsupported or inaccessible voice channels: %j', async settings => {
    const f = interactionFixture('play', settings);
    await handleInteraction(f.interaction, f.service, { cooldownMs: 0 });
    expect(f.music.enqueue).not.toHaveBeenCalled();
  });
  it('does not expose provider errors or try a second initial reply', async () => {
    const f = interactionFixture('skip');
    f.music.control.mockRejectedValueOnce(new Error('secret API token and raw provider response'));
    await handleInteraction(f.interaction, f.service, { cooldownMs: 0 });
    expect(f.raw.reply).not.toHaveBeenCalled();
    expect(f.raw.editReply.mock.calls[0]?.[0].content).toContain('Không thể hoàn thành');
    expect(f.raw.editReply.mock.calls[0]?.[0].content).not.toContain('secret');
  });
  it('enforces the per-user mutation cooldown', async () => {
    const f = interactionFixture('skip');
    await handleInteraction(f.interaction, f.service, { cooldownMs: 1500 });
    await handleInteraction(f.interaction, f.service, { cooldownMs: 1500 });
    expect(f.music.control).toHaveBeenCalledTimes(1);
    expect(f.raw.editReply.mock.calls[1]?.[0].content).toContain('thao tác hơi nhanh');
  });
});
