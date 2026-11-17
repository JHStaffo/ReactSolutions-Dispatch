"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachRealtime = attachRealtime;
const ws_1 = require("ws");
const auth_1 = require("./auth");
const config_1 = require("./config");
const log_1 = require("./log");
const store_1 = require("./store");
/**
 * Live updates. Each dispatcher's browser holds a WebSocket; every change made by
 * anyone is pushed to everyone. The socket is authenticated by the session cookie
 * and is closed as soon as that session times out.
 */
function attachRealtime(server) {
    const wss = new ws_1.WebSocketServer({ noServer: true, maxPayload: 4096 });
    const clients = new Set();
    const wsPath = config_1.config.basePath + 'ws';
    const presence = () => {
        const seen = new Map();
        for (const c of clients)
            seen.set(c.user.username, { displayName: c.user.displayName, role: c.user.role });
        store_1.store.emit({ type: 'presence', users: [...seen.values()] });
    };
    server.on('upgrade', (req, socket, head) => {
        const url = (req.url || '').split('?')[0];
        if (url !== wsPath)
            return socket.destroy();
        // Same-origin check: the session cookie is SameSite=Strict, but verify Origin too.
        const origin = req.headers.origin;
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (origin && host && new URL(origin).host !== host) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            return socket.destroy();
        }
        const token = (0, auth_1.parseCookies)(req.headers.cookie)[auth_1.COOKIE];
        const s = (0, auth_1.checkSession)(token, false);
        if (!s.ok) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            return socket.destroy();
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            const client = { ws, token, user: s.session.user, alive: true };
            clients.add(client);
            ws.send(JSON.stringify({ type: 'hello', bootId: store_1.store.bootId, seq: store_1.store.seq }));
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
    store_1.store.subscribe((e) => {
        for (const c of clients) {
            if (c.ws.readyState !== ws_1.WebSocket.OPEN)
                continue;
            if (c.user.role === 'crew') {
                // Crews get no other units' data: just a nudge to reload their own trip list.
                if (e.type === 'call' && (e.call.crewId === c.user.crewId || e.prevCrewId === c.user.crewId))
                    c.ws.send(JSON.stringify({ type: 'crew-refresh' }));
                if (e.type === 'reset')
                    c.ws.send(JSON.stringify({ type: 'crew-refresh' }));
                continue;
            }
            let out = e;
            if (e.type === 'call') {
                const { prevCrewId: _p, ...rest } = e;
                out = { ...rest, call: (0, store_1.forRole)(e.call, c.user.role) };
            }
            c.ws.send(JSON.stringify(out));
        }
    });
    // Heartbeat + session expiry enforcement.
    const timer = setInterval(() => {
        for (const c of clients) {
            const s = (0, auth_1.checkSession)(c.token, false);
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
    (0, log_1.log)('info', 'Realtime channel ready', { path: wsPath });
}
