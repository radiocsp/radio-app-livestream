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

### Recommended VPS specs
- **2+ vCPU / 4+ GB RAM** (4 vCPU / 8 GB recommended for multiple stations)
- Ubuntu 22.04+ or 24.04 LTS
- Open ports: **80** (HTTP), **443** (HTTPS optional)

### Step 1: Install Docker & Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Log out and back in (or run: newgrp docker)

# Verify
docker --version
docker compose version
```

### Step 2: Clone the repository

```bash
cd /opt
sudo git clone https://github.com/radiocsp/radio-app-livestream.git radiostream
sudo chown -R $USER:$USER /opt/radiostream
cd /opt/radiostream
```

### Step 3: Configure environment

Edit `docker-compose.yml` and change these values:

```bash
nano docker-compose.yml
```

**⚠️ IMPORTANT — Change before going live:**
```yaml
environment:
  - JWT_SECRET=your-random-secret-minimum-32-characters-long
  - ADMIN_PASSWORD=YourStrongPassword123!
```

Generate a secure JWT secret:
```bash
openssl rand -hex 32
```

### Step 4: Build and start

```bash
docker compose up -d --build
```

This will:
- Build the backend (Node.js 20 + FFmpeg with full filter support including `drawtext`)
- Build the frontend (React → nginx)
- Start both containers

### Step 5: Verify

```bash
# Check containers are running
docker compose ps

# Check logs
docker compose logs -f

# Test health endpoint
curl http://localhost/api/system/health
```

### Access the app

Open **http://YOUR_VPS_IP** in your browser.

Login: `admin` / (the password you set in `ADMIN_PASSWORD`)

### Useful commands

```bash
# Stop
docker compose down

# Restart
docker compose restart

# Rebuild after pulling updates
git pull origin main
docker compose up -d --build

# View live logs
docker compose logs -f backend

# Backup database
cp /opt/radiostream/data/radiostream.db /opt/radiostream/data/radiostream.db.bak
```

### Optional: HTTPS with Caddy (recommended)

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Configure Caddy (replace radio.yourdomain.com)
sudo tee /etc/caddy/Caddyfile <<EOF
radio.yourdomain.com {
    reverse_proxy localhost:80
}
EOF

# In docker-compose.yml, change frontend port from "80:80" to "8080:80"
# Then restart:
docker compose up -d
sudo systemctl restart caddy
```

Caddy will automatically get a Let's Encrypt SSL certificate.

### Optional: Run WITHOUT Docker (bare metal)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install FFmpeg (with drawtext/libfreetype support)
sudo apt install -y ffmpeg

# Verify FFmpeg has drawtext
ffmpeg -filters 2>&1 | grep drawtext
# Should show: T->T drawtext V->V ...

# Clone & setup
cd /opt
sudo git clone https://github.com/radiocsp/radio-app-livestream.git radiostream
sudo chown -R $USER:$USER /opt/radiostream
cd /opt/radiostream

# Backend
cd backend
npm install
npm run build

# Frontend
cd ../frontend
npm install
npm run build

# Copy frontend build to backend
cp -r dist ../backend/dist-frontend  # (or configure nginx to serve frontend)

# Start backend
cd ../backend
JWT_SECRET=your-secret-here ADMIN_PASSWORD=YourPassword123! node dist/index.js

# The app will be available on http://YOUR_IP:3001
```

For production bare-metal, use **pm2** to keep the process running:
```bash
sudo npm install -g pm2

cd /opt/radiostream/backend
JWT_SECRET=your-secret ADMIN_PASSWORD=YourPass123! pm2 start dist/index.js --name radiostream
pm2 save
pm2 startup  # follow the instructions to auto-start on boot
```

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
