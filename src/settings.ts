import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { SerialExecutor } from './queue.js';
export interface GuildSettings { volume: number; autoplay: boolean; stay: boolean }
export class SettingsStore {
  private values: Record<string, GuildSettings> = Object.create(null) as Record<string, GuildSettings>;
  private readonly serial = new SerialExecutor();
  constructor(private readonly directory: string, private readonly defaults: GuildSettings) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw: unknown = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid settings file');
      for (const [key, value] of Object.entries(raw)) {
        if (/^\d{17,20}$/.test(key) && value && typeof value === 'object' && Number.isInteger(value.volume) && value.volume >= 0 && value.volume <= 100 && typeof value.autoplay === 'boolean' && typeof value.stay === 'boolean') this.values[key] = value;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Không đọc được data/settings.json. Khôi phục bản sao hoặc sửa file trước khi khởi động.'); }
  }
  get(guildId: string): GuildSettings { return { ...(this.values[guildId] ?? this.defaults) }; }
  async set(guildId: string, value: GuildSettings) {
    await this.serial.run('settings', async () => {
      this.values[guildId] = { ...value };
      const temporary = join(this.directory, 'settings.json.tmp');
      await writeFile(temporary, JSON.stringify(this.values, null, 2), { mode: 0o600 });
      await rename(temporary, join(this.directory, 'settings.json'));
    });
  }
}
