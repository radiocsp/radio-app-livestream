import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, User, Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader2, KeyRound, Globe, Mail, ShieldCheck, ShieldOff, RefreshCw, ExternalLink, HardDrive, Trash2, FolderOpen, Database } from 'lucide-react';

interface StorageInfo {
  disk: {
    total: number; used: number; free: number;
    totalFormatted: string; usedFormatted: string; freeFormatted: string;
    usagePercent: number;
  };
  uploads: { totalSize: number; totalFormatted: string };
  chunks: {
    totalSize: number; totalFormatted: string; sessionCount: number;
    sessions: { sessionId: string; size: number; sizeFormatted: string; chunkCount: number; createdAt: string; age: string }[];
  };
  stations: { id: string; size: number; sizeFormatted: string; fileCount: number }[];
}

interface SSLStatus {
  enabled: boolean;
  domain: string;
  email: string;
  status: string; // inactive | pending | active | error
  issuedAt: string;
  expiresAt: string;
  errorMessage: string;
}

export default function Settings() {
  const { user, token, changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Account info
  const [account, setAccount] = useState<any>(null);

  // SSL state
  const [sslStatus, setSSLStatus] = useState<SSLStatus | null>(null);
  const [sslDomain, setSSLDomain] = useState('');
  const [sslEmail, setSSLEmail] = useState('');
  const [sslLoading, setSSLLoading] = useState(false);
  const [sslSuccess, setSSLSuccess] = useState('');
  const [sslError, setSSLError] = useState('');

  // Storage state
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageCleaning, setStorageCleaning] = useState(false);
  const [storageSuccess, setStorageSuccess] = useState('');
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setAccount(data))
      .catch(() => {});
  }, [token]);

  // Fetch SSL status
  const fetchSSLStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/ssl', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data: SSLStatus = await res.json();
        setSSLStatus(data);
        if (data.domain) setSSLDomain(data.domain);
        if (data.email) setSSLEmail(data.email);
      }
    } catch {}
  };

  useEffect(() => {
    fetchSSLStatus();
  }, [token]);

  // Storage: fetch
  const fetchStorage = async () => {
    if (!token) return;
    setStorageLoading(true);
    try {
      const res = await fetch('/api/admin/storage', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setStorageInfo(await res.json());
    } catch {} finally { setStorageLoading(false); }
  };

  useEffect(() => { fetchStorage(); }, [token]);

  // Storage: delete all chunks
  const handleCleanAllChunks = async () => {
    if (!token || !confirm('Ștergi TOATE chunk-urile orfane? Aceasta va elibera spațiu pe disc.')) return;
    setStorageError(''); setStorageSuccess(''); setStorageCleaning(true);
    try {
      const res = await fetch('/api/admin/storage/chunks', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.success) {
        setStorageSuccess(`${data.message} — eliberat ${data.freedFormatted}`);
        await fetchStorage();
      } else { throw new Error(data.error || 'Failed to clean chunks'); }
    } catch (err: any) { setStorageError(err.message); }
    finally { setStorageCleaning(false); }
  };

  // Storage: delete single chunk session
  const handleDeleteChunkSession = async (sessionId: string) => {
    if (!token || !confirm(`Ștergi sesiunea ${sessionId.substring(0, 8)}...?`)) return;
    setStorageError(''); setStorageSuccess('');
    try {
      const res = await fetch(`/api/admin/storage/chunks/${sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.success) {
        setStorageSuccess(`${data.message} — eliberat ${data.freedFormatted}`);
        await fetchStorage();
      } else { throw new Error(data.error || 'Failed to delete session'); }
    } catch (err: any) { setStorageError(err.message); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from current password.');
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess('Password updated successfully! ✅');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  // SSL: Save & Apply
  const handleSSLApply = async () => {
    setSSLError('');
    setSSLSuccess('');

    if (!sslDomain.trim()) {
      setSSLError('Domain is required (e.g. stream.example.com)');
      return;
    }
    if (!sslEmail.trim()) {
      setSSLError('Email is required for Let\'s Encrypt');
      return;
    }

    setSSLLoading(true);
    try {
      // First save settings
      const saveRes = await fetch('/api/admin/ssl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain: sslDomain.trim(), email: sslEmail.trim() }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json();
        throw new Error(err.error || 'Failed to save SSL settings');
      }

      // Then request certificate
      const applyRes = await fetch('/api/admin/ssl/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain: sslDomain.trim(), email: sslEmail.trim() }),
      });
      const result = await applyRes.json();
      if (applyRes.ok && result.success) {
        setSSLSuccess(result.message || 'SSL certificate installed successfully! 🎉');
        await fetchSSLStatus();
      } else {
        throw new Error(result.error || result.message || 'Failed to install SSL certificate');
      }
    } catch (err: any) {
      setSSLError(err.message || 'SSL installation failed');
    } finally {
      setSSLLoading(false);
    }
  };

  // SSL: Disable
  const handleSSLDisable = async () => {
    if (!confirm('Are you sure you want to disable SSL? The site will be HTTP only.')) return;
    setSSLError('');
    setSSLSuccess('');
    setSSLLoading(true);
    try {
      const res = await fetch('/api/admin/ssl/disable', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setSSLSuccess('SSL disabled successfully');
        await fetchSSLStatus();
      } else {
        throw new Error(result.error || 'Failed to disable SSL');
      }
    } catch (err: any) {
      setSSLError(err.message);
    } finally {
      setSSLLoading(false);
    }
  };

  const sslStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-emerald-400';
      case 'pending': return 'text-amber-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-500';
    }
  };

  const sslStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'pending': return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      case 'error': return 'bg-red-500/10 border-red-500/30 text-red-400';
      default: return 'bg-gray-500/10 border-gray-500/30 text-gray-500';
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your account, security and SSL</p>
      </div>

      {/* SSL / HTTPS Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-emerald-600/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">SSL / HTTPS</h2>
            <p className="text-xs text-gray-500">Free Let's Encrypt certificate — auto-install</p>
          </div>
          {sslStatus && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${sslStatusBadge(sslStatus.status)}`}>
              {sslStatus.status === 'active' ? '🔒 Active' :
               sslStatus.status === 'pending' ? '⏳ Installing...' :
               sslStatus.status === 'error' ? '❌ Error' : '🔓 Inactive'}
            </span>
          )}
        </div>

        {/* SSL Status Info */}
        {sslStatus?.status === 'active' && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Domain</p>
              <p className="text-sm font-medium text-emerald-400 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" />
                {sslStatus.domain}
              </p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Status</p>
              <p className={`text-sm font-medium ${sslStatusColor(sslStatus.status)}`}>
                🔒 HTTPS Active
              </p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Issued</p>
              <p className="text-sm font-medium text-white">
                {sslStatus.issuedAt ? new Date(sslStatus.issuedAt).toLocaleDateString() : '—'}
              </p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-0.5">Expires</p>
              <p className="text-sm font-medium text-white">
                {sslStatus.expiresAt ? new Date(sslStatus.expiresAt).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>
        )}

        {sslSuccess && (
          <div className="mb-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg px-4 py-2.5 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{sslSuccess}</span>
          </div>
        )}

        {sslError && (
          <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-2.5 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all">{sslError}</span>
          </div>
        )}

        {sslStatus?.status === 'error' && sslStatus.errorMessage && (
          <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-2.5 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all text-xs">{sslStatus.errorMessage}</span>
          </div>
        )}

        <div className="space-y-4">
          {/* Domain */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Domain / Subdomain
            </label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={sslDomain}
                onChange={(e) => setSSLDomain(e.target.value)}
                disabled={sslLoading}
                placeholder="stream.example.com"
                className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              The domain must point to this server's IP before activating SSL
            </p>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Email (for Let's Encrypt)
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="email"
                value={sslEmail}
                onChange={(e) => setSSLEmail(e.target.value)}
                disabled={sslLoading}
                placeholder="admin@example.com"
                className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Used for certificate expiry notifications from Let's Encrypt
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSSLApply}
              disabled={sslLoading || !sslDomain.trim() || !sslEmail.trim()}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 text-sm transition-all flex items-center justify-center gap-2"
            >
              {sslLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Installing certificate...
                </>
              ) : sslStatus?.status === 'active' ? (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Renew Certificate
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Activate SSL
                </>
              )}
            </button>

            {sslStatus?.status === 'active' && (
              <button
                onClick={handleSSLDisable}
                disabled={sslLoading}
                className="px-4 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 font-medium rounded-lg py-2.5 text-sm transition-all flex items-center gap-2"
              >
                <ShieldOff className="w-4 h-4" />
                Disable
              </button>
            )}
          </div>

          {sslStatus?.status === 'active' && sslStatus.domain && (
            <a
              href={`https://${sslStatus.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open https://{sslStatus.domain}
            </a>
          )}
        </div>
      </div>

      {/* Storage Management Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-orange-600/20 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-orange-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">Storage Management</h2>
            <p className="text-xs text-gray-500">Gestionează spațiul pe disc și curăță fișierele temporare</p>
          </div>
          <button
            onClick={fetchStorage}
            disabled={storageLoading}
            className="text-gray-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${storageLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {storageSuccess && (
          <div className="mb-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg px-4 py-2.5 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{storageSuccess}</span>
          </div>
        )}

        {storageError && (
          <div className="mb-4 flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-2.5 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{storageError}</span>
          </div>
        )}

        {storageInfo ? (
          <>
            {/* Disk Usage Bar */}
            <div className="mb-5">
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span>Disc utilizat: {storageInfo.disk.usedFormatted} / {storageInfo.disk.totalFormatted}</span>
                <span className={storageInfo.disk.usagePercent > 85 ? 'text-red-400 font-bold' : storageInfo.disk.usagePercent > 70 ? 'text-amber-400' : 'text-emerald-400'}>
                  {storageInfo.disk.usagePercent}%
                </span>
              </div>
              <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    storageInfo.disk.usagePercent > 85 ? 'bg-gradient-to-r from-red-600 to-red-400' :
                    storageInfo.disk.usagePercent > 70 ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
                    'bg-gradient-to-r from-emerald-600 to-teal-400'
                  }`}
                  style={{ width: `${storageInfo.disk.usagePercent}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 mt-1">Liber: {storageInfo.disk.freeFormatted}</p>
            </div>

            {/* Overview Grid */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                <Database className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                <p className="text-xs text-gray-500">Total Uploads</p>
                <p className="text-sm font-bold text-white">{storageInfo.uploads.totalFormatted}</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${storageInfo.chunks.totalSize > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-gray-800/50'}`}>
                <FolderOpen className={`w-4 h-4 mx-auto mb-1 ${storageInfo.chunks.totalSize > 0 ? 'text-red-400' : 'text-gray-500'}`} />
                <p className="text-xs text-gray-500">Chunk-uri orfane</p>
                <p className={`text-sm font-bold ${storageInfo.chunks.totalSize > 0 ? 'text-red-400' : 'text-gray-400'}`}>
                  {storageInfo.chunks.totalFormatted}
                </p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                <HardDrive className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                <p className="text-xs text-gray-500">Sesiuni</p>
                <p className="text-sm font-bold text-white">{storageInfo.chunks.sessionCount}</p>
              </div>
            </div>

            {/* Chunk Sessions List */}
            {storageInfo.chunks.sessions.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Sesiuni chunk-uri ({storageInfo.chunks.sessions.length})</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {storageInfo.chunks.sessions.map(s => (
                    <div key={s.sessionId} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-gray-300 truncate">{s.sessionId}</p>
                        <p className="text-xs text-gray-500">{s.chunkCount} chunks · {s.sizeFormatted} · {s.age}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteChunkSession(s.sessionId)}
                        className="ml-2 p-1.5 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors shrink-0"
                        title="Șterge sesiunea"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Station Uploads */}
            {storageInfo.stations.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Upload-uri per stație</h3>
                <div className="space-y-1.5">
                  {storageInfo.stations.map(s => (
                    <div key={s.id} className="flex items-center justify-between bg-gray-800/30 rounded-lg px-3 py-2">
                      <span className="text-xs font-mono text-gray-400 truncate">{s.id.substring(0, 8)}...</span>
                      <span className="text-xs text-gray-300">{s.fileCount} fișiere · {s.sizeFormatted}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clean All Button */}
            {storageInfo.chunks.totalSize > 0 && (
              <button
                onClick={handleCleanAllChunks}
                disabled={storageCleaning}
                className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 text-sm transition-all flex items-center justify-center gap-2"
              >
                {storageCleaning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Se curăță...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Curăță toate chunk-urile orfane ({storageInfo.chunks.totalFormatted})
                  </>
                )}
              </button>
            )}

            {storageInfo.chunks.totalSize === 0 && (
              <div className="text-center py-3 text-gray-500 text-sm">
                ✅ Niciun fișier temporar orfan
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-6">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500 mx-auto" />
            <p className="text-xs text-gray-600 mt-2">Se încarcă informații storage...</p>
          </div>
        )}
      </div>

      {/* Account Info Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center">
            <User className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Account Information</h2>
            <p className="text-xs text-gray-500">Your profile details</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Username</p>
            <p className="text-sm font-medium text-white">{user?.username || '—'}</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Role</p>
            <p className="text-sm font-medium text-white flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              {user?.role || '—'}
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Last Login</p>
            <p className="text-sm font-medium text-white">
              {account?.last_login ? new Date(account.last_login).toLocaleString() : '—'}
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-0.5">Account Created</p>
            <p className="text-sm font-medium text-white">
              {account?.created_at ? new Date(account.created_at).toLocaleString() : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Change Password Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-amber-600/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Change Password</h2>
            <p className="text-xs text-gray-500">Update your login password</p>
          </div>
        </div>

        {success && (
          <div className="mb-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg px-4 py-2.5 text-sm">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-2.5 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          {/* Current Password */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Current Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
                placeholder="Enter current password"
                className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
                placeholder="Minimum 8 characters"
                className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {newPassword.length > 0 && newPassword.length < 8 && (
              <p className="text-xs text-amber-400 mt-1">Password must be at least 8 characters</p>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Confirm New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                placeholder="Re-enter new password"
                className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
            {confirmPassword.length > 0 && newPassword !== confirmPassword && (
              <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 text-sm transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating…
              </>
            ) : (
              'Update Password'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
