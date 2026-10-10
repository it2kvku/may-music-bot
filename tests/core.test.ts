import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LoadType, type LavalinkResponse, type Track } from 'shoukaku';
import { readConfig } from '../src/config.js';
import { UserError } from '../src/errors.js';
import { SerialExecutor, TrackQueue } from '../src/queue.js';
import { chooseRecommendation, searchIdentifier, unpack } from '../src/resolver.js';
import { SettingsStore } from '../src/settings.js';
import type { MusicTrack } from '../src/types.js';

function track(id: string, overrides: Partial<MusicTrack> = {}): MusicTrack {
  return { encoded: `encoded-${id}`, identifier: id, title: `Title ${id}`, author: 'Artist',
    uri: `https://www.youtube.com/watch?v=${id}`, source: 'youtube', length: 180000,
    isStream: false, requesterId: '123456789012345678', ...overrides };
}
function wireTrack(id: string): Track {
  return { encoded: `encoded-${id}`, info: { identifier: id, isSeekable: true, author: 'Artist',
    length: 180000, isStream: false, position: 0, title: `Title ${id}`, sourceName: 'youtube',
    uri: `https://www.youtube.com/watch?v=${id}`, artworkUrl: 'https://i.ytimg.com/vi/test/default.jpg' },
    pluginInfo: {} };
}
const validEnv = { DISCORD_TOKEN: 'fake-token-for-test', LAVALINK_URL: 'localhost:2333', LAVALINK_PASSWORD: 'fake-password-for-test' };

describe('configuration', () => {
  it('uses safe defaults without requiring a client ID at startup', () => {
    expect(readConfig(validEnv)).toMatchObject({ clientId: undefined, defaultVolume: 60,
      defaultAutoplay: true, maxQueueSize: 500, idleTimeoutMs: 180000,
      node: { url: 'localhost:2333', secure: false }, port: 3000 });
  });
  it('accepts IPv6 Lavalink hosts and gives SERVER_PORT precedence on hosting platforms', () => {
    expect(readConfig({ ...validEnv, LAVALINK_URL: '[::1]:2333', PORT: '4000', SERVER_PORT: '5000' }))
      .toMatchObject({ port: 5000, node: { url: '[::1]:2333' } });
  });
  it.each(['', '0', '65536', '12.5', 'secret-value'])('rejects invalid explicit ports: %s', value => {
    if (value === '') { expect(readConfig({ ...validEnv, PORT: value }).port).toBe(3000); return; }
    expect(() => readConfig({ ...validEnv, PORT: value })).toThrow(/PORT/);
  });
  it.each(['DEFAULT_VOLUME', 'MAX_QUEUE_SIZE', 'MAX_PLAYLIST_SIZE', 'IDLE_TIMEOUT_SECONDS', 'COMMAND_COOLDOWN_MS'])
    ('rejects invalid numeric %s without logging its supplied value', name => {
      const supplied = 'secret-credential-that-must-not-leak';
      try { readConfig({ ...validEnv, [name]: supplied }); throw new Error('expected validation error'); }
      catch (error) { expect(String(error)).toContain(name); expect(String(error)).not.toContain(supplied); }
    });
  it.each(['AUTO_REGISTER_COMMANDS', 'LAVALINK_SECURE', 'DEFAULT_AUTOPLAY', 'ENABLE_HEALTH_SERVER'])
    ('validates boolean %s instead of treating arbitrary strings as true', name => {
      expect(() => readConfig({ ...validEnv, [name]: 'yes' })).toThrow(name);
      expect(() => readConfig({ ...validEnv, [name]: ' FALSE ' })).not.toThrow();
    });
  it.each(['http://host:2333', 'host:0', 'host:65536', 'host:2333/path', 'username:password@host:2333'])
    ('rejects malformed Lavalink address %s', url => {
      expect(() => readConfig({ ...validEnv, LAVALINK_URL: url })).toThrow();
    });
  it('requires secrets but keeps them out of configuration error messages', () => {
    expect(() => readConfig({ ...validEnv, DISCORD_TOKEN: 'replace_token' })).toThrow('DISCORD_TOKEN');
    expect(() => readConfig({ ...validEnv, LAVALINK_PASSWORD: '' })).toThrow('LAVALINK_PASSWORD');
    expect(() => readConfig({ ...validEnv, DISCORD_GUILD_ID: 'private-value' })).toThrow('DISCORD_GUILD_ID');
  });
});

describe('source resolution', () => {
  it.each([
    ['https://youtu.be/abc#fragment', 'https://youtu.be/abc'],
    ['https://music.youtube.com/watch?v=abc', 'https://music.youtube.com/watch?v=abc'],
    ['https://soundcloud.com/artist/song', 'https://soundcloud.com/artist/song'],
    ['https://on.soundcloud.com/share', 'https://on.soundcloud.com/share'],
    ['https://open.spotify.com/playlist/id?si=share', 'https://open.spotify.com/playlist/id?si=share'],
  ])('preserves approved source URL %s', (input, expected) => {
    expect(searchIdentifier(input)).toBe(expected);
  });
  it.each([
    'http://youtube.com/watch?v=id', 'https://youtube.com.evil.test/watch?v=id',
    'https://evil.test/youtube.com', 'https://youtube.com@evil.test/',
    'https://user:password@youtube.com/watch?v=id', 'https://youtube.com:8443/watch?v=id',
    'https://127.0.0.1:2333/', 'https://169.254.169.254/latest/meta-data/',
    'https://localhost/private', 'file:///etc/passwd', 'local:/etc/passwd',
    'ftp://youtube.com/song', 'data:audio/mpeg;base64,AAA', 'ytsearch:injected',
    'spsearch:injected', 'https://', 'hello\u0000world', 'hello\nworld',
  ])('rejects unapproved URL or source identifier %s', input => {
    expect(() => searchIdentifier(input)).toThrow(UserError);
  });
  it('enforces query length and prefixes searches by explicit source', () => {
    expect(() => searchIdentifier('  ')).toThrow(UserError);
    expect(() => searchIdentifier('a'.repeat(501))).toThrow(UserError);
    expect(searchIdentifier('  A song  ', 'soundcloud')).toBe('scsearch:A song');
    expect(searchIdentifier('A song', 'spotify')).toBe('spsearch:A song');
    expect(searchIdentifier('A song')).toBe('ytsearch:A song');
  });
  it('selects one search result but preserves bounded playlist order and omitted count', () => {
    const tracks = [wireTrack('a'), wireTrack('b'), wireTrack('c')];
    const search = unpack({ loadType: LoadType.SEARCH, data: tracks }, 'requester', 20);
    expect(search.tracks.map(t => t.identifier)).toEqual(['a']);
    expect(search.tracks[0]?.requesterId).toBe('requester');
    const playlist: LavalinkResponse = { loadType: LoadType.PLAYLIST,
      data: { encoded: '', info: { name: 'My playlist', selectedTrack: -1 }, pluginInfo: {}, tracks } };
    expect(unpack(playlist, 'requester', 2)).toMatchObject({ total: 3, title: 'My playlist' });
    expect(unpack(playlist, 'requester', 2).tracks.map(t => t.identifier)).toEqual(['a', 'b']);
    expect(unpack({ loadType: LoadType.SEARCH, data: tracks }, 'requester', 2, true).tracks).toHaveLength(2);
  });
  it('returns friendly errors for empty, unavailable, and failed sources', () => {
    expect(() => unpack(undefined, 'u', 10)).toThrow(UserError);
    expect(() => unpack({ loadType: LoadType.EMPTY, data: {} }, 'u', 10)).toThrow(UserError);
    expect(() => unpack({ loadType: LoadType.SEARCH, data: [] }, 'u', 10)).toThrow(UserError);
    expect(() => unpack({ loadType: LoadType.ERROR, data: { message: 'sensitive upstream error', severity: 'fault', cause: 'secret' } }, 'u', 10))
      .toThrow(/Nguồn nhạc/);
  });
  it('autoplay excludes recent IDs, duplicate titles across sources, streams, and short clips', () => {
    const recent = [track('a', { title: 'The Song!', author: 'An Artist' })];
    const candidates = [track('a'), track('b', { title: 'THE SONG', author: 'An-Artist', source: 'soundcloud' }),
      track('stream', { isStream: true }), track('short', { length: 30000 }), track('fresh')];
    expect(chooseRecommendation(candidates, recent)?.identifier).toBe('fresh');
    expect(chooseRecommendation(candidates.slice(0, -1), recent)).toBeUndefined();
  });
});

describe('bounded music queue', () => {
  it('caps waiting tracks and preserves order when a playlist exceeds remaining capacity', () => {
    const queue = new TrackQueue(2);
    expect(queue.add([track('a'), track('b'), track('c')])).toBe(2);
    expect(queue.add([track('d')])).toBe(0);
    expect(queue.next()?.identifier).toBe('a');
    expect(queue.add([track('d'), track('e')])).toBe(1);
    expect(queue.tracks.map(t => t.identifier)).toEqual(['b', 'd']);
  });
  it('repeats a track only on natural completion, and skip explicitly advances', () => {
    const queue = new TrackQueue(2);
    queue.add([track('a'), track('b')]); queue.next(); queue.repeat = 'track';
    expect(queue.next('finished')?.identifier).toBe('a');
    expect(queue.history).toHaveLength(0);
    expect(queue.next('skip')?.identifier).toBe('b');
    expect(queue.history.map(t => t.identifier)).toEqual(['a']);
  });
  it('rotates queue repeat but does not recycle skipped or failed tracks', () => {
    const queue = new TrackQueue(2);
    queue.add([track('a'), track('b')]); queue.next(); queue.repeat = 'queue';
    expect(queue.next('finished')?.identifier).toBe('b');
    expect(queue.tracks.map(t => t.identifier)).toEqual(['a']);
    expect(queue.next('skip')?.identifier).toBe('a');
    expect(queue.next('failed')).toBeNull();
    expect(queue.tracks).toEqual([]);
  });
  it('restores current and waiting tracks when playing previous', () => {
    const queue = new TrackQueue(3);
    queue.add([track('a'), track('b'), track('c')]); queue.next(); queue.next();
    expect(queue.previous().identifier).toBe('a');
    expect(queue.tracks.map(t => t.identifier)).toEqual(['b', 'c']);
    expect(queue.history).toEqual([]);
  });
  it('rejects previous when full without losing the current track or history', () => {
    const queue = new TrackQueue(1);
    queue.current = track('b'); queue.history.push(track('a')); queue.add([track('c')]);
    expect(() => queue.previous()).toThrow(UserError);
    expect(queue.current.identifier).toBe('b');
    expect(queue.history.map(t => t.identifier)).toEqual(['a']);
    expect(queue.tracks.map(t => t.identifier)).toEqual(['c']);
  });
  it('keeps only the most recent 50 tracks in history', () => {
    const queue = new TrackQueue(100);
    queue.add(Array.from({ length: 70 }, (_, index) => track(String(index))));
    for (let index = 0; index < 71; index++) queue.next();
    expect(queue.history).toHaveLength(50);
    expect(queue.history[0]?.identifier).toBe('20');
    expect(queue.history.at(-1)?.identifier).toBe('69');
  });
  it('validates 1-based indexes before mutation and moves in both directions', () => {
    const queue = new TrackQueue(3);
    queue.add([track('a'), track('b'), track('c')]);
    for (const bad of [0, -1, 4, 1.5, Number.NaN]) {
      expect(() => queue.remove(bad)).toThrow(UserError);
      expect(() => queue.move(1, bad)).toThrow(UserError);
    }
    queue.move(1, 3); expect(queue.tracks.map(t => t.identifier)).toEqual(['b', 'c', 'a']);
    queue.move(3, 1); expect(queue.tracks.map(t => t.identifier)).toEqual(['a', 'b', 'c']);
    expect(queue.remove(2).identifier).toBe('b');
  });
  it('shuffles only waiting tracks and clear preserves the currently playing track', () => {
    const queue = new TrackQueue(4);
    queue.add([track('a'), track('b'), track('c'), track('d')]); queue.next();
    queue.shuffle(() => 0);
    expect(queue.current?.identifier).toBe('a');
    expect(queue.tracks.map(t => t.identifier).sort()).toEqual(['b', 'c', 'd']);
    queue.clear(); expect(queue.tracks).toEqual([]); expect(queue.current?.identifier).toBe('a');
  });
});

describe('per-guild operation serialization', () => {
  it('preserves same-guild operation order while allowing other guilds to run', async () => {
    const serial = new SerialExecutor();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = serial.run('guild-a', async () => { events.push('a1-start'); await gate; events.push('a1-end'); });
    const second = serial.run('guild-a', async () => { events.push('a2'); });
    await serial.run('guild-b', async () => { events.push('b'); });
    expect(events).toEqual(['a1-start', 'b']);
    release(); await Promise.all([first, second]);
    expect(events).toEqual(['a1-start', 'b', 'a1-end', 'a2']);
  });
  it('recovers after a rejection without running the next operation early', async () => {
    const serial = new SerialExecutor(); const events: string[] = [];
    const first = serial.run('guild', async () => { events.push('failure'); throw new Error('upstream failed'); });
    const second = serial.run('guild', async () => { events.push('recovery'); return 42; });
    await expect(first).rejects.toThrow('upstream failed');
    await expect(second).resolves.toBe(42);
    expect(events).toEqual(['failure', 'recovery']);
    await expect(serial.run('guild', async () => 'later')).resolves.toBe('later');
  });
});

describe('persistent guild settings', () => {
  const directories: string[] = [];
  const defaults = { volume: 60, autoplay: true, stay: false };
  const firstGuild = '123456789012345678';
  const secondGuild = '223456789012345678';
  async function directory() { const path = await mkdtemp(join(tmpdir(), 'may-music-tests-')); directories.push(path); return path; }
  afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
  it('starts from defaults on first run and returns isolated copies', async () => {
    const store = new SettingsStore(await directory(), defaults); await store.load();
    const value = store.get(firstGuild); value.volume = 1;
    expect(store.get(firstGuild)).toEqual(defaults);
  });
  it('persists simultaneous guild updates as valid JSON and reloads them after restart', async () => {
    const path = await directory(); const store = new SettingsStore(path, defaults); await store.load();
    await Promise.all([
      store.set(firstGuild, { volume: 10, autoplay: false, stay: true }),
      store.set(secondGuild, { volume: 20, autoplay: true, stay: false }),
      store.set(firstGuild, { volume: 30, autoplay: true, stay: true }),
    ]);
    expect(JSON.parse(await readFile(join(path, 'settings.json'), 'utf8'))).toEqual({
      [firstGuild]: { volume: 30, autoplay: true, stay: true },
      [secondGuild]: { volume: 20, autoplay: true, stay: false },
    });
    expect(await readdir(path)).toEqual(['settings.json']);
    const reloaded = new SettingsStore(path, defaults); await reloaded.load();
    expect(reloaded.get(firstGuild)).toEqual({ volume: 30, autoplay: true, stay: true });
    expect(reloaded.get(secondGuild)).toEqual({ volume: 20, autoplay: true, stay: false });
  });
  it.each(['{broken json', '[]', 'null', '42'])('fails clearly without overwriting malformed existing data: %s', async content => {
    const path = await directory(); await writeFile(join(path, 'settings.json'), content);
    const store = new SettingsStore(path, defaults);
    await expect(store.load()).rejects.toThrow('settings.json');
    expect(await readFile(join(path, 'settings.json'), 'utf8')).toBe(content);
  });
  it('ignores invalid persisted guild IDs and unsafe volume or flag values', async () => {
    const path = await directory();
    await writeFile(join(path, 'settings.json'), JSON.stringify({
      [firstGuild]: { volume: 500, autoplay: true, stay: false },
      [secondGuild]: { volume: 35, autoplay: false, stay: true },
      invalid: { volume: 35, autoplay: false, stay: true },
      '323456789012345678': { volume: 35, autoplay: 'yes', stay: true },
      '423456789012345678': null,
    }));
    const store = new SettingsStore(path, defaults); await store.load();
    expect(store.get(firstGuild)).toEqual(defaults);
    expect(store.get(secondGuild)).toEqual({ volume: 35, autoplay: false, stay: true });
    expect(store.get('invalid')).toEqual(defaults);
    expect(store.get('323456789012345678')).toEqual(defaults);
    expect(store.get('423456789012345678')).toEqual(defaults);
  });
});
