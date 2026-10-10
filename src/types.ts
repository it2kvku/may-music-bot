export type SearchSource = 'youtube' | 'soundcloud' | 'spotify';
export type RepeatMode = 'off' | 'track' | 'queue';
export type FilterName = 'off' | 'bassboost' | 'nightcore' | 'vaporwave' | 'karaoke';
export interface MusicTrack {
  encoded: string;
  identifier: string;
  title: string;
  author: string;
  uri: string;
  source: string;
  length: number;
  isStream: boolean;
  artwork?: string;
  requesterId: string;
  autoplay?: boolean;
}
export interface SessionSnapshot {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  current: MusicTrack | null;
  queue: MusicTrack[];
  history: MusicTrack[];
  paused: boolean;
  position: number;
  volume: number;
  repeat: RepeatMode;
  autoplay: boolean;
  stay: boolean;
  filter: FilterName;
}
export interface PlayContext {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  shardId: number;
  requesterId: string;
}
export interface EnqueueResult { added: number; omitted: number; title: string; first: MusicTrack }
export type ControlAction = 'pause' | 'resume' | 'toggle' | 'skip' | 'stop' | 'shuffle' | 'loop' | 'autoplay' | 'volume' | 'seek' | 'remove' | 'move' | 'clear' | 'previous' | 'filter' | 'stay';
export interface MusicService {
  enqueue(context: PlayContext, query: string, source?: SearchSource): Promise<EnqueueResult>;
  control(guildId: string, voiceChannelId: string, action: ControlAction, value?: string | number | boolean | number[]): Promise<string>;
  snapshot(guildId: string): SessionSnapshot | null;
  connectedNodes(): number;
}
