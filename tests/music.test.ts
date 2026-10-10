import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Constants, LoadType, type LavalinkResponse, type Player, type Shoukaku, type Track } from 'shoukaku';
import type { Client, VoiceState } from 'discord.js';
import { readConfig } from '../src/config.js';
import { MusicManager } from '../src/music.js';
import type { SettingsStore } from '../src/settings.js';
import type { PlayContext } from '../src/types.js';

const context: PlayContext = { guildId: '123456789012345678', voiceChannelId: '223456789012345678',
  textChannelId: '323456789012345678', shardId: 0, requesterId: '423456789012345678' };
function track(id: string, options: Partial<Track['info']> = {}): Track {
  return { encoded: `encoded-${id}`, info: { identifier: id, author: 'Artist', title: `Song ${id}`,
    length: 180000, isStream: false, isSeekable: true, position: 0, sourceName: 'youtube',
    uri: `https://www.youtube.com/watch?v=${id}`, ...options }, pluginInfo: {} };
}
function playlist(...tracks: Track[]): LavalinkResponse {
  return { loadType: LoadType.PLAYLIST, data: { encoded: '', info: { name: 'Playlist', selectedTrack: -1 }, pluginInfo: {}, tracks } };
}
function end(player: EventEmitter, id: string, reason = 'finished') {
  player.emit('end', { type: 'TrackEndEvent', guildId: context.guildId, track: track(id), reason });
}
async function flush() { for (let count = 0; count < 25; count++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
class FakePlayer extends EventEmitter {
  paused = false;
  position = 0;
  playTrack = vi.fn(async (_options: unknown) => {});
  stopTrack = vi.fn(async () => {});
  setPaused = vi.fn(async (value: boolean) => { this.paused = value; });
  setGlobalVolume = vi.fn(async (_value: number) => {});
  seekTo = vi.fn(async (value: number) => { this.position = value; });
  clearFilters = vi.fn(async () => {});
  setFilters = vi.fn(async (_value: unknown) => {});
}
const managers: MusicManager[] = [];
function fixture(options: { autoplay?: boolean; stay?: boolean; maxQueueSize?: number; maxPlaylistSize?: number } = {}) {
  const player = new FakePlayer();
  const resolve = vi.fn(async (_query: string): Promise<LavalinkResponse> => playlist(track('a'), track('b'), track('c')));
  const node = { state: Constants.State.CONNECTED, rest: { resolve } };
  const shoukaku = { nodes: new Map([['primary', node]]), getIdealNode: vi.fn(() => node),
    joinVoiceChannel: vi.fn(async () => player as unknown as Player), leaveVoiceChannel: vi.fn(async () => {}) };
  const memberVoice = { channelId: context.voiceChannelId };
  const humans = { present: true };
  const channel = { isVoiceBased: () => true, members: { some: (predicate: (member: { user: { bot: boolean } }) => boolean) => humans.present && predicate({ user: { bot: false } }) } };
  const guild = { voiceStates: { cache: new Map([[context.requesterId, memberVoice]]) },
    channels: { cache: new Map([[context.voiceChannelId, channel]]) } };
  const client = { user: { id: '523456789012345678' }, guilds: { cache: new Map([[context.guildId, guild]]) } };
  const settings = { get: vi.fn(() => ({ volume: 60, autoplay: options.autoplay ?? false, stay: options.stay ?? false })), set: vi.fn(async () => {}) };
  const config = { ...readConfig({ DISCORD_TOKEN: 'test-token', LAVALINK_PASSWORD: 'test-password', LAVALINK_URL: 'localhost:2333' }),
    idleTimeoutMs: 1000, emptyTimeoutMs: 1000, maxQueueSize: options.maxQueueSize ?? 500, maxPlaylistSize: options.maxPlaylistSize ?? 100 };
  const manager = new MusicManager(shoukaku as unknown as Shoukaku, client as unknown as Client, config, settings as unknown as SettingsStore);
  manager.onNotice = vi.fn(async () => {}); manager.onTrackStart = vi.fn(async () => {});
  managers.push(manager);
  const voiceUpdate = () => manager.voiceStateUpdate({ channelId: context.voiceChannelId } as VoiceState,
    { id: context.requesterId, channelId: humans.present ? context.voiceChannelId : null, guild: { id: context.guildId } } as VoiceState);
  return { manager, player, shoukaku, resolve, memberVoice, humans, settings, voiceUpdate };
}
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.shutdown()));
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe('music player integration without network or Discord tokens', () => {
  it('joins once, starts the first track, and reports playlist and queue truncation', async () => {
    const f = fixture({ maxQueueSize: 2, maxPlaylistSize: 2 });
    const result = await f.manager.enqueue(context, 'test playlist');
    expect(result).toMatchObject({ added: 2, omitted: 1, title: 'Playlist' });
    expect(f.shoukaku.joinVoiceChannel).toHaveBeenCalledWith({ guildId: context.guildId, channelId: context.voiceChannelId, shardId: 0, deaf: true });
    expect(f.player.playTrack).toHaveBeenCalledWith(expect.objectContaining({
      track: expect.objectContaining({ encoded: 'encoded-a' }), position: 0, paused: false, volume: 60,
    }));
    expect(f.manager.snapshot(context.guildId)?.queue.map(t => t.identifier)).toEqual(['b']);
    expect(f.manager.connectedNodes()).toBe(1);
  });
  it('advances exactly once for duplicated end callbacks and ignores replacement events', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'playlist');
    end(f.player, 'a', 'replaced'); await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('a');
    end(f.player, 'a'); end(f.player, 'a'); await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('b');
    expect(f.player.playTrack).toHaveBeenCalledTimes(2);
  });
  it('ignores a late end event from a track skipped by the user', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'playlist');
    await f.manager.control(context.guildId, context.voiceChannelId, 'skip');
    end(f.player, 'a'); await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('b');
    expect(f.manager.snapshot(context.guildId)?.queue.map(t => t.identifier)).toEqual(['c']);
  });
  it('uses playback IDs to distinguish delayed events when the same song is queued twice', async () => {
    const f = fixture(); f.resolve.mockResolvedValue(playlist(track('a'), track('a'), track('b')));
    await f.manager.enqueue(context, 'repeated song');
    const firstCall = f.player.playTrack.mock.calls[0]![0] as { track: { userData: { playbackId: string } } };
    const original = { ...track('a'), userData: firstCall.track.userData };
    expect(original.userData.playbackId).toEqual(expect.any(String));
    f.player.emit('end', { track: original, reason: 'finished' }); await flush();
    const secondCall = f.player.playTrack.mock.calls[1]![0] as { track: { userData: { playbackId: string } } };
    expect(secondCall.track.userData.playbackId).not.toBe(original.userData.playbackId);
    f.player.emit('end', { track: original, reason: 'finished' });
    f.player.emit('stuck', { track: original, thresholdMs: 10000 });
    f.player.emit('start', { track: original }); await flush();
    expect(f.player.playTrack).toHaveBeenCalledTimes(2);
    expect(f.manager.onTrackStart).not.toHaveBeenCalled();
    expect(f.manager.snapshot(context.guildId)?.queue.map(t => t.identifier)).toEqual(['b']);
    const current = { ...track('a'), userData: secondCall.track.userData };
    f.player.emit('start', { track: current }); await flush();
    expect(f.manager.onTrackStart).toHaveBeenCalledTimes(1);
    f.player.emit('end', { track: current, reason: 'finished' }); await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('b');
  });
  it('ignores a late stuck event from a track skipped by the user', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'playlist');
    await f.manager.control(context.guildId, context.voiceChannelId, 'skip');
    f.player.emit('stuck', { type: 'TrackStuckEvent', guildId: context.guildId, track: track('a'), thresholdMs: 10000 });
    await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('b');
    expect(f.manager.snapshot(context.guildId)?.queue.map(t => t.identifier)).toEqual(['c']);
  });
  it('advances only once when stuck and loadFailed events arrive for the same track', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'playlist');
    f.player.emit('stuck', { type: 'TrackStuckEvent', guildId: context.guildId, track: track('a'), thresholdMs: 10000 });
    end(f.player, 'a', 'loadFailed'); await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('b');
    expect(f.player.playTrack).toHaveBeenCalledTimes(2);
  });
  it('replays on natural finish but skips failed tracks even in repeat-track mode', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'playlist');
    await f.manager.control(context.guildId, context.voiceChannelId, 'loop', 'track');
    end(f.player, 'a'); await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('a');
    expect(f.player.playTrack).toHaveBeenCalledTimes(2);
    end(f.player, 'a', 'loadFailed'); await flush();
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('b');
  });
  it('destroys the session after five consecutive upstream playback failures', async () => {
    const f = fixture(); vi.spyOn(console, 'log').mockImplementation(() => {});
    f.resolve.mockResolvedValue(playlist(...Array.from({ length: 10 }, (_, i) => track(String(i)))));
    f.player.playTrack.mockRejectedValue(new Error('sensitive upstream credentials'));
    await f.manager.enqueue(context, 'playlist');
    expect(f.player.playTrack).toHaveBeenCalledTimes(5);
    expect(f.manager.snapshot(context.guildId)).toBeNull();
    expect(f.shoukaku.leaveVoiceChannel).toHaveBeenCalledTimes(1);
    expect(f.manager.onNotice).toHaveBeenCalledWith(context.textChannelId, expect.stringContaining('5 lỗi'));
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('sensitive upstream credentials'));
  });
  it('rejects queue control from another channel and validates volume and seeking before changing the player', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'playlist');
    await expect(f.manager.control(context.guildId, 'wrong-channel', 'stop')).rejects.toThrow('cùng kênh');
    for (const invalid of [-1, 101, 30.5, Number.NaN]) await expect(f.manager.control(context.guildId, context.voiceChannelId, 'volume', invalid)).rejects.toThrow();
    for (const invalid of [-1, 180000, Number.POSITIVE_INFINITY]) await expect(f.manager.control(context.guildId, context.voiceChannelId, 'seek', invalid)).rejects.toThrow();
    expect(f.player.setGlobalVolume).not.toHaveBeenCalled(); expect(f.player.seekTo).not.toHaveBeenCalled();
    await f.manager.control(context.guildId, context.voiceChannelId, 'volume', 75);
    await f.manager.control(context.guildId, context.voiceChannelId, 'seek', 30000);
    expect(f.settings.set).toHaveBeenCalledWith(context.guildId, { volume: 75, autoplay: false, stay: false });
    expect(f.manager.snapshot(context.guildId)).toMatchObject({ volume: 75, position: 30000 });
  });
  it('rejects a request when the member leaves while source resolution is pending', async () => {
    const f = fixture(); const pending = deferred<LavalinkResponse>(); f.resolve.mockReturnValueOnce(pending.promise);
    const enqueue = f.manager.enqueue(context, 'playlist');
    f.memberVoice.channelId = 'different-channel'; pending.resolve(playlist(track('a')));
    await expect(enqueue).rejects.toThrow('rời/chuyển');
    expect(f.shoukaku.joinVoiceChannel).not.toHaveBeenCalled();
  });
  it('limits each guild to one source lookup and releases the guard after a failed lookup', async () => {
    const f = fixture(); const pending = deferred<LavalinkResponse>(); f.resolve.mockReturnValueOnce(pending.promise);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const first = f.manager.enqueue(context, 'playlist');
    await expect(f.manager.enqueue(context, 'second')).rejects.toThrow('yêu cầu trước');
    pending.reject(new Error('upstream timeout'));
    await expect(first).rejects.toThrow('Không tải/phát');
    await expect(f.manager.enqueue(context, 'retry')).resolves.toMatchObject({ added: 3 });
  });
  it('stop cancels a pending playlist lookup so it cannot reconnect the bot afterwards', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'first playlist');
    const pending = deferred<LavalinkResponse>(); f.resolve.mockReturnValueOnce(pending.promise);
    const loading = f.manager.enqueue(context, 'slow playlist');
    await f.manager.control(context.guildId, context.voiceChannelId, 'stop');
    pending.resolve(playlist(track('new-song')));
    await expect(loading).rejects.toThrow();
    expect(f.manager.snapshot(context.guildId)).toBeNull();
    expect(f.shoukaku.joinVoiceChannel).toHaveBeenCalledTimes(1);
    await expect(f.manager.enqueue(context, 'explicit new request')).resolves.toMatchObject({ added: 3 });
  });
  it('autoplay falls back from exhausted YouTube radio results to fresh artist results', async () => {
    const f = fixture({ autoplay: true });
    const seed = track('aaaaaaaaaaa');
    f.resolve.mockResolvedValueOnce(playlist(seed))
      .mockResolvedValueOnce(playlist(seed, track('live', { isStream: true })))
      .mockResolvedValueOnce({ loadType: LoadType.SEARCH, data: [seed, track('fresh')] });
    await f.manager.enqueue(context, 'seed'); end(f.player, seed.info.identifier); await flush();
    expect(f.resolve.mock.calls.map(call => call[0])).toEqual(['ytsearch:seed',
      'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=RDaaaaaaaaaaa', 'ytsearch:Artist']);
    expect(f.manager.snapshot(context.guildId)?.current).toMatchObject({ identifier: 'fresh', autoplay: true, requesterId: '523456789012345678' });
  });
  it('user queued tracks take priority over autoplay and disabling autoplay prevents recommendations', async () => {
    const f = fixture({ autoplay: true }); await f.manager.enqueue(context, 'playlist');
    end(f.player, 'a'); await flush();
    expect(f.resolve).toHaveBeenCalledTimes(1);
    await f.manager.control(context.guildId, context.voiceChannelId, 'autoplay', false);
    end(f.player, 'b'); await flush(); end(f.player, 'c'); await flush();
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.manager.snapshot(context.guildId)?.current).toBeNull();
    expect(f.player.stopTrack).toHaveBeenCalledTimes(1);
  });
  it('disconnects after an idle queue timeout but cancels that timeout when music resumes', async () => {
    vi.useFakeTimers(); const f = fixture(); f.resolve.mockResolvedValue(playlist(track('a')));
    await f.manager.enqueue(context, 'first'); end(f.player, 'a'); await flush();
    await vi.advanceTimersByTimeAsync(500);
    await f.manager.enqueue(context, 'second'); await vi.advanceTimersByTimeAsync(600);
    expect(f.manager.snapshot(context.guildId)?.current?.identifier).toBe('a');
    end(f.player, 'a'); await flush(); await vi.advanceTimersByTimeAsync(1001);
    expect(f.manager.snapshot(context.guildId)).toBeNull();
  });
  it('rechecks listeners when an empty-channel timeout fires before deciding to disconnect', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.manager.enqueue(context, 'playlist');
    f.humans.present = false; f.voiceUpdate();
    f.humans.present = true; // Membership cache may change before another voice event is processed.
    await vi.advanceTimersByTimeAsync(1001);
    expect(f.manager.snapshot(context.guildId)).not.toBeNull();
    f.humans.present = false; f.voiceUpdate(); await vi.advanceTimersByTimeAsync(1001);
    expect(f.manager.snapshot(context.guildId)).toBeNull();
  });
  it('stay mode suppresses both empty-channel and idle disconnection', async () => {
    vi.useFakeTimers(); const f = fixture({ stay: true }); f.resolve.mockResolvedValue(playlist(track('a')));
    await f.manager.enqueue(context, 'song'); f.humans.present = false; f.voiceUpdate();
    end(f.player, 'a'); await flush(); await vi.advanceTimersByTimeAsync(10000);
    expect(f.manager.snapshot(context.guildId)).toMatchObject({ current: null, stay: true });
    await f.manager.control(context.guildId, context.voiceChannelId, 'stay', false);
    await vi.advanceTimersByTimeAsync(1001);
    expect(f.manager.snapshot(context.guildId)).toBeNull();
  });
  it('stop detaches player callbacks and prevents old events from changing a later session', async () => {
    const f = fixture(); await f.manager.enqueue(context, 'playlist');
    await f.manager.control(context.guildId, context.voiceChannelId, 'stop');
    expect(f.player.eventNames()).toEqual([]);
    end(f.player, 'a'); await flush(); expect(f.manager.snapshot(context.guildId)).toBeNull();
    await f.manager.enqueue(context, 'new playlist');
    expect(f.player.listenerCount('end')).toBe(1);
  });
});
