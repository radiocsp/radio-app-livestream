import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import { getDb } from './db/schema';
import { registerStationRoutes } from './routes/stations';
import { authRoutes } from './routes/auth';
import { registerSSLRoutes } from './routes/ssl';
import { startAutoRenewal } from './services/ssl';
import jwtAuthPlugin from './plugins/jwt-auth';
import { FFmpegSupervisor } from './services/ffmpeg-supervisor';
import { getSystemHealth } from './utils/system-health';
import { sendTelegramError } from './services/telegram';

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

async function main() {
  // Ensure directories exist
  fs.mkdirSync(path.join(DATA_DIR, 'stations'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, '..', 'uploads'), { recursive: true });

  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
    bodyLimit: 5 * 1024 * 1024 * 1024, // 5GB for video uploads
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024 * 1024,
    },
  });
  await app.register(websocket);

  // JWT authentication + rate limiting (registers before all routes)
  await app.register(jwtAuthPlugin);

  // Serve uploaded files
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Serve frontend build (production)
  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      decorateReply: false,
    });
  }

  // Initialize DB
  getDb();

  // Create FFmpeg supervisor
  const supervisor = new FFmpegSupervisor(DATA_DIR);

  // Store logs in DB
  supervisor.on('log', (stationId: string, level: string, source: string, message: string) => {
    try {
      const db = getDb();
      db.prepare('INSERT INTO station_logs (station_id, level, source, message) VALUES (?, ?, ?, ?)')
        .run(stationId, level, source, message);
      // Keep only last 1000 logs per station
      db.prepare('DELETE FROM station_logs WHERE station_id = ? AND id NOT IN (SELECT id FROM station_logs WHERE station_id = ? ORDER BY created_at DESC LIMIT 1000)')
        .run(stationId, stationId);

      // Send Telegram notification for errors
      if (level === 'error') {
        const station = db.prepare('SELECT name, telegram_enabled, telegram_bot_token, telegram_chat_id FROM stations WHERE id = ?').get(stationId) as any;
        if (station?.telegram_enabled && station.telegram_bot_token && station.telegram_chat_id) {
          sendTelegramError(station.telegram_bot_token, station.telegram_chat_id, station.name, stationId, level, source, message)
            .catch(() => {}); // fire-and-forget
        }
      }
    } catch {}

    // Broadcast to SSE clients
    broadcastSSE({ type: 'log', stationId, level, source, message, timestamp: new Date().toISOString() });
  });

  supervisor.on('status', (stationId: string, status: string) => {
    broadcastSSE({ type: 'status', stationId, status, timestamp: new Date().toISOString() });
  });

  supervisor.on('nowplaying', (stationId: string, track: string) => {
    broadcastSSE({ type: 'nowplaying', stationId, track, timestamp: new Date().toISOString() });
  });

  // Register routes
  await app.register(authRoutes);
  registerStationRoutes(app, supervisor);
  registerSSLRoutes(app);

  // ─── SSE endpoint for real-time updates ──────────────────
  const sseClients: Set<any> = new Set();

  function broadcastSSE(data: any) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try { client.raw.write(msg); } catch { sseClients.delete(client); }
    }
  }

  app.get('/api/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write('data: {"type":"connected"}\n\n');
    sseClients.add(reply);
    req.raw.on('close', () => {
      sseClients.delete(reply);
    });
  });

  // ─── System health endpoint ──────────────────────────────
  app.get('/api/system/health', async () => {
    return getSystemHealth();
  });

  // ─── SPA fallback: serve index.html for non-API routes ──
  app.setNotFoundHandler(async (request, reply) => {
    const url = request.url;
    // Don't intercept API routes — return proper 404
    if (url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Route not found' });
    }
    // Serve index.html for all other routes (React Router SPA)
    const indexPath = path.join(frontendDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, 'utf-8');
      return reply.type('text/html').send(html);
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  // ─── Start server ────────────────────────────────────────
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n🎙️  RadioStream Studio backend running on http://${HOST}:${PORT}\n`);

    // Start SSL auto-renewal timer
    startAutoRenewal();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
