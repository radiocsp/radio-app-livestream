const API = '/api';

// Token getter — reads from both storages (login page sets appropriate storage)
function getToken(): string | null {
  return localStorage.getItem('rss_token') || sessionStorage.getItem('rss_token');
}

// Handle 401 — reload to trigger PrivateRoute redirect
function handle401() {
  localStorage.removeItem('rss_token');
  localStorage.removeItem('rss_refresh');
  localStorage.removeItem('rss_user');
  sessionStorage.removeItem('rss_token');
  sessionStorage.removeItem('rss_refresh');
  sessionStorage.removeItem('rss_user');
  window.location.href = '/login';
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${url}`, { ...options, headers });

  if (res.status === 401) {
    handle401();
    throw new Error('Session expired — redirecting to login');
  }

  return res.json();
}

export const api = {
  // Stations
  getStations: () => request<any[]>('/stations'),
  getStation: (id: string) => request<any>(`/stations/${id}`),
  createStation: (data: { name: string; slug: string }) =>
    request<any>('/stations', { method: 'POST', body: JSON.stringify(data) }),
  updateStation: (id: string, data: Record<string, any>) =>
    request<any>(`/stations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStation: (id: string) =>
    request<any>(`/stations/${id}`, { method: 'DELETE' }),

  // Controls
  startStation: (id: string) => request<any>(`/stations/${id}/start`, { method: 'POST', body: JSON.stringify({}) }),
  stopStation: (id: string) => request<any>(`/stations/${id}/stop`, { method: 'POST', body: JSON.stringify({}) }),
  restartStation: (id: string) => request<any>(`/stations/${id}/restart`, { method: 'POST', body: JSON.stringify({}) }),

  // Audio sources
  addSource: (stationId: string, data: { name: string; url: string; priority?: number }) =>
    request<any>(`/stations/${stationId}/sources`, { method: 'POST', body: JSON.stringify(data) }),
  updateSource: (stationId: string, sourceId: string, data: Record<string, any>) =>
    request<any>(`/stations/${stationId}/sources/${sourceId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSource: (stationId: string, sourceId: string) =>
    request<any>(`/stations/${stationId}/sources/${sourceId}`, { method: 'DELETE' }),

  // Playlist
  getPlaylist: (stationId: string) => request<any[]>(`/stations/${stationId}/playlist`),

  // Legacy single-request upload (for files under 500MB)
  uploadVideoSimple: (stationId: string, file: File, onProgress?: (pct: number, loaded: number, total: number) => void): Promise<any> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      const token = getToken();

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/stations/${stationId}/playlist/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 401) { handle401(); reject(new Error('Unauthorized')); return; }
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.onabort = () => reject(new Error('Upload aborted'));
      xhr.send(formData);
    });
  },

  // Chunked upload with pause/resume support (for large files)
  uploadVideoChunked: async (
    stationId: string,
    file: File,
    opts: {
      onProgress?: (pct: number, loaded: number, total: number, chunkIndex: number, totalChunks: number) => void;
      isPaused: () => boolean;       // callback to check if paused
      onPaused?: () => void;         // called when upload is actually paused
      signal?: AbortSignal;          // for cancel
    }
  ): Promise<any> => {
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const token = getToken();

    // 1) Init session
    const initResp = await fetch(`${API}/stations/${stationId}/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, chunkSize: CHUNK_SIZE }),
      signal: opts.signal,
    });
    if (initResp.status === 401) { handle401(); throw new Error('Unauthorized'); }
    const { sessionId } = await initResp.json();

    // 2) Upload chunks
    let uploadedBytes = 0;
    for (let i = 0; i < totalChunks; i++) {
      // Check pause
      while (opts.isPaused()) {
        opts.onPaused?.();
        await new Promise(r => setTimeout(r, 300));
        if (opts.signal?.aborted) throw new Error('Upload cancelled');
      }

      if (opts.signal?.aborted) throw new Error('Upload cancelled');

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append('file', chunk, `chunk_${i}`);

      // Upload chunk with retry (up to 3 retries)
      let retries = 0;
      while (retries < 3) {
        try {
          const resp = await fetch(`${API}/stations/${stationId}/upload/chunk/${sessionId}?index=${i}`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
            signal: opts.signal,
          });
          if (resp.status === 401) { handle401(); throw new Error('Unauthorized'); }
          if (!resp.ok) throw new Error(`Chunk ${i} failed: ${resp.status}`);
          break; // success
        } catch (err: any) {
          if (err.message === 'Upload cancelled' || opts.signal?.aborted) throw err;
          retries++;
          if (retries >= 3) throw new Error(`Chunk ${i} failed after 3 retries`);
          await new Promise(r => setTimeout(r, 2000 * retries)); // wait before retry
        }
      }

      uploadedBytes = end;
      const pct = Math.round((uploadedBytes / file.size) * 100);
      opts.onProgress?.(pct, uploadedBytes, file.size, i + 1, totalChunks);
    }

    // 3) Complete — merge on server
    opts.onProgress?.(100, file.size, file.size, totalChunks, totalChunks);
    const completeResp = await fetch(`${API}/stations/${stationId}/upload/complete/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: '{}',
      signal: opts.signal,
    });
    if (completeResp.status === 401) { handle401(); throw new Error('Unauthorized'); }
    return await completeResp.json();
  },

  // Smart upload: uses chunked for large files, simple for small ones
  uploadVideo: async (
    stationId: string,
    file: File,
    onProgress?: (pct: number, loaded: number, total: number) => void,
    pauseControl?: { isPaused: () => boolean; onPaused?: () => void; signal?: AbortSignal }
  ): Promise<any> => {
    const CHUNKED_THRESHOLD = 500 * 1024 * 1024; // 500MB

    if (file.size >= CHUNKED_THRESHOLD && pauseControl) {
      // Use chunked upload for large files
      return api.uploadVideoChunked(stationId, file, {
        onProgress: (pct, loaded, total) => onProgress?.(pct, loaded, total),
        isPaused: pauseControl.isPaused,
        onPaused: pauseControl.onPaused,
        signal: pauseControl.signal,
      });
    } else {
      // Use simple XHR upload for small files
      return api.uploadVideoSimple(stationId, file, onProgress);
    }
  },
  reorderPlaylist: (stationId: string, items: { id: string; sort_order: number; is_enabled?: number }[]) =>
    request<any>(`/stations/${stationId}/playlist/reorder`, { method: 'PUT', body: JSON.stringify({ items }) }),
  deletePlaylistItem: (stationId: string, itemId: string) =>
    request<any>(`/stations/${stationId}/playlist/${itemId}`, { method: 'DELETE' }),
  applyPlaylist: (stationId: string) =>
    request<any>(`/stations/${stationId}/playlist/apply`, { method: 'POST', body: JSON.stringify({}) }),

  // RTMP destinations
  addDestination: (stationId: string, data: { name: string; platform: string; rtmp_url: string; stream_key?: string }) =>
    request<any>(`/stations/${stationId}/destinations`, { method: 'POST', body: JSON.stringify(data) }),
  updateDestination: (stationId: string, destId: string, data: Record<string, any>) =>
    request<any>(`/stations/${stationId}/destinations/${destId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDestination: (stationId: string, destId: string) =>
    request<any>(`/stations/${stationId}/destinations/${destId}`, { method: 'DELETE' }),

  // Diagnostics
  testAudio: (url: string) => request<any>('/test/audio', { method: 'POST', body: JSON.stringify({ url }) }),
  testNowPlaying: (data: { mode: string; azuracast_url?: string; azuracast_station?: string; icecast_url?: string }) =>
    request<any>('/test/nowplaying', { method: 'POST', body: JSON.stringify(data) }),
  testRtmp: (data: { rtmp_url: string; stream_key?: string }) =>
    request<any>('/test/rtmp', { method: 'POST', body: JSON.stringify(data) }),
  healthCheck: (stationId: string) => request<any>(`/stations/${stationId}/healthcheck`, { method: 'POST', body: JSON.stringify({}) }),
  testTelegram: (stationId: string) => request<any>(`/stations/${stationId}/test/telegram`, { method: 'POST', body: JSON.stringify({}) }),

  // Preview
  getPreviewUrl: (stationId: string) => `${API}/stations/${stationId}/preview?t=${Date.now()}`,

  // Logs
  getLogs: (stationId: string, limit = 100) => request<any[]>(`/stations/${stationId}/logs?limit=${limit}`),
  exportLogsCsv: async (stationId: string, level?: string) => {
    const token = getToken();
    const params = level ? `?level=${level}` : '';
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API}/stations/${stationId}/logs/export${params}`, { headers });
    if (res.status === 401) { handle401(); throw new Error('Session expired'); }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `logs-${stationId}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Fonts
  getFonts: () => request<{ system: any[]; google: any[]; custom: any[] }>('/fonts'),
  uploadFont: async (file: File) => {
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API}/fonts/upload`, { method: 'POST', headers, body: formData });
    if (res.status === 401) { handle401(); throw new Error('Session expired'); }
    return res.json();
  },
  deleteFont: (filename: string) => request<any>(`/fonts/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  // System
  getSystemHealth: () => request<any>('/system/health'),
};
