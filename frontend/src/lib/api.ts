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
  uploadVideo: async (stationId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const token = getToken();
    const res = await fetch(`${API}/stations/${stationId}/playlist/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (res.status === 401) { handle401(); throw new Error('Unauthorized'); }
    return res.json();
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

  // System
  getSystemHealth: () => request<any>('/system/health'),
};
