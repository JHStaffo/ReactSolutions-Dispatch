"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gpsIngestApi = exports.featuresApi = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const types_1 = require("../../shared/types");
const audit_1 = require("./audit");
const auth_1 = require("./auth");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
const gps_1 = require("./gps");
const http_1 = require("./http");
const log_1 = require("./log");
const store_1 = require("./store");
exports.featuresApi = express_1.default.Router();
const staff = [(0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor')];
const supervisor = [(0, auth_1.requireAuth)(), (0, auth_1.requireRole)('supervisor')];
const isoDate = zod_1.z.string().datetime({ offset: true });
const when = (c) => c.scheduledStart || c.pickupTime || c.createdAt;
// ======================= Facilities (address book) =======================
const facilityFields = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    kind: zod_1.z.enum(types_1.FACILITY_KINDS),
    address: zod_1.z.string().trim().max(200).default(''),
    phone: zod_1.z.string().trim().max(30).default(''),
    lat: zod_1.z.number().min(-90).max(90).nullable().default(null),
    lon: zod_1.z.number().min(-180).max(180).nullable().default(null),
});
function emitFacilities(req) {
    store_1.store.save();
    store_1.store.emit({ type: 'facilities', facilities: store_1.store.state.facilities });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'FACILITY_CHANGE', outcome: 'success' });
}
exports.featuresApi.post('/facilities', ...staff, (req, res) => {
    const v = facilityFields.safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    if (store_1.store.state.facilities.some((f) => f.name.toLowerCase() === v.data.name.toLowerCase()))
        return res.status(409).json({ error: 'DUPLICATE', message: 'A facility with that name already exists.' });
    const f = { id: node_crypto_1.default.randomUUID(), ...v.data };
    store_1.store.state.facilities.push(f);
    emitFacilities(req);
    res.status(201).json({ facility: f });
});
exports.featuresApi.put('/facilities/:id', ...staff, (req, res) => {
    const v = facilityFields.safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const f = store_1.store.state.facilities.find((x) => x.id === req.params.id);
    if (!f)
        return res.status(404).json({ error: 'NOT_FOUND' });
    Object.assign(f, v.data);
    emitFacilities(req);
    res.json({ facility: f });
});
exports.featuresApi.delete('/facilities/:id', ...staff, (req, res) => {
    const before = store_1.store.state.facilities.length;
    store_1.store.state.facilities = store_1.store.state.facilities.filter((x) => x.id !== req.params.id);
    if (store_1.store.state.facilities.length === before)
        return res.status(404).json({ error: 'NOT_FOUND' });
    emitFacilities(req);
    res.json({ ok: true });
});
// ======================= Crew (mobile) screen =======================
/** A crew's own trips: yesterday through tomorrow. Crew members see what they need to treat and transport. */
exports.featuresApi.get('/crew/my-trips', (0, auth_1.requireAuth)(), (0, auth_1.requireRole)('crew'), (req, res) => {
    const crewId = req.user.crewId;
    const crew = crewId ? store_1.store.crew(crewId) : undefined;
    if (!crew)
        return res.status(400).json({ error: 'NO_CREW', message: 'This account is not linked to a crew. Ask a supervisor.' });
    const from = Date.now() - 18 * 3600_000;
    const to = Date.now() + 36 * 3600_000;
    const trips = store_1.store.state.calls
        .filter((c) => c.crewId === crew.id && c.status !== 'CANCELLED')
        .filter((c) => {
        const t = Date.parse(when(c));
        return (t >= from && t <= to) || ['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION'].includes(c.status);
    })
        .sort((a, b) => when(a).localeCompare(when(b)))
        .map((c) => ({
        ...(0, store_1.summarize)(c),
        patientName: `${c.patient.lastName}, ${c.patient.firstName}`,
        chiefComplaint: c.chiefComplaint,
        stretcherReason: c.stretcherReason,
        notes: c.notes,
        pickupPhone: store_1.store.state.facilities.find((f) => f.name === c.pickupLocation)?.phone ?? '',
        destinationPhone: store_1.store.state.facilities.find((f) => f.name === c.destination)?.phone ?? '',
    }));
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CREW_TRIPS_VIEW', entityType: 'crew', entityId: crew.id, outcome: 'success', detail: `trips=${trips.length}` });
    res.json({ crew, trips });
});
/** Phone-as-GPS fallback for trucks without a tracker (or when it's offline). */
exports.featuresApi.post('/crew/location', (0, auth_1.requireAuth)(false), (0, auth_1.requireRole)('crew'), (req, res) => {
    const v = zod_1.z.object({ lat: zod_1.z.number(), lon: zod_1.z.number(), speedMph: zod_1.z.number().min(0).max(200).nullable().default(null), heading: zod_1.z.number().nullable().default(null) }).safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const crew = req.user.crewId ? store_1.store.crew(req.user.crewId) : undefined;
    if (!crew)
        return res.status(400).json({ error: 'NO_CREW' });
    if (!crew.gpsDeviceId) {
        crew.gpsDeviceId = `PHONE-${crew.id}`;
        crew.version++;
        store_1.store.save();
    }
    (0, gps_1.ingest)([{ deviceId: crew.gpsDeviceId, lat: v.data.lat, lon: v.data.lon, speedMph: v.data.speedMph ?? 0, heading: v.data.heading ?? 0 }], 'phone');
    res.json({ ok: true });
});
// ======================= GPS =======================
exports.featuresApi.get('/gps', (0, auth_1.requireAuth)(false), (0, auth_1.requireRole)('dispatcher', 'supervisor', 'viewer'), (_req, res) => {
    res.json({ positions: (0, gps_1.positions)(), staleMinutes: config_1.config.gps.staleMinutes });
});
/**
 * Webhook for third-party GPS units. Not tied to a user session; authenticated by GPS_INGEST_KEY.
 * Mounted outside the CSRF check because it is called server-to-server.
 *   POST /api/gps/ingest?format=generic   { deviceId, lat, lon, speedMph?, heading?, timestamp? }  (or an array)
 *   POST /api/gps/ingest?format=traccar   Traccar position forwarding JSON
 */
exports.gpsIngestApi = express_1.default.Router();
exports.gpsIngestApi.post('/gps/ingest', express_1.default.json({ limit: '256kb' }), (req, res) => {
    const key = req.get('X-GPS-Key') || String(req.query.key || '');
    const expected = config_1.config.gps.ingestKey;
    const ok = !!expected && key.length === expected.length && node_crypto_1.default.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
    if (!ok) {
        (0, log_1.log)('warn', 'GPS ingest rejected', { reason: expected ? 'bad key' : 'GPS_INGEST_KEY not set' });
        return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const format = String(req.query.format || 'generic');
    if (!['generic', 'traccar'].includes(format))
        return res.status(400).json({ error: 'UNKNOWN_FORMAT' });
    const accepted = (0, gps_1.ingest)((0, gps_1.parsePayload)(format, req.body), format);
    res.json({ accepted });
});
// ======================= Reports =======================
const range = zod_1.z.object({ from: isoDate, to: isoDate });
function inRange(from, to) {
    const a = Date.parse(from);
    const b = Date.parse(to);
    return store_1.store.state.calls.filter((c) => {
        const t = Date.parse(when(c));
        return t >= a && t < b;
    });
}
/** Operational statistics. Aggregates only: no patient details. */
exports.featuresApi.post('/reports/summary', ...staff, (req, res) => {
    const v = range.safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const calls = inRange(v.data.from, v.data.to);
    const count = (key) => {
        const m = {};
        for (const c of calls)
            m[key(c)] = (m[key(c)] || 0) + 1;
        return Object.entries(m)
            .map(([k, n]) => ({ key: k, count: n }))
            .sort((a, b) => b.count - a.count);
    };
    const completed = calls.filter((c) => c.status === 'COMPLETED');
    // On time = crew on scene within 15 minutes of the scheduled pickup.
    const scheduled = completed.filter((c) => c.pickupMode === 'SCHEDULED' && c.pickupTime && c.statusTimes.ON_SCENE);
    const onTime = scheduled.filter((c) => Date.parse(c.statusTimes.ON_SCENE) <= Date.parse(c.pickupTime) + 15 * 60_000);
    const asap = completed.filter((c) => c.pickupMode === 'ASAP' && c.statusTimes.ON_SCENE);
    const asapMins = asap.map((c) => (Date.parse(c.statusTimes.ON_SCENE) - Date.parse(c.createdAt)) / 60_000);
    const units = store_1.store.state.crews.map((crew) => {
        const mine = completed.filter((c) => c.crewId === crew.id);
        const busyMin = mine.reduce((s, c) => {
            const a = c.statusTimes.ENROUTE ?? c.scheduledStart;
            const b = c.statusTimes.COMPLETED ?? c.statusTimes.AT_DESTINATION;
            return a && b ? s + Math.max(0, (Date.parse(b) - Date.parse(a)) / 60_000) : s + c.durationMin;
        }, 0);
        return {
            crewId: crew.id,
            unit: crew.unit,
            level: crew.level,
            trips: mine.length,
            busyHours: Math.round((busyMin / 60) * 10) / 10,
            loadedMiles: Math.round(mine.reduce((s, c) => s + (c.loadedMiles ?? 0), 0) * 10) / 10,
        };
    });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'REPORT_VIEW', outcome: 'success', detail: `calls=${calls.length}` });
    res.json({
        total: calls.length,
        completed: completed.length,
        cancelled: calls.filter((c) => c.status === 'CANCELLED').length,
        open: calls.filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status)).length,
        onTimePct: scheduled.length ? Math.round((onTime.length / scheduled.length) * 1000) / 10 : null,
        onTimeBase: scheduled.length,
        asapAvgMin: asapMins.length ? Math.round(asapMins.reduce((a, b) => a + b, 0) / asapMins.length) : null,
        loadedMiles: Math.round(completed.reduce((s, c) => s + (c.loadedMiles ?? 0), 0) * 10) / 10,
        byTripType: count((c) => types_1.TRIP_TYPES[c.tripType]),
        byLevel: count((c) => c.level),
        byPayer: count((c) => c.insurance.payer || 'Unknown'),
        byStatus: count((c) => types_1.STATUSES[c.status]),
        cancelReasons: count((c) => (c.status === 'CANCELLED' ? c.cancelReason || 'No reason' : '')).filter((r) => r.key),
        units,
    });
});
/**
 * Billing export (CSV). Contains PHI, so it is supervisor-only and every export is audited
 * with the number of records. Only completed trips.
 */
exports.featuresApi.post('/exports/billing', ...supervisor, (req, res) => {
    const v = range.safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const rows = inRange(v.data.from, v.data.to)
        .filter((c) => c.status === 'COMPLETED')
        .sort((a, b) => when(a).localeCompare(when(b)))
        .map((c) => {
        const p = store_1.store.patient(c.patientId);
        const crew = c.crewId ? store_1.store.crew(c.crewId) : undefined;
        return [
            c.callNumber,
            when(c).slice(0, 10),
            p?.patientNumber ?? '',
            c.patient.lastName,
            c.patient.firstName,
            c.patient.dob,
            c.insurance.payer,
            c.insurance.memberId,
            c.insurance.priorAuth,
            c.pcsOnFile || (p?.pcsExpires && p.pcsExpires >= when(c).slice(0, 10)) ? 'Y' : 'N',
            c.level,
            types_1.TRIP_TYPES[c.tripType],
            c.leg,
            c.pickupLocation,
            c.destination,
            c.loadedMiles ?? '',
            c.statusTimes.ON_SCENE ?? '',
            c.statusTimes.TRANSPORTING ?? '',
            c.statusTimes.AT_DESTINATION ?? '',
            crew?.unit ?? '',
            c.equipment.join(';'),
            c.chiefComplaint,
            c.stretcherReason,
        ];
    });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PHI_EXPORT_BILLING', outcome: 'success', detail: `rows=${rows.length}` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="billing-export.csv"');
    res.send((0, http_1.toCsv)(['Call #', 'Date of service', 'Patient #', 'Last name', 'First name', 'DOB', 'Payer', 'Member ID', 'Prior auth', 'PCS', 'Level', 'Trip type', 'Leg',
        'Pickup', 'Destination', 'Loaded miles', 'On scene', 'Patient loaded', 'At destination', 'Unit', 'Equipment', 'Chief complaint', 'Medical necessity'], rows));
});
// ======================= Run sheets =======================
/** One crew's trips for a day, with the details the crew needs. Audited as a PHI print. */
exports.featuresApi.post('/runsheet', ...staff, (req, res) => {
    const v = zod_1.z.object({ crewId: zod_1.z.string(), from: isoDate, to: isoDate }).safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const crew = store_1.store.crew(v.data.crewId);
    if (!crew)
        return res.status(404).json({ error: 'NOT_FOUND' });
    const trips = inRange(v.data.from, v.data.to)
        .filter((c) => c.crewId === crew.id && c.status !== 'CANCELLED')
        .sort((a, b) => when(a).localeCompare(when(b)));
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PHI_PRINT_RUNSHEET', entityType: 'crew', entityId: crew.id, outcome: 'success', detail: `trips=${trips.length}` });
    res.json({ crew, trips, facilities: store_1.store.state.facilities });
});
// ======================= Supervisor: users =======================
const username = zod_1.z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dot, dash or underscore');
const userFields = zod_1.z.object({
    displayName: zod_1.z.string().trim().min(1).max(60),
    role: zod_1.z.enum(['dispatcher', 'supervisor', 'viewer', 'crew']),
    crewId: zod_1.z.string().nullable().default(null),
});
const userOut = () => store_1.store.state.users.map((u) => ({ username: u.username, displayName: u.displayName, role: u.role, crewId: u.crewId ?? null, disabled: u.disabled }));
exports.featuresApi.get('/admin/users', ...supervisor, (_req, res) => res.json({ users: userOut() }));
exports.featuresApi.post('/admin/users', ...supervisor, (req, res) => {
    const v = userFields.extend({ username, password: zod_1.z.string().min(12).max(200) }).safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const d = v.data;
    if (store_1.store.state.users.some((u) => u.username.toLowerCase() === d.username.toLowerCase()))
        return res.status(409).json({ error: 'DUPLICATE', message: 'That username is taken.' });
    if (d.role === 'crew' && !store_1.store.crew(d.crewId || ''))
        return res.status(400).json({ error: 'VALIDATION', message: 'Choose the crew for this account.' });
    store_1.store.state.users.push({
        username: d.username,
        displayName: d.displayName,
        role: d.role,
        crewId: d.role === 'crew' ? d.crewId : null,
        passwordHash: (0, crypto_1.hashPassword)(d.password),
        disabled: false,
    });
    store_1.store.save();
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'USER_CREATE', entityType: 'user', entityId: d.username, outcome: 'success', detail: `role=${d.role}` });
    res.status(201).json({ users: userOut() });
});
exports.featuresApi.patch('/admin/users/:username', ...supervisor, (req, res) => {
    const v = userFields
        .partial()
        .extend({ disabled: zod_1.z.boolean().optional(), password: zod_1.z.string().min(12).max(200).optional() })
        .safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const u = store_1.store.state.users.find((x) => x.username === req.params.username);
    if (!u)
        return res.status(404).json({ error: 'NOT_FOUND' });
    if (u.username === req.user.username && (v.data.disabled || (v.data.role && v.data.role !== 'supervisor')))
        return res.status(400).json({ error: 'VALIDATION', message: "You can't disable or demote your own account." });
    const { password, ...rest } = v.data;
    Object.assign(u, rest);
    if (u.role !== 'crew')
        u.crewId = null;
    if (password)
        u.passwordHash = (0, crypto_1.hashPassword)(password);
    if (rest.disabled || password || rest.role)
        (0, auth_1.destroyUserSessions)(u.username);
    store_1.store.save();
    (0, audit_1.audit)({
        ...(0, http_1.who)(req),
        action: 'USER_UPDATE',
        entityType: 'user',
        entityId: u.username,
        outcome: 'success',
        detail: Object.keys(v.data).map((k) => (k === 'password' ? 'password reset' : k)).join(','),
    });
    res.json({ users: userOut() });
});
// ======================= Supervisor: crews / trucks roster =======================
const crewFields = zod_1.z.object({
    unit: zod_1.z.string().trim().min(1).max(40),
    vehicle: zod_1.z.string().trim().min(1).max(40),
    phone: zod_1.z.string().trim().max(30).default(''),
    level: zod_1.z.enum(['ALS', 'BLS']),
    members: zod_1.z.array(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(60), cert: zod_1.z.enum(['Paramedic', 'AEMT', 'EMT']) })).max(4),
    shiftStart: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
    shiftEnd: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
    gpsDeviceId: zod_1.z.string().trim().max(64).default(''),
    active: zod_1.z.boolean().default(true),
});
function crewWarnings(c) {
    const w = [];
    if (c.level === 'ALS' && !c.members.some((m) => m.cert === 'Paramedic'))
        w.push('An ALS unit normally needs at least one paramedic.');
    return w;
}
exports.featuresApi.post('/admin/crews', ...supervisor, (req, res) => {
    const v = crewFields.safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const crew = { id: `crew-${node_crypto_1.default.randomUUID().slice(0, 8)}`, ...v.data, outOfService: false, oosReason: '', version: 1 };
    store_1.store.state.crews.push(crew);
    store_1.store.save();
    store_1.store.emit({ type: 'crew', action: 'added to roster', actor: (0, http_1.actor)(req), crew });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CREW_CREATE', entityType: 'crew', entityId: crew.id, outcome: 'success' });
    res.status(201).json({ crew, warnings: crewWarnings(v.data) });
});
exports.featuresApi.put('/admin/crews/:id', ...supervisor, (req, res) => {
    const v = crewFields.extend({ expectedVersion: zod_1.z.number().int() }).safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const crew = store_1.store.crew(req.params.id);
    if (!crew)
        return res.status(404).json({ error: 'NOT_FOUND' });
    if (crew.version !== v.data.expectedVersion)
        return res.status(409).json({ error: 'VERSION_CONFLICT', message: `${crew.unit} was just changed by someone else.`, crew });
    const { expectedVersion: _ev, ...fields } = v.data;
    Object.assign(crew, fields);
    crew.version++;
    store_1.store.save();
    store_1.store.emit({ type: 'crew', action: 'roster updated', actor: (0, http_1.actor)(req), crew });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'CREW_UPDATE', entityType: 'crew', entityId: crew.id, outcome: 'success' });
    res.json({ crew, warnings: crewWarnings(v.data) });
});
