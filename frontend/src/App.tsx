import { Routes, Route } from 'react-router-dom';
import { useSSE } from './hooks/useSSE';
import Dashboard from './pages/Dashboard';
import StationDetail from './pages/StationDetail';
import Sidebar from './components/Sidebar';

export default function App() {
  const sse = useSSE();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar connected={sse.connected} />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard sse={sse} />} />
          <Route path="/station/:id" element={<StationDetail sse={sse} />} />
        </Routes>
      </main>
    </div>
  );
}
