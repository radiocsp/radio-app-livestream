import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Radio, LayoutDashboard, Wifi, WifiOff, LogOut, User, Shield, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  connected: boolean;
}

export default function Sidebar({ connected }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 border-b border-gray-800">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">RadioStream</h1>
            <p className="text-xs text-gray-500 font-medium">STUDIO PRO</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        <Link
          to="/"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            location.pathname === '/'
              ? 'bg-brand-600/20 text-brand-400'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          Dashboard
        </Link>
        <Link
          to="/settings"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            location.pathname === '/settings'
              ? 'bg-brand-600/20 text-brand-400'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          <Settings className="w-4 h-4" />
          Settings
        </Link>
      </nav>

      {/* User info + Logout */}
      {user && (
        <div className="px-3 py-2 border-t border-gray-800">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-gray-800/50">
            <div className="w-8 h-8 rounded-full bg-indigo-600/30 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.username}</p>
              <p className="text-[10px] text-gray-500 flex items-center gap-1">
                <Shield className="w-2.5 h-2.5" />
                {user.role}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Connection status */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-2 text-xs">
          {connected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Live Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400">Disconnected</span>
            </>
          )}
        </div>
        <p className="text-[10px] text-gray-600 mt-1">v1.1.0 • RadioStream Studio</p>
      </div>
    </aside>
  );
}
