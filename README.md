# RadioStream Studio 🎙️

**PRO web platform for 24/7 radio livestreaming with video + overlay + multi-RTMP output.**

Everything is controllable from the web UI — no shell commands needed.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + TypeScript + Tailwind CSS)           │
│  Port 5173 (dev) / 80 (production via nginx)            │
│  ├─ Dashboard: system health, station cards             │
│  ├─ Station Detail: playlist, sources, RTMP, overlay    │
│  ├─ Live Logs (SSE streaming)                           │
│  ├─ Diagnostics (test audio, NP, RTMP)                  │
│  └─ Preview snapshot                                    │
├─────────────────────────────────────────────────────────┤
│  Backend (Fastify + TypeScript + SQLite)                │
│  Port 3001                                              │
│  ├─ REST API: stations, sources, playlist, destinations │
│  ├─ SSE: real-time status + logs                        │
│  ├─ FFmpeg Supervisor: 1 process per station            │
│  │   ├─ Auto-restart with exponential backoff           │
│  │   ├─ Atomic playlist file updates                    │
│  │   └─ drawtext overlay (textfile + reload=1)          │
│  ├─ Now Playing Service: AzuraCast / Icecast polling    │
│  └─ Health Check: audio source + RTMP testing           │
├─────────────────────────────────────────────────────────┤
│  FFmpeg (1 process per station)                         │
│  ├─ Video: concat demuxer (loop playlist)               │
│  ├─ Audio: Icecast/AzuraCast stream input               │
│  ├─ Overlay: drawtext with live textfile reload         │
│  └─ Output: FLV to RTMP (single or tee multi-dest)     │
└─────────────────────────────────────────────────────────┘
```

## ✨ Features

- **Unlimited stations** — create as many as needed, each fully independent
- **Video playlist** — upload MP4, reorder, enable/disable, loop
- **Atomic playlist updates** — write-temp-then-rename, restart only affected station
- **Now Playing overlay** — AzuraCast API or Icecast status-json.xsl, poll every 5s
- **Overlay styling** — font, size, color, shadow, outline, background, position (per station)
- **Multi-RTMP** — YouTube, Facebook, Restream, custom; single or multi-destination
- **Audio failover** — multiple sources with priority, health checks, auto-failover
- **Preview** — snapshot image of current video + overlay
- **Live logs** — SSE-streamed FFmpeg stderr + app logs
- **Diagnostics** — test audio URLs, now playing, RTMP (10s test stream)
- **System health** — CPU, RAM, disk monitoring in dashboard
- **Docker ready** — docker-compose for Mac dev and Ubuntu VPS

## 📋 API Endpoints

### Stations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stations` | List all stations |
| GET | `/api/stations/:id` | Get station + sources + playlist + destinations |
| POST | `/api/stations` | Create station `{ name, slug }` |
| PUT | `/api/stations/:id` | Update station settings |
| DELETE | `/api/stations/:id` | Delete station + files |

### Controls
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/stations/:id/start` | Start streaming |
| POST | `/api/stations/:id/stop` | Stop streaming |
| POST | `/api/stations/:id/restart` | Restart (only this station) |

### Audio Sources
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/stations/:id/sources` | Add source `{ name, url, priority }` |
| PUT | `/api/stations/:id/sources/:sid` | Update source |
| DELETE | `/api/stations/:id/sources/:sid` | Remove source |

### Playlist
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stations/:id/playlist` | List playlist items |
| POST | `/api/stations/:id/playlist/upload` | Upload MP4 (multipart) |
| PUT | `/api/stations/:id/playlist/reorder` | Reorder + enable/disable |
| DELETE | `/api/stations/:id/playlist/:itemId` | Delete video |
| POST | `/api/stations/:id/playlist/apply` | Apply changes + restart stream |

### RTMP Destinations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/stations/:id/destinations` | Add destination |
| PUT | `/api/stations/:id/destinations/:did` | Update destination |
| DELETE | `/api/stations/:id/destinations/:did` | Remove destination |

### Diagnostics & Testing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/test/audio` | Test audio URL reachability |
| POST | `/api/test/nowplaying` | Test now playing source |
| POST | `/api/test/rtmp` | Test RTMP (10s stream) |
| POST | `/api/stations/:id/healthcheck` | Run health checks |

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stations/:id/preview` | Generate preview snapshot |
| GET | `/api/stations/:id/logs` | Get recent logs |
| GET | `/api/events` | SSE stream (status + logs + NP) |
| GET | `/api/system/health` | System health (CPU/RAM/disk) |

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- FFmpeg installed (`brew install ffmpeg` on Mac)

### Setup
```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

## 🐳 Docker Deployment (Ubuntu VPS)

```bash
# Clone and deploy
docker-compose up -d --build

# Access at http://YOUR_VPS_IP
```

### Recommended VPS specs
- 4 vCPU / 8 GB RAM
- Ubuntu 22.04+
- Docker + Docker Compose
- FFmpeg (included in Docker image)

## 📁 Data Model

```
stations
├── audio_sources (per station, with priority)
├── playlist_items (per station, with sort_order)
├── rtmp_destinations (per station)
└── station_logs (per station)
```

All data stored in SQLite at `data/radiostream.db`.  
Uploaded videos stored in `backend/uploads/{station_id}/`.  
Runtime data (playlists, now-playing text) in `data/stations/{slug}/`.

## 🔧 Example Station Config

1. Create a station: **"My Radio"** (slug: `my-radio`)
2. Add audio source: `https://radio.example.com/stream` (priority 0)
3. Upload 1+ MP4 video files
4. Add RTMP destination: YouTube `rtmp://a.rtmp.youtube.com/live2` + stream key
5. Configure overlay: AzuraCast URL, position bottom-left, font size 28
6. Click **Start** — the station goes live!

## 📝 License

MIT
