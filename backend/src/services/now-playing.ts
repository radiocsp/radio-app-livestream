import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

interface NowPlayingConfig {
  mode: 'azuracast' | 'icecast';
  azuracastUrl: string;
  azuracastStation: string;
  icecastUrl: string;
  pollInterval: number;
  textFilePath: string; // main nowplaying.txt (keeps "Artist - Title" for backward compat)
}

interface TrackInfo {
  artist: string;
  title: string;
  full: string; // "Artist - Title"
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

  private getArtistFilePath(): string {
    const dir = path.dirname(this.config.textFilePath);
    return path.join(dir, 'artist.txt');
  }

  private getTitleFilePath(): string {
    const dir = path.dirname(this.config.textFilePath);
    return path.join(dir, 'songtitle.txt');
  }

  private writeFileAtomic(filePath: string, content: string) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  }

  private async poll() {
    try {
      let info: TrackInfo = { artist: '', title: '', full: '' };

      if (this.config.mode === 'azuracast' && this.config.azuracastUrl) {
        info = await this.fetchAzuraCast();
      } else if (this.config.mode === 'icecast' && this.config.icecastUrl) {
        info = await this.fetchIcecast();
      }

      if (!info.full) {
        info.full = 'No track info';
        info.artist = '';
        info.title = 'No track info';
      }

      if (info.full !== this.lastTrack) {
        this.lastTrack = info.full;

        // Write all 3 files atomically: full combo, artist-only, title-only
        this.writeFileAtomic(this.config.textFilePath, info.full);
        this.writeFileAtomic(this.getArtistFilePath(), info.artist || ' ');
        this.writeFileAtomic(this.getTitleFilePath(), info.title || info.full);

        this.emit('track', info.full);
        this.emit('trackInfo', info);
      }
    } catch (err: any) {
      this.emit('error', `Now Playing poll error: ${err.message}`);
    }
  }

  private async fetchAzuraCast(): Promise<TrackInfo> {
    const url = `${this.config.azuracastUrl}/api/nowplaying/${this.config.azuracastStation}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`AzuraCast HTTP ${resp.status}`);
    const data = await resp.json() as any;
    const np = data?.now_playing?.song;
    if (np) {
      const artist = np.artist || '';
      const title = np.title || '';
      return {
        artist,
        title,
        full: artist && title ? `${artist} - ${title}` : (artist || title || data?.now_playing?.text || ''),
      };
    }
    const text = data?.now_playing?.text || '';
    return this.parseTrackString(text);
  }

  private async fetchIcecast(): Promise<TrackInfo> {
    const resp = await fetch(this.config.icecastUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`Icecast HTTP ${resp.status}`);
    const data = await resp.json() as any;
    // Icecast status-json.xsl format — source can be array or single object
    const source = Array.isArray(data?.icestats?.source)
      ? data.icestats.source[0]
      : data?.icestats?.source;

    if (!source) return { artist: '', title: '', full: '' };

    // Icecast provides artist and title as separate fields
    const artist = source.artist || '';
    const title = source.title || '';

    if (artist && title) {
      return { artist, title, full: `${artist} - ${title}` };
    }

    // Some Icecast sources put everything in title as "Artist - Song Title"
    if (title && !artist) {
      return this.parseTrackString(title);
    }

    // Fallback
    return { artist: '', title: title || source.server_name || '', full: title || '' };
  }

  /**
   * Parse a string like "Artist - Title" into separate parts
   */
  private parseTrackString(text: string): TrackInfo {
    if (!text) return { artist: '', title: '', full: '' };

    // Try splitting on " - " (most common format)
    const dashIdx = text.indexOf(' - ');
    if (dashIdx > 0) {
      return {
        artist: text.substring(0, dashIdx).trim(),
        title: text.substring(dashIdx + 3).trim(),
        full: text,
      };
    }

    // No separator found — treat whole string as title
    return { artist: '', title: text, full: text };
  }

  async testNowPlaying(): Promise<{ success: boolean; raw: any; track: string; artist: string; title: string; error?: string }> {
    try {
      let raw: any = null;
      let info: TrackInfo = { artist: '', title: '', full: '' };

      if (this.config.mode === 'azuracast' && this.config.azuracastUrl) {
        const url = `${this.config.azuracastUrl}/api/nowplaying/${this.config.azuracastStation}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        raw = await resp.json();
        const np = raw?.now_playing?.song;
        if (np) {
          info = {
            artist: np.artist || '',
            title: np.title || '',
            full: np.artist && np.title ? `${np.artist} - ${np.title}` : '',
          };
        }
      } else if (this.config.mode === 'icecast' && this.config.icecastUrl) {
        const resp = await fetch(this.config.icecastUrl, { signal: AbortSignal.timeout(5000) });
        raw = await resp.json();
        const source = Array.isArray(raw?.icestats?.source)
          ? raw.icestats.source[0]
          : raw?.icestats?.source;
        if (source) {
          const artist = source.artist || '';
          const title = source.title || '';
          if (artist && title) {
            info = { artist, title, full: `${artist} - ${title}` };
          } else if (title) {
            info = this.parseTrackString(title);
          }
        }
      }

      return { success: true, raw, track: info.full, artist: info.artist, title: info.title };
    } catch (err: any) {
      return { success: false, raw: null, track: '', artist: '', title: '', error: err.message };
    }
  }
}
