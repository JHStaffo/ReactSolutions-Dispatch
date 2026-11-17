import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role, SessionUser } from '../../shared/types';
import { audit } from './audit';
import { config } from './config';
import { store } from './store';

/**
 * Server-side sessions with an opaque random token in an HttpOnly, SameSite=Strict cookie.
 * Idle timeout (default 15 min) implements automatic logoff; absolute timeout caps a shift.
 */
interface Session {
  tokenHash: string;
  user: SessionUser;
  created: number;
  lastActive: number;
}

export const COOKIE = 'rsd_session';
const sessions = new Map<string, Session>();
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(user: SessionUser): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sha(token), { tokenHash: sha(token), user, created: now, lastActive: now });
  return token;
}

export function destroySession(token: string | undefined) {
  if (token) sessions.delete(sha(token));
}

/** Ends every session for a user, e.g. after their account is disabled. */
export function destroyUserSessions(username: string) {
  for (const [k, s] of sessions) if (s.user.username === username) sessions.delete(k);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export type SessionCheck = { ok: true; session: Session } | { ok: false; reason: 'none' | 'idle' | 'absolute' };

export function checkSession(token: string | undefined, touch: boolean): SessionCheck {
  if (!token) return { ok: false, reason: 'none' };
  const s = sessions.get(sha(token));
  if (!s) return { ok: false, reason: 'none' };
  const now = Date.now();
  if (now - s.lastActive > config.idleTimeoutMs || now - s.created > config.absoluteTimeoutMs) {
    sessions.delete(s.tokenHash);
    const reason = now - s.created > config.absoluteTimeoutMs ? 'absolute' : 'idle';
    audit({ user: s.user.username, role: s.user.role, action: 'SESSION_TIMEOUT', outcome: 'success', detail: reason });
    return { ok: false, reason };
  }
  if (touch) s.lastActive = now;
  return { ok: true, session: s };
}

export function sessionInfo(s: Session) {
  return {
    user: s.user,
    idleTimeoutMs: config.idleTimeoutMs,
    expiresAt: new Date(s.lastActive + config.idleTimeoutMs).toISOString(),
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies,
    path: config.basePath,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: config.basePath });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionToken?: string;
    }
  }
}

/**
 * Requires a valid session. `touch` = whether this request counts as user activity.
 * Background polling must not keep an unattended workstation logged in.
 */
export function requireAuth(touch = true) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
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

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      audit({
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
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
export function loginThrottled(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => (failures.get(k) || []).filter((t) => now - t < WINDOW).length >= 10);
}
export function recordLoginFailure(keys: string[]) {
  const now = Date.now();
  for (const k of keys) failures.set(k, [...(failures.get(k) || []).filter((t) => now - t < WINDOW), now]);
}

export function findUser(username: string) {
  return store.state.users.find((u) => u.username.toLowerCase() === username.toLowerCase() && !u.disabled);
}

export function onlineUsers(): string[] {
  const now = Date.now();
  return [...sessions.values()].filter((s) => now - s.lastActive <= config.idleTimeoutMs).map((s) => s.user.username);
}
