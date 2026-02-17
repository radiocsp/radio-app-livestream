import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '..', 'data', 'radiostream.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'stopped',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),

      -- Overlay settings
      overlay_enabled INTEGER NOT NULL DEFAULT 1,
      overlay_font_size INTEGER NOT NULL DEFAULT 28,
      overlay_font_color TEXT NOT NULL DEFAULT 'white',
      overlay_bg_color TEXT NOT NULL DEFAULT 'black@0.6',
      overlay_position TEXT NOT NULL DEFAULT 'bottom-left',
      overlay_font_file TEXT NOT NULL DEFAULT '',
      overlay_shadow_x INTEGER NOT NULL DEFAULT 2,
      overlay_shadow_y INTEGER NOT NULL DEFAULT 2,
      overlay_outline_width INTEGER NOT NULL DEFAULT 1,
      overlay_margin_x INTEGER NOT NULL DEFAULT 20,
      overlay_margin_y INTEGER NOT NULL DEFAULT 20,

      -- Now Playing source
      np_mode TEXT NOT NULL DEFAULT 'azuracast',
      np_azuracast_url TEXT NOT NULL DEFAULT '',
      np_azuracast_station TEXT NOT NULL DEFAULT '',
      np_icecast_url TEXT NOT NULL DEFAULT '',
      np_poll_interval INTEGER NOT NULL DEFAULT 5,

      -- Stream settings
      video_width INTEGER NOT NULL DEFAULT 1920,
      video_height INTEGER NOT NULL DEFAULT 1080,
      video_bitrate TEXT NOT NULL DEFAULT '4000k',
      video_fps INTEGER NOT NULL DEFAULT 30,
      audio_bitrate TEXT NOT NULL DEFAULT '192k',

      -- Auto-restart
      auto_restart INTEGER NOT NULL DEFAULT 1,
      restart_delay_sec INTEGER NOT NULL DEFAULT 5,
      max_restart_attempts INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS audio_sources (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_check TEXT,
      last_latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      duration_sec REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rtmp_destinations (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'custom',
      rtmp_url TEXT NOT NULL,
      stream_key TEXT NOT NULL DEFAULT '',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disconnected',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS station_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'info',
      source TEXT NOT NULL DEFAULT 'app',
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audio_sources_station ON audio_sources(station_id, priority);
    CREATE INDEX IF NOT EXISTS idx_playlist_items_station ON playlist_items(station_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_rtmp_destinations_station ON rtmp_destinations(station_id);
    CREATE INDEX IF NOT EXISTS idx_station_logs_station ON station_logs(station_id, created_at);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login TEXT,
      last_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);

  // Seed default admin if no users exist
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  if (userCount === 0) {
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123!';
    const hash = bcrypt.hashSync(adminPass, 12);
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'admin')"
    ).run(uuidv4(), 'admin', hash);
    console.log(`\n🔐 Default admin user created. Username: admin  Password: ${adminPass}`);
    console.log('   ⚠️  Change the password immediately via the UI!\n');
  }
}
