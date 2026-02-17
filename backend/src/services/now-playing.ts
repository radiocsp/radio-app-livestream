import { EventEmitter } from 'events';
import fs from 'fs';

interface NowPlayingConfig {
  mode: 'azuracast' | 'icecast';
  azuracastUrl: string;
  azuracastStation: string;
  icecastUrl: string;
  pollInterval: number;
  textFilePath: string;
}

export class NowPlayingService extends EventEmitter {
  private config: NowPlayingConfig;
  private timer: NodeJS.Timeout | null = null;
  private lastTrack: string = '';

  constructor(config: NowPlayingConfig) {
    super();
    this.config = config;
  }

  start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.config.pollInterval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll() {
    try {
      let track = '';

      if (this.config.mode === 'azuracast' && this.config.azuracastUrl) {
        track = await this.fetchAzuraCast();
      } else if (this.config.mode === 'icecast' && this.config.icecastUrl) {
        track = await this.fetchIcecast();
      }

      if (!track) track = 'No track info';

      if (track !== this.lastTrack) {
        this.lastTrack = track;
        // Write atomically
        const tmpPath = this.config.textFilePath + '.tmp';
        fs.writeFileSync(tmpPath, track);
        fs.renameSync(tmpPath, this.config.textFilePath);
        this.emit('track', track);
      }
    } catch (err: any) {
      this.emit('error', `Now Playing poll error: ${err.message}`);
    }
  }

  private async fetchAzuraCast(): Promise<string> {
    const url = `${this.config.azuracastUrl}/api/nowplaying/${this.config.azuracastStation}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`AzuraCast HTTP ${resp.status}`);
    const data = await resp.json() as any;
    const np = data?.now_playing?.song;
    if (np) {
      return `${np.artist} - ${np.title}`;
    }
    return data?.now_playing?.text || '';
  }

  private async fetchIcecast(): Promise<string> {
    const resp = await fetch(this.config.icecastUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`Icecast HTTP ${resp.status}`);
    const data = await resp.json() as any;
    // Icecast status-json.xsl format
    const source = data?.icestats?.source;
    if (Array.isArray(source)) {
      return source[0]?.title || source[0]?.artist || '';
    }
    return source?.title || '';
  }

  async testNowPlaying(): Promise<{ success: boolean; raw: any; track: string; error?: string }> {
    try {
      let raw: any = null;
      let track = '';

      if (this.config.mode === 'azuracast' && this.config.azuracastUrl) {
        const url = `${this.config.azuracastUrl}/api/nowplaying/${this.config.azuracastStation}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        raw = await resp.json();
        track = raw?.now_playing?.song ? `${raw.now_playing.song.artist} - ${raw.now_playing.song.title}` : '';
      } else if (this.config.mode === 'icecast' && this.config.icecastUrl) {
        const resp = await fetch(this.config.icecastUrl, { signal: AbortSignal.timeout(5000) });
        raw = await resp.json();
        const source = raw?.icestats?.source;
        track = Array.isArray(source) ? source[0]?.title || '' : source?.title || '';
      }

      return { success: true, raw, track };
    } catch (err: any) {
      return { success: false, raw: null, track: '', error: err.message };
    }
  }
}
