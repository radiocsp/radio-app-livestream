import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const CHUNKS_DIR = path.join(UPLOADS_DIR, '_chunks');

interface ChunkSession {
  sessionId: string;
  size: number;
  chunkCount: number;
  createdAt: string;
  age: string;
}

function getDirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  try {
    const output = execSync(`du -sb "${dir}" 2>/dev/null`).toString().trim();
    return parseInt(output.split('\t')[0]) || 0;
  } catch {
    // Fallback: walk directory
    let total = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          total += getDirSize(fullPath);
        } else {
          try { total += fs.statSync(fullPath).size; } catch {}
        }
      }
    } catch {}
    return total;
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function timeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function registerStorageRoutes(app: FastifyInstance) {

  // GET /api/admin/storage — overview of disk usage
  app.get('/api/admin/storage', async () => {
    // Disk info
    let diskTotal = 0, diskUsed = 0, diskFree = 0;
    try {
      const dfOutput = execSync("df -B1 / 2>/dev/null | tail -1").toString().trim();
      const parts = dfOutput.split(/\s+/);
      diskTotal = parseInt(parts[1]) || 0;
      diskUsed = parseInt(parts[2]) || 0;
      diskFree = parseInt(parts[3]) || 0;
    } catch {}

    // Total uploads size
    const uploadsSize = getDirSize(UPLOADS_DIR);

    // Chunks info
    const chunksSize = getDirSize(CHUNKS_DIR);
    const chunkSessions: ChunkSession[] = [];

    if (fs.existsSync(CHUNKS_DIR)) {
      const entries = fs.readdirSync(CHUNKS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionDir = path.join(CHUNKS_DIR, entry.name);
        const sessionSize = getDirSize(sessionDir);
        let chunkCount = 0;
        try {
          chunkCount = fs.readdirSync(sessionDir).filter(f => f.startsWith('chunk_')).length;
        } catch {}
        let createdAt = '';
        let ageMs = 0;
        try {
          const stat = fs.statSync(sessionDir);
          createdAt = stat.birthtime.toISOString();
          ageMs = Date.now() - stat.birthtime.getTime();
        } catch {}

        chunkSessions.push({
          sessionId: entry.name,
          size: sessionSize,
          chunkCount,
          createdAt,
          age: timeAgo(ageMs),
        });
      }
    }

    // Per-station uploads size
    const stationDirs: { id: string; size: number; fileCount: number }[] = [];
    if (fs.existsSync(UPLOADS_DIR)) {
      const entries = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === '_chunks') continue;
        const stDir = path.join(UPLOADS_DIR, entry.name);
        const stSize = getDirSize(stDir);
        let fileCount = 0;
        try { fileCount = fs.readdirSync(stDir).length; } catch {}
        stationDirs.push({ id: entry.name, size: stSize, fileCount });
      }
    }

    return {
      disk: {
        total: diskTotal,
        used: diskUsed,
        free: diskFree,
        totalFormatted: formatSize(diskTotal),
        usedFormatted: formatSize(diskUsed),
        freeFormatted: formatSize(diskFree),
        usagePercent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0,
      },
      uploads: {
        totalSize: uploadsSize,
        totalFormatted: formatSize(uploadsSize),
      },
      chunks: {
        totalSize: chunksSize,
        totalFormatted: formatSize(chunksSize),
        sessionCount: chunkSessions.length,
        sessions: chunkSessions.map(s => ({
          ...s,
          sizeFormatted: formatSize(s.size),
        })),
      },
      stations: stationDirs.map(s => ({
        ...s,
        sizeFormatted: formatSize(s.size),
      })),
    };
  });

  // DELETE /api/admin/storage/chunks — delete ALL orphaned chunks
  app.delete('/api/admin/storage/chunks', async () => {
    if (!fs.existsSync(CHUNKS_DIR)) {
      return { success: true, message: 'No chunks directory found', freedBytes: 0 };
    }

    const sizeBefore = getDirSize(CHUNKS_DIR);
    const entries = fs.readdirSync(CHUNKS_DIR, { withFileTypes: true });
    let deleted = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        fs.rmSync(path.join(CHUNKS_DIR, entry.name), { recursive: true, force: true });
        deleted++;
      } catch {}
    }

    return {
      success: true,
      message: `Deleted ${deleted} chunk session(s)`,
      freedBytes: sizeBefore,
      freedFormatted: formatSize(sizeBefore),
    };
  });

  // DELETE /api/admin/storage/chunks/:sessionId — delete a specific chunk session
  app.delete<{ Params: { sessionId: string } }>('/api/admin/storage/chunks/:sessionId', async (req, reply) => {
    const sessionDir = path.join(CHUNKS_DIR, req.params.sessionId);

    // Security check — prevent path traversal
    if (!sessionDir.startsWith(CHUNKS_DIR)) {
      return reply.code(400).send({ error: 'Invalid session ID' });
    }

    if (!fs.existsSync(sessionDir)) {
      return reply.code(404).send({ error: 'Chunk session not found' });
    }

    const size = getDirSize(sessionDir);
    fs.rmSync(sessionDir, { recursive: true, force: true });

    return {
      success: true,
      message: `Deleted chunk session ${req.params.sessionId}`,
      freedBytes: size,
      freedFormatted: formatSize(size),
    };
  });
}
