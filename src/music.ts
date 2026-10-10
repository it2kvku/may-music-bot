import { type Client, type VoiceState } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { Constants, type FilterOptions, type Player, type Shoukaku } from 'shoukaku';
import type { Config } from './config.js';
import { UserError, log } from './errors.js';
import { SerialExecutor, TrackQueue } from './queue.js';
import { chooseRecommendation, searchIdentifier, unpack } from './resolver.js';
import type { SettingsStore } from './settings.js';
import type { ControlAction, FilterName, MusicService, MusicTrack, PlayContext, RepeatMode, SearchSource, SessionSnapshot } from './types.js';

interface Session {
  context: PlayContext; player: Player; queue: TrackQueue; volume: number; autoplay: boolean; stay: boolean;
  filter: FilterName; generation: number; failures: number; playbackId?: string; idleTimer?: NodeJS.Timeout; emptyTimer?: NodeJS.Timeout;
}
const filters: Record<FilterName, FilterOptions> = {
  off: {}, bassboost: { equalizer: [{ band: 0, gain: 0.2 }, { band: 1, gain: 0.15 }, { band: 2, gain: 0.1 }] },
  nightcore: { timescale: { speed: 1.15, pitch: 1.2, rate: 1 } },
  vaporwave: { timescale: { speed: 0.85, pitch: 0.85, rate: 1 } },
  karaoke: { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } },
};

export class MusicManager implements MusicService {
  private readonly sessions = new Map<string, Session>();
  private readonly serial = new SerialExecutor();
  private readonly searching = new Map<string, { cancelled: boolean }>();
  onTrackStart: (snapshot: SessionSnapshot) => Promise<void> = async () => {};
  onNotice: (channelId: string, message: string) => Promise<void> = async () => {};
  constructor(private readonly shoukaku: Shoukaku, private readonly client: Client, private readonly config: Config, private readonly settings: SettingsStore) {}

  connectedNodes(): number { return [...this.shoukaku.nodes.values()].filter(n => n.state === Constants.State.CONNECTED).length; }
  snapshot(guildId: string): SessionSnapshot | null {
    const s = this.sessions.get(guildId);
    if (!s) return null;
    return { ...s.context, current: s.queue.current, queue: [...s.queue.tracks], history: [...s.queue.history],
      paused: s.player.paused, position: s.player.position, volume: s.volume, repeat: s.queue.repeat,
      autoplay: s.autoplay, stay: s.stay, filter: s.filter };
  }
  async enqueue(context: PlayContext, query: string, source: SearchSource = 'youtube') {
    const identifier = searchIdentifier(query, source);
    const existing = this.sessions.get(context.guildId);
    if (existing && existing.context.voiceChannelId !== context.voiceChannelId) throw new UserError('Bạn cần vào cùng kênh thoại với bot.');
    if (this.searching.has(context.guildId)) throw new UserError('Đang tải yêu cầu trước đó trong server. Hãy thử lại sau vài giây.');
    const node = this.shoukaku.getIdealNode();
    if (!node) throw new UserError('Máy chủ âm thanh chưa kết nối. Hãy kiểm tra cấu hình Lavalink.');
    const request = { cancelled: false };
    this.searching.set(context.guildId, request);
    try {
      const result = unpack(await node.rest.resolve(identifier), context.requesterId, this.config.maxPlaylistSize);
      return await this.serial.run(context.guildId, async () => {
        if (request.cancelled) throw new UserError('Yêu cầu thêm nhạc đã hủy bởi lệnh /stop.');
        // The member may have left or moved while a playlist was loading.
        const channelId = this.client.guilds.cache.get(context.guildId)?.voiceStates.cache.get(context.requesterId)?.channelId;
        if (channelId !== context.voiceChannelId) throw new UserError('Bạn đã rời/chuyển kênh thoại trong lúc tải bài. Hãy dùng /play lại.');
        let s = this.sessions.get(context.guildId);
        if (s && s.context.voiceChannelId !== context.voiceChannelId) throw new UserError('Bot đang phát ở kênh thoại khác.');
        if (!s) s = await this.createSession(context);
        const added = s.queue.add(result.tracks);
        if (!added) throw new UserError('Hàng đợi đã đầy. Hãy xóa bớt bài bằng /remove hoặc /clear.');
        s.context.textChannelId = context.textChannelId;
        this.clearIdle(s);
        if (!s.queue.current) await this.advance(s, 'finished');
        return { added, omitted: result.total - added, title: result.title, first: result.tracks[0]! };
      });
    } catch (error) {
      if (error instanceof UserError) throw error;
      log('enqueue_failed', { guildId: context.guildId });
      throw new UserError('Không tải/phát được nhạc. Kiểm tra kết nối Lavalink, plugin của nguồn nhạc hoặc thử link khác.');
    } finally { this.searching.delete(context.guildId); }
  }
  private async createSession(context: PlayContext): Promise<Session> {
    let player: Player;
    try { player = await this.shoukaku.joinVoiceChannel({ guildId: context.guildId, channelId: context.voiceChannelId, shardId: context.shardId, deaf: true }); }
    catch {
      await this.shoukaku.leaveVoiceChannel(context.guildId).catch(() => undefined);
      throw new UserError('Không thể vào kênh thoại. Kiểm tra quyền Connect/Speak, số người tối đa và kết nối Lavalink.');
    }
    const saved = this.settings.get(context.guildId);
    const s: Session = { context: { ...context }, player, queue: new TrackQueue(this.config.maxQueueSize), ...saved,
      filter: 'off', generation: 0, failures: 0 };
    this.sessions.set(context.guildId, s);
    player.on('start', event => {
      if (this.sessions.get(context.guildId) !== s || !this.matchesPlayback(s, event.track)) return;
      s.failures = 0;
      const snapshot = this.snapshot(context.guildId);
      if (snapshot) void this.onTrackStart(snapshot).catch(() => log('track_notification_failed', { guildId: context.guildId }));
    });
    player.on('end', event => {
      if (!['finished', 'loadFailed'].includes(event.reason)) return;
      const generation = s.generation;
      void this.serial.run(context.guildId, async () => {
        if (this.sessions.get(context.guildId) !== s || s.generation !== generation || !this.matchesPlayback(s, event.track)) return;
        if (event.reason === 'loadFailed') { s.failures++; this.notice(s, 'Bài này không phát được; đang chuyển bài tiếp theo.'); }
        await this.advance(s, event.reason === 'finished' ? 'finished' : 'failed');
      }).catch(() => this.eventFailure(s));
    });
    player.on('exception', () => log('track_exception', { guildId: context.guildId }));
    player.on('stuck', event => {
      const generation = s.generation;
      void this.serial.run(context.guildId, async () => {
        if (this.sessions.get(context.guildId) !== s || s.generation !== generation || !this.matchesPlayback(s, event.track)) return;
        s.failures++;
        this.notice(s, 'Luồng âm thanh bị treo; đang chuyển bài tiếp theo.');
        await this.advance(s, 'failed');
      }).catch(() => this.eventFailure(s));
    });
    player.on('closed', () => {
      void this.serial.run(context.guildId, async () => {
        if (this.sessions.get(context.guildId) !== s) return;
        this.notice(s, 'Kết nối thoại đã đóng. Dùng /play để kết nối lại.');
        await this.destroy(s);
      }).catch(() => log('voice_cleanup_failed', { guildId: context.guildId }));
    });
    return s;
  }
  private async playCurrent(s: Session) {
    if (!s.queue.current) return;
    s.generation++;
    s.playbackId = randomUUID();
    await s.player.playTrack({ track: { encoded: s.queue.current.encoded, userData: { playbackId: s.playbackId } }, position: 0, paused: false, volume: s.volume });
  }
  private matchesPlayback(s: Session, track: { encoded: string }): boolean {
    const data = (track as { userData?: { playbackId?: string } }).userData;
    return s.queue.current?.encoded === track.encoded && (!data?.playbackId || data.playbackId === s.playbackId);
  }
  private async advance(s: Session, reason: 'finished' | 'skip' | 'failed') {
    const seed = s.queue.current ?? s.queue.history.at(-1);
    let track = s.queue.next(reason);
    if (!track && s.autoplay && seed && reason !== 'failed') {
      track = await this.recommend(s, seed);
      if (track) s.queue.current = track;
    }
    while (track && s.failures < 5) {
      try { await this.playCurrent(s); this.clearIdle(s); return; }
      catch { s.failures++; log('track_play_failed', { guildId: s.context.guildId }); track = s.queue.next('failed'); }
    }
    if (s.failures >= 5) {
      this.notice(s, 'Đã dừng sau 5 lỗi phát liên tiếp. Kiểm tra nguồn nhạc/Lavalink rồi dùng /play lại.');
      await this.destroy(s); return;
    }
    // Invalidate stale end/stuck callbacks even when the next queue is empty.
    s.generation++;
    await s.player.stopTrack().catch(() => undefined);
    this.notice(s, 'Hàng đợi đã hết. Thêm bài bằng /play.');
    this.armIdle(s);
  }
  private async recommend(s: Session, seed: MusicTrack): Promise<MusicTrack | null> {
    const node = this.shoukaku.getIdealNode();
    if (!node) return null;
    const queries: string[] = [];
    if (seed.source.toLowerCase() === 'youtube' && /^[\w-]{11}$/.test(seed.identifier)) queries.push(`https://www.youtube.com/watch?v=${seed.identifier}&list=RD${seed.identifier}`);
    queries.push(`${seed.source.toLowerCase() === 'soundcloud' ? 'scsearch' : 'ytsearch'}:${seed.author}`);
    for (const query of queries) {
      try {
        const candidates = unpack(await node.rest.resolve(query), this.client.user?.id ?? seed.requesterId, 40, true).tracks;
        const chosen = chooseRecommendation(candidates, [...s.queue.history, seed]);
        if (chosen) return { ...chosen, autoplay: true };
      } catch { log('autoplay_source_unavailable', { guildId: s.context.guildId }); }
    }
    this.notice(s, 'Autoplay chưa tìm được bài mới phù hợp. Bạn có thể thêm bài bằng /play.');
    return null;
  }
  async control(guildId: string, voiceChannelId: string, action: ControlAction, value?: string | number | boolean | number[]): Promise<string> {
    if (action === 'stop' && this.sessions.get(guildId)?.context.voiceChannelId === voiceChannelId) {
      const request = this.searching.get(guildId);
      if (request) request.cancelled = true;
    }
    return this.serial.run(guildId, async () => {
      const s = this.sessions.get(guildId);
      if (!s) throw new UserError('Chưa có phiên nhạc. Dùng /play trước.');
      if (s.context.voiceChannelId !== voiceChannelId) throw new UserError('Bạn cần vào cùng kênh thoại với bot.');
      switch (action) {
        case 'pause': case 'resume': case 'toggle': {
          if (!s.queue.current) throw new UserError('Chưa có bài đang phát.');
          const paused = action === 'toggle' ? !s.player.paused : action === 'pause';
          await s.player.setPaused(paused); return paused ? 'Đã tạm dừng.' : 'Đã tiếp tục phát.';
        }
        case 'skip': await this.advance(s, 'skip'); return 'Đã chuyển bài.';
        case 'stop': await this.destroy(s); return 'Đã dừng, xóa hàng đợi và rời kênh thoại.';
        case 'shuffle': s.queue.shuffle(); return 'Đã trộn hàng đợi.';
        case 'loop': {
          if (!['off', 'track', 'queue'].includes(String(value))) throw new UserError('Chế độ lặp không hợp lệ.');
          s.queue.repeat = value as RepeatMode; return `Chế độ lặp: ${value}.`;
        }
        case 'autoplay': s.autoplay = typeof value === 'boolean' ? value : !s.autoplay; await this.save(s); return `Autoplay: ${s.autoplay ? 'bật' : 'tắt'}.`;
        case 'stay': {
          s.stay = typeof value === 'boolean' ? value : !s.stay;
          if (s.stay) { this.clearIdle(s); if (s.emptyTimer) clearTimeout(s.emptyTimer); s.emptyTimer = undefined; }
          else { if (!s.queue.current) this.armIdle(s); this.checkEmpty(s); }
          await this.save(s); return `Giữ kết nối: ${s.stay ? 'bật' : 'tắt'}.`;
        }
        case 'volume': {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw new UserError('Âm lượng phải từ 0 đến 100.');
          await s.player.setGlobalVolume(value); s.volume = value; await this.save(s); return `Âm lượng: ${value}%.`;
        }
        case 'seek': {
          const track = s.queue.current;
          if (!track || track.isStream) throw new UserError('Không thể tua khi chưa phát bài hoặc đang phát livestream.');
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= track.length) throw new UserError('Mốc tua phải nằm trong thời lượng bài hát.');
          await s.player.seekTo(value); return 'Đã tua đến vị trí yêu cầu.';
        }
        case 'remove': s.queue.remove(Number(value)); return 'Đã xóa bài khỏi hàng đợi.';
        case 'move': {
          if (!Array.isArray(value) || value.length !== 2) throw new UserError('Cần vị trí đầu và cuối.');
          s.queue.move(value[0]!, value[1]!); return 'Đã đổi vị trí bài trong hàng đợi.';
        }
        case 'clear': s.queue.clear(); return 'Đã xóa các bài chờ; bài hiện tại vẫn phát.';
        case 'previous': {
          s.queue.previous();
          try { await this.playCurrent(s); this.clearIdle(s); }
          catch { await this.advance(s, 'failed'); throw new UserError('Bài trước đó không phát được; đã chuyển tiếp.'); }
          return 'Đang phát bài trước đó.';
        }
        case 'filter': {
          if (typeof value !== 'string' || !Object.hasOwn(filters, value)) throw new UserError('Bộ lọc không hợp lệ.');
          await s.player.clearFilters();
          await s.player.setFilters(filters[value as FilterName]); s.filter = value as FilterName; return `Bộ lọc: ${value}.`;
        }
      }
    });
  }
  voiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const s = this.sessions.get(newState.guild.id);
    if (!s) return;
    if (newState.id === this.client.user?.id && oldState.channelId !== newState.channelId) {
      if (!newState.channelId) {
        void this.serial.run(s.context.guildId, async () => { if (this.sessions.get(s.context.guildId) === s) await this.destroy(s); }).catch(() => this.eventFailure(s));
        return;
      }
      s.context.voiceChannelId = newState.channelId;
    }
    this.checkEmpty(s);
  }
  private checkEmpty(s: Session) {
    const channel = this.client.guilds.cache.get(s.context.guildId)?.channels.cache.get(s.context.voiceChannelId);
    const humans = channel?.isVoiceBased() ? channel.members.some(member => !member.user.bot) : false;
    if (humans || s.stay) { if (s.emptyTimer) clearTimeout(s.emptyTimer); s.emptyTimer = undefined; return; }
    if (s.emptyTimer) return;
    s.emptyTimer = setTimeout(() => {
      s.emptyTimer = undefined;
      void this.serial.run(s.context.guildId, async () => {
        if (this.sessions.get(s.context.guildId) !== s || s.stay) return;
        const latest = this.client.guilds.cache.get(s.context.guildId)?.channels.cache.get(s.context.voiceChannelId);
        if (latest?.isVoiceBased() && latest.members.some(member => !member.user.bot)) return;
        this.notice(s, 'Đã rời kênh vì không còn người nghe.'); await this.destroy(s);
      }).catch(() => this.eventFailure(s));
    }, this.config.emptyTimeoutMs).unref();
  }
  private clearIdle(s: Session) { if (s.idleTimer) clearTimeout(s.idleTimer); s.idleTimer = undefined; }
  private armIdle(s: Session) {
    this.clearIdle(s);
    if (s.stay) return;
    s.idleTimer = setTimeout(() => {
      void this.serial.run(s.context.guildId, async () => {
        if (this.sessions.get(s.context.guildId) === s && !s.queue.current && !s.stay) await this.destroy(s);
      }).catch(() => this.eventFailure(s));
    }, this.config.idleTimeoutMs).unref();
  }
  private notice(s: Session, message: string) { void this.onNotice(s.context.textChannelId, message).catch(() => log('notice_failed', { guildId: s.context.guildId })); }
  private eventFailure(s: Session) { log('player_event_failed', { guildId: s.context.guildId }); this.notice(s, 'Có lỗi kết nối âm thanh. Dùng /stop rồi /play để tạo phiên mới.'); }
  private async save(s: Session) {
    try { await this.settings.set(s.context.guildId, { volume: s.volume, autoplay: s.autoplay, stay: s.stay }); }
    catch { log('settings_save_failed'); this.notice(s, 'Thiết lập đã đổi nhưng chưa lưu được xuống ổ đĩa. Kiểm tra DATA_DIR.'); }
  }
  private async destroy(s: Session) {
    this.sessions.delete(s.context.guildId); s.generation++; this.clearIdle(s);
    if (s.emptyTimer) clearTimeout(s.emptyTimer);
    s.player.removeAllListeners();
    await this.shoukaku.leaveVoiceChannel(s.context.guildId).catch(() => log('leave_failed', { guildId: s.context.guildId }));
  }
  async shutdown() { await Promise.allSettled([...this.sessions.values()].map(s => this.serial.run(s.context.guildId, () => this.destroy(s)))); }
}
