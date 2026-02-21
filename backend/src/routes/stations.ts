import { FastifyInstance } from 'fastify';
import { getDb } from '../db/schema';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { FFmpegSupervisor } from '../services/ffmpeg-supervisor';
import { checkAudioSource, testRtmpDestination, runAudioHealthChecks } from '../services/health-check';
import { NowPlayingService } from '../services/now-playing';
import { sendTelegramTest } from '../services/telegram';

export function registerStationRoutes(app: FastifyInstance, supervisor: FFmpegSupervisor) {
  const db = getDb();

  // ─── STATIONS CRUD ───────────────────────────────────────

  // List all stations
  app.get('/api/stations', async () => {
    const stations = db.prepare('SELECT * FROM stations ORDER BY created_at DESC').all();
    const statuses = supervisor.getAllStatuses();
    return (stations as any[]).map(s => ({
      ...s,
      runtime: statuses[s.id] || { status: s.status, pid: null, restartCount: 0, uptime: null },
    }));
  });

  // Get single station (with sources, playlist, destinations)
  app.get<{ Params: { id: string } }>('/api/stations/:id', async (req) => {
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);
    if (!station) return { error: 'Station not found' };
    const sources = db.prepare('SELECT * FROM audio_sources WHERE station_id = ? ORDER BY priority ASC').all(req.params.id);
    const playlist = db.prepare('SELECT * FROM playlist_items WHERE station_id = ? ORDER BY sort_order ASC').all(req.params.id);
    const destinations = db.prepare('SELECT * FROM rtmp_destinations WHERE station_id = ? ORDER BY created_at ASC').all(req.params.id);
    const status = supervisor.getStationStatus(req.params.id);
    return { station, sources, playlist, destinations, runtime: status };
  });

  // Create station
  app.post<{ Body: { name: string; slug: string } }>('/api/stations', async (req) => {
    const id = uuid();
    const { name, slug } = req.body;
    db.prepare('INSERT INTO stations (id, name, slug) VALUES (?, ?, ?)').run(id, name, slug);
    // Create uploads dir
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads', id);
    fs.mkdirSync(uploadsDir, { recursive: true });
    return db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
  });

  // Update station settings
  app.put<{ Params: { id: string }; Body: Record<string, any> }>('/api/stations/:id', async (req) => {
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id) as any;
    if (!station) return { error: 'Station not found' };

      const allowed = [
        'name', 'slug', 'overlay_enabled', 'overlay_font_size', 'overlay_font_color',
        'overlay_font_family', 'overlay_bg_color', 'overlay_position', 'overlay_font_file',
        'overlay_shadow_x', 'overlay_shadow_y', 'overlay_outline_width',
        'overlay_margin_x', 'overlay_margin_y',
        'overlay_title', 'overlay_title_font_size', 'overlay_title_font_color',
        'np_mode', 'np_azuracast_url', 'np_azuracast_station', 'np_icecast_url', 'np_poll_interval',
        'video_width', 'video_height', 'video_bitrate', 'video_fps', 'audio_bitrate',
        'auto_restart', 'restart_delay_sec', 'max_restart_attempts',
        'telegram_enabled', 'telegram_bot_token', 'telegram_chat_id',
      ];    const updates: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE stations SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
    }
    return db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);
  });

  // Delete station
  app.delete<{ Params: { id: string } }>('/api/stations/:id', async (req) => {
    await supervisor.stopStation(req.params.id);
    db.prepare('DELETE FROM stations WHERE id = ?').run(req.params.id);
    // Clean up uploads
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads', req.params.id);
    if (fs.existsSync(uploadsDir)) {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
    return { ok: true };
  });

  // ─── STATION CONTROLS ────────────────────────────────────

  app.post<{ Params: { id: string } }>('/api/stations/:id/start', async (req) => {
    await supervisor.startStation(req.params.id);
    return { ok: true, status: 'starting' };
  });

  app.post<{ Params: { id: string } }>('/api/stations/:id/stop', async (req) => {
    await supervisor.stopStation(req.params.id);
    return { ok: true, status: 'stopped' };
  });

  app.post<{ Params: { id: string } }>('/api/stations/:id/restart', async (req) => {
    await supervisor.restartStation(req.params.id);
    return { ok: true, status: 'restarting' };
  });

  // ─── AUDIO SOURCES ───────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { name: string; url: string; priority?: number } }>(
    '/api/stations/:id/sources',
    async (req) => {
      const sourceId = uuid();
      const { name, url, priority } = req.body;
      db.prepare('INSERT INTO audio_sources (id, station_id, name, url, priority) VALUES (?, ?, ?, ?, ?)')
        .run(sourceId, req.params.id, name, url, priority || 0);
      return db.prepare('SELECT * FROM audio_sources WHERE id = ?').get(sourceId);
    }
  );

  app.put<{ Params: { id: string; sourceId: string }; Body: Record<string, any> }>(
    '/api/stations/:id/sources/:sourceId',
    async (req) => {
      const { name, url, priority, is_enabled } = req.body;
      const updates: string[] = [];
      const values: any[] = [];
      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (url !== undefined) { updates.push('url = ?'); values.push(url); }
      if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
      if (is_enabled !== undefined) { updates.push('is_enabled = ?'); values.push(is_enabled); }
      if (updates.length > 0) {
        values.push(req.params.sourceId);
        db.prepare(`UPDATE audio_sources SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      return db.prepare('SELECT * FROM audio_sources WHERE id = ?').get(req.params.sourceId);
    }
  );

  app.delete<{ Params: { id: string; sourceId: string } }>(
    '/api/stations/:id/sources/:sourceId',
    async (req) => {
      db.prepare('DELETE FROM audio_sources WHERE id = ?').run(req.params.sourceId);
      return { ok: true };
    }
  );

  // ─── FONTS ──────────────────────────────────────────────

  // List all available fonts (system + Google + custom uploaded)
  app.get('/api/fonts', async () => {
    const fontsDir = path.join(__dirname, '..', '..', 'uploads', 'fonts');
    const customFonts: { name: string; file: string }[] = [];

    if (fs.existsSync(fontsDir)) {
      const files = fs.readdirSync(fontsDir).filter(f => /\.(ttf|otf|woff|woff2)$/i.test(f));
      for (const file of files) {
        const name = file.replace(/\.(ttf|otf|woff|woff2)$/i, '').replace(/[-_]/g, ' ');
        customFonts.push({ name, file: path.join(fontsDir, file) });
      }
    }

    // Google Fonts installed in Docker (fontfile paths)
    const googleFonts = [
      { name: 'Poppins', file: '/usr/share/fonts/google/Poppins-Regular.ttf' },
      { name: 'Poppins Bold', file: '/usr/share/fonts/google/Poppins-Bold.ttf' },
      { name: 'Poppins SemiBold', file: '/usr/share/fonts/google/Poppins-SemiBold.ttf' },
      { name: 'Poppins Light', file: '/usr/share/fonts/google/Poppins-Light.ttf' },
      { name: 'Poppins ExtraBold', file: '/usr/share/fonts/google/Poppins-ExtraBold.ttf' },
      { name: 'League Spartan', file: '/usr/share/fonts/google/LeagueSpartan.ttf' },
      { name: 'Montserrat', file: '/usr/share/fonts/google/Montserrat.ttf' },
      { name: 'Oswald', file: '/usr/share/fonts/google/Oswald.ttf' },
      { name: 'Raleway', file: '/usr/share/fonts/google/Raleway.ttf' },
      { name: 'Roboto', file: '/usr/share/fonts/google/Roboto.ttf' },
      { name: 'Open Sans', file: '/usr/share/fonts/google/OpenSans.ttf' },
      { name: 'Lato', file: '/usr/share/fonts/google/Lato-Regular.ttf' },
      { name: 'Lato Bold', file: '/usr/share/fonts/google/Lato-Bold.ttf' },
      { name: 'Bebas Neue', file: '/usr/share/fonts/google/BebasNeue-Regular.ttf' },
      { name: 'Playfair Display', file: '/usr/share/fonts/google/PlayfairDisplay.ttf' },
      { name: 'Inter', file: '/usr/share/fonts/google/Inter.ttf' },
      { name: 'Nunito', file: '/usr/share/fonts/google/Nunito.ttf' },
      { name: 'Space Grotesk', file: '/usr/share/fonts/google/SpaceGrotesk.ttf' },
      { name: 'Archivo Black', file: '/usr/share/fonts/google/ArchivoBlack-Regular.ttf' },
      { name: 'Anton', file: '/usr/share/fonts/google/Anton-Regular.ttf' },
      { name: 'Comfortaa', file: '/usr/share/fonts/google/Comfortaa.ttf' },
      { name: 'Quicksand', file: '/usr/share/fonts/google/Quicksand.ttf' },
      { name: 'Kanit', file: '/usr/share/fonts/google/Kanit-Regular.ttf' },
      { name: 'Kanit Bold', file: '/usr/share/fonts/google/Kanit-Bold.ttf' },
    ];

    // System fonts (Alpine packages)
    const systemFonts = [
      { name: 'DejaVu Sans', file: '' },
      { name: 'DejaVu Sans Mono', file: '' },
      { name: 'DejaVu Serif', file: '' },
      { name: 'Liberation Sans', file: '' },
      { name: 'Liberation Serif', file: '' },
      { name: 'Liberation Mono', file: '' },
      { name: 'Noto Sans', file: '' },
      { name: 'Noto Serif', file: '' },
      { name: 'FreeSans', file: '' },
      { name: 'FreeSerif', file: '' },
      { name: 'FreeMono', file: '' },
    ];

    // Check which Google fonts actually exist on disk
    const availableGoogle = googleFonts.filter(f => fs.existsSync(f.file));

    return { system: systemFonts, google: availableGoogle, custom: customFonts };
  });

  // Upload custom font (.ttf/.otf)
  app.post('/api/fonts/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const ext = path.extname(data.filename).toLowerCase();
    if (!['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
      return reply.code(400).send({ error: 'Only .ttf, .otf, .woff, .woff2 files are allowed' });
    }

    const fontsDir = path.join(__dirname, '..', '..', 'uploads', 'fonts');
    fs.mkdirSync(fontsDir, { recursive: true });

    const safeFilename = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(fontsDir, safeFilename);

    const writeStream = fs.createWriteStream(filePath);
    await data.file.pipe(writeStream);
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const name = safeFilename.replace(/\.(ttf|otf|woff|woff2)$/i, '').replace(/[-_]/g, ' ');
    return { ok: true, font: { name, file: filePath, filename: safeFilename } };
  });

  // Delete custom font
  app.delete<{ Params: { filename: string } }>('/api/fonts/:filename', async (req, reply) => {
    const fontsDir = path.join(__dirname, '..', '..', 'uploads', 'fonts');
    const filePath = path.join(fontsDir, req.params.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { ok: true };
    }
    return reply.code(404).send({ error: 'Font not found' });
  });

  // ─── PLAYLIST (video upload + management) ─────────────

  // Upload MP4
  app.post<{ Params: { id: string } }>('/api/stations/:id/playlist/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file' });

    const uploadsDir = path.join(__dirname, '..', '..', 'uploads', req.params.id);
    fs.mkdirSync(uploadsDir, { recursive: true });

    const itemId = uuid();
    const ext = path.extname(data.filename) || '.mp4';
    const filename = `${itemId}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    // Stream to file
    const writeStream = fs.createWriteStream(filePath);
    await data.file.pipe(writeStream);
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const fileStats = fs.statSync(filePath);
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM playlist_items WHERE station_id = ?').get(req.params.id) as any;
    const sortOrder = (maxOrder?.m || 0) + 1;

    db.prepare(
      'INSERT INTO playlist_items (id, station_id, filename, original_name, file_size, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(itemId, req.params.id, filename, data.filename, fileStats.size, sortOrder);

    return db.prepare('SELECT * FROM playlist_items WHERE id = ?').get(itemId);
  });

  // List playlist
  app.get<{ Params: { id: string } }>('/api/stations/:id/playlist', async (req) => {
    return db.prepare('SELECT * FROM playlist_items WHERE station_id = ? ORDER BY sort_order ASC').all(req.params.id);
  });

  // Reorder playlist
  app.put<{ Params: { id: string }; Body: { items: { id: string; sort_order: number; is_enabled?: number }[] } }>(
    '/api/stations/:id/playlist/reorder',
    async (req) => {
      const updateStmt = db.prepare('UPDATE playlist_items SET sort_order = ?, is_enabled = COALESCE(?, is_enabled) WHERE id = ? AND station_id = ?');
      const txn = db.transaction(() => {
        for (const item of req.body.items) {
          updateStmt.run(item.sort_order, item.is_enabled ?? null, item.id, req.params.id);
        }
      });
      txn();

      // Atomic playlist file update
      const station = db.prepare('SELECT slug FROM stations WHERE id = ?').get(req.params.id) as any;
      supervisor.writeConcatPlaylist(req.params.id, station?.slug);

      return { ok: true };
    }
  );

  // Delete playlist item
  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/stations/:id/playlist/:itemId',
    async (req) => {
      const item = db.prepare('SELECT filename FROM playlist_items WHERE id = ? AND station_id = ?').get(req.params.itemId, req.params.id) as any;
      if (item) {
        const filePath = path.join(__dirname, '..', '..', 'uploads', req.params.id, item.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        db.prepare('DELETE FROM playlist_items WHERE id = ?').run(req.params.itemId);
      }
      // Update concat playlist
      const station = db.prepare('SELECT slug FROM stations WHERE id = ?').get(req.params.id) as any;
      supervisor.writeConcatPlaylist(req.params.id, station?.slug);
      return { ok: true };
    }
  );

  // Apply playlist changes (atomic update + restart only this station's FFmpeg)
  app.post<{ Params: { id: string } }>('/api/stations/:id/playlist/apply', async (req) => {
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id) as any;
    if (!station) return { error: 'Station not found' };

    supervisor.writeConcatPlaylist(req.params.id, station.slug);

    // Restart only this station's pipeline
    const status = supervisor.getStationStatus(req.params.id);
    if (status.status === 'running') {
      await supervisor.restartStation(req.params.id);
      return { ok: true, action: 'playlist_updated_and_restarted' };
    }
    return { ok: true, action: 'playlist_updated' };
  });

  // ─── RTMP DESTINATIONS ───────────────────────────────────

  app.post<{ Params: { id: string }; Body: { name: string; platform: string; rtmp_url: string; stream_key?: string } }>(
    '/api/stations/:id/destinations',
    async (req) => {
      const destId = uuid();
      const { name, platform, rtmp_url, stream_key } = req.body;
      db.prepare('INSERT INTO rtmp_destinations (id, station_id, name, platform, rtmp_url, stream_key) VALUES (?, ?, ?, ?, ?, ?)')
        .run(destId, req.params.id, name.trim(), platform, (rtmp_url || '').trim(), (stream_key || '').trim());
      return db.prepare('SELECT * FROM rtmp_destinations WHERE id = ?').get(destId);
    }
  );

  app.put<{ Params: { id: string; destId: string }; Body: Record<string, any> }>(
    '/api/stations/:id/destinations/:destId',
    async (req) => {
      const allowed = ['name', 'platform', 'rtmp_url', 'stream_key', 'is_enabled'];
      const updates: string[] = [];
      const values: any[] = [];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          updates.push(`${key} = ?`);
          // Trim whitespace from URL fields
          const val = (key === 'rtmp_url' || key === 'stream_key') && typeof req.body[key] === 'string'
            ? req.body[key].trim()
            : req.body[key];
          values.push(val);
        }
      }
      if (updates.length > 0) {
        values.push(req.params.destId);
        db.prepare(`UPDATE rtmp_destinations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      return db.prepare('SELECT * FROM rtmp_destinations WHERE id = ?').get(req.params.destId);
    }
  );

  app.delete<{ Params: { id: string; destId: string } }>(
    '/api/stations/:id/destinations/:destId',
    async (req) => {
      db.prepare('DELETE FROM rtmp_destinations WHERE id = ?').run(req.params.destId);
      return { ok: true };
    }
  );

  // ─── DIAGNOSTICS / TESTING ───────────────────────────────

  // Test audio source reachability
  app.post<{ Body: { url: string } }>('/api/test/audio', async (req) => {
    return await checkAudioSource(req.body.url);
  });

  // Test now playing
  app.post<{ Body: { mode: string; azuracast_url?: string; azuracast_station?: string; icecast_url?: string } }>(
    '/api/test/nowplaying',
    async (req) => {
      const np = new NowPlayingService({
        mode: req.body.mode as any,
        azuracastUrl: req.body.azuracast_url || '',
        azuracastStation: req.body.azuracast_station || '',
        icecastUrl: req.body.icecast_url || '',
        pollInterval: 5000,
        textFilePath: '/tmp/np_test.txt',
      });
      return await np.testNowPlaying();
    }
  );

  // Test RTMP destination (10s test stream)
  app.post<{ Body: { rtmp_url: string; stream_key?: string } }>('/api/test/rtmp', async (req) => {
    return await testRtmpDestination(req.body.rtmp_url, req.body.stream_key || '');
  });

  // Run health checks for station
  app.post<{ Params: { id: string } }>('/api/stations/:id/healthcheck', async (req) => {
    return await runAudioHealthChecks(req.params.id);
  });

  // Test Telegram bot connection
  app.post<{ Params: { id: string } }>('/api/stations/:id/test/telegram', async (req) => {
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id) as any;
    if (!station) return { ok: false, error: 'Station not found' };
    if (!station.telegram_bot_token || !station.telegram_chat_id) {
      return { ok: false, error: 'Bot token and chat ID are required' };
    }
    const result = await sendTelegramTest(station.telegram_bot_token, station.telegram_chat_id, station.name);
    return result;
  });

  // ─── PREVIEW ─────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/stations/:id/preview', async (req, reply) => {
    const previewPath = await supervisor.generatePreview(req.params.id);
    if (previewPath && fs.existsSync(previewPath)) {
      return reply.type('image/jpeg').send(fs.readFileSync(previewPath));
    }
    return reply.code(404).send({ error: 'Preview generation failed' });
  });

  // ─── LOGS ────────────────────────────────────────────────

  app.get<{ Params: { id: string }; Querystring: { limit?: string; level?: string } }>(
    '/api/stations/:id/logs',
    async (req) => {
      const limit = parseInt(req.query.limit || '100');
      const level = req.query.level;
      if (level) {
        return db.prepare('SELECT * FROM station_logs WHERE station_id = ? AND level = ? ORDER BY created_at DESC LIMIT ?')
          .all(req.params.id, level, limit);
      }
      return db.prepare('SELECT * FROM station_logs WHERE station_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(req.params.id, limit);
    }
  );

  // ─── EXPORT LOGS AS CSV ──────────────────────────────────

  app.get<{ Params: { id: string }; Querystring: { level?: string } }>(
    '/api/stations/:id/logs/export',
    async (req, reply) => {
      const level = req.query.level;
      let rows: any[];
      if (level) {
        rows = db.prepare('SELECT * FROM station_logs WHERE station_id = ? AND level = ? ORDER BY created_at DESC')
          .all(req.params.id, level);
      } else {
        rows = db.prepare('SELECT * FROM station_logs WHERE station_id = ? ORDER BY created_at DESC')
          .all(req.params.id);
      }

      const station = db.prepare('SELECT name, slug FROM stations WHERE id = ?').get(req.params.id) as any;
      const filename = `logs-${station?.slug || req.params.id}-${new Date().toISOString().slice(0, 10)}.csv`;

      // Build CSV
      const escapeCsv = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
      const header = 'Date,Time,Level,Source,Message';
      const lines = rows.map((r: any) => {
        const dt = new Date(r.created_at);
        return [
          dt.toISOString().slice(0, 10),
          dt.toISOString().slice(11, 19),
          r.level,
          r.source,
          escapeCsv(r.message),
        ].join(',');
      });

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return header + '\n' + lines.join('\n');
    }
  );
}
