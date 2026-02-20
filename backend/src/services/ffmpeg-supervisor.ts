import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/schema';
import { NowPlayingService } from './now-playing';

interface StationProcess {
  ffmpeg: ChildProcess | null;
  status: 'stopped' | 'starting' | 'running' | 'restarting' | 'error';
  restartCount: number;
  lastError: string;
  startedAt: Date | null;
  pid: number | null;
}

export class FFmpegSupervisor extends EventEmitter {
  private processes: Map<string, StationProcess> = new Map();
  private nowPlayingServices: Map<string, NowPlayingService> = new Map();
  private restartTimers: Map<string, NodeJS.Timeout> = new Map();
  private dataDir: string;

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
  }

  getStationStatus(stationId: string): StationProcess {
    return this.processes.get(stationId) || {
      ffmpeg: null,
      status: 'stopped',
      restartCount: 0,
      lastError: '',
      startedAt: null,
      pid: null,
    };
  }

  getAllStatuses(): Record<string, { status: string; pid: number | null; restartCount: number; uptime: number | null }> {
    const result: Record<string, any> = {};
    for (const [id, proc] of this.processes) {
      result[id] = {
        status: proc.status,
        pid: proc.pid,
        restartCount: proc.restartCount,
        uptime: proc.startedAt ? Math.floor((Date.now() - proc.startedAt.getTime()) / 1000) : null,
      };
    }
    return result;
  }

  async startStation(stationId: string): Promise<void> {
    const existing = this.processes.get(stationId);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return;
    }

    const db = getDb();
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId) as any;
    if (!station) throw new Error(`Station ${stationId} not found`);

    const stationDir = path.join(this.dataDir, 'stations', station.slug);
    fs.mkdirSync(stationDir, { recursive: true });

    // Build concat playlist file
    this.writeConcatPlaylist(stationId, station.slug);

    // Start now playing poller
    this.startNowPlaying(stationId, station);

    // Build and launch FFmpeg
    this.launchFFmpeg(stationId, station, stationDir);
  }

  async stopStation(stationId: string): Promise<void> {
    const proc = this.processes.get(stationId);
    if (proc?.ffmpeg) {
      proc.status = 'stopped';
      proc.ffmpeg.kill('SIGTERM');
      setTimeout(() => {
        if (proc.ffmpeg && !proc.ffmpeg.killed) {
          proc.ffmpeg.kill('SIGKILL');
        }
      }, 5000);
    }

    // Stop now playing
    const np = this.nowPlayingServices.get(stationId);
    if (np) {
      np.stop();
      this.nowPlayingServices.delete(stationId);
    }

    // Clear restart timer
    const timer = this.restartTimers.get(stationId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(stationId);
    }

    this.updateDbStatus(stationId, 'stopped');
    this.emit('status', stationId, 'stopped');
  }

  async restartStation(stationId: string): Promise<void> {
    this.emit('status', stationId, 'restarting');
    this.emit('log', stationId, 'info', 'app', 'Restarting station...');
    await this.stopStation(stationId);
    // Small delay to let FFmpeg die
    await new Promise(r => setTimeout(r, 1500));
    const proc = this.processes.get(stationId);
    if (proc) proc.restartCount = 0;
    await this.startStation(stationId);
  }

  writeConcatPlaylist(stationId: string, slug?: string): void {
    const db = getDb();
    if (!slug) {
      const station = db.prepare('SELECT slug FROM stations WHERE id = ?').get(stationId) as any;
      slug = station?.slug || stationId;
    }

    const items = db.prepare(
      'SELECT filename FROM playlist_items WHERE station_id = ? AND is_enabled = 1 ORDER BY sort_order ASC'
    ).all(stationId) as any[];

    const stationDir = path.join(this.dataDir, 'stations', slug!);
    fs.mkdirSync(stationDir, { recursive: true });

    const uploadsDir = path.join(__dirname, '..', '..', 'uploads', stationId);
    const lines = items.map(i => `file '${path.join(uploadsDir, i.filename)}'`);

    // Repeat the entire playlist many times for 24/7 looping
    // FFmpeg concat demuxer plays sequentially; -stream_loop doesn't work reliably with concat
    // 500 repeats × average 5min video = ~41 hours; FFmpeg auto-restarts after that
    const repeatedLines: string[] = [];
    for (let i = 0; i < 500; i++) {
      repeatedLines.push(...lines);
    }

    // Write atomically: write to temp then rename
    const playlistPath = path.join(stationDir, 'playlist.txt');
    const tempPath = playlistPath + '.tmp';
    fs.writeFileSync(tempPath, repeatedLines.join('\n') + '\n');
    fs.renameSync(tempPath, playlistPath);

    this.emit('log', stationId, 'info', 'app', `Playlist updated: ${items.length} items`);
  }

  private startNowPlaying(stationId: string, station: any): void {
    const existingNp = this.nowPlayingServices.get(stationId);
    if (existingNp) existingNp.stop();

    const stationDir = path.join(this.dataDir, 'stations', station.slug);
    const textFile = path.join(stationDir, 'nowplaying.txt');

    // Initialize with empty text
    fs.writeFileSync(textFile, 'Starting...');

    const np = new NowPlayingService({
      mode: station.np_mode,
      azuracastUrl: station.np_azuracast_url,
      azuracastStation: station.np_azuracast_station,
      icecastUrl: station.np_icecast_url,
      pollInterval: station.np_poll_interval * 1000,
      textFilePath: textFile,
    });

    np.on('track', (track: string) => {
      this.emit('nowplaying', stationId, track);
    });

    np.on('error', (err: string) => {
      this.emit('log', stationId, 'warn', 'nowplaying', err);
    });

    np.start();
    this.nowPlayingServices.set(stationId, np);
  }

  private async launchFFmpeg(stationId: string, station: any, stationDir: string): Promise<void> {
    const db = getDb();

    // Get active audio source (highest priority enabled source)
    const audioSource = db.prepare(
      'SELECT url FROM audio_sources WHERE station_id = ? AND is_enabled = 1 ORDER BY priority ASC LIMIT 1'
    ).get(stationId) as any;

    // Get RTMP destinations
    const destinations = db.prepare(
      'SELECT rtmp_url, stream_key FROM rtmp_destinations WHERE station_id = ? AND is_enabled = 1'
    ).all(stationId) as any[];

    if (!audioSource) {
      this.emit('log', stationId, 'error', 'app', 'No enabled audio source found');
      this.setProcessStatus(stationId, 'error', 'No audio source');
      return;
    }

    if (destinations.length === 0) {
      this.emit('log', stationId, 'error', 'app', 'No enabled RTMP destinations found');
      this.setProcessStatus(stationId, 'error', 'No RTMP destinations');
      return;
    }

    const playlistPath = path.join(stationDir, 'playlist.txt');
    const textFilePath = path.join(stationDir, 'nowplaying.txt');

    if (!fs.existsSync(playlistPath)) {
      this.emit('log', stationId, 'error', 'app', 'Playlist file not found');
      this.setProcessStatus(stationId, 'error', 'No playlist');
      return;
    }

    // Build overlay drawtext filter (only if FFmpeg supports it)
    const overlayParts: string[] = [];
    const hasDrawtext = await this.checkDrawtextSupport();
    if (station.overlay_enabled && hasDrawtext) {
      const posMap: Record<string, string> = {
        'bottom-left': `x=${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}`,
        'bottom-center': `x=(w-tw)/2:y=h-th-${station.overlay_margin_y}`,
        'bottom-right': `x=w-tw-${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}`,
        'top-left': `x=${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
        'top-center': `x=(w-tw)/2:y=${station.overlay_margin_y}`,
        'top-right': `x=w-tw-${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
      };
      const pos = posMap[station.overlay_position] || posMap['bottom-left'];

      // Font specification for track text
      let fontSpec = `fontsize=${station.overlay_font_size}:fontcolor=${station.overlay_font_color}`;
      if (station.overlay_font_family) {
        fontSpec += `:font='${station.overlay_font_family}'`;
      }
      if (station.overlay_font_file) {
        fontSpec += `:fontfile='${station.overlay_font_file}'`;
      }
      fontSpec += `:shadowx=${station.overlay_shadow_x}:shadowy=${station.overlay_shadow_y}`;
      fontSpec += `:borderw=${station.overlay_outline_width}`;
      if (station.overlay_bg_color) {
        fontSpec += `:box=1:boxcolor=${station.overlay_bg_color}:boxborderw=8`;
      }

      const escapedPath = textFilePath.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\\\:').replace(/'/g, "'\\\\''");

      // If title label is set (e.g. "Ascultă acum:"), add it as a separate drawtext above the track
      if (station.overlay_title) {
        // Calculate title position: same as track but shifted up by track font size + gap
        const titleGap = station.overlay_font_size + 8;
        const titlePosMap: Record<string, string> = {
          'bottom-left': `x=${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${titleGap}`,
          'bottom-center': `x=(w-tw)/2:y=h-th-${station.overlay_margin_y}-${titleGap}`,
          'bottom-right': `x=w-tw-${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${titleGap}`,
          'top-left': `x=${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
          'top-center': `x=(w-tw)/2:y=${station.overlay_margin_y}`,
          'top-right': `x=w-tw-${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
        };
        const titlePos = titlePosMap[station.overlay_position] || titlePosMap['bottom-left'];

        let titleFontSpec = `fontsize=${station.overlay_title_font_size || 22}:fontcolor=${station.overlay_title_font_color || 'yellow'}`;
        if (station.overlay_font_family) {
          titleFontSpec += `:font='${station.overlay_font_family}'`;
        }
        if (station.overlay_font_file) {
          titleFontSpec += `:fontfile='${station.overlay_font_file}'`;
        }
        titleFontSpec += `:shadowx=${station.overlay_shadow_x}:shadowy=${station.overlay_shadow_y}`;
        titleFontSpec += `:borderw=${station.overlay_outline_width}`;
        if (station.overlay_bg_color) {
          titleFontSpec += `:box=1:boxcolor=${station.overlay_bg_color}:boxborderw=8`;
        }

        const escapedTitle = station.overlay_title.replace(/:/g, '\\:').replace(/'/g, "'\\''");
        overlayParts.push(
          `drawtext=text='${escapedTitle}':${titlePos}:${titleFontSpec}`
        );

        // For top positions, shift track text DOWN below the title
        if (station.overlay_position?.startsWith('top')) {
          const trackShift = (station.overlay_title_font_size || 22) + 8;
          const trackPosMap: Record<string, string> = {
            'top-left': `x=${station.overlay_margin_x}:y=${station.overlay_margin_y}+${trackShift}`,
            'top-center': `x=(w-tw)/2:y=${station.overlay_margin_y}+${trackShift}`,
            'top-right': `x=w-tw-${station.overlay_margin_x}:y=${station.overlay_margin_y}+${trackShift}`,
          };
          const trackPos = trackPosMap[station.overlay_position] || pos;
          overlayParts.push(
            `drawtext=textfile='${escapedPath}':reload=1:${trackPos}:${fontSpec}`
          );
        } else {
          overlayParts.push(
            `drawtext=textfile='${escapedPath}':reload=1:${pos}:${fontSpec}`
          );
        }
      } else {
        // No title — just the track text
        overlayParts.push(
          `drawtext=textfile='${escapedPath}':reload=1:${pos}:${fontSpec}`
        );
      }
    }

    const videoFilter = overlayParts.length > 0
      ? overlayParts.join(',')
      : 'null';

    // Build FFmpeg args
    const args: string[] = [
      '-re',
      '-f', 'concat', '-safe', '0', '-i', playlistPath,
      '-i', audioSource.url,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-b:v', station.video_bitrate,
      '-maxrate', station.video_bitrate,
      '-bufsize', `${parseInt(station.video_bitrate) * 2}k`,
      '-r', String(station.video_fps),
      '-g', String(station.video_fps * 2),       // Keyframe every 2 seconds (YouTube requirement)
      '-keyint_min', String(station.video_fps),   // Min keyframe interval
      '-pix_fmt', 'yuv420p',                      // Force pixel format (YouTube requirement)
      '-s', `${station.video_width}x${station.video_height}`,
      '-vf', videoFilter,
      '-c:a', 'aac', '-b:a', station.audio_bitrate, '-ar', '44100',
      '-strict', 'experimental',
      '-flags', '+global_header',                 // Required for FLV streaming
    ];

    // Output: single destination = simple FLV, multiple = tee muxer
    if (destinations.length === 1) {
      const dest = destinations[0];
      const url = (dest.stream_key ? `${dest.rtmp_url.trim()}/${dest.stream_key.trim()}` : dest.rtmp_url.trim());
      args.push('-f', 'flv', '-flvflags', 'no_duration_filesize', url);
    } else {
      // tee muxer: single video+audio stream copied to N destinations
      const teeOutputs = destinations.map(d => {
        const url = (d.stream_key ? `${d.rtmp_url.trim()}/${d.stream_key.trim()}` : d.rtmp_url.trim());
        return `[f=flv:flvflags=no_duration_filesize]${url}`;
      });
      args.push('-f', 'tee', teeOutputs.join('|'));
    }

    this.emit('log', stationId, 'info', 'app', `Launching FFmpeg with ${destinations.length} destination(s)`);
    this.setProcessStatus(stationId, 'starting', '');

    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const proc: StationProcess = {
      ffmpeg,
      status: 'running',
      restartCount: this.processes.get(stationId)?.restartCount || 0,
      lastError: '',
      startedAt: new Date(),
      pid: ffmpeg.pid || null,
    };
    this.processes.set(stationId, proc);
    this.updateDbStatus(stationId, 'running');
    this.emit('status', stationId, 'running');

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.emit('log', stationId, 'debug', 'ffmpeg', line);
      }
    });

    ffmpeg.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.emit('log', stationId, 'info', 'ffmpeg', line);
      }
    });

    ffmpeg.on('close', (code) => {
      this.emit('log', stationId, 'info', 'app', `FFmpeg exited with code ${code}`);
      if (proc.status !== 'stopped') {
        proc.status = 'error';
        proc.lastError = `FFmpeg exited with code ${code}`;
        this.emit('status', stationId, 'error');

        // Auto-restart logic
        if (station.auto_restart && proc.restartCount < station.max_restart_attempts) {
          const delay = Math.min(station.restart_delay_sec * 1000 * Math.pow(1.5, proc.restartCount), 60000);
          proc.restartCount++;
          this.emit('log', stationId, 'info', 'app', `Auto-restart attempt ${proc.restartCount} in ${Math.round(delay / 1000)}s`);

          const timer = setTimeout(() => {
            this.launchFFmpeg(stationId, station, stationDir);
          }, delay);
          this.restartTimers.set(stationId, timer);
        }
      }
    });

    ffmpeg.on('error', (err) => {
      proc.status = 'error';
      proc.lastError = err.message;
      this.emit('log', stationId, 'error', 'app', `FFmpeg error: ${err.message}`);
      this.emit('status', stationId, 'error');
    });
  }

  async generatePreview(stationId: string): Promise<string | null> {
    const db = getDb();
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId) as any;
    if (!station) return null;

    const stationDir = path.join(this.dataDir, 'stations', station.slug);
    const playlistPath = path.join(stationDir, 'playlist.txt');
    const textFilePath = path.join(stationDir, 'nowplaying.txt');
    const previewPath = path.join(stationDir, 'preview.jpg');

    if (!fs.existsSync(playlistPath)) return null;

    // Build filter for preview
    let vf = `scale=${station.video_width}:${station.video_height}`;

    // Only add drawtext if overlay is enabled AND drawtext filter is available
    const hasDrawtext = await this.checkDrawtextSupport();
    if (station.overlay_enabled && fs.existsSync(textFilePath) && hasDrawtext) {
      const posMap: Record<string, string> = {
        'bottom-left': `x=${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}`,
        'bottom-center': `x=(w-tw)/2:y=h-th-${station.overlay_margin_y}`,
        'bottom-right': `x=w-tw-${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}`,
        'top-left': `x=${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
        'top-center': `x=(w-tw)/2:y=${station.overlay_margin_y}`,
        'top-right': `x=w-tw-${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
      };
      const pos = posMap[station.overlay_position] || posMap['bottom-left'];
      let fontSpec = `fontsize=${station.overlay_font_size}:fontcolor=${station.overlay_font_color}`;
      if (station.overlay_font_family) {
        fontSpec += `:font='${station.overlay_font_family}'`;
      }
      if (station.overlay_font_file) {
        fontSpec += `:fontfile='${station.overlay_font_file}'`;
      }
      fontSpec += `:shadowx=${station.overlay_shadow_x}:shadowy=${station.overlay_shadow_y}`;
      fontSpec += `:borderw=${station.overlay_outline_width}`;
      if (station.overlay_bg_color) {
        fontSpec += `:box=1:boxcolor=${station.overlay_bg_color}:boxborderw=8`;
      }
      const escapedTextFile = textFilePath.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\\\:').replace(/'/g, "'\\\\''");

      // Add title label if set
      if (station.overlay_title) {
        const titleGap = station.overlay_font_size + 8;
        const titlePosMap: Record<string, string> = {
          'bottom-left': `x=${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${titleGap}`,
          'bottom-center': `x=(w-tw)/2:y=h-th-${station.overlay_margin_y}-${titleGap}`,
          'bottom-right': `x=w-tw-${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${titleGap}`,
          'top-left': `x=${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
          'top-center': `x=(w-tw)/2:y=${station.overlay_margin_y}`,
          'top-right': `x=w-tw-${station.overlay_margin_x}:y=${station.overlay_margin_y}`,
        };
        const titlePos = titlePosMap[station.overlay_position] || titlePosMap['bottom-left'];
        let titleFontSpec = `fontsize=${station.overlay_title_font_size || 22}:fontcolor=${station.overlay_title_font_color || 'yellow'}`;
        if (station.overlay_font_family) titleFontSpec += `:font='${station.overlay_font_family}'`;
        if (station.overlay_font_file) titleFontSpec += `:fontfile='${station.overlay_font_file}'`;
        titleFontSpec += `:shadowx=${station.overlay_shadow_x}:shadowy=${station.overlay_shadow_y}`;
        titleFontSpec += `:borderw=${station.overlay_outline_width}`;
        if (station.overlay_bg_color) titleFontSpec += `:box=1:boxcolor=${station.overlay_bg_color}:boxborderw=8`;

        const escapedTitle = station.overlay_title.replace(/:/g, '\\:').replace(/'/g, "'\\''");
        vf += `,drawtext=text='${escapedTitle}':${titlePos}:${titleFontSpec}`;

        // Shift track text for top positions
        if (station.overlay_position?.startsWith('top')) {
          const trackShift = (station.overlay_title_font_size || 22) + 8;
          const shiftedPos = pos.replace(
            `y=${station.overlay_margin_y}`,
            `y=${station.overlay_margin_y}+${trackShift}`
          );
          vf += `,drawtext=textfile='${escapedTextFile}':reload=1:${shiftedPos}:${fontSpec}`;
        } else {
          vf += `,drawtext=textfile='${escapedTextFile}':reload=1:${pos}:${fontSpec}`;
        }
      } else {
        vf += `,drawtext=textfile='${escapedTextFile}':reload=1:${pos}:${fontSpec}`;
      }
    }

    return new Promise((resolve) => {
      const args = [
        '-y', '-f', 'concat', '-safe', '0', '-i', playlistPath,
        '-vf', vf,
        '-frames:v', '1',
        '-update', '1',
        '-q:v', '2',
        previewPath,
      ];

      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrData = '';
      proc.stderr?.on('data', (chunk: Buffer) => { stderrData += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(previewPath)) {
          resolve(previewPath);
        } else {
          console.error(`[Preview] ffmpeg exited with code ${code} for station ${stationId}`);
          if (stderrData) console.error(`[Preview] stderr: ${stderrData.slice(-500)}`);
          resolve(null);
        }
      });
      proc.on('error', (err) => {
        console.error(`[Preview] spawn error: ${err.message}`);
        resolve(null);
      });
    });
  }

  private _drawtextSupported: boolean | null = null;
  private async checkDrawtextSupport(): Promise<boolean> {
    if (this._drawtextSupported !== null) return this._drawtextSupported;
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-filters'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      proc.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      proc.on('close', () => {
        this._drawtextSupported = output.includes('drawtext');
        if (!this._drawtextSupported) {
          console.warn('[FFmpeg] drawtext filter not available — overlay will be skipped in preview. Install ffmpeg with --enable-libfreetype for overlay support.');
        }
        resolve(this._drawtextSupported);
      });
      proc.on('error', () => {
        this._drawtextSupported = false;
        resolve(false);
      });
    });
  }

  private setProcessStatus(stationId: string, status: StationProcess['status'], error: string) {
    const proc = this.processes.get(stationId) || {
      ffmpeg: null, status, restartCount: 0, lastError: error, startedAt: null, pid: null,
    };
    proc.status = status;
    proc.lastError = error;
    this.processes.set(stationId, proc);
    this.updateDbStatus(stationId, status);
    this.emit('status', stationId, status);
  }

  private updateDbStatus(stationId: string, status: string) {
    const db = getDb();
    db.prepare("UPDATE stations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, stationId);
  }
}
