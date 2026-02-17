import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatBytes, formatUptime, statusColor } from '../lib/utils';
import { Station, SystemHealth } from '../types';
import { useInterval } from '../hooks/useSSE';
import {
  Plus, Radio, Cpu, HardDrive, MemoryStick, Activity,
  Play, Square, RotateCw, ChevronRight, Trash2
} from 'lucide-react';

interface DashboardProps {
  sse: { events: any[]; connected: boolean; getStationEvents: (id: string) => any[] };
}

export default function Dashboard({ sse }: DashboardProps) {
  const [stations, setStations] = useState<Station[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');

  const loadStations = () => api.getStations().then(setStations).catch(() => {});
  const loadHealth = () => api.getSystemHealth().then(setHealth).catch(() => {});

  useEffect(() => { loadStations(); loadHealth(); }, []);
  useInterval(loadStations, 5000);
  useInterval(loadHealth, 10000);

  const createStation = async () => {
    if (!newName || !newSlug) return;
    await api.createStation({ name: newName, slug: newSlug });
    setNewName(''); setNewSlug(''); setShowCreate(false);
    loadStations();
  };

  const deleteStation = async (id: string) => {
    if (!confirm('Delete this station and all its data?')) return;
    await api.deleteStation(id);
    loadStations();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {stations.length} station{stations.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Station
        </button>
      </div>

      {/* System Health */}
      {health && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">CPU</p>
              <p className="text-lg font-semibold text-white">{health.cpu.usagePercent}%</p>
              <p className="text-[10px] text-gray-600">{health.cpu.count} cores</p>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <MemoryStick className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Memory</p>
              <p className="text-lg font-semibold text-white">{health.memory.usagePercent}%</p>
              <p className="text-[10px] text-gray-600">{formatBytes(health.memory.usedBytes)} / {formatBytes(health.memory.totalBytes)}</p>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Disk</p>
              <p className="text-lg font-semibold text-white">{health.disk.usagePercent}%</p>
              <p className="text-[10px] text-gray-600">{formatBytes(health.disk.freeBytes)} free</p>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Uptime</p>
              <p className="text-lg font-semibold text-white">{formatUptime(health.uptime)}</p>
              <p className="text-[10px] text-gray-600">{health.hostname}</p>
            </div>
          </div>
        </div>
      )}

      {/* Create Station Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Create New Station</h2>
            <div className="space-y-3">
              <input className="input-field" placeholder="Station Name (e.g. My Radio)" value={newName}
                onChange={e => { setNewName(e.target.value); setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')); }} />
              <input className="input-field" placeholder="Slug (e.g. my-radio)" value={newSlug}
                onChange={e => setNewSlug(e.target.value)} />
            </div>
            <div className="flex gap-3 mt-5 justify-end">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button onClick={createStation} className="btn-primary" disabled={!newName || !newSlug}>Create Station</button>
            </div>
          </div>
        </div>
      )}

      {/* Station Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stations.map(station => (
          <div key={station.id} className="card-hover group relative">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  station.runtime?.status === 'running' ? 'bg-emerald-500/20' : 'bg-gray-800'
                }`}>
                  <Radio className={`w-4 h-4 ${station.runtime?.status === 'running' ? 'text-emerald-400' : 'text-gray-500'}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{station.name}</h3>
                  <p className="text-xs text-gray-500">/{station.slug}</p>
                </div>
              </div>
              <span className={statusColor(station.runtime?.status || station.status)}>
                {station.runtime?.status || station.status}
              </span>
            </div>

            {station.runtime?.uptime != null && (
              <p className="text-xs text-gray-500 mb-3">Uptime: {formatUptime(station.runtime.uptime)}</p>
            )}

            <div className="flex items-center justify-between mt-4">
              <div className="flex gap-2">
                <button onClick={() => api.startStation(station.id).then(loadStations)}
                  className="p-1.5 rounded-md hover:bg-emerald-500/20 text-emerald-400 transition-colors" title="Start">
                  <Play className="w-4 h-4" />
                </button>
                <button onClick={() => api.stopStation(station.id).then(loadStations)}
                  className="p-1.5 rounded-md hover:bg-red-500/20 text-red-400 transition-colors" title="Stop">
                  <Square className="w-4 h-4" />
                </button>
                <button onClick={() => api.restartStation(station.id).then(loadStations)}
                  className="p-1.5 rounded-md hover:bg-amber-500/20 text-amber-400 transition-colors" title="Restart">
                  <RotateCw className="w-4 h-4" />
                </button>
                <button onClick={() => deleteStation(station.id)}
                  className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-600 hover:text-red-400 transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <Link to={`/station/${station.id}`}
                className="flex items-center gap-1 text-sm text-brand-400 hover:text-brand-300 font-medium">
                Manage <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        ))}

        {stations.length === 0 && (
          <div className="col-span-full text-center py-16">
            <Radio className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-400">No stations yet</h3>
            <p className="text-sm text-gray-600 mt-1">Create your first station to get started</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
              <Plus className="w-4 h-4 inline mr-2" /> Create Station
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
