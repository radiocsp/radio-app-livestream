import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSSE } from './hooks/useSSE';
import { useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import StationDetail from './pages/StationDetail';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Sidebar from './components/Sidebar';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function AppShell() {
  const sse = useSSE();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar connected={sse.connected} />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard sse={sse} />} />
          <Route path="/station/:id" element={<StationDetail sse={sse} />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <AppShell />
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
