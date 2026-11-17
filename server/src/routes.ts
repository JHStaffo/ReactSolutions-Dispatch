import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ACTIVE_STATUSES,
  EQUIPMENT,
  STATUSES,
  TRIP_TYPES,
  type AssignWarning,
  type Call,
  type CallStatus,
  type Crew,
  type Equipment,
  type TripType,
} from '../../shared/types';
import { audit, readAudit } from './audit';
import {
  COOKIE,
  checkSession,
  clearSessionCookie,
  createSession,
  destroySession,
  findUser,
  loginThrottled,
  parseCookies,
  recordLoginFailure,
  requireAuth,
  requireRole,
  sessionInfo,
  setSessionCookie,
} from './auth';
import { config } from './config';
import { hashPassword, verifyPassword } from './crypto';
import { seedState } from './seed';
import { milesSince, positions } from './gps';
import { actor, bad, who } from './http';
import { resolvePatient } from './patients';
import { forRole, store, summarize } from './store';

export const api = express.Router();

const tripTypes = Object.keys(TRIP_TYPES) as [TripType, ...TripType[]];
const equipment = Object.keys(EQUIPMENT) as [Equipment, ...Equipment[]];
const isoDate = z.string().datetime({ offset: true });

const callFields = z.object({
  level: z.enum(['ALS', 'BLS']),
  tripType: z.enum(tripTypes),
  patient: z.object({
    firstName: z.string().trim().min(1).max(50),
    lastName: z.string().trim().min(1).max(50),
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d) < new Date() && new Date(d) > new Date('1900-01-01'), 'Invalid date of birth'),
    weightLbs: z.number().int().min(1).max(1500),
  }),
  insurance: z.object({
    payer: z.string().trim().min(1).max(80),
    memberId: z.string().trim().max(40).default(''),
    priorAuth: z.string().trim().max(40).default(''),
  }),
  pcsOnFile: z.boolean().default(false),
  equipment: z.array(z.enum(equipment)).max(equipment.length).default([]),
  chiefComplaint: z.string().trim().min(1).max(300),
  stretcherReason: z.string().trim().min(1).max(500),
  pickupMode: z.enum(['ASAP', 'SCHEDULED', 'WILL_CALL']),
  pickupTime: isoDate.nullable().default(null),
  pickupLocation: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(200),
  durationMin: z.number().int().min(15).max(720),
  notes: z.string().trim().max(1000).default(''),
});

const createSchema = callFields
  .extend({
    patientId: z.string().uuid().nullable().default(null),
    returnTrip: z
      .object({ mode: z.enum(['SCHEDULED', 'WILL_CALL']), pickupTime: isoDate.nullable().default(null) })
      .nullable()
      .default(null),
    recurrence: z
      .object({ weekdays: z.array(z.number().int().min(0).max(6)).min(1), weeks: z.number().int().min(1).max(8) })
      .nullable()
      .default(null),
  })
  .superRefine((v, ctx) => {
    if (v.pickupMode === 'SCHEDULED' && !v.pickupTime) ctx.addIssue({ code: 'custom', path: ['pickupTime'], message: 'Pickup time is required' });
    if (v.returnTrip?.mode === 'SCHEDULED' && !v.returnTrip.pickupTime)
      ctx.addIssue({ code: 'custom', path: ['returnTrip', 'pickupTime'], message: 'Return pickup time is required' });
    if (v.recurrence && v.pickupMode !== 'SCHEDULED')
      ctx.addIssue({ code: 'custom', path: ['recurrence'], message: 'Recurring trips need a scheduled pickup time' });
  });

const updateSchema = callFields.partial().extend({
  expectedVersion: z.number().int(),
  loadedMiles: z.number().min(0).max(2000).nullable().optional(),
});
const versionOnly = z.object({ expectedVersion: z.number().int() });

/** Optimistic concurrency: the client must say which version it was looking at. */
function versionConflict(req: Request, res: Response, call: Call, expected: number, action: string) {
  if (call.version === expected) return false;
  audit({ ...who(req), action, entityType: 'call', entityId: call.id, callNumber: call.callNumber, outcome: 'conflict' });
  res.status(409).json({
    error: 'VERSION_CONFLICT',
    message: `Call ${call.callNumber} was just changed by ${call.updatedBy}. Your board has been refreshed.`,
    call: summarize(call),
  });
  return true;
}

export function commit(req: Request, call: Call, action: string, detail?: string, prevCrewId?: string | null) {
  call.version++;
  call.updatedAt = new Date().toISOString();
  call.updatedBy = actor(req);
  call.history.push({ ts: call.updatedAt, actor: actor(req), action, detail });
  store.save();
  store.emit({ type: 'call', action, actor: actor(req), call: summarize(call), prevCrewId });
}

function setStatus(call: Call, status: CallStatus) {
  call.status = status;
  call.statusTimes = { ...call.statusTimes, [status]: new Date().toISOString() };
}

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

function inShift(crew: Crew, t: Date) {
  const s = hhmm(crew.shiftStart);
  const e = hhmm(crew.shiftEnd);
  const m = minutesOfDay(t);
  return e > s ? m >= s && m < e : m >= s || m < e;
}

export function assignWarnings(call: Call, crew: Crew, start: Date): AssignWarning[] {
  const w: AssignWarning[] = [];
  if (call.level === 'ALS' && crew.level === 'BLS')
    w.push({ code: 'ALS_TO_BLS', message: `${call.callNumber} is an ALS call but ${crew.unit} is a BLS unit.` });
  if (crew.outOfService)
    w.push({ code: 'CREW_OUT_OF_SERVICE', message: `${crew.unit} is out of service${crew.oosReason ? ` (${crew.oosReason})` : ''}.` });
  const end = new Date(start.getTime() + call.durationMin * 60_000);
  if (!inShift(crew, start) || !inShift(crew, new Date(end.getTime() - 60_000)))
    w.push({ code: 'OUTSIDE_SHIFT', message: `This trip falls outside ${crew.unit}'s shift (${crew.shiftStart}-${crew.shiftEnd}).` });
  const overlaps = store.state.calls.filter((c) => {
    if (c.id === call.id || c.crewId !== crew.id || !c.scheduledStart) return false;
    if (c.status === 'COMPLETED' || c.status === 'CANCELLED') return false;
    const cs = new Date(c.scheduledStart).getTime();
    const ce = cs + c.durationMin * 60_000;
    return cs < end.getTime() && start.getTime() < ce;
  });
  if (overlaps.length)
    w.push({ code: 'CREW_OVERLAP', message: `${crew.unit} already has ${overlaps.map((c) => c.callNumber).join(', ')} at that time.` });
  return w;
}

function newCall(req: Request, f: z.infer<typeof callFields>, extra: Partial<Call> = {}): Call {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    callNumber: store.nextCallNumber(),
    version: 1,
    status: 'QUEUED',
    statusTimes: { QUEUED: now },
    ...f,
    pickupTime: f.pickupMode === 'SCHEDULED' ? f.pickupTime : null,
    crewId: null,
    scheduledStart: null,
    cancelReason: '',
    linkedCallId: null,
    leg: 'ONE_WAY',
    seriesId: null,
    patientId: null,
    loadedMiles: null,
    history: [{ ts: now, actor: actor(req), action: 'Created' }],
    createdAt: now,
    createdBy: actor(req),
    updatedAt: now,
    updatedBy: actor(req),
    ...extra,
  } as Call;
}

// ---------- Auth ----------

api.post('/auth/login', (req, res) => {
  const parsed = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION' });
  const { username, password } = parsed.data;
  const keys = [`ip:${req.ip}`, `u:${username.toLowerCase()}`];
  if (loginThrottled(keys)) {
    audit({ user: username, role: '-', action: 'LOGIN', outcome: 'denied', ip: req.ip, detail: 'throttled' });
    return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many failed sign-ins. Try again in 15 minutes.' });
  }
  const u = findUser(username);
  if (!u || !verifyPassword(password, u.passwordHash)) {
    recordLoginFailure(keys);
    audit({ user: username, role: '-', action: 'LOGIN', outcome: 'failure', ip: req.ip });
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Incorrect username or password.' });
  }
  const user = { username: u.username, displayName: u.displayName, role: u.role, crewId: u.crewId ?? null };
  const token = createSession(user);
  setSessionCookie(res, token);
  audit({ user: u.username, role: u.role, action: 'LOGIN', outcome: 'success', ip: req.ip });
  const s = checkSession(token, false);
  res.json(s.ok ? sessionInfo(s.session) : {});
});

api.post('/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const s = checkSession(token, false);
  if (s.ok) audit({ user: s.session.user.username, role: s.session.user.role, action: 'LOGOUT', outcome: 'success', ip: req.ip, detail: String(req.body?.reason || 'user') });
  destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.get('/auth/me', requireAuth(false), (req, res) => {
  const s = checkSession(req.sessionToken, false);
  res.json(s.ok ? sessionInfo(s.session) : {});
});

/** Called by the browser while the dispatcher is actively using the screen. */
api.post('/auth/keepalive', requireAuth(true), (req, res) => {
  const s = checkSession(req.sessionToken, false);
  res.json(s.ok ? sessionInfo(s.session) : {});
});

api.post('/auth/change-password', requireAuth(), (req, res) => {
  const p = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(200) })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'VALIDATION', message: 'New password must be at least 12 characters.' });
  const u = findUser(req.user!.username);
  if (!u || !verifyPassword(p.data.currentPassword, u.passwordHash)) {
    audit({ ...who(req), action: 'PASSWORD_CHANGE', outcome: 'failure' });
    return res.status(400).json({ error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' });
  }
  u.passwordHash = hashPassword(p.data.newPassword);
  store.save();
  audit({ ...who(req), action: 'PASSWORD_CHANGE', outcome: 'success' });
  res.json({ ok: true });
});

// ---------- Board ----------

/** Board data for a time window: everything still queued plus calls scheduled in [from, to). */
api.post('/board', requireAuth(), requireRole('dispatcher', 'supervisor', 'viewer'), (req, res) => {
  const p = z.object({ from: isoDate, to: isoDate }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const from = Date.parse(p.data.from);
  const to = Date.parse(p.data.to);
  const calls = store.state.calls.filter((c) => {
    if (c.status === 'QUEUED') return true;
    const t = Date.parse(c.scheduledStart || c.pickupTime || c.createdAt);
    return t >= from && t < to;
  });
  audit({ ...who(req), action: 'BOARD_VIEW', outcome: 'success', detail: `calls=${calls.length}` });
  res.json({
    bootId: store.bootId,
    seq: store.seq,
    crews: store.state.crews,
    facilities: store.state.facilities,
    gps: positions(),
    gpsStaleMinutes: config.gps.staleMinutes,
    map: { tileUrl: config.map.tileUrl, attribution: config.map.attribution, center: config.gps.center, zoom: 12 },
    calls: calls.map((c) => forRole(summarize(c), req.user!.role)),
  });
});

/** Polling fallback for networks/hosts where WebSockets are blocked. Not counted as activity. */
api.get('/changes', requireAuth(false), requireRole('dispatcher', 'supervisor', 'viewer'), (req, res) => {
  const since = Number(req.query.since);
  const boot = String(req.query.boot || '');
  if (boot !== store.bootId || !Number.isFinite(since)) return res.json({ reset: true });
  const events = store.eventsSince(since);
  if (!events) return res.json({ reset: true });
  const role = req.user!.role;
  res.json({
    seq: store.seq,
    events: events.map((e) => (e.type === 'call' ? { ...e, call: forRole(e.call, role) } : e)),
    gps: positions(),
  });
});

// ---------- Calls ----------

api.post('/calls', requireAuth(), requireRole('dispatcher', 'supervisor'), (req, res) => {
  const p = createSchema.safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const { returnTrip, recurrence, patientId: wantedPatient, ...fields } = p.data;
  const patient = resolvePatient(req, wantedPatient, fields);
  if (!patient) return res.status(404).json({ error: 'NOT_FOUND', message: 'Patient record not found.' });

  // Dates for the trip(s): the first one, plus recurrences (same time of day).
  const dates: (Date | null)[] = [fields.pickupTime ? new Date(fields.pickupTime) : null];
  if (recurrence && fields.pickupTime) {
    const base = new Date(fields.pickupTime);
    for (let i = 1; i < recurrence.weeks * 7 && dates.length < 40; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      if (recurrence.weekdays.includes(d.getDay())) dates.push(d);
    }
  }
  const seriesId = recurrence ? crypto.randomUUID() : null;
  const created: Call[] = [];
  for (const d of dates) {
    const shift = d && fields.pickupTime ? d.getTime() - Date.parse(fields.pickupTime) : 0;
    const out = newCall(req, { ...fields, pickupTime: d ? d.toISOString() : null }, { seriesId, patientId: patient.id });
    created.push(out);
    if (returnTrip) {
      const ret = newCall(
        req,
        {
          ...fields,
          pickupLocation: fields.destination,
          destination: fields.pickupLocation,
          pickupMode: returnTrip.mode,
          pickupTime: returnTrip.mode === 'SCHEDULED' && returnTrip.pickupTime ? new Date(Date.parse(returnTrip.pickupTime) + shift).toISOString() : null,
        },
        { seriesId, leg: 'RETURN', linkedCallId: out.id, patientId: patient.id },
      );
      out.leg = 'OUTBOUND';
      out.linkedCallId = ret.id;
      created.push(ret);
    }
  }
  for (const c of created) {
    store.state.calls.push(c);
    store.emit({ type: 'call', action: 'created', actor: actor(req), call: summarize(c) });
    audit({ ...who(req), action: 'CALL_CREATE', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: c.seriesId ? 'recurring' : undefined });
  }
  store.save();
  res.status(201).json({ calls: created.map(summarize), patientId: patient.id });
});

/** Full record including PHI. Every access is audited. */
api.get('/calls/:id', requireAuth(), requireRole('dispatcher', 'supervisor'), (req, res) => {
  const c = store.call(req.params.id);
  if (!c) return res.status(404).json({ error: 'NOT_FOUND' });
  audit({ ...who(req), action: 'CALL_VIEW_PHI', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success' });
  res.json({ call: c });
});

/** Search by call number or patient name. POST so names never appear in URLs or access logs. */
api.post('/calls/search', requireAuth(), requireRole('dispatcher', 'supervisor'), (req, res) => {
  const p = z.object({ q: z.string().trim().min(2).max(60) }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const q = p.data.q.toLowerCase();
  const hits = store.state.calls
    .filter(
      (c) =>
        c.callNumber.toLowerCase().includes(q) ||
        c.patient.lastName.toLowerCase().includes(q) ||
        `${c.patient.firstName} ${c.patient.lastName}`.toLowerCase().includes(q),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
  audit({ ...who(req), action: 'CALL_SEARCH', outcome: 'success', detail: `results=${hits.length}` });
  res.json({ calls: hits.map(summarize) });
});

api.patch('/calls/:id', requireAuth(), requireRole('dispatcher', 'supervisor'), (req, res) => {
  const p = updateSchema.safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const c = store.call(req.params.id);
  if (!c) return res.status(404).json({ error: 'NOT_FOUND' });
  const { expectedVersion, ...changes } = p.data;
  if (versionConflict(req, res, c, expectedVersion, 'CALL_UPDATE')) return;
  const mode = changes.pickupMode ?? c.pickupMode;
  const time = changes.pickupTime !== undefined ? changes.pickupTime : c.pickupTime;
  if (mode === 'SCHEDULED' && !time) return res.status(400).json({ error: 'VALIDATION', issues: [{ path: 'pickupTime', message: 'Pickup time is required' }] });
  const fields = Object.keys(changes).filter((k) => JSON.stringify((changes as never)[k]) !== JSON.stringify((c as never)[k]));
  Object.assign(c, changes);
  if (c.pickupMode !== 'SCHEDULED') c.pickupTime = null;
  commit(req, c, 'Edited', fields.length ? `fields: ${fields.join(', ')}` : undefined);
  audit({ ...who(req), action: 'CALL_UPDATE', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: `fields=${fields.join(',')}` });
  res.json({ call: c, summary: summarize(c) });
});

api.post('/calls/:id/assign', requireAuth(), requireRole('dispatcher', 'supervisor'), (req, res) => {
  const p = z
    .object({ crewId: z.string(), start: isoDate, expectedVersion: z.number().int(), acknowledge: z.array(z.string()).default([]) })
    .safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const c = store.call(req.params.id);
  const crew = store.crew(p.data.crewId);
  if (!c || !crew) return res.status(404).json({ error: 'NOT_FOUND' });
  if (versionConflict(req, res, c, p.data.expectedVersion, 'CALL_ASSIGN')) return;
  if (c.status === 'COMPLETED' || c.status === 'CANCELLED')
    return res.status(400).json({ error: 'INVALID_STATE', message: `Call ${c.callNumber} is ${STATUSES[c.status].toLowerCase()}.` });
  const start = new Date(p.data.start);
  const warnings = assignWarnings(c, crew, start).filter((w) => !p.data.acknowledge.includes(w.code));
  if (warnings.length) return res.status(422).json({ error: 'NEEDS_ACK', warnings });
  const moved = c.crewId && c.crewId !== crew.id;
  const prevCrewId = c.crewId;
  const prev = c.crewId ? store.crew(c.crewId)?.unit : null;
  c.crewId = crew.id;
  c.scheduledStart = start.toISOString();
  if (c.status === 'QUEUED') setStatus(c, 'ASSIGNED');
  const acks = p.data.acknowledge.length ? ` (acknowledged: ${p.data.acknowledge.join(', ')})` : '';
  commit(req, c, moved ? 'Reassigned' : 'Assigned', `${moved ? `${prev} -> ` : ''}${crew.unit} at ${start.toISOString()}${acks}`, prevCrewId);
  audit({ ...who(req), action: 'CALL_ASSIGN', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: `crew=${crew.unit}${acks}` });
  res.json({ call: summarize(c) });
});

api.post('/calls/:id/unassign', requireAuth(), requireRole('dispatcher', 'supervisor'), (req, res) => {
  const p = versionOnly.safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const c = store.call(req.params.id);
  if (!c) return res.status(404).json({ error: 'NOT_FOUND' });
  if (versionConflict(req, res, c, p.data.expectedVersion, 'CALL_UNASSIGN')) return;
  if (ACTIVE_STATUSES.includes(c.status) || c.status === 'COMPLETED')
    return res.status(400).json({ error: 'INVALID_STATE', message: `Call ${c.callNumber} is already ${STATUSES[c.status].toLowerCase()}; it can't go back to the queue.` });
  const prev = c.crewId ? store.crew(c.crewId)?.unit : '';
  const prevCrewId = c.crewId;
  c.crewId = null;
  c.scheduledStart = null;
  setStatus(c, 'QUEUED');
  commit(req, c, 'Returned to queue', prev ? `from ${prev}` : undefined, prevCrewId);
  audit({ ...who(req), action: 'CALL_UNASSIGN', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success' });
  res.json({ call: summarize(c) });
});

api.post('/calls/:id/status', requireAuth(), requireRole('dispatcher', 'supervisor', 'crew'), (req, res) => {
  const p = z
    .object({
      status: z.enum(['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION', 'COMPLETED', 'CANCELLED', 'ASSIGNED']),
      expectedVersion: z.number().int(),
      reason: z.string().trim().max(200).default(''),
    })
    .safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const c = store.call(req.params.id);
  if (!c) return res.status(404).json({ error: 'NOT_FOUND' });
  if (versionConflict(req, res, c, p.data.expectedVersion, 'CALL_STATUS')) return;
  const { status, reason } = p.data;
  if (req.user!.role === 'crew') {
    // Crews may only move their own trips forward through the normal workflow.
    const allowed = ['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION', 'COMPLETED'];
    if (c.crewId !== req.user!.crewId || !allowed.includes(status) || c.status === 'COMPLETED' || c.status === 'CANCELLED') {
      audit({ ...who(req), action: 'CALL_STATUS', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'denied' });
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Crews can only update their own active trips.' });
    }
  }
  if (status === 'CANCELLED' && !reason) return res.status(400).json({ error: 'VALIDATION', message: 'A cancellation reason is required.' });
  if (status !== 'CANCELLED' && !c.crewId) return res.status(400).json({ error: 'INVALID_STATE', message: 'Assign a crew first.' });
  if (c.status === 'COMPLETED' || c.status === 'CANCELLED') {
    if (req.user!.role !== 'supervisor')
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only a supervisor can reopen a closed call.' });
  }
  setStatus(c, status);
  if (status === 'CANCELLED') c.cancelReason = reason;
  if ((status === 'AT_DESTINATION' || status === 'COMPLETED') && c.loadedMiles == null && c.crewId) {
    c.loadedMiles = milesSince(c.crewId, c.statusTimes.TRANSPORTING);
  }
  commit(req, c, `Status: ${STATUSES[status]}`, status === 'CANCELLED' ? `reason: ${reason}` : undefined);
  audit({ ...who(req), action: 'CALL_STATUS', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: `status=${status}` });
  res.json({ call: summarize(c) });
});

// ---------- Crews ----------

api.patch('/crews/:id', requireAuth(), requireRole('dispatcher', 'supervisor'), (req, res) => {
  const p = z
    .object({ expectedVersion: z.number().int(), outOfService: z.boolean(), oosReason: z.string().trim().max(120).default('') })
    .safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const crew = store.crew(req.params.id);
  if (!crew) return res.status(404).json({ error: 'NOT_FOUND' });
  if (crew.version !== p.data.expectedVersion)
    return res.status(409).json({ error: 'VERSION_CONFLICT', message: `${crew.unit} was just changed by another dispatcher.`, crew });
  crew.outOfService = p.data.outOfService;
  crew.oosReason = p.data.outOfService ? p.data.oosReason : '';
  crew.version++;
  store.save();
  store.emit({ type: 'crew', action: crew.outOfService ? 'out of service' : 'back in service', actor: actor(req), crew });
  audit({ ...who(req), action: 'CREW_STATUS', entityType: 'crew', entityId: crew.id, outcome: 'success', detail: crew.outOfService ? 'OOS' : 'in service' });
  res.json({ crew });
});

// ---------- Supervisor ----------

api.get('/audit', requireAuth(), requireRole('supervisor'), (req, res) => {
  audit({ ...who(req), action: 'AUDIT_VIEW', outcome: 'success' });
  res.json({ entries: readAudit(500) });
});

/** Replaces all calls/crews with fresh sample data for today (demo only). */
api.post('/admin/reset-sample', requireAuth(), requireRole('supervisor'), (req, res) => {
  if (!config.seedSampleData) return res.status(403).json({ error: 'FORBIDDEN', message: 'Sample data is disabled on this server.' });
  const fresh = seedState();
  store.state.calls = fresh.calls;
  store.state.crews = fresh.crews;
  store.state.facilities = fresh.facilities;
  store.state.patients = fresh.patients;
  store.state.nextPatientNumber = fresh.nextPatientNumber;
  store.saveNow();
  audit({ ...who(req), action: 'SAMPLE_DATA_RESET', outcome: 'success' });
  store.emit({ type: 'reset', actor: actor(req) });
  res.json({ ok: true });
});
