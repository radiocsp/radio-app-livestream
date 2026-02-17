import { useEffect, useRef, useState, useCallback } from 'react';
import { SSEEvent } from '../types';

export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/events');
    sourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);
        if (data.type === 'connected') {
          setConnected(true);
          return;
        }
        setEvents((prev) => [data, ...prev.slice(0, 499)]);
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
    };
  }, []);

  const getStationEvents = useCallback(
    (stationId: string) => events.filter((e) => e.stationId === stationId),
    [events]
  );

  return { events, connected, getStationEvents };
}

export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const tick = () => savedCallback.current();
    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay]);
}
