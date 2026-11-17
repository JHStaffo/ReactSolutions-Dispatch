import { useEffect, useRef, useState } from 'react';
import type { GpsPosition, ServerEvent } from '../../shared/types';
import { api, wsUrl } from './api';

export type SyncStatus = 'connecting' | 'live' | 'polling';

interface Options {
  enabled: boolean;
  /** Current board position; events at or below seq are already applied. */
  cursor: () => { bootId: string; seq: number } | null;
  onEvents: (events: ServerEvent[], seq: number) => void;
  /** Server restarted or we fell too far behind: reload the board. */
  onReset: () => void;
  onSessionEnded: () => void;
  onGps?: (positions: GpsPosition[]) => void;
}

/**
 * Keeps the board in step with every other dispatcher.
 * Primary channel: WebSocket push. If the socket can't connect (some shared hosts block
 * WebSockets), it falls back to polling /api/changes every few seconds. Any gap in the
 * event sequence triggers a catch-up fetch, so no update is silently missed.
 */
export function useLiveSync(o: Options) {
  const [status, setStatus] = useState<SyncStatus>('connecting');
  const [presence, setPresence] = useState<{ displayName: string; role: string }[]>([]);
  const ref = useRef(o);
  ref.current = o;

  useEffect(() => {
    if (!o.enabled) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let pollTimer: number | undefined;
    let retryTimer: number | undefined;
    let catchingUp = false;

    const catchUp = async () => {
      const c = ref.current.cursor();
      if (!c || catchingUp) return;
      catchingUp = true;
      try {
        const r = await api<{ reset?: boolean; seq: number; events: ServerEvent[]; gps?: GpsPosition[] }>(
          `changes?since=${c.seq}&boot=${encodeURIComponent(c.bootId)}`,
        );
        if (r.gps) ref.current.onGps?.(r.gps);
        if (r.reset) ref.current.onReset();
        else if (r.events.length) ref.current.onEvents(r.events, r.seq);
      } catch {
        /* network blip; next tick retries */
      } finally {
        catchingUp = false;
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      setStatus('polling');
      pollTimer = window.setInterval(catchUp, 4000);
    };
    const stopPolling = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        startPolling();
        return;
      }
      const openTimeout = window.setTimeout(() => ws && ws.readyState !== WebSocket.OPEN && ws.close(), 8000);
      ws.onopen = () => {
        window.clearTimeout(openTimeout);
        retry = 0;
        stopPolling();
        setStatus('live');
      };
      ws.onmessage = (m) => {
        let msg: any;
        try {
          msg = JSON.parse(m.data);
        } catch {
          return;
        }
        const c = ref.current.cursor();
        if (msg.type === 'hello') {
          if (c && (msg.bootId !== c.bootId || msg.seq < c.seq)) ref.current.onReset();
          else if (c && msg.seq > c.seq) catchUp();
          return;
        }
        if (msg.type === 'gps') {
          ref.current.onGps?.(msg.positions);
          return;
        }
        if (msg.type === 'presence') {
          setPresence(msg.users);
          return;
        }
        if (!c) return;
        if (msg.seq <= c.seq) return; // already applied
        if (msg.seq > c.seq + 1) {
          catchUp(); // missed something; fetch the gap
          return;
        }
        ref.current.onEvents([msg], msg.seq);
      };
      ws.onclose = (ev) => {
        window.clearTimeout(openTimeout);
        if (closed) return;
        if (ev.code === 4401) {
          ref.current.onSessionEnded();
          return;
        }
        setPresence([]);
        startPolling();
        retry = Math.min(retry + 1, 6);
        retryTimer = window.setTimeout(connect, 1000 * 2 ** retry);
      };
    };

    connect();
    return () => {
      closed = true;
      stopPolling();
      window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [o.enabled]);

  return { status, presence };
}
