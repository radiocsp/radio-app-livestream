const API = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
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
  startStation: (id: string) => request<any>(`/stations/${id}/start`, { method: 'POST' }),
  stopStation: (id: string) => request<any>(`/stations/${id}/stop`, { method: 'POST' }),
  restartStation: (id: string) => request<any>(`/stations/${id}/restart`, { method: 'POST' }),

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
    const res = await fetch(`${API}/stations/${stationId}/playlist/upload`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  reorderPlaylist: (stationId: string, items: { id: string; sort_order: number; is_enabled?: number }[]) =>
    request<any>(`/stations/${stationId}/playlist/reorder`, { method: 'PUT', body: JSON.stringify({ items }) }),
  deletePlaylistItem: (stationId: string, itemId: string) =>
    request<any>(`/stations/${stationId}/playlist/${itemId}`, { method: 'DELETE' }),
  applyPlaylist: (stationId: string) =>
    request<any>(`/stations/${stationId}/playlist/apply`, { method: 'POST' }),

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
  healthCheck: (stationId: string) => request<any>(`/stations/${stationId}/healthcheck`, { method: 'POST' }),

  // Preview
  getPreviewUrl: (stationId: string) => `${API}/stations/${stationId}/preview?t=${Date.now()}`,

  // Logs
  getLogs: (stationId: string, limit = 100) => request<any[]>(`/stations/${stationId}/logs?limit=${limit}`),

  // System
  getSystemHealth: () => request<any>('/system/health'),
};
