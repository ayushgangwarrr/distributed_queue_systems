/**
 * dashboard/src/services/useWebSocket.js
 *
 * Custom React hook managing real-time WebSocket connection to the
 * monitoring server on ws://localhost:4000.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket(url = 'ws://localhost:4000') {
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected' | 'error'
  const [stats, setStats] = useState({ pending: 0, active: 0, delayed: 0, dlq: 0 });
  const [workers, setWorkers] = useState([]);
  const [events, setEvents] = useState([]);
  const [lastEvent, setLastEvent] = useState(null);

  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);

  const connect = useCallback(() => {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      setStatus('connecting');
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const data = JSON.parse(event.data);

          // Handle initial snapshot
          if (data.type === 'snapshot' || data.event === 'system:snapshot') {
            if (data.stats) setStats(data.stats);
            if (data.workers) setWorkers(data.workers);
          }

          // Handle periodic stats sync
          if (data.event === 'system:stats' && data.payload) {
            if (data.payload.stats) setStats(data.payload.stats);
            if (data.payload.workers) setWorkers(data.payload.workers);
          }

          // Store all events in live log
          const newEvent = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            event: data.event || 'message',
            payload: data.payload || data,
            timestamp: data.timestamp || Date.now(),
          };

          setLastEvent(newEvent);
          setEvents((prev) => [newEvent, ...prev.slice(0, 199)]); // Keep last 200 events
        } catch {
          // Ignore unparseable frames
        }
      };

      ws.onerror = () => {
        if (!isMountedRef.current) return;
        setStatus('error');
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        setStatus('disconnected');
        socketRef.current = null;

        // Exponential backoff reconnect: 1s, 2s, 4s, max 8s
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 8000);
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };
    } catch {
      setStatus('disconnected');
    }
  }, [url]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const manualReconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }
    clearTimeout(reconnectTimeoutRef.current);
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  return {
    status,
    stats,
    workers,
    events,
    lastEvent,
    clearEvents,
    reconnect: manualReconnect,
  };
}
