export interface Station {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
  overlay_enabled: number;
  overlay_font_size: number;
  overlay_font_color: string;
  overlay_font_family: string;
  overlay_bg_color: string;
  overlay_position: string;
  overlay_font_file: string;
  overlay_shadow_x: number;
  overlay_shadow_y: number;
  overlay_outline_width: number;
  overlay_margin_x: number;
  overlay_margin_y: number;
  overlay_title: string;
  overlay_title_font_size: number;
  overlay_title_font_color: string;
  np_mode: string;
  np_azuracast_url: string;
  np_azuracast_station: string;
  np_icecast_url: string;
  np_poll_interval: number;
  video_width: number;
  video_height: number;
  video_bitrate: string;
  video_fps: number;
  audio_bitrate: string;
  auto_restart: number;
  restart_delay_sec: number;
  max_restart_attempts: number;
  runtime?: {
    status: string;
    pid: number | null;
    restartCount: number;
    uptime: number | null;
  };
}

export interface AudioSource {
  id: string;
  station_id: string;
  name: string;
  url: string;
  priority: number;
  is_enabled: number;
  status: string;
  last_check: string | null;
  last_latency_ms: number | null;
  created_at: string;
}

export interface PlaylistItem {
  id: string;
  station_id: string;
  filename: string;
  original_name: string;
  file_size: number;
  duration_sec: number | null;
  sort_order: number;
  is_enabled: number;
  created_at: string;
}

export interface RtmpDestination {
  id: string;
  station_id: string;
  name: string;
  platform: string;
  rtmp_url: string;
  stream_key: string;
  is_enabled: number;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface StationLog {
  id: number;
  station_id: string;
  level: string;
  source: string;
  message: string;
  created_at: string;
}

export interface SystemHealth {
  cpu: { count: number; model: string; usagePercent: number };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number };
  disk: { totalBytes: number; freeBytes: number; usagePercent: number };
  uptime: number;
  platform: string;
  hostname: string;
}

export interface SSEEvent {
  type: 'log' | 'status' | 'nowplaying' | 'connected';
  stationId?: string;
  level?: string;
  source?: string;
  message?: string;
  status?: string;
  track?: string;
  timestamp?: string;
}
