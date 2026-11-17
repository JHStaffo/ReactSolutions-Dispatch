"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COOKIE = void 0;
exports.createSession = createSession;
exports.destroySession = destroySession;
exports.destroyUserSessions = destroyUserSessions;
exports.parseCookies = parseCookies;
exports.checkSession = checkSession;
exports.sessionInfo = sessionInfo;
exports.setSessionCookie = setSessionCookie;
exports.clearSessionCookie = clearSessionCookie;
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
exports.loginThrottled = loginThrottled;
exports.recordLoginFailure = recordLoginFailure;
exports.findUser = findUser;
exports.onlineUsers = onlineUsers;
const node_crypto_1 = __importDefault(require("node:crypto"));
const audit_1 = require("./audit");
const config_1 = require("./config");
const store_1 = require("./store");
exports.COOKIE = 'rsd_session';
const sessions = new Map();
const sha = (t) => node_crypto_1.default.createHash('sha256').update(t).digest('hex');
function createSession(user) {
    const token = node_crypto_1.default.randomBytes(32).toString('base64url');
    const now = Date.now();
    sessions.set(sha(token), { tokenHash: sha(token), user, created: now, lastActive: now });
    return token;
}
function destroySession(token) {
    if (token)
        sessions.delete(sha(token));
}
/** Ends every session for a user, e.g. after their account is disabled. */
function destroyUserSessions(username) {
    for (const [k, s] of sessions)
        if (s.user.username === username)
            sessions.delete(k);
}
function parseCookies(header) {
    const out = {};
    for (const part of (header || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0)
            out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}
function checkSession(token, touch) {
    if (!token)
        return { ok: false, reason: 'none' };
    const s = sessions.get(sha(token));
    if (!s)
        return { ok: false, reason: 'none' };
    const now = Date.now();
    if (now - s.lastActive > config_1.config.idleTimeoutMs || now - s.created > config_1.config.absoluteTimeoutMs) {
        sessions.delete(s.tokenHash);
        const reason = now - s.created > config_1.config.absoluteTimeoutMs ? 'absolute' : 'idle';
        (0, audit_1.audit)({ user: s.user.username, role: s.user.role, action: 'SESSION_TIMEOUT', outcome: 'success', detail: reason });
        return { ok: false, reason };
    }
    if (touch)
        s.lastActive = now;
    return { ok: true, session: s };
}
function sessionInfo(s) {
    return {
        user: s.user,
        idleTimeoutMs: config_1.config.idleTimeoutMs,
        expiresAt: new Date(s.lastActive + config_1.config.idleTimeoutMs).toISOString(),
    };
}
function setSessionCookie(res, token) {
    res.cookie(exports.COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: config_1.config.secureCookies,
        path: config_1.config.basePath,
    });
}
function clearSessionCookie(res) {
    res.clearCookie(exports.COOKIE, { path: config_1.config.basePath });
}
/**
 * Requires a valid session. `touch` = whether this request counts as user activity.
 * Background polling must not keep an unattended workstation logged in.
 */
function requireAuth(touch = true) {
    return (req, res, next) => {
        const token = parseCookies(req.headers.cookie)[exports.COOKIE];
        const r = checkSession(token, touch);
        if (!r.ok) {
            clearSessionCookie(res);
            return res.status(401).json({ error: 'UNAUTHENTICATED', reason: r.reason });
        }
        req.user = r.session.user;
        req.sessionToken = token;
        next();
    };
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            (0, audit_1.audit)({
                user: req.user?.username || 'anonymous',
                role: req.user?.role || '-',
                action: 'ACCESS_DENIED',
                outcome: 'denied',
                detail: `${req.method} ${req.route?.path ?? ''}`,
                ip: req.ip,
            });
            return res.status(403).json({ error: 'FORBIDDEN' });
        }
        next();
    };
}
// Simple in-memory login throttle: 10 failures per IP or username per 15 minutes.
const failures = new Map();
const WINDOW = 15 * 60_000;
function loginThrottled(keys) {
    const now = Date.now();
    return keys.some((k) => (failures.get(k) || []).filter((t) => now - t < WINDOW).length >= 10);
}
function recordLoginFailure(keys) {
    const now = Date.now();
    for (const k of keys)
        failures.set(k, [...(failures.get(k) || []).filter((t) => now - t < WINDOW), now]);
}
function findUser(username) {
    return store_1.store.state.users.find((u) => u.username.toLowerCase() === username.toLowerCase() && !u.disabled);
}
function onlineUsers() {
    const now = Date.now();
    return [...sessions.values()].filter((s) => now - s.lastActive <= config_1.config.idleTimeoutMs).map((s) => s.user.username);
}
