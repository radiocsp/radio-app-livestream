import { ChildProcess, spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/schema';
import { NowPlayingService } from './now-playing';

interface StationProcess {
  ffmpeg: ChildProcess | null;
  feeder: ChildProcess | null;  // Video feeder process (bash loop)
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
      feeder: null,
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
    if (proc) {
      proc.status = 'stopped';
      // Kill feeder first
      if (proc.feeder && !proc.feeder.killed) {
        proc.feeder.kill('SIGTERM');
        setTimeout(() => {
          if (proc.feeder && !proc.feeder.killed) proc.feeder.kill('SIGKILL');
        }, 3000);
      }
      // Kill FFmpeg
      if (proc.ffmpeg && !proc.ffmpeg.killed) {
        proc.ffmpeg.kill('SIGTERM');
        setTimeout(() => {
          if (proc.ffmpeg && !proc.ffmpeg.killed) proc.ffmpeg.kill('SIGKILL');
        }, 5000);
      }
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
      'SELECT filename, duration_sec FROM playlist_items WHERE station_id = ? AND is_enabled = 1 ORDER BY sort_order ASC'
    ).all(stationId) as any[];

    const stationDir = path.join(this.dataDir, 'stations', slug!);
    fs.mkdirSync(stationDir, { recursive: true });

    const uploadsDir = path.join(__dirname, '..', '..', 'uploads', stationId);

    // Calculate how many repeats needed for 24h of content
    const totalDurationSec = items.reduce((sum: number, i: any) => sum + (i.duration_sec || 300), 0);
    const hoursTarget = 24;
    const repeats = Math.max(2, Math.ceil((hoursTarget * 3600) / totalDurationSec));

    // Write file list (one file path per line, used by feeder script)
    const fileList = items.map(i => path.join(uploadsDir, i.filename));
    const fileListPath = path.join(stationDir, 'filelist.txt');
    const tempPath = fileListPath + '.tmp';
    fs.writeFileSync(tempPath, fileList.join('\n') + '\n');
    fs.renameSync(tempPath, fileListPath);

    // Also write repeats count
    const repeatsPath = path.join(stationDir, 'repeats.txt');
    fs.writeFileSync(repeatsPath, String(repeats));

    // Still write concat playlist for preview generation
    const lines = items.map(i => `file '${path.join(uploadsDir, i.filename)}'`);
    const playlistPath = path.join(stationDir, 'playlist.txt');
    const pTmp = playlistPath + '.tmp';
    fs.writeFileSync(pTmp, lines.join('\n') + '\n');
    fs.renameSync(pTmp, playlistPath);

    this.emit('log', stationId, 'info', 'app', `Playlist updated: ${items.length} items × ${repeats} repeats (${Math.round(totalDurationSec * repeats / 3600)}h)`);
  }

  private startNowPlaying(stationId: string, station: any): void {
    const existingNp = this.nowPlayingServices.get(stationId);
    if (existingNp) existingNp.stop();

    const stationDir = path.join(this.dataDir, 'stations', station.slug);
    const textFile = path.join(stationDir, 'nowplaying.txt');
    const artistFile = path.join(stationDir, 'artist.txt');
    const titleFile = path.join(stationDir, 'songtitle.txt');

    // Initialize with empty text
    fs.writeFileSync(textFile, 'Starting...');
    fs.writeFileSync(artistFile, ' ');
    fs.writeFileSync(titleFile, 'Starting...');

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

    const fileListPath = path.join(stationDir, 'filelist.txt');
    const repeatsPath = path.join(stationDir, 'repeats.txt');
    const textFilePath = path.join(stationDir, 'nowplaying.txt');
    const artistFilePath = path.join(stationDir, 'artist.txt');
    const titleFilePath = path.join(stationDir, 'songtitle.txt');

    if (!fs.existsSync(fileListPath)) {
      this.emit('log', stationId, 'error', 'app', 'File list not found');
      this.setProcessStatus(stationId, 'error', 'No playlist');
      return;
    }

    const repeats = parseInt(fs.readFileSync(repeatsPath, 'utf-8').trim()) || 5;

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

      const escPath = (p: string) => p.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\\\:').replace(/'/g, "'\\\\''");
      const escapedArtistPath = escPath(artistFilePath);
      const escapedTitlePath = escPath(titleFilePath);

      // Base font spec (used for song title line)
      let titleFontSpec = `fontsize=${station.overlay_font_size}:fontcolor=${station.overlay_font_color}`;
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

      // Artist font spec (slightly smaller or uses title font size setting, different color)
      const artistFontSize = station.overlay_title_font_size || Math.round(station.overlay_font_size * 0.85);
      const artistFontColor = station.overlay_title_font_color || 'yellow';
      let artistFontSpec = `fontsize=${artistFontSize}:fontcolor=${artistFontColor}`;
      if (station.overlay_font_family) {
        artistFontSpec += `:font='${station.overlay_font_family}'`;
      }
      if (station.overlay_font_file) {
        artistFontSpec += `:fontfile='${station.overlay_font_file}'`;
      }
      artistFontSpec += `:shadowx=${station.overlay_shadow_x}:shadowy=${station.overlay_shadow_y}`;
      artistFontSpec += `:borderw=${station.overlay_outline_width}`;
      if (station.overlay_bg_color) {
        artistFontSpec += `:box=1:boxcolor=${station.overlay_bg_color}:boxborderw=8`;
      }

      const isBottom = !station.overlay_position?.startsWith('top');
      const lineGap = station.overlay_font_size + 8;
      const artistLineGap = artistFontSize + 8;

      if (isBottom) {
        const basePos = posMap[station.overlay_position] || posMap['bottom-left'];
        overlayParts.push(
          `drawtext=textfile='${escapedTitlePath}':reload=1:${basePos}:${titleFontSpec}`
        );
        const artistPosMap: Record<string, string> = {
          'bottom-left': `x=${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${lineGap}`,
          'bottom-center': `x=(w-tw)/2:y=h-th-${station.overlay_margin_y}-${lineGap}`,
          'bottom-right': `x=w-tw-${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${lineGap}`,
        };
        const artistPos = artistPosMap[station.overlay_position] || artistPosMap['bottom-left'];
        overlayParts.push(
          `drawtext=textfile='${escapedArtistPath}':reload=1:${artistPos}:${artistFontSpec}`
        );
        if (station.overlay_title) {
          const labelGap = lineGap + artistLineGap;
          const labelPosMap: Record<string, string> = {
            'bottom-left': `x=${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${labelGap}`,
            'bottom-center': `x=(w-tw)/2:y=h-th-${station.overlay_margin_y}-${labelGap}`,
            'bottom-right': `x=w-tw-${station.overlay_margin_x}:y=h-th-${station.overlay_margin_y}-${labelGap}`,
          };
          const labelPos = labelPosMap[station.overlay_position] || labelPosMap['bottom-left'];
          const escapedLabel = station.overlay_title.replace(/:/g, '\\:').replace(/'/g, "'\\''");
          overlayParts.push(
            `drawtext=text='${escapedLabel}':${labelPos}:${artistFontSpec}`
          );
        }
      } else {
        let yOffset = station.overlay_margin_y;
        if (station.overlay_title) {
          const labelPosMap: Record<string, string> = {
            'top-left': `x=${station.overlay_margin_x}:y=${yOffset}`,
            'top-center': `x=(w-tw)/2:y=${yOffset}`,
            'top-right': `x=w-tw-${station.overlay_margin_x}:y=${yOffset}`,
          };
          const labelPos = labelPosMap[station.overlay_position] || labelPosMap['top-left'];
          const escapedLabel = station.overlay_title.replace(/:/g, '\\:').replace(/'/g, "'\\''");
          overlayParts.push(
            `drawtext=text='${escapedLabel}':${labelPos}:${artistFontSpec}`
          );
          yOffset += artistLineGap;
        }
        const artistPosMap: Record<string, string> = {
          'top-left': `x=${station.overlay_margin_x}:y=${yOffset}`,
          'top-center': `x=(w-tw)/2:y=${yOffset}`,
          'top-right': `x=w-tw-${station.overlay_margin_x}:y=${yOffset}`,
        };
        const artistPos = artistPosMap[station.overlay_position] || artistPosMap['top-left'];
        overlayParts.push(
          `drawtext=textfile='${escapedArtistPath}':reload=1:${artistPos}:${artistFontSpec}`
        );
        yOffset += artistLineGap;
        const titlePosMap: Record<string, string> = {
          'top-left': `x=${station.overlay_margin_x}:y=${yOffset}`,
          'top-center': `x=(w-tw)/2:y=${yOffset}`,
          'top-right': `x=w-tw-${station.overlay_margin_x}:y=${yOffset}`,
        };
        const titlePos = titlePosMap[station.overlay_position] || titlePosMap['top-left'];
        overlayParts.push(
          `drawtext=textfile='${escapedTitlePath}':reload=1:${titlePos}:${titleFontSpec}`
        );
      }
    }

    // ─── VIDEO FEEDER APPROACH ─────────────────────────────
    // Instead of using concat demuxer (which CANNOT handle codec transitions like HEVC→H.264),
    // we use a bash feeder script that decodes each video individually and pipes normalized
    // MPEGTS (all H.264, same resolution/fps) to the main FFmpeg encoder via stdin.
    // This completely eliminates codec mismatch errors at file transitions.

    const feederScriptPath = path.join(stationDir, 'feeder.sh');
    const feederScript = `#!/bin/sh
# Video feeder: decodes each video individually, outputs uniform MPEGTS to stdout
# This avoids concat demuxer codec mismatch issues (HEVC↔H.264 transitions)
# IMPORTANT: stderr goes to fd2 (captured by Node), stdout is the video pipe
FILELIST="${fileListPath}"
REPEATS=${repeats}
WIDTH=${station.video_width}
HEIGHT=${station.video_height}
FPS=${station.video_fps}

for rep in $(seq 1 $REPEATS); do
  while IFS= read -r videofile || [ -n "$videofile" ]; do
    [ -z "$videofile" ] && continue
    [ ! -f "$videofile" ] && continue
    echo "FEEDER: Playing $videofile (repeat $rep)" >&2
    # Decode any codec → re-encode to H.264 MPEGTS, normalized resolution/fps
    # -re flag ensures real-time playback speed
    # stdout = video pipe, stderr = logs (kept separate!)
    ffmpeg -hide_banner -loglevel warning \\
      -re -i "$videofile" \\
      -vf "fps=$FPS,scale=\${WIDTH}:\${HEIGHT}:force_original_aspect_ratio=decrease,pad=\${WIDTH}:\${HEIGHT}:(ow-iw)/2:(oh-ih)/2" \\
      -c:v libx264 -preset veryfast -tune zerolatency \\
      -b:v 4500k -maxrate 4500k -bufsize 9000k \\
      -pix_fmt yuv420p -an \\
      -f mpegts \\
      -muxdelay 0 -muxpreload 0 \\
      pipe:1
  done < "$FILELIST"
done
echo "FEEDER: All repeats finished" >&2
`;
    fs.writeFileSync(feederScriptPath, feederScript, { mode: 0o755 });

    // Build overlay filter for the main encoder (applied to the uniform MPEGTS input)
    const mainOverlayFilter = overlayParts.length > 0 ? overlayParts.join(',') : '';

    // Main FFmpeg reads from feeder pipe (stdin) + audio source, applies overlay, outputs to RTMP
    // If overlay is enabled: decode MPEGTS → apply overlay → encode → RTMP (needs re-encode)
    // If no overlay: copy video stream directly → RTMP (zero video CPU)
    const hasOverlay = mainOverlayFilter.length > 0;

    const args: string[] = [
      '-fflags', '+genpts+discardcorrupt',
      '-f', 'mpegts',                              // Input from feeder pipe (uniform H.264 MPEGTS)
      '-i', 'pipe:0',                              // Read video from stdin
      '-thread_queue_size', '4096',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', audioSource.url,                        // Audio source (Icecast/AzuraCast)
      '-map', '0:v', '-map', '1:a',
    ];

    if (hasOverlay) {
      // With overlay: need to decode, apply filter, re-encode
      args.push(
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
        '-b:v', station.video_bitrate,
        '-maxrate', station.video_bitrate,
        '-bufsize', `${parseInt(station.video_bitrate) * 2}k`,
        '-r', String(station.video_fps),
        '-g', String(station.video_fps * 2),
        '-keyint_min', String(station.video_fps),
        '-pix_fmt', 'yuv420p',
        '-vf', mainOverlayFilter,
      );
    } else {
      // No overlay: copy the already-encoded H.264 from feeder (zero CPU)
      args.push(
        '-c:v', 'copy',
      );
    }

    args.push(
      '-max_muxing_queue_size', '4096',
      '-c:a', 'aac', '-b:a', station.audio_bitrate, '-ar', '44100',
      '-strict', 'experimental',
      '-flags', '+global_header',
    );

    // Output: single destination = simple FLV, multiple = tee muxer
    if (destinations.length === 1) {
      const dest = destinations[0];
      const url = (dest.stream_key ? `${dest.rtmp_url.trim()}/${dest.stream_key.trim()}` : dest.rtmp_url.trim());
      args.push('-f', 'flv', '-flvflags', 'no_duration_filesize', url);
    } else {
      const teeOutputs = destinations.map(d => {
        const url = (d.stream_key ? `${d.rtmp_url.trim()}/${d.stream_key.trim()}` : d.rtmp_url.trim());
        return `[f=flv:flvflags=no_duration_filesize]${url}`;
      });
      args.push('-f', 'tee', teeOutputs.join('|'));
    }

    this.emit('log', stationId, 'info', 'app', `Launching FFmpeg (pipe-feeder mode) with ${destinations.length} destination(s)`);
    console.log(`[FFMPEG] Launching pipe-feeder for station=${stationId}`);
    this.setProcessStatus(stationId, 'starting', '');

    // 1) Start the feeder script (decodes videos → MPEGTS pipe)
    const feeder = spawn('sh', [feederScriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 2) Start the main FFmpeg encoder (reads MPEGTS from stdin → RTMP)
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: [feeder.stdout!, 'pipe', 'pipe'],  // stdin = feeder stdout
    });

    const proc: StationProcess = {
      ffmpeg,
      feeder,
      status: 'running',
      restartCount: this.processes.get(stationId)?.restartCount || 0,
      lastError: '',
      startedAt: new Date(),
      pid: ffmpeg.pid || null,
    };
    this.processes.set(stationId, proc);
    this.updateDbStatus(stationId, 'running');
    this.emit('status', stationId, 'running');
    console.log(`[FFMPEG] Started: feeder PID=${feeder.pid}, encoder PID=${ffmpeg.pid} for station=${stationId}`);

    // Feeder stderr (per-video decode warnings/errors)
    feeder.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        const isError = /error|failed|invalid|corrupt|broken|fault/i.test(line);
        if (isError) {
          console.error(`[FEEDER-STDERR] station=${stationId}: ${line}`);
          this.emit('log', stationId, 'warn', 'feeder', line);
        }
        // Don't log non-error feeder lines (too verbose)
      }
    });

    // Main FFmpeg stderr
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        const isProgress = /^(frame|size|bitrate|speed|fps)\s*=/.test(line) || /^\s*(frame|size)=/.test(line);
        if (!isProgress) {
          const isError = /error|failed|invalid|corrupt|broken|fault/i.test(line);
          if (isError) {
            console.error(`[FFMPEG-STDERR] station=${stationId}: ${line}`);
            this.emit('log', stationId, 'error', 'ffmpeg', line);
          } else {
            this.emit('log', stationId, 'debug', 'ffmpeg', line);
          }
        } else {
          this.emit('log', stationId, 'debug', 'ffmpeg', line);
        }
      }
    });

    ffmpeg.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.emit('log', stationId, 'info', 'ffmpeg', line);
      }
    });

    // When feeder exits (all videos played), log it
    feeder.on('close', (code) => {
      console.log(`[FEEDER] Exited with code ${code} for station=${stationId}`);
      this.emit('log', stationId, 'info', 'app', `Video feeder finished (code ${code})`);
    });

    // When main FFmpeg exits, handle restart
    ffmpeg.on('close', (code) => {
      // Kill feeder if still running
      if (feeder && !feeder.killed) {
        feeder.kill('SIGTERM');
      }
      console.log(`[FFMPEG] Exited with code ${code} for station=${stationId}, restartCount=${proc.restartCount}`);
      this.emit('log', stationId, 'info', 'app', `FFmpeg exited with code ${code}`);
      if (proc.status !== 'stopped') {
        proc.status = 'error';
        proc.lastError = `FFmpeg exited with code ${code}`;
        this.emit('status', stationId, 'error');

        // Auto-restart logic
        if (station.auto_restart && proc.restartCount < station.max_restart_attempts) {
          const delay = Math.min(station.restart_delay_sec * 1000 * Math.pow(1.5, proc.restartCount), 60000);
          proc.restartCount++;
          console.log(`[FFMPEG] Auto-restart attempt ${proc.restartCount}/${station.max_restart_attempts} in ${Math.round(delay / 1000)}s for station=${stationId}`);
          this.emit('log', stationId, 'info', 'app', `Auto-restart attempt ${proc.restartCount} in ${Math.round(delay / 1000)}s`);

          const timer = setTimeout(() => {
            this.launchFFmpeg(stationId, station, stationDir);
          }, delay);
          this.restartTimers.set(stationId, timer);
        }
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[FFMPEG] Process error for station=${stationId}: ${err.message}`);
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
    const artistFilePath = path.join(stationDir, 'artist.txt');
    const titleFilePath = path.join(stationDir, 'songtitle.txt');
    const previewPath = path.join(stationDir, 'preview.jpg');

    if (!fs.existsSync(playlistPath)) return null;

    // Build filter for preview
    let vf = `scale=${station.video_width}:${station.video_height}`;

    // Only add drawtext if overlay is enabled AND drawtext filter is available
    const hasDrawtext = await this.checkDrawtextSupport();
    if (station.overlay_enabled && hasDrawtext) {
      const escPath = (p: string) => p.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\\\:').replace(/'/g, "'\\\\''");

      // Song title font spec
      let titleFS = `fontsize=${station.overlay_font_size}:fontcolor=${station.overlay_font_color}`;
      if (station.overlay_font_family) titleFS += `:font='${station.overlay_font_family}'`;
      if (station.overlay_font_file) titleFS += `:fontfile='${station.overlay_font_file}'`;
      titleFS += `:shadowx=${station.overlay_shadow_x}:shadowy=${station.overlay_shadow_y}`;
      titleFS += `:borderw=${station.overlay_outline_width}`;
      if (station.overlay_bg_color) titleFS += `:box=1:boxcolor=${station.overlay_bg_color}:boxborderw=8`;

      // Artist font spec
      const artistFontSize = station.overlay_title_font_size || Math.round(station.overlay_font_size * 0.85);
      const artistFontColor = station.overlay_title_font_color || 'yellow';
      let artistFS = `fontsize=${artistFontSize}:fontcolor=${artistFontColor}`;
      if (station.overlay_font_family) artistFS += `:font='${station.overlay_font_family}'`;
      if (station.overlay_font_file) artistFS += `:fontfile='${station.overlay_font_file}'`;
      artistFS += `:shadowx=${station.overlay_shadow_x}:shadowy=${station.overlay_shadow_y}`;
      artistFS += `:borderw=${station.overlay_outline_width}`;
      if (station.overlay_bg_color) artistFS += `:box=1:boxcolor=${station.overlay_bg_color}:boxborderw=8`;

      const mx = station.overlay_margin_x;
      const my = station.overlay_margin_y;
      const lineGap = station.overlay_font_size + 8;
      const artistLineGap = artistFontSize + 8;
      const isBottom = !station.overlay_position?.startsWith('top');

      // For preview, write sample text to files if they don't exist
      if (!fs.existsSync(artistFilePath)) fs.writeFileSync(artistFilePath, 'Sample Artist');
      if (!fs.existsSync(titleFilePath)) fs.writeFileSync(titleFilePath, 'Sample Song Title');

      if (isBottom) {
        const posX = station.overlay_position === 'bottom-center' ? '(w-tw)/2' : station.overlay_position === 'bottom-right' ? `w-tw-${mx}` : `${mx}`;
        vf += `,drawtext=textfile='${escPath(titleFilePath)}':reload=1:x=${posX}:y=h-th-${my}:${titleFS}`;
        vf += `,drawtext=textfile='${escPath(artistFilePath)}':reload=1:x=${posX}:y=h-th-${my}-${lineGap}:${artistFS}`;
        if (station.overlay_title) {
          const escapedLabel = station.overlay_title.replace(/:/g, '\\:').replace(/'/g, "'\\''");
          vf += `,drawtext=text='${escapedLabel}':x=${posX}:y=h-th-${my}-${lineGap + artistLineGap}:${artistFS}`;
        }
      } else {
        let yOff = my;
        const posX = station.overlay_position === 'top-center' ? '(w-tw)/2' : station.overlay_position === 'top-right' ? `w-tw-${mx}` : `${mx}`;
        if (station.overlay_title) {
          const escapedLabel = station.overlay_title.replace(/:/g, '\\:').replace(/'/g, "'\\''");
          vf += `,drawtext=text='${escapedLabel}':x=${posX}:y=${yOff}:${artistFS}`;
          yOff += artistLineGap;
        }
        vf += `,drawtext=textfile='${escPath(artistFilePath)}':reload=1:x=${posX}:y=${yOff}:${artistFS}`;
        yOff += artistLineGap;
        vf += `,drawtext=textfile='${escPath(titleFilePath)}':reload=1:x=${posX}:y=${yOff}:${titleFS}`;
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
      ffmpeg: null, feeder: null, status, restartCount: 0, lastError: error, startedAt: null, pid: null,
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
