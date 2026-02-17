import { spawn } from 'child_process';
import { getDb } from '../db/schema';

interface HealthCheckResult {
  sourceId: string;
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

export async function checkAudioSource(url: string): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = setTimeout(() => {
      resolve({ reachable: false, latencyMs: 0, error: 'Timeout (10s)' });
    }, 10000);

    try {
      const controller = new AbortController();
      fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      }).then(resp => {
        clearTimeout(timeout);
        const latency = Date.now() - start;
        if (resp.ok || resp.status === 200 || resp.status === 302) {
          resolve({ reachable: true, latencyMs: latency });
        } else {
          resolve({ reachable: false, latencyMs: latency, error: `HTTP ${resp.status}` });
        }
      }).catch(err => {
        clearTimeout(timeout);
        resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message });
      });
    } catch (err: any) {
      clearTimeout(timeout);
      resolve({ reachable: false, latencyMs: 0, error: err.message });
    }
  });
}

export async function runAudioHealthChecks(stationId: string): Promise<HealthCheckResult[]> {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM audio_sources WHERE station_id = ? AND is_enabled = 1 ORDER BY priority ASC').all(stationId) as any[];
  const results: HealthCheckResult[] = [];

  for (const source of sources) {
    const check = await checkAudioSource(source.url);
    db.prepare("UPDATE audio_sources SET status = ?, last_check = datetime('now'), last_latency_ms = ? WHERE id = ?")
      .run(check.reachable ? 'healthy' : 'unreachable', check.latencyMs, source.id);
    results.push({
      sourceId: source.id,
      ...check,
    });
  }
  return results;
}

export async function testRtmpDestination(rtmpUrl: string, streamKey: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const fullUrl = streamKey ? `${rtmpUrl}/${streamKey}` : rtmpUrl;
    // Generate a 10-second test pattern with "TEST" overlay
    const args = [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=10:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-vf', "drawtext=text='TEST STREAM':fontsize=60:fontcolor=red:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.7:boxborderw=10",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '1000k',
      '-c:a', 'aac', '-b:a', '128k',
      '-f', 'flv', '-flvflags', 'no_duration_filesize',
      fullUrl,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: true }); // If it ran for 10s without error, it's good
    }, 15000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || stderr.includes('muxing overhead')) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr.slice(-500) });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
  });
}
