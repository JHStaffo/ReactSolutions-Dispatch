import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Role, ServerEvent, SessionUser } from '../../shared/types';
import { COOKIE, checkSession, parseCookies } from './auth';
import { config } from './config';
import { log } from './log';
import { forRole, store } from './store';

interface Client {
  ws: WebSocket;
  token: string;
  user: SessionUser;
  alive: boolean;
}

/**
 * Live updates. Each dispatcher's browser holds a WebSocket; every change made by
 * anyone is pushed to everyone. The socket is authenticated by the session cookie
 * and is closed as soon as that session times out.
 */
export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const clients = new Set<Client>();
  const wsPath = config.basePath + 'ws';

  const presence = () => {
    const seen = new Map<string, { displayName: string; role: Role }>();
    for (const c of clients) seen.set(c.user.username, { displayName: c.user.displayName, role: c.user.role });
    store.emit({ type: 'presence', users: [...seen.values()] });
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = (req.url || '').split('?')[0];
    if (url !== wsPath) return socket.destroy();
    // Same-origin check: the session cookie is SameSite=Strict, but verify Origin too.
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && host && new URL(origin).host !== host) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const s = checkSession(token, false);
    if (!s.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, token, user: s.session.user, alive: true };
      clients.add(client);
      ws.send(JSON.stringify({ type: 'hello', bootId: store.bootId, seq: store.seq }));
      ws.on('pong', () => (client.alive = true));
      ws.on('message', () => {
        /* clients do not send commands over the socket; all writes go through the audited REST API */
      });
      ws.on('close', () => {
        clients.delete(client);
        presence();
      });
      presence();
    });
  });

  store.subscribe((e: ServerEvent) => {
    for (const c of clients) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      const out = e.type === 'call' ? { ...e, call: forRole(e.call, c.user.role) } : e;
      c.ws.send(JSON.stringify(out));
    }
  });

  // Heartbeat + session expiry enforcement.
  const timer = setInterval(() => {
    for (const c of clients) {
      const s = checkSession(c.token, false);
      if (!s.ok) {
        c.ws.close(4401, 'session expired');
        clients.delete(c);
        continue;
      }
      if (!c.alive) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 25_000);
  wss.on('close', () => clearInterval(timer));
  log('info', 'Realtime channel ready', { path: wsPath });
}
