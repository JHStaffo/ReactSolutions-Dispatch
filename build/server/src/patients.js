"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.patientsApi = void 0;
exports.patientSummary = patientSummary;
exports.resolvePatient = resolvePatient;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const types_1 = require("../../shared/types");
const audit_1 = require("./audit");
const auth_1 = require("./auth");
const http_1 = require("./http");
const store_1 = require("./store");
/**
 * Patient master records. A call keeps its own snapshot of patient details as they were for
 * that trip, and points back to the patient record by patientId so the record can list every
 * past and upcoming trip.
 */
exports.patientsApi = express_1.default.Router();
const equipment = Object.keys(types_1.EQUIPMENT);
const ymd = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const patientFields = zod_1.z.object({
    firstName: zod_1.z.string().trim().min(1).max(50),
    lastName: zod_1.z.string().trim().min(1).max(50),
    dob: ymd.refine((d) => new Date(d) < new Date() && new Date(d) > new Date('1900-01-01'), 'Invalid date of birth'),
    sex: zod_1.z.enum(['F', 'M', 'X', 'U']).default('U'),
    weightLbs: zod_1.z.number().int().min(1).max(1500),
    phone: zod_1.z.string().trim().max(30).default(''),
    address: zod_1.z.string().trim().max(200).default(''),
    insurance: zod_1.z.object({ payer: zod_1.z.string().trim().max(80).default(''), memberId: zod_1.z.string().trim().max(40).default('') }),
    pcsExpires: ymd.nullable().default(null),
    priorAuth: zod_1.z
        .object({ number: zod_1.z.string().trim().max(40).default(''), expires: ymd.nullable().default(null), tripsAuthorized: zod_1.z.number().int().min(0).max(999).nullable().default(null) })
        .default({ number: '', expires: null, tripsAuthorized: null }),
    defaultLevel: zod_1.z.enum(['ALS', 'BLS']).default('BLS'),
    defaultEquipment: zod_1.z.array(zod_1.z.enum(equipment)).default([]),
    stretcherReason: zod_1.z.string().trim().max(500).default(''),
    medicalNotes: zod_1.z.string().trim().max(1000).default(''),
    active: zod_1.z.boolean().default(true),
});
function tripsOf(patientId) {
    return store_1.store.state.calls.filter((c) => c.patientId === patientId);
}
const when = (c) => c.scheduledStart || c.pickupTime || c.createdAt;
function patientSummary(p) {
    const now = Date.now();
    const trips = tripsOf(p.id);
    const upcoming = trips
        .filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status) && Date.parse(when(c)) >= now - 3600_000)
        .map(when)
        .sort();
    const past = trips
        .filter((c) => c.status === 'COMPLETED')
        .map(when)
        .sort();
    return {
        id: p.id,
        patientNumber: p.patientNumber,
        name: `${p.lastName}, ${p.firstName}`,
        dob: p.dob,
        age: (0, types_1.ageFromDob)(p.dob),
        payer: p.insurance.payer,
        nextTrip: upcoming[0] ?? null,
        lastTrip: past[past.length - 1] ?? null,
        alerts: (0, types_1.paperworkAlerts)(p, new Date()),
    };
}
/**
 * For a new call: use the chosen patient record, or find an exact match (name + DOB),
 * or create a new record. The record is refreshed with the latest weight and insurance.
 */
function resolvePatient(req, patientId, f) {
    const now = new Date().toISOString();
    let p = patientId
        ? store_1.store.patient(patientId)
        : store_1.store.state.patients.find((x) => x.dob === f.patient.dob &&
            x.lastName.toLowerCase() === f.patient.lastName.toLowerCase() &&
            x.firstName.toLowerCase() === f.patient.firstName.toLowerCase());
    if (patientId && !p)
        return null;
    if (!p) {
        p = {
            id: node_crypto_1.default.randomUUID(),
            patientNumber: store_1.store.nextPatientNumber(),
            version: 1,
            firstName: f.patient.firstName,
            lastName: f.patient.lastName,
            dob: f.patient.dob,
            sex: 'U',
            weightLbs: f.patient.weightLbs,
            phone: '',
            address: '',
            insurance: { payer: f.insurance.payer, memberId: f.insurance.memberId },
            pcsExpires: null,
            priorAuth: { number: '', expires: null, tripsAuthorized: null },
            defaultLevel: f.level,
            defaultEquipment: f.equipment,
            stretcherReason: f.stretcherReason,
            medicalNotes: f.chiefComplaint,
            active: true,
            createdAt: now,
            updatedAt: now,
            updatedBy: (0, http_1.actor)(req),
        };
        store_1.store.state.patients.push(p);
        (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PATIENT_CREATE', entityType: 'patient', entityId: p.id, outcome: 'success', detail: 'from call intake' });
    }
    else if (p.weightLbs !== f.patient.weightLbs || p.insurance.payer !== f.insurance.payer || p.insurance.memberId !== f.insurance.memberId) {
        p.weightLbs = f.patient.weightLbs;
        p.insurance = { payer: f.insurance.payer, memberId: f.insurance.memberId };
        p.version++;
        p.updatedAt = now;
        p.updatedBy = (0, http_1.actor)(req);
        (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PATIENT_UPDATE', entityType: 'patient', entityId: p.id, outcome: 'success', detail: 'weight/insurance from call intake' });
    }
    return p;
}
const staff = [(0, auth_1.requireAuth)(), (0, auth_1.requireRole)('dispatcher', 'supervisor')];
/** Search by name, patient number, DOB or member id. POST keeps names out of URLs and logs. */
exports.patientsApi.post('/patients/search', ...staff, (req, res) => {
    const p = zod_1.z.object({ q: zod_1.z.string().trim().max(60).default(''), includeInactive: zod_1.z.boolean().default(false) }).safeParse(req.body);
    if (!p.success)
        return (0, http_1.bad)(res, p.error);
    const q = p.data.q.toLowerCase();
    const words = q.split(/[\s,]+/).filter(Boolean);
    const hits = store_1.store.state.patients
        .filter((x) => p.data.includeInactive || x.active)
        .filter((x) => {
        if (!q)
            return true;
        const hay = `${x.lastName} ${x.firstName} ${x.patientNumber} ${x.dob} ${x.insurance.memberId}`.toLowerCase();
        return words.every((w) => hay.includes(w));
    })
        .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
        .slice(0, 50);
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PATIENT_SEARCH', outcome: 'success', detail: `results=${hits.length}` });
    res.json({ patients: hits.map(patientSummary) });
});
/** Full record plus every trip. Audited. */
exports.patientsApi.get('/patients/:id', ...staff, (req, res) => {
    const p = store_1.store.patient(req.params.id);
    if (!p)
        return res.status(404).json({ error: 'NOT_FOUND' });
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PATIENT_VIEW_PHI', entityType: 'patient', entityId: p.id, outcome: 'success' });
    const trips = tripsOf(p.id)
        .map(store_1.summarize)
        .sort((a, b) => when(b).localeCompare(when(a)));
    res.json({ patient: p, summary: patientSummary(p), trips });
});
exports.patientsApi.post('/patients', ...staff, (req, res) => {
    const v = patientFields.safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const d = v.data;
    const dup = store_1.store.state.patients.find((x) => x.dob === d.dob && x.lastName.toLowerCase() === d.lastName.toLowerCase() && x.firstName.toLowerCase() === d.firstName.toLowerCase());
    if (dup)
        return res.status(409).json({ error: 'DUPLICATE', message: `A patient with this name and date of birth already exists (${dup.patientNumber}).`, patientId: dup.id });
    const now = new Date().toISOString();
    const p = { id: node_crypto_1.default.randomUUID(), patientNumber: store_1.store.nextPatientNumber(), version: 1, ...d, createdAt: now, updatedAt: now, updatedBy: (0, http_1.actor)(req) };
    store_1.store.state.patients.push(p);
    store_1.store.save();
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PATIENT_CREATE', entityType: 'patient', entityId: p.id, outcome: 'success' });
    res.status(201).json({ patient: p });
});
exports.patientsApi.patch('/patients/:id', ...staff, (req, res) => {
    const v = patientFields.partial().extend({ expectedVersion: zod_1.z.number().int() }).safeParse(req.body);
    if (!v.success)
        return (0, http_1.bad)(res, v.error);
    const p = store_1.store.patient(req.params.id);
    if (!p)
        return res.status(404).json({ error: 'NOT_FOUND' });
    const { expectedVersion, ...changes } = v.data;
    if (p.version !== expectedVersion) {
        (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PATIENT_UPDATE', entityType: 'patient', entityId: p.id, outcome: 'conflict' });
        return res.status(409).json({ error: 'VERSION_CONFLICT', message: `This record was just changed by ${p.updatedBy}. It has been reloaded.`, patient: p });
    }
    const fields = Object.keys(changes).filter((k) => JSON.stringify(changes[k]) !== JSON.stringify(p[k]));
    Object.assign(p, changes);
    p.version++;
    p.updatedAt = new Date().toISOString();
    p.updatedBy = (0, http_1.actor)(req);
    store_1.store.save();
    // Paperwork changes alter the alerts on this patient's open trips; push them to the board.
    if (fields.some((f) => f === 'pcsExpires' || f === 'priorAuth')) {
        for (const c of tripsOf(p.id).filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status))) {
            store_1.store.emit({ type: 'call', action: 'paperwork updated', actor: (0, http_1.actor)(req), call: (0, store_1.summarize)(c) });
        }
    }
    (0, audit_1.audit)({ ...(0, http_1.who)(req), action: 'PATIENT_UPDATE', entityType: 'patient', entityId: p.id, outcome: 'success', detail: `fields=${fields.join(',')}` });
    res.json({ patient: p, summary: patientSummary(p) });
});
