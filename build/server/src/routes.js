"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
exports.commit = commit;
exports.assignWarnings = assignWarnings;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const types_1 = require("../../shared/types");
const audit_1 = require("./audit");
const auth_1 = require("./auth");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
const seed_1 = require("./seed");
const gps_1 = require("./gps");
const http_1 = require("./http");
const patients_1 = require("./patients");
const store_1 = require("./store");
exports.api = express_1.default.Router();
const tripTypes = Object.keys(types_1.TRIP_TYPES);
const equipment = Object.keys(types_1.EQUIPMENT);
const isoDate = zod_1.z.string().datetime({ offset: true });
const callFields = zod_1.z.object({
    level: zod_1.z.enum(['ALS', 'BLS']),
    tripType: zod_1.z.enum(tripTypes),
    patient: zod_1.z.object({
        firstName: zod_1.z.string().trim().min(1).max(50),
        lastName: zod_1.z.string().trim().min(1).max(50),
        dob: zod_1.z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d) < new Date() && new Date(d) > new Date('1900-01-01'), 'Invalid date of birth'),
        weightLbs: zod_1.z.number().int().min(1).max(1500),
    }),
    insurance: zod_1.z.object({
        payer: zod_1.z.string().trim().min(1).max(80),
        memberId: zod_1.z.string().trim().max(40).default(''),
        priorAuth: zod_1.z.string().trim().max(40).default(''),
    }),
    pcsOnFile: zod_1.z.boolean().default(false),
    equipment: zod_1.z.array(zod_1.z.enum(equipment)).max(equipment.length).default([]),
    chiefComplaint: zod_1.z.string().trim().min(1).max(300),
    stretcherReason: zod_1.z.string().trim().min(1).max(500),
    pickupMode: zod_1.z.enum(['ASAP', 'SCHEDULED', 'WILL_CALL']),
    pickupTime: isoDate.nullable().default(null),
    pickupLocation: zod_1.z.string().trim().min(1).max(200),
    destination: zod_1.z.string().trim().min(1).max(200),
    durationMin: zod_1.z.number().int().min(15).max(720),
    notes: zod_1.z.string().trim().max(1000).default(''),
});
const createSchema = callFields
    .extend({
    patientId: zod_1.z.string().uuid().nullable().default(null),
    returnTrip: zod_1.z
        .object({ mode: zod_1.z.enum(['SCHEDULED', 'WILL_CALL']), pickupTime: isoDate.nullable().default(null) })
        .nullable()
        .default(null),
    recurrence: zod_1.z
        .object({ weekdays: zod_1.z.array(zod_1.z.number().int().min(0).max(6)).min(1), weeks: zod_1.z.number().int().min(1).max(8) })
        .nullable()
        .default(null),
})
    .superRefine((v, ctx) => {
    if (v.pickupMode === 'SCHEDULED' && !v.pickupTime)
        ctx.addIssue({ code: 'custom', path: ['pickupTime'], message: 'Pickup time is required' });
    if (v.returnTrip?.mode === 'SCHEDULED' && !v.returnTrip.pickupTime)
        ctx.addIssue({ code: 'custom', path: ['returnTrip', 'pickupTime'], message: 'Return pickup time is required' });
    if (v.recurrence && v.pickupMode !== 'SCHEDULED')
        ctx.addIssue({ code: 'custom', path: ['recurrence'], message: 'Recurring trips need a scheduled pickup time' });
});
const updateSchema = callFields.partial().extend({
    expectedVersion: zod_1.z.number().int(),
    loadedMiles: zod_1.z.number().min(0).max(2000).nullable().optional(),
});
const versionOnly = zod_1.z.object({ expectedVersion: zod_1.z.number().int() });
/** Optimistic concurrency: the client must say which version it was looking at. */
function versionConflict(req, res, call, expected, action) {
    if (call.version === expected)
        return false;
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action, entityType: 'call', entityId: call.id, callNumber: call.callNumber, outcome: 'conflict' });
    res.status(409).json({
        error: 'VERSION_CONFLICT',
        message: `Call ${call.callNumber} was just changed by ${call.updatedBy}. Your board has been refreshed.`,
        call: (0, store_1.summarize)(call),
    });
    return true;
}
function commit(req, call, action, detail, prevCrewId) {
    call.version++;
    call.updatedAt = new Date().toISOString();
    call.updatedBy = (0, http_1.actor)(req);
    call.history.push({ ts: call.updatedAt, actor: (0, http_1.actor)(req), action, detail });
    store_1.store.save();
    store_1.store.emit({ type: 'call', action, actor: (0, http_1.actor)(req), call: (0, store_1.summarize)(call), prevCrewId });
}
function setStatus(call, status) {
    call.status = status;
    call.statusTimes = { ...call.statusTimes, [status]: new Date().toISOString() };
}
const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
const hhmm = (s) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
};
function inShift(crew, t) {
    const s = hhmm(crew.shiftStart);
    const e = hhmm(crew.shiftEnd);
    const m = minutesOfDay(t);
    return e > s ? m >= s && m < e : m >= s || m < e;
}
function assignWarnings(call, crew, start) {
    const w = [];
    if (call.level === 'ALS' && crew.level === 'BLS')
        w.push({ code: 'ALS_TO_BLS', message: `${call.callNumber} is an ALS call but ${crew.unit} is a BLS unit.` });
    if (crew.outOfService)
        w.push({ code: 'CREW_OUT_OF_SERVICE', message: `${crew.unit} is out of service${crew.oosReason ? ` (${crew.oosReason})` : ''}.` });
    const end = new Date(start.getTime() + call.durationMin * 60_000);
    if (!inShift(crew, start) || !inShift(crew, new Date(end.getTime() - 60_000)))
        w.push({ code: 'OUTSIDE_SHIFT', message: `This trip falls outside ${crew.unit}'s shift (${crew.shiftStart}-${crew.shiftEnd}).` });
    const overlaps = store_1.store.state.calls.filter((c) => {
        if (c.id === call.id || c.crewId !== crew.id || !c.scheduledStart)
            return false;
        if (c.status === 'COMPLETED' || c.status === 'CANCELLED')
            return false;
        const cs = new Date(c.scheduledStart).getTime();
        const ce = cs + c.durationMin * 60_000;
        return cs < end.getTime() && start.getTime() < ce;
    });
    if (overlaps.length)
        w.push({ code: 'CREW_OVERLAP', message: `${crew.unit} already has ${overlaps.map((c) => c.callNumber).join(', ')} at that time.` });
    return w;
}
function newCall(req, f, extra = {}) {
    const now = new Date().toISOString();
    return {
        id: node_crypto_1.default.randomUUID(),
        callNumber: store_1.store.nextCallNumber(),
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
        history: [{ ts: now, actor: (0, http_1.actor)(req), action: 'Created' }],
        createdAt: now,
        createdBy: (0, http_1.actor)(req),
        updatedAt: now,
        updatedBy: (0, http_1.actor)(req),
        ...extra,
    };
}
// ---------- Auth ----------
exports.api.post('/auth/login', (req, res) => {
    const parsed = zod_1.z.object({ username: zod_1.z.string().min(1).max(64), password: zod_1.z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'VALIDATION' });
    const { username, password } = parsed.data;
    const keys = [`ip:${req.ip}`, `u:${username.toLowerCase()}`];
    if ((0, auth_1.loginThrottled)(keys)) {
        (0, audit_1.audit)({ user: username, role: '-', action: 'LOGIN', outcome: 'denied', ip: req.ip, detail: 'throttled' });
        return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many failed sign-ins. Try again in 15 minutes.' });
    }
    const u = (0, auth_1.findUser)(username);
    if (!u || !(0, crypto_1.verifyPassword)(password, u.passwordHash)) {
        (0, auth_1.recordLoginFailure)(keys);
        (0, audit_1.audit)({ user: username, role: '-', action: 'LOGIN', outcome: 'failure', ip: req.ip });
        return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Incorrect username or password.' });
    }
    const user = { username: u.username, displayName: u.displayName, role: u.role, crewId: u.crewId ?? null };
    const token = (0, auth_1.createSession)(user);
    (0, auth_1.setSessionCookie)(res, token);
    (0, audit_1.audit)({ user: u.username, role: u.role, action: 'LOGIN', outcome: 'success', ip: req.ip });
    const s = (0, auth_1.checkSession)(token, false);
    res.json(s.ok ? (0, auth_1.sessionInfo)(s.session) : {});
});
exports.api.post('/auth/logout', (req, res) => {
    const token = (0, auth_1.parseCookies)(req.headers.cookie)[auth_1.COOKIE];
    const s = (0, auth_1.checkSession)(token, false);
    if (s.ok)
        (0, audit_1.audit)({ user: s.session.user.username, role: s.session.user.role, action: 'LOGOUT', outcome: 'success', ip: req.ip, detail: String(req.body?.reason || 'user') });
    (0, auth_1.destroySession)(token);
    (0, auth_1.clearSessionCookie)(res);
    res.json({ ok: true });
});
exports.api.get('/auth/me', (0, auth_1.requireAuth)(false), (req, res) => {
    const s = (0, auth_1.checkSession)(req.sessionToken, false);
    res.json(s.ok ? (0, auth_1.sessionInfo)(s.session) : {});
});
/** Called by the browser while the dispatcher is actively using the screen. */
exports.api.post('/auth/keepalive', (0, auth_1.requireAuth)(true), (req, res) => {
    const s = (0, auth_1.checkSession)(req.sessionToken, false);
    res.json(s.ok ? (0, auth_1.sessionInfo)(s.session) : {});
});
exports.api.post('/auth/change-password', (0, auth_1.requireAuth)(), (req, res) => {
    const p = zod_1.z
        .object({ currentPassword: zod_1.z.string().min(1), newPassword: zod_1.z.string().min(12).max(200) })
        .safeParse(req.body);
    if (!p.success)
        return res.status(400).json({ error: 'VALIDATION', message: 'New password must be at least 12 characters.' });
    const u = (0, auth_1.findUser)(req.user.username);
    if (!u || !(0, crypto_1.verifyPassword)(p.data.currentPassword, u.passwordHash)) {
        (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PASSWORD_CHANGE', outcome: 'failure' });
        return res.status(400).json({ error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' });
    }
    u.passwordHash = (0, crypto_1.hashPassword)(p.data.newPassword);
    store_1.store.save();
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PASSWORD_CHANGE', outcome: 'success' });
    res.json({ ok: true });
});
// ---------- Board ----------
/** Board data for a time window: everything still queued plus calls scheduled in [from, to). */
exports.api.post('/board', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor', 'viewer'), (req, res) => {
    const p = zod_1.z.object({ from: isoDate, to: isoDate }).safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const from = Date.parse(p.data.from);
    const to = Date.parse(p.data.to);
    const calls = store_1.store.state.calls.filter((c) => {
        if (c.status === 'QUEUED')
            return true;
        const t = Date.parse(c.scheduledStart || c.pickupTime || c.createdAt);
        return t >= from && t < to;
    });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'BOARD_VIEW', outcome: 'success', detail: `calls=${calls.length}` });
    res.json({
        bootId: store_1.store.bootId,
        seq: store_1.store.seq,
        crews: store_1.store.state.crews,
        facilities: store_1.store.state.facilities,
        gps: (0, gps_1.positions)(),
        gpsStaleMinutes: config_1.config.gps.staleMinutes,
        map: { tileUrl: config_1.config.map.tileUrl, attribution: config_1.config.map.attribution, center: config_1.config.gps.center, zoom: 12 },
        calls: calls.map((c) => (0, store_1.forRole)((0, store_1.summarize)(c), req.user.role)),
    });
});
/** Polling fallback for networks/hosts where WebSockets are blocked. Not counted as activity. */
exports.api.get('/changes', (0, auth_1.requireAuth)(false), (0, auth_1.requireRole)('dispatcher', 'supervisor', 'viewer'), (req, res) => {
    const since = Number(req.query.since);
    const boot = String(req.query.boot || '');
    if (boot !== store_1.store.bootId || !Number.isFinite(since))
        return res.json({ reset: true });
    const events = store_1.store.eventsSince(since);
    if (!events)
        return res.json({ reset: true });
    const role = req.user.role;
    res.json({
        seq: store_1.store.seq,
        events: events.map((e) => (e.type === 'call' ? { ...e, call: (0, store_1.forRole)(e.call, role) } : e)),
        gps: (0, gps_1.positions)(),
    });
});
// ---------- Calls ----------
exports.api.post('/calls', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor'), (req, res) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const { returnTrip, recurrence, patientId: wantedPatient, ...fields } = p.data;
    const patient = (0, patients_1.resolvePatient)(req, wantedPatient, fields);
    if (!patient)
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Patient record not found.' });
    // Dates for the trip(s): the first one, plus recurrences (same time of day).
    const dates = [fields.pickupTime ? new Date(fields.pickupTime) : null];
    if (recurrence && fields.pickupTime) {
        const base = new Date(fields.pickupTime);
        for (let i = 1; i < recurrence.weeks * 7 && dates.length < 40; i++) {
            const d = new Date(base);
            d.setDate(d.getDate() + i);
            if (recurrence.weekdays.includes(d.getDay()))
                dates.push(d);
        }
    }
    const seriesId = recurrence ? node_crypto_1.default.randomUUID() : null;
    const created = [];
    for (const d of dates) {
        const shift = d && fields.pickupTime ? d.getTime() - Date.parse(fields.pickupTime) : 0;
        const out = newCall(req, { ...fields, pickupTime: d ? d.toISOString() : null }, { seriesId, patientId: patient.id });
        created.push(out);
        if (returnTrip) {
            const ret = newCall(req, {
                ...fields,
                pickupLocation: fields.destination,
                destination: fields.pickupLocation,
                pickupMode: returnTrip.mode,
                pickupTime: returnTrip.mode === 'SCHEDULED' && returnTrip.pickupTime ? new Date(Date.parse(returnTrip.pickupTime) + shift).toISOString() : null,
            }, { seriesId, leg: 'RETURN', linkedCallId: out.id, patientId: patient.id });
            out.leg = 'OUTBOUND';
            out.linkedCallId = ret.id;
            created.push(ret);
        }
    }
    for (const c of created) {
        store_1.store.state.calls.push(c);
        store_1.store.emit({ type: 'call', action: 'created', actor: (0, http_1.actor)(req), call: (0, store_1.summarize)(c) });
        (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_CREATE', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: c.seriesId ? 'recurring' : undefined });
    }
    store_1.store.save();
    res.status(201).json({ calls: created.map(store_1.summarize), patientId: patient.id });
});
/** Full record including PHI. Every access is audited. */
exports.api.get('/calls/:id', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor'), (req, res) => {
    const c = store_1.store.call(req.params.id);
    if (!c)
        return res.status(404).json({ error: 'NOT_FOUND' });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_VIEW_PHI', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success' });
    res.json({ call: c });
});
/** Search by call number or patient name. POST so names never appear in URLs or access logs. */
exports.api.post('/calls/search', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor'), (req, res) => {
    const p = zod_1.z.object({ q: zod_1.z.string().trim().min(2).max(60) }).safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const q = p.data.q.toLowerCase();
    const hits = store_1.store.state.calls
        .filter((c) => c.callNumber.toLowerCase().includes(q) ||
        c.patient.lastName.toLowerCase().includes(q) ||
        `${c.patient.firstName} ${c.patient.lastName}`.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50);
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_SEARCH', outcome: 'success', detail: `results=${hits.length}` });
    res.json({ calls: hits.map(store_1.summarize) });
});
exports.api.patch('/calls/:id', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor'), (req, res) => {
    const p = updateSchema.safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const c = store_1.store.call(req.params.id);
    if (!c)
        return res.status(404).json({ error: 'NOT_FOUND' });
    const { expectedVersion, ...changes } = p.data;
    if (versionConflict(req, res, c, expectedVersion, 'CALL_UPDATE'))
        return;
    const mode = changes.pickupMode ?? c.pickupMode;
    const time = changes.pickupTime !== undefined ? changes.pickupTime : c.pickupTime;
    if (mode === 'SCHEDULED' && !time)
        return res.status(400).json({ error: 'VALIDATION', issues: [{ path: 'pickupTime', message: 'Pickup time is required' }] });
    const fields = Object.keys(changes).filter((k) => JSON.stringify(changes[k]) !== JSON.stringify(c[k]));
    Object.assign(c, changes);
    if (c.pickupMode !== 'SCHEDULED')
        c.pickupTime = null;
    commit(req, c, 'Edited', fields.length ? `fields: ${fields.join(', ')}` : undefined);
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_UPDATE', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: `fields=${fields.join(',')}` });
    res.json({ call: c, summary: (0, store_1.summarize)(c) });
});
exports.api.post('/calls/:id/assign', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor'), (req, res) => {
    const p = zod_1.z
        .object({ crewId: zod_1.z.string(), start: isoDate, expectedVersion: zod_1.z.number().int(), acknowledge: zod_1.z.array(zod_1.z.string()).default([]) })
        .safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const c = store_1.store.call(req.params.id);
    const crew = store_1.store.crew(p.data.crewId);
    if (!c || !crew)
        return res.status(404).json({ error: 'NOT_FOUND' });
    if (versionConflict(req, res, c, p.data.expectedVersion, 'CALL_ASSIGN'))
        return;
    if (c.status === 'COMPLETED' || c.status === 'CANCELLED')
        return res.status(400).json({ error: 'INVALID_STATE', message: `Call ${c.callNumber} is ${types_1.STATUSES[c.status].toLowerCase()}.` });
    const start = new Date(p.data.start);
    const warnings = assignWarnings(c, crew, start).filter((w) => !p.data.acknowledge.includes(w.code));
    if (warnings.length)
        return res.status(422).json({ error: 'NEEDS_ACK', warnings });
    const moved = c.crewId && c.crewId !== crew.id;
    const prevCrewId = c.crewId;
    const prev = c.crewId ? store_1.store.crew(c.crewId)?.unit : null;
    c.crewId = crew.id;
    c.scheduledStart = start.toISOString();
    if (c.status === 'QUEUED')
        setStatus(c, 'ASSIGNED');
    const acks = p.data.acknowledge.length ? ` (acknowledged: ${p.data.acknowledge.join(', ')})` : '';
    commit(req, c, moved ? 'Reassigned' : 'Assigned', `${moved ? `${prev} -> ` : ''}${crew.unit} at ${start.toISOString()}${acks}`, prevCrewId);
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_ASSIGN', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: `crew=${crew.unit}${acks}` });
    res.json({ call: (0, store_1.summarize)(c) });
});
exports.api.post('/calls/:id/unassign', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor'), (req, res) => {
    const p = versionOnly.safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const c = store_1.store.call(req.params.id);
    if (!c)
        return res.status(404).json({ error: 'NOT_FOUND' });
    if (versionConflict(req, res, c, p.data.expectedVersion, 'CALL_UNASSIGN'))
        return;
    if (types_1.ACTIVE_STATUSES.includes(c.status) || c.status === 'COMPLETED')
        return res.status(400).json({ error: 'INVALID_STATE', message: `Call ${c.callNumber} is already ${types_1.STATUSES[c.status].toLowerCase()}; it can't go back to the queue.` });
    const prev = c.crewId ? store_1.store.crew(c.crewId)?.unit : '';
    const prevCrewId = c.crewId;
    c.crewId = null;
    c.scheduledStart = null;
    setStatus(c, 'QUEUED');
    commit(req, c, 'Returned to queue', prev ? `from ${prev}` : undefined, prevCrewId);
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_UNASSIGN', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success' });
    res.json({ call: (0, store_1.summarize)(c) });
});
exports.api.post('/calls/:id/status', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor', 'crew'), (req, res) => {
    const p = zod_1.z
        .object({
        status: zod_1.z.enum(['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION', 'COMPLETED', 'CANCELLED', 'ASSIGNED']),
        expectedVersion: zod_1.z.number().int(),
        reason: zod_1.z.string().trim().max(200).default(''),
    })
        .safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const c = store_1.store.call(req.params.id);
    if (!c)
        return res.status(404).json({ error: 'NOT_FOUND' });
    if (versionConflict(req, res, c, p.data.expectedVersion, 'CALL_STATUS'))
        return;
    const { status, reason } = p.data;
    if (req.user.role === 'crew') {
        // Crews may only move their own trips forward through the normal workflow.
        const allowed = ['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION', 'COMPLETED'];
        if (c.crewId !== req.user.crewId || !allowed.includes(status) || c.status === 'COMPLETED' || c.status === 'CANCELLED') {
            (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_STATUS', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'denied' });
            return res.status(403).json({ error: 'FORBIDDEN', message: 'Crews can only update their own active trips.' });
        }
    }
    if (status === 'CANCELLED' && !reason)
        return res.status(400).json({ error: 'VALIDATION', message: 'A cancellation reason is required.' });
    if (status !== 'CANCELLED' && !c.crewId)
        return res.status(400).json({ error: 'INVALID_STATE', message: 'Assign a crew first.' });
    if (c.status === 'COMPLETED' || c.status === 'CANCELLED') {
        if (req.user.role !== 'supervisor')
            return res.status(403).json({ error: 'FORBIDDEN', message: 'Only a supervisor can reopen a closed call.' });
    }
    setStatus(c, status);
    if (status === 'CANCELLED')
        c.cancelReason = reason;
    if ((status === 'AT_DESTINATION' || status === 'COMPLETED') && c.loadedMiles == null && c.crewId) {
        c.loadedMiles = (0, gps_1.milesSince)(c.crewId, c.statusTimes.TRANSPORTING);
    }
    commit(req, c, `Status: ${types_1.STATUSES[status]}`, status === 'CANCELLED' ? `reason: ${reason}` : undefined);
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CALL_STATUS', entityType: 'call', entityId: c.id, callNumber: c.callNumber, outcome: 'success', detail: `status=${status}` });
    res.json({ call: (0, store_1.summarize)(c) });
});
// ---------- Crews ----------
exports.api.patch('/crews/:id', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor'), (req, res) => {
    const p = zod_1.z
        .object({ expectedVersion: zod_1.z.number().int(), outOfService: zod_1.z.boolean(), oosReason: zod_1.z.string().trim().max(120).default('') })
        .safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const crew = store_1.store.crew(req.params.id);
    if (!crew)
        return res.status(404).json({ error: 'NOT_FOUND' });
    if (crew.version !== p.data.expectedVersion)
        return res.status(409).json({ error: 'VERSION_CONFLICT', message: `${crew.unit} was just changed by another dispatcher.`, crew });
    crew.outOfService = p.data.outOfService;
    crew.oosReason = p.data.outOfService ? p.data.oosReason : '';
    crew.version++;
    store_1.store.save();
    store_1.store.emit({ type: 'crew', action: crew.outOfService ? 'out of service' : 'back in service', actor: (0, http_1.actor)(req), crew });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CREW_STATUS', entityType: 'crew', entityId: crew.id, outcome: 'success', detail: crew.outOfService ? 'OOS' : 'in service' });
    res.json({ crew });
});
// ---------- Supervisor ----------
exports.api.get('/audit', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('supervisor'), (req, res) => {
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'AUDIT_VIEW', outcome: 'success' });
    res.json({ entries: (0, audit_1.readAudit)(500) });
});
/** Replaces all calls/crews with fresh sample data for today (demo only). */
exports.api.post('/admin/reset-sample', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('supervisor'), (req, res) => {
    if (!config_1.config.seedSampleData)
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Sample data is disabled on this server.' });
    const fresh = (0, seed_1.seedState)();
    store_1.store.state.calls = fresh.calls;
    store_1.store.state.crews = fresh.crews;
    store_1.store.state.facilities = fresh.facilities;
    store_1.store.state.patients = fresh.patients;
    store_1.store.state.nextPatientNumber = fresh.nextPatientNumber;
    store_1.store.saveNow();
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'SAMPLE_DATA_RESET', outcome: 'success' });
    store_1.store.emit({ type: 'reset', actor: (0, http_1.actor)(req) });
    res.json({ ok: true });
});
