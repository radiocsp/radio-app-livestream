import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatBytes, statusColor, formatUptime } from '../lib/utils';
import { Station, AudioSource, PlaylistItem, RtmpDestination, StationLog } from '../types';
import { useInterval } from '../hooks/useSSE';
import {
  ArrowLeft, Play, Square, RotateCw, Upload, Trash2, GripVertical,
  Eye, EyeOff, TestTube, Radio, Wifi, WifiOff, Image, RefreshCw,
  ChevronDown, ChevronUp, Settings, Music, Tv, Send, ScrollText,
  Stethoscope, Palette, Globe, Download, AlertTriangle, Filter
} from 'lucide-react';

interface Props {
  sse: { events: any[]; connected: boolean; getStationEvents: (id: string) => any[] };
}

type Tab = 'playlist' | 'sources' | 'destinations' | 'overlay' | 'logs' | 'diagnostics' | 'settings';

export default function StationDetail({ sse }: Props) {
  const { id } = useParams<{ id: string }>();
  const [station, setStation] = useState<Station | null>(null);
  const [sources, setSources] = useState<AudioSource[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [destinations, setDestinations] = useState<RtmpDestination[]>([]);
  const [logs, setLogs] = useState<StationLog[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'errors'>('all');
  const [tab, setTab] = useState<Tab>('playlist');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    if (!id) return;
    api.getStation(id).then((data: any) => {
      if (data.station) {
        setStation({ ...data.station, runtime: data.runtime });
        setSources(data.sources || []);
        setPlaylist(data.playlist || []);
        setDestinations(data.destinations || []);
      }
    }).catch(() => {});
  };

  useEffect(() => { load(); }, [id]);
  useInterval(load, 5000);

  useEffect(() => {
    if (id && tab === 'logs') {
      api.getLogs(id, 200).then(setLogs).catch(() => {});
    }
  }, [id, tab]);

  // Also update logs from SSE
  useEffect(() => {
    if (!id) return;
    const stationEvents = sse.getStationEvents(id);
    const logEvents = stationEvents.filter(e => e.type === 'log').map((e, i) => ({
      id: -(i + 1),
      station_id: id,
      level: e.level || 'info',
      source: e.source || 'app',
      message: e.message || '',
      created_at: e.timestamp || new Date().toISOString(),
    }));
    if (logEvents.length > 0) {
      setLogs(prev => [...logEvents, ...prev].slice(0, 500));
    }
  }, [sse.events, id]);

  if (!station || !id) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading station...</p>
      </div>
    );
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await api.uploadVideo(id, file);
    }
    setUploading(false);
    load();
  };

  const moveItem = async (index: number, direction: 'up' | 'down') => {
    const items = [...playlist];
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    [items[index], items[swapIdx]] = [items[swapIdx], items[index]];
    const reordered = items.map((item, i) => ({ id: item.id, sort_order: i }));
    await api.reorderPlaylist(id, reordered);
    load();
  };

  const deletePlaylistItem = async (itemId: string) => {
    await api.deletePlaylistItem(id, itemId);
    load();
  };

  const togglePlaylistItem = async (item: PlaylistItem) => {
    const reordered = playlist.map(p => ({
      id: p.id,
      sort_order: p.sort_order,
      is_enabled: p.id === item.id ? (item.is_enabled ? 0 : 1) : p.is_enabled,
    }));
    await api.reorderPlaylist(id, reordered);
    load();
  };

  const applyPlaylist = async () => {
    await api.applyPlaylist(id);
    load();
  };

  const generatePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewUrl(null);
    try {
      const url = api.getPreviewUrl(id);
      const token = localStorage.getItem('rss_token') || sessionStorage.getItem('rss_token');
      const res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Server returned ${res.status}`);
      }
      const blob = await res.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setPreviewError(err.message || 'Failed to generate preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const updateStation = async (data: Record<string, any>) => {
    await api.updateStation(id, data);
    load();
  };

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'playlist', label: 'Playlist', icon: Tv },
    { key: 'sources', label: 'Audio Sources', icon: Music },
    { key: 'destinations', label: 'RTMP Destinations', icon: Send },
    { key: 'overlay', label: 'Overlay', icon: Palette },
    { key: 'logs', label: 'Logs', icon: ScrollText },
    { key: 'diagnostics', label: 'Diagnostics', icon: Stethoscope },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/" className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{station.name}</h1>
          <p className="text-sm text-gray-500">/{station.slug}</p>
        </div>
        <span className={statusColor(station.runtime?.status || station.status)}>
          {station.runtime?.status || station.status}
        </span>
        {station.runtime?.uptime != null && (
          <span className="text-xs text-gray-500">Up {formatUptime(station.runtime.uptime)}</span>
        )}
      </div>

      {/* Controls */}
      <div className="card flex items-center gap-3 flex-wrap">
        <button onClick={() => api.startStation(id).then(load)} className="btn-success flex items-center gap-2">
          <Play className="w-4 h-4" /> Start
        </button>
        <button onClick={() => api.stopStation(id).then(load)} className="btn-danger flex items-center gap-2">
          <Square className="w-4 h-4" /> Stop
        </button>
        <button onClick={() => api.restartStation(id).then(load)} className="btn-secondary flex items-center gap-2">
          <RotateCw className="w-4 h-4" /> Restart
        </button>
        <div className="flex-1" />
        <button onClick={generatePreview} disabled={previewLoading} className="btn-secondary flex items-center gap-2">
               <Image className="w-4 h-4" /> {previewLoading ? 'Generating...' : 'Preview Snapshot'}
              </button>
      </div>

      {/* Preview */}
      {previewLoading && (
        <div className="card text-center py-8">
          <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-gray-400 text-sm">Generating preview with FFmpeg...</p>
        </div>
      )}
      {previewError && (
        <div className="card bg-red-900/20 border border-red-800">
          <p className="text-red-400 text-sm">✗ Preview failed: {previewError}</p>
          <p className="text-gray-500 text-xs mt-1">Make sure a playlist with videos is configured and FFmpeg is available.</p>
        </div>
      )}
      {previewUrl && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Preview</h3>
                <button onClick={() => { setPreviewUrl(null); setPreviewError(null); }} className="text-gray-600 hover:text-gray-400">✕</button>
              </div>
          <img src={previewUrl} alt="Station preview" className="w-full rounded-lg border border-gray-800" />
              </div>
      )}      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-800 pb-px">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'bg-gray-800 text-white border-b-2 border-brand-500'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {/* ─── PLAYLIST ──────────────────────────── */}
        {tab === 'playlist' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input ref={fileInputRef} type="file" accept="video/mp4,video/*" multiple className="hidden" onChange={handleUpload} title="Upload video files" />
              <button onClick={() => fileInputRef.current?.click()} className="btn-primary flex items-center gap-2" disabled={uploading}>
                <Upload className="w-4 h-4" /> {uploading ? 'Uploading...' : 'Upload MP4'}
              </button>
              <button onClick={applyPlaylist} className="btn-success flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Apply & Restart Stream
              </button>
              <span className="text-xs text-gray-500">{playlist.filter(p => p.is_enabled).length} active • {playlist.length} total</span>
            </div>

            {playlist.length === 0 ? (
              <div className="card text-center py-12">
                <Tv className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500">No videos in playlist. Upload MP4 files above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {playlist.map((item, index) => (
                  <div key={item.id} className={`card flex items-center gap-3 ${!item.is_enabled ? 'opacity-50' : ''}`}>
                    <GripVertical className="w-4 h-4 text-gray-600 cursor-grab" />
                    <span className="text-xs text-gray-600 w-6">{index + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{item.original_name}</p>
                      <p className="text-xs text-gray-500">{formatBytes(item.file_size)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => moveItem(index, 'up')} disabled={index === 0}
                        title="Move up" className="p-1 rounded hover:bg-gray-800 text-gray-500 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                      <button onClick={() => moveItem(index, 'down')} disabled={index === playlist.length - 1}
                        title="Move down" className="p-1 rounded hover:bg-gray-800 text-gray-500 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                      <button onClick={() => togglePlaylistItem(item)}
                        title="Toggle visibility" className="p-1 rounded hover:bg-gray-800 text-gray-500">{item.is_enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                      <button onClick={() => deletePlaylistItem(item.id)}
                        title="Delete item" className="p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── AUDIO SOURCES ─────────────────────── */}
        {tab === 'sources' && <SourcesTab stationId={id} sources={sources} reload={load} />}

        {/* ─── RTMP DESTINATIONS ─────────────────── */}
        {tab === 'destinations' && <DestinationsTab stationId={id} destinations={destinations} reload={load} />}

        {/* ─── OVERLAY ───────────────────────────── */}
        {tab === 'overlay' && <OverlayTab station={station} updateStation={updateStation} />}

        {/* ─── LOGS ──────────────────────────────── */}
        {tab === 'logs' && (() => {
          const errorLogs = logs.filter(l => l.level === 'error' || l.level === 'warn');
          const displayLogs = logFilter === 'errors' ? errorLogs : logs;

          return (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLogFilter('all')}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                      logFilter === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    <ScrollText className="w-3.5 h-3.5 inline mr-1" />
                    All Logs ({logs.length})
                  </button>
                  <button
                    onClick={() => setLogFilter('errors')}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                      logFilter === 'errors'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                    Errors & Warnings ({errorLogs.length})
                  </button>
                </div>
                <button
                  onClick={() => id && api.exportLogsCsv(id, logFilter === 'errors' ? 'error' : undefined)}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition flex items-center gap-1.5"
                  title="Export logs as CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>

              {/* Error summary banner */}
              {errorLogs.length > 0 && logFilter === 'all' && (
                <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-red-300 text-sm font-medium">
                      {errorLogs.filter(l => l.level === 'error').length} error(s), {errorLogs.filter(l => l.level === 'warn').length} warning(s) detected
                    </p>
                    <p className="text-red-400/70 text-xs mt-1">
                      Last error: {errorLogs[0] ? new Date(errorLogs[0].created_at).toLocaleString() : '—'}
                      {errorLogs[0] && <span className="ml-2">— {errorLogs[0].message.slice(0, 120)}{errorLogs[0].message.length > 120 ? '…' : ''}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => setLogFilter('errors')}
                    className="text-red-400 hover:text-red-300 text-xs underline shrink-0"
                  >
                    View all errors →
                  </button>
                </div>
              )}

              {/* Log entries */}
              <div className="card max-h-[600px] overflow-y-auto font-mono text-xs">
                {displayLogs.length === 0 ? (
                  <p className="text-gray-600 p-4">
                    {logFilter === 'errors' ? 'No errors or warnings 🎉' : 'No logs yet'}
                  </p>
                ) : (
                  displayLogs.map((log, i) => (
                    <div key={log.id || i} className={`log-line flex gap-3 ${
                      log.level === 'error' ? 'text-red-400 bg-red-950/20' : log.level === 'warn' ? 'text-amber-400 bg-amber-950/10' : 'text-gray-400'
                    }`}>
                      <span className="text-gray-600 shrink-0">{new Date(log.created_at).toLocaleTimeString()}</span>
                      <span className={`shrink-0 w-12 ${
                        log.level === 'error' ? 'text-red-500 font-bold' : log.level === 'warn' ? 'text-amber-500 font-bold' : 'text-gray-600'
                      }`}>{log.level}</span>
                      <span className="text-gray-600 shrink-0 w-16">[{log.source}]</span>
                      <span className="break-all">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })()}

        {/* ─── DIAGNOSTICS ───────────────────────── */}
        {tab === 'diagnostics' && <DiagnosticsTab station={station} sources={sources} destinations={destinations} />}

        {/* ─── SETTINGS ──────────────────────────── */}
        {tab === 'settings' && <SettingsTab station={station} updateStation={updateStation} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════ */

function SourcesTab({ stationId, sources, reload }: { stationId: string; sources: AudioSource[]; reload: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [priority, setPriority] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const add = async () => {
    if (!name || !url) return;
    await api.addSource(stationId, { name, url, priority });
    setName(''); setUrl(''); setPriority(0);
    reload();
  };

  const testSource = async (sourceId: string, sourceUrl: string) => {
    setTesting(sourceId);
    setTestResult(prev => ({ ...prev, [sourceId]: { ok: false, msg: 'Testing...' } }));
    try {
      const result = await api.testAudio(sourceUrl);
      setTestResult(prev => ({
        ...prev,
        [sourceId]: {
          ok: result.success || result.reachable,
          msg: result.success || result.reachable
            ? `✅ Reachable${result.latency_ms ? ` (${result.latency_ms}ms)` : ''}${result.codec ? ` — ${result.codec}` : ''}`
            : `❌ ${result.error || 'Unreachable'}`
        }
      }));
    } catch (err: any) {
      setTestResult(prev => ({ ...prev, [sourceId]: { ok: false, msg: `❌ ${err.message}` } }));
    }
    setTesting(null);
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Add Audio Source</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="input-field" placeholder="Source Name" value={name} onChange={e => setName(e.target.value)} />
          <input className="input-field md:col-span-2" placeholder="Icecast/AzuraCast URL" value={url} onChange={e => setUrl(e.target.value)} />
          <div className="flex gap-2">
            <input className="input-field w-20" type="number" placeholder="Priority" value={priority} onChange={e => setPriority(Number(e.target.value))} />
            <button onClick={add} className="btn-primary whitespace-nowrap" disabled={!name || !url}>Add</button>
          </div>
        </div>

        {/* URL Examples */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-400">📡 Supported URL formats:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <p className="text-[11px] text-indigo-400 font-medium">Icecast / Shoutcast:</p>
              <p className="text-[11px] text-gray-500 font-mono">http://your-server:8000/stream</p>
              <p className="text-[11px] text-gray-500 font-mono">https://cast.example.com/radio.mp3</p>
            </div>
            <div>
              <p className="text-[11px] text-indigo-400 font-medium">AzuraCast:</p>
              <p className="text-[11px] text-gray-500 font-mono">https://radio.example.com/listen/station/radio.mp3</p>
              <p className="text-[11px] text-gray-500 font-mono">https://radio.example.com/api/nowplaying/1</p>
            </div>
            <div>
              <p className="text-[11px] text-indigo-400 font-medium">Direct stream:</p>
              <p className="text-[11px] text-gray-500 font-mono">http://stream.example.com:8080/live.aac</p>
            </div>
            <div>
              <p className="text-[11px] text-indigo-400 font-medium">HLS / M3U8:</p>
              <p className="text-[11px] text-gray-500 font-mono">https://example.com/stream/playlist.m3u8</p>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">💡 Priority: lower number = higher priority (0 = primary, 1 = fallback). After adding, use the Test button to verify connectivity.</p>
        </div>
      </div>

      {sources.map(src => (
        <div key={src.id} className="card space-y-2">
          <div className={`flex items-center gap-4 ${!src.is_enabled ? 'opacity-50' : ''}`}>
            <div className={`w-2 h-2 rounded-full ${src.status === 'healthy' ? 'bg-emerald-400' : src.status === 'unreachable' ? 'bg-red-400' : 'bg-gray-600'}`} />
            <div className="flex-1">
              <p className="text-sm font-medium text-white">{src.name}</p>
              <p className="text-xs text-gray-500 font-mono truncate">{src.url}</p>
            </div>
            <span className="text-xs text-gray-500">P{src.priority}</span>
            {src.last_latency_ms != null && <span className="text-xs text-gray-500">{src.last_latency_ms}ms</span>}
            <button
              onClick={() => testSource(src.id, src.url)}
              disabled={testing === src.id}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 disabled:opacity-50 transition whitespace-nowrap"
            >
              {testing === src.id ? '⏳ Testing...' : '🔍 Test'}
            </button>
            <button onClick={async () => { await api.updateSource(stationId, src.id, { is_enabled: src.is_enabled ? 0 : 1 }); reload(); }}
              title="Toggle source" className="p-1.5 rounded hover:bg-gray-800 text-gray-500">{src.is_enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
            <button onClick={async () => { await api.deleteSource(stationId, src.id); reload(); }}
              title="Delete source" className="p-1.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
          </div>
          {testResult[src.id] && (
            <div className={`text-xs px-3 py-1.5 rounded-md ${testResult[src.id].ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {testResult[src.id].msg}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DestinationsTab({ stationId, destinations, reload }: { stationId: string; destinations: RtmpDestination[]; reload: () => void }) {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('youtube');
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');

  const add = async () => {
    if (!name || !rtmpUrl) return;
    await api.addDestination(stationId, { name, platform, rtmp_url: rtmpUrl, stream_key: streamKey });
    setName(''); setRtmpUrl(''); setStreamKey('');
    reload();
  };

  const platformPresets: Record<string, string> = {
    youtube: 'rtmp://a.rtmp.youtube.com/live2',
    facebook: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    restream: 'rtmp://live.restream.io/live',
    custom: '',
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Add RTMP Destination</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="input-field" placeholder="Destination Name" value={name} onChange={e => setName(e.target.value)} />
          <select className="select-field" title="Platform" value={platform} onChange={e => { setPlatform(e.target.value); setRtmpUrl(platformPresets[e.target.value] || ''); }}>
            <option value="youtube">YouTube</option>
            <option value="facebook">Facebook</option>
            <option value="restream">Restream</option>
            <option value="custom">Custom RTMP</option>
          </select>
          <input className="input-field" placeholder="RTMP URL" value={rtmpUrl} onChange={e => setRtmpUrl(e.target.value)} />
          <div className="flex gap-2">
            <input className="input-field" placeholder="Stream Key" value={streamKey} onChange={e => setStreamKey(e.target.value)} type="password" />
            <button onClick={add} className="btn-primary whitespace-nowrap" disabled={!name || !rtmpUrl}>Add</button>
          </div>
        </div>
      </div>

      {destinations.map(dest => (
        <div key={dest.id} className={`card flex items-center gap-4 ${!dest.is_enabled ? 'opacity-50' : ''}`}>
          <Globe className={`w-5 h-5 ${dest.status === 'connected' ? 'text-emerald-400' : dest.status === 'error' ? 'text-red-400' : 'text-gray-500'}`} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-white">{dest.name}</p>
              <span className="badge-blue">{dest.platform}</span>
            </div>
            <p className="text-xs text-gray-500 font-mono truncate">{dest.rtmp_url}</p>
          </div>
          <span className={statusColor(dest.status)}>{dest.status}</span>
          <button onClick={async () => { await api.updateDestination(stationId, dest.id, { is_enabled: dest.is_enabled ? 0 : 1 }); reload(); }}
            title="Toggle destination" className="p-1.5 rounded hover:bg-gray-800 text-gray-500">{dest.is_enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
          <button onClick={async () => { await api.deleteDestination(stationId, dest.id); reload(); }}
            title="Delete destination" className="p-1.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
}

function OverlayTab({ station, updateStation }: { station: Station; updateStation: (data: Record<string, any>) => Promise<void> }) {
  const [fontSize, setFontSize] = useState(station.overlay_font_size);
  const [fontColor, setFontColor] = useState(station.overlay_font_color);
  const [fontFamily, setFontFamily] = useState(station.overlay_font_family || '');
  const [bgColor, setBgColor] = useState(station.overlay_bg_color);
  const [position, setPosition] = useState(station.overlay_position);
  const [enabled, setEnabled] = useState(!!station.overlay_enabled);
  const [shadowX, setShadowX] = useState(station.overlay_shadow_x);
  const [shadowY, setShadowY] = useState(station.overlay_shadow_y);
  const [outlineW, setOutlineW] = useState(station.overlay_outline_width);
  const [marginX, setMarginX] = useState(station.overlay_margin_x);
  const [marginY, setMarginY] = useState(station.overlay_margin_y);
  const [overlayTitle, setOverlayTitle] = useState(station.overlay_title || '');
  const [titleFontSize, setTitleFontSize] = useState(station.overlay_title_font_size || 22);
  const [titleFontColor, setTitleFontColor] = useState(station.overlay_title_font_color || 'yellow');
  const [npMode, setNpMode] = useState(station.np_mode);
  const [azUrl, setAzUrl] = useState(station.np_azuracast_url);
  const [azStation, setAzStation] = useState(station.np_azuracast_station);
  const [iceUrl, setIceUrl] = useState(station.np_icecast_url);

  const save = () => updateStation({
    overlay_enabled: enabled ? 1 : 0,
    overlay_font_size: fontSize,
    overlay_font_color: fontColor,
    overlay_font_family: fontFamily,
    overlay_bg_color: bgColor,
    overlay_position: position,
    overlay_shadow_x: shadowX,
    overlay_shadow_y: shadowY,
    overlay_outline_width: outlineW,
    overlay_margin_x: marginX,
    overlay_margin_y: marginY,
    overlay_title: overlayTitle,
    overlay_title_font_size: titleFontSize,
    overlay_title_font_color: titleFontColor,
    np_mode: npMode,
    np_azuracast_url: azUrl,
    np_azuracast_station: azStation,
    np_icecast_url: iceUrl,
  });

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Now Playing Overlay</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="rounded" />
            <span className="text-sm text-gray-300">Enabled</span>
          </label>
        </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Position</label>
              <select className="select-field" title="Position" value={position} onChange={e => setPosition(e.target.value)}>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-center">Bottom Center</option>
                <option value="bottom-right">Bottom Right</option>
                <option value="top-left">Top Left</option>
                <option value="top-center">Top Center</option>
                <option value="top-right">Top Right</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Font Family</label>
              <select className="select-field" title="Font Family" value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
                <option value="">System Default</option>
                <option value="DejaVu Sans">DejaVu Sans</option>
                <option value="DejaVu Sans Mono">DejaVu Sans Mono</option>
                <option value="DejaVu Serif">DejaVu Serif</option>
                <option value="Liberation Sans">Liberation Sans (Arial-like)</option>
                <option value="Liberation Serif">Liberation Serif (Times-like)</option>
                <option value="Liberation Mono">Liberation Mono (Courier-like)</option>
                <option value="Noto Sans">Noto Sans</option>
                <option value="Noto Serif">Noto Serif</option>
                <option value="FreeSans">FreeSans</option>
                <option value="FreeSerif">FreeSerif</option>
                <option value="FreeMono">FreeMono</option>
              </select>
              <p className="text-[10px] text-gray-600 mt-1">Fonts disponibile pe server Docker. Pentru fonturi custom, uploadează .ttf și specifică în Font File.</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Font File (opțional, cale .ttf)</label>
              <input className="input-field" value={station.overlay_font_file} placeholder="/app/uploads/fonts/custom.ttf" disabled title="Custom font file path" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Track Font Size</label>
              <input className="input-field" type="number" title="Font Size" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Track Font Color</label>
              <input className="input-field" value={fontColor} onChange={e => setFontColor(e.target.value)} placeholder="white" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Background Color</label>
              <input className="input-field" value={bgColor} onChange={e => setBgColor(e.target.value)} placeholder="black@0.6" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Shadow X / Y</label>
              <div className="flex gap-2">
                <input className="input-field" type="number" title="Shadow X" value={shadowX} onChange={e => setShadowX(Number(e.target.value))} />
                <input className="input-field" type="number" title="Shadow Y" value={shadowY} onChange={e => setShadowY(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Outline Width</label>
              <input className="input-field" type="number" title="Outline Width" value={outlineW} onChange={e => setOutlineW(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Margin X</label>
              <input className="input-field" type="number" title="Margin X" value={marginX} onChange={e => setMarginX(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Margin Y</label>
              <input className="input-field" type="number" title="Margin Y" value={marginY} onChange={e => setMarginY(Number(e.target.value))} />
            </div>
          </div>
        </div>

        {/* Title Label Settings */}
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">🏷️ Title Label (deasupra track-ului)</h3>
          <p className="text-xs text-gray-500">Adaugă un titlu fix deasupra numelui melodiei, ex: &quot;Ascultă acum:&quot; sau &quot;🎵 Now Playing:&quot;</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Title Text</label>
              <input className="input-field" value={overlayTitle} onChange={e => setOverlayTitle(e.target.value)} placeholder="Ascultă acum:" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Title Font Size</label>
              <input className="input-field" type="number" title="Title Font Size" value={titleFontSize} onChange={e => setTitleFontSize(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Title Font Color</label>
              <input className="input-field" value={titleFontColor} onChange={e => setTitleFontColor(e.target.value)} placeholder="yellow" />
            </div>
          </div>
        </div>      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Now Playing Source</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Mode</label>
            <select className="select-field" title="Now Playing Mode" value={npMode} onChange={e => setNpMode(e.target.value)}>
              <option value="azuracast">AzuraCast API</option>
              <option value="icecast">Icecast status-json.xsl</option>
            </select>
          </div>
          {npMode === 'azuracast' && (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">AzuraCast Base URL</label>
                <input className="input-field" value={azUrl} onChange={e => setAzUrl(e.target.value)} placeholder="https://radio.example.com" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Station ID / Short Name</label>
                <input className="input-field" value={azStation} onChange={e => setAzStation(e.target.value)} placeholder="1 or station_name" />
              </div>
            </>
          )}
          {npMode === 'icecast' && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Icecast status-json.xsl URL</label>
              <input className="input-field" value={iceUrl} onChange={e => setIceUrl(e.target.value)} placeholder="http://host:8000/status-json.xsl" />
            </div>
          )}
        </div>
      </div>

      <button onClick={save} className="btn-primary">Save Overlay Settings</button>
    </div>
  );
}

function DiagnosticsTab({ station, sources, destinations }: { station: Station; sources: AudioSource[]; destinations: RtmpDestination[] }) {
  const [audioResult, setAudioResult] = useState<any>(null);
  const [npResult, setNpResult] = useState<any>(null);
  const [rtmpResult, setRtmpResult] = useState<any>(null);
  const [testing, setTesting] = useState('');

  const testAudio = async (url: string) => {
    setTesting('audio');
    const result = await api.testAudio(url);
    setAudioResult(result);
    setTesting('');
  };

  const testNP = async () => {
    setTesting('np');
    const result = await api.testNowPlaying({
      mode: station.np_mode,
      azuracast_url: station.np_azuracast_url,
      azuracast_station: station.np_azuracast_station,
      icecast_url: station.np_icecast_url,
    });
    setNpResult(result);
    setTesting('');
  };

  const testRtmp = async (dest: RtmpDestination) => {
    setTesting('rtmp');
    const result = await api.testRtmp({ rtmp_url: dest.rtmp_url, stream_key: dest.stream_key });
    setRtmpResult(result);
    setTesting('');
  };

  return (
    <div className="space-y-4">
      {/* Test Audio Sources */}
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Wifi className="w-4 h-4" /> Test Audio Source
        </h3>
        {sources.map(src => (
          <div key={src.id} className="flex items-center gap-3">
            <span className="text-sm text-gray-300 flex-1">{src.name}: <code className="text-xs text-gray-500">{src.url}</code></span>
            <button onClick={() => testAudio(src.url)} className="btn-secondary text-xs" disabled={testing === 'audio'}>
              <TestTube className="w-3 h-3 inline mr-1" /> {testing === 'audio' ? 'Testing...' : 'Test'}
            </button>
          </div>
        ))}
        {audioResult && (
          <div className={`p-3 rounded-lg text-sm font-mono ${audioResult.reachable ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {audioResult.reachable ? `✓ Reachable (${audioResult.latencyMs}ms)` : `✗ Unreachable: ${audioResult.error}`}
          </div>
        )}
      </div>

      {/* Test Now Playing */}
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Music className="w-4 h-4" /> Test Now Playing
        </h3>
        <button onClick={testNP} className="btn-secondary text-xs" disabled={testing === 'np'}>
          <TestTube className="w-3 h-3 inline mr-1" /> {testing === 'np' ? 'Testing...' : 'Test Now Playing'}
        </button>
        {npResult && (
          <div className={`p-3 rounded-lg text-sm ${npResult.success ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
            {npResult.success ? (
              <>
                <p className="text-emerald-400 font-medium">✓ Track: {npResult.track || '(empty)'}</p>
                <pre className="text-xs text-gray-500 mt-2 overflow-auto max-h-40">{JSON.stringify(npResult.raw, null, 2)}</pre>
              </>
            ) : (
              <p className="text-red-400">✗ Error: {npResult.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Test RTMP */}
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Send className="w-4 h-4" /> Test RTMP (10 sec)
        </h3>
        {destinations.map(dest => (
          <div key={dest.id} className="flex items-center gap-3">
            <span className="text-sm text-gray-300 flex-1">{dest.name} ({dest.platform})</span>
            <button onClick={() => testRtmp(dest)} className="btn-secondary text-xs" disabled={testing === 'rtmp'}>
              <TestTube className="w-3 h-3 inline mr-1" /> {testing === 'rtmp' ? 'Testing...' : 'Test 10s'}
            </button>
          </div>
        ))}
        {rtmpResult && (
          <div className={`p-3 rounded-lg text-sm font-mono ${rtmpResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {rtmpResult.success ? '✓ RTMP test stream sent successfully' : `✗ Failed: ${rtmpResult.error?.slice(0, 300)}`}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsTab({ station, updateStation }: { station: Station; updateStation: (data: Record<string, any>) => Promise<void> }) {
  const [width, setWidth] = useState(station.video_width);
  const [height, setHeight] = useState(station.video_height);
  const [vBitrate, setVBitrate] = useState(station.video_bitrate);
  const [fps, setFps] = useState(station.video_fps);
  const [aBitrate, setABitrate] = useState(station.audio_bitrate);
  const [autoRestart, setAutoRestart] = useState(!!station.auto_restart);
  const [restartDelay, setRestartDelay] = useState(station.restart_delay_sec);
  const [maxAttempts, setMaxAttempts] = useState(station.max_restart_attempts);

  const save = () => updateStation({
    video_width: width, video_height: height, video_bitrate: vBitrate,
    video_fps: fps, audio_bitrate: aBitrate,
    auto_restart: autoRestart ? 1 : 0, restart_delay_sec: restartDelay,
    max_restart_attempts: maxAttempts,
  });

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Video Output</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Resolution</label>
            <div className="flex gap-2">
              <input className="input-field" type="number" value={width} onChange={e => setWidth(Number(e.target.value))} placeholder="1920" />
              <span className="text-gray-500 self-center">×</span>
              <input className="input-field" type="number" value={height} onChange={e => setHeight(Number(e.target.value))} placeholder="1080" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Video Bitrate</label>
            <input className="input-field" value={vBitrate} onChange={e => setVBitrate(e.target.value)} placeholder="4000k" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">FPS</label>
            <input className="input-field" type="number" title="FPS" value={fps} onChange={e => setFps(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Audio Bitrate</label>
            <input className="input-field" value={aBitrate} onChange={e => setABitrate(e.target.value)} placeholder="192k" />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Auto-Restart</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoRestart} onChange={e => setAutoRestart(e.target.checked)} className="rounded" />
            <span className="text-sm text-gray-300">Enable auto-restart</span>
          </label>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Restart Delay (sec)</label>
            <input className="input-field" type="number" title="Restart Delay" value={restartDelay} onChange={e => setRestartDelay(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Max Attempts</label>
            <input className="input-field" type="number" title="Max Attempts" value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))} />
          </div>
        </div>
      </div>

      <button onClick={save} className="btn-primary">Save Settings</button>
    </div>
  );
}
