import crypto from 'node:crypto';
import express, { type Request } from 'express';
import { z } from 'zod';
import { EQUIPMENT, ageFromDob, paperworkAlerts, type Equipment, type Patient, type PatientSummary } from '../../shared/types';
import { audit } from './audit';
import { requireAuth, requireRole } from './auth';
import { actor, bad, who } from './http';
import { store, summarize } from './store';

/**
 * Patient master records. A call keeps its own snapshot of patient details as they were for
 * that trip, and points back to the patient record by patientId so the record can list every
 * past and upcoming trip.
 */
export const patientsApi = express.Router();

const equipment = Object.keys(EQUIPMENT) as [Equipment, ...Equipment[]];
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const patientFields = z.object({
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  dob: ymd.refine((d) => new Date(d) < new Date() && new Date(d) > new Date('1900-01-01'), 'Invalid date of birth'),
  sex: z.enum(['F', 'M', 'X', 'U']).default('U'),
  weightLbs: z.number().int().min(1).max(1500),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(200).default(''),
  insurance: z.object({ payer: z.string().trim().max(80).default(''), memberId: z.string().trim().max(40).default('') }),
  pcsExpires: ymd.nullable().default(null),
  priorAuth: z
    .object({ number: z.string().trim().max(40).default(''), expires: ymd.nullable().default(null), tripsAuthorized: z.number().int().min(0).max(999).nullable().default(null) })
    .default({ number: '', expires: null, tripsAuthorized: null }),
  defaultLevel: z.enum(['ALS', 'BLS']).default('BLS'),
  defaultEquipment: z.array(z.enum(equipment)).default([]),
  stretcherReason: z.string().trim().max(500).default(''),
  medicalNotes: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
});

function tripsOf(patientId: string) {
  return store.state.calls.filter((c) => c.patientId === patientId);
}

const when = (c: { scheduledStart: string | null; pickupTime: string | null; createdAt: string }) => c.scheduledStart || c.pickupTime || c.createdAt;

export function patientSummary(p: Patient): PatientSummary {
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
    age: ageFromDob(p.dob),
    payer: p.insurance.payer,
    nextTrip: upcoming[0] ?? null,
    lastTrip: past[past.length - 1] ?? null,
    alerts: paperworkAlerts(p, new Date()),
  };
}

/**
 * For a new call: use the chosen patient record, or find an exact match (name + DOB),
 * or create a new record. The record is refreshed with the latest weight and insurance.
 */
export function resolvePatient(
  req: Request,
  patientId: string | null,
  f: {
    patient: { firstName: string; lastName: string; dob: string; weightLbs: number };
    insurance: { payer: string; memberId: string };
    level: 'ALS' | 'BLS';
    equipment: Equipment[];
    stretcherReason: string;
    chiefComplaint: string;
  },
): Patient | null {
  const now = new Date().toISOString();
  let p = patientId
    ? store.patient(patientId)
    : store.state.patients.find(
        (x) =>
          x.dob === f.patient.dob &&
          x.lastName.toLowerCase() === f.patient.lastName.toLowerCase() &&
          x.firstName.toLowerCase() === f.patient.firstName.toLowerCase(),
      );
  if (patientId && !p) return null;
  if (!p) {
    p = {
      id: crypto.randomUUID(),
      patientNumber: store.nextPatientNumber(),
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
      updatedBy: actor(req),
    };
    store.state.patients.push(p);
    audit({ ...who(req), action: 'PATIENT_CREATE', entityType: 'patient', entityId: p.id, outcome: 'success', detail: 'from call intake' });
  } else if (p.weightLbs !== f.patient.weightLbs || p.insurance.payer !== f.insurance.payer || p.insurance.memberId !== f.insurance.memberId) {
    p.weightLbs = f.patient.weightLbs;
    p.insurance = { payer: f.insurance.payer, memberId: f.insurance.memberId };
    p.version++;
    p.updatedAt = now;
    p.updatedBy = actor(req);
    audit({ ...who(req), action: 'PATIENT_UPDATE', entityType: 'patient', entityId: p.id, outcome: 'success', detail: 'weight/insurance from call intake' });
  }
  return p;
}

const staff = [requireAuth(), requireRole('dispatcher', 'supervisor')];

/** Search by name, patient number, DOB or member id. POST keeps names out of URLs and logs. */
patientsApi.post('/patients/search', ...staff, (req, res) => {
  const p = z.object({ q: z.string().trim().max(60).default(''), includeInactive: z.boolean().default(false) }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const q = p.data.q.toLowerCase();
  const words = q.split(/[\s,]+/).filter(Boolean);
  const hits = store.state.patients
    .filter((x) => p.data.includeInactive || x.active)
    .filter((x) => {
      if (!q) return true;
      const hay = `${x.lastName} ${x.firstName} ${x.patientNumber} ${x.dob} ${x.insurance.memberId}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
    .slice(0, 50);
  audit({ ...who(req), action: 'PATIENT_SEARCH', outcome: 'success', detail: `results=${hits.length}` });
  res.json({ patients: hits.map(patientSummary) });
});

/** Full record plus every trip. Audited. */
patientsApi.get('/patients/:id', ...staff, (req, res) => {
  const p = store.patient(req.params.id);
  if (!p) return res.status(404).json({ error: 'NOT_FOUND' });
  audit({ ...who(req), action: 'PATIENT_VIEW_PHI', entityType: 'patient', entityId: p.id, outcome: 'success' });
  const trips = tripsOf(p.id)
    .map(summarize)
    .sort((a, b) => when(b).localeCompare(when(a)));
  res.json({ patient: p, summary: patientSummary(p), trips });
});

patientsApi.post('/patients', ...staff, (req, res) => {
  const v = patientFields.safeParse(req.body);
  if (!v.success) return bad(res, v.error);
  const d = v.data;
  const dup = store.state.patients.find(
    (x) => x.dob === d.dob && x.lastName.toLowerCase() === d.lastName.toLowerCase() && x.firstName.toLowerCase() === d.firstName.toLowerCase(),
  );
  if (dup) return res.status(409).json({ error: 'DUPLICATE', message: `A patient with this name and date of birth already exists (${dup.patientNumber}).`, patientId: dup.id });
  const now = new Date().toISOString();
  const p: Patient = { id: crypto.randomUUID(), patientNumber: store.nextPatientNumber(), version: 1, ...d, createdAt: now, updatedAt: now, updatedBy: actor(req) };
  store.state.patients.push(p);
  store.save();
  audit({ ...who(req), action: 'PATIENT_CREATE', entityType: 'patient', entityId: p.id, outcome: 'success' });
  res.status(201).json({ patient: p });
});

patientsApi.patch('/patients/:id', ...staff, (req, res) => {
  const v = patientFields.partial().extend({ expectedVersion: z.number().int() }).safeParse(req.body);
  if (!v.success) return bad(res, v.error);
  const p = store.patient(req.params.id);
  if (!p) return res.status(404).json({ error: 'NOT_FOUND' });
  const { expectedVersion, ...changes } = v.data;
  if (p.version !== expectedVersion) {
    audit({ ...who(req), action: 'PATIENT_UPDATE', entityType: 'patient', entityId: p.id, outcome: 'conflict' });
    return res.status(409).json({ error: 'VERSION_CONFLICT', message: `This record was just changed by ${p.updatedBy}. It has been reloaded.`, patient: p });
  }
  const fields = Object.keys(changes).filter((k) => JSON.stringify((changes as never)[k]) !== JSON.stringify((p as never)[k]));
  Object.assign(p, changes);
  p.version++;
  p.updatedAt = new Date().toISOString();
  p.updatedBy = actor(req);
  store.save();
  // Paperwork changes alter the alerts on this patient's open trips; push them to the board.
  if (fields.some((f) => f === 'pcsExpires' || f === 'priorAuth')) {
    for (const c of tripsOf(p.id).filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status))) {
      store.emit({ type: 'call', action: 'paperwork updated', actor: actor(req), call: summarize(c) });
    }
  }
  audit({ ...who(req), action: 'PATIENT_UPDATE', entityType: 'patient', entityId: p.id, outcome: 'success', detail: `fields=${fields.join(',')}` });
  res.json({ patient: p, summary: patientSummary(p) });
});
