import os from 'os';
import fs from 'fs';

export function getSystemHealth() {
  const cpus = os.cpus();
  const cpuUsage = cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return acc + ((total - idle) / total) * 100;
  }, 0) / cpus.length;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let diskTotal = 0;
  let diskFree = 0;
  try {
    // Simple disk check for root
    const stats = fs.statfsSync('/');
    diskTotal = stats.blocks * stats.bsize;
    diskFree = stats.bfree * stats.bsize;
  } catch {}

  return {
    cpu: {
      count: cpus.length,
      model: cpus[0]?.model || 'unknown',
      usagePercent: Math.round(cpuUsage * 10) / 10,
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      freeBytes: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 1000) / 10,
    },
    disk: {
      totalBytes: diskTotal,
      freeBytes: diskFree,
      usagePercent: diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 1000) / 10 : 0,
    },
    uptime: os.uptime(),
    platform: os.platform(),
    hostname: os.hostname(),
  };
}
