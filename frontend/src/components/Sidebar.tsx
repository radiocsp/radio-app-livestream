import { Link, useLocation } from 'react-router-dom';
import { Radio, LayoutDashboard, Wifi, WifiOff } from 'lucide-react';

interface SidebarProps {
  connected: boolean;
}

export default function Sidebar({ connected }: SidebarProps) {
  const location = useLocation();

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
      </nav>

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
        <p className="text-[10px] text-gray-600 mt-1">v1.0.0 • RadioStream Studio</p>
      </div>
    </aside>
  );
}
